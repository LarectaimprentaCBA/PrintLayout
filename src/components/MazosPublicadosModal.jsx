import { useEffect, useState, useCallback } from 'react';

// Panel de gestión de los mazos Dobble publicados en la web /busca2.
// Lista las fichas (tabla mazos_busca2), permite editar (nombre, descripción,
// orden, activo/oculto) y borrar. La preview y el PDF NO se editan acá: para
// cambiarlos se vuelve a "Guardar y publicar mazo" con el mismo identificador.
export default function MazosPublicadosModal({ open, onClose }) {
  const [mazos, setMazos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null); // { nombre, descripcion, orden }
  const [busyId, setBusyId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.printlayout.busca2.listMazos();
      if (res?.ok) setMazos(Array.isArray(res.mazos) ? res.mazos : []);
      else setError(res?.error || 'No se pudieron cargar los mazos.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setEditId(null);
    setDraft(null);
    setConfirmDeleteId(null);
    load();
  }, [open, load]);

  if (!open) return null;

  const startEdit = (m) => {
    setConfirmDeleteId(null);
    setEditId(m.id);
    setDraft({
      nombre: m.nombre || '',
      descripcion: m.descripcion || '',
      orden: String(Number.isFinite(m.orden) ? m.orden : 0),
    });
  };

  const saveEdit = async (m) => {
    if (!draft) return;
    const nombre = draft.nombre.trim();
    if (!nombre) { setError('El nombre no puede quedar vacío.'); return; }
    setBusyId(m.id);
    setError('');
    try {
      const ordenNum = Number.parseInt(draft.orden, 10);
      const res = await window.printlayout.busca2.updateMazo(m.id, {
        nombre,
        descripcion: draft.descripcion.trim(),
        orden: Number.isFinite(ordenNum) ? ordenNum : 0,
      });
      if (res?.ok) { setEditId(null); setDraft(null); await load(); }
      else setError(res?.error || 'No se pudo guardar.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleActivo = async (m) => {
    setBusyId(m.id);
    setError('');
    try {
      const res = await window.printlayout.busca2.updateMazo(m.id, { activo: !m.activo });
      if (res?.ok) await load();
      else setError(res?.error || 'No se pudo cambiar la visibilidad.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (m) => {
    setBusyId(m.id);
    setError('');
    try {
      const res = await window.printlayout.busca2.deleteMazo(m.id);
      if (res?.ok) { setConfirmDeleteId(null); await load(); }
      else setError(res?.error || 'No se pudo borrar.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-[44rem] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Mazos publicados en la web</h3>
            <p className="text-[11px] text-ink-400">
              Editá el nombre, la descripción o el orden. Para cambiar la imagen o el PDF, volvé a
              «Guardar y publicar mazo» con el mismo identificador.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
          >
            Cerrar
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-ink-400">Cargando…</div>
          ) : mazos.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-400">
              Todavía no hay mazos publicados.
            </div>
          ) : (
            <ul className="space-y-2">
              {mazos.map((m) => {
                const isEditing = editId === m.id;
                const isBusy = busyId === m.id;
                const confirming = confirmDeleteId === m.id;
                return (
                  <li
                    key={m.id}
                    className="flex gap-3 rounded border border-ink-700 bg-ink-800/60 p-2.5"
                  >
                    <img
                      src={m.preview_path}
                      alt={m.nombre}
                      className="h-16 w-16 shrink-0 rounded-full border border-ink-700 bg-white object-cover"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    />
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <input
                            value={draft.nombre}
                            onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                            placeholder="Nombre"
                            className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 outline-none focus:border-accent-500"
                          />
                          <textarea
                            value={draft.descripcion}
                            onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })}
                            rows={2}
                            placeholder="Descripción (opcional)"
                            className="w-full resize-none rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                          />
                          <div className="flex items-center gap-2">
                            <label className="text-[11px] text-ink-400">Orden</label>
                            <input
                              type="number"
                              value={draft.orden}
                              onChange={(e) => setDraft({ ...draft, orden: e.target.value })}
                              className="w-20 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-500"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-ink-100">{m.nombre}</span>
                            {!m.activo && (
                              <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300">
                                oculto
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[10px] text-ink-500">{m.id}</div>
                          {m.descripcion && (
                            <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">{m.descripcion}</div>
                          )}
                          <div className="mt-0.5 text-[10px] text-ink-500">orden {m.orden ?? 0}</div>
                        </>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => saveEdit(m)}
                            className="rounded bg-accent-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-500 disabled:opacity-40"
                          >
                            {isBusy ? 'Guardando…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => { setEditId(null); setDraft(null); }}
                            className="rounded border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : confirming ? (
                        <>
                          <span className="text-[11px] text-red-300">¿Borrar?</span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => doDelete(m)}
                            className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-500 disabled:opacity-40"
                          >
                            {isBusy ? 'Borrando…' : 'Sí, borrar'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => startEdit(m)}
                            className="rounded border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => toggleActivo(m)}
                            title={m.activo ? 'Ocultar de la web (sin borrar)' : 'Volver a mostrar en la web'}
                            className="rounded border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
                          >
                            {m.activo ? 'Ocultar' : 'Mostrar'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteId(m.id)}
                            className="rounded border border-red-500/40 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                          >
                            Borrar
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
