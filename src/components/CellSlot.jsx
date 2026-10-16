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
  cornerRadiusMm = 0,
  cellNumber = null,
  whiteBorderPx = 0,
  borderLinePx = 0,
  borderLineColor = '#000000',
  rotate90 = false,
  cellWpx = 0,
  cellHpx = 0,
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

  // Borde blanco: con box-sizing border-box el padding achica el área de la
  // imagen sin cambiar el tamaño exterior de la celda; el fondo blanco queda
  // visible alrededor. Solo cuando hay imagen (las celdas vacías no llevan marco).
  const borderStyle =
    whiteBorderPx > 0 && image
      ? { padding: whiteBorderPx, backgroundColor: '#ffffff' }
      : null;
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

  // Marco (linea de filete) CON LA FORMA DE LA PIEZA. Antes era siempre
  // `inset-0` = un rectangulo: en una plantilla circular quedaba un recuadro
  // CUADRADO sobre una pieza redonda, y al cortar quedaban 4 tiras sueltas.
  // Mismo criterio que el PDF (exportPdf.drawPieceShape).
  const pxX = cellWmm > 0 && cellWpx > 0 ? cellWpx / cellWmm : 0;
  const pxY = cellHmm > 0 && cellHpx > 0 ? cellHpx / cellHmm : 0;
  const mX = (cutMarginMm || 0) * pxX;
  const mY = (cutMarginMm || 0) * pxY;
  let frameBox = { left: 0, top: 0, width: '100%', height: '100%', radius: 0 };
  if (isCircle && cellWpx > 0 && cellHpx > 0) {
    const d = Math.min(cellWpx - 2 * mX, cellHpx - 2 * mY);
    if (d > 0) {
      frameBox = {
        left: (cellWpx - d) / 2, top: (cellHpx - d) / 2, width: d, height: d, radius: '50%',
      };
    }
  } else if (cutShape === 'rounded' && cellWpx > 0 && cellHpx > 0) {
    const bw = cellWpx - 2 * mX;
    const bh = cellHpx - 2 * mY;
    if (bw > 0 && bh > 0) {
      frameBox = {
        left: mX, top: mY, width: bw, height: bh,
        radius: Math.max(0, (cornerRadiusMm || 0) * pxX - Math.min(mX, mY)),
      };
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
      style={borderStyle ? { ...style, ...borderStyle } : style}
      {...draggable.listeners}
      {...draggable.attributes}
    >
      {image ? (
        rotate90 ? (
          // Casillero de orientación opuesta a la imagen: la mostramos girada 90°
          // (CW, igual que la impresión). Caja con dimensiones INTERCAMBIADAS para
          // que, al rotar, el cover llene exactamente el casillero. Centrada.
          <img
            src={image.dataUrl}
            alt={image.name}
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            style={{
              width: Math.max(0, cellHpx - 2 * whiteBorderPx),
              height: Math.max(0, cellWpx - 2 * whiteBorderPx),
              objectFit: isCover ? 'cover' : 'contain',
              transform: 'translate(-50%, -50%) rotate(90deg)',
            }}
          />
        ) : (
          <img
            src={image.dataUrl}
            alt={image.name}
            draggable={false}
            className={imgClass}
            style={imgStyle}
          />
        )
      ) : (
        <span className="pointer-events-none text-2xl font-light">+</span>
      )}
      {circleOverlay}
      {borderLinePx > 0 && image && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: frameBox.left,
            top: frameBox.top,
            width: frameBox.width,
            height: frameBox.height,
            borderRadius: frameBox.radius,
            boxSizing: 'border-box',
            border: `${Math.max(borderLinePx, 1)}px solid ${borderLineColor}`,
          }}
          aria-hidden
        />
      )}
      {cellNumber != null && (
        <span
          className="pointer-events-none absolute left-0 top-0 rounded-br bg-accent-600/85 px-1 text-[10px] font-semibold leading-tight text-white"
          aria-hidden
        >
          {cellNumber}
        </span>
      )}
    </div>
  );
}
