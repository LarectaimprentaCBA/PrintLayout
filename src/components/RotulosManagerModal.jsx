import { useCallback, useEffect, useRef, useState } from 'react';

// Gestor de "Rótulos escolares" — Fase 1: CARGAR.
//   · Tipografías: subir/validar/listar/eliminar fuentes .ttf/.otf.
//   · Modelos: cargar un PDF (grupos de 3 páginas: arte/corte/texto por tamaño),
//     ver los 3 artes con su caja de texto detectada, ajustarla a mano y guardar.
// NO genera nada (sin texto, sin plancha, sin corte, sin QR): eso va después.

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number.isFinite(n) ? (Math.round(n * 100) / 100) : '?');

const SIZE_LABELS = {
  grande: 'Grande (60 × 40 mm)',
  intermedio: 'Intermedio (40 × 20 mm)',
  chico: 'Chico (40 × 7 mm)',
};
const SIZE_ORDER = ['grande', 'intermedio', 'chico'];

// Editor de UNA imagen de arte con la caja de texto superpuesta (arrastrar/redimensionar).
function SizeArtEditor({ sizeKey, size, onChange }) {
  const dragRef = useRef(null);
  const DISP_W = 340;

  const arteMm = size?.arteMm;
  const cutMm = size?.cutMm;
  const tb = size?.textBox;
  if (!arteMm || !cutMm || !tb) return null;

  const scale = DISP_W / arteMm.w;
  const dispH = arteMm.h * scale;
  const offX = cutMm.x - arteMm.x; // demasía izquierda (≈1mm)
  const offY = cutMm.y - arteMm.y; // demasía arriba

  const boxLeftPx = (offX + tb.xFromLabelLeft) * scale;
  const boxTopPx = (offY + tb.yFromLabelTop) * scale;
  const boxWPx = tb.w * scale;
  const boxHPx = tb.h * scale;

  const cutLeftPx = offX * scale;
  const cutTopPx = offY * scale;
  const cutWPx = cutMm.w * scale;
  const cutHPx = cutMm.h * scale;

  const clamp = (nb) => {
    let { xFromLabelLeft, yFromLabelTop, w, h } = nb;
    w = Math.max(2, Math.min(w, cutMm.w));
    h = Math.max(1, Math.min(h, cutMm.h));
    xFromLabelLeft = Math.max(0, Math.min(xFromLabelLeft, cutMm.w - w));
    yFromLabelTop = Math.max(0, Math.min(yFromLabelTop, cutMm.h - h));
    return {
      xFromLabelLeft: round2(xFromLabelLeft),
      yFromLabelTop: round2(yFromLabelTop),
      w: round2(w),
      h: round2(h),
    };
  };

  const startDrag = (mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startBox: { ...tb } };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dxMm = (ev.clientX - d.startX) / scale;
      const dyMm = (ev.clientY - d.startY) / scale;
      if (d.mode === 'move') {
        onChange(clamp({
          xFromLabelLeft: d.startBox.xFromLabelLeft + dxMm,
          yFromLabelTop: d.startBox.yFromLabelTop + dyMm,
          w: d.startBox.w,
          h: d.startBox.h,
        }));
      } else {
        onChange(clamp({
          xFromLabelLeft: d.startBox.xFromLabelLeft,
          yFromLabelTop: d.startBox.yFromLabelTop,
          w: d.startBox.w + dxMm,
          h: d.startBox.h + dyMm,
        }));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const preview = size.arte?.previewB64;

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-100">{SIZE_LABELS[sizeKey] || sizeKey}</span>
        {!size.matched && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300" title="El tamaño medido no coincide con el fijo del sistema">
            ⚠ tamaño raro
          </span>
        )}
      </div>

      <div
        className="relative mx-auto select-none overflow-hidden rounded border border-ink-700 bg-white"
        style={{ width: `${DISP_W}px`, height: `${dispH}px` }}
      >
        {preview ? (
          <img src={preview} alt="" draggable={false} className="absolute inset-0 h-full w-full object-fill" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-500">
            (sin arte)
          </div>
        )}

        {/* Borde del rótulo (corte) */}
        <div
          className="pointer-events-none absolute border border-dashed border-sky-500/70"
          style={{ left: `${cutLeftPx}px`, top: `${cutTopPx}px`, width: `${cutWPx}px`, height: `${cutHPx}px` }}
        />

        {/* Caja de texto (arrastrable) */}
        <div
          onPointerDown={startDrag('move')}
          className="absolute cursor-move border-2 border-accent-500 bg-accent-500/20"
          style={{ left: `${boxLeftPx}px`, top: `${boxTopPx}px`, width: `${boxWPx}px`, height: `${boxHPx}px` }}
          title="Arrastrá para mover; tirá de la esquina para cambiar el tamaño"
        >
          <div
            onPointerDown={startDrag('resize')}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-white bg-accent-500"
          />
        </div>
      </div>

      <div className="mt-2 text-center text-[10px] text-ink-400">
        Caja del nombre: {fmt(tb.w)} × {fmt(tb.h)} mm · desde el rótulo x {fmt(tb.xFromLabelLeft)} / y {fmt(tb.yFromLabelTop)} mm
      </div>
    </div>
  );
}

export default function RotulosManagerModal({ open, onClose }) {
  const api = typeof window !== 'undefined' ? window.printlayout?.rotulos : null;

  const [tab, setTab] = useState('fuentes');
  const [fonts, setFonts] = useState([]);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind:'ok'|'err'|'info', text }

  // Editor de un modelo recién parseado (o re-cargado).
  const [parse, setParse] = useState(null); // { tmpDir, sizes, warnings }
  const [modelName, setModelName] = useState('');
  const [replaceId, setReplaceId] = useState(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const [f, m] = await Promise.all([api.fontsList(), api.modelsList()]);
    setFonts(Array.isArray(f) ? f : []);
    setModels(Array.isArray(m) ? m : []);
  }, [api]);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    refresh();
  }, [open, refresh]);

  const discardParse = useCallback(() => {
    if (parse?.tmpDir) { api?.modelDiscard(parse.tmpDir); }
    setParse(null);
    setModelName('');
    setReplaceId(null);
  }, [api, parse]);

  const handleClose = useCallback(() => {
    if (parse) discardParse();
    onClose?.();
  }, [parse, discardParse, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  if (!open) return null;

  // --- Tipografías ---
  const addFont = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await api.fontAdd();
      if (r?.canceled) return;
      if (r?.ok) {
        setFeedback({ kind: 'ok', text: `Fuente agregada: ${r.font.familia}` });
        await refresh();
      } else {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo agregar la fuente.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const removeFont = async (f) => {
    if (!window.confirm(`¿Eliminar la tipografía "${f.familia}"?`)) return;
    await api.fontRemove(f.id);
    await refresh();
  };

  // --- Modelos ---
  const parsePdf = async (forId = null, forName = '') => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await api.modelParse();
      if (r?.canceled) return;
      if (!r?.ok) {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo leer el PDF.' });
        return;
      }
      setParse({ tmpDir: r.tmpDir, sizes: r.sizes, warnings: r.warnings || [] });
      setModelName(forName || r.defaultName || 'Modelo');
      setReplaceId(forId);
      if (r.warnings?.length) {
        setFeedback({ kind: 'info', text: r.warnings.join(' ') });
      }
    } finally {
      setBusy(false);
    }
  };

  const updateBox = (sizeKey, newBox) => {
    setParse((prev) => (prev ? {
      ...prev,
      sizes: { ...prev.sizes, [sizeKey]: { ...prev.sizes[sizeKey], textBox: newBox } },
    } : prev));
  };

  const saveModel = async () => {
    if (!parse) return;
    setBusy(true);
    setFeedback(null);
    try {
      // Armar payload: solo lo necesario por tamaño + arte a copiar del tmp.
      const sizes = {};
      let thumb = null;
      for (const key of Object.keys(parse.sizes)) {
        const s = parse.sizes[key];
        sizes[key] = {
          artePath: s.arte?.path || null,
          ext: s.arte?.ext || null,
          wPx: s.arte?.wPx || null,
          hPx: s.arte?.hPx || null,
          cutMm: s.cutMm,
          arteMm: s.arteMm,
          textBox: s.textBox,
        };
        if (!thumb && (s.arte?.thumbB64 || s.arte?.previewB64)) {
          thumb = s.arte.thumbB64 || s.arte.previewB64;
        }
      }
      const r = await api.modelSave({
        id: replaceId || undefined,
        nombre: modelName.trim() || 'Modelo',
        thumb,
        tmpDir: parse.tmpDir,
        sizes,
      });
      if (r?.ok) {
        setParse(null);
        setModelName('');
        setReplaceId(null);
        setFeedback({ kind: 'ok', text: `Modelo guardado: ${r.model.nombre}` });
        await refresh();
      } else {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo guardar el modelo.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const removeModel = async (m) => {
    if (!window.confirm(`¿Eliminar el modelo "${m.nombre}"?`)) return;
    await api.modelRemove(m.id);
    await refresh();
  };

  const fbColor = feedback?.kind === 'ok' ? 'text-green-300'
    : feedback?.kind === 'err' ? 'text-red-300'
      : 'text-sky-300';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[56rem] max-w-[96vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Rótulos escolares</h3>
            <p className="mt-0.5 text-xs text-ink-400">
              Cargá las tipografías y los modelos de rótulo. La impresión de las planchas viene después.
            </p>
          </div>
          <div className="flex overflow-hidden rounded-md border border-ink-700 bg-ink-800">
            <button
              type="button"
              onClick={() => setTab('fuentes')}
              className={`px-3 py-1.5 text-xs ${tab === 'fuentes' ? 'bg-accent-600 text-white' : 'text-ink-200 hover:bg-ink-700'}`}
            >
              Tipografías
            </button>
            <button
              type="button"
              onClick={() => setTab('modelos')}
              className={`border-l border-ink-700 px-3 py-1.5 text-xs ${tab === 'modelos' ? 'bg-accent-600 text-white' : 'text-ink-200 hover:bg-ink-700'}`}
            >
              Modelos
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ---------------- TIPOGRAFÍAS ---------------- */}
          {tab === 'fuentes' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-ink-400">
                  Fuentes para escribir el nombre (ej: COCON). Se validan al subirlas.
                </span>
                <button
                  type="button"
                  onClick={addFont}
                  disabled={busy}
                  className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
                >
                  Subir fuente (.ttf/.otf)
                </button>
              </div>
              {fonts.length === 0 ? (
                <p className="rounded border border-dashed border-ink-700 py-8 text-center text-xs text-ink-500">
                  Todavía no hay tipografías. Subí una con el botón de arriba.
                </p>
              ) : (
                <ul className="divide-y divide-ink-800 rounded border border-ink-800">
                  {fonts.map((f) => (
                    <li key={f.id} className="flex items-center justify-between px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink-100" style={{ fontFamily: `"${f.familia}"` }}>
                          {f.familia}
                        </div>
                        <div className="text-[10px] uppercase text-ink-500">.{f.ext}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFont(f)}
                        className="rounded border border-ink-700 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                      >
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ---------------- MODELOS ---------------- */}
          {tab === 'modelos' && !parse && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-ink-400">
                  Cargá el PDF exportado de Corel (grupos de 3 páginas: arte, corte y texto por tamaño).
                </span>
                <button
                  type="button"
                  onClick={() => parsePdf()}
                  disabled={busy}
                  className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
                >
                  {busy ? 'Leyendo…' : 'Cargar modelo (PDF)…'}
                </button>
              </div>
              {models.length === 0 ? (
                <p className="rounded border border-dashed border-ink-700 py-8 text-center text-xs text-ink-500">
                  Todavía no hay modelos. Cargá uno con el botón de arriba.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-3">
                  {models.map((m) => {
                    const sizeKeys = SIZE_ORDER.filter((k) => m.sizes?.[k]);
                    return (
                      <li key={m.id} className="flex gap-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
                        <div className="h-16 w-24 shrink-0 overflow-hidden rounded border border-ink-700 bg-white">
                          {m.thumb ? (
                            <img src={m.thumb} alt="" className="h-full w-full object-contain" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] text-ink-500">sin arte</div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="truncate text-sm font-medium text-ink-100" title={m.nombre}>{m.nombre}</div>
                          <div className="mt-0.5 text-[11px] text-ink-400">
                            {sizeKeys.length} tamaño(s): {sizeKeys.join(' · ')}
                          </div>
                          <div className="mt-auto flex gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => parsePdf(m.id, m.nombre)}
                              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800"
                            >
                              Recargar PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => removeModel(m)}
                              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* ---------------- EDITOR DE MODELO (parse) ---------------- */}
          {tab === 'modelos' && parse && (
            <div>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <label className="text-xs text-ink-300">
                  <span className="mb-1 block">Nombre / número del modelo</span>
                  <input
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    className="w-64 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <p className="flex-1 text-[11px] text-ink-400">
                  Arrastrá la caja azul para ubicar dónde va el nombre; tirá de la esquina para
                  cambiar su tamaño. El recuadro punteado es el borde del rótulo (corte).
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {SIZE_ORDER.filter((k) => parse.sizes?.[k]).map((k) => (
                  <SizeArtEditor
                    key={k}
                    sizeKey={k}
                    size={parse.sizes[k]}
                    onChange={(nb) => updateBox(k, nb)}
                  />
                ))}
              </div>
            </div>
          )}

          {feedback && <p className={`mt-3 text-xs ${fbColor}`}>{feedback.text}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          {parse ? (
            <>
              <button
                type="button"
                onClick={discardParse}
                disabled={busy}
                className="mr-auto rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
              >
                Cancelar carga
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={saveModel}
                disabled={busy}
                className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
              >
                {busy ? 'Guardando…' : (replaceId ? 'Guardar cambios' : 'Guardar modelo')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
