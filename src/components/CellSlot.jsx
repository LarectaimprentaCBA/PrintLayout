import { useDraggable, useDroppable } from '@dnd-kit/core';

export default function CellSlot({
  cellIdx,
  image,
  isSelected,
  fitMode,
  objectPosition,
  style,
  onClick,
  onContextMenu,
  cutShape = 'rect',
  cellWmm = 0,
  cellHmm = 0,
  cutMarginMm = 0,
}) {
  const draggable = useDraggable({
    id: `cell:${cellIdx}`,
    data: { source: 'cell', cellIdx, imageId: image?.id ?? null },
    disabled: !image,
  });

  const droppable = useDroppable({
    id: `cell-drop:${cellIdx}`,
    data: { target: 'cell', cellIdx },
  });

  const setRefs = (el) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };

  const isOver = droppable.isOver;
  const isDragging = draggable.isDragging;

  let outline;
  if (image) {
    outline = isSelected
      ? 'outline outline-2 outline-accent-500'
      : 'outline outline-1 outline-accent-500/40 hover:outline-accent-500';
  } else {
    outline = isSelected
      ? 'outline outline-2 outline-accent-500 bg-accent-500/15'
      : 'outline outline-dashed outline-1 outline-accent-500/60 hover:outline-accent-500 hover:bg-accent-500/15';
  }
  if (isOver) outline = 'outline outline-2 outline-accent-500 bg-accent-500/25';

  const isCover = fitMode === 'cover';
  const imgClass = isCover
    ? 'h-full w-full object-cover'
    : 'h-full w-full object-contain';
  const imgStyle =
    isCover && objectPosition
      ? { objectPosition: `${objectPosition.x}% ${objectPosition.y}%` }
      : undefined;

  // Para cutShape='circle': dibujamos un circulo punteado centrado, inscripto
  // en min(w,h) y con el cutMarginMm aplicado, igual que el corte real.
  // Asi el usuario ve la zona que va a quedar redonda despues del corte.
  const isCircle = cutShape === 'circle';
  let circleOverlay = null;
  if (isCircle && cellWmm > 0 && cellHmm > 0) {
    const diamMm = Math.max(0, Math.min(cellWmm, cellHmm) - 2 * (cutMarginMm || 0));
    if (diamMm > 0) {
      const sizePctW = (diamMm / cellWmm) * 100;
      const sizePctH = (diamMm / cellHmm) * 100;
      circleOverlay = (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-accent-500/80"
          style={{ width: `${sizePctW}%`, height: `${sizePctH}%` }}
          aria-hidden
        />
      );
    }
  }

  return (
    <div
      ref={setRefs}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(cellIdx);
      }}
      onContextMenu={(e) => {
        if (!image) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(cellIdx, image);
      }}
      className={`absolute flex cursor-pointer items-center justify-center overflow-hidden text-accent-500/70 transition ${outline} ${
        isDragging ? 'opacity-30' : ''
      }`}
      style={style}
      {...draggable.listeners}
      {...draggable.attributes}
    >
      {image ? (
        <img
          src={image.dataUrl}
          alt={image.name}
          draggable={false}
          className={imgClass}
          style={imgStyle}
        />
      ) : (
        <span className="pointer-events-none text-2xl font-light">+</span>
      )}
      {circleOverlay}
    </div>
  );
}
