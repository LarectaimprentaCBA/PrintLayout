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

export default function PdfToImageModal({ open, onClose }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [thumbs, setThumbs] = useState([]); // {pageIndex, dataUrl, widthMm, heightMm}
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [dpi, setDpi] = useState(() => loadStored(STORAGE_DPI, 300, (v) => parseInt(v, 10) || 300));
  const [format, setFormat] = useState(() => loadStored(STORAGE_FORMAT, 'image/jpeg'));
  const [quality, setQuality] = useState(() => loadStored(STORAGE_QUALITY, 92, (v) => parseInt(v, 10) || 92));
  const [selected, setSelected] = useState(() => new Set());
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
    setFile(null);
    setPdfBytes(null);
    setThumbs([]);
    setLoading(false);
    setLoadError(null);
    setSelected(new Set());
    setSaving(false);
    setSaveProgress({ done: 0, total: 0 });
    setSavedSummary(null);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const loadPdf = async (f) => {
    if (!f) return;
    setFile(f);
    setLoading(true);
    setLoadError(null);
    setThumbs([]);
    setSavedSummary(null);
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      setPdfBytes(bytes);
      // Thumbs rapidos a 72 DPI.
      const t = await rasterizePdfPagesAt(bytes, { dpi: 72, format: 'image/jpeg', quality: 0.75 });
      setThumbs(t);
      setSelected(new Set(t.map((p) => p.pageIndex)));
    } catch (err) {
      setLoadError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) loadPdf(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && /\.pdf$/i.test(f.name)) loadPdf(f);
  };

  const toggle = (idx) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(thumbs.map((t) => t.pageIndex)));
  const selectNone = () => setSelected(new Set());

  const formatExt = format === 'image/jpeg' ? 'jpg' : 'png';
  const selectedCount = selected.size;

  const handleSave = async () => {
    if (!pdfBytes || selectedCount === 0) return;
    setSaving(true);
    setSavedSummary(null);
    setSaveProgress({ done: 0, total: selectedCount });
    try {
      const indices = Array.from(selected).sort((a, b) => a - b);
      const pages = await rasterizePdfPagesAt(pdfBytes, {
        dpi,
        format,
        quality: quality / 100,
        pageIndices: indices,
        as: 'arraybuffer',
        onProgress: (done, total) => setSaveProgress({ done, total }),
      });
      const base = baseName(file?.name);
      const pageWidth = String(thumbs.length).length;
      const files = pages.map((p) => ({
        name: `${base}-p${pad(p.pageIndex, Math.max(2, pageWidth))}.${formatExt}`,
        buffer: p.buffer,
      }));
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
      // showItemInFolder espera un archivo; uso el primer archivo guardado si existe.
      window.printlayout.shell.showItem(savedSummary.dir);
    }
  };

  const gridCols = useMemo(() => {
    const n = thumbs.length;
    if (n <= 1) return 'grid-cols-1';
    if (n <= 4) return 'grid-cols-2';
    if (n <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  }, [thumbs.length]);

  if (!open) return null;

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
              Convertí las páginas de un PDF a JPG o PNG y guardalas en una carpeta.
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
          className="hidden"
          onChange={handlePick}
        />

        {!file && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="m-6 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-ink-700 p-12 text-center"
          >
            <p className="text-sm text-ink-300">Arrastrá un PDF acá</p>
            <p className="text-xs text-ink-500">o</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-500"
            >
              Elegir archivo PDF
            </button>
          </div>
        )}

        {file && (
          <>
            <div className="border-b border-ink-700 px-4 py-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate text-ink-200" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  onClick={reset}
                  disabled={saving}
                  className="ml-auto rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800 disabled:opacity-40"
                >
                  Cambiar archivo
                </button>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_18rem] gap-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4">
                {loading && (
                  <p className="py-8 text-center text-xs text-ink-400">Cargando páginas…</p>
                )}
                {loadError && (
                  <p className="py-8 text-center text-xs text-red-400">{loadError}</p>
                )}
                {!loading && thumbs.length > 0 && (
                  <>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-ink-300">
                        {thumbs.length} página{thumbs.length === 1 ? '' : 's'} · {selectedCount} seleccionada{selectedCount === 1 ? '' : 's'}
                      </span>
                      <div className="flex gap-1">
                        <button type="button" onClick={selectAll} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800">
                          Todas
                        </button>
                        <button type="button" onClick={selectNone} className="rounded border border-ink-700 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800">
                          Ninguna
                        </button>
                      </div>
                    </div>
                    <div className={`grid gap-2 ${gridCols}`}>
                      {thumbs.map((t) => {
                        const isSel = selected.has(t.pageIndex);
                        return (
                          <button
                            type="button"
                            key={t.pageIndex}
                            onClick={() => toggle(t.pageIndex)}
                            className={`relative flex flex-col overflow-hidden rounded border bg-ink-950 p-1 ${
                              isSel ? 'border-accent-500 ring-1 ring-accent-500' : 'border-ink-700 hover:border-ink-500'
                            }`}
                            title={`Página ${t.pageIndex} · ${Math.round(t.widthMm)}×${Math.round(t.heightMm)} mm`}
                          >
                            <img src={t.dataUrl} alt={`Página ${t.pageIndex}`} className="h-32 w-full object-contain" />
                            <span className="mt-1 text-[10px] text-ink-300">
                              Pág. {t.pageIndex}
                            </span>
                            {isSel && (
                              <span className="absolute right-1 top-1 rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
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

                {thumbs[0] && (
                  <div className="mb-3 rounded border border-ink-700 bg-ink-800/50 p-2 text-[10px] text-ink-400">
                    <div className="text-ink-300">Tamaño aproximado por página:</div>
                    <div className="mt-0.5">
                      {Math.round(thumbs[0].widthMm * dpi / 25.4)}×{Math.round(thumbs[0].heightMm * dpi / 25.4)} px
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
                    disabled={saving || selectedCount === 0 || loading}
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
