import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { calcTamano, recortes, filtrarSubset, parseRange } from './pdfLayout.js';

const PREVIEW_DPI = 96;

const SIZE_MODES = [
  { key: 'fit', label: 'Ajustar' },
  { key: 'actual', label: 'Tamaño real' },
  { key: 'fitlarge', label: 'Ajustar páginas grandes' },
  { key: 'custom', label: 'Escala personalizada' },
];
const ORIENTS = [
  { key: 'auto', label: 'Automática' },
  { key: 'vertical', label: 'Vertical' },
  { key: 'horizontal', label: 'Horizontal' },
];
const SUBSETS = [
  { key: 'all', label: 'Todas' },
  { key: 'odd', label: 'Solo impares' },
  { key: 'even', label: 'Solo pares' },
];

const mm1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

export default function PdfView({ files, deviceName, pageInfo, busy, setBusy, onDone }) {
  const [idx, setIdx] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewInfo, setPreviewInfo] = useState(null); // {wMm,hMm}
  const [previewErr, setPreviewErr] = useState('');
  const [copies, setCopies] = useState(1);
  const [pagesMode, setPagesMode] = useState('all'); // all|current|range
  const [rangeStr, setRangeStr] = useState('');
  const [subset, setSubset] = useState('all'); // all|odd|even
  const [sent, setSent] = useState(null); // aviso verde: se envió y la ventana sigue abierta
  const [sizeMode, setSizeMode] = useState('fit');
  const [scalePct, setScalePct] = useState(100);
  const [orientation, setOrientation] = useState('auto');
  const [toast, setToast] = useState(null);
  const [pageImg, setPageImg] = useState(null); // { img, wMm, hMm } de la página actual
  const previewRef = useRef(null);
  const previewCache = useRef(new Map()); // pageIndex -> {dataUrl,wMm,hMm}

  const current = files[idx];
  const printWmm = pageInfo?.printWmm || 0;
  const printHmm = pageInfo?.printHmm || 0;
  const sheetLandscape = printWmm > printHmm;

  // Al cambiar de PDF: reset + contar páginas.
  useEffect(() => {
    setPageCount(0); setPreviewPage(1); setPreviewInfo(null); setPreviewErr('');
    setPagesMode('all'); setRangeStr(''); setSubset('all'); setSent(null);
    previewCache.current = new Map();
    if (!current) return;
    let dead = false;
    window.printlayout.quickprint.pdfInfo(current.path).then((r) => {
      if (dead) return;
      setPageCount(r && r.ok ? r.pageCount : 0);
    });
    return () => { dead = true; };
  }, [current]);

  // Páginas que se van a imprimir, con el filtro de impares/pares aplicado.
  // La vista previa recorre SOLO estas, así se ve exactamente lo que va a salir.
  const paginasElegidas = useMemo(() => {
    if (!pageCount) return [];
    let base;
    if (pagesMode === 'current') base = [previewPage];
    else if (pagesMode === 'range') base = parseRange(rangeStr, pageCount);
    else base = Array.from({ length: pageCount }, (_, i) => i + 1);
    return filtrarSubset(base, subset);
  }, [pagesMode, rangeStr, subset, pageCount, previewPage]);

  // En modo "página actual" hay que poder recorrer TODAS para elegir cuál.
  const paginasVista = useMemo(() => {
    if (pagesMode === 'current' || !paginasElegidas.length) {
      return pageCount ? Array.from({ length: pageCount }, (_, i) => i + 1) : [];
    }
    return paginasElegidas;
  }, [pagesMode, paginasElegidas, pageCount]);

  // Si la página que se está mirando ya no está en la selección, saltar a la primera.
  useEffect(() => {
    if (!paginasVista.length) return;
    if (!paginasVista.includes(previewPage)) setPreviewPage(paginasVista[0]);
  }, [paginasVista, previewPage]);

  const posVista = paginasVista.indexOf(previewPage);
  const irVista = (d) => {
    if (posVista < 0) return;
    const n = paginasVista[posVista + d];
    if (n) setPreviewPage(n);
  };

  // Render del preview de la página actual (con Ghostscript, baja resolución).
  const rotFor = useCallback((wMm, hMm) => {
    const pageLandscape = wMm > hMm;
    if (orientation === 'vertical' && pageLandscape) return 90;
    if (orientation === 'horizontal' && !pageLandscape) return 90;
    if (orientation === 'auto' && pageLandscape !== sheetLandscape) return 90;
    return 0;
  }, [orientation, sheetLandscape]);

  // 1) Traer la IMAGEN de la página actual (Ghostscript, baja resolución). Cachea.
  useEffect(() => {
    if (!current) return;
    let dead = false;
    setPageImg(null);
    (async () => {
      setPreviewErr('');
      let entry = previewCache.current.get(previewPage);
      if (!entry) {
        const r = await window.printlayout.quickprint.renderPdfPage(current.path, previewPage, PREVIEW_DPI);
        if (dead) return;
        if (!r || !r.ok) { setPreviewErr(r?.error || 'No se pudo mostrar esta página.'); return; }
        entry = { dataUrl: r.dataUrl, wMm: r.wMm, hMm: r.hMm };
        previewCache.current.set(previewPage, entry);
      }
      setPreviewInfo({ wMm: entry.wMm, hMm: entry.hMm });
      const img = new Image();
      img.onload = () => { if (!dead) setPageImg({ img, wMm: entry.wMm, hMm: entry.hMm }); };
      img.src = entry.dataUrl;
    })();
    return () => { dead = true; };
  }, [current, previewPage]);

  // 2) Dibujar la HOJA (tamaño real de la impresora) con el diseño posicionado y a
  // la escala del modo elegido. Se re-dibuja al cambiar tamaño/orientación/escala,
  // así se ve EN VIVO cómo va a salir. El área imprimible va marcada con línea de
  // puntos; el diseño se centra en la hoja física (igual que la impresión).
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !pageImg) return;
    const pxPerMm = PREVIEW_DPI / 25.4;
    const paperW = pageInfo?.paperWmm || pageImg.wMm;
    const paperH = pageInfo?.paperHmm || pageImg.hMm;
    const printW = pageInfo?.printWmm || paperW;
    const printH = pageInfo?.printHmm || paperH;
    const sheetWpx = Math.max(1, Math.round(paperW * pxPerMm));
    const sheetHpx = Math.max(1, Math.round(paperH * pxPerMm));
    canvas.width = sheetWpx; canvas.height = sheetHpx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sheetWpx, sheetHpx);

    // Esquina del área imprimible (el margen que la impresora no alcanza).
    const mL = (pageInfo?.marginLmm || 0) * pxPerMm;
    const mT = (pageInfo?.marginTmm || 0) * pxPerMm;

    // Tamaño de dibujo del diseño según el modo (misma fórmula que la impresión).
    const rot = rotFor(pageImg.wMm, pageImg.hMm);
    const { twMm, thMm } = calcTamano({
      wMm: pageImg.wMm, hMm: pageImg.hMm, rot, printW, printH, sizeMode, scalePct,
    });
    const targetWpx = twMm * pxPerMm, targetHpx = thMm * pxPerMm;

    ctx.save();
    ctx.translate(sheetWpx / 2, sheetHpx / 2); // centrado en la hoja física
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    const boxW = (rot === 90 || rot === 270) ? targetHpx : targetWpx;
    const boxH = (rot === 90 || rot === 270) ? targetWpx : targetHpx;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pageImg.img, -boxW / 2, -boxH / 2, boxW, boxH);
    ctx.restore();

    // Lo que queda FUERA del área imprimible no sale: lo tapamos en rojo tenue
    // para que se entienda de una que lo corta la impresora, no la app.
    ctx.save();
    ctx.fillStyle = 'rgba(220,38,38,.28)';
    ctx.beginPath();
    ctx.rect(0, 0, sheetWpx, sheetHpx);
    ctx.rect(mL, mT, printW * pxPerMm, printH * pxPerMm);
    ctx.fill('evenodd');
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(mL, mT, printW * pxPerMm, printH * pxPerMm);
    ctx.setLineDash([]);
  }, [pageImg, sizeMode, scalePct, orientation, pageInfo, rotFor]);

  // Escala que se aplicará (para el texto "Escala: N%") y cuánto se corta.
  const medidas = useMemo(() => {
    if (!previewInfo || !(printWmm > 0)) return null;
    const rot = rotFor(previewInfo.wMm, previewInfo.hMm);
    const { ew, eh, twMm, thMm, factor } = calcTamano({
      wMm: previewInfo.wMm, hMm: previewInfo.hMm, rot,
      printW: printWmm, printH: printHmm, sizeMode, scalePct,
    });
    const cortes = recortes({
      twMm, thMm,
      paperW: pageInfo?.paperWmm || twMm, paperH: pageInfo?.paperHmm || thMm,
      printW: printWmm, printH: printHmm,
      marginL: pageInfo?.marginLmm || 0, marginT: pageInfo?.marginTmm || 0,
    });
    return { rot, ew, eh, twMm, thMm, pct: Math.round(factor * 100), cortes };
  }, [previewInfo, printWmm, printHmm, sizeMode, scalePct, pageInfo, rotFor]);
  const scaleShownPct = medidas ? medidas.pct : null;

  const nextPdf = () => {
    if (idx + 1 < files.length) { setIdx(idx + 1); setToast(null); setSent(null); }
    else onDone();
  };

  const doPrint = async () => {
    if (!current || !deviceName) return;
    const pages = paginasElegidas;
    if (!pages.length) {
      setToast(pagesMode === 'range'
        ? 'El rango de páginas no es válido.'
        : 'Con ese filtro no queda ninguna página.');
      return;
    }
    setBusy(true); setToast(null); setSent(null);
    try {
      const res = await window.printlayout.quickprint.printPdf({
        path: current.path,
        pages, dpi: 240,
        sizeMode, scalePct, orientation,
        deviceName, copies,
        docName: `PDF: ${current.name}`,
      });
      setBusy(false);
      // La ventana NO se cierra: queda lista para mandar otra tanda (típico
      // del doble faz a mano: primero las impares, después las pares).
      if (res?.ok) setSent(`Enviado: ${pages.length} ${pages.length === 1 ? 'página' : 'páginas'}${copies > 1 ? ` × ${copies} copias` : ''}.`);
      else if (res?.canceled) { /* nada */ }
      else setToast(`No se pudo imprimir: ${res?.error || 'error'}`);
    } catch (err) {
      setBusy(false);
      setToast(`No se pudo imprimir: ${err.message}`);
    }
  };

  if (!current) return null;

  return (
    <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      {/* Preview */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13 }}>
          {files.length > 1 ? `PDF ${idx + 1} de ${files.length} — ` : ''}
          <strong>{current.name}</strong>
        </div>
        <div style={previewBox}>
          {previewErr
            ? <div style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', padding: 20 }}>{previewErr}</div>
            : !pageImg
              ? <div style={{ color: '#9ca3af', fontSize: 13 }}>Generando vista previa…</div>
              : <canvas ref={previewRef} style={{ maxWidth: '100%', maxHeight: '100%', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,.5)' }} />}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', fontSize: 12, flexWrap: 'wrap' }}>
          {paginasVista.length > 1 && (
            <>
              <button style={navBtn} disabled={posVista <= 0} onClick={() => irVista(-1)}>◀</button>
              <span>
                Página {previewPage}{pageCount ? ` de ${pageCount}` : ''}
                {pagesMode !== 'current' && paginasVista.length < pageCount && (
                  <span style={{ opacity: 0.7 }}> · {posVista + 1}ª de {paginasVista.length} a imprimir</span>
                )}
              </span>
              <button style={navBtn} disabled={posVista < 0 || posVista >= paginasVista.length - 1} onClick={() => irVista(1)}>▶</button>
            </>
          )}
          {previewInfo && <span style={{ opacity: 0.7 }}>Hoja del PDF: {Math.round(previewInfo.wMm)}×{Math.round(previewInfo.hMm)} mm</span>}
          {scaleShownPct != null && <span style={{ opacity: 0.7 }}>Escala: {scaleShownPct}%</span>}
        </div>

        {medidas?.cortes.hay && (
          <div style={cutBox}>
            <b>La impresora no llega al borde de la hoja.</b> A esta hoja no le entra
            todo el diseño: lo rojo de la vista previa no se imprime.
            <div style={{ marginTop: 4 }}>
              Diseño {mm1(medidas.twMm)}×{mm1(medidas.thMm)} mm · entra{' '}
              {mm1(printWmm)}×{mm1(printHmm)} mm · se corta{' '}
              {[
                medidas.cortes.izq > 0.05 ? `${mm1(medidas.cortes.izq)} izq` : null,
                medidas.cortes.der > 0.05 ? `${mm1(medidas.cortes.der)} der` : null,
                medidas.cortes.arr > 0.05 ? `${mm1(medidas.cortes.arr)} arriba` : null,
                medidas.cortes.aba > 0.05 ? `${mm1(medidas.cortes.aba)} abajo` : null,
              ].filter(Boolean).join(' · ')} mm.
            </div>
            {sizeMode !== 'fit' && (
              <div style={{ marginTop: 4 }}>
                Para que entre todo, elegí <b>Ajustar</b> (sale al {medidas.ew > 0
                  ? Math.round(Math.min(printWmm / medidas.ew, printHmm / medidas.eh) * 100) : 100}%)
                o usá una hoja más grande.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controles */}
      <div style={{ width: 230, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        <div>
          <div style={label}>Páginas</div>
          <label style={radio}><input type="radio" checked={pagesMode === 'all'} onChange={() => setPagesMode('all')} disabled={busy} /> Todas{pageCount ? ` (${pageCount})` : ''}</label>
          <label style={radio}><input type="radio" checked={pagesMode === 'current'} onChange={() => setPagesMode('current')} disabled={busy} /> Página actual ({previewPage})</label>
          <label style={radio}><input type="radio" checked={pagesMode === 'range'} onChange={() => setPagesMode('range')} disabled={busy} /> Rango</label>
          {pagesMode === 'range' && (
            <input value={rangeStr} onChange={(e) => setRangeStr(e.target.value)} placeholder="ej. 1-3,5" disabled={busy} style={{ ...numInput, width: '100%', marginTop: 4 }} />
          )}
          {pagesMode !== 'current' && (
            <select value={subset} onChange={(e) => setSubset(e.target.value)} disabled={busy}
              title="Para hacer doble faz a mano: primero las impares, después las pares."
              style={{ ...numInput, width: '100%', marginTop: 6 }}>
              {SUBSETS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
            {paginasElegidas.length
              ? `Se imprimen ${paginasElegidas.length} ${paginasElegidas.length === 1 ? 'página' : 'páginas'}.`
              : 'No queda ninguna página con esta selección.'}
          </div>
        </div>

        <div>
          <div style={label}>Tamaño</div>
          {SIZE_MODES.map((m) => (
            <label key={m.key} style={radio}>
              <input type="radio" checked={sizeMode === m.key} onChange={() => setSizeMode(m.key)} disabled={busy} /> {m.label}
            </label>
          ))}
          {sizeMode === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <input type="number" min={10} max={400} value={scalePct} disabled={busy}
                onChange={(e) => setScalePct(Math.max(10, Math.min(400, parseInt(e.target.value || '100', 10))))}
                style={{ ...numInput, width: 64 }} /> %
            </div>
          )}
        </div>

        <div>
          <div style={label}>Orientación</div>
          {ORIENTS.map((o) => (
            <label key={o.key} style={radio}>
              <input type="radio" checked={orientation === o.key} onChange={() => setOrientation(o.key)} disabled={busy} /> {o.label}
            </label>
          ))}
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          Copias:
          <input type="number" min={1} max={99} value={copies} disabled={busy}
            onChange={(e) => setCopies(Math.max(1, Math.min(99, parseInt(e.target.value || '1', 10))))}
            style={{ ...numInput, width: 56 }} />
        </label>
        {pageInfo?.duplex && <div style={{ fontSize: 11, opacity: 0.6 }}>Doble faz: sí (según “Configurar impresora”).</div>}

        <div style={{ flex: 1 }} />
        {toast && <div style={{ fontSize: 12, color: '#fca5a5' }}>{toast}</div>}
        {sent && (
          <div style={{ fontSize: 12, color: '#86efac' }}>
            ✓ {sent} La ventana queda abierta para mandar otra tanda.
          </div>
        )}
        <button style={printBtn} onClick={doPrint} disabled={busy || !deviceName || !paginasElegidas.length}>
          {busy ? 'Imprimiendo…' : 'Imprimir'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {idx + 1 < files.length && <button style={cancelBtn} onClick={nextPdf} disabled={busy}>Siguiente PDF ▶</button>}
          <button style={cancelBtn} onClick={onDone} disabled={busy}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

const previewBox = {
  flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#15181d', borderRadius: 8, padding: 10,
};
const cutBox = {
  background: '#3b1a1a', color: '#fecaca', border: '1px solid #7f1d1d',
  borderRadius: 6, padding: '8px 10px', fontSize: 12, lineHeight: 1.4,
};
const label = { fontSize: 12, opacity: 0.7, marginBottom: 4 };
const radio = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '2px 0' };
const numInput = {
  background: '#1a1d22', color: '#e5e7eb', border: '1px solid #333',
  borderRadius: 6, padding: '4px 6px', fontSize: 13,
};
const navBtn = {
  background: '#1a1d22', color: '#e5e7eb', border: '1px solid #333',
  borderRadius: 6, padding: '2px 10px', cursor: 'pointer',
};
const printBtn = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
  padding: '10px 14px', fontSize: 14, cursor: 'pointer', fontWeight: 600,
};
const cancelBtn = {
  flex: 1, background: 'transparent', color: '#9ca3af', border: '1px solid #333',
  borderRadius: 6, padding: '8px 12px', fontSize: 13, cursor: 'pointer',
};
