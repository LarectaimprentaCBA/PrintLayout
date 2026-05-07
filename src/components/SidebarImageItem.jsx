import { useDraggable } from '@dnd-kit/core';

const FIT_CYCLE = [
  { value: undefined, label: 'A', title: 'Modo: automático (sigue el global)' },
  { value: 'contain', label: 'E', title: 'Modo: entera (con barras blancas si hace falta)' },
  { value: 'cover', label: 'R', title: 'Modo: rellenar celda (recorte inteligente)' },
];

function nextFitOverride(current) {
  const idx = FIT_CYCLE.findIndex((s) => s.value === current);
  return FIT_CYCLE[(idx + 1) % FIT_CYCLE.length].value;
}

export default function SidebarImageItem({
  image,
  used,
  totalCells,
  isSelected,
  onSelect,
  onRemove,
  onFillAll,
  onAutoZoom,
  onCycleFit,
  onRotate,
  onEditImage,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `image:${image.id}`,
    data: { source: 'sidebar', imageId: image.id },
  });

  const filledAll = totalCells > 0 && used === totalCells;
  const faceCount = image.faces?.length ?? 0;
  const canAutoZoom = faceCount > 0 && !image.autoZoomed;
  const fitState =
    FIT_CYCLE.find((s) => s.value === image.fitOverride) ?? FIT_CYCLE[0];
  const fitOverridden = image.fitOverride !== undefined;

  return (
    <li
      ref={setNodeRef}
      onClick={(e) => {
        e.stopPropagation();
        if (used > 0) onSelect?.(image.id);
      }}
      className={`group flex cursor-grab items-center gap-2 rounded-md border p-1.5 active:cursor-grabbing ${
        isSelected
          ? 'border-accent-500 bg-accent-500/15'
          : 'border-ink-700 bg-ink-800 hover:border-accent-500/60'
      } ${isDragging ? 'opacity-30' : ''}`}
      {...listeners}
      {...attributes}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-ink-950">
        <img
          src={image.dataUrl}
          alt={image.name}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-ink-100" title={image.name}>
          {image.name}
        </div>
        <div className="text-[10px] text-ink-400">
          {image.width}×{image.height}px ·{' '}
          <span className={used > 0 ? 'text-accent-500' : 'text-ink-500'}>
            {used > 0 ? `en ${used} celda${used === 1 ? '' : 's'}` : 'sin usar'}
          </span>
          {faceCount > 0 && (
            <>
              {' · '}
              <span className="text-accent-500">
                {faceCount} {faceCount === 1 ? 'cara' : 'caras'}
              </span>
            </>
          )}
        </div>
      </div>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onCycleFit?.(image.id, nextFitOverride(image.fitOverride));
        }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold transition ${
          fitOverridden
            ? 'bg-accent-600 text-white hover:bg-accent-500'
            : 'border border-ink-700 text-ink-400 hover:border-accent-500 hover:text-ink-100'
        }`}
        title={fitState.title}
      >
        {fitState.label}
      </button>
      <div className="flex flex-col gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEditImage?.(image.id);
          }}
          className="rounded p-1 text-ink-300 hover:bg-ink-700 hover:text-accent-500"
          title="Editar (encuadre, sangrado)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M11 2l3 3-9 9H2v-3z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRotate?.(image.id);
          }}
          className="rounded p-1 text-ink-300 hover:bg-ink-700 hover:text-accent-500"
          title="Rotar 90°"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 8a5 5 0 0 1 9-3" strokeLinecap="round" />
            <path d="M12 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 8a5 5 0 0 1-9 3" strokeLinecap="round" opacity="0.4" />
          </svg>
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAutoZoom?.(image.id);
          }}
          disabled={!canAutoZoom}
          className="rounded p-1 text-ink-300 hover:bg-ink-700 hover:text-accent-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-300"
          title={
            image.autoZoomed
              ? 'Ya está enfocado en las personas'
              : faceCount > 0
                ? `Recortar para enfocar ${faceCount === 1 ? 'la cara' : 'las caras'}`
                : 'No se detectaron caras'
          }
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l4 4" strokeLinecap="round" />
            <circle cx="7" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
            <path d="M5 8.5c.6.7 1.3 1 2 1s1.4-.3 2-1" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onFillAll?.(image.id);
          }}
          disabled={filledAll}
          className="rounded p-1 text-ink-300 hover:bg-ink-700 hover:text-accent-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-300"
          title={filledAll ? 'Ya está en todas las celdas' : 'Llenar todas las celdas con esta imagen'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="currentColor"
          >
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.(image.id);
          }}
          className="rounded p-1 text-ink-400 hover:bg-ink-700 hover:text-red-300"
          title="Quitar"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
