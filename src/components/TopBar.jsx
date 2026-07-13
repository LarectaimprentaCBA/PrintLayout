import { useEffect, useRef, useState } from 'react';
import ConfirmModal from './ConfirmModal.jsx';

function fmtMm(n) {
  if (!Number.isFinite(n)) return '?';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function PaperSizeControl({ template, customPaper, onChange }) {
  const tpW = template?.pageWidthMm ?? 0;
  const tpH = template?.pageHeightMm ?? 0;
  const isCustom = !!customPaper;
  const dispW = isCustom ? customPaper.widthMm : tpW;
  const dispH = isCustom ? customPaper.heightMm : tpH;

  const [open, setOpen] = useState(false);
  const [draftW, setDraftW] = useState(String(dispW));
  const [draftH, setDraftH] = useState(String(dispH));
  const rootRef = useRef(null);

  // Sync drafts cuando cambia tamano externo (cambio de plantilla, etc.).
  useEffect(() => {
    setDraftW(String(dispW));
    setDraftH(String(dispH));
  }, [dispW, dispH]);

  // Cerrar al click afuera.
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const apply = () => {
    const w = parseFloat(draftW);
    const h = parseFloat(draftH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    if (Math.abs(w - tpW) < 0.01 && Math.abs(h - tpH) < 0.01) {
      onChange(null);
    } else {
      onChange({ widthMm: w, heightMm: h });
    }
    setOpen(false);
  };

  const reset = () => {
    onChange(null);
    setOpen(false);
  };

  if (!template) return null;

  return (
    <div ref={rootRef} className="relative flex items-center gap-2" title="Tamano fisico de la hoja">
      <span className="text-[11px] uppercase tracking-wider text-ink-400">Hoja</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs ${
          isCustom
            ? 'border-accent-500/60 bg-accent-600/10 text-accent-200 hover:bg-accent-600/20'
            : 'border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700'
        }`}
      >
        <span>{fmtMm(dispW)}×{fmtMm(dispH)} mm</span>
        <span className="text-ink-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-ink-700 bg-ink-800 p-2 text-xs text-ink-100 shadow-lg">
          <button
            type="button"
            onClick={reset}
            className={`block w-full rounded px-2 py-1.5 text-left ${
              !isCustom ? 'bg-accent-600 text-white' : 'hover:bg-ink-700'
            }`}
          >
            Plantilla ({fmtMm(tpW)}×{fmtMm(tpH)} mm)
          </button>
          <div className="mt-2 rounded border border-ink-700 px-2 py-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-400">
              Personalizado
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="10"
                step="0.1"
                value={draftW}
                onChange={(e) => setDraftW(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                className="w-16 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-center text-xs text-ink-100"
              />
              <span className="text-ink-400">×</span>
              <input
                type="number"
                min="10"
                step="0.1"
                value={draftH}
                onChange={(e) => setDraftH(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                className="w-16 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-center text-xs text-ink-100"
              />
              <span className="text-ink-400">mm</span>
            </div>
            <button
              type="button"
              onClick={apply}
              className="mt-2 w-full rounded bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-500"
            >
              Aplicar
            </button>
            <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
              El contenido se centra en la hoja. Util cuando el papel es algo
              mas grande/chico que la plantilla.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BladeOffsetControl({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const rootRef = useRef(null);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const apply = () => {
    const v = parseFloat(draft);
    if (!Number.isFinite(v) || v <= 0) return;
    onChange(Math.round(v * 1000) / 1000);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-2"
         title="Blade offset: distancia entre el centro de giro del cabezal y la punta de la cuchilla">
      <span className="text-[11px] uppercase tracking-wider text-ink-400">Cuchilla</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-200 hover:bg-ink-700"
      >
        <span>{fmtMm(value)} mm</span>
        <span className="text-ink-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-ink-700 bg-ink-800 p-2 text-xs text-ink-100 shadow-lg">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-400">
            Blade offset
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0.05"
              step="0.05"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
              className="w-20 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-center text-xs text-ink-100"
            />
            <span className="text-ink-400">mm</span>
          </div>
          <button
            type="button"
            onClick={apply}
            className="mt-2 w-full rounded bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-500"
          >
            Aplicar
          </button>
          <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
            Tipico 0.25 mm. Cambiar solo al reemplazar la cuchilla. Se
            recuerda entre sesiones.
          </p>
        </div>
      )}
    </div>
  );
}

// Menú desplegable que agrupa las acciones de acomodado para no saturar la
// barra superior. Recibe items ya filtrados: [{ label, onClick, disabled, title }].
function AcomodarMenu({ items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700"
      >
        <span>Acomodar</span>
        <span className="text-ink-400">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-ink-700 bg-ink-800 py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              title={it.title}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-100 hover:bg-ink-700 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopBar({
  canExport,
  canCut,
  doubleSided,
  viewingFace,
  onChangeFace,
  backMirror,
  onChangeBackMirror,
  backRotate180,
  onChangeBackRotate180,
  exporting,
  printing,
  cutting,
  onExport,
  onPrintFront,
  onPrintBack,
  onCut,
  layoutFitMode,
  onLayoutFitChange,
  showCuts,
  onShowCutsChange,
  template,
  customPaper,
  onCustomPaperChange,
  bladeOffsetMm,
  onBladeOffsetChange,
  // nuevas
  cellsPerPage,
  imagesLoaded,
  hasOccupiedCells,
  hasOccupiedCellsAllPages,
  totalPages,
  onDistributeEvenly,
  onOpenQuantities,
  onOpenFrontBackPose,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  // Jobs (Fase A)
  jobName,
  jobDirty,
  canSaveJob,
  onSaveJob,
  onSaveJobAs,
  onOpenJob,
  onOpenIntake,
  onOpenQrCut,
  // Utilidades globales
  onOpenTemplates,
  onOpenPdfToImage,
}) {
  const fitDisabled = !onLayoutFitChange;
  const pdfBusy = exporting || printing;

  const [distributeModalOpen, setDistributeModalOpen] = useState(false);
  const [distributeAllPages, setDistributeAllPages] = useState(false);

  const canDistribute =
    typeof onDistributeEvenly === 'function' &&
    (cellsPerPage ?? 0) >= 2 &&
    imagesLoaded > 0;

  const multiplePages = (totalPages ?? 1) > 1;

  // Si el modal se abre con el checkbox marcado de una sesion anterior pero ya no
  // hay varias hojas, reseteamos para que no quede colgado.
  useEffect(() => {
    if (!multiplePages && distributeAllPages) setDistributeAllPages(false);
  }, [multiplePages, distributeAllPages]);

  // Celdas ocupadas en el scope actual del modal (depende del checkbox).
  const occupiedInScope = distributeAllPages
    ? !!hasOccupiedCellsAllPages
    : !!hasOccupiedCells;

  const handleDistributeClick = () => {
    if (!canDistribute) return;
    // Abrir el modal si hay varias hojas (para que el usuario elija scope)
    // o si hay celdas ocupadas en la hoja actual (para que elija fill/replace).
    if (multiplePages || hasOccupiedCells) {
      setDistributeModalOpen(true);
    } else {
      onDistributeEvenly('fill-empty', 'page');
    }
  };

  const handleDistributeAction = (mode) => {
    const scope = distributeAllPages ? 'all-pages' : 'page';
    setDistributeModalOpen(false);
    onDistributeEvenly(mode, scope);
  };

  return (
    <>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-ink-700 bg-ink-900 px-4 py-1.5">
        <div className="flex shrink-0 items-center gap-2">
          <div className="h-5 w-5 rounded bg-accent-500" />
          <h1 className="text-sm font-semibold tracking-wide">PrintLayout</h1>
          <span
            className="text-[10px] font-mono text-ink-500"
            title={`Versión ${__APP_VERSION__}`}
          >
            v{__APP_VERSION__}
          </span>
          {(jobName !== undefined || canSaveJob) && (
            <div
              className="ml-2 max-w-[260px] truncate border-l border-ink-700 pl-3 text-xs"
              title={jobName ? `Trabajo: ${jobName}` : 'Trabajo sin guardar'}
            >
              <span className={jobDirty ? 'text-amber-300' : 'text-ink-300'}>
                {jobDirty ? '● ' : ''}
                {jobName || 'Sin titulo'}
              </span>
            </div>
          )}
          <div className="ml-3 flex items-center gap-1">
            {onOpenJob && (
              <button
                type="button"
                onClick={onOpenJob}
                title="Abrir trabajo (Ctrl+O)"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700"
              >
                Abrir
              </button>
            )}
            {onSaveJob && (
              <button
                type="button"
                onClick={onSaveJob}
                disabled={!canSaveJob}
                title="Guardar trabajo (Ctrl+S)"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
              >
                Guardar
              </button>
            )}
            {onSaveJobAs && (
              <button
                type="button"
                onClick={onSaveJobAs}
                disabled={!canSaveJob}
                title="Guardar como nuevo trabajo (Ctrl+Shift+S)"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
              >
                Guardar como…
              </button>
            )}
            {onOpenTemplates && (
              <button
                type="button"
                onClick={onOpenTemplates}
                title="Ver y editar las plantillas guardadas"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700"
              >
                Plantillas
              </button>
            )}
            {onOpenPdfToImage && (
              <button
                type="button"
                onClick={onOpenPdfToImage}
                title="Convertir un PDF en imágenes JPG/PNG"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700"
              >
                PDF→Imagen
              </button>
            )}
            {onOpenIntake && (
              <button
                type="button"
                onClick={onOpenIntake}
                title="Entrada automática de pedidos de fotos desde la web"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700"
              >
                Pedidos
              </button>
            )}
            {onOpenQrCut && (
              <button
                type="button"
                onClick={onOpenQrCut}
                title="Servidor de corte QR: esta PC atiende el corte por QR del plotter"
                className="rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-700"
              >
                Corte QR
              </button>
            )}
          </div>
          <div className="ml-3 flex items-center gap-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Deshacer (Ctrl+Z)"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-200 hover:bg-ink-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <path d="M3 7h7a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 4L3 7l3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Rehacer (Ctrl+Y)"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-200 hover:bg-ink-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <path d="M13 7H6a3.5 3.5 0 0 0 0 7h4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 4l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {doubleSided && (
            <div className="flex items-center gap-2" title="¿Qué cara estás editando?">
              <span className="text-[11px] uppercase tracking-wider text-ink-400">Cara</span>
              <div className="flex overflow-hidden rounded-md border border-ink-700 bg-ink-800">
                <button
                  type="button"
                  onClick={() => onChangeFace?.('front')}
                  className={`px-2.5 py-1 text-xs ${
                    viewingFace === 'front'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-200 hover:bg-ink-700'
                  }`}
                >
                  Frente
                </button>
                <button
                  type="button"
                  onClick={() => onChangeFace?.('back')}
                  className={`border-l border-ink-700 px-2.5 py-1 text-xs ${
                    viewingFace === 'back'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-200 hover:bg-ink-700'
                  }`}
                >
                  Dorso
                </button>
              </div>
            </div>
          )}

          {doubleSided && viewingFace === 'back' && typeof onChangeBackMirror === 'function' && (
            <div
              className="flex items-center gap-1"
              title="Ajustes del dorso. Espejo: si el dorso cae mal ubicado (no detrás de su frente), probá el otro. Rotar: si el dorso sale cabeza abajo, ponelo en 180°."
            >
              <span className="text-[10px] uppercase tracking-wide text-ink-400">Dorso</span>
              <div className="flex overflow-hidden rounded-md border border-ink-700 bg-ink-800">
                <button
                  type="button"
                  onClick={() => onChangeBackMirror('y')}
                  title="Espejo arriba-abajo"
                  className={`px-2 py-1 text-xs ${
                    (backMirror ?? 'y') === 'y'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-200 hover:bg-ink-700'
                  }`}
                >
                  ↕
                </button>
                <button
                  type="button"
                  onClick={() => onChangeBackMirror('x')}
                  title="Espejo izquierda-derecha"
                  className={`border-l border-ink-700 px-2 py-1 text-xs ${
                    (backMirror ?? 'y') === 'x'
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-200 hover:bg-ink-700'
                  }`}
                >
                  ↔
                </button>
              </div>
              <div className="flex overflow-hidden rounded-md border border-ink-700 bg-ink-800">
                <button
                  type="button"
                  onClick={() => onChangeBackRotate180(false)}
                  title="Dorso sin rotar"
                  className={`px-2 py-1 text-xs ${
                    !backRotate180
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-200 hover:bg-ink-700'
                  }`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onChangeBackRotate180(true)}
                  title="Rotar dorso 180° (si sale cabeza abajo)"
                  className={`border-l border-ink-700 px-2 py-1 text-xs ${
                    backRotate180
                      ? 'bg-accent-600 text-white'
                      : 'text-ink-200 hover:bg-ink-700'
                  }`}
                >
                  180°
                </button>
              </div>
            </div>
          )}

          {onShowCutsChange && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-300">
              <input
                type="checkbox"
                checked={!!showCuts}
                onChange={(e) => onShowCutsChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-red-500"
              />
              <span>
                <span className="text-red-400">●</span> Corte
              </span>
            </label>
          )}

          <div
            className={`flex items-center gap-2 ${fitDisabled ? 'opacity-40' : ''}`}
            title="Cómo entran las fotos en las celdas"
          >
            <span className="text-[11px] uppercase tracking-wider text-ink-400">Fotos</span>
            <div className="flex overflow-hidden rounded-md border border-ink-700 bg-ink-800">
              <button
                type="button"
                disabled={fitDisabled}
                onClick={() => onLayoutFitChange?.('contain')}
                className={`px-2.5 py-1 text-xs ${
                  layoutFitMode === 'contain'
                    ? 'bg-accent-600 text-white'
                    : 'text-ink-200 hover:bg-ink-700'
                }`}
              >
                Enteras
              </button>
              <button
                type="button"
                disabled={fitDisabled}
                onClick={() => onLayoutFitChange?.('cover')}
                className={`border-l border-ink-700 px-2.5 py-1 text-xs ${
                  layoutFitMode === 'cover'
                    ? 'bg-accent-600 text-white'
                    : 'text-ink-200 hover:bg-ink-700'
                }`}
              >
                Rellenar
              </button>
            </div>
          </div>

          {template && onCustomPaperChange && (
            <PaperSizeControl
              template={template}
              customPaper={customPaper}
              onChange={onCustomPaperChange}
            />
          )}

          {(cellsPerPage ?? 0) >= 2 && (
            <AcomodarMenu
              items={[
                {
                  label: 'Repartir parejo',
                  onClick: handleDistributeClick,
                  disabled: !canDistribute,
                  title: imagesLoaded === 0
                    ? 'Cargá imágenes primero'
                    : 'Repartir las imágenes cargadas en las celdas de esta hoja',
                },
                ...(typeof onOpenQuantities === 'function' ? [{
                  label: 'Por cantidad',
                  onClick: () => onOpenQuantities(),
                  disabled: imagesLoaded === 0,
                  title: imagesLoaded === 0
                    ? 'Cargá fotos primero'
                    : 'Elegir cuántas copias de cada foto y acomodarlas',
                }] : []),
                ...(doubleSided && typeof onOpenFrontBackPose === 'function' ? [{
                  label: 'Posar frente/dorso',
                  onClick: () => onOpenFrontBackPose(),
                  title: 'Cargar pares frente/dorso con cantidad y posarlos emparejados',
                }] : []),
              ]}
            />
          )}

          {doubleSided ? (
            <>
              <button
                onClick={onPrintFront}
                disabled={!canExport || pdfBusy}
                className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700 disabled:opacity-40"
              >
                {printing === 'front' ? 'Imprimiendo…' : 'Imprimir frente'}
              </button>
              <button
                onClick={onPrintBack}
                disabled={!canExport || pdfBusy}
                className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700 disabled:opacity-40"
              >
                {printing === 'back' ? 'Imprimiendo…' : 'Imprimir dorso'}
              </button>
            </>
          ) : (
            <button
              onClick={onPrintFront}
              disabled={!canExport || pdfBusy}
              className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700 disabled:opacity-40"
            >
              {printing ? 'Imprimiendo…' : 'Imprimir'}
            </button>
          )}
          <button
            onClick={onExport}
            disabled={!canExport || pdfBusy}
            className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            {exporting ? 'Generando…' : 'Exportar PDF'}
          </button>
          {canCut && onBladeOffsetChange && (
            <BladeOffsetControl
              value={bladeOffsetMm}
              onChange={onBladeOffsetChange}
            />
          )}
          <button
            onClick={onCut}
            disabled={!canCut || cutting}
            title={canCut ? 'Enviar el corte al plotter' : 'La plantilla no tiene página de corte'}
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            {cutting ? 'Enviando…' : 'Cortar'}
          </button>
        </div>
      </header>
      <ConfirmModal
        open={distributeModalOpen}
        title={
          occupiedInScope
            ? distributeAllPages
              ? 'Ya hay celdas ocupadas en estas hojas'
              : 'Ya hay celdas ocupadas en esta hoja'
            : 'Repartir parejo'
        }
        message={
          occupiedInScope
            ? '¿Querés llenar solo las celdas vacías o reemplazar todas las celdas con un reparto nuevo?'
            : distributeAllPages
              ? 'Las imágenes cargadas se van a repartir entre las celdas de todas las hojas.'
              : 'Las imágenes cargadas se van a repartir entre las celdas de esta hoja.'
        }
        actions={
          occupiedInScope
            ? [
                { label: 'Solo llenar vacías', value: 'fill-empty', variant: 'default' },
                { label: 'Reemplazar todo', value: 'replace-all', variant: 'primary' },
              ]
            : [{ label: 'Repartir', value: 'fill-empty', variant: 'primary' }]
        }
        onAction={handleDistributeAction}
        onCancel={() => setDistributeModalOpen(false)}
      >
        {multiplePages && (
          <label className="flex items-center gap-2 text-xs text-ink-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={distributeAllPages}
              onChange={(e) => setDistributeAllPages(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent-600"
            />
            <span>Repartir en todas las hojas ({totalPages})</span>
          </label>
        )}
      </ConfirmModal>
    </>
  );
}
