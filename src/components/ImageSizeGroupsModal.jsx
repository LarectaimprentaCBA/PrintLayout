import { useEffect, useMemo, useState } from 'react';

// "Cantidad por foto (por tamaño)": para plantillas de MEDIDAS MEZCLADAS.
// Tablero de 2 columnas:
//   IZQUIERDA  = los TAMAÑOS (casilleros agrupados por medida).
//   DERECHA    = las FOTOS cargadas (miniaturas grandes, con zoom al pasar el
//                mouse porque a veces cambian en detalles chicos).
// Se lleva cada foto a un tamaño (arrastrando, o eligiendo el tamaño y clickeando
// la foto) y ahí se elige la cantidad. Un "rellenar parejo" por tamaño completa
// el resto de ese tamaño repartiendo entre las fotos que le pusiste.
//
// Devuelve un plan { [groupKey]: [imageId, ...] } (largo ≤ casilleros de ese
// tamaño); el caller mapea cada secuencia a las celdas de ese tamaño.
//
// groups: [{ key, w, h, shape, count }]  (count = casilleros de ese tamaño)
export default function ImageSizeGroupsModal({
  open,
  images = [],
  groups = [],
  onConfirm,
  onCancel,
}) {
  // state[groupKey] = { picks: [{ imageId, qty }], fill: bool }
  const [state, setState] = useState({});
  const [activeKey, setActiveKey] = useState(groups[0]?.key ?? null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null);

  useEffect(() => {
    if (!open) return;
    const init = {};
    for (const g of groups) init[g.key] = { picks: [], fill: false };
    setState(init);
    setActiveKey(groups[0]?.key ?? null);
  }, [open, groups]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) setHoverPreview(null);
  }, [open]);

  const imgById = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);
  const groupLabel = (g) => (g.shape === 'circle' ? `⌀ ${g.w} mm` : `${g.w} × ${g.h} mm`);

  const addPick = (gkey, imageId) => {
    setState((prev) => {
      const grp = prev[gkey] || { picks: [], fill: false };
      const picks = grp.picks.slice();
      const i = picks.findIndex((p) => p.imageId === imageId);
      if (i >= 0) picks[i] = { ...picks[i], qty: picks[i].qty + 1 };
      else picks.push({ imageId, qty: 1 });
      return { ...prev, [gkey]: { ...grp, picks } };
    });
  };
  const setQty = (gkey, imageId, value) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setState((prev) => {
      const grp = prev[gkey] || { picks: [], fill: false };
      let picks = grp.picks.slice();
      const i = picks.findIndex((p) => p.imageId === imageId);
      if (i < 0) {
        if (n > 0) picks.push({ imageId, qty: n });
      } else if (n <= 0) {
        picks = picks.filter((p) => p.imageId !== imageId);
      } else {
        picks[i] = { ...picks[i], qty: n };
      }
      return { ...prev, [gkey]: { ...grp, picks } };
    });
  };
  const bump = (gkey, imageId, delta) => {
    const grp = state[gkey] || { picks: [] };
    const cur = grp.picks.find((p) => p.imageId === imageId)?.qty || 0;
    setQty(gkey, imageId, cur + delta);
  };
  const removePick = (gkey, imageId) => setQty(gkey, imageId, 0);
  const setFill = (gkey, val) =>
    setState((prev) => ({ ...prev, [gkey]: { ...(prev[gkey] || { picks: [] }), fill: val } }));

  // Secuencia final de imageIds para un grupo (explícitas en orden + relleno
  // parejo round-robin), recortada a la cantidad de casilleros del grupo.
  const buildSeqForGroup = (g) => {
    const st = state[g.key] || { picks: [], fill: false };
    const seq = [];
    for (const p of st.picks) {
      const q = Math.max(0, Math.floor(Number(p.qty) || 0));
      for (let k = 0; k < q && seq.length < g.count; k++) seq.push(p.imageId);
    }
    if (st.fill && seq.length < g.count) {
      const pool = st.picks.length > 0 ? st.picks.map((p) => p.imageId) : images.map((i) => i.id);
      if (pool.length > 0) {
        let i = 0;
        while (seq.length < g.count) { seq.push(pool[i % pool.length]); i += 1; }
      }
    }
    return seq;
  };

  const summaries = useMemo(() => {
    const m = {};
    for (const g of groups) m[g.key] = { used: buildSeqForGroup(g).length, total: g.count };
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, groups, images]);

  const totalUsed = Object.values(summaries).reduce((s, x) => s + (x?.used || 0), 0);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    if (totalUsed <= 0) return;
    const plan = {};
    for (const g of groups) plan[g.key] = buildSeqForGroup(g);
    onConfirm?.(plan);
  };

  const showZoom = (e, img) => img?.dataUrl && setHoverPreview({ url: img.dataUrl, name: img.name || 'foto', x: e.clientX, y: e.clientY });
  const moveZoom = (e) => setHoverPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p));
  const hideZoom = () => setHoverPreview(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="flex max-h-[92vh] w-[64rem] max-w-[95vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
      >
        <div className="border-b border-ink-700 p-4">
          <h3 className="text-sm font-semibold text-ink-100">Cantidad por foto (por tamaño)</h3>
          <p className="mt-1 text-xs text-ink-400">
            Elegí un tamaño a la izquierda y clickeá (o arrastrá) las fotos de la
            derecha para llevarlas a ese tamaño; después ajustá la cantidad. Tildá
            <span className="text-ink-200"> "rellenar parejo"</span> para completar el
            resto de ese tamaño repartiendo entre las fotos que le pusiste.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* IZQUIERDA: tamaños */}
          <div className="flex w-[24rem] shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-950/40 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-ink-500">Tamaños de casillero</p>
            {groups.length === 0 ? (
              <p className="text-xs text-ink-400">Esta plantilla no tiene casilleros.</p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => {
                  const st = state[g.key] || { picks: [], fill: false };
                  const sum = summaries[g.key] || { used: 0, total: g.count };
                  const over = sum.used > g.count;
                  const active = activeKey === g.key;
                  const dropping = dragOverKey === g.key;
                  return (
                    <div
                      key={g.key}
                      onClick={() => setActiveKey(g.key)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverKey(g.key); }}
                      onDragLeave={() => setDragOverKey((k) => (k === g.key ? null : k))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData('text/plain');
                        if (id) { addPick(g.key, id); setActiveKey(g.key); }
                        setDragOverKey(null);
                      }}
                      className={`cursor-pointer rounded-lg border p-2 transition ${
                        dropping
                          ? 'border-accent-400 bg-accent-600/15 ring-2 ring-accent-500/40'
                          : active
                            ? 'border-accent-600/60 bg-accent-600/5'
                            : 'border-ink-700 bg-ink-800 hover:border-ink-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-base leading-none text-ink-300">
                            {g.shape === 'circle' ? '◯' : '▭'}
                          </span>
                          <span className="font-semibold text-ink-100">{groupLabel(g)}</span>
                        </div>
                        <span className={`text-[11px] ${over ? 'text-amber-400' : 'text-ink-400'}`}>
                          {sum.used}/{g.count}
                        </span>
                      </div>

                      {/* Fotos asignadas a este tamaño */}
                      {st.picks.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {st.picks.map((p) => {
                            const img = imgById.get(p.imageId);
                            return (
                              <li key={p.imageId} className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900 p-1">
                                <div
                                  className="h-9 w-9 shrink-0 overflow-hidden rounded bg-ink-700 ring-1 ring-ink-600 cursor-zoom-in"
                                  onMouseEnter={(e) => showZoom(e, img)}
                                  onMouseMove={moveZoom}
                                  onMouseLeave={hideZoom}
                                >
                                  {img?.dataUrl && <img src={img.dataUrl} alt="" className="h-full w-full object-contain" draggable={false} />}
                                </div>
                                <span className="flex-1 truncate text-[10px] text-ink-300" title={img?.name}>
                                  {img?.name || 'foto'}
                                </span>
                                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <button type="button" onClick={() => bump(g.key, p.imageId, -1)} className="h-6 w-6 rounded border border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700">−</button>
                                  <input
                                    type="number" min="0" value={p.qty}
                                    onChange={(e) => setQty(g.key, p.imageId, e.target.value)}
                                    className="w-10 rounded border border-ink-700 bg-ink-800 px-1 py-0.5 text-center text-xs text-ink-100 outline-none focus:border-accent-500"
                                  />
                                  <button type="button" onClick={() => bump(g.key, p.imageId, 1)} className="h-6 w-6 rounded border border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700">+</button>
                                  <button type="button" onClick={() => removePick(g.key, p.imageId)} title="Quitar" className="ml-0.5 text-ink-500 hover:text-red-300">✕</button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-ink-300" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={!!st.fill} onChange={(e) => setFill(g.key, e.target.checked)} className="accent-accent-600" />
                        <span>
                          Rellenar el resto parejo
                          {sum.total - sum.used > 0 && !over && <span className="text-ink-500"> (quedan {sum.total - sum.used})</span>}
                        </span>
                      </label>
                      {over && (
                        <p className="mt-1 text-[10px] text-amber-400">
                          Pediste más que los {g.count} casilleros: se usan los primeros {g.count}.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* DERECHA: fotos */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-ink-500">Fotos cargadas</p>
              {activeKey && (
                <p className="text-[11px] text-ink-400">
                  Clickeá para agregar a{' '}
                  <span className="font-semibold text-accent-300">
                    {(() => { const g = groups.find((x) => x.key === activeKey); return g ? groupLabel(g) : ''; })()}
                  </span>
                </p>
              )}
            </div>
            {images.length === 0 ? (
              <p className="p-4 text-center text-xs text-ink-400">No hay fotos cargadas. Cargá fotos primero.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', img.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => { if (activeKey) addPick(activeKey, img.id); }}
                    disabled={!activeKey}
                    title={activeKey ? 'Agregar a este tamaño (o arrastrá al tamaño)' : 'Elegí un tamaño a la izquierda'}
                    className="group relative flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-800 p-1.5 text-left hover:border-accent-500/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div
                      className="aspect-square w-full overflow-hidden rounded bg-ink-700 ring-1 ring-ink-600 cursor-zoom-in"
                      onMouseEnter={(e) => showZoom(e, img)}
                      onMouseMove={moveZoom}
                      onMouseLeave={hideZoom}
                    >
                      {img.dataUrl && <img src={img.dataUrl} alt="" className="h-full w-full object-contain" draggable={false} />}
                    </div>
                    <span className="mt-1 line-clamp-2 break-all text-[10px] leading-tight text-ink-300" title={img.name}>
                      {img.name || 'foto'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          <span className="mr-auto text-xs text-ink-300">
            Total:{' '}
            <span className="font-semibold text-accent-400">{totalUsed}</span>{' '}
            casillero{totalUsed === 1 ? '' : 's'} con foto
          </span>
          <button type="button" onClick={() => onCancel?.()} className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">
            Cancelar
          </button>
          <button type="submit" disabled={totalUsed <= 0} className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
            Acomodar
          </button>
        </div>
      </form>

      {hoverPreview && (() => {
        const BOX = 360;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        let left = hoverPreview.x + 24;
        if (left + BOX > vw - 8) left = hoverPreview.x - BOX - 24;
        if (left < 8) left = 8;
        let top = hoverPreview.y - BOX / 2;
        top = Math.max(8, Math.min(top, vh - BOX - 8));
        return (
          <div
            className="pointer-events-none fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-ink-600 bg-ink-950/95 p-2 shadow-2xl ring-1 ring-black/40"
            style={{ left, top, width: BOX }}
          >
            <img src={hoverPreview.url} alt="" className="max-h-[320px] w-full rounded object-contain" draggable={false} />
            <span className="mt-1.5 break-all text-center text-[11px] text-ink-200">{hoverPreview.name}</span>
          </div>
        );
      })()}
    </div>
  );
}
