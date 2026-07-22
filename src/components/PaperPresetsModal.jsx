import { useEffect, useRef, useState } from 'react';

function parseNum(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const emptyForm = { id: null, label: '', w: '', h: '' };

// Editor de tamanos de hoja personalizados. Muestra los built-in (read-only)
// y permite agregar/editar/borrar los custom. Boton de sincronizar con GitHub
// (pull + push) si el build tiene token.
//
// Props:
//   open: bool
//   builtinPresets: array<{ id, label, w, h }>
//   customPresets: array<{ id, label, w, h, sharedAt?, sharedHash? }>
//   canSync: bool
//   onSave: async (preset) => savedPreset
//   onDelete: async (id) => void
//   onSyncPull: async () => { ok, added?, updated?, error? }
//   onSyncPush: async () => { ok, count?, error? }
//   onClose: () => void
export default function PaperPresetsModal({
  open,
  builtinPresets = [],
  customPresets = [],
  canSync = false,
  onSave,
  onDelete,
  onSyncPull,
  onSyncPush,
  onClose,
}) {
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState(null); // { kind, text }
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const labelRef = useRef(null);

  useEffect(() => {
    if (open) {
      setForm(emptyForm);
      setMessage(null);
      setBusy(false);
      setSyncing(false);
      setTimeout(() => labelRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const valid = (() => {
    const label = (form.label || '').trim();
    const w = parseNum(form.w);
    const h = parseNum(form.h);
    return label.length > 0 && w !== null && w > 0 && h !== null && h > 0;
  })();

  const startEdit = (preset) => {
    setForm({
      id: preset.id,
      label: preset.label,
      w: String(preset.w),
      h: String(preset.h),
    });
    setMessage(null);
    setTimeout(() => labelRef.current?.focus(), 0);
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        label: form.label.trim(),
        w: parseNum(form.w),
        h: parseNum(form.h),
      };
      if (form.id) payload.id = form.id;
      await onSave(payload);
      setForm(emptyForm);
      setMessage({
        kind: 'success',
        text: form.id ? 'Preset actualizado.' : 'Preset agregado.',
      });
      setTimeout(() => labelRef.current?.focus(), 0);
    } catch (err) {
      setMessage({ kind: 'error', text: `Error: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (preset) => {
    if (!confirm(`Borrar "${preset.label}"?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await onDelete(preset.id);
      if (form.id === preset.id) setForm(emptyForm);
      setMessage({ kind: 'success', text: 'Preset borrado.' });
    } catch (err) {
      setMessage({ kind: 'error', text: `Error: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      const pulled = await onSyncPull?.();
      if (pulled && !pulled.ok) {
        setMessage({ kind: 'error', text: `Pull fallo: ${pulled.error || '?'}` });
        return;
      }
      const pushed = await onSyncPush?.();
      if (pushed && !pushed.ok) {
        setMessage({ kind: 'error', text: `Push fallo: ${pushed.error || '?'}` });
        return;
      }
      const a = pulled?.added?.length ?? 0;
      const u = pulled?.updated?.length ?? 0;
      const c = pushed?.count ?? 0;
      const parts = [];
      if (a) parts.push(`${a} nuevo${a === 1 ? '' : 's'} bajado${a === 1 ? '' : 's'}`);
      if (u) parts.push(`${u} actualizado${u === 1 ? '' : 's'}`);
      parts.push(`${c} subido${c === 1 ? '' : 's'}`);
      setMessage({ kind: 'success', text: `Sync OK · ${parts.join(', ')}.` });
    } catch (err) {
      setMessage({ kind: 'error', text: `Sync fallo: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  };

  const formTitle = form.id ? 'Editar preset' : 'Nuevo preset';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[32rem] max-h-[85vh] overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-100">Tama&ntilde;os de hoja</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            aria-label="Cerrar"
          >
            &#10005;
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-400">
          Tus tama&ntilde;os personalizados se guardan en esta PC. Sincroniz&aacute;
          para compartirlos con las otras m&aacute;quinas.
        </p>

        {/* Form */}
        <form onSubmit={submit} className="mt-4 rounded border border-ink-700 bg-ink-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-200">{formTitle}</span>
            {form.id && (
              <button
                type="button"
                onClick={() => setForm(emptyForm)}
                className="text-[10px] text-ink-400 hover:text-ink-100"
              >
                cancelar edici&oacute;n
              </button>
            )}
          </div>
          <div className="grid grid-cols-[1fr_5rem_5rem_auto] items-end gap-2 text-xs text-ink-300">
            <label>
              <span className="block mb-1">Nombre</span>
              <input
                ref={labelRef}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Polaroid 9x9"
                className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <label>
              <span className="block mb-1">Ancho (mm)</span>
              <input
                value={form.w}
                onChange={(e) => setForm({ ...form, w: e.target.value })}
                placeholder="90"
                className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <label>
              <span className="block mb-1">Alto (mm)</span>
              <input
                value={form.h}
                onChange={(e) => setForm({ ...form, h: e.target.value })}
                placeholder="90"
                className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
            </label>
            <button
              type="submit"
              disabled={!valid || busy}
              className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
            >
              {form.id ? 'Guardar' : 'Agregar'}
            </button>
          </div>
        </form>

        {/* Mensaje inline */}
        {message && (
          <div
            className={`mt-3 rounded border px-3 py-1.5 text-xs ${
              message.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-red-500/40 bg-red-500/10 text-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Lista */}
        <div className="mt-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">
            Predeterminados
          </p>
          <ul className="space-y-1">
            {builtinPresets.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border border-ink-800 bg-ink-900/50 px-3 py-1.5 text-xs"
              >
                <span className="text-ink-200">
                  {p.label}
                  <span className="ml-2 text-ink-500">({p.w}&times;{p.h} mm)</span>
                </span>
                <span className="text-[10px] uppercase tracking-wide text-ink-600">
                  default
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 mb-1 text-[10px] uppercase tracking-wide text-ink-500">
            Personalizados ({customPresets.length})
          </p>
          {customPresets.length === 0 ? (
            <p className="rounded border border-dashed border-ink-700 px-3 py-3 text-center text-xs text-ink-500">
              A&uacute;n no agregaste ning&uacute;n tama&ntilde;o personalizado.
            </p>
          ) : (
            <ul className="space-y-1">
              {customPresets.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border border-ink-700 bg-ink-800/50 px-3 py-1.5 text-xs"
                >
                  <span className="text-ink-200">
                    {p.label}
                    <span className="ml-2 text-ink-500">({p.w}&times;{p.h} mm)</span>
                    {p.sharedHash && (
                      <span
                        className="ml-2 text-[9px] uppercase tracking-wide text-emerald-400/80"
                        title="Sincronizado con el repo"
                      >
                        sync
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      disabled={busy}
                      className="rounded border border-ink-700 px-2 py-0.5 text-[10px] text-ink-300 hover:bg-ink-700 disabled:opacity-40"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      disabled={busy}
                      className="rounded border border-red-700/60 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40 disabled:opacity-40"
                    >
                      Borrar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-ink-700 pt-3">
          <div className="text-[10px] text-ink-500">
            {canSync
              ? 'Sync con GitHub habilitado en este build.'
              : 'Sync deshabilitado (build sin token).'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runSync}
              disabled={!canSync || syncing || busy}
              className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
              title={
                canSync
                  ? 'Baja cambios del repo y luego sube tus presets.'
                  : 'Este build no tiene token de GitHub.'
              }
            >
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
