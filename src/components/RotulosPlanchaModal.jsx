import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveSizeLayout, zoneAsBox, effectivePad } from '../rotulos/textLayout.js';
import { makeCanvasMeasure, drawRotuloOverlay } from '../rotulos/drawOverlay.js';
import { PLANCHA_LIST, planchaCeldas } from '../rotulos/planchas.js';
import { RESIZE_HANDLES, RESIZE_EDGES, moveBox, resizeBox, fullLabelBox, clampCenterRotated, sanitizeBox } from '../rotulos/boxEditing.js';

// Armador de plancha de rótulos. Preview en vivo (canvas) de los 3 rótulos:
// fondo + recuadro dinámico (o sin fondo) + nombre (líneas por tamaño, contorno
// opcional, posición/tamaño/rotación de la zona). MISMA lógica que el PDF.

const SIZE_KEYS = ['grande', 'intermedio', 'chico'];
const SIZE_LABEL = { grande: 'Grande', intermedio: 'Intermedio', chico: 'Chico' };
const LINE_HEIGHT = 1.15;
const MIN_PT = 3;
const MAX_PT = 120;
const LINE_MODES = [{ v: 'auto', t: 'Auto' }, { v: '1', t: '1 línea' }, { v: '2', t: '2 líneas' }];

const PALETTE_KEY = 'rotulos.palette';
const DEFAULT_PALETTE = ['#000000', '#ffffff', '#e11d2a', '#1d4ed8', '#059669', '#f59e0b'];

function loadPalette() {
  try {
    const saved = JSON.parse(localStorage.getItem(PALETTE_KEY) || '[]');
    const merged = [...DEFAULT_PALETTE, ...(Array.isArray(saved) ? saved : [])];
    return [...new Set(merged.map((c) => String(c).toLowerCase()))];
  } catch { return DEFAULT_PALETTE; }
}

function ColorControl({ label, value, onChange, palette, onAdd, disabled, hint }) {
  return (
    <div className={`text-xs text-ink-300 ${disabled ? 'opacity-50' : ''}`}>
      <span className="mb-1 block">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-ink-700 bg-ink-800 disabled:cursor-not-allowed" />
        <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" />
        <button type="button" disabled={disabled} onClick={onAdd}
          className="rounded border border-ink-700 px-2 py-1.5 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-50">+ Guardar</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <button key={c} type="button" title={c} disabled={disabled} onClick={() => onChange(c)}
            className={`h-6 w-6 rounded border ${value.toLowerCase() === c ? 'border-accent-400 ring-1 ring-accent-400' : 'border-ink-600'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      {hint && <span className="mt-1 block text-[10px] text-amber-300">{hint}</span>}
    </div>
  );
}

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : '?');

// Campo numérico chico en mm. Si el valor no es finito, muestra vacío (nunca '?').
function NumMm({ label, value, onChange }) {
  return (
    <label className="flex flex-col items-center gap-0.5">
      <span className="text-ink-500">{label}</span>
      <input type="number" step="0.5" value={Number.isFinite(value) ? round2(value) : ''} onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-14 rounded border border-ink-700 bg-ink-800 px-1.5 py-1 text-center text-[11px] text-ink-100 outline-none focus:border-accent-500" />
    </label>
  );
}

function PlanchaSizePreview({ sizeKey, cutMm, textBox, arteDataUrl, family, textColor, boxColor, drawBox, padMm, text, mode, onModeChange, outline, onBoxChange, onResetBox, isOverridden }) {
  const DISP_W = 280;
  const cutW = cutMm?.w || 40;
  const cutH = cutMm?.h || 20;
  const scale = DISP_W / cutW;
  const dispH = cutH * scale;
  const radiusPx = (cutMm?.radius || 0) * scale;
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const rot = textBox?.rotation || 0;

  // Mover / redimensionar / rotar el recuadro (solo esta plancha).
  const startDrag = (kind) => (e) => {
    if (!textBox || !onBoxChange) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { rotation: 0, ...textBox };
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
        onBoxChange({ ...d.start, rotation: Math.round(deg) });
        return;
      }
      const dxMm = (ev.clientX - d.sx) / scale;
      const dyMm = (ev.clientY - d.sy) / scale;
      if (d.kind === 'move') onBoxChange(moveBox(d.start, dxMm, dyMm, cutW, cutH));
      else onBoxChange(resizeBox(RESIZE_EDGES[d.kind], dxMm, dyMm, d.start, cutW, cutH));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const setBoxField = (field, val) => {
    if (!textBox || !onBoxChange) return;
    const n = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(n)) return;
    const next = { rotation: 0, ...textBox, [field]: n };
    next.w = Math.max(2, Math.min(next.w, cutW));
    next.h = Math.max(1, Math.min(next.h, cutH));
    const { cx, cy } = clampCenterRotated(next.x + next.w / 2, next.y + next.h / 2, next.w, next.h, next.rotation, cutW, cutH);
    onBoxChange({ x: round2(cx - next.w / 2), y: round2(cy - next.h / 2), w: round2(next.w), h: round2(next.h), rotation: next.rotation });
  };

  // El recuadro = la zona dibujada; el nombre se ajusta adentro con el aire
  // (acotado en zonas chicas) + el grosor del contorno.
  const outlineMm = (outline && outline.enabled && outline.widthMm > 0) ? outline.widthMm : 0;
  const pad = textBox ? effectivePad(drawBox ? (padMm || 0) : 0, outlineMm, textBox) : 0;

  const measure = useMemo(() => (family ? makeCanvasMeasure(family) : null), [family]);
  const layout = useMemo(() => {
    if (!measure || !textBox) return null;
    return resolveSizeLayout({ text, mode, boxWmm: Math.max(1, textBox.w - 2 * pad), boxHmm: Math.max(1, textBox.h - 2 * pad), minPt: MIN_PT, maxPt: MAX_PT, lineHeightFactor: LINE_HEIGHT, measurePt: measure });
  }, [measure, textBox, text, mode, pad]);
  const nameBox = useMemo(() => {
    if (!drawBox || !textBox) return null;
    return zoneAsBox(textBox);
  }, [drawBox, textBox]);
  const hasText = String(text ?? '').trim().length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(DISP_W * dpr));
    canvas.height = Math.max(1, Math.round(dispH * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, DISP_W, dispH);
    drawRotuloOverlay(ctx, {
      scale, family, textColor, boxColor,
      drawBox: drawBox && hasText, box: nameBox, zone: textBox,
      layout: hasText ? layout : null, outline, lineHeightFactor: LINE_HEIGHT,
    });
  }, [dispH, scale, family, textColor, boxColor, drawBox, hasText, nameBox, textBox, layout, outline]);

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-100">{SIZE_LABEL[sizeKey]} <span className="text-ink-500">· {cutW} × {cutH} mm</span>{isOverridden && <span className="ml-1 text-amber-300">· ajustado</span>}</span>
        <div className="flex items-center gap-1.5">
          {drawBox && onBoxChange && (
            <button type="button" onClick={() => setEditing((v) => !v)}
              className={`rounded border px-2 py-0.5 text-[10px] ${editing ? 'border-accent-500 bg-accent-600 text-white' : 'border-ink-700 text-ink-300 hover:bg-ink-800'}`}
              title="Ajustar el recuadro solo para esta plancha">
              {editing ? '✓ Listo' : '✎ Ajustar recuadro'}
            </button>
          )}
          <div className="flex overflow-hidden rounded border border-ink-700">
            {LINE_MODES.map((m) => (
              <button key={m.v} type="button" onClick={() => onModeChange(m.v)}
                className={`px-2 py-0.5 text-[10px] ${mode === m.v ? 'bg-accent-600 text-white' : 'bg-ink-800 text-ink-300 hover:bg-ink-700'}`}>
                {m.v === 'auto' && layout && mode === 'auto' ? `Auto (${layout.count})` : m.t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={frameRef} className="relative mx-auto" style={{ width: `${DISP_W}px`, height: `${dispH}px` }}>
        <div className="absolute inset-0 overflow-hidden border border-dashed border-sky-400/50 bg-white" style={{ borderRadius: `${radiusPx}px` }}>
          {arteDataUrl ? <img src={arteDataUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            : <div className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-400">(sin arte)</div>}
        </div>
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" style={{ width: `${DISP_W}px`, height: `${dispH}px` }} />
        {editing && textBox && (
          <div onPointerDown={startDrag('move')}
            className="absolute cursor-move border-2 border-accent-400 bg-accent-400/10"
            style={{
              left: `${textBox.x * scale}px`, top: `${textBox.y * scale}px`,
              width: `${textBox.w * scale}px`, height: `${textBox.h * scale}px`,
              borderRadius: `${Math.min(textBox.w, textBox.h) * 0.2 * scale}px`,
              transform: `rotate(${rot}deg)`, transformOrigin: 'center',
            }}
            title="Arrastrá para mover; los cuadraditos cambian el tamaño; el punto verde rota">
            {RESIZE_HANDLES.map((h) => (
              <div key={h.dir} onPointerDown={startDrag(h.dir)}
                className={`absolute h-2.5 w-2.5 rounded-sm border border-white bg-accent-500 ${h.pos} ${h.cur}`} />
            ))}
            <div onPointerDown={startDrag('rotate')} title="Rotar el recuadro"
              className="absolute h-3 w-3 cursor-grab rounded-full border border-white bg-emerald-500"
              style={{ left: '50%', top: 0, transform: 'translate(-50%, -220%)' }} />
          </div>
        )}
      </div>
      {editing && textBox && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-end justify-center gap-2 text-[10px] text-ink-400">
            <NumMm label="Ancho" value={textBox.w} onChange={(v) => setBoxField('w', v)} />
            <NumMm label="Alto" value={textBox.h} onChange={(v) => setBoxField('h', v)} />
            <NumMm label="X" value={textBox.x} onChange={(v) => setBoxField('x', v)} />
            <NumMm label="Y" value={textBox.y} onChange={(v) => setBoxField('y', v)} />
            <button type="button" onClick={() => onBoxChange(fullLabelBox(cutW, cutH))}
              className="self-end rounded border border-ink-700 px-2 py-1 text-[10px] text-ink-200 hover:bg-ink-800"
              title="Recuadro ocupando todo el rótulo">Usar todo</button>
            <button type="button" onClick={onResetBox} disabled={!isOverridden}
              className="self-end rounded border border-ink-700 px-2 py-1 text-[10px] text-ink-200 hover:bg-ink-800 disabled:opacity-40"
              title="Volver al recuadro del modelo">Restablecer</button>
          </div>
          <div className="text-center text-[10px] text-ink-500">Recuadro: {fmt(textBox.w)} × {fmt(textBox.h)} mm · {Math.round(rot)}° — solo para esta plancha</div>
        </div>
      )}
    </div>
  );
}

export default function RotulosPlanchaModal({ open, init = null, onSubmit, onClose }) {
  const api = typeof window !== 'undefined' ? window.printlayout?.rotulos : null;
  const editing = !!init?.editing;

  const [models, setModels] = useState([]);
  const [fonts, setFonts] = useState([]);
  const [planchaId, setPlanchaId] = useState('plancha1');
  const [modelId, setModelId] = useState('');
  const [fontId, setFontId] = useState('');
  const [textColor, setTextColor] = useState('#000000');
  const [boxColor, setBoxColor] = useState('#ffffff');
  const [noBox, setNoBox] = useState(false);
  const [boxPadMm, setBoxPadMm] = useState(0.8);
  const [outline, setOutline] = useState({ enabled: false, color: '#e11d2a', widthMm: 0.3, join: 'round' });
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [lineModes, setLineModes] = useState({ grande: 'auto', intermedio: 'auto', chico: 'auto' });
  const [arteBySize, setArteBySize] = useState({});
  const [family, setFamily] = useState(null);
  const [feedback, setFeedback] = useState(null);
  // Ajustes del recuadro por tamaño SOLO para esta plancha (no tocan el modelo).
  const [boxOverrides, setBoxOverrides] = useState({});
  const setOverride = useCallback((key, box) => setBoxOverrides((p) => ({ ...p, [key]: box })), []);
  const resetOverride = useCallback((key) => setBoxOverrides((p) => { const n = { ...p }; delete n[key]; return n; }), []);

  const loadedFontsRef = useRef(new Map());

  const selectedModel = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId]);

  // Plancha elegida: sus celdas, los tamaños que USA (en orden) y el conteo.
  const plancha = useMemo(() => planchaCeldas(planchaId), [planchaId]);
  const usedSizes = useMemo(() => {
    const seen = new Set(); const list = [];
    for (const c of plancha.celdas) if (!seen.has(c.size)) { seen.add(c.size); list.push(c.size); }
    return list;
  }, [plancha]);
  const counts = useMemo(() => {
    const by = {}; for (const c of plancha.celdas) by[c.size] = (by[c.size] || 0) + 1; return by;
  }, [plancha]);

  // Un tamaño que la plancha usa está OK si el modelo lo tiene con caja + arte.
  const hasSize = useCallback(
    (k) => !!(selectedModel?.sizes?.[k]?.textBox && selectedModel?.sizes?.[k]?.arteFile),
    [selectedModel],
  );
  const missingSizes = useMemo(() => usedSizes.filter((k) => !hasSize(k)), [usedSizes, hasSize]);
  const modelComplete = !!selectedModel && missingSizes.length === 0;
  const drawBox = !selectedModel?.arteIncluyeRecuadro && !noBox;

  // Recuadro efectivo = ajuste de la plancha o, si no hay, el del modelo (saneado).
  const effTextBox = useCallback(
    (key) => {
      const raw = boxOverrides[key] || selectedModel?.sizes?.[key]?.textBox;
      return raw ? sanitizeBox(raw) : null;
    },
    [boxOverrides, selectedModel],
  );

  // Precarga al abrir: desde `init` (Nuevo trabajo: {planchaId, modeloId}; o la
  // receta completa + editing:true al re-editar la pestaña).
  useEffect(() => {
    if (!open || !api) return;
    setFeedback(null);
    setPalette(loadPalette());
    if (init?.planchaId) setPlanchaId(init.planchaId);
    setBoxOverrides(init?.boxOverrides || {});
    if (init?.editing) {
      if (init.color) setTextColor(init.color);
      if (init.boxColor) setBoxColor(init.boxColor);
      setNoBox(!!init.noBox);
      if (init.boxPadMm != null) setBoxPadMm(init.boxPadMm);
      if (init.outline) setOutline(init.outline);
      setText(init.text || '');
      if (init.lineModes) setLineModes(init.lineModes);
    } else {
      // Trabajo nuevo: no arrastrar el nombre del armado anterior.
      setText('');
    }
    Promise.all([api.modelsList(), api.fontsList()]).then(([m, f]) => {
      const ms = Array.isArray(m) ? m : [];
      const fs = Array.isArray(f) ? f : [];
      setModels(ms);
      setFonts(fs);
      const wantModel = init?.modeloId || init?.modelId;
      const wantFont = init?.fontId;
      setModelId(wantModel || ms[0]?.id || '');
      setFontId((prev) => wantFont || prev || fs[0]?.id || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api, init]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedText(text), 220);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!open || !api || !selectedModel) { setArteBySize({}); return undefined; }
    let cancelled = false;
    (async () => {
      const out = {};
      for (const key of SIZE_KEYS) {
        const s = selectedModel.sizes?.[key];
        if (s?.arteFile) {
          const r = await api.readImage({ modelId: selectedModel.id, arteFile: s.arteFile });
          if (r?.ok) out[key] = r.dataUrl;
        }
      }
      if (!cancelled) setArteBySize(out);
    })();
    return () => { cancelled = true; };
  }, [open, api, selectedModel]);

  const ensureFamily = async (fid) => {
    if (!fid || !api) return null;
    if (loadedFontsRef.current.has(fid)) return loadedFontsRef.current.get(fid);
    const r = await api.readFont(fid);
    if (!r?.ok) return null;
    const fam = `PLRot_${fid}`;
    try {
      const buf = await fetch(r.dataUrl).then((x) => x.arrayBuffer());
      const face = new FontFace(fam, buf);
      await face.load();
      document.fonts.add(face);
      loadedFontsRef.current.set(fid, fam);
      return fam;
    } catch { return null; }
  };

  useEffect(() => {
    if (!open || !api || !fontId) { setFamily(null); return undefined; }
    let cancelled = false;
    ensureFamily(fontId).then((fam) => { if (!cancelled) setFamily(fam); });
    return () => { cancelled = true; };
  }, [open, api, fontId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const addToPalette = useCallback((c) => {
    setPalette((prev) => {
      const cc = String(c).toLowerCase();
      if (prev.includes(cc)) return prev;
      const next = [...prev, cc];
      try { localStorage.setItem(PALETTE_KEY, JSON.stringify(next.filter((x) => !DEFAULT_PALETTE.includes(x)))); } catch { /* noop */ }
      return next;
    });
  }, []);

  if (!open) return null;

  // Arma la "receta" (spec) y la manda a App, que crea/actualiza la PESTAÑA y
  // deja el PDF impreso al motor probado. El modal NO genera PDF suelto.
  const handleSubmit = () => {
    if (!selectedModel || !fontId || !modelComplete || !onSubmit) return;
    const firstLine = String(text).split('\n')[0].trim();
    const planchaLabel = PLANCHA_LIST.find((p) => p.id === planchaId)?.label || 'Plancha';
    const name = `Rótulos ${selectedModel.nombre} · ${planchaLabel}${firstLine ? ` — ${firstLine}` : ''}`;
    const spec = {
      planchaId,
      modeloId: modelId,
      nombre: selectedModel.nombre,
      fontId,
      color: textColor,
      boxColor,
      noBox,
      boxPadMm,
      text,
      lineModes,
      outline,
      boxOverrides,
      name,
      editing,
    };
    onSubmit(spec);
  };

  const fbColor = feedback?.kind === 'ok' ? 'text-green-300' : feedback?.kind === 'err' ? 'text-red-300' : 'text-sky-300';
  const noModels = models.length === 0;
  const noFonts = fonts.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[64rem] max-w-[97vw] flex-col rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Armar plancha de rótulos</h3>
            <p className="mt-0.5 text-xs text-ink-400">Elegí tipo de plancha, modelo, tipografía, colores y estilo del nombre. Al confirmar se crea una pestaña con la plancha lista para imprimir.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Cerrar</button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
          {/* ---- Formulario ---- */}
          <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto pr-1">
            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Tipo de plancha</span>
              <select value={planchaId} onChange={(e) => setPlanchaId(e.target.value)}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500">
                {PLANCHA_LIST.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>

            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Modelo</span>
              <select value={modelId} onChange={(e) => { setModelId(e.target.value); setBoxOverrides({}); }} disabled={noModels}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-50">
                {noModels ? <option value="">(no hay modelos)</option> : models.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              {selectedModel && !modelComplete && (
                <span className="mt-1 block text-[10px] text-amber-300">
                  Esta plancha usa {usedSizes.map((k) => SIZE_LABEL[k]).join(' + ')}; al modelo le falta{missingSizes.length > 1 ? 'n' : ''} {missingSizes.map((k) => SIZE_LABEL[k]).join(', ')}. Completalo en “Rótulos → Modelos”.
                </span>
              )}
            </label>

            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Tipografía</span>
              <select value={fontId} onChange={(e) => setFontId(e.target.value)} disabled={noFonts}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-50">
                {noFonts ? <option value="">(no hay fuentes)</option> : fonts.map((f) => <option key={f.id} value={f.id}>{f.familia}</option>)}
              </select>
            </label>

            <ColorControl label="Color del texto" value={textColor} onChange={setTextColor} palette={palette} onAdd={() => addToPalette(textColor)} />

            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-200">
              <input type="checkbox" checked={noBox} onChange={(e) => setNoBox(e.target.checked)} className="h-4 w-4 accent-accent-500" />
              <span>Sin recuadro (fondo transparente)</span>
            </label>
            <ColorControl label="Color del recuadro" value={boxColor} onChange={setBoxColor} palette={palette} onAdd={() => addToPalette(boxColor)}
              disabled={!drawBox}
              hint={selectedModel?.arteIncluyeRecuadro ? 'Este modelo ya trae el recuadro en el arte.' : (noBox ? 'Sin recuadro activado.' : null)} />
            <div className={`flex items-center gap-2 text-xs text-ink-300 ${!drawBox ? 'opacity-50' : ''}`}>
              <span className="w-28">Aire del recuadro</span>
              <input type="number" min="0" step="0.1" value={boxPadMm} disabled={!drawBox}
                onChange={(e) => setBoxPadMm(parseFloat(e.target.value) || 0)}
                className="w-20 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100 disabled:opacity-50" />
              <span>mm (espacio entre el texto y el recuadro)</span>
            </div>

            {/* Contorno del texto */}
            <div className="rounded border border-ink-800 bg-ink-950/40 p-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-200">
                <input type="checkbox" checked={outline.enabled} onChange={(e) => setOutline((o) => ({ ...o, enabled: e.target.checked }))} className="h-4 w-4 accent-accent-500" />
                <span className="font-medium">Contorno del texto</span>
              </label>
              {outline.enabled && (
                <div className="mt-2 space-y-2">
                  <ColorControl label="Color del contorno" value={outline.color} onChange={(c) => setOutline((o) => ({ ...o, color: c }))} palette={palette} onAdd={() => addToPalette(outline.color)} />
                  <div className="flex items-center gap-2 text-xs text-ink-300">
                    <span className="w-16">Grosor</span>
                    <input type="number" min="0.05" step="0.05" value={outline.widthMm}
                      onChange={(e) => setOutline((o) => ({ ...o, widthMm: parseFloat(e.target.value) || 0 }))}
                      className="w-20 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100" />
                    <span>mm</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-300">
                    <span className="w-16">Terminación</span>
                    <select value={outline.join} onChange={(e) => setOutline((o) => ({ ...o, join: e.target.value }))}
                      className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-ink-100">
                      <option value="round">Redondeada</option>
                      <option value="miter">Punta</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Texto (Enter = corte preferido)</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                placeholder={'Luz Martínez\n4° A T.M.'}
                className="w-full resize-none rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" />
              <span className="mt-1 block text-[10px] text-ink-500">Cada tamaño decide solo 1 o 2 líneas (Auto). Podés forzarlo en cada tarjeta del preview.</span>
            </label>
          </div>

          {/* ---- Preview ---- */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">Vista previa</div>
            {noModels ? (
              <p className="rounded border border-dashed border-ink-700 py-10 text-center text-xs text-ink-500">No hay modelos. Creá uno en “Rótulos → Modelos”.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {usedSizes.map((key) => {
                  const s = selectedModel?.sizes?.[key];
                  if (!s?.textBox || !s?.arteFile) {
                    return (
                      <div key={key} className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/5 p-3 text-[11px] text-amber-300">
                        Esta plancha usa <b>{SIZE_LABEL[key]}</b> ({counts[key]} rótulos), pero el modelo no lo tiene cargado. Agregalo en “Rótulos → Modelos”.
                      </div>
                    );
                  }
                  return (
                    <PlanchaSizePreview key={key} sizeKey={key} cutMm={s.cutMm} textBox={effTextBox(key)}
                      arteDataUrl={arteBySize[key]} family={family} textColor={textColor} boxColor={boxColor}
                      drawBox={drawBox} padMm={boxPadMm} text={debouncedText} mode={lineModes[key]} outline={outline}
                      onModeChange={(m) => setLineModes((prev) => ({ ...prev, [key]: m }))}
                      onBoxChange={(b) => setOverride(key, b)} onResetBox={() => resetOverride(key)}
                      isOverridden={!!boxOverrides[key]} />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700 p-4">
          {feedback && <p className={`mr-auto whitespace-pre-line text-[11px] ${fbColor}`}>{feedback.text}</p>}
          {!feedback && (
            <span className="mr-auto text-[11px] text-ink-500">
              {plancha.celdas.length} rótulos ({usedSizes.map((k) => `${counts[k]} ${SIZE_LABEL[k].toLowerCase()}`).join(' + ')})
            </span>
          )}
          <button type="button" onClick={onClose} className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Cerrar</button>
          <button type="button" onClick={handleSubmit} disabled={!modelComplete || !fontId}
            title={!modelComplete ? `Falta cargar en el modelo: ${missingSizes.map((k) => SIZE_LABEL[k]).join(', ')}` : (!fontId ? 'Elegí una tipografía' : '')}
            className="rounded bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
            {editing ? 'Guardar cambios' : 'Crear trabajo'}
          </button>
        </div>
      </div>
    </div>
  );
}
