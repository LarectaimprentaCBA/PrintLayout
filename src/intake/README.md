# Entrada automática de pedidos de fotos (intake)

Servicio opcional que baja pedidos de fotos cargados desde la web (Supabase),
arma **una hoja de impresión/corte por cada tamaño pedido** y la deja **abierta
para revisar**. **Nunca imprime ni corta solo.** No afecta el flujo manual.

## Arquitectura (dos partes)

- **Main (`electron/intake/`)** — red y archivos:
  - `config-store.cjs`: config en `userData/intake-config.json`.
  - `supabase.cjs`: `net.fetch` con User-Agent de servidor (Supabase rechaza la
    service key si parece venir de un navegador).
  - `service.cjs`: loop de polling, descarga a temporal, marcar procesado,
    borrar del bucket. Emite `intake:order-ready` al renderer y espera
    `intake:order-built`.
- **Renderer (`src/intake/`)** — arma las imágenes (esto necesita canvas/face-api,
  que sólo existen en el renderer):
  - `buildOrderJob.js`: por cada tamaño, resuelve plantilla y arma el job
    reusando `readAnyFileToImage` (HEIC/normalización/caras), `computeGrid`.
  - `presets.js`, `sheetCriteria.js`: ver abajo.
  - `IntakePanelModal.jsx` (en `src/components/`): panel de config + estado.

El job se **guarda** (jobs-store) con nombre `P-<numero_presupuesto>-fotos` y se
**abre en una tab** para revisar.

## Qué tiene que definir Mariano

### 1) Plantillas estándar (presets)
Cada tamaño "preset" del carrito web trae `tamano.id` (p.ej. `polaroid`,
`10x15`). El armador busca la **plancha oficial cuyo `id de catálogo`
(`catalogoId`) sea igual a ese `tamano.id`**. Mariano crea la plantilla
normalmente (medidas, márgenes, marco, corte), la guarda, y la **marca oficial
tipeando ese id de catálogo** (ej. `polaroid`). Si no hay ninguna que matchee,
ese tamaño se saltea con un mensaje claro (no inventa medidas).

Checklist de ids esperados: ver `WEB_PRESET_IDS` en `presets.js` (mantenerlo en
sync con el catálogo de la web).

### 2) Criterio de hoja para tamaños CUSTOM
Los tamaños "custom" (medidas libres `wmm`/`hmm`) se arman con una grilla
calculada. El criterio de **hoja base, márgenes, espaciado y corte** está en
`sheetCriteria.js` (`CUSTOM_SHEET`). Debe coincidir con la web. Valores
actuales: hoja A4 (210×297), márgenes 10 mm, separación 3 mm, corte con plotter
(marcas a 10 mm, corte 1 mm hacia adentro), rango aceptado 40×40 mm hasta el
área útil de la hoja (190×277). Se publica a `config_fotos`
(`criterio_hoja_custom`) con "Publicar catálogo". Si lo cambiás, volvé a
publicar.

## Configuración (panel "Pedidos")
Botón **Pedidos** en la barra superior. Campos: URL de Supabase, service key
(se guarda **sólo en esta PC**, nunca en el repo), carpeta de salida, intervalo
(mín. 15s) y "activo". Botones "Probar conexión" y "Buscar ahora".

## Contrato Supabase (resumen)
- Tabla `pedido_fotos` (`items` jsonb multi-tamaño, `numero_presupuesto`,
  `procesado_printlayout`). Se procesan los pedidos con
  `procesado_printlayout=false` **y** `numero_presupuesto` no nulo.
- Bucket privado `fotos`, fotos en `fotos/<orderId>/<archivo>`.
- Al terminar de armar: `procesado_printlayout=true` (idempotente) + borrado de
  las fotos del bucket.

## Modo La Recta (gating)
El panel "Pedidos" y las acciones de admin (bajar pedidos, marcar/publicar
oficiales) sólo aparecen en la **PC de La Recta**: requiere la service key
presente **y** el flag `laRecta` (checkbox "Esta PC es de La Recta"). En las
demás PCs el botón "Pedidos" no se muestra y el servicio queda inerte.

Primera configuración (el botón está oculto hasta activar el modo): atajo
**Ctrl+Shift+L** abre el panel para cargar URL + clave + tildar "Esta PC es de
La Recta" y Guardar.

## Planchas oficiales (solo-lectura)
Una plantilla con `oficial: true` alimenta la web/CRM. Fuera de modo La Recta no
se puede borrar ni editar (badge "oficial" + 🔒). En modo La Recta hay un botón
"Marcar/Quitar oficial" en el listado de plantillas (Nuevo trabajo).

## Catálogo de planchas (PrintLayout = fuente de verdad)
Al marcar oficial (Mariano tipea el **id de catálogo**, ej. "polaroid") o con el
botón "Publicar catálogo", se hace upsert a `planchas_catalogo`. Al **quitar**
oficial → baja lógica (`activo=false`, NO se borra la fila). **Los precios NO van
acá** (los maneja el CRM, vía `precios_planchas.plancha_id = id`).

- `id` = id ESTABLE de catálogo/negocio (lo confirma Mariano). Enganche con la web
  (`items.tamano.id`) y el CRM. Se mantiene aunque cambie la plantilla interna.
- `plantilla_printlayout` = id interno de la plantilla (cómo la carga PrintLayout).

DDL sugerida en Supabase:
```sql
create table if not exists planchas_catalogo (
  id text primary key,             -- id de catálogo/negocio (ej. "polaroid")
  label text,
  wmm numeric,                     -- ancho de la FOTO
  hmm numeric,                     -- alto de la FOTO
  fotos_por_plancha int,
  plantilla_printlayout text,      -- id interno de la plantilla en PrintLayout
  activo boolean default true,     -- baja lógica; la web filtra activo=true
  marco_wmm numeric,               -- ancho del MARCO (corte exterior); null si va a sangre
  marco_hmm numeric,               -- alto del MARCO; null si va a sangre
  foto_left_mm numeric,            -- offset de la foto dentro del marco (izq); null si va a sangre
  foto_top_mm numeric,             -- offset de la foto dentro del marco (arriba); null si va a sangre
  updated_at timestamptz default now()
);

-- Si la tabla ya existía, sumar las 4 columnas del marco:
alter table planchas_catalogo
  add column if not exists marco_wmm numeric,
  add column if not exists marco_hmm numeric,
  add column if not exists foto_left_mm numeric,
  add column if not exists foto_top_mm numeric;

-- Key-value de config de fotos. El criterio del "A medida" va acá:
create table if not exists config_fotos (
  clave text primary key,
  valor jsonb,
  updated_at timestamptz default now()
);
-- clave='criterio_hoja_custom' → valor {paperW,paperH,marginX,marginY,spacingX,spacingY}
```

## Seguridad
La service key vive **sólo** en `userData/intake-config.json`. No poner claves
en el repo ni en el bundle.
