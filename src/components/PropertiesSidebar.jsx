import { useRef } from 'react';
import { totalCells, hasCuts } from '../lib/templates.js';
import { readImageFiles } from '../lib/images.js';
import SidebarImageItem from './SidebarImageItem.jsx';

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
  onRenameTemplate,
  onSetCategoria,
  categoriasList = [],
  onAddImages,
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
    <aside className="flex w-72 shrink-0 flex-col border-l border-ink-700 bg-ink-900">
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
                const cellsPP = totalCells(template);
                const pageIdx = Math.floor(selectedCell / cellsPP) + 1;
                const localIdx = (selectedCell % cellsPP) + 1;
                return (
                  <>
                    Celda <span className="text-ink-100">{localIdx}</span> de {cellsPP}
                    <span className="ml-2 text-ink-500">· hoja {pageIdx}</span>
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
                <span>{template.markMarginMm ?? 10} mm</span>
                {onEditMargin && (
                  <button
                    onClick={onEditMargin}
                    className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-800"
                  >
                    Editar
                  </button>
                )}
              </dd>
            </div>
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
              <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
                Grilla temporal — vive solo en esta sesión.
              </div>
            )}
          </dl>
        )}
      </div>
    </aside>
  );
}
