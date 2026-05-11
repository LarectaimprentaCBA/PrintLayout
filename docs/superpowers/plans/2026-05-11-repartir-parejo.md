# Repartir parejo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un botón "Repartir parejo" en el TopBar que distribuye las imágenes cargadas equitativamente entre las celdas de la página actual, con confirmación cuando hay celdas ya ocupadas.

**Architecture:** Función pura nueva en `src/lib/grid.js` (testeable a ojo), acción en `useLayoutEditor.js` que la consume, modal genérico de confirmación con N opciones, botón en TopBar. Sin tests automatizados (no hay framework en el proyecto) — validación manual.

**Tech Stack:** React 18, Tailwind, JavaScript puro. Patrón existente: hook `useLayoutEditor` mantiene `assignments`, mutaciones vía `applyMutation`. Página activa la pasa `App.jsx` (estado `currentPage`).

**Spec:** `docs/superpowers/specs/2026-05-11-repartir-parejo-design.md`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/grid.js` | Modificar | Función pura `distributeEvenly` (algoritmo) |
| `src/hooks/useLayoutEditor.js` | Modificar | Acción `distributeImagesEvenly(mode, pageIdx)` |
| `src/components/ConfirmModal.jsx` | Crear | Modal genérico con N acciones (reutilizable) |
| `src/components/TopBar.jsx` | Modificar | Botón "Repartir parejo" + manejo del modal |
| `src/App.jsx` | Modificar | Wirear el botón con el hook |

---

## Task 1: Función pura `distributeEvenly` en `grid.js`

**Files:**
- Modify: `src/lib/grid.js` (agregar al final del archivo, antes de `PAPER_PRESETS`)

- [ ] **Step 1: Agregar la función pura**

Agregar al final de `src/lib/grid.js`, **antes** de la línea `export const PAPER_PRESETS = [`:

```js
// Reparte una lista de imageIds entre celdas objetivo de forma equitativa.
// - targetCellIndices: array<number> con los indices de celdas a llenar (orden ascendente).
// - imageIds: array<string> con los IDs de imagen en orden de carga.
//
// Algoritmo: cada imagen sale floor(N/K) veces; las primeras (N%K) imagenes
// salen una vez mas. Orden agrupado: A A A B B B C C C.
// Si imageIds.length > targetCellIndices.length, se usan solo las primeras
// targetCellIndices.length imagenes con 1 copia c/u.
//
// Retorna: Map<cellIdx, imageId>.
export function distributeEvenly(targetCellIndices, imageIds) {
  const result = new Map();
  const N = targetCellIndices.length;
  const K = imageIds.length;
  if (N === 0 || K === 0) return result;

  if (K >= N) {
    for (let i = 0; i < N; i++) {
      result.set(targetCellIndices[i], imageIds[i]);
    }
    return result;
  }

  const base = Math.floor(N / K);
  const extras = N % K;
  let cellPos = 0;
  for (let imgIdx = 0; imgIdx < K; imgIdx++) {
    const copies = imgIdx < extras ? base + 1 : base;
    for (let c = 0; c < copies; c++) {
      result.set(targetCellIndices[cellPos], imageIds[imgIdx]);
      cellPos += 1;
    }
  }
  return result;
}
```

- [ ] **Step 2: Validar a ojo con la consola del browser**

Levantar `npm run dev`. En DevTools (Ctrl+Shift+I), pegar:

```js
// Importar via dynamic import del bundle:
const { distributeEvenly } = await import('/src/lib/grid.js');

// Caso 12/3 → A×4 B×4 C×4
console.log([...distributeEvenly([0,1,2,3,4,5,6,7,8,9,10,11], ['A','B','C']).entries()]);
// Esperado: [[0,'A'],[1,'A'],[2,'A'],[3,'A'],[4,'B'],[5,'B'],[6,'B'],[7,'B'],[8,'C'],[9,'C'],[10,'C'],[11,'C']]

// Caso 12/5 → A×3 B×3 C×2 D×2 E×2
console.log([...distributeEvenly([0,1,2,3,4,5,6,7,8,9,10,11], ['A','B','C','D','E']).entries()]);
// Esperado: A×3, B×3, C×2, D×2, E×2

// Caso 12/7 → A×2 B×2 C×2 D×2 E×2 F×1 G×1
console.log([...distributeEvenly([0,1,2,3,4,5,6,7,8,9,10,11], ['A','B','C','D','E','F','G']).entries()]);
// Esperado: A×2, B×2, C×2, D×2, E×2, F×1, G×1

// Caso K > N: 3 celdas, 5 imagenes → solo A B C
console.log([...distributeEvenly([0,1,2], ['A','B','C','D','E']).entries()]);
// Esperado: [[0,'A'],[1,'B'],[2,'C']]

// Caso vacio: N=0
console.log([...distributeEvenly([], ['A','B']).entries()]); // []
// Caso vacio: K=0
console.log([...distributeEvenly([0,1,2], []).entries()]); // []

// Caso celdas no contiguas: indices [0,2,5,7] con 2 imagenes
console.log([...distributeEvenly([0,2,5,7], ['A','B']).entries()]);
// Esperado: [[0,'A'],[2,'A'],[5,'B'],[7,'B']]
```

Si algún caso no da lo esperado, revisar el algoritmo antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add src/lib/grid.js
git commit -m "Agregar funcion pura distributeEvenly para reparto equitativo en grilla"
```

---

## Task 2: Acción `distributeImagesEvenly` en `useLayoutEditor`

**Files:**
- Modify: `src/hooks/useLayoutEditor.js` (importar `distributeEvenly` y agregar acción nueva antes de `clearCell`, exportarla en el return)

- [ ] **Step 1: Importar `distributeEvenly`**

En la línea 2 de `src/hooks/useLayoutEditor.js`, después del import existente:

```js
import { useCallback, useEffect, useMemo, useState } from 'react';
import { totalCells } from '../lib/templates.js';
import { distributeEvenly } from '../lib/grid.js';
```

- [ ] **Step 2: Agregar la acción nueva**

Insertar en `src/hooks/useLayoutEditor.js`, **antes** de la línea `const clearCell = useCallback(` (~línea 156), este bloque:

```js
  // Reparte equitativamente las imagenes cargadas entre las celdas de la pagina
  // indicada (default: primera). Modos:
  //   'fill-empty'  -> solo asigna en celdas vacias de la pagina (preserva las ocupadas).
  //   'replace-all' -> sobreescribe todas las celdas de la pagina con el reparto.
  // pageIdx fuera de rango: no hace nada.
  const distributeImagesEvenly = useCallback(
    (mode = 'fill-empty', pageIdx = 0) => {
      if (cellsPerPage === 0 || images.length === 0) return;
      const start = pageIdx * cellsPerPage;
      const end = start + cellsPerPage;
      if (start >= assignments.length) return;

      const range = [];
      for (let i = start; i < end; i++) range.push(i);
      const targetIndices =
        mode === 'replace-all'
          ? range
          : range.filter((i) => assignments[i] === null);
      if (targetIndices.length === 0) return;

      const imageIds = images.map((img) => img.id);
      const placement = distributeEvenly(targetIndices, imageIds);

      applyMutation((arr) => {
        for (const [cellIdx, imageId] of placement.entries()) {
          arr[cellIdx] = imageId;
        }
        return arr;
      });
    },
    [cellsPerPage, images, assignments, applyMutation],
  );
```

- [ ] **Step 3: Exportar la nueva acción**

En el objeto retornado al final del hook (~línea 205), agregar `distributeImagesEvenly` después de `fillAllWith`:

```js
  return {
    images,
    imageMap,
    assignments,
    assignmentsFront,
    assignmentsBack,
    selectedCell,
    setSelectedCell,
    cellsPerPage,
    pageCount,
    addImages,
    addImageToCell,
    assignImageToCell,
    fillAllWith,
    distributeImagesEvenly,
    swapCells,
    clearCell,
    removeImage,
    updateImage,
    clearAll,
  };
```

- [ ] **Step 4: Probar a ojo desde la consola**

`npm run dev` corriendo. En DevTools, cargar una grilla rápida 3×4 (12 celdas) desde la UI, cargar 3 imágenes via "Agregar imágenes" en la sidebar. Inspeccionar el estado a través de React DevTools no es trivial, así que validamos via UI: el botón final se prueba en Task 5. Si por curiosidad querés verificar ahora: las imágenes cargadas con `addImages` deberían quedar en las primeras 3 celdas; el resto vacías. Si todo va bien, seguir.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLayoutEditor.js
git commit -m "useLayoutEditor: accion distributeImagesEvenly"
```

---

## Task 3: Crear `ConfirmModal` reutilizable

**Files:**
- Create: `src/components/ConfirmModal.jsx`

- [ ] **Step 1: Escribir el componente**

Crear el archivo `src/components/ConfirmModal.jsx` con este contenido:

```jsx
// Modal de confirmacion genérico con N acciones. No es un input — solo botones.
// Props:
//   - open: boolean
//   - title: string
//   - message?: string (descripcion debajo del titulo)
//   - actions: Array<{ label: string, value: any, variant?: 'primary' | 'default' | 'danger' }>
//   - onAction: (value) => void (se llama al click de cualquier accion)
//   - onCancel: () => void (se llama al click en backdrop o Escape)
//   - cancelLabel?: string (default 'Cancelar'; agrega boton extra al inicio)
//
// Convención: el último botón de actions es el confirmativo (variant 'primary'),
// pero no es obligatorio — el caller arma las acciones como quiera.
import { useEffect } from 'react';

const VARIANT_CLASSES = {
  primary: 'bg-accent-600 text-white hover:bg-accent-500',
  default: 'border border-ink-700 text-ink-100 hover:bg-ink-800',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

export default function ConfirmModal({
  open,
  title,
  message,
  actions = [],
  cancelLabel = 'Cancelar',
  onAction,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="w-96 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
        {message && <p className="mt-1 text-xs text-ink-400">{message}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {cancelLabel && (
            <button
              type="button"
              onClick={() => onCancel?.()}
              className="rounded border border-ink-700 px-3 py-1 text-xs text-ink-200 hover:bg-ink-800"
            >
              {cancelLabel}
            </button>
          )}
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAction?.(a.value)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                VARIANT_CLASSES[a.variant] ?? VARIANT_CLASSES.default
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ConfirmModal.jsx
git commit -m "Agregar ConfirmModal reutilizable con N acciones"
```

---

## Task 4: Botón "Repartir parejo" en `TopBar`

**Files:**
- Modify: `src/components/TopBar.jsx`

El botón llama un callback `onDistributeEvenly(mode)` que recibe `'fill-empty'` o `'replace-all'`. El TopBar maneja internamente el modal de confirmación según `hasOccupiedCells` (prop nueva que viene de App.jsx).

- [ ] **Step 1: Agregar import de `ConfirmModal` y `useState` (ya importado)**

En `src/components/TopBar.jsx`, en la línea 1, asegurar que `useState` esté importado (ya lo está). Agregar el import del modal:

```jsx
import { useEffect, useRef, useState } from 'react';
import ConfirmModal from './ConfirmModal.jsx';
```

- [ ] **Step 2: Agregar props nuevas a la firma del `TopBar`**

Modificar la firma del componente `TopBar` (línea ~197) para aceptar 3 props nuevas:

```jsx
export default function TopBar({
  canExport,
  canCut,
  doubleSided,
  viewingFace,
  onChangeFace,
  exporting,
  printing,
  cutting,
  onExport,
  onPrintFront,
  onPrintBack,
  onCut,
  layoutFitMode,
  onLayoutFitChange,
  showCuts,
  onShowCutsChange,
  template,
  customPaper,
  onCustomPaperChange,
  bladeOffsetMm,
  onBladeOffsetChange,
  // ↓ nuevas
  cellsPerPage,
  imagesLoaded,
  hasOccupiedCells,
  onDistributeEvenly,
}) {
```

- [ ] **Step 3: Estado local del modal y manejadores**

Agregar al inicio del componente, justo después de la línea `const pdfBusy = exporting || printing;`:

```jsx
  const [distributeModalOpen, setDistributeModalOpen] = useState(false);

  const canDistribute =
    typeof onDistributeEvenly === 'function' &&
    (cellsPerPage ?? 0) >= 2 &&
    imagesLoaded > 0;

  const handleDistributeClick = () => {
    if (!canDistribute) return;
    if (hasOccupiedCells) {
      setDistributeModalOpen(true);
    } else {
      onDistributeEvenly('fill-empty');
    }
  };

  const handleDistributeAction = (mode) => {
    setDistributeModalOpen(false);
    onDistributeEvenly(mode);
  };
```

- [ ] **Step 4: Agregar el botón al render**

Insertar el botón **antes** del bloque "Imprimir" (la línea ~316 `{doubleSided ? (`). El botón va dentro del mismo `<div className="flex items-center gap-3">`. Pegar justo antes del primer bloque de impresión:

```jsx
        {(cellsPerPage ?? 0) >= 2 && (
          <button
            type="button"
            onClick={handleDistributeClick}
            disabled={!canDistribute}
            title={
              imagesLoaded === 0
                ? 'Cargá imágenes primero'
                : 'Repartir las imágenes cargadas en las celdas de esta hoja'
            }
            className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm font-medium text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            Repartir parejo
          </button>
        )}
```

- [ ] **Step 5: Montar el modal al final del `<header>`**

Justo antes del `</header>` de cierre (línea ~364), insertar:

```jsx
        <ConfirmModal
          open={distributeModalOpen}
          title="Ya hay celdas ocupadas en esta hoja"
          message="¿Querés llenar solo las celdas vacías o reemplazar todas las celdas con un reparto nuevo?"
          actions={[
            { label: 'Solo llenar vacías', value: 'fill-empty', variant: 'default' },
            { label: 'Reemplazar todo', value: 'replace-all', variant: 'primary' },
          ]}
          onAction={handleDistributeAction}
          onCancel={() => setDistributeModalOpen(false)}
        />
```

- [ ] **Step 6: Commit**

```bash
git add src/components/TopBar.jsx
git commit -m "TopBar: boton Repartir parejo con confirmacion"
```

---

## Task 5: Wirear el botón en `App.jsx`

**Files:**
- Modify: `src/App.jsx` (~línea 659, donde se monta `<TopBar ... />`)

- [ ] **Step 1: Calcular `hasOccupiedCells` de la página actual**

Inmediatamente antes del JSX de `<TopBar ...>` (línea ~659), agregar el cálculo. Buscar el bloque donde está `<TopBar` y agregar **justo antes** una expresión. Si no hay un lugar natural, calcularlo inline en la prop. Usar este enfoque inline en el JSX:

Insertar el cálculo cerca de los demás derivados (después de la sección de `useEffect`s, antes del `return`). Una forma simple: agregar este `useMemo` después de la declaración de `currentPage` (~línea 125-126), o más cerca del `return`. Ubicación sugerida: justo antes del `return` final (buscar `return (` del componente). Si no es fácil de localizar, ponerlo inline:

En la prop `hasOccupiedCells` del `<TopBar>`, pasar:

```jsx
hasOccupiedCells={(() => {
  const cpp = layout.cellsPerPage;
  if (!cpp) return false;
  const start = currentPage * cpp;
  const end = start + cpp;
  return layout.assignments.slice(start, end).some((id) => id !== null);
})()}
```

(Inline IIFE: feo pero localiza el cálculo y evita un useMemo nuevo en un archivo grande.)

- [ ] **Step 2: Agregar las props nuevas al `<TopBar>`**

En el JSX donde se monta `<TopBar ... />` (~línea 659), agregar las 4 props nuevas al final, justo antes del `/>`:

```jsx
        <TopBar
          canExport={!!selected}
          canCut={!!selected && hasCuts(selected)}
          doubleSided={!!selected?.doubleSided}
          viewingFace={viewingFace}
          onChangeFace={(f) => {
            setViewingFace(f);
            layout.setSelectedCell(null);
          }}
          exporting={exporting}
          printing={printing}
          cutting={cutting}
          onExport={handleExport}
          onPrintFront={() => handlePrint('front')}
          onPrintBack={() => handlePrint('back')}
          onCut={handleCut}
          layoutFitMode={layoutFitMode}
          onLayoutFitChange={selected ? setLayoutFitMode : undefined}
          showCuts={showCuts}
          onShowCutsChange={hasCuts(selected) ? setShowCuts : undefined}
          template={selected}
          customPaper={customPaper}
          onCustomPaperChange={selected ? setCustomPaper : undefined}
          bladeOffsetMm={bladeOffsetMm}
          onBladeOffsetChange={setBladeOffsetMm}
          cellsPerPage={layout.cellsPerPage}
          imagesLoaded={layout.images.length}
          hasOccupiedCells={(() => {
            const cpp = layout.cellsPerPage;
            if (!cpp) return false;
            const start = currentPage * cpp;
            const end = start + cpp;
            return layout.assignments.slice(start, end).some((id) => id !== null);
          })()}
          onDistributeEvenly={(mode) =>
            layout.distributeImagesEvenly(mode, currentPage)
          }
        />
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "App: wirear boton Repartir parejo con useLayoutEditor"
```

---

## Task 6: Validación manual end-to-end

**Files:** ninguno (solo testing manual)

- [ ] **Step 1: Build check**

```bash
npm run build:vite
```

Esperado: el build termina sin errores. Si falla por sintaxis, leer el error y corregir el archivo correspondiente.

- [ ] **Step 2: Levantar dev y probar cada caso**

```bash
npm run dev
```

Casos a verificar (en este orden):

**Caso 1 — Grilla 12 celdas, 3 imágenes, todas vacías:**
1. Click "+ Grilla" en la sidebar.
2. En el modal: A4, celda 70×70, sin márgenes, sin spacing (esto deja una grilla 3×4 = 12 celdas).
3. "Crear grilla".
4. Cargar 3 imágenes via sidebar.
5. Click "Repartir parejo" en TopBar.
6. **Esperado:** las primeras 4 celdas tienen la imagen 1, las siguientes 4 la imagen 2, las últimas 4 la imagen 3. Sin modal de confirmación (no había celdas ocupadas).

**Caso 2 — Mismo escenario, 5 imágenes:**
1. Click "Clear all" para vaciar.
2. Cargar 5 imágenes.
3. Click "Repartir parejo".
4. **Esperado:** A×3 B×3 C×2 D×2 E×2 (12 celdas).

**Caso 3 — Modal con celdas ocupadas:**
1. Estado del caso 2.
2. Click "Repartir parejo" otra vez.
3. **Esperado:** se abre el ConfirmModal con "Solo llenar vacías" / "Reemplazar todo" / "Cancelar".
4. Click "Cancelar" → no debe pasar nada.
5. Click "Solo llenar vacías" → como ya no hay vacías, no cambia nada (toast/silencio aceptable).
6. Click "Reemplazar todo" → reparto se rehace igual que antes.

**Caso 4 — Solo llenar vacías con huecos:**
1. Clear all.
2. Cargar 3 imágenes (van a las celdas 0,1,2 según `addImages` actual).
3. Click "Repartir parejo" → confirma "Solo llenar vacías".
4. **Esperado:** las celdas 0,1,2 quedan intactas; las celdas 3-11 se llenan con A×3 B×3 C×3 (9 celdas vacías repartidas entre 3 imgs).

**Caso 5 — Botón deshabilitado sin imágenes:**
1. Clear all.
2. Sin cargar nada.
3. **Esperado:** el botón "Repartir parejo" se ve gris (disabled). Tooltip: "Cargá imágenes primero".

**Caso 6 — Plantilla Polaroid 8x5 (doble faz):**
1. Seleccionar plantilla "Polaroid 8x5" (40 celdas, doble faz).
2. Cargar 4 imágenes.
3. Click "Repartir parejo" (estamos en frente).
4. **Esperado:** las 40 celdas del frente quedan A×10 B×10 C×10 D×10.
5. Cambiar a "Dorso" → todas las celdas del dorso vacías (no se tocaron).

**Caso 7 — Plantilla 1 celda:**
1. Si existe alguna plantilla con `cellsPerPage === 1`, abrirla.
2. **Esperado:** el botón "Repartir parejo" NO se muestra (porque la condición es `cellsPerPage >= 2`).

**Caso 8 — Más imágenes que celdas (caso K>N):**
1. Crear grilla pequeña (ej. celda 100×100 en A4 vertical → 2×2 = 4 celdas).
2. Cargar 6 imágenes.
3. Click "Repartir parejo".
4. **Esperado:** las 4 celdas se llenan con las primeras 4 imágenes (una c/u). Las 2 últimas quedan cargadas en la sidebar pero sin asignar.

- [ ] **Step 3: Si algún caso falla**

Identificar el caso, abrir DevTools (Ctrl+Shift+I), reproducir, leer el error o inspeccionar `layout.assignments` desde React DevTools. Volver al task correspondiente y arreglar. Commitear el fix con un mensaje descriptivo.

- [ ] **Step 4: Si todo pasa, marcar como verificado**

No requiere commit — pasamos a Task 7.

---

## Task 7: Bump de versión y release

**Files:**
- Modify: `package.json`
- Modify: `C:\Users\4\.claude\projects\C--Users-4\memory\project_printlayout.md` (actualizar la sección "Versiones publicadas")

- [ ] **Step 1: Bump de versión**

Editar `package.json`, cambiar `"version": "0.1.10"` por `"version": "0.1.11"`.

- [ ] **Step 2: Commit del bump**

```bash
git add package.json
git commit -m "v0.1.11: boton Repartir parejo para autorrelleno equitativo de celdas"
```

- [ ] **Step 3: Release**

Recordá que el usuario prefiere batchear releases — si en esta sesión vinieron más cambios, esperar a tener todos antes de correr esto. Si esto es el único cambio:

```powershell
$env:GH_TOKEN = '<token PrintLayout repo>'
$env:PRINTLAYOUT_TEMPLATES_TOKEN = '<token PrintLayout-templates repo>'
$env:NODE_OPTIONS = '--use-system-ca'
npm run release
```

**Importante:** el usuario tiene los tokens. NO inventar valores. Si no están en env, preguntar al usuario antes de correr.

Después: ir a GitHub → release draft v0.1.11 → click "Publish release".

- [ ] **Step 4: Actualizar memoria**

Editar `C:\Users\4\.claude\projects\C--Users-4\memory\project_printlayout.md`, sección "Versiones publicadas". Agregar al final de la lista:

```
- **v0.1.11** (2026-05-11): boton "Repartir parejo" en TopBar. Reparte equitativamente las imagenes cargadas entre las celdas de la pagina actual. Cuando no es division exacta, las primeras imagenes salen una vez mas (deterministico, sin azar). Si hay celdas ocupadas, confirma "Solo llenar vacias" o "Reemplazar todo". Funcion pura en src/lib/grid.js, accion en useLayoutEditor, ConfirmModal nuevo reutilizable.
```

(El archivo de memoria está en otro directorio — el editor abrirá el path absoluto; no requiere git.)

- [ ] **Step 5: Push final**

```bash
git push
```

---

## Notas de implementación

- **Sin tests automatizados:** decidido con el usuario; el proyecto no tiene framework de tests y agregar uno está fuera de scope. Validación manual cubre el camino feliz y los casos borde principales.
- **Cara activa (front/back):** la acción `distributeImagesEvenly` opera sobre `assignments` (que ya es la cara activa según el hook). No hay que hacer nada especial.
- **No tocar plantillas persistidas:** todo el cambio vive en estado React (assignments). Las plantillas en disco y en el repo de sync no cambian.
- **Tokens:** el usuario tiene los tokens guardados; no están en este repo.
