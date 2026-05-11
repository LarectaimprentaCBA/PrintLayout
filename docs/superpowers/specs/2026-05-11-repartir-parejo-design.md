# Repartir parejo — autorrelleno de celdas

**Fecha:** 2026-05-11
**Estado:** Aprobado por usuario, pendiente de implementación
**Versión objetivo:** v0.1.11

## Resumen

Agregar una acción "Repartir parejo" que, dada una plantilla con grilla de celdas y un conjunto de imágenes cargadas, distribuya las imágenes equitativamente entre las celdas, repitiendo cada imagen tantas veces como haga falta para llenar todas las celdas. Cuando el reparto no es exacto, las primeras imágenes del set llevan una copia extra (distribución determinística, sin azar).

## Motivación

Hoy `addImages` asigna cada imagen a una sola celda en orden. Si el usuario carga 3 imágenes en una grilla de 12 celdas, quedan 9 celdas vacías. El caso de uso real (imprimir múltiples copias del mismo diseño en una hoja para corte) requiere repetir las imágenes manualmente, una por una. La función automatiza ese reparto.

## Alcance

**Incluye:**

- Cualquier plantilla con `cellsPerPage >= 2` (grilla rápida, Polaroid 8×5, tarjetas, etc.).
- Operación sobre la página y cara activa (la visible en el canvas).
- Dos modos cuando hay celdas ya ocupadas: "solo vacías" o "reemplazar todo".

**Excluye (no entra en esta versión):**

- Aleatoriedad / orden random — la distribución es determinística y reproducible.
- Reparto entre múltiples páginas o entre ambas caras simultáneamente.
- Elegir qué imágenes reciben la copia extra cuando hay remanente (siempre son las primeras del set, en orden de carga).

## Algoritmo

Dado:

- `N` = cantidad de celdas a llenar (vacías o totales según el modo).
- `K` = cantidad de imágenes cargadas en `images` (`K >= 1`).

Cálculo:

- `base = Math.floor(N / K)` — copias mínimas de cada imagen.
- `extras = N % K` — cantidad de imágenes que llevan una copia adicional.
- Las primeras `extras` imágenes (orden de carga) salen `base + 1` veces; las restantes `K - extras` salen `base` veces.

Orden de asignación: **agrupado por imagen**. Recorriendo los índices de celdas a llenar en orden ascendente, se asigna primero todas las copias de la imagen 1, después todas las de la imagen 2, etc.

### Ejemplos

| Celdas (N) | Imágenes (K) | Resultado                                           |
|------------|--------------|-----------------------------------------------------|
| 12         | 3            | A×4 B×4 C×4                                         |
| 12         | 5            | A×3 B×3 C×2 D×2 E×2                                 |
| 12         | 7            | A×2 B×2 C×2 D×2 E×2 F×1 G×1                         |
| 6          | 6            | A B C D E F (1 c/u)                                 |

### Casos borde

- `K === 0` (sin imágenes cargadas): el botón está deshabilitado, no se invoca el algoritmo.
- `N === 0` (modo "solo vacías" y todas las celdas ocupadas): toast informativo "No hay celdas vacías para rellenar".
- `K > N` (más imágenes que celdas): solo se usan las primeras `N` imágenes con 1 copia cada una. Las imágenes sobrantes quedan cargadas pero sin asignar; el usuario las puede usar manualmente.
- Celdas vacías no contiguas (ej. el usuario asignó manualmente 3 celdas intercaladas): el orden agrupado se aplica sobre los índices de celdas vacías en orden ascendente, independientemente de su ubicación física.

## UI

### Botón

- Ubicación: `TopBar`, al lado de los controles existentes (cerca de "Cortar" / "Cuchilla").
- Etiqueta: **"Repartir parejo"**.
- Visibilidad: solo cuando `cellsPerPage >= 2`.
- Estado deshabilitado: cuando `images.length === 0`. Tooltip: "Cargá imágenes primero".

### Flujo al clickear

```
¿Hay celdas ocupadas en la página/cara activa?
├─ No → ejecutar reparto directo (modo 'fill-empty')
└─ Sí → abrir PromptModal con 3 opciones:
        • "Solo llenar vacías"   → modo 'fill-empty'
        • "Reemplazar todo"      → modo 'replace-all'
        • "Cancelar"             → no hacer nada
```

El `PromptModal` ya existe y se reutiliza (ver `src/components/PromptModal.jsx`). Si la API actual no soporta tres botones, se extiende en esta tarea.

## Implementación

### `src/lib/grid.js` — función pura nueva

```js
export function distributeEvenly(targetCellIndices, imageIds) {
  // targetCellIndices: array<number> con los índices de celdas a llenar
  // imageIds: array<string> con los IDs de imagen en orden de carga
  // Retorna: Map<cellIdx, imageId>
}
```

Características:

- Función pura, sin acceso a React ni al store.
- Testeable de forma aislada con los ejemplos de arriba.
- Si `imageIds.length === 0` o `targetCellIndices.length === 0`, retorna Map vacío.
- Si `imageIds.length > targetCellIndices.length`, usa solo las primeras `targetCellIndices.length` imágenes.

### `src/hooks/useLayoutEditor.js` — acción nueva

```js
const distributeEvenly = useCallback((mode, pageIdx = 0) => {
  // mode: 'fill-empty' | 'replace-all'
  // pageIdx: índice de página sobre la cual operar (default 0)
}, [...]);
```

Lógica:

1. Si `cellsPerPage === 0` o `images.length === 0`: no hacer nada.
2. Calcular el rango de índices `[start, start + cellsPerPage)` con `start = pageIdx * cellsPerPage`. Mismo patrón que `fillAllWith` (línea 136 del hook actual).
3. Según `mode`:
   - `'fill-empty'`: filtrar índices donde `assignments[i] === null`.
   - `'replace-all'`: usar todos los índices del rango.
4. Llamar a la función pura `distributeEvenly(indices, images.map(i => i.id))` de `src/lib/grid.js`.
5. Aplicar el Map resultante vía `applyMutation` (asignar cada celda al ID indicado).

Exportar la acción desde el hook (agregarla al objeto retornado). Nombre tentativo del export: `distributeEvenly` o `distributeImagesEvenly` para no chocar con la función pura del mismo nombre (decidir al implementar).

### `src/components/TopBar.jsx` — botón nuevo

- Botón "Repartir parejo".
- `disabled` cuando `images.length === 0` o `cellsPerPage < 2`.
- Recibe por props la `currentPage` (ya disponible en `App.jsx`) y la acción del hook.
- `onClick`:
  - Calcular si hay celdas ocupadas en el rango `[currentPage * cellsPerPage, ...]`.
  - Si no hay ocupadas → invocar acción con `'fill-empty'` y `currentPage`.
  - Si hay ocupadas → abrir `PromptModal` con las 3 opciones; según la elección invocar la acción con el modo correspondiente o no hacer nada.

### Sin cambios en

- `electron/main.cjs`, `electron/preload.cjs`: la feature es 100% React, no toca el main process.
- Persistencia: la grilla temporal no se persiste; las plantillas guardadas tampoco cambian de schema (los `assignments` ya soportan IDs repetidos).
- Export PDF, impresión, corte en plotter: el flujo downstream ya consume `assignments`, no cambia.

## Pendiente fuera de scope

- **Reparto en plantillas multi-página:** la opción "todas las páginas" del brainstorming se descartó. Si en el futuro se quiere, agregar un parámetro `pageIdx` al hook y un selector en la UI.
- **Toggle de azar:** opcionalmente sumar un checkbox "Mezclar al azar" en una versión futura. La función pura quedaría `distributeEvenly(indices, ids, { shuffle: true })`.
- **Elegir qué imágenes reciben copias extra:** por ejemplo, drag para reordenar el set antes de repartir. No se implementa ahora porque el orden de carga ya es controlable por el usuario.

## Verificación

Cómo validar que funciona después de implementar:

1. `npm run dev`, crear una grilla rápida 3×4 (12 celdas).
2. Cargar 3 imágenes distintas → apretar "Repartir parejo" → cada imagen debe aparecer 4 veces, agrupadas.
3. Cargar 2 imágenes más (total 5) → "Repartir parejo" → confirmar "Reemplazar todo" → las primeras 2 salen 3 veces, las otras 3 salen 2 veces.
4. Borrar la asignación de 2 celdas a mano → "Repartir parejo" → confirmar "Solo llenar vacías" → solo las 2 vacías se llenan con la primera imagen del set, el resto queda intacto.
5. Probar con plantilla Polaroid 8×5 (40 celdas, doble faz) → repartir en frente → verificar que el dorso no se toca.
6. Exportar PDF y abrir → confirmar que el reparto sale correcto en la página impresa.
