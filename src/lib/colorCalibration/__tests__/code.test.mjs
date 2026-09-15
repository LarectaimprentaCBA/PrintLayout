// Prueba del código legible por máquina (code.js). Pura JS (node), sin Electron.
//   node src/lib/colorCalibration/__tests__/code.test.mjs
import {
  encodeBits, decodeBits, N_CELLS, ROLE_REFERENCE, ROLE_CORRECT,
  BAND_X0, BAND_Y, CELL_W, CELL_H, readCode, pairByCode,
} from '../code.js';

let fails = 0;
const ok = (name, cond, detail = '') => { console.log((cond ? 'OK  ' : 'FAIL') + '  ' + name + (detail ? '  [' + detail + ']' : '')); if (!cond) fails++; };

// (a) round-trip encode/decode para muchos id/rol
let allRt = true;
for (let t = 0; t < 5000; t++) {
  const id = 1 + Math.floor(Math.random() * 0xfffe);
  const role = Math.random() < 0.5 ? ROLE_REFERENCE : ROLE_CORRECT;
  const d = decodeBits(encodeBits(id, role));
  if (!d || d.sessionId !== id || d.role !== role) { allRt = false; break; }
}
ok('encode/decode round-trip (5000 casos)', allRt);

// (b) el control rechaza un bit dado vuelta (en promedio)
let caught = 0, tries = 2000;
for (let t = 0; t < tries; t++) {
  const id = 1 + Math.floor(Math.random() * 0xfffe);
  const bits = encodeBits(id, ROLE_CORRECT);
  const flip = 2 + Math.floor(Math.random() * (N_CELLS - 2)); // no toco guardas
  bits[flip] ^= 1;
  if (decodeBits(bits) === null || decodeBits(bits).sessionId !== id) caught++;
}
ok('control detecta 1 bit cambiado (>97%)', caught / tries > 0.97, (100 * caught / tries).toFixed(1) + '%');

// (c) lectura a nivel de píxel desde un buffer sintético (300 dpi, con ruido)
function renderAndRead(id, role, noise) {
  const s = 300 / 25.4;      // px por mm
  const off = 40;            // margen px
  const W = Math.ceil((BAND_X0 + N_CELLS * CELL_W + 20) * s) + off * 2;
  const H = Math.ceil((BAND_Y + 20) * s) + off * 2;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const bits = encodeBits(id, role);
  const mm2px = (mm) => Math.round(mm * s + off);
  for (let i = 0; i < N_CELLS; i++) {
    if (!bits[i]) continue;
    const cx = BAND_X0 + i * CELL_W + CELL_W / 2;
    const x0 = mm2px(cx - CELL_W / 2), x1 = mm2px(cx + CELL_W / 2);
    const y0 = mm2px(BAND_Y - CELL_H / 2), y1 = mm2px(BAND_Y + CELL_H / 2);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const j = (y * W + x) * 4; data[j] = data[j + 1] = data[j + 2] = 0;
    }
  }
  if (noise) for (let k = 0; k < data.length; k++) if (k % 4 !== 3) data[k] = Math.max(0, Math.min(255, data[k] + (Math.random() - 0.5) * noise));
  const sampleLum = (cxMm, cyMm, halfMm) => {
    const cx = Math.round(cxMm * s + off), cy = Math.round(cyMm * s + off);
    const half = Math.max(1, Math.round(halfMm * s));
    let sum = 0, n = 0;
    for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
      const j = (y * W + x) * 4; sum += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]; n++;
    }
    return sum / n;
  };
  return readCode(sampleLum);
}
let allPix = true;
for (let t = 0; t < 200; t++) {
  const id = 1 + Math.floor(Math.random() * 0xfffe);
  const role = t % 2 ? ROLE_CORRECT : ROLE_REFERENCE;
  const r = renderAndRead(id, role, 12);
  if (!r || r.sessionId !== id || r.role !== role) { allPix = false; console.log('  falló id=' + id + ' role=' + role, r); break; }
}
ok('lectura a nivel de píxel con ruido (200 casos)', allPix);

// (d) pairByCode: empareja sin importar el orden y rechaza casos malos
const mkScan = (id, role) => ({ code: { sessionId: id, role } });
const p1 = pairByCode(mkScan(1234, ROLE_CORRECT), mkScan(1234, ROLE_REFERENCE));
ok('pairByCode empareja aunque vengan cruzados', p1.buena.code.role === ROLE_REFERENCE && p1.palida.code.role === ROLE_CORRECT);
let rejSession = false; try { pairByCode(mkScan(1, ROLE_REFERENCE), mkScan(2, ROLE_CORRECT)); } catch (e) { rejSession = e.message === 'CODE_SESSION_MISMATCH'; }
ok('pairByCode rechaza sesiones distintas', rejSession);
let rejDup = false; try { pairByCode(mkScan(5, ROLE_CORRECT), mkScan(5, ROLE_CORRECT)); } catch (e) { rejDup = e.message === 'CODE_ROLE_DUP'; }
ok('pairByCode rechaza dos veces el mismo rol', rejDup);

console.log(fails === 0 ? '\n*** CODE OK ***' : '\n*** CODE: ' + fails + ' fallos ***');
process.exit(fails === 0 ? 0 : 1);
