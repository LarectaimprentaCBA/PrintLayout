import React from 'react';

// Barra superior compartida por las ventanas de fotos y PDF: elegir impresora,
// "Configurar impresora" (mismo DEVMODE que PrintLayout), cartel de corrección de
// color activa, y el tamaño de hoja leído de la configuración de la impresora.
export default function PrinterBar({
  printers, deviceName, onDeviceChange, onConfigure, configuring,
  pageInfo, colorActive, busy,
}) {
  const paperTxt = pageInfo
    ? `Hoja: ${paperLabel(pageInfo.paperWmm, pageInfo.paperHmm)} ${round(pageInfo.paperWmm)}×${round(pageInfo.paperHmm)} mm`
      + (pageInfo.duplex ? ' · doble faz' : '')
    : 'Hoja: leyendo…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ opacity: 0.7, fontSize: 13 }}>Impresora:</span>
        <select
          value={deviceName || ''}
          onChange={(e) => onDeviceChange(e.target.value)}
          disabled={busy}
          style={selStyle}
        >
          {(printers || []).length === 0 && <option value="">(sin impresoras)</option>}
          {(printers || []).map((p) => (
            <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (predeterminada)' : ''}</option>
          ))}
        </select>
        <button onClick={onConfigure} disabled={busy || configuring || !deviceName} style={btnStyle}>
          {configuring ? 'Configurando…' : 'Configurar impresora'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <span style={{ opacity: 0.8 }}>{paperTxt}</span>
        {colorActive && (
          <span style={{ color: '#7dd3fc' }}>🎨 Corrección de color activa</span>
        )}
      </div>
    </div>
  );
}

function round(n) { return Math.round(Number(n) || 0); }

// Etiqueta de tamaño conocido (A4/A3/SRA3/…); si no, vacío.
function paperLabel(wmm, hmm) {
  const w = Math.min(wmm, hmm), h = Math.max(wmm, hmm);
  const near = (a, b) => Math.abs(a - b) <= 3;
  if (near(w, 210) && near(h, 297)) return 'A4';
  if (near(w, 297) && near(h, 420)) return 'A3';
  if (near(w, 320) && near(h, 450)) return 'SRA3';
  if (near(w, 216) && near(h, 279)) return 'Carta';
  if (near(w, 100) && near(h, 150)) return '10×15';
  if (near(w, 130) && near(h, 180)) return '13×18';
  return '';
}

const selStyle = {
  flex: 1, minWidth: 200, background: '#1a1d22', color: '#e5e7eb',
  border: '1px solid #333', borderRadius: 6, padding: '6px 8px', fontSize: 13,
};
const btnStyle = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 12px', fontSize: 13, cursor: 'pointer',
};
