// Al abrir la app, las pestañas de la última vez se reabren solas. Acá se prueba
// cómo se juntan con lo que ya haya en pantalla en ese instante.
// Corre con: npm run test:reabrir-pestanas
import { mergeRestoredTabs, tieneTrabajo } from '../restoreTabs.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FALLA ${n}  ${e}`); }
};
const ids = (r) => r.tabs.map((t) => t.id).join(',');
const vacia = (id) => ({ id, name: 'Sin titulo 1', template: null, jobId: null });
const conTrabajo = (id) => ({ id, name: id, template: { id: `tpl_${id}` }, jobId: null });

console.log('\n1) Lo normal: en pantalla solo está la pestaña vacía del arranque');
{
  const guardadas = [conTrabajo('a'), conTrabajo('b'), conTrabajo('c')];
  const r = mergeRestoredTabs([vacia('ini')], 'ini', guardadas, 'b');
  check('quedan las 3 guardadas, en su orden, sin la vacía', ids(r) === 'a,b,c', ids(r));
  check('queda activa la que estaba activa la última vez', r.activeTabId === 'b', r.activeTabId);
  check('las pestañas guardadas no se tocan', r.tabs[0] === guardadas[0] && r.tabs[2] === guardadas[2]);
}

console.log('\n2) Ya se abrió algo antes de terminar (doble clic en un .pljob con la app cerrada)');
{
  const r = mergeRestoredTabs([vacia('ini'), conTrabajo('nuevo')], 'nuevo', [conTrabajo('a'), conTrabajo('b')], 'a');
  check('lo recién abierto NO se pierde: queda al final', ids(r) === 'a,b,nuevo', ids(r));
  check('y sigue siendo la pestaña activa', r.activeTabId === 'nuevo', r.activeTabId);
  const r2 = mergeRestoredTabs([conTrabajo('nuevo')], 'otra', [conTrabajo('a')], 'a');
  check('si la activa no era la nueva: activa la guardada', r2.activeTabId === 'a' && ids(r2) === 'a,nuevo');
  const jobSolo = { id: 'j', name: 'guardado', template: null, jobId: 'job_1' };
  check('una pestaña con trabajo guardado (sin plantilla cargada) también se conserva',
    ids(mergeRestoredTabs([jobSolo], 'j', [conTrabajo('a')], 'a')) === 'a,j');
}

console.log('\n3) Casos raros');
{
  const r = mergeRestoredTabs([vacia('ini')], 'ini', [conTrabajo('a'), conTrabajo('b')], 'no-existe');
  check('la activa guardada ya no existe: se activa la primera', r.activeTabId === 'a');
  const rep = mergeRestoredTabs([conTrabajo('a')], 'a', [conTrabajo('a'), conTrabajo('b')], 'b');
  check('una pestaña que ya está entre las guardadas no se duplica', ids(rep) === 'a,b', ids(rep));
  const solaVacia = mergeRestoredTabs([vacia('ini')], 'ini', [vacia('g')], 'g');
  check('lo guardado era una pestaña vacía: queda esa sola', ids(solaVacia) === 'g' && solaVacia.activeTabId === 'g');
  check('sin pestañas en pantalla: no rompe', ids(mergeRestoredTabs(null, null, [conTrabajo('a')], 'a')) === 'a');
  check('tieneTrabajo: vacía no, con plantilla sí, con jobId sí',
    !tieneTrabajo(vacia('x')) && tieneTrabajo(conTrabajo('x')) && tieneTrabajo({ id: 'x', jobId: 'j' }) && !tieneTrabajo(null));
}

console.log(`\nRESULTADO: ${pass} OK, ${fail} FALLAS`);
process.exitCode = fail ? 1 : 0;
