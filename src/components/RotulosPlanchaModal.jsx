import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MM_TO_PT } from '../rotulos/vendor/fitText.js';
import { resolveSizeLayout, computeNameBox } from '../rotulos/textLayout.js';
import { buildRotulosPlanchaPdf } from '../rotulos/exportRotulos.js';
import { PLANCHA_LIST } from '../rotulos/planchas.js';

// Armador de plancha de rótulos: modelo + tipografía + colores (texto y recuadro)
// + texto → preview en vivo de los 3 rótulos y generación del PDF (144 rótulos).
// Líneas por tamaño (auto/1/2) y recuadro dinámico se calculan con textLayout.js,
// la MISMA lógica que usa el PDF → lo que ves = lo que imprimís. Sin corte ni QR.

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

function makeCanvasMeasure(family) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return (line, sizePt) => {
    ctx.font = `${sizePt}px "${family}"`;
    return ctx.measureText(line || '').width;
  };
}

// Control de color reutilizable (texto / recuadro): picker + hex + paleta.
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
          className="rounded border border-ink-700 px-2 py-1.5 text-[11px] text-ink-200 hover:bg-ink-800 disabled:opacity-50">
          + Guardar
        </button>
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

// Preview de UN tamaño: fondo (cover) → recuadro (auto-size) → nombre.
function PlanchaSizePreview({ sizeKey, cutMm, textBox, arteDataUrl, family, textColor, boxColor, drawBox, text, mode, onModeChange }) {
  const DISP_W = 280;
  const cutW = cutMm?.w || 40;
  const cutH = cutMm?.h || 20;
  const scale = DISP_W / cutW;
  const dispH = cutH * scale;
  const radiusPx = (cutMm?.radius || 0) * scale;

  const measure = useMemo(() => (family ? makeCanvasMeasure(family) : null), [family]);

  const layout = useMemo(() => {
    if (!measure || !textBox) return null;
    return resolveSizeLayout({
      text, mode, boxWmm: textBox.w, boxHmm: textBox.h,
      minPt: MIN_PT, maxPt: MAX_PT, lineHeightFactor: LINE_HEIGHT, measurePt: measure,
    });
  }, [measure, textBox, text, mode]);

  const nameBox = useMemo(() => {
    if (!drawBox || !layout || !measure || !textBox) return null;
    return computeNameBox({ lines: layout.lines, fontSizePt: layout.fontSizePt, lineHeightFactor: LINE_HEIGHT, zone: textBox, measurePt: measure });
  }, [drawBox, layout, measure, textBox]);

  const hasText = String(text ?? '').trim().length > 0;
  const fontSizePx = layout ? (layout.fontSizePt / MM_TO_PT) * scale : 0;

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-100">
          {SIZE_LABEL[sizeKey]} <span className="text-ink-500">· {cutW} × {cutH} mm</span>
        </span>
        <div className="flex overflow-hidden rounded border border-ink-700">
          {LINE_MODES.map((m) => (
            <button key={m.v} type="button" onClick={() => onModeChange(m.v)}
              className={`px-2 py-0.5 text-[10px] ${mode === m.v ? 'bg-accent-600 text-white' : 'bg-ink-800 text-ink-300 hover:bg-ink-700'}`}>
              {m.v === 'auto' && layout && mode === 'auto' ? `Auto (${layout.count})` : m.t}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mx-auto overflow-hidden border border-dashed border-sky-400/50 bg-white"
        style={{ width: `${DISP_W}px`, height: `${dispH}px`, borderRadius: `${radiusPx}px` }}>
        {arteDataUrl ? (
          <img src={arteDataUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-400">(sin arte)</div>
        )}

        {/* Recuadro dinámico */}
        {hasText && nameBox && (
          <div className="absolute"
            style={{
              left: `${nameBox.x * scale}px`, top: `${nameBox.y * scale}px`,
              width: `${nameBox.w * scale}px`, height: `${nameBox.h * scale}px`,
              backgroundColor: boxColor, borderRadius: `${nameBox.radius * scale}px`,
            }} />
        )}

        {/* Nombre */}
        {hasText && family && layout && (
          <div className="absolute flex flex-col items-center justify-center overflow-hidden text-center leading-none"
            style={{ left: `${textBox.x * scale}px`, top: `${textBox.y * scale}px`, width: `${textBox.w * scale}px`, height: `${textBox.h * scale}px` }}>
            {layout.lines.map((ln, i) => (
              <div key={i} style={{ fontFamily: `"${family}"`, color: textColor, fontSize: `${fontSizePx}px`, lineHeight: LINE_HEIGHT, whiteSpace: 'nowrap' }}>
                {ln || ' '}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RotulosPlanchaModal({ open, onClose }) {
  const api = typeof window !== 'undefined' ? window.printlayout?.rotulos : null;

  const [models, setModels] = useState([]);
  const [fonts, setFonts] = useState([]);
  const [planchaId, setPlanchaId] = useState('estandar');
  const [modelId, setModelId] = useState('');
  const [fontId, setFontId] = useState('');
  const [textColor, setTextColor] = useState('#000000');
  const [boxColor, setBoxColor] = useState('#ffffff');
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [text, setText] = useState('');
  const [debouncedText, setDebouncedText] = useState('');
  const [lineModes, setLineModes] = useState({ grande: 'auto', intermedio: 'auto', chico: 'auto' });
  const [arteBySize, setArteBySize] = useState({});
  const [family, setFamily] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const loadedFontsRef = useRef(new Map());

  const selectedModel = useMemo(() => models.find((m) => m.id === modelId) || null, [models, modelId]);
  const modelComplete = useMemo(
    () => !!selectedModel && SIZE_KEYS.every((k) => selectedModel.sizes?.[k]?.textBox && selectedModel.sizes?.[k]?.arteFile),
    [selectedModel],
  );
  const drawBox = !selectedModel?.arteIncluyeRecuadro;

  useEffect(() => {
    if (!open || !api) return;
    setFeedback(null);
    setPalette(loadPalette());
    Promise.all([api.modelsList(), api.fontsList()]).then(([m, f]) => {
      const ms = Array.isArray(m) ? m : [];
      const fs = Array.isArray(f) ? f : [];
      setModels(ms);
      setFonts(fs);
      setModelId((prev) => prev || ms[0]?.id || '');
      setFontId((prev) => prev || fs[0]?.id || '');
    });
  }, [open, api]);

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
        if (s?.artePath) {
          const r = await api.readImage(s.artePath);
          if (r?.ok) out[key] = r.dataUrl;
        }
      }
      if (!cancelled) setArteBySize(out);
    })();
    return () => { cancelled = true; };
  }, [open, api, selectedModel]);

  useEffect(() => {
    if (!open || !api || !fontId) { setFamily(null); return undefined; }
    let cancelled = false;
    (async () => {
      if (loadedFontsRef.current.has(fontId)) {
        if (!cancelled) setFamily(loadedFontsRef.current.get(fontId));
        return;
      }
      const r = await api.readFont(fontId);
      if (!r?.ok) { if (!cancelled) setFamily(null); return; }
      const fam = `PLRot_${fontId}`;
      try {
        const buf = await fetch(r.dataUrl).then((x) => x.arrayBuffer());
        const face = new FontFace(fam, buf);
        await face.load();
        document.fonts.add(face);
        loadedFontsRef.current.set(fontId, fam);
        if (!cancelled) setFamily(fam);
      } catch { if (!cancelled) setFamily(null); }
    })();
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
      try {
        localStorage.setItem(PALETTE_KEY, JSON.stringify(next.filter((x) => !DEFAULT_PALETTE.includes(x))));
      } catch { /* noop */ }
      return next;
    });
  }, []);

  if (!open) return null;

  const generate = async () => {
    if (!selectedModel || !fontId || !modelComplete) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const fontRes = await api.readFont(fontId);
      if (!fontRes?.ok) { setFeedback({ kind: 'err', text: 'No se pudo leer la tipografía.' }); return; }
      const fontBytes = new Uint8Array(await fetch(fontRes.dataUrl).then((x) => x.arrayBuffer()));

      const sizes = {};
      for (const key of SIZE_KEYS) {
        const s = selectedModel.sizes?.[key];
        if (!s) continue;
        sizes[key] = { dataUrl: arteBySize[key] || null, wPx: s.wPx, hPx: s.hPx, textBox: s.textBox, cutMm: s.cutMm };
      }

      const bytes = await buildRotulosPlanchaPdf({
        model: { sizes, arteIncluyeRecuadro: !!selectedModel.arteIncluyeRecuadro },
        fontBytes,
        color: textColor,
        boxColor,
        text: debouncedText,
        lineModes,
        planchaId,
      });

      const firstLine = String(debouncedText).split('\n')[0].trim();
      const name = `Rotulos ${selectedModel.nombre}${firstLine ? ` - ${firstLine}` : ''}`;
      const r = await api.savePdf(name, bytes);
      if (r?.ok) setFeedback({ kind: 'ok', text: `PDF generado y abierto.\n${r.path}` });
      else setFeedback({ kind: 'err', text: r?.error || 'No se pudo guardar el PDF.' });
    } catch (e) {
      setFeedback({ kind: 'err', text: e.message || 'Error generando el PDF.' });
    } finally {
      setGenerating(false);
    }
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
            <p className="mt-0.5 text-xs text-ink-400">
              Elegí modelo, tipografía y colores, escribí el nombre y generá el PDF (144 rótulos). Sin corte ni QR todavía.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Cerrar</button>
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
              <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={noModels}
                className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500 disabled:opacity-50">
                {noModels ? <option value="">(no hay modelos)</option> : models.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              {selectedModel && !modelComplete && (
                <span className="mt-1 block text-[10px] text-amber-300">
                  Este modelo no tiene los 3 tamaños con su caja de texto. Completalo en “Rótulos → Modelos”.
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

            <ColorControl label="Color del texto" value={textColor} onChange={setTextColor}
              palette={palette} onAdd={() => addToPalette(textColor)} />

            <ColorControl label="Color del recuadro" value={boxColor} onChange={setBoxColor}
              palette={palette} onAdd={() => addToPalette(boxColor)} disabled={!drawBox}
              hint={!drawBox ? 'Este modelo ya trae el recuadro en el arte (no se dibuja uno).' : null} />

            <label className="text-xs text-ink-300">
              <span className="mb-1 block">Texto (Enter = corte preferido)</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
                placeholder={'Luz Martínez\n4° A T.M.'}
                className="w-full resize-none rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-accent-500" />
              <span className="mt-1 block text-[10px] text-ink-500">
                Cada tamaño decide solo 1 o 2 líneas (Auto). Podés forzarlo en cada tarjeta del preview.
              </span>
            </label>
          </div>

          {/* ---- Preview ---- */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">Vista previa</div>
            {noModels ? (
              <p className="rounded border border-dashed border-ink-700 py-10 text-center text-xs text-ink-500">
                No hay modelos. Creá uno en “Rótulos → Modelos”.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {SIZE_KEYS.map((key) => {
                  const s = selectedModel?.sizes?.[key];
                  if (!s) return null;
                  return (
                    <PlanchaSizePreview key={key} sizeKey={key} cutMm={s.cutMm} textBox={s.textBox}
                      arteDataUrl={arteBySize[key]} family={family} textColor={textColor} boxColor={boxColor}
                      drawBox={drawBox} text={debouncedText} mode={lineModes[key]}
                      onModeChange={(m) => setLineModes((prev) => ({ ...prev, [key]: m }))} />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700 p-4">
          {feedback && <p className={`mr-auto whitespace-pre-line text-[11px] ${fbColor}`}>{feedback.text}</p>}
          {!feedback && <span className="mr-auto text-[11px] text-ink-500">Plancha {planchaId} · 144 rótulos (12 + 24 + 108)</span>}
          <button type="button" onClick={onClose}
            className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800">Cerrar</button>
          <button type="button" onClick={generate} disabled={generating || !modelComplete || !fontId}
            title={!modelComplete ? 'El modelo debe tener los 3 tamaños con su caja de texto' : (!fontId ? 'Elegí una tipografía' : '')}
            className="rounded bg-accent-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40">
            {generating ? 'Generando…' : 'Generar PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
