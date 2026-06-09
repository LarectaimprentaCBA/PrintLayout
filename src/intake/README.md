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
`10x15`). El armador busca una **plantilla guardada en PrintLayout cuyo `id` sea
igual a ese `tamano.id`**. Mariano debe **crear esas plantillas** (medidas,
márgenes, marco, corte) con el id correspondiente. Si falta, ese tamaño se
saltea con un mensaje claro (no inventa medidas).

Checklist de ids esperados: ver `WEB_PRESET_IDS` en `presets.js` (mantenerlo en
sync con el catálogo de la web).

### 2) Criterio de hoja para tamaños CUSTOM
Los tamaños "custom" (medidas libres `wmm`/`hmm`) se arman con una grilla
calculada. El criterio de **hoja base, márgenes, espaciado y corte** está en
`sheetCriteria.js` como **PLACEHOLDER** (`CUSTOM_SHEET`). Mariano debe ponerlo
**igual que la web** para que la hoja coincida con lo que el cliente vio/pagó.

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

## Seguridad
La service key vive **sólo** en `userData/intake-config.json`. No poner claves
en el repo ni en el bundle.
