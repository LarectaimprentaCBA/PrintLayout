import { useEffect, useRef, useState } from 'react';
import { totalCells, hasCuts, findCellPageInfo } from '../lib/templates.js';
import { readImageFiles } from '../lib/images.js';
import SidebarImageItem from './SidebarImageItem.jsx';

// Input mm inline para Properties: edita un valor numerico, valida en blur o
// Enter. No emite mientras escribis para no regenerar cortes en cada tecla.
function NumberMmInput({ value, onChange, title }) {
  const [text, setText] = useState(String(value ?? 0));
  useEffect(() => { setText(String(value ?? 0)); }, [value]);
  const commit = () => {
    const n = parseFloat(String(text).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      setText(String(value ?? 0));
      return;
    }
    const clamped = Math.min(50, Math.max(0, n));
    if (Math.abs(clamped - (value ?? 0)) > 1e-6) onChange?.(clamped);
    else setText(String(value ?? 0));
  };
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setText(String(value ?? 0)); e.currentTarget.blur(); }
        }}
        className="w-12 rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-right text-xs text-ink-100 outline-none focus:border-accent-500"
      />
      <span className="text-[10px] text-ink-500">mm</span>
    </span>
  );
}

export default function PropertiesSidebar({
  template,
  images,
  assignments,
  imageMap,
  selectedCell,
  viewingFace,
  canShare,
  sharing,
  onShare,
  onEditMargin,
  onUpdateTemporal,
  onSaveTemporal,
  onRenameTemplate,
  onSetCategoria,
  categoriasList = [],
  onAddImages,
  onImportPdfImages,
  extractingPdf,
  onRemoveImage,
  onClearCell,
  onClearAll,
  onAddImageToCell,
  onFillAll,
  onAutoZoom,
  onRotate,
  onEditImage,
  onCycleFit,
  onSelectImage,
}) {
  const multiInputRef = useRef(null);
  const singleInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [dragKind, setDragKind] = useState(null); // 'pdf' | 'image' | null
  const dragCounterRef = useRef(0);

  const usageById = new Map();
  if (assignments) {
    for (const id of assignments) {
      if (!id) continue;
      usageById.set(id, (usageById.get(id) ?? 0) + 1);
    }
  }

  const handleMultiPick = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const loaded = await readImageFiles(files);
    onAddImages?.(loaded);
    e.target.value = '';
  };

  const handlePdfPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onImportPdfImages?.(file);
  };

  const isPdf = (f) =>
    (f?.type || '').toLowerCase() === 'application/pdf'
    || /\.pdf$/i.test(f?.name || '');

  const isImg = (f) =>
    /^image\/(jpe?g|png)$/i.test(f?.type || '')
    || /\.(jpe?g|png)$/i.test(f?.name || '');

  const handleDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    // Sin acceso a los files hasta el drop. Asumimos generico hasta entonces.
    setDragKind('any');
  };

  const handleDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragKind(null);
  };

  const handleDrop = async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragKind(null);
    const files = Array.from(e.dataTransfer.files);
    const pdf = files.find(isPdf);
    if (pdf) {
      onImportPdfImages?.(pdf);
      return;
    }
    const imgs = files.filter(isImg);
    if (imgs.length === 0) return;
    const loaded = await readImageFiles(imgs);
    if (loaded.length > 0) onAddImages?.(loaded);
  };

  const handleSinglePick = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0 || selectedCell === null) return;
    const loaded = await readImageFiles(files);
    if (loaded.length > 0) {
      onAddImageToCell?.(selectedCell, loaded[0]);
    }
    e.target.value = '';
  };

  const selectedImgId = selectedCell !== null ? assignments?.[selectedCell] : null;
  const selectedImg = selectedImgId ? imageMap?.get(selectedImgId) : null;

  return (
    <aside
      className={`relative flex w-72 shrink-0 flex-col border-l border-ink-700 bg-ink-900 ${
        dragKind ? 'ring-2 ring-accent-500/60' : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={multiInputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        multiple
        className="hidden"
        onChange={handleMultiPick}
      />
      <input
        ref={singleInputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        className="hidden"
        onChange={handleSinglePick}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handlePdfPick}
      />

      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
          Imágenes ({images?.length ?? 0})
        </h2>
        <div className="flex gap-1">
          <button
            disabled={!template}
            onClick={() => multiInputRef.current?.click()}
            className="rounded bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            + Cargar
          </button>
          <button
            disabled={!template || extractingPdf}
            onClick={() => pdfInputRef.current?.click()}
            title="Importar imágenes embebidas en un PDF"
            className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            {extractingPdf ? 'Extrayendo…' : '+ PDF'}
          </button>
          {images && images.length > 0 && (
            <button
              onClick={() => {
                if (confirm('¿Vaciar el layout y quitar todas las imágenes?')) onClearAll?.();
              }}
              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
            >
              Vaciar
            </button>
          )}
        </div>
      </div>

      {dragKind && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-500/10">
          <div className="rounded border border-accent-500/60 bg-ink-950/80 px-3 py-2 text-xs text-accent-200">
            Soltá archivos para agregar
            <div className="mt-0.5 text-[10px] text-ink-400">
              PDF → extraer imágenes · JPG/PNG → cargar
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {!template ? (
          <p className="px-2 py-3 text-xs text-ink-400">
            Seleccioná una plantilla primero.
          </p>
        ) : !images || images.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-400">
            Hacé clic en <b>+ Cargar</b> para subir imágenes (JPG, PNG).
          </p>
        ) : (
          <ul className="space-y-1.5">
            {images.map((img) => (
              <SidebarImageItem
                key={img.id}
                image={img}
                used={usageById.get(img.id) ?? 0}
                totalCells={assignments?.length ?? 0}
                isSelected={selectedImgId === img.id}
                onSelect={onSelectImage}
                onRemove={onRemoveImage}
                onFillAll={onFillAll}
                onAutoZoom={onAutoZoom}
                onRotate={onRotate}
                onEditImage={onEditImage}
                onCycleFit={onCycleFit}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-ink-700 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-300">
          {selectedCell !== null
            ? `Celda seleccionada${
                template?.doubleSided ? ` · ${viewingFace === 'back' ? 'dorso' : 'frente'}` : ''
              }`
            : 'Plantilla'}
        </h2>
      </div>

      <div className="px-3 py-3 text-xs">
        {selectedCell !== null && template ? (
          <div className="space-y-2">
            <div className="text-ink-300">
              {(() => {
                const info = findCellPageInfo(template, selectedCell, viewingFace);
                return (
                  <>
                    Celda <span className="text-ink-100">{info.localIdx + 1}</span> de {info.pageSize}
                    <span className="ml-2 text-ink-500">· hoja {info.page + 1}</span>
                  </>
                );
              })()}
            </div>
            {selectedImg ? (
              <>
                <div className="truncate text-ink-200" title={selectedImg.name}>
                  {selectedImg.name}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => singleInputRef.current?.click()}
                    className="flex-1 rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800"
                  >
                    Reemplazar
                  </button>
                  <button
                    onClick={() => onClearCell?.(selectedCell)}
                    className="flex-1 rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                  >
                    Quitar
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={() => singleInputRef.current?.click()}
                className="w-full rounded bg-accent-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-accent-500"
              >
                Agregar imagen aquí
              </button>
            )}
          </div>
        ) : !template ? (
          <p className="text-ink-400">Ninguna plantilla seleccionada.</p>
        ) : (
          <dl className="space-y-1.5 text-ink-300">
            <div>
              <dt className="text-ink-400 mb-1">Nombre</dt>
              <dd>
                {onRenameTemplate ? (
                  <input
                    defaultValue={template.name}
                    key={template.id + template.name}
                    onBlur={(e) => onRenameTemplate(template, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.target.blur();
                      if (e.key === 'Escape') {
                        e.target.value = template.name;
                        e.target.blur();
                      }
                    }}
                    className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                  />
                ) : (
                  <span className="text-ink-100">{template.name}</span>
                )}
              </dd>
            </div>
            {!template.temporal && (
              <div>
                <dt className="text-ink-400 mb-1">Carpeta</dt>
                <dd>
                  {onSetCategoria ? (
                    <>
                      <input
                        list="properties-categorias"
                        defaultValue={template.categoria || ''}
                        key={template.id + (template.categoria || '')}
                        placeholder="Sin carpeta"
                        onBlur={(e) => onSetCategoria(template, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur();
                          if (e.key === 'Escape') {
                            e.target.value = template.categoria || '';
                            e.target.blur();
                          }
                        }}
                        className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                      />
                      <datalist id="properties-categorias">
                        {categoriasList.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </>
                  ) : (
                    <span className="text-ink-100">{template.categoria || '—'}</span>
                  )}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-400">Hoja</dt>
              <dd>
                {Math.round(template.pageWidthMm)} × {Math.round(template.pageHeightMm)} mm
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Celdas</dt>
              <dd>{totalCells(template)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Cortes</dt>
              <dd>
                {hasCuts(template) ? (
                  <span className="text-accent-400">
                    {template.cortes.length} polilínea
                    {template.cortes.length === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="text-ink-500">sin corte</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-400">Margen marcas</dt>
              <dd className="flex items-center gap-2">
                {template.temporal && onUpdateTemporal ? (
                  <NumberMmInput
                    value={template.markMarginMm ?? 0}
                    onChange={(v) => onUpdateTemporal({ markMarginMm: v })}
                    title="Distancia desde el borde de la hoja a las marcas L. 0 = sin marcas (no se puede cortar)."
                  />
                ) : (
                  <>
                    <span>{template.markMarginMm ?? 10} mm</span>
                    {onEditMargin && (
                      <button
                        onClick={onEditMargin}
                        className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-800"
                      >
                        Editar
                      </button>
                    )}
                  </>
                )}
              </dd>
            </div>
            {template.temporal && onUpdateTemporal && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-400">Margen corte</dt>
                  <dd className="flex items-center gap-2">
                    <NumberMmInput
                      value={template.cutMarginMm ?? 0}
                      onChange={(v) => onUpdateTemporal({ cutMarginMm: v })}
                      title="Cuanto se mete la cuchilla hacia adentro de la celda. 0 = corta justo en el borde."
                    />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-400">Forma corte</dt>
                  <dd>
                    <div className="flex gap-0.5 rounded border border-ink-700 bg-ink-800 p-0.5">
                      <button
                        type="button"
                        onClick={() => onUpdateTemporal({ cutShape: 'rect' })}
                        className={`rounded px-2 py-0.5 text-[10px] ${
                          (template.cutShape ?? 'rect') === 'rect'
                            ? 'bg-accent-600 text-white'
                            : 'text-ink-300 hover:bg-ink-700'
                        }`}
                      >
                        Rect
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateTemporal({ cutShape: 'circle' })}
                        className={`rounded px-2 py-0.5 text-[10px] ${
                          template.cutShape === 'circle'
                            ? 'bg-accent-600 text-white'
                            : 'text-ink-300 hover:bg-ink-700'
                        }`}
                      >
                        Círculo
                      </button>
                    </div>
                  </dd>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-ink-400">Doble faz</dt>
              <dd className={template.doubleSided ? 'text-accent-400' : 'text-ink-500'}>
                {template.doubleSided ? 'Sí' : 'No'}
              </dd>
            </div>
            {!template.temporal && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-400">Compartida</dt>
                  <dd className={template.sharedAt ? 'text-accent-400' : 'text-ink-500'}>
                    {template.sharedAt ? 'Sí' : 'No'}
                  </dd>
                </div>
                {onShare && (
                  <div className="pt-1">
                    <button
                      onClick={() => onShare(template)}
                      disabled={!canShare || sharing}
                      title={
                        canShare
                          ? template.sharedAt
                            ? 'Subir cambios al repo compartido'
                            : 'Subir al repo compartido (la van a recibir todas las PCs)'
                          : 'Token de sync no configurado en este build'
                      }
                      className="w-full rounded border border-accent-500/40 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sharing
                        ? 'Subiendo…'
                        : template.sharedAt
                        ? 'Subir cambios'
                        : 'Compartir'}
                    </button>
                  </div>
                )}
              </>
            )}
            {template.temporal && (
              <div className="space-y-2">
                <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
                  Grilla temporal — vive solo en esta sesión.
                </div>
                {onSaveTemporal && (
                  <button
                    type="button"
                    onClick={() => onSaveTemporal(template)}
                    className="w-full rounded border border-accent-500/40 bg-accent-500/10 px-2 py-1.5 text-[11px] font-medium text-accent-200 hover:bg-accent-500/20"
                  >
                    Guardar plantilla…
                  </button>
                )}
              </div>
            )}
          </dl>
        )}
      </div>
    </aside>
  );
}
