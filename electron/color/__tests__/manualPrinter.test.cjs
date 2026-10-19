// La asignación manual tiene que ser por COLA, no por IP.
//
// Por qué: el plóter Epson entra por "EpsonNet Print Port", que lo encuentra por
// su MAC. Sigue imprimiendo aunque le cambie la IP, pero el puerto de Windows se
// queda con la vieja (verificado: el puerto decía 192.168.100.25 y la máquina
// estaba en .106). Si la corrección se guiara por IP, dejaría de aplicarse en
// silencio — o peor, se le aplicaría a otra máquina que tomó esa IP.
//
// Corre con: npm run test:manual-printer   (necesita electron: usa app.getPath)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-colorstore-'));
app.setPath('userData', tmp);

const store = require('../store.cjs');
const { resolveColorApplier } = require('../../print-core.cjs');

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};

const COLA_PLOTTER = 'SC-T3100X Series(Network)';
const PUERTO_PLOTTER = 'EPD39F8B:SC-T3100X SERIES';
const IP_VIEJA = '192.168.100.25';
const IP_REAL = '192.168.100.106';
const IP_198 = '192.168.100.198';

const lutTonta = (S) => Array.from({ length: S * S * S * 3 }, () => 0);

function escribirCrudo(obj) {
  fs.writeFileSync(store.storePath(), JSON.stringify(obj, null, 2), 'utf-8');
}

// ── 1) Migración: lo que ya estaba asignado sigue asignado ──────────────────
console.log('\n1) Migración del mapa viejo cola→IP');
escribirCrudo({
  version: 1,
  calibrations: [],
  manualIp: { [COLA_PLOTTER]: IP_REAL },
  backups: [],
});
let mp = store.getManualPrinter();
check('la cola quedó asignada', !!mp[COLA_PLOTTER], JSON.stringify(mp));
check('conserva la IP', mp[COLA_PLOTTER] && mp[COLA_PLOTTER].ip === IP_REAL, JSON.stringify(mp[COLA_PLOTTER]));
check('getManualIp sigue devolviendo el mapa viejo',
  store.getManualIp()[COLA_PLOTTER] === IP_REAL, JSON.stringify(store.getManualIp()));

// ── 2) Asignar guarda cola + puerto, y sobrevive a releer ───────────────────
console.log('\n2) Asignar guarda cola y puerto, y persiste');
store.setManualPrinter(COLA_PLOTTER, { ip: IP_REAL, queue: COLA_PLOTTER, port: PUERTO_PLOTTER });
mp = store.getManualPrinter(); // releer = equivale a cerrar y volver a abrir
check('persiste la IP', mp[COLA_PLOTTER].ip === IP_REAL);
check('persiste el nombre de cola', mp[COLA_PLOTTER].queue === COLA_PLOTTER);
check('persiste el puerto', mp[COLA_PLOTTER].port === PUERTO_PLOTTER);
check('queda la fecha de asignación', !!mp[COLA_PLOTTER].assignedAt);

// ── 3) Resolver por cola ────────────────────────────────────────────────────
console.log('\n3) La corrección se resuelve por cola');
store.save({
  id: 'cal-plotter', engineVersion: 1,
  correctPrinter: { ip: IP_REAL, queue: COLA_PLOTTER, port: PUERTO_PLOTTER },
  referencePrinter: { ip: '192.168.100.127', queue: 'RICOH .127' },
  lutSize: 5, lut: lutTonta(5), active: true,
});
check('encuentra la calibración de esa cola',
  (store.getActiveForQueue(COLA_PLOTTER) || {}).id === 'cal-plotter');
check('una cola sin asignar no resuelve por cola',
  store.getActiveForQueue('Otra impresora') === null);

// ── 4) Le cambia la IP al plóter: tiene que seguir andando ──────────────────
console.log('\n4) Cambia la IP del plóter (la guardada queda vieja)');
store.setManualPrinter(COLA_PLOTTER, { ip: IP_VIEJA, queue: COLA_PLOTTER, port: PUERTO_PLOTTER });
check('sigue encontrando la calibración (por nombre de cola)',
  (store.getActiveForQueue(COLA_PLOTTER) || {}).id === 'cal-plotter',
  JSON.stringify(store.getActiveForQueue(COLA_PLOTTER)));

// ...y también si lo que cambió es el nombre de cola pero no el puerto.
store.setManualPrinter(COLA_PLOTTER, { ip: IP_VIEJA, queue: 'nombre que ya no existe', port: PUERTO_PLOTTER });
check('encuentra por puerto cuando ni la IP ni la cola coinciden',
  (store.getActiveForQueue(COLA_PLOTTER) || {}).id === 'cal-plotter');
store.setManualPrinter(COLA_PLOTTER, { ip: IP_REAL, queue: COLA_PLOTTER, port: PUERTO_PLOTTER });

// ── 5) Una IP asignada a mano no se le aplica a otra cola ───────────────────
console.log('\n5) Si otra máquina toma esa IP, no se corrige por error');
check('la misma IP, desde otra cola, no dispara la corrección',
  store.getActiveForIp(IP_REAL, 'Impresora distinta') === null);
check('desde la cola asignada, sí',
  (store.getActiveForIp(IP_REAL, COLA_PLOTTER) || {}).id === 'cal-plotter');

// ── 6) Lo que ya andaba por IP sigue andando igual ──────────────────────────
console.log('\n6) La calibración vieja de la Ricoh .198 (por IP) no cambia');
store.save({
  id: 'cal-198', engineVersion: 1,
  correctPrinter: { ip: IP_198, queue: 'RICOH MP C8003 PCL 6_1 NVA' },
  referencePrinter: { ip: '192.168.100.127', queue: 'RICOH MP C8003 PCL 6' },
  lutSize: 5, lut: lutTonta(5), active: true,
});
check('resuelve por IP sin asignación manual',
  (store.getActiveForIp(IP_198, 'RICOH MP C8003 PCL 6_1 NVA') || {}).id === 'cal-198');
check('no la ensucia la asignación del plóter',
  (store.getActiveForQueue(COLA_PLOTTER) || {}).id === 'cal-plotter');

// ── 7) Quitar la asignación ─────────────────────────────────────────────────
console.log('\n7) Quitar la asignación');
store.setManualPrinter(COLA_PLOTTER, null);
check('la cola deja de estar asignada', !store.getManualPrinter()[COLA_PLOTTER]);
check('y el mapa viejo también queda limpio', !store.getManualIp()[COLA_PLOTTER]);
store.setManualPrinter(COLA_PLOTTER, { ip: IP_REAL, queue: COLA_PLOTTER, port: PUERTO_PLOTTER });

// ── 8) El camino real de impresión elige por cola ───────────────────────────
(async () => {
  console.log('\n8) resolveColorApplier (lo que corre al imprimir)');
  const r1 = await resolveColorApplier({ deviceName: COLA_PLOTTER, showDialog: false, noColorCorrection: false });
  check('aplica la corrección en la cola asignada', !!r1.applier, r1.colorStatus && r1.colorStatus.state);
  check('y dice que la resolvió por cola', r1.colorVia === 'cola', r1.colorVia);
  check('con la calibración correcta', r1.colorCal && r1.colorCal.id === 'cal-plotter');
  if (r1.applier) r1.applier.dispose();

  const r2 = await resolveColorApplier({ deviceName: 'Microsoft Print to PDF', showDialog: false, noColorCorrection: false });
  check('otra impresora no se corrige', !r2.applier, JSON.stringify(r2.colorStatus));
  check('y no avisa de un fallo falso', r2.colorStatus.state === 'no-corresponde', JSON.stringify(r2.colorStatus));

  const r3 = await resolveColorApplier({ deviceName: COLA_PLOTTER, showDialog: false, noColorCorrection: true });
  check('la carta de calibración se manda SIN corregir', !r3.applier);
  if (r3.applier) r3.applier.dispose();

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* nada */ }
  console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
  app.exit(fail ? 1 : 0);
})();
