import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  totalCells,
  cellsCountOnPage,
  fixedPageCount,
} from '../lib/templates.js';
import { distributeEvenly } from '../lib/grid.js';
import { dbg } from '../lib/debugLog.js';

// Limite del stack de undo/redo. 50 pasos cubre uso normal sin inflar memoria.
// Como las imagenes se referencian (no se copian), el costo extra real son
// unos KB por snapshot salvo edits de imagen (rotate/crop) que retienen
// el bitmap viejo mientras este en el historial.
const HISTORY_LIMIT = 50;

// Debounce del auto-save al disco. 800ms = el usuario termino su accion,
// ahora si vale la pena escribir. Mas corto = mas writes innecesarios.
const SAVE_DEBOUNCE_MS = 800;

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
  // Piso de hojas para legacy: si el usuario pide N, hay al menos N hojas
  // (con celdas vacias rellenadas) aunque las imagenes carguen menos. Si
  // carga mas, el array sigue creciendo igual que antes.
  const [minPages, setMinPagesState] = useState(1);

  // Refs siempre al día con el estado del último render. applyMutation lee de
  // acá (no de closures) para no perder escrituras cuando corre en el mismo
  // batch que un loadFromJob/reset. Ver fix del dorso perdido al reabrir.
  const assignmentsFrontRef = useRef(assignmentsFront);
  const assignmentsBackRef = useRef(assignmentsBack);
  assignmentsFrontRef.current = assignmentsFront;
  assignmentsBackRef.current = assignmentsBack;

  const isMultiPage = fixedPageCount(template) !== null;
  // cellsPerPage tiene el significado legacy (cantidad por hoja, constante).
  // En multi-page no aplica directamente; usamos cellsCountOnPage(pageIdx).
  // Para legacy, equivale a totalCells.
  const cellsPerPage = isMultiPage ? 0 : (template ? totalCells(template) : 0);
  // total: en multi-page es la suma de celdas en todas las paginas; en legacy
  // es el largo del array que queremos inicializar (= celdas de 1 hoja).
  const totalCellsCount = template ? totalCells(template) : 0;

  // Persistencia en memoria: por cada plantilla guardamos su estado completo
  // (imagenes + asignaciones + minPages + historial de undo/redo). El Map
  // se mantiene live: cada accion actualiza la entrada de la plantilla
  // actual, asi al cambiar de plantilla simplemente leemos del Map. Sin
  // esto, cambiar de plantilla = perder el trabajo.
  const templateStatesRef = useRef(new Map());
  // Set de templateIds que tienen estado persistido en disco. Se carga al
  // mount y se mantiene sync con saves/deletes. Sirve para el indicador
  // de "tiene trabajo" en la sidebar de plantillas, incluso para plantillas
  // que todavia no abrimos en esta sesion.
  const diskTemplatesRef = useRef(new Set());
  // Timer del debounce de auto-save al disco.
  const saveTimerRef = useRef(null);

  // Undo/redo: stack de snapshots compartidos por referencia con el estado
  // actual. No copiamos las imagenes; cuando una imagen sale del historial
  // queda sin referencias y el GC la libera. Excluimos selectedCell de los
  // snapshots porque solo seleccionar una celda no es una accion "deshacible".
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const skipNextSnapshotRef = useRef(false);
  const lastTemplateIdRef = useRef(undefined);
  // historyTick fuerza re-render cuando cambia canUndo/canRedo o el set
  // de plantillas con trabajo persistido. El valor exacto no importa, solo
  // que cambie.
  const [historyTick, setHistoryTick] = useState(0);
  const bumpHistoryTick = useCallback(() => setHistoryTick((v) => v + 1), []);
  // mutationTick: incrementa SOLO cuando una accion real del usuario modifica
  // el estado (no incrementa en restore por cambio de plantilla, undo/redo,
  // ni en loadFromJob). App.jsx la usa para marcar el job como "dirty".
  const [mutationTick, setMutationTick] = useState(0);

  // Cambio de plantilla: restaura del Map o inicializa vacio. NO necesita
  // guardar la saliente porque el snapshot effect ya mantiene el Map al dia
  // en cada accion. Solo dispara cuando cambia el id.
  // useLayoutEffect (no useEffect) para que el state se aplique ANTES del
  // paint — sino al switchear de tab se ve un frame con el state viejo del
  // editor + el template nuevo, lo que provoca un "flash" feo.
  useLayoutEffect(() => {
    const newTplId = template?.id ?? null;
    if (lastTemplateIdRef.current === newTplId) return;

    dbg(`[layout] template change ${lastTemplateIdRef.current ?? 'null'} → ${newTplId ?? 'null'} | curImages=${images.length} mapHas=${!!templateStatesRef.current.get(newTplId)}`);
    lastTemplateIdRef.current = newTplId;
    // El proximo fire del snapshot effect no debe pushear al historial
    // (el cambio de state es restore, no accion del usuario). Pero igual
    // refrescara el Map.
    skipNextSnapshotRef.current = true;

    if (newTplId === null) {
      setImages([]);
      setAssignmentsFront([]);
      setAssignmentsBack([]);
      setMinPagesState(1);
      setSelectedCell(null);
      historyRef.current = [];
      historyIndexRef.current = -1;
      bumpHistoryTick();
      return;
    }

    const saved = templateStatesRef.current.get(newTplId);
    if (saved) {
      dbg(`[layout] RESTORE Map[${newTplId}] → images=${saved.images.length} front=${saved.assignmentsFront.length} (front!=null=${saved.assignmentsFront.filter((x) => x != null).length})`);
      setImages(saved.images);
      setAssignmentsFront(saved.assignmentsFront);
      setAssignmentsBack(saved.assignmentsBack);
      setMinPagesState(saved.minPages);
      setSelectedCell(null);
      historyRef.current = saved.history;
      historyIndexRef.current = saved.historyIndex;
      bumpHistoryTick();
      return undefined;
    }

    // No hay estado en memoria: init vacio SYNC y luego intentamos cargar
    // del disco ASYNC. Si la plantilla tiene work guardado, lo aplicamos.
    const emptyFront = totalCellsCount > 0 ? Array(totalCellsCount).fill(null) : [];
    const emptyBack = totalCellsCount > 0 ? Array(totalCellsCount).fill(null) : [];
    setImages([]);
    setAssignmentsFront(emptyFront);
    setAssignmentsBack(emptyBack);
    setMinPagesState(1);
    setSelectedCell(null);
    historyRef.current = [{
      images: [],
      assignmentsFront: emptyFront,
      assignmentsBack: emptyBack,
      minPages: 1,
    }];
    historyIndexRef.current = 0;
    bumpHistoryTick();

    // Async load del disco. Si encuentra estado y todavia estamos en esta
    // plantilla, lo aplicamos como nuevo snapshot inicial.
    let cancelled = false;
    const api = typeof window !== 'undefined' ? window.printlayout?.workStates : null;
    if (api?.load) {
      api.load(newTplId).then((disk) => {
        if (cancelled || !disk) return;
        if (lastTemplateIdRef.current !== newTplId) return;
        // Sanity check: que tenga la forma esperada.
        if (!Array.isArray(disk.images) || !Array.isArray(disk.assignmentsFront)) return;
        dbg(`[layout] disk-load aplica → tpl=${newTplId} images=${disk.images.length} front=${disk.assignmentsFront.filter((x) => x != null).length}`);
        skipNextSnapshotRef.current = true;
        setImages(disk.images);
        setAssignmentsFront(disk.assignmentsFront);
        setAssignmentsBack(disk.assignmentsBack || []);
        setMinPagesState(disk.minPages ?? 1);
        historyRef.current = [{
          images: disk.images,
          assignmentsFront: disk.assignmentsFront,
          assignmentsBack: disk.assignmentsBack || [],
          minPages: disk.minPages ?? 1,
        }];
        historyIndexRef.current = 0;
        bumpHistoryTick();
      }).catch((err) => {
        console.warn('[work-states] load fallo:', err);
      });
    }
    return () => { cancelled = true; };
  }, [template?.id, totalCellsCount, bumpHistoryTick]);

  // Mount: cargar lista de plantillas con trabajo persistido en disco.
  // Asi la sidebar puede mostrar el indicador para plantillas que aun no
  // abrimos en esta sesion.
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.printlayout?.workStates : null;
    if (!api?.list) return undefined;
    let cancelled = false;
    api.list().then((ids) => {
      if (cancelled) return;
      diskTemplatesRef.current = new Set(ids || []);
      bumpHistoryTick();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [bumpHistoryTick]);

  // Auto-save debounced al disco cuando cambia el estado de la plantilla
  // actual. Solo guardamos {images, assignments, minPages}, no el historial
  // (transient). Cancelamos el timer anterior en cada cambio: solo el
  // ultimo cambio dispara el write.
  useEffect(() => {
    if (!lastTemplateIdRef.current) return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const tplId = lastTemplateIdRef.current;
    // Capturamos snapshot del state actual para el closure.
    const payload = {
      images,
      assignmentsFront,
      assignmentsBack,
      minPages,
    };
    saveTimerRef.current = setTimeout(() => {
      const api = typeof window !== 'undefined' ? window.printlayout?.workStates : null;
      if (!api?.save) return;
      // Si el estado esta totalmente vacio, no creamos archivo (mantenemos
      // la sidebar limpia). resetCurrentTemplateWork hace el delete explicito.
      const hasImages = payload.images.length > 0;
      const hasAssignments =
        payload.assignmentsFront.some((x) => x !== null) ||
        payload.assignmentsBack.some((x) => x !== null);
      if (!hasImages && !hasAssignments) {
        if (diskTemplatesRef.current.has(tplId)) {
          dbg(`[ws] DELETE ${tplId} (estado vacío) ← ¡OJO borra trabajo en disco!`);
          api.delete(tplId).catch(() => {});
          diskTemplatesRef.current.delete(tplId);
          bumpHistoryTick();
        }
        return;
      }
      dbg(`[ws] save ${tplId} images=${payload.images.length} front=${payload.assignmentsFront.filter((x) => x != null).length} minPages=${payload.minPages}`);
      api.save(tplId, payload).then(() => {
        if (!diskTemplatesRef.current.has(tplId)) {
          diskTemplatesRef.current.add(tplId);
          bumpHistoryTick();
        }
      }).catch((err) => console.warn('[work-states] save fallo:', err));
    }, SAVE_DEBOUNCE_MS);
    return undefined; // intentionally NO cancel: dejar fire al desmontar
  }, [images, assignmentsFront, assignmentsBack, minPages, bumpHistoryTick]);

  // Snapshot effect: empuja al historial cuando cambia el estado por accion
  // del usuario, y SIEMPRE refresca el Map persistente con el estado actual
  // (incluso despues de undo/redo). Asi el Map nunca queda stale.
  useEffect(() => {
    const wasSkip = skipNextSnapshotRef.current;
    skipNextSnapshotRef.current = false;

    if (!wasSkip) {
      const snapshot = { images, assignmentsFront, assignmentsBack, minPages };
      const truncated = historyRef.current.slice(0, historyIndexRef.current + 1);
      truncated.push(snapshot);
      if (truncated.length > HISTORY_LIMIT) {
        truncated.shift();
      }
      historyRef.current = truncated;
      historyIndexRef.current = truncated.length - 1;
      setMutationTick((t) => t + 1);
    }

    // Actualizar Map persistente con estado actual.
    if (lastTemplateIdRef.current) {
      templateStatesRef.current.set(lastTemplateIdRef.current, {
        images,
        assignmentsFront,
        assignmentsBack,
        minPages,
        history: historyRef.current,
        historyIndex: historyIndexRef.current,
      });
    }

    bumpHistoryTick();
  }, [images, assignmentsFront, assignmentsBack, minPages, bumpHistoryTick]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snap = historyRef.current[historyIndexRef.current];
    skipNextSnapshotRef.current = true;
    setImages(snap.images);
    setAssignmentsFront(snap.assignmentsFront);
    setAssignmentsBack(snap.assignmentsBack);
    setMinPagesState(snap.minPages);
    setSelectedCell(null);
    bumpHistoryTick();
  }, [bumpHistoryTick]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snap = historyRef.current[historyIndexRef.current];
    skipNextSnapshotRef.current = true;
    setImages(snap.images);
    setAssignmentsFront(snap.assignmentsFront);
    setAssignmentsBack(snap.assignmentsBack);
    setMinPagesState(snap.minPages);
    setSelectedCell(null);
    bumpHistoryTick();
  }, [bumpHistoryTick]);

  // Limpia el trabajo de la plantilla actual: vuelve a estado vacio, borra
  // historial, borra la entrada del Map en memoria y el archivo del disco.
  // La proxima vez que entres a esta plantilla arranca desde cero. Usado
  // por el boton "Empezar de cero".
  const resetCurrentTemplateWork = useCallback(() => {
    const tplId = lastTemplateIdRef.current;
    if (tplId) {
      templateStatesRef.current.delete(tplId);
      const api = typeof window !== 'undefined' ? window.printlayout?.workStates : null;
      if (api?.delete) {
        api.delete(tplId).catch(() => {});
      }
      diskTemplatesRef.current.delete(tplId);
    }
    // Cancelar cualquier save pendiente del debounce — sino podria re-crear
    // el archivo justo despues del delete.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const emptyFront = totalCellsCount > 0 ? Array(totalCellsCount).fill(null) : [];
    const emptyBack = totalCellsCount > 0 ? Array(totalCellsCount).fill(null) : [];
    skipNextSnapshotRef.current = true;
    setImages([]);
    setAssignmentsFront(emptyFront);
    setAssignmentsBack(emptyBack);
    setMinPagesState(1);
    setSelectedCell(null);
    historyRef.current = [{
      images: [],
      assignmentsFront: emptyFront,
      assignmentsBack: emptyBack,
      minPages: 1,
    }];
    historyIndexRef.current = 0;
    bumpHistoryTick();
  }, [totalCellsCount, bumpHistoryTick]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;
  // Set de ids de plantillas con trabajo (in-memory + disco). historyTick
  // cambia en cada accion / cambio de plantilla / load del disco, asi que
  // se recomputa.
  const templatesWithWork = useMemo(() => {
    const ids = new Set(diskTemplatesRef.current);
    for (const [id, state] of templateStatesRef.current) {
      // Consideramos "con trabajo" si tiene imagenes cargadas o alguna celda
      // asignada. Estado vacio recien inicializado no cuenta.
      const hasImages = state.images?.length > 0;
      const hasAssignments =
        state.assignmentsFront?.some((x) => x !== null) ||
        state.assignmentsBack?.some((x) => x !== null);
      if (hasImages || hasAssignments) ids.add(id);
      else ids.delete(id); // por si tenia disco pero ahora la vaciaron
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyTick]);

  const isFront = face !== 'back';
  const assignments = isFront ? assignmentsFront : assignmentsBack;

  const pageCount = isMultiPage
    ? fixedPageCount(template)
    : (cellsPerPage > 0
      ? Math.max(minPages, Math.ceil(assignmentsFront.length / cellsPerPage))
      : 0);

  const imageMap = useMemo(() => {
    const m = new Map();
    for (const img of images) m.set(img.id, img);
    return m;
  }, [images]);

  // Piso de celdas en legacy: minPages hojas * cellsPerPage celdas por hoja.
  // En multi-page no aplica (total fijo).
  const minCellsFloor = isMultiPage
    ? 0
    : cellsPerPage * Math.max(1, minPages);

  // Garantiza que ambos arrays tengan la misma longitud. En modo multi-page,
  // la longitud es fija (totalCellsCount); en legacy se redondea a multiplo
  // de cellsPerPage y se respeta el piso de minPages.
  const matchLength = useCallback(
    (front, back, targetLen) => {
      let want;
      if (isMultiPage) {
        want = totalCellsCount;
      } else {
        want = Math.max(targetLen, cellsPerPage, minCellsFloor);
        // En legacy, la longitud debe ser multiplo de cellsPerPage: cada
        // "hoja" virtual ocupa cellsPerPage entradas. Si un caller pidio un
        // targetLen no alineado (p.ej. set en indice global > arr.length),
        // redondear arriba evita pageCount fraccional.
        if (cellsPerPage > 0 && want % cellsPerPage !== 0) {
          want = Math.ceil(want / cellsPerPage) * cellsPerPage;
        }
      }
      const padded = (arr) =>
        arr.length >= want
          ? arr.slice(0, Math.max(arr.length, want)) // multi-page: trunca extra
          : arr.concat(Array(want - arr.length).fill(null));
      return [padded(front), padded(back)];
    },
    [cellsPerPage, isMultiPage, totalCellsCount, minCellsFloor],
  );

  // Pure helpers que aplican una mutacion al array de la cara activa
  // y devuelven [front, back] compactados al final.
  const applyMutation = useCallback(
    (mutator) => {
      // Leemos AMBOS arrays de refs (al día con el último render) y seteamos los
      // dos DIRECTAMENTE. Antes el back se seteaba DENTRO del updater de
      // setAssignmentsFront: eso DIFERÍA la escritura del back al momento en que
      // React procesa la cola del front, que ocurre DESPUÉS de las escrituras
      // directas del mismo batch. Si un loadFromJob (reabrir un trabajo doble
      // faz) corría en ese batch, su setAssignmentsBack([cargado]) se pisaba con
      // el back diferido (stale/vacío) → el dorso se perdía al reabrir. El front
      // sobrevivía porque se leía en vivo desde el updater. Al setear ambos
      // directo, el orden de encolado respeta el orden de llamada y loadFromJob
      // (posterior) gana.
      const prevFront = assignmentsFrontRef.current;
      const prevBack = assignmentsBackRef.current;
      let nextFront = prevFront;
      let nextBack = prevBack;
      if (isFront) {
        nextFront = mutator([...prevFront]);
        [nextFront, nextBack] = matchLength(nextFront, prevBack, nextFront.length);
      } else {
        nextBack = mutator([...prevBack]);
        [nextFront, nextBack] = matchLength(prevFront, nextBack, nextBack.length);
      }
      // Compact trailing pages solo en modo legacy (las hojas son virtuales).
      // En multi-page la cantidad es fija — no se compacta. Nunca baja
      // del piso minCellsFloor (asegura las hojas pedidas a mano).
      if (!isMultiPage && cellsPerPage > 0) {
        const floor = Math.max(cellsPerPage, minCellsFloor);
        while (
          nextFront.length > floor &&
          nextFront.slice(-cellsPerPage).every((id) => id === null) &&
          nextBack.slice(-cellsPerPage).every((id) => id === null)
        ) {
          nextFront = nextFront.slice(0, nextFront.length - cellsPerPage);
          nextBack = nextBack.slice(0, nextBack.length - cellsPerPage);
        }
      }
      // Refs sincrónicos: si hay varias mutaciones en el mismo tick, la segunda
      // ve el resultado de la primera (encadenan sin render intermedio).
      assignmentsFrontRef.current = nextFront;
      assignmentsBackRef.current = nextBack;
      setAssignmentsFront(nextFront);
      setAssignmentsBack(nextBack);
    },
    [isFront, matchLength, cellsPerPage, isMultiPage, minCellsFloor],
  );

  // Reaccionar a cambios de minPages: dispara una pasada por matchLength +
  // compactacion para crecer/podar trailing pages segun el nuevo piso. Usamos
  // un ref a applyMutation para evitar que el effect se redispare por la
  // re-creacion del callback.
  const applyMutationRef = useRef(applyMutation);
  useEffect(() => { applyMutationRef.current = applyMutation; }, [applyMutation]);
  // Este effect existe para reaccionar cuando el USUARIO cambia "Hojas"
  // (minPages) en la MISMA pestaña. PERO sus deps incluyen cellsPerPage, que
  // también cambia en un CAMBIO DE PESTAÑA. Si corría applyMutation en un
  // switch, leía `assignmentsFrontRef.current` — que va UN RENDER ATRÁS del
  // setAssignmentsFront que hizo el layoutEffect al montar el template nuevo, o
  // sea, todavía tiene las asignaciones de la pestaña SALIENTE — y las volcaba
  // (matchLength-eadas a múltiplo de cellsPerPage) en la pestaña ENTRANTE →
  // CONTAMINACIÓN CRUZADA de celdas entre pestañas (bug del posado que se
  // "borra" al abrir/cambiar de pestaña). Fix: correr applyMutation SOLO si el
  // template no cambió respecto de la última corrida (mismo tpl = fue un cambio
  // real de "Hojas", no un switch). En un switch, el layoutEffect ya dejó el
  // estado correcto — no hay que tocarlo.
  const minPagesEffectTplRef = useRef(null);
  useEffect(() => {
    const tpl = lastTemplateIdRef.current;
    const sameTemplate = minPagesEffectTplRef.current === tpl;
    minPagesEffectTplRef.current = tpl;
    if (isMultiPage || cellsPerPage === 0) return;
    if (!sameTemplate) return; // fue un switch de pestaña, no un cambio de "Hojas"
    applyMutationRef.current((arr) => arr);
  }, [minPages, isMultiPage, cellsPerPage]);

  const setMinPages = useCallback((n) => {
    const v = Math.max(1, Math.floor(Number(n) || 1));
    setMinPagesState(v);
  }, []);

  const addImages = useCallback(
    (newImages) => {
      if (newImages.length === 0) return;
      dbg(`[layout] addImages +${newImages.length} tpl=${lastTemplateIdRef.current ?? '-'} isMultiPage=${isMultiPage} cellsPerPage=${cellsPerPage} frontLen(antes)=${assignmentsFrontRef.current.length}`);
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
  // indicada (default: primera) o de todas las hojas. Modos:
  //   'fill-empty'  -> solo asigna en celdas vacias del scope (preserva las ocupadas).
  //   'replace-all' -> sobreescribe todas las celdas del scope con el reparto.
  // scope:
  //   'page'        -> solo la pagina pageIdx.
  //   'all-pages'   -> todas las celdas de la cara actual (cruza hojas).
  // pageIdx fuera de rango con scope='page': no hace nada.
  const distributeImagesEvenly = useCallback(
    (mode = 'fill-empty', pageIdx = 0, scope = 'page') => {
      if (images.length === 0) return;
      const range = [];
      if (scope === 'all-pages') {
        for (let i = 0; i < assignments.length; i++) range.push(i);
      } else {
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
        for (let i = start; i < end && i < assignments.length; i++) range.push(i);
      }
      if (range.length === 0) return;

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

  // Reparte por CANTIDAD por imagen: countsById es { imageId: cantidad }.
  // Arma una secuencia agrupada (imagen A repetida qA veces, luego B qB veces,
  // ...) en el orden de `images`, y la coloca desde la primera celda. En modo
  // legacy las hojas crecen solas para alojar todas las copias. Reemplaza el
  // contenido de la cara activa. Devuelve { totalCopies, pages } (estimado) o
  // null si no aplica.
  const applyImageQuantities = useCallback(
    (countsById) => {
      if (isMultiPage || cellsPerPage === 0 || images.length === 0) return null;
      const seq = [];
      for (const img of images) {
        const q = Math.max(0, Math.floor(Number(countsById?.[img.id]) || 0));
        for (let k = 0; k < q; k++) seq.push(img.id);
      }
      if (seq.length === 0) return null;
      applyMutation(() => seq.slice());
      return {
        totalCopies: seq.length,
        pages: Math.ceil(seq.length / cellsPerPage),
      };
    },
    [isMultiPage, cellsPerPage, images, applyMutation],
  );

  // Asigna imagenes YA cargadas a celdas segun un array flat
  // (cellFlatIdx -> imageId|null). Reemplaza el contenido de la cara ACTIVA sin
  // agregar imagenes ni cambiar la geometria. Pensado para plantillas de celdas
  // FIJAS (medidas multiples): "cantidad por foto por tamaño" arma el array y lo
  // aplica de una (1 solo snapshot → 1 Ctrl+Z revierte todo). Devuelve la
  // cantidad de celdas asignadas (no nulas), o null si no aplica.
  const assignCellsExplicit = useCallback(
    (flatArr) => {
      if (!Array.isArray(flatArr) || flatArr.length === 0) return null;
      applyMutation(() => flatArr.slice());
      setSelectedCell(null);
      return flatArr.filter((id) => id != null).length;
    },
    [applyMutation],
  );

  // Posa pares frente/dorso emparejados por indice. `cards` es una lista YA
  // expandida por cantidad: [{ front: imageObj|null, back: imageObj|null }, ...].
  // La tarjeta i ocupa la celda i del frente (front) y la celda i del dorso
  // (back). Como en una grilla doble faz celdasDorso[i] es el espejo de
  // celdas[i], el dorso de cada tarjeta cae detras de su frente al girar la
  // hoja. Reemplaza imagenes + ambas asignaciones (es un layout completo).
  // Permite pares incompletos (front o back en null => esa celda queda vacia).
  // Solo aplica en plantillas legacy doble faz. Devuelve { cards, pages } o null.
  const applyFrontBackPairs = useCallback(
    (cards) => {
      if (isMultiPage || cellsPerPage === 0) return null;
      if (!Array.isArray(cards) || cards.length === 0) return null;
      // Imagenes unicas usadas (frente + dorso), sin duplicar por id.
      const imgById = new Map();
      for (const c of cards) {
        if (c?.front) imgById.set(c.front.id, c.front);
        if (c?.back) imgById.set(c.back.id, c.back);
      }
      const newImages = [...imgById.values()];
      // Largo redondeado a multiplo de cellsPerPage (hojas completas).
      const want = Math.max(
        cellsPerPage,
        Math.ceil(cards.length / cellsPerPage) * cellsPerPage,
      );
      const front = Array(want).fill(null);
      const back = Array(want).fill(null);
      for (let i = 0; i < cards.length; i++) {
        front[i] = cards[i]?.front?.id ?? null;
        back[i] = cards[i]?.back?.id ?? null;
      }
      // Set directo de los 3 estados (React los batchea => un solo snapshot).
      setImages(newImages);
      setAssignmentsFront(front);
      setAssignmentsBack(back);
      setSelectedCell(null);
      return { cards: cards.length, pages: Math.ceil(cards.length / cellsPerPage) };
    },
    [isMultiPage, cellsPerPage],
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
          const floor = Math.max(cellsPerPage, minCellsFloor);
          while (
            nf.length > floor &&
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
    [assignmentsBack, matchLength, cellsPerPage, isMultiPage, minCellsFloor],
  );

  const updateImage = useCallback((imageId, updates) => {
    setImages((prev) =>
      prev.map((img) => (img.id === imageId ? { ...img, ...updates } : img)),
    );
  }, []);

  // Aplica varios cambios de imagen en UNA sola operacion (un solo setState ->
  // un solo snapshot de historial, asi "deshacer" revierte todo el lote de una).
  // entries: [{ id, updates }]. Se usa para "aplicar la misma edicion a todas".
  const updateImages = useCallback((entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const byId = new Map(entries.filter((e) => e && e.id).map((e) => [e.id, e.updates || {}]));
    if (byId.size === 0) return;
    setImages((prev) =>
      prev.map((img) => (byId.has(img.id) ? { ...img, ...byId.get(img.id) } : img)),
    );
  }, []);

  // Carga el estado completo desde un job guardado. Sobreescribe images +
  // assignments + minPages directamente, resetea el historial al snapshot
  // cargado, y marca skipNextSnapshot para que NO se cuente como accion
  // del usuario (no marca dirty). El template ya debe estar montado antes
  // de llamar este metodo — el caller espera al cambio de selectedId via
  // pendingJobLoad effect.
  const loadFromJob = useCallback(({
    images: jobImages,
    assignmentsFront: jobFront,
    assignmentsBack: jobBack,
    minPages: jobMinPages,
  } = {}) => {
    const safeImages = Array.isArray(jobImages) ? jobImages : [];
    const safeFront = Array.isArray(jobFront) ? jobFront : [];
    const safeBack = Array.isArray(jobBack) ? jobBack : [];
    const safeMin = Math.max(1, Math.floor(Number(jobMinPages) || 1));
    dbg(`[layout] loadFromJob → tpl=${lastTemplateIdRef.current ?? '-'} images=${safeImages.length} front=${safeFront.filter((x) => x != null).length}`);
    skipNextSnapshotRef.current = true;
    setImages(safeImages);
    setAssignmentsFront(safeFront);
    setAssignmentsBack(safeBack);
    setMinPagesState(safeMin);
    setSelectedCell(null);
    historyRef.current = [{
      images: safeImages,
      assignmentsFront: safeFront,
      assignmentsBack: safeBack,
      minPages: safeMin,
    }];
    historyIndexRef.current = 0;
    bumpHistoryTick();
  }, [bumpHistoryTick]);

  const clearAll = useCallback(() => {
    setImages([]);
    const size = isMultiPage
      ? totalCellsCount
      : Math.max(cellsPerPage, minCellsFloor);
    const empty = size > 0 ? Array(size).fill(null) : [];
    setAssignmentsFront(empty);
    setAssignmentsBack([...empty]);
    setSelectedCell(null);
  }, [cellsPerPage, isMultiPage, totalCellsCount, minCellsFloor]);

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
    minPages,
    setMinPages,
    addImages,
    loadImagesWithMapping,
    addImageToCell,
    assignImageToCell,
    fillAllWith,
    distributeImagesEvenly,
    applyImageQuantities,
    assignCellsExplicit,
    applyFrontBackPairs,
    swapCells,
    clearCell,
    removeImage,
    updateImage,
    updateImages,
    clearAll,
    undo,
    redo,
    canUndo,
    canRedo,
    resetCurrentTemplateWork,
    templatesWithWork,
    mutationTick,
    loadFromJob,
  };
}
