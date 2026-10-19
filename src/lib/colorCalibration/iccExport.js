// Arma el paquete que se guarda al exportar una calibración como perfil ICC:
// los bytes del .icc, el nombre de archivo y el .txt con las instrucciones.
//
// El perfil se genera ACÁ (en el renderer) y lo ESCRIBE el proceso principal.
// Es a propósito: el motor (icc.js / colorMath.js) es ESM y vive en src/, que
// Vite empaqueta para el renderer pero NO se copia al build del main. Portarlo
// a CommonJS sería duplicar ~600 líneas de matemática delicada y arriesgarse a
// que las dos copias se desincronicen.

import { buildIccProfile, nombreArchivoPerfil, descripcionPerfil } from './icc.js';

/**
 * Fecha del perfil. DETERMINISTA a propósito: sale del `updatedAt` de la
 * calibración, no de "ahora". La cabecera ICC lleva fecha y hora, así que si
 * cada PC lo generara con su reloj, el mismo perfil daría archivos distintos
 * (distinto hash) en cada máquina. Con esto, todas las PC que bajan la misma
 * calibración compartida escriben un .icc byte por byte idéntico.
 */
function fechaDe(cal) {
  const t = Date.parse(cal?.updatedAt || cal?.createdAt || '');
  return Number.isFinite(t) ? new Date(t) : new Date(Date.UTC(2026, 0, 1));
}

/** Texto de instrucciones que se guarda al lado del perfil. */
export function instruccionesPerfil(cal, nombreArchivo) {
  const ipC = cal?.correctPrinter?.ip || '(sin IP)';
  const ipR = cal?.referencePrinter?.ip || '(sin IP)';
  const papel = cal?.paperName ? cal.paperName : '(no quedó anotado)';
  const cfg = cal?.config || null;
  const dato = (v) => (v && String(v).trim() ? String(v).trim() : '(no lo dice el driver)');
  const bloqueConfig = cfg ? [
    '',
    'ESTE PERFIL VALE CON ESTA CONFIGURACIÓN',
    '---------------------------------------',
    `  Papel del driver : ${dato(cfg.papel)}`,
    `  Tipo de papel    : ${dato(cfg.tipo)}`,
    `  Calidad          : ${dato(cfg.calidad)}`,
    `  Gestión de color : ${dato(cfg.color)}`,
    'Si imprimís con otro papel, otra calidad u otra gestión de color, el perfil',
    'no corresponde y hay que calibrar de nuevo.',
  ] : [];
  return [
    'PERFIL DE COLOR DE PRINTLAYOUT',
    '==============================',
    '',
    `Archivo: ${nombreArchivo}`,
    `Corrige la impresora: ${ipC}`,
    `Para que se parezca a: ${ipR}`,
    `Papel con el que se calibró: ${papel}`,
    ...bloqueConfig,
    '',
    'Este perfil lleva la MISMA corrección de color que PrintLayout aplica solo',
    'cuando imprimís desde la app. Sirve para usarla desde AFUERA (Corel, o',
    'cualquier programa, a través de la cola de Windows).',
    '',
    '',
    'CAMINO 1 — DESDE COREL',
    '----------------------',
    '1) Herramientas -> Administración de color -> cargar este perfil desde archivo.',
    '2) Al imprimir, solapa COLOR:',
    '     - que las conversiones las haga COREL (no la impresora)',
    `     - perfil de salida = ${nombreArchivo.replace(/\.icc$/i, '')}`,
    '     - intención: colorimétrico relativo',
    '3) En Preferencias de la impresora (el driver): gestión de color APAGADA y',
    '   los ajustes de color del driver en 0.',
    '',
    '',
    'CAMINO 2 — ASOCIADO A LA COLA DE WINDOWS (cualquier programa)',
    '-------------------------------------------------------------',
    'Es el camino para el plóter Epson, cuyo driver no tiene ajustes de color:',
    'solo acepta un perfil.',
    '1) Panel de control -> Administración de color -> solapa Dispositivos.',
    '2) Elegir la impresora -> tildar "Usar mi configuración para este',
    '   dispositivo" -> Agregar... -> este perfil -> dejarlo como predeterminado.',
    '3) En el driver: gestión de color en ICM / "lo maneja el sistema"',
    '   (en el Epson: PageColorManagement = Driver,',
    '    PageDestinationColorProfile = DriverConfiguration).',
    '4) En este caso COREL NO tiene que convertir (dejá que lo haga la impresora),',
    '   porque si no se corrige dos veces.',
    '',
    '',
    'AVISO IMPORTANTE — NO CORREGIR DOS VECES',
    '----------------------------------------',
    'La corrección tiene que aplicarse UNA SOLA VEZ. Elegí UNO de los dos',
    'caminos, no los dos juntos. Si Corel convierte Y además el perfil está',
    'puesto en la cola de Windows, el color sale pasado de rosca.',
    '',
    'PrintLayout sigue corrigiendo por su cuenta cuando imprimís DESDE la app:',
    'eso no se pisa con esto, porque son trabajos distintos.',
    '',
    'El perfil vale para el PAPEL y la CALIDAD con los que se calibró. Si cambiás',
    'de papel, hay que calibrar de nuevo y exportar otro perfil.',
    '',
  ].join('\r\n');
}

/**
 * Arma todo lo necesario para guardar el perfil de una calibración.
 * @returns {{bytes:Uint8Array, fileName:string, txtName:string, txt:string, descripcion:string}}
 */
export function construirPerfil(cal) {
  const fecha = fechaDe(cal);
  const fileName = nombreArchivoPerfil(cal, fecha);
  const descripcion = descripcionPerfil(cal, fecha);
  const bytes = buildIccProfile(cal, { descripcion, fecha });
  return {
    bytes,
    fileName,
    txtName: fileName.replace(/\.icc$/i, '') + ' - COMO USARLO.txt',
    txt: instruccionesPerfil(cal, fileName),
    descripcion,
  };
}
