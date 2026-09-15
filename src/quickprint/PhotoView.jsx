import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { PHOTO_SIZES, computeLayout } from './photoLayout.js';
import { loadPhoto } from './loadPhoto.js';
import { renderSheetToCanvas, canvasToPngArrayBuffer, paginate } from './sheetRender.js';

const PREVIEW_DPI = 110;
const PRINT_DPI = 240;

export default function PhotoView({ files, deviceName, pageInfo, busy, setBusy, onDone, onCancel, hasPdfQueue }) {
  const [photos, setPhotos] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: files.length });
  const [loading, setLoading] = useState(true);
  const [sizeKey, setSizeKey] = useState('10x15');
  const [framed, setFramed] = useState(true);
  const [copies, setCopies] = useState(1);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [prepMsg, setPrepMsg] = useState('');
  const [toast, setToast] = useState(null);
  const previewRef = useRef(null);

  // Cargar todas las fotos, cediendo el hilo entre cada una (no congela) y
  // mostrando progreso. Detecta caras (para el recorte con foco).
  useEffect(() => {
    let dead = false;
    (async () => {
      const out = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const p = await loadPhoto(files[i], { detectarCaras: true });
          if (dead) return;
          out.push(p);
        } catch (err) {
          console.warn('[quickprint] no se pudo cargar', files[i]?.name, err);
        }
        setProgress({ done: i + 1, total: files.length });
        await new Promise((r) => setTimeout(r, 0));
      }
      if (dead) return;
      setPhotos(out);
      setLoading(false);
    })();
    return () => { dead = true; };
  }, [files]);

  const printWmm = pageInfo?.printWmm || 0;
  const printHmm = pageInfo?.printHmm || 0;

  const layout = useMemo(
    () => (printWmm > 0 ? computeLayout(sizeKey, printWmm, printHmm) : null),
    [sizeKey, printWmm, printHmm],
  );

  // Fotos expandidas por copias.
  const expanded = useMemo(() => {
    const n = Math.max(1, Math.min(99, copies | 0));
    const arr = [];
    for (const p of photos) for (let k = 0; k < n; k++) arr.push(p);
    return arr;
  }, [photos, copies]);

  const sheets = useMemo(
    () => (layout ? paginate(expanded, layout.perSheet) : []),
    [expanded, layout],
  );

  useEffect(() => { if (sheetIdx >= sheets.length) setSheetIdx(0); }, [sheets.length, sheetIdx]);

  // Redibujar el preview de la hoja actual.
  useEffect(() => {
    if (!previewRef.current || !layout || !sheets.length) return;
    const sheet = sheets[sheetIdx] || [];
    renderSheetToCanvas(previewRef.current, sheet, layout, printWmm, printHmm, PREVIEW_DPI, framed);
  }, [previewRef, layout, sheets, sheetIdx, framed, printWmm, printHmm]);

  const perSheetFor = useCallback((key) => {
    if (!(printWmm > 0)) return null;
    return computeLayout(key, printWmm, printHmm).perSheet;
  }, [printWmm, printHmm]);

  const doPrint = async () => {
    if (!deviceName || !layout || !photos.length) return;
    setBusy(true);
    setToast(null);
    const t0 = performance.now();
    let sessionId = null;
    try {
      const begin = await window.printlayout.quickprint.photosBegin();
      if (!begin?.ok) { setToast('No se pudo iniciar la impresión.'); setBusy(false); return; }
      sessionId = begin.id;
      const canvas = document.createElement('canvas');
      let firstMs = null;
      // Armamos y ENVIAMOS cada hoja apenas está lista (memoria plana, no congela).
      for (let i = 0; i < sheets.length; i++) {
        setPrepMsg(`Preparando hoja ${i + 1} de ${sheets.length}…`);
        renderSheetToCanvas(canvas, sheets[i], layout, printWmm, printHmm, PRINT_DPI, framed);
        const ab = await canvasToPngArrayBuffer(canvas);
        await window.printlayout.quickprint.photosAdd(sessionId, ab);
        if (firstMs === null) firstMs = performance.now() - t0;
        await new Promise((r) => setTimeout(r, 0)); // ceder el hilo
      }
      setPrepMsg('Enviando a la impresora…');
      const res = await window.printlayout.quickprint.photosPrint(sessionId, {
        pageWidthMm: printWmm,
        pageHeightMm: printHmm,
        deviceName,
        copies: 1,
        docName: `Fotos (${expanded.length})`,
      });
      sessionId = null; // photosPrint ya limpió la sesión
      const totalMs = Math.round(performance.now() - t0);
      console.log(`[quickprint] fotos=${expanded.length} hojas=${sheets.length} 1raHoja=${Math.round(firstMs)}ms total=${totalMs}ms`);
      setPrepMsg('');
      if (res?.ok) {
        onDone();
      } else if (res?.canceled) {
        setBusy(false);
      } else {
        setToast(`No se pudo imprimir: ${res?.error || 'error'}`);
        setBusy(false);
      }
    } catch (err) {
      if (sessionId) { try { await window.printlayout.quickprint.photosCancel(sessionId); } catch (_) {} }
      setPrepMsg('');
      setToast(`No se pudo imprimir: ${err.message}`);
      setBusy(false);
    }
  };

  const previewAspect = printHmm > 0 ? printWmm / printHmm : 0.7;

  return (
    <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      {/* Preview */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ opacity: 0.8 }}>Preparando fotos… {progress.done}/{progress.total}</div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {photos.length} foto{photos.length === 1 ? '' : 's'}
            {copies > 1 ? ` × ${copies} copias` : ''} · {sheets.length} hoja{sheets.length === 1 ? '' : 's'}
          </div>
        )}
        <div style={previewBox}>
          <canvas
            ref={previewRef}
            style={{ maxWidth: '100%', maxHeight: '52vh', aspectRatio: String(previewAspect), background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,.5)' }}
          />
        </div>
        {sheets.length > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
            <button style={navBtn} disabled={sheetIdx === 0} onClick={() => setSheetIdx((i) => Math.max(0, i - 1))}>◀</button>
            <span style={{ fontSize: 12 }}>Hoja {sheetIdx + 1} de {sheets.length}</span>
            <button style={navBtn} disabled={sheetIdx >= sheets.length - 1} onClick={() => setSheetIdx((i) => Math.min(sheets.length - 1, i + 1))}>▶</button>
          </div>
        )}
      </div>

      {/* Controles */}
      <div style={{ width: 210, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={label}>Tamaño</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PHOTO_SIZES.map((s) => {
              const per = perSheetFor(s.key);
              const active = s.key === sizeKey;
              return (
                <button
                  key={s.key}
                  onClick={() => setSizeKey(s.key)}
                  disabled={busy}
                  style={{ ...sizeBtn, ...(active ? sizeBtnActive : {}) }}
                >
                  <span>{s.label}</span>
                  {per != null && <span style={{ opacity: 0.7, fontSize: 11 }}>{per}/hoja</span>}
                </button>
              );
            })}
          </div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={framed} onChange={(e) => setFramed(e.target.checked)} disabled={busy} />
          Enmarcar la imagen
        </label>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: -6 }}>
          {framed ? 'La foto llena el recuadro (recorta, con foco en caras).' : 'La foto entra entera dentro del recuadro.'}
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          Copias de cada imagen:
          <input
            type="number" min={1} max={99} value={copies} disabled={busy}
            onChange={(e) => setCopies(Math.max(1, Math.min(99, parseInt(e.target.value || '1', 10))))}
            style={numInput}
          />
        </label>

        <div style={{ flex: 1 }} />
        {prepMsg && <div style={{ fontSize: 12, opacity: 0.8 }}>{prepMsg}</div>}
        {toast && <div style={{ fontSize: 12, color: '#fca5a5' }}>{toast}</div>}
        <button style={printBtn} onClick={doPrint} disabled={busy || loading || !layout || !photos.length || !deviceName}>
          {busy ? 'Imprimiendo…' : 'Imprimir'}
        </button>
        <button style={cancelBtn} onClick={onCancel} disabled={busy}>
          {hasPdfQueue ? 'Saltar a los PDF' : 'Cancelar'}
        </button>
      </div>
    </div>
  );
}

const previewBox = {
  flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#15181d', borderRadius: 8, padding: 10,
};
const label = { fontSize: 12, opacity: 0.7, marginBottom: 6 };
const sizeBtn = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  background: '#1a1d22', color: '#e5e7eb', border: '1px solid #333',
  borderRadius: 6, padding: '7px 10px', fontSize: 13, cursor: 'pointer',
};
const sizeBtnActive = { border: '1px solid #2563eb', background: '#1e293b' };
const numInput = {
  width: 56, background: '#1a1d22', color: '#e5e7eb', border: '1px solid #333',
  borderRadius: 6, padding: '4px 6px', fontSize: 13,
};
const navBtn = {
  background: '#1a1d22', color: '#e5e7eb', border: '1px solid #333',
  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
};
const printBtn = {
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6,
  padding: '10px 14px', fontSize: 14, cursor: 'pointer', fontWeight: 600,
};
const cancelBtn = {
  background: 'transparent', color: '#9ca3af', border: '1px solid #333',
  borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
};
