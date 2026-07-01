import { useEffect, useMemo, useState } from 'react';
import { dobbleCardCapacity } from '../dobble/buildDobbleJob.js';

// Config del combo "Mazo Dobble" de 3 hojas: elegís 2 plantillas de Corel ya
// guardadas — A = hoja de cartas (se usa ×2 → hojas 1 y 2) + B = hoja cartas+caja
// (→ hoja 3). Queda guardado como una plantilla multi-hoja reutilizable
// (pages=[A,A,B], cada hoja con su propio fondo/QR). Un solo import posa las 3.
export default function DobbleComboModal({ open, templates = [], busy = false, onConfirm, onCancel }) {
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [name, setName] = useState('Mazo Dobble (3 hojas)');

  // Candidatas: plantillas PDF-base (traen su fondo con QR) con celdas de carta.
  const candidatas = useMemo(
    () => templates
      .filter((t) => t.pdfBase64 && Array.isArray(t.celdas) && t.celdas.length > 0)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [templates],
  );

  useEffect(() => {
    if (!open) return;
    setName('Mazo Dobble (3 hojas)');
    setAId((prev) => prev || '');
    setBId((prev) => prev || '');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const A = candidatas.find((t) => t.id === aId) || null;
  const B = candidatas.find((t) => t.id === bId) || null;
  const capA = A ? dobbleCardCapacity(A) : null;
  const capB = B ? dobbleCardCapacity(B) : null;
  const sameSize = A && B
    && Math.round(A.pageWidthMm) === Math.round(B.pageWidthMm)
    && Math.round(A.pageHeightMm) === Math.round(B.pageHeightMm);
  const totalCards = (capA ? capA.cardCells * 2 : 0) + (capB ? capB.cardCells : 0);
  const valido = !!A && !!B && aId !== bId && sameSize && name.trim();

  const submit = (e) => {
    e?.preventDefault();
    if (!valido || busy) return;
    onConfirm?.({ aId, bId, name: name.trim() });
  };

  const Select = ({ label, value, onChange, hint }) => (
    <label className="block text-xs text-ink-300">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
      >
        <option value="">— elegir plantilla —</option>
        {candidatas.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.doubleSided ? ' · doble faz' : ''} · {t.celdas.length} celdas
          </option>
        ))}
      </select>
      {hint && <span className="mt-1 block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form onSubmit={submit} className="w-[30rem] max-w-[95vw] rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="border-b border-ink-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-ink-100">Combo Mazo Dobble — 3 hojas</h3>
          <p className="mt-1 text-[11px] text-ink-400">
            Elegí 2 plantillas de Corel. La app posa el mazo en las 3 hojas y el corte/QR
            los maneja el plotter. Se guarda para reusar en cada mazo.
          </p>
        </div>

        <div className="space-y-3 px-4 py-4">
          {candidatas.length === 0 ? (
            <p className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-2 text-[11px] text-amber-200">
              No hay plantillas de PDF con celdas. Subí primero las 2 plantillas de Corel
              (Nuevo trabajo → Subir PDF de plantilla).
            </p>
          ) : (
            <>
              <Select
                label="Hoja A — cartas (se usa en las hojas 1 y 2)"
                value={aId}
                onChange={setAId}
                hint={capA ? `${capA.cardCells} cartas por hoja → ${capA.cardCells * 2} en las 2 hojas` : undefined}
              />
              <Select
                label="Hoja B — cartas + caja (hoja 3)"
                value={bId}
                onChange={setBId}
                hint={capB ? `${capB.cardCells} cartas + caja (la caja va en blanco; la corta el plotter)` : undefined}
              />
              <label className="block text-xs text-ink-300">
                <span className="mb-1 block">Nombre del combo</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                />
              </label>

              {A && B && aId === bId && (
                <p className="text-[11px] text-amber-300">A y B tienen que ser plantillas distintas.</p>
              )}
              {A && B && !sameSize && (
                <p className="text-[11px] text-amber-300">A y B tienen distinto tamaño de hoja.</p>
              )}
              {valido && (
                <div className="rounded border border-ink-700 bg-ink-800 p-2 text-[11px] text-ink-400">
                  3 hojas · fondo A en hojas 1-2, fondo B en hoja 3 · capacidad{' '}
                  <span className="text-ink-200">{totalCards}</span> cartas.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={() => onCancel?.()}
            disabled={busy}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valido || busy}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            {busy ? 'Armando…' : 'Crear y posar'}
          </button>
        </div>
      </form>
    </div>
  );
}
