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
Al marcar oficial / con el botón "Publicar catálogo", se hace upsert a la tabla
`planchas_catalogo`. Una fila por plancha oficial + una fila `personalizado` con
el criterioHoja global. **Los precios NO van acá** (los maneja el CRM).

DDL sugerida en Supabase:
```sql
create table if not exists planchas_catalogo (
  id text primary key,            -- = id interno de la plantilla (estable)
  label text,
  wmm numeric,                    -- tamaño de la foto (null en 'personalizado')
  hmm numeric,
  fotos_por_plancha int,
  criterio_hoja jsonb,            -- hoja base + márgenes + espaciado (custom)
  updated_at timestamptz default now()
);
```
El id `personalizado` es la fila con el criterioHoja para tamaños custom.

## Seguridad
La service key vive **sólo** en `userData/intake-config.json`. No poner claves
en el repo ni en el bundle.
