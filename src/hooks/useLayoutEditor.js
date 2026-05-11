import { useCallback, useEffect, useMemo, useState } from 'react';
import { totalCells } from '../lib/templates.js';
import { distributeEvenly } from '../lib/grid.js';

// Soporta plantillas simple-faz (un assignments) y doble-faz (front/back).
// El estado interno SIEMPRE mantiene los dos arrays alineados (misma length);
// para simple-faz, assignmentsBack queda como espejo vacio que no se usa.
//
// La cara activa la decide quien consume el hook (App.jsx) via `face`.
export function useLayoutEditor(template, face = 'front') {
  const [images, setImages] = useState([]);
  const [assignmentsFront, setAssignmentsFront] = useState([]);
  const [assignmentsBack, setAssignmentsBack] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);

  const cellsPerPage = template ? totalCells(template) : 0;

  useEffect(() => {
    setAssignmentsFront(cellsPerPage > 0 ? Array(cellsPerPage).fill(null) : []);
    setAssignmentsBack(cellsPerPage > 0 ? Array(cellsPerPage).fill(null) : []);
    setSelectedCell(null);
  }, [template?.id, cellsPerPage]);

  const isFront = face !== 'back';
  const assignments = isFront ? assignmentsFront : assignmentsBack;

  const pageCount =
    cellsPerPage > 0 ? Math.max(1, assignmentsFront.length / cellsPerPage) : 0;

  const imageMap = useMemo(() => {
    const m = new Map();
    for (const img of images) m.set(img.id, img);
    return m;
  }, [images]);

  // Garantiza que ambos arrays tengan la misma longitud, multiplo de cellsPerPage.
  const matchLength = useCallback(
    (front, back, targetLen) => {
      const want = Math.max(targetLen, cellsPerPage);
      const padded = (arr) =>
        arr.length >= want
          ? arr
          : arr.concat(Array(want - arr.length).fill(null));
      return [padded(front), padded(back)];
    },
    [cellsPerPage],
  );

  // Pure helpers que aplican una mutacion al array de la cara activa
  // y devuelven [front, back] compactados al final.
  const applyMutation = useCallback(
    (mutator) => {
      setAssignmentsFront((prevFront) => {
        // Necesitamos la cara opuesta tambien. Usamos un ref-like via setter.
        let nextFront = prevFront;
        let nextBack = assignmentsBack;
        if (isFront) {
          nextFront = mutator([...prevFront]);
          [nextFront, nextBack] = matchLength(nextFront, assignmentsBack, nextFront.length);
        } else {
          nextBack = mutator([...assignmentsBack]);
          [nextFront, nextBack] = matchLength(prevFront, nextBack, nextBack.length);
        }
        // Compact trailing pages where AMBAS caras estan vacias.
        if (cellsPerPage > 0) {
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
    [isFront, assignmentsBack, matchLength, cellsPerPage],
  );

  const addImages = useCallback(
    (newImages) => {
      if (newImages.length === 0 || cellsPerPage === 0) return;
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
    [cellsPerPage, applyMutation],
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
      if (cellsPerPage === 0) return;
      const start = pageIdx * cellsPerPage;
      applyMutation((arr) => {
        // Si la hoja pedida no existe aun (pageIdx mas alla del array),
        // expandir con nulls hasta esa pagina.
        const needed = start + cellsPerPage;
        let next = arr;
        while (next.length < needed) {
          next = next.concat(Array(cellsPerPage).fill(null));
        }
        for (let i = start; i < start + cellsPerPage; i++) {
          next[i] = imageId;
        }
        return next;
      });
    },
    [applyMutation, cellsPerPage],
  );

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
      // Limpiar la imagen en AMBAS caras y compactar.
      setAssignmentsFront((prevF) => {
        let nf = prevF.map((id) => (id === imageId ? null : id));
        let nb = assignmentsBack.map((id) => (id === imageId ? null : id));
        [nf, nb] = matchLength(nf, nb, nf.length);
        if (cellsPerPage > 0) {
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
    [assignmentsBack, matchLength, cellsPerPage],
  );

  const updateImage = useCallback((imageId, updates) => {
    setImages((prev) =>
      prev.map((img) => (img.id === imageId ? { ...img, ...updates } : img)),
    );
  }, []);

  const clearAll = useCallback(() => {
    setImages([]);
    const empty = cellsPerPage > 0 ? Array(cellsPerPage).fill(null) : [];
    setAssignmentsFront(empty);
    setAssignmentsBack([...empty]);
    setSelectedCell(null);
  }, [cellsPerPage]);

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
}
