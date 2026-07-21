import { useCallback, useEffect, useRef, useState } from 'react';
import { clampCenterRotated, sanitizeBox } from '../rotulos/boxEditing.js';

// Gestor de "Rótulos escolares" — Fase 1: CARGAR.
//   · Tipografías: subir/validar/listar/eliminar fuentes .ttf/.otf.
//   · Modelos: por cada tamaño (GRANDE/INTERMEDIO/CHICO) el usuario sube UNA
//     imagen del arte y dibuja a mano el rectángulo donde va el nombre. Son 3
//     imágenes sueltas (no PDF). Se guarda la caja en mm, relativa al rótulo.
// NO genera nada (sin texto, plancha, corte ni QR): eso va en otra orden.

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : '?');

// Tamaños fijos del sistema (corte redondeado, en mm).
const SIZES = [
  { key: 'grande', label: 'Grande', cutW: 60, cutH: 40, radius: 3.15 },
  { key: 'intermedio', label: 'Intermedio', cutW: 40, cutH: 20, radius: 1.57 },
  { key: 'chico', label: 'Chico', cutW: 40, cutH: 7, radius: 1.47 },
];
const SIZE_KEYS = SIZES.map((s) => s.key);
const sizeDef = (key) => SIZES.find((s) => s.key === key);

// Handles de resize: 4 lados + 4 esquinas.
const RESIZE_HANDLES = [
  { dir: 'n', pos: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cur: 'cursor-ns-resize' },
  { dir: 's', pos: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cur: 'cursor-ns-resize' },
  { dir: 'w', pos: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cur: 'cursor-ew-resize' },
  { dir: 'e', pos: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cur: 'cursor-ew-resize' },
  { dir: 'nw', pos: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cur: 'cursor-nwse-resize' },
  { dir: 'ne', pos: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cur: 'cursor-nesw-resize' },
  { dir: 'sw', pos: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cur: 'cursor-nesw-resize' },
  { dir: 'se', pos: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cur: 'cursor-nwse-resize' },
];
const RESIZE_EDGES = {
  n: { top: true }, s: { bottom: true }, w: { left: true }, e: { right: true },
  nw: { top: true, left: true }, ne: { top: true, right: true },
  sw: { bottom: true, left: true }, se: { bottom: true, right: true },
};

const extFromFile = (file) => {
  const t = (file?.type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  return (file?.name || '').toLowerCase().endsWith('.png') ? 'png' : 'jpg';
};

// Caja por defecto en la parte baja del rótulo (el usuario la mueve).
function defaultBox(cutW, cutH) {
  const w = round2(cutW * 0.8);
  const h = round2(Math.min(cutH * 0.35, Math.max(2.5, cutH - 2)));
  const x = round2(Math.max(0, (cutW - w) / 2));
  const y = round2(Math.max(0, cutH - h - Math.min(cutH * 0.12, 2)));
  return { x, y, w, h, rotation: 0 };
}

// Miniatura chica para la lista (downscale por canvas).
function makeThumb(dataUrl, maxPx = 200) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', 0.82)); } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Editor de UNA imagen de un tamaño, con la caja de texto encima (mover /
// redimensionar por 8 tiradores / ROTAR con el punto verde). La caja guarda
// {x,y,w,h,rotation}; el resize opera en el marco LOCAL (rotado) de la caja.
function SizeSlotEditor({ size, slot, onPick, onChangeBox }) {
  const dragRef = useRef(null);
  const inputRef = useRef(null);
  const frameRef = useRef(null);
  const DISP_W = 380;
  const scale = DISP_W / size.cutW;
  const dispH = size.cutH * scale;
  const radiusPx = size.radius * scale;
  const box = sanitizeBox(slot?.textBox);
  const rot = box?.rotation || 0;

  // Resize en el marco local: proyecta el delta de pantalla a los ejes de la
  // caja (rotar por -rot), mueve el borde arrastrado dejando fijo el opuesto, y
  // vuelve a componer el centro (en pantalla) acotando la caja ROTADA al rótulo.
  const doResize = (edges, dxMm, dyMm, s) => {
    const rad = (s.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = dxMm * cos + dyMm * sin;      // pantalla -> local
    const ly = -dxMm * sin + dyMm * cos;
    let w = s.w;
    let h = s.h;
    let shiftLx = 0;
    let shiftLy = 0;
    if (edges.right) { w = s.w + lx; shiftLx = lx / 2; }
    if (edges.left) { w = s.w - lx; shiftLx = lx / 2; }
    if (edges.bottom) { h = s.h + ly; shiftLy = ly / 2; }
    if (edges.top) { h = s.h - ly; shiftLy = ly / 2; }
    w = Math.max(2, Math.min(w, size.cutW));
    h = Math.max(1, Math.min(h, size.cutH));
    const sx = shiftLx * cos - shiftLy * sin; // local -> pantalla
    const sy = shiftLx * sin + shiftLy * cos;
    const { cx, cy } = clampCenterRotated(s.x + s.w / 2 + sx, s.y + s.h / 2 + sy, w, h, s.rotation, size.cutW, size.cutH);
    return { x: round2(cx - w / 2), y: round2(cy - h / 2), w: round2(w), h: round2(h), rotation: s.rotation || 0 };
  };

  // Edición numérica del recuadro (mm), acotada al rótulo.
  const setBoxField = (field, val) => {
    if (!slot?.textBox) return;
    const n = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(n)) return;
    const next = { rotation: 0, ...sanitizeBox(slot.textBox), [field]: n };
    next.w = Math.max(2, Math.min(next.w, size.cutW));
    next.h = Math.max(1, Math.min(next.h, size.cutH));
    const { cx, cy } = clampCenterRotated(next.x + next.w / 2, next.y + next.h / 2, next.w, next.h, next.rotation, size.cutW, size.cutH);
    onChangeBox({ x: round2(cx - next.w / 2), y: round2(cy - next.h / 2), w: round2(next.w), h: round2(next.h), rotation: next.rotation });
  };
  const useFullLabel = () => {
    if (!slot) return;
    const m = 0.5;
    onChangeBox({ x: m, y: m, w: round2(size.cutW - 2 * m), h: round2(size.cutH - 2 * m), rotation: 0 });
  };

  const startDrag = (kind) => (e) => {
    if (!slot) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { rotation: 0, ...sanitizeBox(slot.textBox) };
    dragRef.current = { kind, sx: e.clientX, sy: e.clientY, start };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'rotate') {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cxS = rect.left + (d.start.x + d.start.w / 2) * scale;
        const cyS = rect.top + (d.start.y + d.start.h / 2) * scale;
        let deg = Math.atan2(ev.clientY - cyS, ev.clientX - cxS) * 180 / Math.PI + 90;
        deg = ((deg % 360) + 360) % 360;
        if (deg > 180) deg -= 360;
        onChangeBox({ ...d.start, rotation: Math.round(deg) });
        return;
      }
      const dxMm = (ev.clientX - d.sx) / scale;
      const dyMm = (ev.clientY - d.sy) / scale;
      if (d.kind === 'move') {
        const { cx, cy } = clampCenterRotated(d.start.x + d.start.w / 2 + dxMm, d.start.y + d.start.h / 2 + dyMm, d.start.w, d.start.h, d.start.rotation, size.cutW, size.cutH);
        onChangeBox({ ...d.start, x: round2(cx - d.start.w / 2), y: round2(cy - d.start.h / 2) });
      } else {
        onChangeBox(doResize(RESIZE_EDGES[d.kind], dxMm, dyMm, d.start));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-100">
          {size.label} <span className="text-ink-500">· {size.cutW} × {size.cutH} mm</span>
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800"
        >
          {slot ? 'Cambiar imagen' : 'Subir imagen'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }}
        />
      </div>

      <div ref={frameRef} className="relative mx-auto" style={{ width: `${DISP_W}px`, height: `${dispH}px` }}>
        {/* Capa imagen: recorte redondeado = borde del rótulo */}
        <div
          className="absolute inset-0 overflow-hidden border border-dashed border-sky-400/80 bg-white"
          style={{ borderRadius: `${radiusPx}px` }}
          title="Contorno del corte (redondeado)"
        >
          {slot ? (
            <img src={slot.dataUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-ink-400 hover:bg-black/5"
            >
              <span className="text-2xl leading-none text-ink-300">＋</span>
              <span className="text-[11px]">Subir imagen (PNG/JPG)</span>
            </button>
          )}
        </div>

        {/* Capa caja: sin recorte, encima, rotada */}
        {slot && box && (
          <div
            onPointerDown={startDrag('move')}
            className="absolute cursor-move border-2 border-accent-500 bg-accent-500/20"
            style={{
              left: `${box.x * scale}px`,
              top: `${box.y * scale}px`,
              width: `${box.w * scale}px`,
              height: `${box.h * scale}px`,
              borderRadius: `${Math.min(box.w, box.h) * 0.2 * scale}px`,
              transform: `rotate(${rot}deg)`,
              transformOrigin: 'center',
            }}
            title="Recuadro del nombre: arrastrá para mover; los cuadraditos cambian el tamaño; el punto verde rota"
          >
            {RESIZE_HANDLES.map((h) => (
              <div
                key={h.dir}
                onPointerDown={startDrag(h.dir)}
                className={`absolute h-2.5 w-2.5 rounded-sm border border-white bg-accent-500 ${h.pos} ${h.cur}`}
              />
            ))}
            <div
              onPointerDown={startDrag('rotate')}
              title="Rotar la zona del nombre"
              className="absolute h-3 w-3 cursor-grab rounded-full border border-white bg-emerald-500"
              style={{ left: '50%', top: 0, transform: 'translate(-50%, -220%)' }}
            />
          </div>
        )}
      </div>

      {slot && box ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-end justify-center gap-2 text-[10px] text-ink-400">
            <NumMm label="Ancho" value={box.w} onChange={(v) => setBoxField('w', v)} />
            <NumMm label="Alto" value={box.h} onChange={(v) => setBoxField('h', v)} />
            <NumMm label="X" value={box.x} onChange={(v) => setBoxField('x', v)} />
            <NumMm label="Y" value={box.y} onChange={(v) => setBoxField('y', v)} />
            <button
              type="button"
              onClick={useFullLabel}
              className="self-end rounded border border-ink-700 px-2 py-1 text-[10px] text-ink-200 hover:bg-ink-800"
              title="Poner el recuadro ocupando todo el rótulo"
            >
              Usar todo el rótulo
            </button>
          </div>
          <div className="text-center text-[10px] text-ink-500">
            Recuadro del nombre: {fmt(box.w)} × {fmt(box.h)} mm · {Math.round(rot)}° — el nombre se ajusta adentro
          </div>
        </div>
      ) : (
        <div className="mt-2 text-center text-[10px] text-ink-400">Subí la imagen del arte de este tamaño.</div>
      )}
    </div>
  );
}

// Campo numérico chico en mm. Si el valor no es finito, muestra vacío (nunca '?').
function NumMm({ label, value, onChange }) {
  return (
    <label className="flex flex-col items-center gap-0.5">
      <span className="text-ink-500">{label}</span>
      <input
        type="number"
        step="0.5"
        value={Number.isFinite(value) ? round2(value) : ''}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-14 rounded border border-ink-700 bg-ink-800 px-1.5 py-1 text-center text-[11px] text-ink-100 outline-none focus:border-accent-500"
      />
    </label>
  );
}

export default function RotulosManagerModal({ open, onClose }) {
  const api = typeof window !== 'undefined' ? window.printlayout?.rotulos : null;

  const [tab, setTab] = useState('fuentes');
  const [fonts, setFonts] = useState([]);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { kind:'ok'|'err', text }
  const [cfg, setCfg] = useState({ rotulosSharedDir: '' });
  const [sharedDraft, setSharedDraft] = useState('');

  // Modelo en edición (nuevo o re-editado): { id?, nombre, slots:{grande,intermedio,chico} }
  const [draft, setDraft] = useState(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const [f, m] = await Promise.all([api.fontsList(), api.modelsList()]);
    setFonts(Array.isArray(f) ? f : []);
    setModels(Array.isArray(m) ? m : []);
  }, [api]);

  const loadCfg = useCallback(async () => {
    try {
      const c = await api?.getConfig?.();
      if (c) { setCfg(c); setSharedDraft(c.rotulosSharedDir || ''); }
    } catch { /* noop */ }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    loadCfg();
    refresh();
  }, [open, refresh, loadCfg]);

  // Guardar la carpeta compartida → recargar el catálogo desde la base nueva.
  const saveSharedDir = useCallback(async () => {
    try {
      const r = await api.setConfig({ rotulosSharedDir: sharedDraft.trim() });
      const c = r?.config || r || { rotulosSharedDir: '' };
      setCfg(c);
      setSharedDraft(c.rotulosSharedDir || '');
      await refresh();
      setFeedback({ kind: 'ok', text: c.rotulosSharedDir ? `Catálogo compartido: ${c.rotulosSharedDir}` : 'Catálogo local (solo esta PC).' });
    } catch (e) {
      setFeedback({ kind: 'err', text: e.message || 'No se pudo guardar la carpeta.' });
    }
  }, [api, sharedDraft, refresh]);

  const chooseSharedDir = useCallback(async () => {
    try {
      const r = await api.chooseDir();
      if (r?.ok && r.path) setSharedDraft(r.path);
    } catch { /* noop */ }
  }, [api]);

  // Copiar el catálogo LOCAL a la carpeta compartida (one-shot, explícito).
  const migrateToShared = useCallback(async () => {
    if (!cfg.rotulosSharedDir) {
      setFeedback({ kind: 'err', text: 'Primero elegí y GUARDÁ la carpeta compartida.' });
      return;
    }
    try {
      let r = await api.migrateToShared({});
      if (r?.needsOverwrite) {
        if (!window.confirm('La carpeta compartida ya tiene un catálogo.\n¿Pisarlo con tus modelos/fuentes locales?')) return;
        r = await api.migrateToShared({ overwrite: true });
      }
      if (r?.ok) {
        await refresh();
        setFeedback({ kind: 'ok', text: `Copiado a la carpeta compartida: ${r.models} modelo(s) y ${r.fonts} fuente(s).` });
      } else {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo copiar.' });
      }
    } catch (e) {
      setFeedback({ kind: 'err', text: e.message || 'No se pudo copiar.' });
    }
  }, [api, cfg, refresh]);

  const handleClose = useCallback(() => {
    setDraft(null);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { if (draft) setDraft(null); else handleClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, draft, handleClose]);

  if (!open) return null;

  // --- Tipografías ---
  const addFont = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await api.fontAdd();
      if (r?.canceled) return;
      if (r?.ok) { setFeedback({ kind: 'ok', text: `Fuente agregada: ${r.font.familia}` }); await refresh(); }
      else setFeedback({ kind: 'err', text: r?.error || 'No se pudo agregar la fuente.' });
    } finally { setBusy(false); }
  };
  const removeFont = async (f) => {
    if (!window.confirm(`¿Eliminar la tipografía "${f.familia}"?`)) return;
    await api.fontRemove(f.id);
    await refresh();
  };

  // --- Modelos ---
  const newModel = () => {
    setFeedback(null);
    setDraft({ nombre: '', arteIncluyeRecuadro: false, slots: { grande: null, intermedio: null, chico: null } });
  };

  const editModel = async (m) => {
    setBusy(true);
    setFeedback(null);
    try {
      const slots = { grande: null, intermedio: null, chico: null };
      for (const key of SIZE_KEYS) {
        const s = m.sizes?.[key];
        if (s?.arteFile) {
          const r = await api.readImage({ modelId: m.id, arteFile: s.arteFile });
          if (r?.ok) {
            slots[key] = {
              dataUrl: r.dataUrl,
              ext: s.ext || 'png',
              wPx: s.wPx || null,
              hPx: s.hPx || null,
              textBox: s.textBox || defaultBox(sizeDef(key).cutW, sizeDef(key).cutH),
            };
          }
        }
      }
      setDraft({ id: m.id, nombre: m.nombre, arteIncluyeRecuadro: !!m.arteIncluyeRecuadro, slots });
    } finally { setBusy(false); }
  };

  const pickImage = (sizeKey, file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        setDraft((prev) => {
          if (!prev) return prev;
          const existing = prev.slots[sizeKey];
          const def = sizeDef(sizeKey);
          return {
            ...prev,
            slots: {
              ...prev.slots,
              [sizeKey]: {
                dataUrl,
                ext: extFromFile(file),
                wPx: img.naturalWidth,
                hPx: img.naturalHeight,
                textBox: existing?.textBox || defaultBox(def.cutW, def.cutH),
              },
            },
          };
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const changeBox = (sizeKey, box) => {
    setDraft((prev) => (prev ? {
      ...prev,
      slots: { ...prev.slots, [sizeKey]: { ...prev.slots[sizeKey], textBox: box } },
    } : prev));
  };

  const saveModel = async () => {
    if (!draft) return;
    setBusy(true);
    setFeedback(null);
    try {
      const sizes = {};
      let thumbSrc = null;
      for (const key of SIZE_KEYS) {
        const slot = draft.slots[key];
        if (!slot?.dataUrl) continue;
        const def = sizeDef(key);
        sizes[key] = {
          dataUrl: slot.dataUrl,
          ext: slot.ext,
          wPx: slot.wPx,
          hPx: slot.hPx,
          cutMm: { w: def.cutW, h: def.cutH, radius: def.radius },
          textBox: slot.textBox,
        };
        if (!thumbSrc) thumbSrc = slot.dataUrl;
      }
      if (Object.keys(sizes).length === 0) {
        setFeedback({ kind: 'err', text: 'Subí al menos una imagen antes de guardar.' });
        return;
      }
      const thumb = thumbSrc ? await makeThumb(thumbSrc) : null;
      const r = await api.modelSave({
        id: draft.id,
        nombre: draft.nombre.trim() || 'Modelo',
        arteIncluyeRecuadro: !!draft.arteIncluyeRecuadro,
        thumb,
        sizes,
      });
      if (r?.ok) {
        setDraft(null);
        setFeedback({ kind: 'ok', text: `Modelo guardado: ${r.model.nombre}` });
        await refresh();
      } else {
        setFeedback({ kind: 'err', text: r?.error || 'No se pudo guardar el modelo.' });
      }
    } finally { setBusy(false); }
  };

  const removeModel = async (m) => {
    if (!window.confirm(`¿Eliminar el modelo "${m.nombre}"?`)) return;
    await api.modelRemove(m.id);
    await refresh();
  };

  const fbColor = feedback?.kind === 'ok' ? 'text-green-300' : feedback?.kind === 'err' ? 'text-red-300' : 'text-sky-300';
  const slotsFilled = draft ? SIZE_KEYS.filter((k) => draft.slots[k]).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[52rem] max-w-[96vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Rótulos escolares</h3>
            <p className="mt-0.5 text-xs text-ink-400">
              Cargá las tipografías y los modelos de rótulo. La impresión de las planchas viene después.
            </p>
          </div>
          <div className="flex overflow-hidden rounded-md border border-ink-700 bg-ink-800">
            <button
              type="button"
              onClick={() => setTab('fuentes')}
              className={`px-3 py-1.5 text-xs ${tab === 'fuentes' ? 'bg-accent-600 text-white' : 'text-ink-200 hover:bg-ink-700'}`}
            >
              Tipografías
            </button>
            <button
              type="button"
              onClick={() => setTab('modelos')}
              className={`border-l border-ink-700 px-3 py-1.5 text-xs ${tab === 'modelos' ? 'bg-accent-600 text-white' : 'text-ink-200 hover:bg-ink-700'}`}
            >
              Modelos
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ---------------- CARPETA COMPARTIDA ---------------- */}
          <div className="mb-4 rounded border border-ink-700 bg-ink-950/40 p-3">
            <span className="mb-1 block text-xs font-medium text-ink-200">Carpeta compartida del catálogo</span>
            <div className="flex gap-2">
              <input
                value={sharedDraft}
                onChange={(e) => setSharedDraft(e.target.value)}
                placeholder={'Vacío = solo esta PC.  Ej: \\\\MARIANO\\RotulosModelos'}
                className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
              />
              <button type="button" onClick={chooseSharedDir}
                className="shrink-0 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700">
                Elegir…
              </button>
              <button type="button" onClick={saveSharedDir}
                className="shrink-0 rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500">
                Guardar
              </button>
            </div>
            <span className="mt-1 block text-[10px] text-ink-500">
              Si apunta a una carpeta de red, varias PC comparten los mismos modelos y tipografías (lectura y escritura). Vacío = solo esta PC. Podés pegar la ruta de red directo.
            </span>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={migrateToShared} disabled={!cfg.rotulosSharedDir}
                title={!cfg.rotulosSharedDir ? 'Guardá primero una carpeta compartida' : ''}
                className="rounded border border-ink-700 px-2.5 py-1 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-40">
                Copiar mis modelos locales a la carpeta compartida
              </button>
              <span className="text-[10px] text-ink-500">
                {cfg.rotulosSharedDir ? `Activo: ${cfg.rotulosSharedDir}` : 'Actualmente: local (esta PC).'}
              </span>
            </div>
          </div>

          {/* ---------------- TIPOGRAFÍAS ---------------- */}
          {tab === 'fuentes' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-ink-400">
                  Fuentes para escribir el nombre (ej: COCON). Se validan al subirlas.
                </span>
                <button
                  type="button"
                  onClick={addFont}
                  disabled={busy}
                  className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
                >
                  Subir fuente (.ttf/.otf)
                </button>
              </div>
              {fonts.length === 0 ? (
                <p className="rounded border border-dashed border-ink-700 py-8 text-center text-xs text-ink-500">
                  Todavía no hay tipografías. Subí una con el botón de arriba.
                </p>
              ) : (
                <ul className="divide-y divide-ink-800 rounded border border-ink-800">
                  {fonts.map((f) => (
                    <li key={f.id} className="flex items-center justify-between px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-ink-100">{f.familia}</div>
                        <div className="text-[10px] uppercase text-ink-500">.{f.ext}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFont(f)}
                        className="rounded border border-ink-700 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                      >
                        Eliminar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ---------------- MODELOS: lista ---------------- */}
          {tab === 'modelos' && !draft && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-ink-400">
                  Un modelo = 3 imágenes (grande, intermedio, chico) con la zona del nombre marcada a mano.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={newModel}
                    className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500"
                  >
                    Nuevo modelo
                  </button>
                </div>
              </div>
              {models.length === 0 ? (
                <p className="rounded border border-dashed border-ink-700 py-8 text-center text-xs text-ink-500">
                  Todavía no hay modelos. Creá uno con “Nuevo modelo”.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-3">
                  {models.map((m) => {
                    const keys = SIZE_KEYS.filter((k) => m.sizes?.[k]);
                    return (
                      <li key={m.id} className="flex gap-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
                        <div className="h-16 w-24 shrink-0 overflow-hidden rounded border border-ink-700 bg-white">
                          {m.thumb ? (
                            <img src={m.thumb} alt="" className="h-full w-full object-contain" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] text-ink-500">sin arte</div>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="truncate text-sm font-medium text-ink-100" title={m.nombre}>{m.nombre}</div>
                          <div className="mt-0.5 text-[11px] text-ink-400">{keys.length} tamaño(s): {keys.join(' · ')}</div>
                          <div className="mt-auto flex gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => editModel(m)}
                              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => removeModel(m)}
                              className="rounded border border-ink-700 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* ---------------- MODELOS: editor ---------------- */}
          {tab === 'modelos' && draft && (
            <div>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <label className="text-xs text-ink-300">
                  <span className="mb-1 block">Número / nombre del modelo</span>
                  <input
                    value={draft.nombre}
                    onChange={(e) => setDraft((p) => ({ ...p, nombre: e.target.value }))}
                    placeholder="ej: 125"
                    className="w-64 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500"
                  />
                </label>
                <p className="flex-1 text-[11px] text-ink-400">
                  Subí la imagen de cada tamaño y arrastrá la caja azul a donde va el nombre.
                  Cambiá su tamaño desde cualquier lado o esquina (los cuadraditos).
                  El recuadro punteado es el borde del rótulo.
                </p>
              </div>

              <label className="mb-3 flex cursor-pointer items-start gap-2 rounded border border-ink-800 bg-ink-950/40 px-3 py-2 text-xs text-ink-200">
                <input
                  type="checkbox"
                  checked={!!draft.arteIncluyeRecuadro}
                  onChange={(e) => setDraft((p) => ({ ...p, arteIncluyeRecuadro: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-accent-500"
                />
                <span>
                  <span className="font-medium text-ink-100">El arte ya incluye el recuadro del nombre</span>
                  <span className="block text-[11px] text-ink-400">
                    Dejalo destildado si el arte es solo el fondo (el programa dibuja el recuadro, con el
                    color que elijas al armar la plancha). Tildalo solo si el recuadro blanco ya viene pegado en la imagen.
                  </span>
                </span>
              </label>

              <div className="flex flex-col gap-4">
                {SIZES.map((s) => (
                  <SizeSlotEditor
                    key={s.key}
                    size={s}
                    slot={draft.slots[s.key]}
                    onPick={(file) => pickImage(s.key, file)}
                    onChangeBox={(box) => changeBox(s.key, box)}
                  />
                ))}
              </div>
            </div>
          )}

          {feedback && <p className={`mt-3 text-xs ${fbColor}`}>{feedback.text}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
          {draft ? (
            <>
              <span className="mr-auto text-[11px] text-ink-500">{slotsFilled}/3 imágenes cargadas</span>
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={busy}
                className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveModel}
                disabled={busy || slotsFilled === 0}
                className="rounded bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
              >
                {busy ? 'Guardando…' : (draft.id ? 'Guardar cambios' : 'Guardar modelo')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
