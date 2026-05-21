# Trabajos guardados + UI de tabs (estilo Corel) — Implementation Plan

> **Para agentic workers:** Plan multi-fase. Cada fase es un commit independiente y testeable. NO avanzar a la siguiente fase sin que el usuario valide la actual. Usar checkbox (`- [ ]`) syntax para tracking.

## Goal

Permitir guardar el estado completo de un trabajo en curso (plantilla + imágenes + asignaciones + estado del editor) en un archivo nombrado, y abrirlo cuando se quiera. En particular para **plantillas dinámicas** (grilla rápida, +Auto, +Cantidad) que hoy se pierden al cerrar la app.

A más largo plazo, ir hacia una UI multi-documento con tabs estilo Corel/Photoshop donde cada tab es un trabajo independiente.

## Motivación

- Las plantillas dinámicas tienen ID generado al vuelo. El auto-save por templateId (work-states) no las cubre.
- Caso de uso real: imprimir varias páginas, mandar al plotter, algo falla → hoy hay que reconstruir todo desde cero.
- El usuario trabaja MUCHO con dinámicas, así que esto es prioritario.

## Arquitectura general

**Job (trabajo)** = paquete autocontenido `{ id, name, createdAt, updatedAt, template (full inline), images, assignmentsFront, assignmentsBack, minPages }`. La plantilla viaja adentro, así un job nunca se rompe aunque borres la plantilla original.

**Storage**: archivos JSON en `userData/jobs/{jobId}.json`. Patrón idéntico a `work-states-store.cjs` (atomic write, file-per-record).

**Tabs (Fase B+)**: state `tabs: Array<TabState>`, `activeTabId`. Cada tab tiene todo su layout state. Al switchear tabs, save/restore desde un Map en memoria (mismo patrón que ya implementamos para templateStatesRef).

## Fases (orden de ejecución)

| Fase | Scope | Riesgo | Tiempo estimado |
|---|---|---|---|
| **A** | Backend jobs + Save/Open en modo single-doc | Bajo | 1 sesión |
| **B** | Tab bar visual + estado per-tab en memoria | Alto (refactor de layout state) | 1-2 sesiones |
| **C** | Modal "Nuevo trabajo" con todas las opciones de creación | Medio | 1 sesión |
| **D** | Esconder TemplatesSidebar + "Manage plantillas" en TopBar | Medio | 1 sesión |
| **E** | Auto-save de tabs + restore on startup | Medio | 1 sesión |
| **F** | Polish: atajos, right-click menu, drag-to-reorder, indicador unsaved | Bajo | 1 sesión |

---

## Fase A — Backend de trabajos + Save/Open single-doc

**Goal**: poder guardar el estado actual como un trabajo nombrado y reabrirlo después, sin tocar la UI de tabs todavía.

### Archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `electron/jobs-store.cjs` | Crear | CRUD de jobs en `userData/jobs/` |
| `electron/main.cjs` | Modificar | IPC handlers `jobs:list/load/save/delete` |
| `electron/preload.cjs` | Modificar | Exponer `printlayout.jobs.*` |
| `src/hooks/useJobs.js` | Crear | Hook con lista de jobs + ops CRUD |
| `src/components/SaveJobModal.jsx` | Crear | Modal "Guardar como trabajo..." (input nombre) |
| `src/components/JobsListModal.jsx` | Crear | Modal "Abrir trabajo" (lista con thumbnails) |
| `src/App.jsx` | Modificar | Wiring: handlers saveAsJob/openJob, current jobId state |
| `src/components/TopBar.jsx` | Modificar | Botones "Guardar trabajo" + "Abrir trabajo" |

### Modelo de datos

```js
// Job en disco (userData/jobs/{id}.json)
{
  id: "job_xxxxx",           // generado al guardar
  name: "Tarjetas Juan",     // del usuario
  createdAt: ISO,
  updatedAt: ISO,
  // estado completo del editor:
  template: { ...full template... },
  images: [{ id, name, dataUrl, width, height, ... }],
  assignmentsFront: [imageId | null, ...],
  assignmentsBack: [imageId | null, ...],
  minPages: 1,
}
```

### App state nuevo

```js
const [currentJobId, setCurrentJobId] = useState(null); // null = trabajo sin guardar
const [currentJobName, setCurrentJobName] = useState(null); // null = "Sin título"
const [isDirty, setIsDirty] = useState(false); // cambios sin guardar
```

`isDirty` se setea `true` en cada acción del editor; se setea `false` al guardar o al abrir un trabajo.

### Tareas

- [ ] **A1**: Crear `electron/jobs-store.cjs` con `list()`, `load(id)`, `save(payload)`, `remove(id)`. Mismo patrón que `work-states-store.cjs`. `save()` genera id si no viene y devuelve el job con id+timestamps.

- [ ] **A2**: Agregar IPC handlers en `main.cjs`: `jobs:list`, `jobs:load`, `jobs:save`, `jobs:delete`. Importar el store.

- [ ] **A3**: Exponer en `preload.cjs`: `jobs: { list, load, save, delete }`.

- [ ] **A4**: Crear `useJobs.js` hook. State: `jobs` (lista, con metadata sin dataUrls). Métodos: `refresh`, `save(payload)`, `remove(id)`, `load(id)`.
  - Inicial: llamar `list()` al mount.
  - `list()` en el store devuelve metadata light (sin images dataUrls) para no cargar 200 MB en memoria. Crear método `listLight()` en jobs-store que lee solo `{ id, name, createdAt, updatedAt, thumbnailDataUrl }` de cada archivo. Para thumbnail, sacar la primera imagen y resizearla a 80px en `save()`, guardar en el JSON.

- [ ] **A5**: Crear `SaveJobModal.jsx`. Input nombre, default = currentJobName si existe. Botones "Cancelar" / "Guardar". Validación: nombre no vacío.

- [ ] **A6**: Crear `JobsListModal.jsx`. Grid de cards con thumbnail + nombre + fecha. Acciones por card: "Abrir", "Renombrar", "Duplicar", "Eliminar" (con confirmación). Buscador por nombre. Botón "Cancelar".

- [ ] **A7**: En `App.jsx`:
  - Agregar `currentJobId`, `currentJobName`, `isDirty` state.
  - `handleSaveAsJob({ name })`: arma payload con estado actual → `useJobs.save(payload)` → setea `currentJobId/Name`, `isDirty=false`. Si ya hay `currentJobId`, hace update (mismo id).
  - `handleOpenJob(id)`: si `isDirty`, confirm "Perder cambios?". Carga job → `setSelectedId(null)` → setea `dynamicTemplate` o `selectedId` según el template del job → vuelca al layout (necesita método `loadFromJob` en useLayoutEditor que setea images, assignmentsFront, assignmentsBack, minPages directo, sin pasar por add/assign).
  - `isDirty` se setea true en el snapshot effect de useLayoutEditor (cualquier cambio = dirty).

- [ ] **A8**: En `TopBar.jsx`:
  - Botón "Guardar" (Ctrl+S): si `currentJobId` existe → save directo. Si no → abre SaveJobModal.
  - Botón "Guardar como..." (Ctrl+Shift+S): siempre abre SaveJobModal con currentJobName como default.
  - Botón "Abrir trabajo..." (Ctrl+O): abre JobsListModal.
  - Indicador del nombre del trabajo + asterisco si dirty: `"Sin título *"` o `"Tarjetas Juan *"`.

- [ ] **A9**: Agregar método `loadFromJob(jobData)` en `useLayoutEditor.js`. Carga el state directamente, salteándose el flujo normal de add/assign. Marca skipNextSnapshot. Resetea history. Actualiza templateStatesRef si corresponde.

- [ ] **A10**: Build + smoke test:
  - Crear grilla rápida con 10 fotos.
  - Asignar a celdas.
  - Guardar como "Test 1".
  - Cerrar la app.
  - Reabrir.
  - Abrir trabajo → verificar que todo está.

### Acceptance criteria Fase A

- [ ] Puedo guardar el estado actual con un nombre y verlo en una lista al reabrir la app.
- [ ] Funciona con plantillas dinámicas (grilla rápida, +Auto, +Cantidad).
- [ ] Funciona con plantillas guardadas también.
- [ ] El nombre del trabajo y el `*` si hay cambios sin guardar se ve en TopBar.
- [ ] Atajos Ctrl+S, Ctrl+Shift+S, Ctrl+O funcionan.
- [ ] No rompe ningún flujo existente (cargar plantilla, asignar imágenes, exportar, cortar, sync).

### Riesgos / preguntas abiertas Fase A

- **Tamaño en disco**: jobs con 30 fotos de 3 MB = 90 MB por job. ¿Aceptable? Sí, por ahora. Mostrar advertencia si total > 500 MB en algún momento.
- **Thumbnails**: agregan complejidad. Si genera fricción, omitir en MVP — usar nombre + fecha solamente.

---

## Fase B — Tab bar visual + estado per-tab (en memoria)

**Goal**: tener múltiples documentos abiertos en simultáneo, switcheables vía tabs en la parte superior del workspace.

### Archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/components/TabsBar.jsx` | Crear | UI del tab bar |
| `src/hooks/useTabs.js` | Crear | State manager de tabs (Map<tabId, fullState>) |
| `src/App.jsx` | Refactor grande | Reemplazar single-state por tabs system |
| `src/hooks/useLayoutEditor.js` | Modificar | Aceptar `tabId` en vez de derivar de templateId. NO romper API existente todavía — agregar layer encima |

### Modelo de tab

```js
{
  id: "tab_xxxxx",
  name: "Sin título 1",  // o nombre del job si está guardado
  jobId: null | "job_xxx",  // si fue guardado
  isDirty: false,
  // estado del editor:
  template: object | null,
  images: [],
  assignmentsFront: [],
  assignmentsBack: [],
  minPages: 1,
  selectedCell: null,
  viewingFace: 'front',
  currentPage: 0,
  // undo/redo:
  history: [],
  historyIndex: -1,
}
```

### Tareas

- [ ] **B1**: Crear `useTabs.js`. State: `tabs: Map<tabId, TabState>`, `activeTabId: string`. Operaciones: `createTab(initialState)`, `closeTab(id, { confirmDirty })`, `switchTab(id)`, `updateActiveTab(updates)`, `getActiveTab()`. Tabs map en useRef para evitar re-renders innecesarios; activeTabId en useState.

- [ ] **B2**: Refactor App.jsx para usar useTabs en vez de useLayoutEditor directo. La active tab es la "single source of truth" para todo lo que hoy es el editor.
  - **MUY GRANDE**: hay que mover image handlers, drag handlers, exportar, imprimir, cortar — todos consumen `layout.xxx`. Reemplazar con `activeTab.xxx`.
  - Estrategia: crear un wrapper `useActiveTabLayout()` que devuelve el mismo shape que useLayoutEditor pero operando sobre la active tab. Así los call sites cambian poco.

- [ ] **B3**: Crear `TabsBar.jsx`. Renderiza tabs horizontales arriba del workspace. Cada tab:
  - Nombre (truncado si largo)
  - Asterisco si dirty
  - X para cerrar (con confirmación si dirty)
  - Click para activar
  - Doble-click para renombrar inline
  - Tab activo: borde diferente, fondo más claro

- [ ] **B4**: Agregar TabsBar a App.jsx entre TopBar y el workspace.

- [ ] **B5**: Botón "+" al final del tab bar. En Fase B: crea tab vacío (sin template), nombre "Sin título N" donde N = max(N) + 1 entre tabs existentes con default name.

- [ ] **B6**: Modificar el click en TemplatesSidebar: en vez de `setSelectedId(id)`, hace `useTabs.createTab({ template: tpl, name: 'Sin título N' })` O reemplaza el template del tab activo si está vacío. Decidir comportamiento exacto en B7.

- [ ] **B7**: Comportamiento de "crear cosas" en tabs:
  - Click en plantilla guardada → si tab activo está vacío (sin template), úsalo. Sino, nueva tab.
  - +Grilla / +Auto / +Cantidad / +PDF → siempre nueva tab.
  - Abrir trabajo → nueva tab con el estado del job. Setear `jobId` y `name`.
  - Guardar trabajo desde tab → setea `jobId` y `name` del tab.

- [ ] **B8**: Cerrar tab con `isDirty=true`: ConfirmModal con opciones "Guardar", "Descartar", "Cancelar".

- [ ] **B9**: Atajo Ctrl+W cierra tab activo, Ctrl+T nueva tab, Ctrl+Tab siguiente, Ctrl+Shift+Tab anterior.

- [ ] **B10**: Smoke test:
  - Abrir 3 tabs con plantillas diferentes.
  - Cargar imágenes distintas en cada una.
  - Switchear entre ellas → estado debe persistir.
  - Cerrar una con cambios → modal de confirmación.
  - Atajos de teclado.

### Acceptance criteria Fase B

- [ ] Múltiples tabs abiertos simultáneamente.
- [ ] Cada tab tiene su propio template, imágenes, asignaciones, undo/redo.
- [ ] Switchear tabs no pierde estado.
- [ ] Tabs nuevas se llaman "Sin título N".
- [ ] Cerrar tab con cambios pide confirmación.
- [ ] Atajos Ctrl+T, Ctrl+W, Ctrl+Tab funcionan.
- [ ] Lo de Fase A (guardar/abrir trabajos) sigue funcionando, pero ahora opera sobre el tab activo.

### Riesgos / preguntas abiertas Fase B

- **El refactor de App.jsx es grande**. Riesgo de romper flujos existentes (drag, paste, export, etc.). Mitigation: hacer en feature branch, smoke test exhaustivo antes de mergear.
- **useLayoutEditor compat**: si rompemos su API, hay que tocar todos los call sites. Mantener API actual + agregar layer (B2).
- **Performance**: con N tabs, ¿es viable mantener todas en memoria? Cada tab con 30 imágenes = ~100 MB. Con 5 tabs = 500 MB. Aceptable hasta ~10 tabs. Si pasa de eso, advertir al usuario.

---

## Fase C — Modal "Nuevo trabajo" con todas las opciones

**Goal**: el botón "+" del tab bar abre un modal que centraliza todas las formas de empezar un trabajo nuevo.

### Tareas

- [ ] **C1**: Crear `NewTabModal.jsx`. Botones grandes con iconos:
  - "📄 Plantilla existente" → submodal con lista de plantillas (reutilizar logica de TemplatesSidebar items, pero solo selección).
  - "📐 Grilla rápida" → cierra y abre GridUploadModal.
  - "🎯 Acomodar por tamaño (Auto)" → cierra y abre flujo +Auto (file picker → ImagePackModal).
  - "🔢 Acomodar por cantidad" → cierra y abre flujo +Cantidad.
  - "📥 Subir PDF de plantilla" → cierra y abre PdfUploadModal.
  - "📂 Abrir trabajo guardado" → cierra y abre JobsListModal.

- [ ] **C2**: Cambiar el "+" del tab bar para abrir NewTabModal en vez de crear tab vacío.

- [ ] **C3**: Agregar atajo Ctrl+T (override del de Fase B) para abrir NewTabModal.

### Acceptance criteria Fase C

- [ ] El "+" abre un modal con 6 opciones claras.
- [ ] Cada opción crea un tab nuevo con el setup correcto.
- [ ] Ctrl+T abre el modal.

---

## Fase D — Esconder TemplatesSidebar + "Manage plantillas" en TopBar

**Goal**: completar el look Corel — sidebar de plantillas desaparece del layout principal, management de plantillas vive en su propio modal.

### Tareas

- [ ] **D1**: Crear `TemplatesManagerModal.jsx`. Layout similar a TemplatesSidebar actual pero como modal:
  - Lista de plantillas agrupadas por carpeta.
  - Acciones: editar nombre, editar categoría, eliminar, compartir, sincronizar.
  - Botón "Subir PDF" para crear plantilla nueva.
  - NO selecciona plantillas para el workspace (eso es el flujo de NewTabModal).

- [ ] **D2**: Botón "Plantillas" en TopBar abre TemplatesManagerModal.

- [ ] **D3**: Quitar `<TemplatesSidebar />` del layout principal. El workspace ahora ocupa todo el ancho excepto la PropertiesSidebar derecha.

- [ ] **D4**: NewTabModal opción "Plantilla existente" puede reabrir el TemplatesManagerModal en "modo seleccionar" (cards clickeables que crean tab y cierran modal).

### Acceptance criteria Fase D

- [ ] Sidebar izquierdo eliminado.
- [ ] Management de plantillas accesible desde TopBar.
- [ ] Crear tab desde plantilla existente sigue funcionando vía NewTabModal.

---

## Fase E — Auto-save tabs + restore on startup

**Goal**: cerrar la app no pierde tabs sin guardar.

### Tareas

- [ ] **E1**: Crear `electron/open-tabs-store.cjs`. Guarda lista de tabs abiertos: array de `{ id, name, jobId | null, snapshotState? }`. Tabs sin jobId guardan snapshotState completo (como un job sin nombre). Tabs con jobId solo guardan el id (al restaurar, cargan del jobs store).

- [ ] **E2**: IPC handlers + preload.

- [ ] **E3**: En useTabs, agregar effect debounced que persiste el estado completo a disco en cada cambio. Igual que el debounce de work-states (800ms).

- [ ] **E4**: En App.jsx, al mount inicial: cargar lista de tabs persistidos → crear tabs en memoria con sus estados.

- [ ] **E5**: Borrar persistencia de tab cuando se cierra explícitamente.

- [ ] **E6**: Warning al cerrar la app si hay tabs con `isDirty=true` y sin `jobId` (vía Electron `before-quit` event en main.cjs).

### Acceptance criteria Fase E

- [ ] Abro 3 tabs con trabajo. Cierro la app. Reabrir → los 3 tabs están como los dejé.
- [ ] Si crashea la app, no se pierde más de 800ms de trabajo.

---

## Fase F — Polish

### Tareas

- [ ] **F1**: Right-click menu en tab: Renombrar / Duplicar / Guardar como / Cerrar / Cerrar otros / Cerrar todo.

- [ ] **F2**: Drag tabs para reordenar (HTML5 drag-and-drop, no dnd-kit para no chocar con drag de imágenes).

- [ ] **F3**: Atajos Ctrl+1 a Ctrl+9 = ir al tab N.

- [ ] **F4**: Indicador visual mejor de "sin guardar" (asterisco a la izquierda del nombre, color sutil).

- [ ] **F5**: Si la lista de tabs no entra, scroll horizontal o ▸◂ navegación.

- [ ] **F6**: Tooltip en tab con nombre completo si está truncado.

---

## Notas para futuras sesiones

- **Memory**: actualizar `project_printlayout.md` cuando termine Fase B (cambia drásticamente cómo se conceptualiza la app).
- **Releases**: cada fase puede ser un release menor (0.1.24, 0.1.25, ...). Solo subir si el usuario validó que no rompe nada.
- **Decisión pendiente**: ¿qué pasa con el per-template auto-save (work-states) cuando llegue Fase E? Probable: removerlo, las tabs cubren su rol. Decidir al llegar.
- **Git workflow**: cada fase = su propio commit grande. Si se rompe algo, revertir esa fase es atómico.
