import React, { useEffect, useRef, useState, useCallback } from 'react';

const PREVIEW_DPI = 96;

// Parsea "1-3,5" a lista de páginas (1-based), acotada a [1,count].
function parseRange(str, count) {
  const out = new Set();
  for (const part of String(str || '').split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && (!count || i <= count)) out.add(i);
    } else {
      const n = parseInt(part.trim(), 10);
      if (Number.isFinite(n) && n >= 1 && (!count || n <= count)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

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

export default function PdfView({ files, deviceName, pageInfo, busy, setBusy, onDone }) {
  const [idx, setIdx] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewInfo, setPreviewInfo] = useState(null); // {wMm,hMm}
  const [previewErr, setPreviewErr] = useState('');
  const [copies, setCopies] = useState(1);
  const [pagesMode, setPagesMode] = useState('all'); // all|current|range
  const [rangeStr, setRangeStr] = useState('');
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
    setPagesMode('all'); setRangeStr(''); previewCache.current = new Map();
    if (!current) return;
    let dead = false;
    window.printlayout.quickprint.pdfInfo(current.path).then((r) => {
      if (dead) return;
      setPageCount(r && r.ok ? r.pageCount : 0);
    });
    return () => { dead = true; };
  }, [current]);

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

    // Área imprimible (línea de puntos, tenue).
    const mL = (pageInfo?.marginLmm || 0) * pxPerMm;
    const mT = (pageInfo?.marginTmm || 0) * pxPerMm;
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.strokeRect(mL, mT, printW * pxPerMm, printH * pxPerMm);
    ctx.setLineDash([]);

    // Tamaño de dibujo del diseño según el modo (misma fórmula que la impresión).
    const rot = rotFor(pageImg.wMm, pageImg.hMm);
    let ew = pageImg.wMm, eh = pageImg.hMm;
    if (rot) { ew = pageImg.hMm; eh = pageImg.wMm; }
    let twMm, thMm;
    if (sizeMode === 'actual') { twMm = ew; thMm = eh; }
    else if (sizeMode === 'custom') { const s = (Number(scalePct) || 100) / 100; twMm = ew * s; thMm = eh * s; }
    else if (sizeMode === 'fitlarge') { const f = Math.min(printW / ew, printH / eh, 1); twMm = ew * f; thMm = eh * f; }
    else { const f = Math.min(printW / ew, printH / eh); twMm = ew * f; thMm = eh * f; } // fit
    const targetWpx = twMm * pxPerMm, targetHpx = thMm * pxPerMm;

    ctx.save();
    ctx.translate(sheetWpx / 2, sheetHpx / 2); // centrado en la hoja física
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    const boxW = (rot === 90 || rot === 270) ? targetHpx : targetWpx;
    const boxH = (rot === 90 || rot === 270) ? targetWpx : targetHpx;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pageImg.img, -boxW / 2, -boxH / 2, boxW, boxH);
    ctx.restore();
  }, [pageImg, sizeMode, scalePct, orientation, pageInfo, rotFor]);

  // Escala que se aplicará (para el texto "Escala: N%").
  const scaleShownPct = (() => {
    if (!previewInfo || !(printWmm > 0)) return null;
    const rot = rotFor(previewInfo.wMm, previewInfo.hMm);
    let ew = previewInfo.wMm, eh = previewInfo.hMm;
    if (rot) { ew = previewInfo.hMm; eh = previewInfo.wMm; }
    if (sizeMode === 'actual') return 100;
    if (sizeMode === 'custom') return Math.round(scalePct);
    if (sizeMode === 'fitlarge') return Math.round(Math.min(printWmm / ew, printHmm / eh, 1) * 100);
    return Math.round(Math.min(printWmm / ew, printHmm / eh) * 100); // fit
  })();

  const wantedPages = () => {
    if (pagesMode === 'current') return [previewPage];
    if (pagesMode === 'range') return parseRange(rangeStr, pageCount);
    return null; // todas
  };

  const nextPdf = () => {
    if (idx + 1 < files.length) { setIdx(idx + 1); setToast(null); }
    else onDone();
  };

  const doPrint = async () => {
    if (!current || !deviceName) return;
    const pages = wantedPages();
    if (pagesMode === 'range' && (!pages || !pages.length)) { setToast('El rango de páginas no es válido.'); return; }
    setBusy(true); setToast(null);
    try {
      const res = await window.printlayout.quickprint.printPdf({
        path: current.path,
        pages, dpi: 240,
        sizeMode, scalePct, orientation,
        deviceName, copies,
        docName: `PDF: ${current.name}`,
      });
      setBusy(false);
      if (res?.ok) nextPdf();
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
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13 }}>
          {files.length > 1 ? `PDF ${idx + 1} de ${files.length} — ` : ''}
          <strong>{current.name}</strong>
        </div>
        <div style={previewBox}>
          {previewErr
            ? <div style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center', padding: 20 }}>{previewErr}</div>
            : <canvas ref={previewRef} style={{ maxWidth: '100%', maxHeight: '48vh', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,.5)' }} />}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
          {pageCount > 1 && (
            <>
              <button style={navBtn} disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}>◀</button>
              <span>Página {previewPage}{pageCount ? ` de ${pageCount}` : ''}</span>
              <button style={navBtn} disabled={pageCount && previewPage >= pageCount} onClick={() => setPreviewPage((p) => (pageCount ? Math.min(pageCount, p + 1) : p + 1))}>▶</button>
            </>
          )}
          {previewInfo && <span style={{ opacity: 0.7 }}>Hoja del PDF: {Math.round(previewInfo.wMm)}×{Math.round(previewInfo.hMm)} mm</span>}
          {scaleShownPct != null && <span style={{ opacity: 0.7 }}>Escala: {scaleShownPct}%</span>}
        </div>
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
        <button style={printBtn} onClick={doPrint} disabled={busy || !deviceName}>
          {busy ? 'Imprimiendo…' : 'Imprimir'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {files.length > 1 && <button style={cancelBtn} onClick={nextPdf} disabled={busy}>Saltear</button>}
          <button style={cancelBtn} onClick={onDone} disabled={busy}>{files.length > 1 ? 'Cancelar todo' : 'Cancelar'}</button>
        </div>
      </div>
    </div>
  );
}

const previewBox = {
  flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#15181d', borderRadius: 8, padding: 10,
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
