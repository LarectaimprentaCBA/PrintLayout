import { useMemo } from 'react';

// Vista previa SVG de la grilla sobre la hoja. Todas las dimensiones de entrada
// son en mm; el SVG usa viewBox en mm y se escala al contenedor con tamano fisico
// en px para conservar proporciones reales hoja vs preview.
//
// Capas (atras → adelante):
//   1) Hoja (fondo blanco + borde)
//   2) Margen util (punteado, si margin > 0)
//   3) Marcas L de registro (si markMarginMm > 0)
//   4) Celdas (rect u ovalo segun cutShape)
//   5) Lineas de corte (rect/circulo achicado por cutMarginMm)
//
// Si no entra ninguna celda, muestra solo la hoja con un texto centrado.

const DEFAULT_MAX_W = 380; // px
const DEFAULT_MAX_H = 240; // px

const COLOR_PAPER_FILL = '#f1f5f9';   // slate-100
const COLOR_PAPER_STROKE = '#475569'; // slate-600
const COLOR_MARGIN = '#94a3b8';       // slate-400 punteado
const COLOR_MARK = '#ef4444';         // red-500
const COLOR_CELL = '#06b6d4';         // cyan-500 (accent)
const COLOR_CUT = '#dc2626';          // red-600 punteado

const MARK_LEN_MM = 5;

export default function GridPreview({
  paperW,
  paperH,
  cells = [],
  marginX = 0,
  marginY = 0,
  cutShape = 'rect',
  cutMarginMm = 0,
  markMarginMm = 0,
  bottomReserveMm = 0,
  maxW = DEFAULT_MAX_W,
  maxH = DEFAULT_MAX_H,
}) {
  const ok = paperW > 0 && paperH > 0;

  const { renderW, renderH } = useMemo(() => {
    if (!ok) return { renderW: 0, renderH: 0 };
    const s = Math.min(maxW / paperW, maxH / paperH);
    return { renderW: paperW * s, renderH: paperH * s };
  }, [paperW, paperH, ok, maxW, maxH]);

  if (!ok) {
    return (
      <div
        className="flex items-center justify-center rounded border border-ink-700 bg-ink-800 text-[10px] text-ink-500"
        style={{ width: maxW, height: 120 }}
      >
        Ingres&aacute; tama&ntilde;o de hoja v&aacute;lido
      </div>
    );
  }

  const reserve = Math.max(0, Number(bottomReserveMm) || 0);
  const usableW = paperW - 2 * marginX;
  const usableH = paperH - 2 * marginY - reserve;
  const showMargin = (marginX > 0 || marginY > 0) && usableW > 0 && usableH > 0;
  const showMarks = markMarginMm > 0;
  const showCutLines = cutMarginMm > 0 && cells.length > 0;
  // Franja reservada para el QR de corte (banda inferior). Va desde donde
  // terminan las celdas hasta el borde inferior de la hoja.
  const showReserve = reserve > 0 && paperH > 0;
  const reserveY = paperH - marginY - reserve;

  // Marcas L: 4 esquinas, cada una con 2 lineas perpendiculares apuntando al
  // interior del area imprimible.
  const marks = [];
  if (showMarks) {
    const m = markMarginMm;
    const L = MARK_LEN_MM;
    // TL
    marks.push([m, m, m + L, m]);
    marks.push([m, m, m, m + L]);
    // TR
    marks.push([paperW - m, m, paperW - m - L, m]);
    marks.push([paperW - m, m, paperW - m, m + L]);
    // BL
    marks.push([m, paperH - m, m + L, paperH - m]);
    marks.push([m, paperH - m, m, paperH - m - L]);
    // BR
    marks.push([paperW - m, paperH - m, paperW - m - L, paperH - m]);
    marks.push([paperW - m, paperH - m, paperW - m, paperH - m - L]);
  }

  return (
    <svg
      viewBox={`0 0 ${paperW} ${paperH}`}
      width={renderW}
      height={renderH}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
    >
      {/* 1) Hoja */}
      <rect
        x={0}
        y={0}
        width={paperW}
        height={paperH}
        fill={COLOR_PAPER_FILL}
        stroke={COLOR_PAPER_STROKE}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {/* 2) Margen util (punteado) */}
      {showMargin && (
        <rect
          x={marginX}
          y={marginY}
          width={usableW}
          height={usableH}
          fill="none"
          stroke={COLOR_MARGIN}
          strokeWidth={1}
          strokeDasharray="3,3"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* 2b) Franja reservada para el QR de corte */}
      {showReserve && (
        <>
          <rect
            x={0}
            y={reserveY}
            width={paperW}
            height={paperH - reserveY}
            fill="rgba(245,158,11,0.10)"
            stroke="rgba(245,158,11,0.55)"
            strokeWidth={1}
            strokeDasharray="3,3"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={paperW / 2}
            y={(reserveY + paperH) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#b45309"
            fontSize={Math.max(4, Math.min(reserve * 0.6, paperW / 40))}
            fontFamily="ui-sans-serif, system-ui"
          >
            espacio QR
          </text>
        </>
      )}

      {/* 3) Marcas L */}
      {showMarks &&
        marks.map(([x1, y1, x2, y2], i) => (
          <line
            key={`mk-${i}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={COLOR_MARK}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}

      {/* 4) Celdas */}
      {cells.map((c) =>
        cutShape === 'circle' ? (
          <ellipse
            key={`c-${c.id}`}
            cx={c.x + c.w / 2}
            cy={c.y + c.h / 2}
            rx={c.w / 2}
            ry={c.h / 2}
            fill="rgba(6,182,212,0.10)"
            stroke={COLOR_CELL}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <rect
            key={`c-${c.id}`}
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            fill="rgba(6,182,212,0.10)"
            stroke={COLOR_CELL}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}

      {/* 5) Lineas de corte (dentro de cada celda) */}
      {showCutLines &&
        cells.map((c) => {
          const m = cutMarginMm;
          if (cutShape === 'circle') {
            const r = Math.min(c.w, c.h) / 2 - m;
            if (r <= 0) return null;
            return (
              <circle
                key={`ct-${c.id}`}
                cx={c.x + c.w / 2}
                cy={c.y + c.h / 2}
                r={r}
                fill="none"
                stroke={COLOR_CUT}
                strokeWidth={1}
                strokeDasharray="2,2"
                vectorEffect="non-scaling-stroke"
              />
            );
          }
          const w = c.w - 2 * m;
          const h = c.h - 2 * m;
          if (w <= 0 || h <= 0) return null;
          return (
            <rect
              key={`ct-${c.id}`}
              x={c.x + m}
              y={c.y + m}
              width={w}
              height={h}
              fill="none"
              stroke={COLOR_CUT}
              strokeWidth={1}
              strokeDasharray="2,2"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

      {/* Estado vacio */}
      {cells.length === 0 && (
        <text
          x={paperW / 2}
          y={paperH / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#94a3b8"
          fontSize={Math.max(8, paperW / 20)}
          fontFamily="ui-sans-serif, system-ui"
        >
          No entra ninguna celda
        </text>
      )}
    </svg>
  );
}
