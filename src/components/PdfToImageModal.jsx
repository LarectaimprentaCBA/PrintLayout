import { useEffect, useMemo, useRef, useState } from 'react';
import { rasterizePdfPagesAt } from '../lib/pdfPreview.js';

const DPI_OPTIONS = [72, 150, 300, 600];
const STORAGE_DPI = 'printlayout.pdfToImg.dpi';
const STORAGE_FORMAT = 'printlayout.pdfToImg.format';
const STORAGE_QUALITY = 'printlayout.pdfToImg.quality';

function loadStored(key, fallback, parse = (v) => v) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return parse(v);
  } catch {
    return fallback;
  }
}

function baseName(name) {
  return String(name || 'documento.pdf').replace(/\.pdf$/i, '');
}

function pad(n, w) {
  return String(n).padStart(w, '0');
}

// Clave de selección: identifica una página DENTRO de un documento.
const keyFor = (docId, pageIndex) => `${docId}:${pageIndex}`;

export default function PdfToImageModal({ open, onClose }) {
  const fileInputRef = useRef(null);
  const idRef = useRef(0);
  // Varios PDF: cada doc = { id, name, bytes, thumbs[], loading, error }.
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(() => new Set()); // claves docId:pageIndex

  const [dpi, setDpi] = useState(() => loadStored(STORAGE_DPI, 300, (v) => parseInt(v, 10) || 300));
  const [format, setFormat] = useState(() => loadStored(STORAGE_FORMAT, 'image/jpeg'));
  const [quality, setQuality] = useState(() => loadStored(STORAGE_QUALITY, 92, (v) => parseInt(v, 10) || 92));
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });
  const [savedSummary, setSavedSummary] = useState(null);

  useEffect(() => { localStorage.setItem(STORAGE_DPI, String(dpi)); }, [dpi]);
  useEffect(() => { localStorage.setItem(STORAGE_FORMAT, format); }, [format]);
  useEffect(() => { localStorage.setItem(STORAGE_QUALITY, String(quality)); }, [quality]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  const reset = () => {
    setDocs([]);
    setSelected(new Set());
    setSaving(false);
    setSaveProgress({ done: 0, total: 0 });
    setSavedSummary(null);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  // Carga un PDF: lo agrega vacío (loading) y luego completa bytes + miniaturas.
  const loadOne = async (f) => {
    const id = `doc_${idRef.current++}`;
    setDocs((prev) => [...prev, { id, name: f.name, bytes: null, thumbs: [], loading: true, error: null }]);
    setSavedSummary(null);
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const t = await rasterizePdfPagesAt(bytes, { dpi: 72, format: 'image/jpeg', quality: 0.75 });
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, bytes, thumbs: t, loading: false } : d)));
      // Por defecto: todas las páginas del PDF nuevo seleccionadas.
      setSelected((prev) => {
        const next = new Set(prev);
        for (const p of t) next.add(keyFor(id, p.pageIndex));
        return next;
      });
    } catch (err) {
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, loading: false, error: err.message || String(err) } : d)));
    }
  };

  const addFiles = (fileList) => {
    const pdfs = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    for (const f of pdfs) loadOne(f);
  };

  const handlePick = (e) => {
    // Copiar la lista a un array ANTES de resetear value: `e.target.files` es
    // una FileList viva y `e.target.value = ''` la vacía en el acto (por eso no
    // aparecía nada al elegir el PDF). Con el snapshot ya no se pierde.
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) addFiles(files);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeDoc = (id) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setSelected((prev) => {
      const next = new Set();
      for (const k of prev) if (!k.startsWith(`${id}:`)) next.add(k);
      return next;
    });
  };

  const toggle = (docId, pageIndex) => {
    const k = keyFor(docId, pageIndex);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const setDocSelection = (doc, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of doc.thumbs) {
        const k = keyFor(doc.id, p.pageIndex);
        if (on) next.add(k); else next.delete(k);
      }
      return next;
    });
  };
  const selectAll = () => {
    setSelected(() => {
      const next = new Set();
      for (const d of docs) for (const p of d.thumbs) next.add(keyFor(d.id, p.pageIndex));
      return next;
    });
  };
  const selectNone = () => setSelected(new Set());

  const formatExt = format === 'image/jpeg' ? 'jpg' : 'png';
  const selectedCount = selected.size;
  const totalPages = useMemo(() => docs.reduce((n, d) => n + d.thumbs.length, 0), [docs]);
  const anyLoading = docs.some((d) => d.loading);
  const firstThumb = useMemo(() => docs.find((d) => d.thumbs[0])?.thumbs[0] || null, [docs]);

  const handleSave = async () => {
    if (selectedCount === 0) return;
    setSaving(true);
    setSavedSummary(null);
    setSaveProgress({ done: 0, total: selectedCount });
    try {
      const files = [];
      const usedBases = new Set();
      let doneBase = 0;
      for (const doc of docs) {
        if (!doc.bytes || !doc.thumbs.length) continue;
        const indices = doc.thumbs
          .map((t) => t.pageIndex)
          .filter((pi) => selected.has(keyFor(doc.id, pi)))
          .sort((a, b) => a - b);
        if (!indices.length) continue;
        // Nombre base único (dos PDF con el mismo nombre no se pisan).
        let base = baseName(doc.name);
        if (usedBases.has(base)) {
          let n = 2;
          while (usedBases.has(`${base} (${n})`)) n++;
          base = `${base} (${n})`;
        }
        usedBases.add(base);
        const pageWidth = Math.max(2, String(doc.thumbs.length).length);
        const capturedBase = doneBase;
        const pages = await rasterizePdfPagesAt(doc.bytes, {
          dpi,
          format,
          quality: quality / 100,
          pageIndices: indices,
          as: 'arraybuffer',
          onProgress: (done) => setSaveProgress({ done: capturedBase + done, total: selectedCount }),
        });
        for (const p of pages) {
          files.push({ name: `${base}-p${pad(p.pageIndex, pageWidth)}.${formatExt}`, buffer: p.buffer });
        }
        doneBase += indices.length;
        setSaveProgress({ done: doneBase, total: selectedCount });
      }
      if (!files.length) { setSaving(false); return; }
      const res = await window.printlayout.pdf.toImageSaveBatch(files);
      if (res?.canceled) {
        setSavedSummary({ canceled: true });
      } else {
        setSavedSummary({
          canceled: false,
          dir: res.dir,
          saved: res.saved?.length || 0,
          errors: res.errors || [],
        });
      }
    } catch (err) {
      setSavedSummary({ canceled: false, error: err.message || String(err) });
    } finally {
      setSaving(false);
    }
  };

  const openSavedFolder = () => {
    if (savedSummary?.dir && savedSummary.saved > 0 && window.printlayout?.shell?.showItem) {
      window.printlayout.shell.showItem(savedSummary.dir);
    }
  };

  if (!open) return null;

  const hasDocs = docs.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
    >
      <div className="flex max-h-[90vh] w-[56rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">PDF a imagen</h3>
            <p className="mt-0.5 text-xs text-ink-400">
              Convertí las páginas de uno o varios PDF a JPG o PNG y guardalas en una carpeta.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-40"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={handlePick}
        />

        {!hasDocs && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="m-6 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-ink-700 p-12 text-center"
          >
            <p className="text-sm text-ink-300">Arrastrá uno o varios PDF acá</p>
            <p className="text-xs text-ink-500">o</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-500"
            >
              Elegir PDF (podés seleccionar varios)
            </button>
          </div>
        )}

        {hasDocs && (
          <>
            <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-2 text-xs">
              <span className="text-ink-300">
                {docs.length} PDF · {totalPages} página{totalPages === 1 ? '' : 's'} · {selectedCount} seleccionada{selectedCount === 1 ? '' : 's'}
              </span>
              <div className="ml-auto flex gap-1">
                <button type="button" onClick={selectAll} disabled={saving} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800 disabled:opacity-40">Todas</button>
                <button type="button" onClick={selectNone} disabled={saving} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800 disabled:opacity-40">Ninguna</button>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={saving} className="rounded border border-accent-500/40 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/10 disabled:opacity-40">+ Agregar PDF</button>
              </div>
            </div>

            <div
              className="grid grid-cols-[1fr_18rem] gap-0 overflow-hidden"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {docs.map((doc) => {
                  const docSelCount = doc.thumbs.filter((t) => selected.has(keyFor(doc.id, t.pageIndex))).length;
                  return (
                    <div key={doc.id} className="rounded-lg border border-ink-800 bg-ink-950/30 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs">
                        <span className="truncate font-medium text-ink-200" title={doc.name}>{doc.name}</span>
                        {!doc.loading && !doc.error && (
                          <span className="shrink-0 text-ink-500">{doc.thumbs.length} pág · {docSelCount} sel.</span>
                        )}
                        <div className="ml-auto flex shrink-0 gap-1">
                          {!doc.loading && !doc.error && doc.thumbs.length > 0 && (
                            <>
                              <button type="button" onClick={() => setDocSelection(doc, true)} disabled={saving} className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-800 disabled:opacity-40">Todas</button>
                              <button type="button" onClick={() => setDocSelection(doc, false)} disabled={saving} className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-800 disabled:opacity-40">Ninguna</button>
                            </>
                          )}
                          <button type="button" onClick={() => removeDoc(doc.id)} disabled={saving} className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-40">Quitar</button>
                        </div>
                      </div>

                      {doc.loading && <p className="py-4 text-center text-xs text-ink-400">Cargando páginas…</p>}
                      {doc.error && <p className="py-4 text-center text-xs text-red-400">{doc.error}</p>}
                      {!doc.loading && !doc.error && (
                        <div className="grid grid-cols-4 gap-2">
                          {doc.thumbs.map((t) => {
                            const isSel = selected.has(keyFor(doc.id, t.pageIndex));
                            return (
                              <button
                                type="button"
                                key={t.pageIndex}
                                onClick={() => toggle(doc.id, t.pageIndex)}
                                className={`relative flex flex-col overflow-hidden rounded border bg-ink-950 p-1 ${
                                  isSel ? 'border-accent-500 ring-1 ring-accent-500' : 'border-ink-700 hover:border-ink-500'
                                }`}
                                title={`Página ${t.pageIndex} · ${Math.round(t.widthMm)}×${Math.round(t.heightMm)} mm`}
                              >
                                <img src={t.dataUrl} alt={`Página ${t.pageIndex}`} className="h-28 w-full object-contain" />
                                <span className="mt-1 text-[10px] text-ink-300">Pág. {t.pageIndex}</span>
                                {isSel && (
                                  <span className="absolute right-1 top-1 rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">✓</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <aside className="flex flex-col border-l border-ink-700 bg-ink-900 p-4 text-xs text-ink-200">
                <div className="mb-3">
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-400">Formato</label>
                  <div className="flex overflow-hidden rounded border border-ink-700">
                    <button
                      type="button"
                      onClick={() => setFormat('image/jpeg')}
                      className={`flex-1 px-2 py-1 ${format === 'image/jpeg' ? 'bg-accent-600 text-white' : 'bg-ink-800 hover:bg-ink-700'}`}
                    >JPG</button>
                    <button
                      type="button"
                      onClick={() => setFormat('image/png')}
                      className={`flex-1 border-l border-ink-700 px-2 py-1 ${format === 'image/png' ? 'bg-accent-600 text-white' : 'bg-ink-800 hover:bg-ink-700'}`}
                    >PNG</button>
                  </div>
                </div>

                {format === 'image/jpeg' && (
                  <div className="mb-3">
                    <label className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-400">
                      <span>Calidad JPG</span>
                      <span className="text-ink-200">{quality}</span>
                    </label>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      value={quality}
                      onChange={(e) => setQuality(parseInt(e.target.value, 10))}
                      className="w-full accent-accent-500"
                    />
                  </div>
                )}

                <div className="mb-3">
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-400">Resolución (DPI)</label>
                  <div className="grid grid-cols-4 gap-1">
                    {DPI_OPTIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDpi(d)}
                        className={`rounded border px-1 py-1 text-[11px] ${
                          dpi === d ? 'border-accent-500 bg-accent-600 text-white' : 'border-ink-700 bg-ink-800 hover:bg-ink-700'
                        }`}
                      >{d}</button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="36"
                    max="1200"
                    step="1"
                    value={dpi}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v >= 36 && v <= 1200) setDpi(v);
                    }}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-center text-[11px] text-ink-100"
                    title="DPI personalizado (36–1200)"
                  />
                  <p className="mt-1 text-[10px] leading-snug text-ink-500">
                    72: pantalla · 150: borrador · 300: imprenta · 600: alta resolución
                  </p>
                </div>

                {firstThumb && (
                  <div className="mb-3 rounded border border-ink-700 bg-ink-800/50 p-2 text-[10px] text-ink-400">
                    <div className="text-ink-300">Tamaño aprox. (1ª página):</div>
                    <div className="mt-0.5">
                      {Math.round(firstThumb.widthMm * dpi / 25.4)}×{Math.round(firstThumb.heightMm * dpi / 25.4)} px
                    </div>
                  </div>
                )}

                <div className="mt-auto">
                  {savedSummary?.canceled === false && savedSummary?.saved > 0 && (
                    <div className="mb-2 rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
                      Guardadas {savedSummary.saved} imágenes
                      <button
                        type="button"
                        onClick={openSavedFolder}
                        className="ml-2 text-emerald-300 underline hover:text-emerald-100"
                      >
                        Abrir carpeta
                      </button>
                    </div>
                  )}
                  {savedSummary?.canceled === false && savedSummary?.errors?.length > 0 && (
                    <div className="mb-2 max-h-32 overflow-y-auto rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
                      <div className="font-medium">
                        {savedSummary.errors.length} error{savedSummary.errors.length === 1 ? '' : 'es'}:
                      </div>
                      {savedSummary.errors.slice(0, 5).map((e, i) => (
                        <div key={i} className="mt-0.5 truncate" title={`${e.name}: ${e.error}`}>
                          • {e.error}
                        </div>
                      ))}
                      {savedSummary.errors.length > 5 && (
                        <div className="mt-0.5">…y {savedSummary.errors.length - 5} más</div>
                      )}
                    </div>
                  )}
                  {savedSummary?.error && (
                    <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
                      {savedSummary.error}
                    </div>
                  )}
                  {saving && (
                    <div className="mb-2 text-[11px] text-ink-300">
                      Generando {saveProgress.done}/{saveProgress.total}…
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || selectedCount === 0 || anyLoading}
                    className="w-full rounded bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-40"
                  >
                    {saving ? 'Generando…' : `Guardar ${selectedCount || ''} ${selectedCount === 1 ? 'imagen' : 'imágenes'}`.trim()}
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
