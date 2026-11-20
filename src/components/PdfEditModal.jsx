// "Editar PDF": abrir un PDF, sacarle páginas, cambiarles el orden y sumarle
// páginas de otros PDF (por ejemplo las que se corrigieron aparte). Guarda una
// COPIA nueva; el archivo original no se toca.
//
// Las páginas se copian tal cual (ver lib/pdfEdit.js): no se pasan a imagen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { rasterizePdfPagesAt } from '../lib/pdfPreview.js';
import {
  buildEditedPdf, removePages, insertPagesAfter, movePagesBefore, shiftPages,
} from '../lib/pdfEdit.js';

const THUMB_DPI = 48;

const esPdf = (f) => /\.pdf$/i.test(f?.name || '') || f?.type === 'application/pdf';
const sinExt = (n) => String(n || 'documento.pdf').replace(/\.pdf$/i, '');

export default function PdfEditModal({ open, onClose }) {
  const abrirRef = useRef(null);
  const agregarRef = useRef(null);
  const idRef = useRef(0);
  const fuentesRef = useRef(new Map()); // docId → Uint8Array (bytes de cada PDF)
  const ultimoClicRef = useRef(null);

  const [base, setBase] = useState(null);       // { id, name }
  const [pages, setPages] = useState([]);       // [{ key, docId, pageIndex, thumb, nueva, origen }]
  const [sel, setSel] = useState(() => new Set());
  const [historial, setHistorial] = useState([]); // listas anteriores (Deshacer)
  const [cargando, setCargando] = useState(null); // texto de progreso | null
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);     // { text, path? }
  const [sucio, setSucio] = useState(false);
  const [arrastre, setArrastre] = useState(null); // clave sobre la que se va a soltar

  const ocupado = !!cargando || guardando;

  const limpiar = () => {
    fuentesRef.current = new Map();
    ultimoClicRef.current = null;
    setBase(null); setPages([]); setSel(new Set()); setHistorial([]);
    setCargando(null); setGuardando(false); setError(null); setAviso(null); setSucio(false); setArrastre(null);
  };
  useEffect(() => { if (!open) limpiar(); }, [open]);

  const cerrar = () => {
    if (guardando) return;
    if (sucio && !window.confirm('Hay cambios sin guardar. ¿Cerrar igual?')) return;
    onClose?.();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') cerrar();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size && !ocupado
        && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) { e.preventDefault(); eliminar(sel); }
      else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !ocupado) { e.preventDefault(); deshacer(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Lee un PDF y devuelve sus páginas listas para la lista (con miniatura).
  const leerPdf = async (file, { nueva }) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = `d${idRef.current++}`;
    const thumbs = await rasterizePdfPagesAt(bytes, {
      dpi: THUMB_DPI, format: 'image/jpeg', quality: 0.7,
      onProgress: (d, t) => setCargando(`Leyendo ${file.name}… ${d}/${t}`),
    });
    fuentesRef.current.set(id, bytes);
    return {
      id,
      lista: thumbs.map((t) => ({
        key: `${id}:${t.pageIndex - 1}`, docId: id, pageIndex: t.pageIndex - 1,
        thumb: t.dataUrl, nueva, origen: file.name, numOrigen: t.pageIndex,
      })),
    };
  };

  const mensajeDeError = (file, err) => {
    const m = String(err?.message || err);
    if (/password/i.test(m)) return `"${file.name}" tiene contraseña: no se puede abrir.`;
    return `No se pudo leer "${file.name}": ${m}`;
  };

  const abrirBase = async (file) => {
    if (!file || !esPdf(file)) { setError('Elegí un archivo PDF.'); return; }
    if (sucio && !window.confirm('Hay cambios sin guardar en el PDF abierto. ¿Abrir otro igual?')) return;
    limpiar();
    setCargando(`Leyendo ${file.name}…`);
    try {
      const { id, lista } = await leerPdf(file, { nueva: false });
      setBase({ id, name: file.name });
      setPages(lista);
    } catch (err) {
      setError(mensajeDeError(file, err));
    } finally { setCargando(null); }
  };

  const cambiar = (nuevaLista, { conservarSel = false } = {}) => {
    setHistorial((h) => [...h.slice(-49), pages]);
    setPages(nuevaLista);
    if (!conservarSel) setSel(new Set());
    setSucio(true); setAviso(null); setError(null);
  };

  const deshacer = () => {
    if (!historial.length) return;
    setPages(historial[historial.length - 1]);
    setHistorial((h) => h.slice(0, -1));
    setSel(new Set());
    setAviso(null);
  };

  const eliminar = (claves) => {
    const s = claves instanceof Set ? claves : new Set(claves);
    if (!s.size) return;
    const queda = removePages(pages, s);
    if (queda.length === 0) { setError('No se pueden eliminar todas: el PDF tiene que quedar con al menos una página.'); return; }
    cambiar(queda);
  };

  // Dónde entran las páginas que se agregan: después de la ÚLTIMA seleccionada
  // (en el orden de la lista) o, si no hay ninguna, al final.
  const ancla = useMemo(() => {
    let ult = null;
    pages.forEach((p, i) => { if (sel.has(p.key)) ult = { key: p.key, pos: i + 1 }; });
    return ult;
  }, [pages, sel]);

  const agregar = async (files) => {
    const pdfs = Array.from(files || []).filter(esPdf);
    if (!pdfs.length) { setError('Elegí uno o más archivos PDF.'); return; }
    setError(null);
    const todas = [];
    try {
      for (const f of pdfs) {
        setCargando(`Leyendo ${f.name}…`);
        try {
          const { lista } = await leerPdf(f, { nueva: true });
          todas.push(...lista);
        } catch (err) { setError(mensajeDeError(f, err)); }
      }
    } finally { setCargando(null); }
    if (!todas.length) return;
    cambiar(insertPagesAfter(pages, todas, ancla ? ancla.key : null), { conservarSel: true });
    // Quedan seleccionadas las recién agregadas: listas para moverlas si hace falta.
    setSel(new Set(todas.map((p) => p.key)));
  };

  const elegir = (e, cb) => {
    const files = Array.from(e.target.files || []); // copia ANTES de vaciar el input
    e.target.value = '';
    if (files.length) cb(files);
  };

  const clic = (e, p, i) => {
    if (ocupado) return;
    setSel((prev) => {
      const next = new Set(prev);
      const desde = ultimoClicRef.current;
      if (e.shiftKey && desde != null && desde < pages.length) {
        const [a, b] = desde < i ? [desde, i] : [i, desde];
        for (let k = a; k <= b; k++) next.add(pages[k].key);
      } else if (next.has(p.key)) next.delete(p.key);
      else next.add(p.key);
      return next;
    });
    ultimoClicRef.current = i;
  };

  const mover = (dir) => { if (sel.size) cambiar(shiftPages(pages, sel, dir), { conservarSel: true }); };

  // Arrastrar: se mueve la página arrastrada (o todas las seleccionadas, si la
  // arrastrada es una de ellas) y cae ANTES de la página donde se suelta.
  const arrastradasRef = useRef(null);
  const onDragStart = (e, p) => {
    arrastradasRef.current = sel.has(p.key) ? new Set(sel) : new Set([p.key]);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', p.key); } catch (_) { /* noop */ }
  };
  const soltar = (beforeKey) => {
    const claves = arrastradasRef.current;
    arrastradasRef.current = null;
    setArrastre(null);
    if (!claves || !claves.size) return;
    const nueva = movePagesBefore(pages, claves, beforeKey);
    if (nueva !== pages) cambiar(nueva, { conservarSel: true });
  };

  const guardar = async () => {
    if (!pages.length || ocupado) return;
    setGuardando(true); setError(null); setAviso(null);
    try {
      const bytes = await buildEditedPdf(fuentesRef.current, pages);
      const r = await window.printlayout.pdf.save(`${sinExt(base?.name)}_editado.pdf`, bytes);
      if (r?.error) setError(`No se pudo guardar: ${r.error}`);
      else if (r?.path) { setAviso({ text: `Guardado: ${pages.length} página${pages.length === 1 ? '' : 's'}`, path: r.path }); setSucio(false); }
    } catch (err) {
      setError(`No se pudo armar el PDF: ${err?.message || err}`);
    } finally { setGuardando(false); }
  };

  if (!open) return null;

  const nNuevas = pages.filter((p) => p.nueva).length;
  const btn = 'rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}
    >
      <div className="flex h-[90vh] w-[72rem] max-w-[96vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink-100">Editar PDF</h3>
            <p className="mt-0.5 truncate text-xs text-ink-400">
              {base
                ? <>{base.name} — {pages.length} página{pages.length === 1 ? '' : 's'}{nNuevas ? ` (${nNuevas} agregada${nNuevas === 1 ? '' : 's'})` : ''}{sucio ? ' · con cambios sin guardar' : ''}</>
                : 'Abrí un PDF para sacarle páginas, cambiarles el orden o sumarle páginas de otro PDF.'}
            </p>
          </div>
          <button type="button" onClick={cerrar} className="rounded px-2 py-1 text-sm text-ink-400 hover:bg-ink-800" title="Cerrar">✕</button>
        </div>

        <input ref={abrirRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => elegir(e, (fs) => abrirBase(fs[0]))} />
        <input ref={agregarRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => elegir(e, agregar)} />

        {base && (
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 px-4 py-2">
            <button type="button" className="rounded-md bg-accent-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40" disabled={ocupado} onClick={() => agregarRef.current?.click()}
              title="Suma las páginas de otro PDF. Entran después de la página seleccionada, o al final si no hay ninguna seleccionada.">
              + Agregar páginas de otro PDF
            </button>
            <span className="text-[11px] text-ink-400">
              {ancla ? `Entran después de la página ${ancla.pos}` : 'Entran al final (seleccioná una página para elegir dónde)'}
            </span>
            <span className="mx-1 h-4 w-px bg-ink-700" />
            <button type="button" className={btn} disabled={ocupado || !sel.size} onClick={() => eliminar(sel)} title="Elimina las páginas seleccionadas (tecla Supr)">
              Eliminar{sel.size ? ` (${sel.size})` : ''}
            </button>
            <button type="button" className={btn} disabled={ocupado || !sel.size} onClick={() => mover(-1)} title="Mueve las seleccionadas un lugar hacia atrás">◀ Mover</button>
            <button type="button" className={btn} disabled={ocupado || !sel.size} onClick={() => mover(1)} title="Mueve las seleccionadas un lugar hacia adelante">Mover ▶</button>
            <button type="button" className={btn} disabled={ocupado || !sel.size} onClick={() => setSel(new Set())}>Deseleccionar</button>
            <button type="button" className={btn} disabled={ocupado || !historial.length} onClick={deshacer} title="Deshace el último cambio (Ctrl+Z)">Deshacer</button>
          </div>
        )}

        <div
          className="min-h-0 flex-1 overflow-auto p-4"
          onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files') || arrastradasRef.current) e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const fs = e.dataTransfer?.files;
            if (fs && fs.length) { if (base) agregar(fs); else abrirBase(fs[0]); return; }
            if (arrastradasRef.current) soltar(null); // soltó en el fondo → al final
          }}
        >
          {error && <div className="mb-3 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}
          {aviso && (
            <div className="mb-3 rounded border border-green-800 bg-green-950/40 px-3 py-2 text-xs text-green-300">
              {aviso.text}{aviso.path ? <> — <span className="break-all text-green-200">{aviso.path}</span></> : null}
            </div>
          )}
          {cargando && <div className="mb-3 text-xs text-ink-300">{cargando}</div>}

          {!base && !cargando && (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-700 text-center">
              <button type="button" onClick={() => abrirRef.current?.click()} className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">Abrir PDF</button>
              <p className="text-xs text-ink-400">o arrastrá el archivo acá</p>
            </div>
          )}

          {base && (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                {pages.map((p, i) => {
                  const marcada = sel.has(p.key);
                  return (
                    <div
                      key={p.key}
                      draggable={!ocupado}
                      onDragStart={(e) => onDragStart(e, p)}
                      onDragEnd={() => { arrastradasRef.current = null; setArrastre(null); }}
                      onDragOver={(e) => { if (arrastradasRef.current) { e.preventDefault(); e.stopPropagation(); if (arrastre !== p.key) setArrastre(p.key); } }}
                      onDrop={(e) => { if (arrastradasRef.current) { e.preventDefault(); e.stopPropagation(); soltar(p.key); } }}
                      onClick={(e) => clic(e, p, i)}
                      title={`${p.origen} — página ${p.numOrigen}`}
                      className={`group relative cursor-pointer select-none rounded-md border-2 bg-ink-800 p-1.5 ${marcada ? 'border-accent-500' : 'border-transparent hover:border-ink-600'} ${arrastre === p.key ? 'shadow-[-4px_0_0_0_#38bdf8]' : ''}`}
                    >
                      <div className="flex h-44 items-center justify-center overflow-hidden rounded bg-ink-950">
                        <img src={p.thumb} alt="" draggable={false} className="max-h-full max-w-full bg-white shadow" />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-ink-100">{i + 1}</span>
                        {p.nueva
                          ? <span className="rounded bg-green-600/25 px-1 text-[10px] text-green-300">agregada</span>
                          : (p.numOrigen !== i + 1 ? <span className="text-[10px] text-ink-500">era la {p.numOrigen}</span> : null)}
                      </div>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={(e) => { e.stopPropagation(); eliminar([p.key]); }}
                        title="Eliminar esta página"
                        className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow hover:bg-red-500 group-hover:flex"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
                Clic en una página para seleccionarla (Mayús + clic selecciona un tramo). La ✕ roja la elimina. Para cambiar el orden, arrastrala o usá Mover. El archivo original no se modifica: se guarda una copia.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-700 p-3">
          <div>
            {base && <button type="button" className={btn} disabled={ocupado} onClick={() => abrirRef.current?.click()}>Abrir otro PDF…</button>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={cerrar} disabled={guardando} className="rounded border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40">Cerrar</button>
            <button type="button" onClick={guardar} disabled={!base || !pages.length || ocupado} className="rounded bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
              {guardando ? 'Guardando…' : 'Guardar PDF…'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
