import { useEffect, useRef, useState } from 'react';
import { slugifyCatalogId } from '../intake/catalog.js';

// Modal para "Guardar y publicar mazo" a la web /busca2. Pide lo mínimo para que
// cualquiera pueda dejar el mazo listo en la web: nombre (visible), mazo_id
// (default = slug del nombre, editable), descripción (opcional) y orden.
export default function PublishMazoModal({
  open,
  defaultName = '',
  previewUrl = '',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [name, setName] = useState(defaultName);
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [descripcion, setDescripcion] = useState('');
  const [orden, setOrden] = useState('0');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName || '');
    setId(slugifyCatalogId(defaultName || ''));
    setIdTouched(false);
    setDescripcion('');
    setOrden('0');
    setTimeout(() => inputRef.current?.select(), 0);
  }, [open, defaultName]);

  if (!open) return null;

  // Sanitiza a [a-z0-9-] (mismo criterio que el slug de catálogo).
  const sanitizeId = (v) => String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/g, '')
    .slice(0, 40);

  const handleName = (v) => {
    setName(v);
    // El id sigue al nombre hasta que el usuario lo edite a mano.
    if (!idTouched) setId(slugifyCatalogId(v));
  };

  const finalId = idTouched ? sanitizeId(id) : slugifyCatalogId(name);

  const submit = (e) => {
    e?.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !finalId || busy) return;
    const ordenNum = Number.parseInt(orden, 10);
    onConfirm?.({
      nombre: trimmedName,
      id: finalId,
      descripcion: descripcion.trim(),
      orden: Number.isFinite(ordenNum) ? ordenNum : 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel?.(); }}
        className="w-[26rem] rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-ink-100">Guardar y publicar mazo</h3>
        <p className="mt-1 text-[11px] text-ink-400">
          Deja el mazo listo en la web: guarda el PDF, registra el mazo y publica la ficha en el catálogo.
        </p>

        <div className="mt-3 flex gap-3">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Preview del mazo"
              className="h-20 w-20 shrink-0 rounded-full border border-ink-700 bg-white object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <label className="block text-xs text-ink-300">
              <span className="mb-1 block">Nombre (visible en la web)</span>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => handleName(e.target.value)}
                placeholder="Ej: Dobble Colectivos"
                disabled={busy}
                className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-40"
              />
            </label>
          </div>
        </div>

        <label className="mt-3 block text-xs text-ink-300">
          <span className="mb-1 block">Identificador del mazo (para el QR / la web)</span>
          <input
            value={idTouched ? id : finalId}
            onChange={(e) => { setIdTouched(true); setId(sanitizeId(e.target.value)); }}
            placeholder="dobble-colectivos"
            disabled={busy}
            className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 font-mono text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-40"
          />
          <span className="mt-1 block text-[10px] text-ink-500">
            Se arma solo con el nombre. Si republicás el mismo identificador, se pisa el mazo anterior.
          </span>
        </label>

        <label className="mt-3 block text-xs text-ink-300">
          <span className="mb-1 block">Descripción (opcional)</span>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            placeholder="Texto corto que se muestra debajo del nombre."
            disabled={busy}
            className="w-full resize-none rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-40"
          />
        </label>

        <label className="mt-3 block text-xs text-ink-300">
          <span className="mb-1 block">Orden en el catálogo (menor = primero)</span>
          <input
            type="number"
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
            disabled={busy}
            className="w-24 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-40"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !finalId || busy}
            className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          >
            {busy ? 'Publicando…' : 'Guardar y publicar'}
          </button>
        </div>
      </form>
    </div>
  );
}
