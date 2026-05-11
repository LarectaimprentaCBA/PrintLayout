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

export default function TopBar({
  canExport,
  canCut,
  doubleSided,
  viewingFace,
  onChangeFace,
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
  onDistributeEvenly,
}) {
  const fitDisabled = !onLayoutFitChange;
  const pdfBusy = exporting || printing;

  const [distributeModalOpen, setDistributeModalOpen] = useState(false);

  const canDistribute =
    typeof onDistributeEvenly === 'function' &&
    (cellsPerPage ?? 0) >= 2 &&
    imagesLoaded > 0;

  const handleDistributeClick = () => {
    if (!canDistribute) return;
    if (hasOccupiedCells) {
      setDistributeModalOpen(true);
    } else {
      onDistributeEvenly('fill-empty');
    }
  };

  const handleDistributeAction = (mode) => {
    setDistributeModalOpen(false);
    onDistributeEvenly(mode);
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-ink-700 bg-ink-900 px-4">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-accent-500" />
        <h1 className="text-sm font-semibold tracking-wide">PrintLayout</h1>
      </div>

      <div className="flex items-center gap-3">
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
          <button
            type="button"
            onClick={handleDistributeClick}
            disabled={!canDistribute}
            title={
              imagesLoaded === 0
                ? 'Cargá imágenes primero'
                : 'Repartir las imágenes cargadas en las celdas de esta hoja'
            }
            className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            Repartir parejo
          </button>
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
        <ConfirmModal
          open={distributeModalOpen}
          title="Ya hay celdas ocupadas en esta hoja"
          message="¿Querés llenar solo las celdas vacías o reemplazar todas las celdas con un reparto nuevo?"
          actions={[
            { label: 'Solo llenar vacías', value: 'fill-empty', variant: 'default' },
            { label: 'Reemplazar todo', value: 'replace-all', variant: 'primary' },
          ]}
          onAction={handleDistributeAction}
          onCancel={() => setDistributeModalOpen(false)}
        />
    </header>
  );
}
