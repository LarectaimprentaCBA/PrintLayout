// Elegir qué corrección de color se aplica a UN envío, en la ventana de
// imprimir (fotos y PDF usan el mismo control).
//
// Por defecto va la "Automática": la que le toca a esa impresora, igual que
// siempre. El desplegable dice CUÁL es, porque "automática" a secas deja
// adivinando. Lo que se elija vale solo para ese envío: no toca la calibración
// activa de la impresora.
//
// Vive aparte para que fotos y PDF no tengan dos copias que se desincronicen.
import { useEffect, useMemo, useState } from 'react';

// Nombre corto de una calibración. El nombre de la cola es lo más reconocible,
// pero es propio de cada PC y no viaja en las compartidas: si no está, va el
// final de la IP.
export function nombreCal(c) {
  const p = (c && c.correctPrinter) || {};
  const base = (p.queue && p.queue.trim())
    || (p.ip ? `impresora .${String(p.ip).split('.').pop()}` : 'impresora');
  return c && c.paperName ? `${base} · ${c.paperName}` : base;
}

/**
 * Estado del selector. `args` es lo que hay que mandarle al motor de impresión.
 * @param {string} deviceName impresora elegida ahora
 */
export function useCorreccionColor(deviceName) {
  const [cals, setCals] = useState([]);
  const [sel, setSel] = useState('auto'); // 'auto' | 'ninguna' | id
  const [autoId, setAutoId] = useState(null);

  // Las calibraciones guardadas en esta PC.
  useEffect(() => {
    let dead = false;
    window.printlayout.color?.list?.().then((r) => {
      if (!dead) setCals((r && r.ok && Array.isArray(r.calibrations)) ? r.calibrations : []);
    }).catch(() => {});
    return () => { dead = true; };
  }, []);

  // Cuál aplicaría la "Automática" con la impresora elegida ahora. Lo resuelve
  // el motor (IPC color:for-device), no una copia del criterio acá.
  useEffect(() => {
    let dead = false;
    if (!deviceName) { setAutoId(null); return undefined; }
    window.printlayout.color?.forDevice?.(deviceName).then((r) => {
      if (!dead) setAutoId(r && r.ok ? r.id : null);
    }).catch(() => { if (!dead) setAutoId(null); });
    return () => { dead = true; };
  }, [deviceName]);

  const autoCal = useMemo(() => cals.find((c) => c.id === autoId) || null, [cals, autoId]);
  const args = useMemo(() => ({
    colorCalId: (sel === 'auto' || sel === 'ninguna') ? null : sel,
    noColorCorrection: sel === 'ninguna',
  }), [sel]);

  return { cals, sel, setSel, autoCal, args };
}

/** El desplegable. `label` y `select` son los estilos de la ventana que lo usa. */
export default function CorreccionColor({ estado, disabled, label, select }) {
  const { cals, sel, setSel, autoCal } = estado;
  if (!cals.length) return null; // sin calibraciones no hay nada que elegir
  return (
    <div>
      <div style={label}>Corrección de color</div>
      <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={disabled}
        style={{ ...select, width: '100%' }}>
        <option value="auto">
          Automática{autoCal ? ` — ${nombreCal(autoCal)}` : ' — ninguna para esta impresora'}
        </option>
        <option value="ninguna">Sin corrección (tal cual el archivo)</option>
        {cals.map((c) => (
          <option key={c.id} value={c.id}>Usar: {nombreCal(c)}</option>
        ))}
      </select>
      {sel !== 'auto' && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
          Vale solo para este envío. La impresora sigue con la suya.
        </div>
      )}
    </div>
  );
}
