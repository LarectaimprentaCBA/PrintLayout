import { useEffect, useMemo, useState } from 'react';
import { dobbleGeometryFromTemplate } from '../dobble/buildDobbleJob.js';

// Modal de POSADO de un mazo Dobble: elegí sobre qué plantilla redonda posar las
// cartas (lista de plantillas guardadas con corte circular) o creá una nueva.
// La plantilla define hoja / márgenes / separación / diámetro de celda / corte;
// el ⌀ de la carta sale de la celda. Mismo principio que stickers: integrarse al
// flujo de plantillas que ya usás, no un asistente paralelo.
export default function DobblePoseModal({
  open,
  receta,
  templates = [],
  busy = false,
  onPickTemplate,
  onCreateTemplate,
  onClose,
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const cartas = receta?.cartas?.length ?? 0;
  const n = receta?.mazo?.n ?? '?';
  const doble = !!receta?.dorso;

  // Plantillas aptas: corte circular + geometría válida. Cada una con su ⌀ de
  // carta derivado y cuántas hojas necesitaría este mazo.
  const aptas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates
      .filter((t) => (t.cutShape ?? 'rect') === 'circle')
      .map((t) => ({ t, geo: dobbleGeometryFromTemplate(t) }))
      .filter(({ geo }) => geo.ok)
      .filter(({ t }) =>
        !q || `${t.name || ''} ${t.categoria || ''}`.toLowerCase().includes(q))
      .map(({ t, geo }) => ({
        t,
        geo,
        hojas: Math.max(1, Math.ceil(cartas / geo.cellsPerPage)),
      }))
      .sort((a, b) => (a.t.name || '').localeCompare(b.t.name || ''));
  }, [templates, query, cartas]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div className="flex max-h-[85vh] w-[600px] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">Posar mazo Dobble</h3>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            className="text-ink-400 hover:text-ink-100"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-ink-700 px-4 py-2.5 text-xs text-ink-300">
          Mazo <span className="font-semibold text-ink-100">n{n}</span> ·{' '}
          <span className="text-ink-100">{cartas}</span> carta{cartas === 1 ? '' : 's'}
          {doble && <span className="ml-1 text-accent-300">· doble faz</span>}
          <div className="mt-0.5 text-[11px] text-ink-500">
            Elegí la plantilla redonda sobre la que se posan las cartas. El diámetro de la
            carta sale de la celda de la plantilla.
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar plantilla redonda…"
            className="flex-1 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
            autoFocus
          />
          <button
            type="button"
            onClick={() => onCreateTemplate?.()}
            disabled={busy}
            className="shrink-0 rounded border border-accent-500/40 bg-accent-500/10 px-3 py-1.5 text-xs font-medium text-accent-200 hover:bg-accent-500/20 disabled:opacity-40"
            title="Crear una plantilla con corte circular y posar el mazo encima"
          >
            + Crear plantilla redonda…
          </button>
        </div>

        <div className="min-h-[8rem] flex-1 overflow-y-auto px-3 py-2">
          {aptas.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-ink-400">
              {templates.some((t) => (t.cutShape ?? 'rect') === 'circle')
                ? 'Ninguna plantilla redonda coincide con la búsqueda.'
                : 'Todavía no tenés plantillas redondas.'}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => onCreateTemplate?.()}
                  disabled={busy}
                  className="rounded border border-accent-500/40 bg-accent-500/10 px-3 py-1.5 text-[11px] font-medium text-accent-200 hover:bg-accent-500/20 disabled:opacity-40"
                >
                  + Crear una ahora
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-1">
              {aptas.map(({ t, geo, hojas }) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPickTemplate?.(t.id)}
                    className="group flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left hover:border-ink-700 hover:bg-ink-800 disabled:opacity-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent-500/40 text-[10px] font-semibold text-accent-300">
                      ⌀
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-100">
                        <span className="truncate">{t.name}</span>
                        {t.dobbleFondo && (
                          <span className="shrink-0 rounded bg-accent-500/15 px-1 text-[9px] text-accent-300" title="Tiene fondo de carta configurado">
                            fondo
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-400">
                        carta ⌀ {geo.diam} mm · sangrado {geo.bleed} mm ·{' '}
                        {geo.cellsPerPage}/hoja · {hojas} hoja{hojas === 1 ? '' : 's'}
                        <span className="ml-1 text-ink-500">
                          · {Math.round(t.pageWidthMm)}×{Math.round(t.pageHeightMm)} mm
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-accent-400 opacity-0 transition group-hover:opacity-100">
                      Posar →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
            disabled={busy}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
