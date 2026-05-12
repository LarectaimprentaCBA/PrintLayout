import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  totalCells,
  cellsCountOnPage,
  fixedPageCount,
} from '../lib/templates.js';
import { distributeEvenly } from '../lib/grid.js';

// Soporta plantillas simple-faz (un assignments) y doble-faz (front/back).
// El estado interno SIEMPRE mantiene los dos arrays alineados (misma length);
// para simple-faz, assignmentsBack queda como espejo vacio que no se usa.
//
// Plantillas multi-page (template.pages presente): las celdas son distintas
// por hoja y el numero de hojas es FIJO. assignments tiene length = total
// celdas, sin paginacion automatica al pasarse.
//
// Plantillas legacy (template.celdas): las celdas son las mismas en todas
// las hojas, y las hojas crecen dinamicamente al cargar mas imagenes.
//
// La cara activa la decide quien consume el hook (App.jsx) via `face`.
export function useLayoutEditor(template, face = 'front') {
  const [images, setImages] = useState([]);
  const [assignmentsFront, setAssignmentsFront] = useState([]);
  const [assignmentsBack, setAssignmentsBack] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);

  const isMultiPage = fixedPageCount(template) !== null;
  // cellsPerPage tiene el significado legacy (cantidad por hoja, constante).
  // En multi-page no aplica directamente; usamos cellsCountOnPage(pageIdx).
  // Para legacy, equivale a totalCells.
  const cellsPerPage = isMultiPage ? 0 : (template ? totalCells(template) : 0);
  // total: en multi-page es la suma de celdas en todas las paginas; en legacy
  // es el largo del array que queremos inicializar (= celdas de 1 hoja).
  const totalCellsCount = template ? totalCells(template) : 0;

  useEffect(() => {
    setAssignmentsFront(totalCellsCount > 0 ? Array(totalCellsCount).fill(null) : []);
    setAssignmentsBack(totalCellsCount > 0 ? Array(totalCellsCount).fill(null) : []);
    setSelectedCell(null);
  }, [template?.id, totalCellsCount]);

  const isFront = face !== 'back';
  const assignments = isFront ? assignmentsFront : assignmentsBack;

  const pageCount = isMultiPage
    ? fixedPageCount(template)
    : (cellsPerPage > 0 ? Math.max(1, assignmentsFront.length / cellsPerPage) : 0);

  const imageMap = useMemo(() => {
    const m = new Map();
    for (const img of images) m.set(img.id, img);
    return m;
  }, [images]);

  // Garantiza que ambos arrays tengan la misma longitud. En modo multi-page,
  // la longitud es fija (totalCellsCount); en legacy se redondea a multiplo
  // de cellsPerPage.
  const matchLength = useCallback(
    (front, back, targetLen) => {
      let want;
      if (isMultiPage) {
        want = totalCellsCount;
      } else {
        want = Math.max(targetLen, cellsPerPage);
      }
      const padded = (arr) =>
        arr.length >= want
          ? arr.slice(0, Math.max(arr.length, want)) // multi-page: trunca extra
          : arr.concat(Array(want - arr.length).fill(null));
      return [padded(front), padded(back)];
    },
    [cellsPerPage, isMultiPage, totalCellsCount],
  );

  // Pure helpers que aplican una mutacion al array de la cara activa
  // y devuelven [front, back] compactados al final.
  const applyMutation = useCallback(
    (mutator) => {
      setAssignmentsFront((prevFront) => {
        let nextFront = prevFront;
        let nextBack = assignmentsBack;
        if (isFront) {
          nextFront = mutator([...prevFront]);
          [nextFront, nextBack] = matchLength(nextFront, assignmentsBack, nextFront.length);
        } else {
          nextBack = mutator([...assignmentsBack]);
          [nextFront, nextBack] = matchLength(prevFront, nextBack, nextBack.length);
        }
        // Compact trailing pages solo en modo legacy (las hojas son virtuales).
        // En multi-page la cantidad es fija — no se compacta.
        if (!isMultiPage && cellsPerPage > 0) {
          while (
            nextFront.length > cellsPerPage &&
            nextFront.slice(-cellsPerPage).every((id) => id === null) &&
            nextBack.slice(-cellsPerPage).every((id) => id === null)
          ) {
            nextFront = nextFront.slice(0, nextFront.length - cellsPerPage);
            nextBack = nextBack.slice(0, nextBack.length - cellsPerPage);
          }
        }
        setAssignmentsBack(nextBack);
        return nextFront;
      });
    },
    [isFront, assignmentsBack, matchLength, cellsPerPage, isMultiPage],
  );

  const addImages = useCallback(
    (newImages) => {
      if (newImages.length === 0) return;
      // Modo multi-page: solo asigna en celdas vacias existentes, sin crecer.
      if (isMultiPage) {
        if (totalCellsCount === 0) return;
        setImages((prev) => [...prev, ...newImages]);
        applyMutation((arr) => {
          const next = arr.slice();
          for (const img of newImages) {
            const idx = next.findIndex((id) => id === null);
            if (idx === -1) break; // no hay mas celdas vacias
            next[idx] = img.id;
          }
          return next;
        });
        return;
      }
      if (cellsPerPage === 0) return;
      setImages((prev) => [...prev, ...newImages]);
      applyMutation((arr) => {
        let next = arr;
        for (const img of newImages) {
          let idx = next.findIndex((id) => id === null);
          if (idx === -1) {
            idx = next.length;
            next = next.concat(Array(cellsPerPage).fill(null));
          }
          next[idx] = img.id;
        }
        return next;
      });
    },
    [cellsPerPage, isMultiPage, totalCellsCount, applyMutation],
  );

  // Carga imagenes y asigna celdas explicitamente segun un mapping
  // cellIndex -> imageIndex (indices dentro del array newImages).
  // Pensado para auto-pack: las celdas se computaron sabiendo que imagen
  // va en cada una, y queremos que ese orden se respete en una sola operacion.
  const loadImagesWithMapping = useCallback(
    (newImages, cellMapping) => {
      if (newImages.length === 0 || cellMapping.length === 0) return;
      if (totalCellsCount === 0) return;
      setImages((prev) => [...prev, ...newImages]);
      applyMutation((arr) => {
        const next = arr.slice();
        while (next.length < cellMapping.length) next.push(null);
        for (let i = 0; i < cellMapping.length; i++) {
          const img = newImages[cellMapping[i]];
          if (img) next[i] = img.id;
        }
        return next;
      });
    },
    [applyMutation, totalCellsCount],
  );

  const addImageToCell = useCallback(
    (cellIdx, image) => {
      setImages((prev) => [...prev, image]);
      applyMutation((arr) => {
        arr[cellIdx] = image.id;
        return arr;
      });
    },
    [applyMutation],
  );

  const swapCells = useCallback(
    (a, b) => {
      if (a === b) return;
      applyMutation((arr) => {
        [arr[a], arr[b]] = [arr[b], arr[a]];
        return arr;
      });
    },
    [applyMutation],
  );

  const assignImageToCell = useCallback(
    (cellIdx, imageId) => {
      applyMutation((arr) => {
        arr[cellIdx] = imageId;
        return arr;
      });
    },
    [applyMutation],
  );

  // Llena las celdas de UNA hoja con la imagen indicada. pageIdx indica
  // que hoja (0 = primera). Si no se pasa, opera sobre la primera.
  const fillAllWith = useCallback(
    (imageId, pageIdx = 0) => {
      let start, count;
      if (isMultiPage) {
        if (!template) return;
        // Para multi-page, las celdas dependen de la cara activa.
        const cellFace = isFront ? 'front' : 'back';
        let offset = 0;
        for (let i = 0; i < pageIdx; i++) {
          offset += cellsCountOnPage(template, i, cellFace);
        }
        count = cellsCountOnPage(template, pageIdx, cellFace);
        start = offset;
        if (count === 0) return;
      } else {
        if (cellsPerPage === 0) return;
        start = pageIdx * cellsPerPage;
        count = cellsPerPage;
      }
      applyMutation((arr) => {
        const needed = start + count;
        let next = arr;
        // Solo en legacy se expanden mas paginas; en multi-page no aplica.
        while (!isMultiPage && next.length < needed) {
          next = next.concat(Array(cellsPerPage).fill(null));
        }
        for (let i = start; i < start + count && i < next.length; i++) {
          next[i] = imageId;
        }
        return next;
      });
    },
    [applyMutation, cellsPerPage, isMultiPage, template, isFront],
  );

  // Reparte equitativamente las imagenes cargadas entre las celdas de la pagina
  // indicada (default: primera). Modos:
  //   'fill-empty'  -> solo asigna en celdas vacias de la pagina (preserva las ocupadas).
  //   'replace-all' -> sobreescribe todas las celdas de la pagina con el reparto.
  // pageIdx fuera de rango: no hace nada.
  const distributeImagesEvenly = useCallback(
    (mode = 'fill-empty', pageIdx = 0) => {
      if (images.length === 0) return;
      let start, count;
      if (isMultiPage) {
        if (!template) return;
        const cellFace = isFront ? 'front' : 'back';
        let offset = 0;
        for (let i = 0; i < pageIdx; i++) {
          offset += cellsCountOnPage(template, i, cellFace);
        }
        count = cellsCountOnPage(template, pageIdx, cellFace);
        start = offset;
        if (count === 0) return;
      } else {
        if (cellsPerPage === 0) return;
        start = pageIdx * cellsPerPage;
        count = cellsPerPage;
      }
      const end = start + count;
      if (start >= assignments.length) return;

      const range = [];
      for (let i = start; i < end && i < assignments.length; i++) range.push(i);
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
    [cellsPerPage, isMultiPage, template, isFront, images, assignments, applyMutation],
  );

  const clearCell = useCallback(
    (cellIdx) => {
      applyMutation((arr) => {
        arr[cellIdx] = null;
        return arr;
      });
    },
    [applyMutation],
  );

  const removeImage = useCallback(
    (imageId) => {
      setImages((prev) => prev.filter((i) => i.id !== imageId));
      // Limpiar la imagen en AMBAS caras y compactar (solo legacy).
      setAssignmentsFront((prevF) => {
        let nf = prevF.map((id) => (id === imageId ? null : id));
        let nb = assignmentsBack.map((id) => (id === imageId ? null : id));
        [nf, nb] = matchLength(nf, nb, nf.length);
        if (!isMultiPage && cellsPerPage > 0) {
          while (
            nf.length > cellsPerPage &&
            nf.slice(-cellsPerPage).every((id) => id === null) &&
            nb.slice(-cellsPerPage).every((id) => id === null)
          ) {
            nf = nf.slice(0, nf.length - cellsPerPage);
            nb = nb.slice(0, nb.length - cellsPerPage);
          }
        }
        setAssignmentsBack(nb);
        return nf;
      });
    },
    [assignmentsBack, matchLength, cellsPerPage, isMultiPage],
  );

  const updateImage = useCallback((imageId, updates) => {
    setImages((prev) =>
      prev.map((img) => (img.id === imageId ? { ...img, ...updates } : img)),
    );
  }, []);

  const clearAll = useCallback(() => {
    setImages([]);
    const size = isMultiPage ? totalCellsCount : cellsPerPage;
    const empty = size > 0 ? Array(size).fill(null) : [];
    setAssignmentsFront(empty);
    setAssignmentsBack([...empty]);
    setSelectedCell(null);
  }, [cellsPerPage, isMultiPage, totalCellsCount]);

  return {
    images,
    imageMap,
    assignments,
    assignmentsFront,
    assignmentsBack,
    selectedCell,
    setSelectedCell,
    cellsPerPage,
    totalCellsCount,
    pageCount,
    addImages,
    loadImagesWithMapping,
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
}
