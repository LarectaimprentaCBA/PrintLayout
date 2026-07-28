// Matemática compartida para editar el recuadro del nombre (mover / redimensionar
// por 8 tiradores / rotar) tanto en el cargador de modelos como en "Armar
// plancha". Funciones puras en mm; el marco local respeta la rotación.

export const RESIZE_HANDLES = [
  { dir: 'n', pos: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cur: 'cursor-ns-resize' },
  { dir: 's', pos: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cur: 'cursor-ns-resize' },
  { dir: 'w', pos: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cur: 'cursor-ew-resize' },
  { dir: 'e', pos: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cur: 'cursor-ew-resize' },
  { dir: 'nw', pos: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cur: 'cursor-nwse-resize' },
  { dir: 'ne', pos: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cur: 'cursor-nesw-resize' },
  { dir: 'sw', pos: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cur: 'cursor-nesw-resize' },
  { dir: 'se', pos: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cur: 'cursor-nwse-resize' },
];

export const RESIZE_EDGES = {
  n: { top: true }, s: { bottom: true }, w: { left: true }, e: { right: true },
  nw: { top: true, left: true }, ne: { top: true, right: true },
  sw: { bottom: true, left: true }, se: { bottom: true, right: true },
};

const round2 = (n) => Math.round(n * 100) / 100;

// Medias-extensiones del rectángulo ENVOLVENTE (AABB) de la caja rotada.
function rotatedHalfExtents(w, h, rotation) {
  const rad = ((rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { hx: (w / 2) * c + (h / 2) * s, hy: (w / 2) * s + (h / 2) * c };
}

// Acota el centro para que la caja ROTADA (sus 4 esquinas) quede dentro del
// rótulo y no se recorte en el overlay. Si no entra en un eje, la centra ahí.
export function clampCenterRotated(cx, cy, w, h, rotation, cutW, cutH) {
  const { hx, hy } = rotatedHalfExtents(w, h, rotation);
  const nx = hx * 2 <= cutW ? Math.max(hx, Math.min(cx, cutW - hx)) : cutW / 2;
  const ny = hy * 2 <= cutH ? Math.max(hy, Math.min(cy, cutH - hy)) : cutH / 2;
  return { cx: nx, cy: ny };
}

// Reemplaza x/y/w/h no finitos (NaN de datos viejos/rotos) por valores válidos.
// Devuelve la MISMA referencia si ya estaba sana (evita renders de más).
export function sanitizeBox(box) {
  if (!box) return box;
  if ([box.x, box.y, box.w, box.h].every(Number.isFinite)) return box;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return { ...box, x: num(box.x, 0), y: num(box.y, 0), w: num(box.w, 2), h: num(box.h, 1) };
}

// Mueve la caja dejando la caja rotada dentro del rótulo.
export function moveBox(start, dxMm, dyMm, cutW, cutH) {
  const { cx, cy } = clampCenterRotated(start.x + start.w / 2 + dxMm, start.y + start.h / 2 + dyMm, start.w, start.h, start.rotation, cutW, cutH);
  return { ...start, x: round2(cx - start.w / 2), y: round2(cy - start.h / 2) };
}

// Redimensiona en el marco LOCAL (rotado): proyecta el delta de pantalla a los
// ejes de la caja. Dos comportamientos "clásicos":
//   · ESQUINAS (nw/ne/sw/se): proporcional (mantiene la proporción alto/ancho) y
//     desde el CENTRO (el centro no se mueve) — como tirar de la esquina con
//     Shift+Alt en un editor de diseño, pero sin teclas.
//   · LADOS (n/s/e/w): un solo eje, con el borde opuesto fijo.
export function resizeBox(edges, dxMm, dyMm, s, cutW, cutH) {
  const rad = ((s.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = dxMm * cos + dyMm * sin;
  const ly = -dxMm * sin + dyMm * cos;
  const isCorner = (edges.left || edges.right) && (edges.top || edges.bottom);

  if (isCorner) {
    // Centro fijo: cada lado se mueve, así que el tamaño cambia al doble del
    // arrastre. El signo depende de qué esquina se toma.
    const sgnX = edges.right ? 1 : -1;
    const sgnY = edges.bottom ? 1 : -1;
    let w = s.w + 2 * sgnX * lx;
    let h = s.h + 2 * sgnY * ly;
    const ar = (s.w / s.h) || 1;
    // Bloquea la proporción usando el eje que más se movió (se siente natural).
    if (Math.abs(w / s.w - 1) >= Math.abs(h / s.h - 1)) h = w / ar; else w = h * ar;
    w = Math.max(2, w);
    h = Math.max(1, h);
    // Acota a la hoja manteniendo la proporción (dos pasadas: al corregir un
    // eje puede pasarse el otro).
    if (w > cutW) { w = cutW; h = w / ar; }
    if (h > cutH) { h = cutH; w = h * ar; }
    if (w > cutW) { w = cutW; h = w / ar; }
    const { cx, cy } = clampCenterRotated(s.x + s.w / 2, s.y + s.h / 2, w, h, s.rotation, cutW, cutH);
    return { x: round2(cx - w / 2), y: round2(cy - h / 2), w: round2(w), h: round2(h), rotation: s.rotation || 0 };
  }

  let w = s.w;
  let h = s.h;
  let shiftLx = 0;
  let shiftLy = 0;
  if (edges.right) { w = s.w + lx; shiftLx = lx / 2; }
  if (edges.left) { w = s.w - lx; shiftLx = lx / 2; }
  if (edges.bottom) { h = s.h + ly; shiftLy = ly / 2; }
  if (edges.top) { h = s.h - ly; shiftLy = ly / 2; }
  w = Math.max(2, Math.min(w, cutW));
  h = Math.max(1, Math.min(h, cutH));
  const sx = shiftLx * cos - shiftLy * sin;
  const sy = shiftLx * sin + shiftLy * cos;
  const { cx, cy } = clampCenterRotated(s.x + s.w / 2 + sx, s.y + s.h / 2 + sy, w, h, s.rotation, cutW, cutH);
  return { x: round2(cx - w / 2), y: round2(cy - h / 2), w: round2(w), h: round2(h), rotation: s.rotation || 0 };
}

// Recuadro ocupando casi todo el rótulo (deja un margen).
export function fullLabelBox(cutW, cutH, marginMm = 0.5) {
  return { x: marginMm, y: marginMm, w: round2(cutW - 2 * marginMm), h: round2(cutH - 2 * marginMm), rotation: 0 };
}
