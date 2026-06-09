import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import TopBar from './components/TopBar.jsx';
import TabsBar from './components/TabsBar.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import LayoutCanvas from './components/LayoutCanvas.jsx';
import PropertiesSidebar from './components/PropertiesSidebar.jsx';
import PromptModal from './components/PromptModal.jsx';
import PdfUploadModal from './components/PdfUploadModal.jsx';
import PdfImageExtractModal from './components/PdfImageExtractModal.jsx';
import PdfToImageModal from './components/PdfToImageModal.jsx';
import GridUploadModal from './components/GridUploadModal.jsx';
import ImagePackModal from './components/ImagePackModal.jsx';
import ImageCountPackModal from './components/ImageCountPackModal.jsx';
import ImageQuantitiesModal from './components/ImageQuantitiesModal.jsx';
import ImageFrontBackPoseModal from './components/ImageFrontBackPoseModal.jsx';
import IntakePanelModal from './components/IntakePanelModal.jsx';
import ImageEditorModal from './components/ImageEditorModal.jsx';
import ImageCropModal from './components/ImageCropModal.jsx';
import SaveTemplateModal from './components/SaveTemplateModal.jsx';
import PrintModal from './components/PrintModal.jsx';
import SaveJobModal from './components/SaveJobModal.jsx';
import JobsListModal from './components/JobsListModal.jsx';
import NewTabModal from './components/NewTabModal.jsx';
import PaperPresetsModal from './components/PaperPresetsModal.jsx';
import { useTemplates } from './hooks/useTemplates.js';
import { usePaperPresets } from './hooks/usePaperPresets.js';
import { useJobs } from './hooks/useJobs.js';
import { useTabs } from './hooks/useTabs.js';
import { BUILTIN_PAPER_PRESETS } from './lib/grid.js';
import { useLayoutEditor } from './hooks/useLayoutEditor.js';
import { readImageFiles, readImageFile } from './lib/images.js';
import { prepareIncomingImageFiles } from './lib/heic.js';
import {
  exportLayoutToPdf,
  exportDoubleSidedLayoutToPdf,
  printLayoutPdf,
} from './lib/exportPdf.js';
import {
  hasCuts,
  templateOrientation,
  imageOrientation,
  fixedPageCount,
  cellsCountOnPage,
  pageStartOffset,
  findCellPageInfo,
  backMirrorAxis,
  backRotate180,
} from './lib/templates.js';
import { generateCuts } from './lib/grid.js';
import { buildOrderJobs } from './intake/buildOrderJob.js';
import {
  buildCatalogRows,
  catalogRowForTemplate,
  slugifyCatalogId,
  buildCriterioCustomValue,
  CRITERIO_CUSTOM_KEY,
} from './intake/catalog.js';
import { rasterizePdfPages } from './lib/pdfPreview.js';
import { facesBoundingBox } from './lib/faceDetection.js';
import { cropImageDataUrl } from './lib/imageCrop.js';
import { rotateImageDataUrl90CW, rotateFaces90CW } from './lib/imageRotate.js';

export default function App() {
  const {
    templates,
    loading: templatesLoading,
    canShare,
    createFromPdf,
    update,
    remove,
    share,
    syncPull,
  } = useTemplates();
  const {
    allPresets: paperPresetList,
    customPresets: customPaperPresets,
    canSync: canSyncPresets,
    save: savePaperPreset,
    remove: removePaperPreset,
    syncPull: syncPullPaperPresets,
    syncPush: syncPushPaperPresets,
  } = usePaperPresets();
  const {
    jobs,
    loading: jobsLoading,
    save: saveJobToDisk,
    remove: removeJobFromDisk,
    load: loadJobFromDisk,
  } = useJobs();
  // Multi-doc: el estado de "que estoy editando" vive en tabs. Cada tab tiene
  // su template embebido (id sintetico tabtpl_<tabId>), nombre, jobId si fue
  // guardado, isDirty, viewingFace, currentPage, customPaper. images +
  // assignments + minPages + undo/redo los maneja useLayoutEditor via su
  // templateStatesRef Map (keyed por template id) — al switchear tab cambia
  // el template id y useLayoutEditor restora el state.
  const {
    tabs,
    activeTab,
    activeTabId,
    restoring: tabsRestoring,
    pendingRestore,
    confirmRestore,
    discardRestore,
    createTab,
    closeTab,
    switchTab,
    updateActiveTab,
    updateTab,
    reorderTab,
  } = useTabs();
  const [sharing, setSharing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [presetsModalOpen, setPresetsModalOpen] = useState(false);
  const [pdfToImageOpen, setPdfToImageOpen] = useState(false);
  const [intakePanelOpen, setIntakePanelOpen] = useState(false);
  // Modo La Recta: esta PC administra (baja pedidos, edita/publica oficiales).
  // En las demás PCs el panel "Pedidos" se oculta y las oficiales son read-only.
  const [isLaRecta, setIsLaRecta] = useState(false);
  const refreshLaRecta = useCallback(() => {
    window.printlayout?.intake?.isLaRecta?.().then((v) => setIsLaRecta(!!v)).catch(() => {});
  }, []);

  const runSyncWithToast = async ({ silent = false } = {}) => {
    setSyncing(true);
    try {
      const r = await syncPull();
      if (!r?.ok) {
        if (!silent) {
          setToast({ kind: 'error', text: `Sync fallo: ${r?.error ?? 'error'}` });
        }
        return;
      }
      const a = r.added?.length ?? 0;
      const u = r.updated?.length ?? 0;
      const rep = r.replaced?.length ?? 0;
      const c = r.cleaned?.length ?? 0;
      const errs = r.errors?.length ?? 0;
      if (errs > 0) {
        const failed = r.errors.map((e) => `${e.name}: ${e.error}`).join('; ');
        setToast({ kind: 'error', text: `Sync con errores — ${failed}` });
      } else if (a + u + rep + c > 0) {
        const parts = [];
        if (a) parts.push(`${a} nueva${a === 1 ? '' : 's'}`);
        if (u) parts.push(`${u} actualizada${u === 1 ? '' : 's'}`);
        if (rep) parts.push(`${rep} reemplazada${rep === 1 ? '' : 's'}`);
        if (c) parts.push(`${c} duplicada${c === 1 ? '' : 's'} eliminada${c === 1 ? '' : 's'}`);
        setToast({ kind: 'success', text: `Plantillas: ${parts.join(', ')}.` });
      } else if (!silent) {
        setToast({ kind: 'success', text: 'Plantillas sincronizadas, sin cambios.' });
      }
    } catch (err) {
      if (!silent) {
        setToast({ kind: 'error', text: `Sync fallo: ${err.message}` });
      }
      console.warn('Sync de plantillas fallo:', err);
    } finally {
      setSyncing(false);
    }
  };

  // El template de la tab activa ES el "selected": una copia self-contained
  // con id sintetico (tabtpl_<tabId>). Por eso ya no hace falta lookup en
  // templates list — el template ya viene completo. Si la tab esta vacia,
  // selected = null y la app muestra el estado "sin plantilla".
  const selected = activeTab?.template ?? null;
  const selectedId = selected?.id ?? null;

  // Lista unica de carpetas usadas por las plantillas (para autocomplete y
  // agrupado en la sidebar).
  const categoriasList = useMemo(() => {
    const set = new Set();
    for (const t of templates) {
      const c = (t.categoria || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [templates]);

  // viewingFace / currentPage / customPaper viven en la tab activa.
  const viewingFace = activeTab?.viewingFace ?? 'front';
  const currentPage = activeTab?.currentPage ?? 0;
  const customPaper = activeTab?.customPaper ?? null;

  const setViewingFace = useCallback(
    (face) => updateActiveTab({ viewingFace: face }),
    [updateActiveTab],
  );
  const setCurrentPage = useCallback(
    (p) => updateActiveTab((tab) => ({
      currentPage: typeof p === 'function' ? p(tab.currentPage) : p,
    })),
    [updateActiveTab],
  );
  const setCustomPaper = useCallback(
    (cp) => updateActiveTab({ customPaper: cp }),
    [updateActiveTab],
  );

  const layout = useLayoutEditor(selected, viewingFace);

  // Si la plantilla deja de ser doble-faz, volvemos al frente.
  useEffect(() => {
    if (!selected?.doubleSided && viewingFace !== 'front') {
      setViewingFace('front');
    }
  }, [selected?.doubleSided, viewingFace, setViewingFace]);
  const cellPickerRef = useRef(null);
  const pendingCellRef = useRef(null);
  // File picker para "+ Subir PDF" cuando se invoca desde el canvas vacio
  // (la sidebar tiene su propio input interno).
  const blankPdfInputRef = useRef(null);
  // File pickers para los flujos disparados desde NewTabModal (mismos handlers
  // que ya usa la sidebar, pero con inputs al margen del DOM de la sidebar
  // — asi el modal funciona aunque la sidebar deje de estar en Fase D).
  const newTabAutoPickerRef = useRef(null);
  const newTabCountPickerRef = useRef(null);

  const [activeDrag, setActiveDrag] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [saveTemplatePrompt, setSaveTemplatePrompt] = useState(null); // template temporal | null
  const [printPrompt, setPrintPrompt] = useState(null); // { face } | null
  const [exportMarksPrompt, setExportMarksPrompt] = useState(false); // pregunta marcas al exportar
  const [uploading, setUploading] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [toast, setToast] = useState(null);
  const [layoutFitMode, setLayoutFitMode] = useState('contain');
  const [showCuts, setShowCuts] = useState(true);

  // Auto-abrir el modal "Nuevo trabajo" cuando se queda en una sola tab vacia
  // (al arrancar la app, o tras cerrar la ultima tab que useTabs reemplaza
  // por una vacia nueva). Asi el usuario nunca ve un canvas vacio sin saber
  // que hacer. Guard 1: si ya abrimos para esta tab y el usuario lo cerro,
  // no lo abrimos de nuevo hasta que cambie a otra tab vacia distinta.
  // Guard 2: mientras useTabs todavia esta restaurando del disco, no
  // disparamos — sino se abriria el modal por un frame antes de que se
  // restauren las tabs persistidas.
  const autoOpenedForTabIdRef = useRef(null);
  useEffect(() => {
    if (tabsRestoring) return;
    if (tabs.length !== 1) return;
    const t = tabs[0];
    if (t.template || t.jobId) return;
    if (autoOpenedForTabIdRef.current === t.id) return;
    autoOpenedForTabIdRef.current = t.id;
    setNewTabModalOpen(true);
  }, [tabs, tabsRestoring]);

  // Sync inicial al arrancar: cuando termina de cargar las plantillas locales,
  // pulla el manifest remoto. Si trae cambios, refresca local y avisa con un
  // toast. Solo corre una vez, no entorpece nada si falla (red caida, etc).
  const syncedOnceRef = useRef(false);
  useEffect(() => {
    if (templatesLoading || syncedOnceRef.current) return;
    syncedOnceRef.current = true;
    runSyncWithToast({ silent: true });
    // Tambien pulleamos presets de hoja en silencio. No avisa nada si falla.
    syncPullPaperPresets().catch(() => {});
  }, [templatesLoading, syncPull, syncPullPaperPresets]);

  const handleShare = async (template) => {
    if (!template || sharing) return;
    setSharing(true);
    setToast(null);
    try {
      // Si la plantilla viene de un tab (id sintetico) pero esta backed por
      // una plantilla guardada (sourceTemplateId), primero pusheamos los
      // cambios locales del tab al store y despues compartimos esa version.
      let toShare = template;
      if (template.temporal && template.sourceTemplateId) {
        const {
          id: _ignoredId,
          temporal: _t,
          tabBacked: _tb,
          sourceTemplateId: _sti,
          ...rest
        } = template;
        toShare = await update({ ...rest, id: template.sourceTemplateId });
      }
      const r = await share(toShare);
      if (r?.ok) {
        // Reflejar sharedAt/sharedHash en el tab para que la UI muestre
        // "Compartida: Sí" y el boton diga "Subir cambios" sin reabrir.
        if (r.template) {
          updateActiveTab((tab) => {
            if (!tab.template) return {};
            if (tab.template.sourceTemplateId !== r.template.id
              && tab.template.id !== r.template.id) return {};
            return {
              template: {
                ...tab.template,
                sharedAt: r.template.sharedAt,
                sharedHash: r.template.sharedHash,
              },
            };
          });
        }
        setToast({
          kind: 'success',
          text: `Plantilla "${template.name}" compartida con el equipo.`,
        });
      } else {
        setToast({
          kind: 'error',
          text: `No se pudo compartir: ${r?.error || 'error desconocido'}`,
        });
      }
    } catch (err) {
      setToast({ kind: 'error', text: `Error al compartir: ${err.message}` });
    } finally {
      setSharing(false);
    }
  };

  // Blade offset para el plotter. Persiste en localStorage porque solo
  // cambia cuando se reemplaza fisicamente la cuchilla.
  const [bladeOffsetMm, setBladeOffsetMm] = useState(() => {
    const stored = parseFloat(localStorage.getItem('printlayout.bladeOffsetMm'));
    return Number.isFinite(stored) && stored > 0 ? stored : 0.25;
  });

  useEffect(() => {
    localStorage.setItem('printlayout.bladeOffsetMm', String(bladeOffsetMm));
  }, [bladeOffsetMm]);

  // Modal de margen (solo para editar margen de plantilla existente).
  const [marginPrompt, setMarginPrompt] = useState(null);
  // { templateId, defaultValue } al marcar una plancha como oficial: pide el id
  // de catálogo (ej. "polaroid").
  const [oficialPrompt, setOficialPrompt] = useState(null);
  // Modal de subida de PDF (margen + doble faz).
  const [pdfUpload, setPdfUpload] = useState(null);
  // Modal de grilla rapida (plantilla en memoria, sin PDF).
  const [gridModalOpen, setGridModalOpen] = useState(false);
  const [quantitiesOpen, setQuantitiesOpen] = useState(false);
  const [poseFrontBackOpen, setPoseFrontBackOpen] = useState(false);
  // Imagen abierta en el editor.
  const [editingImageId, setEditingImageId] = useState(null);
  // Imagen abierta en el modal de recorte manual.
  const [croppingImageId, setCroppingImageId] = useState(null);
  // Extraccion de imagenes desde PDF.
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [pdfExtract, setPdfExtract] = useState(null); // { fileName, tmpDir, images }
  // Auto-acomodar imagenes.
  const [autoPackFiles, setAutoPackFiles] = useState(null);
  // Acomodar por cantidad (N por hoja, maximo tamano).
  const [countPackFiles, setCountPackFiles] = useState(null);
  // Imagenes precargadas que se asignan a una plantilla recien creada.
  const [pendingAutoAssign, setPendingAutoAssign] = useState(null); // { templateId, images }

  // ---- Jobs / Tabs ----
  // currentJobId/Name/isDirty viven en la tab activa.
  const currentJobId = activeTab?.jobId ?? null;
  const currentJobName = activeTab?.name ?? null;
  const isDirty = activeTab?.isDirty ?? false;
  const [saveJobModal, setSaveJobModal] = useState(null); // null | { saveAs: bool }
  const [jobsListOpen, setJobsListOpen] = useState(false);
  // Modal "Nuevo trabajo" (hub central de creacion).
  const [newTabModalOpen, setNewTabModalOpen] = useState(false);
  // Estado a aplicar al layout cuando un nuevo template termine de montar
  // (cambio de tab o abrir job). Mismo patron que pendingAutoAssign.
  // Cola: varias tabs pueden estar esperando que se les vuelque el layout
  // (p.ej. un pedido multi-tamaño abre varias a la vez). Cada entrada se aplica
  // cuando su templateId pasa a ser el activo.
  const [pendingTabLoads, setPendingTabLoads] = useState([]);
  // Confirm modal para cerrar tab dirty.
  const [closeTabConfirm, setCloseTabConfirm] = useState(null); // { id, name }
  // Ignora el primer fire del mutationTick effect (el initial render).
  const lastMutationTickRef = useRef(layout.mutationTick);

  // Helper para abrir un raw template en la tab actual (si vacia) o en una nueva.
  // initialLayout = { images?, assignmentsFront?, assignmentsBack?, minPages? }
  // si viene, se aplica via pendingTabLoad despues del cambio de template.
  const openInTab = useCallback((rawTemplate, opts = {}) => {
    const { name, jobId = null, forceNew = false, initialLayout = null } = opts;
    const empty = !!activeTab && !activeTab.template && !activeTab.jobId;
    const reuse = !forceNew && empty;

    // Si el raw template viene con id "real" (no sintetico de tab/job), lo
    // guardamos como sourceTemplateId. Asi PropertiesSidebar puede ocultar
    // el boton "Guardar como plantilla" cuando ya esta en el store.
    const rawId = rawTemplate?.id;
    const sourceTemplateId = rawId
      && typeof rawId === 'string'
      && !rawId.startsWith('tabtpl_')
      && !rawId.startsWith('jobtpl_')
      ? rawId
      : undefined;

    const buildTpl = (tplId) => {
      if (!rawTemplate) return null;
      const t = { ...rawTemplate, id: tplId, temporal: true, tabBacked: true };
      if (sourceTemplateId) t.sourceTemplateId = sourceTemplateId;
      return t;
    };

    let tabId;
    let tplId;
    if (reuse) {
      tabId = activeTab.id;
      tplId = `tabtpl_${tabId}`;
      updateActiveTab({
        template: buildTpl(tplId),
        name: name ?? activeTab.name,
        jobId,
        isDirty: false,
        viewingFace: 'front',
        currentPage: 0,
        customPaper: null,
      });
    } else {
      tabId = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      tplId = `tabtpl_${tabId}`;
      createTab({
        id: tabId,
        template: buildTpl(tplId),
        name,
        jobId,
        isDirty: false,
      });
    }

    if (initialLayout) {
      const entry = {
        templateId: tplId,
        images: initialLayout.images || [],
        assignmentsFront: initialLayout.assignmentsFront || [],
        assignmentsBack: initialLayout.assignmentsBack || [],
        minPages: initialLayout.minPages ?? 1,
      };
      setPendingTabLoads((prev) => [
        ...prev.filter((p) => p.templateId !== tplId),
        entry,
      ]);
    }
    return tabId;
  }, [activeTab, updateActiveTab, createTab]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    setCurrentPage(0);
  }, [selected?.id]);

  useEffect(() => {
    if (currentPage >= layout.pageCount) {
      setCurrentPage(Math.max(0, layout.pageCount - 1));
    }
  }, [layout.pageCount, currentPage]);

  // Atajos de teclado: Delete/Backspace borra la celda seleccionada.
  // Guards reforzados: chequeamos closest() del target y tambien
  // document.activeElement, porque cuando un input controlado se vacia React
  // puede disparar eventos donde target es el input pero activeElement ya no,
  // o viceversa. Sin ambas guards, vaciar un input con Backspace podia derivar
  // en clearCell() y comportamientos raros con el foco.
  useEffect(() => {
    if (layout.selectedCell === null || !selected) return;
    const SELECTOR = 'input, textarea, select, [contenteditable="true"]';
    function onKey(e) {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest(SELECTOR)) return;
      const active = document.activeElement;
      if (active && typeof active.matches === 'function' && active.matches(SELECTOR)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        layout.clearCell(layout.selectedCell);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, selected]);

  // Atajos de jobs y tabs:
  //   Ctrl+S = guardar, Ctrl+Shift+S = guardar como, Ctrl+O = abrir lista
  //   Ctrl+T = nueva tab vacia, Ctrl+W = cerrar tab activa
  //   Ctrl+Tab = siguiente tab, Ctrl+Shift+Tab = anterior
  //   Ctrl+1..9 = ir al tab N (1-indexed)
  // Guard: no disparar si el usuario esta tipeando en un input.
  useEffect(() => {
    const SELECTOR = 'input, textarea, select, [contenteditable="true"]';
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const isTab = e.key === 'Tab';
      const isDigit = /^[1-9]$/.test(e.key);
      if (!isTab && !isDigit && key !== 's' && key !== 'o' && key !== 't' && key !== 'w') return;
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest(SELECTOR)) return;
      const active = document.activeElement;
      if (active && typeof active.matches === 'function' && active.matches(SELECTOR)) return;
      if (key === 's') {
        e.preventDefault();
        if (!selected) return;
        if (e.shiftKey) handleSaveJobAs();
        else handleSaveJobShortcut();
      } else if (key === 'o') {
        e.preventDefault();
        handleOpenJobsList();
      } else if (key === 't') {
        e.preventDefault();
        setNewTabModalOpen(true);
      } else if (key === 'w') {
        e.preventDefault();
        requestCloseTab(activeTabId);
      } else if (isTab) {
        e.preventDefault();
        const idx = tabs.findIndex((tt) => tt.id === activeTabId);
        if (idx < 0 || tabs.length < 2) return;
        const delta = e.shiftKey ? -1 : 1;
        const nextIdx = (idx + delta + tabs.length) % tabs.length;
        switchTab(tabs[nextIdx].id);
      } else if (isDigit) {
        e.preventDefault();
        const idx = Number(e.key) - 1;
        if (idx >= 0 && idx < tabs.length) switchTab(tabs[idx].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, currentJobId, currentJobName, isDirty, tabs, activeTabId, layout.images, layout.assignmentsFront, layout.assignmentsBack, layout.minPages]);

  // Atajos globales de undo/redo: Ctrl+Z deshace, Ctrl+Y rehace.
  // Mismas guards que el listener de Delete/Backspace: si el usuario esta
  // tipeando en un input, no interceptamos (asi el navegador hace su undo
  // nativo del texto).
  useEffect(() => {
    const SELECTOR = 'input, textarea, select, [contenteditable="true"]';
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest(SELECTOR)) return;
      const active = document.activeElement;
      if (active && typeof active.matches === 'function' && active.matches(SELECTOR)) return;
      e.preventDefault();
      if (key === 'z') layout.undo();
      else if (key === 'y') layout.redo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout]);

  const handleUploadPdf = (file) => {
    if (uploading) return;
    setPdfUpload({ file });
  };

  // Construye el payload de un job a partir del estado actual.
  const buildJobPayload = (name, existingId = null) => {
    if (!selected) return null;
    return {
      id: existingId || undefined,
      name,
      template: { ...selected },
      images: layout.images,
      assignmentsFront: layout.assignmentsFront,
      assignmentsBack: layout.assignmentsBack,
      minPages: layout.minPages,
    };
  };

  const persistJob = async (name, { reuseId }) => {
    const targetTabId = activeTabId;
    const payload = buildJobPayload(name, reuseId ? currentJobId : null);
    if (!payload) {
      setToast({ kind: 'error', text: 'No hay plantilla activa para guardar.' });
      return;
    }
    const r = await saveJobToDisk(payload);
    if (!r?.ok) {
      setToast({
        kind: 'error',
        text: `No se pudo guardar el trabajo: ${r?.error ?? 'error'}`,
      });
      return;
    }
    updateTab(targetTabId, {
      jobId: r.job.id,
      name: r.job.name,
      isDirty: false,
    });
    lastMutationTickRef.current = layout.mutationTick;
    setToast({
      kind: 'success',
      text: reuseId && currentJobId
        ? `Trabajo "${r.job.name}" actualizado.`
        : `Trabajo "${r.job.name}" guardado.`,
    });
  };

  // Reescribe el job en el path que ya tiene la tab (tras un Save As previo).
  const persistJobToPath = async (filePath, name) => {
    const targetTabId = activeTabId;
    const payload = buildJobPayload(name);
    if (!payload) {
      setToast({ kind: 'error', text: 'No hay plantilla activa para guardar.' });
      return;
    }
    const r = await window.printlayout.jobs.saveToPath(filePath, payload);
    if (!r?.ok) {
      setToast({
        kind: 'error',
        text: `No se pudo guardar: ${r?.error ?? 'error'}`,
      });
      return;
    }
    updateTab(targetTabId, { isDirty: false });
    lastMutationTickRef.current = layout.mutationTick;
    setToast({ kind: 'success', text: `Guardado en ${r.path}`, path: r.path });
  };

  // Abre el file picker y guarda al path elegido. Recibe defaultName para
  // pre-poblar el dialog. Si el usuario cancela, devuelve sin tocar nada.
  const persistJobAs = async (defaultName, { closeAfterId } = {}) => {
    const targetTabId = activeTabId;
    const payload = buildJobPayload(defaultName);
    if (!payload) {
      setToast({ kind: 'error', text: 'No hay plantilla activa para guardar.' });
      return;
    }
    const r = await window.printlayout.jobs.saveAs(payload, defaultName);
    if (r?.canceled) return;
    if (!r?.ok) {
      setToast({ kind: 'error', text: `No se pudo guardar: ${r?.error ?? 'error'}` });
      return;
    }
    // Nombre = basename del path sin extension.
    const baseName = r.path.replace(/^.*[\\/]/, '').replace(/\.(pljob|json)$/i, '');
    updateTab(targetTabId, {
      jobPath: r.path,
      jobId: null,
      name: baseName,
      isDirty: false,
    });
    lastMutationTickRef.current = layout.mutationTick;
    setToast({ kind: 'success', text: `Guardado en ${r.path}`, path: r.path });
    if (closeAfterId) closeTab(closeAfterId);
  };

  const handleSaveJobShortcut = () => {
    if (!selected) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab?.jobPath) {
      // Tab guardada con file picker: reescribir en el mismo path.
      persistJobToPath(tab.jobPath, tab.name || 'Sin titulo');
    } else if (currentJobId) {
      // Legacy: tab guardada en userData/jobs/ — reusar id.
      persistJob(currentJobName || 'Sin titulo', { reuseId: true });
    } else {
      // Primera vez: abrir file picker.
      persistJobAs(currentJobName || 'Sin titulo');
    }
  };

  const handleSaveJobAs = () => {
    if (!selected) return;
    persistJobAs(currentJobName || 'Sin titulo');
  };

  const submitSaveJob = async ({ name }) => {
    const isSaveAs = saveJobModal?.saveAs;
    const closeAfterId = saveJobModal?.closeAfterId;
    setSaveJobModal(null);
    // Save As: siempre crea nuevo (no reusa id). "Guardar" comun reusa si hay.
    await persistJob(name, { reuseId: !isSaveAs });
    if (closeAfterId) closeTab(closeAfterId);
  };

  const performOpenJob = async (jobId) => {
    setJobsListOpen(false);
    const job = await loadJobFromDisk(jobId);
    if (!job) {
      setToast({ kind: 'error', text: 'No se pudo leer el trabajo.' });
      return;
    }
    if (!job.template) {
      setToast({ kind: 'error', text: 'El trabajo no tiene plantilla.' });
      return;
    }
    // Abrir el job en una tab. forceNew=true para no pisar la tab actual
    // si el usuario ya esta trabajando — cada job vive en su propia tab.
    openInTab(job.template, {
      name: job.name,
      jobId: job.id,
      forceNew: true,
      initialLayout: {
        images: job.images || [],
        assignmentsFront: job.assignmentsFront || [],
        assignmentsBack: job.assignmentsBack || [],
        minPages: job.minPages ?? 1,
      },
    });
  };

  const handleOpenJob = (jobId) => {
    // Cada abrir = tab nueva. No hace falta confirmar dirty (no pisamos nada).
    performOpenJob(jobId);
  };

  // Abre un .pljob desde el filesystem via showOpenDialog. La tab resultante
  // tiene jobPath seteado, asi Ctrl+S sobreescribe el mismo archivo.
  const handleOpenJobFromFile = async () => {
    const r = await window.printlayout.jobs.openFromFile();
    if (r?.canceled) return;
    if (!r?.ok || !r.job) {
      setToast({ kind: 'error', text: `No se pudo abrir: ${r?.error ?? 'archivo invalido'}` });
      return;
    }
    const job = r.job;
    if (!job.template) {
      setToast({ kind: 'error', text: 'El archivo no es un trabajo valido.' });
      return;
    }
    const baseName = r.path.replace(/^.*[\\/]/, '').replace(/\.(pljob|json)$/i, '');
    openInTab(job.template, {
      name: job.name || baseName,
      forceNew: true,
      initialLayout: {
        images: job.images || [],
        assignmentsFront: job.assignmentsFront || [],
        assignmentsBack: job.assignmentsBack || [],
        minPages: job.minPages ?? 1,
      },
    });
    // Como openInTab no acepta jobPath en su API actual, lo asignamos al
    // ultimo tab agregado en el siguiente tick. activeTabId apunta al tab
    // recien creado tras updateActiveTab/createTab.
    setTimeout(() => {
      updateActiveTab({ jobPath: r.path, isDirty: false });
    }, 0);
  };

  const handleDeleteJob = async (jobId) => {
    const r = await removeJobFromDisk(jobId);
    if (r?.ok) {
      setToast({ kind: 'success', text: 'Trabajo eliminado.' });
      // Si alguna tab apuntaba a este job, le sacamos el jobId (queda como
      // "Sin titulo" pero conserva el state — el usuario puede re-guardar).
      tabs.forEach((t) => {
        if (t.jobId === jobId) updateTab(t.id, { jobId: null });
      });
    }
  };

  // "Abrir trabajo" ahora abre file picker por default — el modelo del
  // negocio es file-based (un .pljob por cliente / trabajo). La lista
  // interna en userData/jobs/ solo sirve para jobs legacy guardados con
  // el modelo viejo; queda accesible como fallback si el usuario lo
  // necesita (Ctrl+Shift+O).
  const handleOpenJobsList = () => handleOpenJobFromFile();

  // Pide cerrar una tab. Si esta dirty, abre ConfirmModal con opciones
  // Guardar / Descartar / Cancelar. Si no, cierra directo.
  const requestCloseTab = useCallback((id) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.isDirty) {
      setCloseTabConfirm({ id, name: tab.name || 'Sin titulo' });
    } else {
      closeTab(id);
    }
  }, [tabs, closeTab]);

  const handleCloseTabConfirm = async (action) => {
    const ctx = closeTabConfirm;
    setCloseTabConfirm(null);
    if (!ctx) return;
    if (action === 'discard') {
      closeTab(ctx.id);
    } else if (action === 'save') {
      // Switchear a la tab (si no es la activa) para que save use su contexto.
      if (ctx.id !== activeTabId) switchTab(ctx.id);
      const tab = tabs.find((t) => t.id === ctx.id);
      if (!tab) return;
      if (tab.jobPath) {
        await persistJobToPath(tab.jobPath, tab.name || 'Sin titulo');
        closeTab(ctx.id);
      } else if (tab.jobId) {
        await persistJob(tab.name || 'Sin titulo', { reuseId: true });
        closeTab(ctx.id);
      } else {
        // Sin path ni id legacy: file picker, cerrar despues.
        persistJobAs(tab.name || 'Sin titulo', { closeAfterId: ctx.id });
      }
    }
  };

  const handleEditMargin = () => {
    if (!selected) return;
    setMarginPrompt({ defaultValue: String(selected.markMarginMm ?? 10) });
  };

  // Aplica updates parciales a la plantilla de la tab activa (siempre es una
  // copia self-contained con id sintetico). Regenera cortes en base a
  // cutMarginMm + markMarginMm + cutShape. Si markMarginMm <= 0 sin cortes.
  const handleUpdateTemporalTemplate = (updates) => {
    if (!activeTab?.template) return;
    updateActiveTab((tab) => {
      const next = { ...tab.template, ...updates };
      const cutM = next.cutMarginMm ?? 0;
      const markM = next.markMarginMm ?? 0;
      const shape = next.cutShape ?? 'rect';
      next.cortes = markM > 0
        ? generateCuts(next.celdas ?? [], { cutShape: shape, cutMarginMm: cutM })
        : [];
      return { template: next };
    });
  };

  // Renombrar el template = renombrar localmente la copia de la tab. No toca
  // la plantilla original guardada (que vive en templatesStore con su id
  // real). Para renombrar la guardada, hay que editarla desde el sidebar.
  const handleRenameTemplate = (template, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed === template.name) return;
    updateActiveTab((tab) => ({
      template: tab.template ? { ...tab.template, name: trimmed } : tab.template,
    }));
  };

  // Categoria de tab no aplica (es metadata de la lista de plantillas, no del
  // documento en curso). No hacemos nada.
  const handleSetCategoria = () => {};

  // Convierte el template del tab activo en plantilla permanente del store.
  // Si la tab ya esta backed por un template del store (sourceTemplateId),
  // updateamos ese. Sino, se crea uno nuevo (id generado por save).
  // El tab sigue con su id sintetico, pero apuntando al store via
  // sourceTemplateId, asi aparece el boton Compartir.
  const submitSaveTemplate = async ({ name, categoria }) => {
    const tpl = saveTemplatePrompt;
    setSaveTemplatePrompt(null);
    if (!tpl) return;
    // No sobreescribir una plancha oficial desde otra PC.
    if (tpl.sourceTemplateId && isTemplateOfficial(tpl.sourceTemplateId) && !isLaRecta) {
      setToast({ kind: 'error', text: 'Es una plancha oficial: solo La Recta puede editarla.' });
      return;
    }
    try {
      const {
        id: _ignoredId,
        temporal: _t,
        tabBacked: _tb,
        sourceTemplateId: _sti,
        ...rest
      } = tpl;
      const saved = await update({
        ...rest,
        ...(tpl.sourceTemplateId ? { id: tpl.sourceTemplateId } : {}),
        name,
        categoria: categoria || undefined,
      });
      // Apuntar la tab al template guardado para que aparezca "Compartir".
      updateActiveTab((tab) => {
        if (!tab.template) return {};
        return {
          template: {
            ...tab.template,
            sourceTemplateId: saved.id,
            name: saved.name,
            categoria: saved.categoria,
            sharedAt: saved.sharedAt,
            sharedHash: saved.sharedHash,
          },
        };
      });
      setToast({ kind: 'success', text: `Plantilla "${saved.name}" guardada en la lista.` });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `No se pudo guardar: ${err.message}` });
    }
  };

  const handleCreateGrid = ({
    paperWidthMm,
    paperHeightMm,
    cells,
    cutMarginMm = 0,
    markMarginMm = 0,
    cutShape = 'rect',
    doubleSided = false,
  }) => {
    // Solo generamos cortes si va a poder usarlos (necesita marcas L para
    // que el plotter alinee). Con markMarginMm=0 la grilla es sin corte.
    const cortes = markMarginMm > 0
      ? generateCuts(cells, { cutShape, cutMarginMm })
      : [];
    // Doble faz: NO horneamos las celdas del dorso. Se derivan al vuelo desde
    // `celdas` espejando segun backMirror (cellPositions/mirrorCellsForBack).
    // Posicion (backMirror) y rotacion (backRotate180) son INDEPENDIENTES y se
    // ajustan con dos toggles en la UI. Default: espejo arriba-abajo, sin rotar.
    const tpl = {
      name: doubleSided ? 'Grilla rápida doble faz' : 'Grilla rápida',
      pdfBase64: null,
      pageWidthMm: paperWidthMm,
      pageHeightMm: paperHeightMm,
      pageCount: 1,
      celdas: cells,
      celdasDorso: [],
      cortes,
      cutMarginMm,
      markMarginMm,
      cutShape,
      doubleSided,
      backMirror: doubleSided ? 'y' : undefined,
      backRotate180: doubleSided ? false : undefined,
      singlePage: true,
    };
    openInTab(tpl, { name: tpl.name, forceNew: true });
    setGridModalOpen(false);
  };

  const submitPdfUpload = async ({ margin: rawMargin, doubleSided, name, categoria }) => {
    const file = pdfUpload?.file;
    setPdfUpload(null);
    if (!file) return;
    const margin = parseFloat(String(rawMargin ?? '').replace(',', '.'));
    if (!Number.isFinite(margin) || margin < 0 || margin > 50) {
      setToast({ kind: 'error', text: 'Margen inválido. Tiene que ser entre 0 y 50 mm.' });
      return;
    }
    setUploading(true);
    setToast(null);
    try {
      const saved = await createFromPdf(file, {
        markMarginMm: margin,
        doubleSided,
        name,
        categoria,
      });
      // Abrimos la plantilla recien creada en tab nueva (forceNew=true para
      // no pisar el trabajo en curso).
      openInTab(saved, { name: saved.name, forceNew: true });
      setToast({
        kind: 'success',
        text: `Plantilla "${saved.name}" lista. ${saved.celdas.length} celda${
          saved.celdas.length === 1 ? '' : 's'
        }${saved.cortes?.length ? `, ${saved.cortes.length} polilíneas de corte` : ''}${
          doubleSided ? ' · doble faz' : ''
        }.`,
      });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `No se pudo cargar el PDF: ${err.message}` });
    } finally {
      setUploading(false);
    }
  };

  // Rasteriza un PDF a 300dpi y devuelve entries con el shape que espera
  // PdfImageExtractModal (mismas claves que extract_pdf_images, con dataUrl
  // en vez de path). Lo usan dos flujos: fallback automatico cuando no hay
  // imagenes embebidas (PDF "a curvas") y el boton "Usar paginas enteras"
  // cuando las imagenes embebidas son tiles que no representan lo que se ve.
  const rasterizeBytesToImageEntries = async (bytes) => {
    const pages = await rasterizePdfPages(new Uint8Array(bytes), 300);
    if (!pages || pages.length === 0) return null;
    return pages.map((p) => {
      const base64 = p.dataUrl.slice(p.dataUrl.indexOf(',') + 1);
      return {
        xref: `page_${p.pageIndex}`,
        ext: 'png',
        width: p.widthPx,
        height: p.heightPx,
        dataUrl: p.dataUrl,
        thumbBase64: base64,
        placements: 1,
        sizeBytes: 0,
        placementMm: { w: p.widthMm, h: p.heightMm },
        pageIndex: p.pageIndex,
      };
    });
  };

  const handleImportPdfImages = async (file) => {
    if (!file || extractingPdf) return;
    setExtractingPdf(true);
    setToast(null);
    try {
      const bytes = await file.arrayBuffer();
      const result = await window.printlayout.pdf.extractImages(bytes);
      if (!result?.ok) {
        setToast({
          kind: 'error',
          text: `No se pudo procesar el PDF: ${result?.error ?? 'error desconocido'}`,
        });
        return;
      }
      if (result.images && result.images.length > 0) {
        // Guardamos bytes en el ctx para poder ofrecer "Usar paginas enteras"
        // sin pedir el archivo de nuevo si las imagenes embebidas no sirven.
        setPdfExtract({
          fileName: file.name,
          tmpDir: result.tmpDir,
          images: result.images,
          mode: 'embedded',
          pdfBytes: bytes,
        });
        return;
      }
      // No hay imagenes embebidas: probable PDF "a curvas" (vectorial puro).
      // Fallback: rasterizar cada pagina a 300dpi y ofrecerlas como imagenes.
      if (result.tmpDir) {
        try { await window.printlayout.pdf.cleanupExtracted(result.tmpDir); } catch {}
      }
      let images;
      try {
        images = await rasterizeBytesToImageEntries(bytes);
      } catch (err) {
        console.error(err);
        setToast({
          kind: 'error',
          text: `No se pudo rasterizar el PDF: ${err.message}`,
        });
        return;
      }
      if (!images) {
        setToast({
          kind: 'error',
          text: 'El PDF no tiene páginas legibles.',
        });
        return;
      }
      setPdfExtract({
        fileName: file.name,
        tmpDir: null,
        images,
        mode: 'rasterized',
        pdfBytes: bytes,
      });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `Error extrayendo imágenes: ${err.message}` });
    } finally {
      setExtractingPdf(false);
    }
  };

  // Si las imagenes embebidas no sirven (PDF con capas/overlay/fondo), el
  // usuario aprieta "Usar paginas enteras" en el modal y reabrimos en modo
  // rasterizado usando los bytes ya cargados.
  const handleSwitchToRasterized = async () => {
    const ctx = pdfExtract;
    if (!ctx?.pdfBytes || extractingPdf) return;
    setExtractingPdf(true);
    try {
      const images = await rasterizeBytesToImageEntries(ctx.pdfBytes);
      if (!images) {
        setToast({ kind: 'error', text: 'El PDF no tiene páginas legibles.' });
        return;
      }
      if (ctx.tmpDir) {
        try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
      }
      setPdfExtract({
        fileName: ctx.fileName,
        tmpDir: null,
        images,
        mode: 'rasterized',
        pdfBytes: ctx.pdfBytes,
      });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `No se pudo rasterizar: ${err.message}` });
    } finally {
      setExtractingPdf(false);
    }
  };

  const submitPdfExtract = async (chosen) => {
    const ctx = pdfExtract;
    setPdfExtract(null);
    if (!ctx || !chosen?.length) {
      if (ctx?.tmpDir) {
        try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
      }
      return;
    }
    try {
      // Cada entry: { file, placementMm }. placementMm prevalece sobre el DPI
      // del archivo embebido (el DPI casi nunca refleja el uso real en el PDF).
      // Si img.dataUrl existe (paginas rasterizadas de PDF a curvas), se usa
      // directo en vez de leer del tmpDir; si no, se lee el archivo extraido.
      const filesWithMeta = [];
      let counter = 1;
      for (const img of chosen) {
        let bytes;
        if (img.dataUrl) {
          const base64 = img.dataUrl.slice(img.dataUrl.indexOf(',') + 1);
          const bin = atob(base64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else {
          const r = await window.printlayout.pdf.readExtractedImage(img.path);
          if (!r?.ok || !r.bytes) continue;
          bytes = r.bytes;
        }
        const mime = img.ext === 'png' ? 'image/png' : 'image/jpeg';
        const copies = Math.max(1, img.copies || 1);
        for (let i = 0; i < copies; i++) {
          const suffix = copies > 1 ? ` (${i + 1})` : '';
          const baseName = (ctx.fileName || 'pdf').replace(/\.pdf$/i, '');
          // Para paginas rasterizadas: nombrar por pagina (mas legible).
          const label = img.pageIndex
            ? `pag ${img.pageIndex}`
            : `${counter}`;
          const fileName = `${baseName} - ${label}${suffix}.${img.ext === 'png' ? 'png' : 'jpg'}`;
          filesWithMeta.push({
            file: new File([bytes], fileName, { type: mime }),
            placementMm: img.placementMm ?? null,
          });
        }
        counter++;
      }
      if (filesWithMeta.length === 0) {
        setToast({ kind: 'error', text: 'No se pudo leer ninguna imagen extraída.' });
        return;
      }
      const loaded = [];
      for (const item of filesWithMeta) {
        try {
          const img = await readImageFile(item.file, {
            physicalSizeMmOverride: item.placementMm,
          });
          loaded.push(img);
        } catch (err) {
          console.warn('No se pudo cargar imagen extraida:', err);
        }
      }
      if (loaded.length === 0) {
        setToast({ kind: 'error', text: 'Las imágenes extraídas no se pudieron cargar.' });
        return;
      }
      await handleAddImages(loaded);
      setToast({
        kind: 'success',
        text: `${loaded.length} imagen${loaded.length === 1 ? '' : 'es'} importada${loaded.length === 1 ? '' : 's'} desde el PDF.`,
      });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `Error importando: ${err.message}` });
    } finally {
      if (ctx?.tmpDir) {
        try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
      }
    }
  };

  // Convierte HEIC/HEIF a JPEG antes de abrir el modal de pack, asi las vistas
  // previas y el calculo de dimensiones (que usan <img>) funcionan.
  const convertHeicWithToast = async (files) => {
    return prepareIncomingImageFiles(files, {
      onHeicStart: (n) => setToast({
        kind: 'info',
        text: `Convirtiendo ${n} foto${n === 1 ? '' : 's'} de iPhone (HEIC)…`,
      }),
    });
  };

  const handleStartAutoPack = async (files) => {
    if (!files?.length) return;
    const prepared = await convertHeicWithToast(files);
    if (prepared.length) setAutoPackFiles(prepared);
  };

  const handleStartCountPack = async (files) => {
    if (!files?.length) return;
    const prepared = await convertHeicWithToast(files);
    if (prepared.length) setCountPackFiles(prepared);
  };

  const submitCountPack = async ({
    paperWidthMm, paperHeightMm, pages, files, cellMapping,
    totalCells, uniqueUsed, totalInput, pageCount, countPerPage,
  }) => {
    setCountPackFiles(null);
    if (!files?.length) return;
    try {
      const loaded = await readImageFiles(files);
      if (loaded.length === 0) {
        setToast({ kind: 'error', text: 'No se pudieron leer las imágenes.' });
        return;
      }
      const name = pageCount > 1
        ? `Por cantidad (${countPerPage}/hoja · ${pageCount} hojas)`
        : `Por cantidad (${countPerPage} en hoja)`;
      const tpl = {
        name,
        pdfBase64: null,
        pageWidthMm: paperWidthMm,
        pageHeightMm: paperHeightMm,
        pageCount,
        celdas: pages[0]?.celdas ?? [],
        pages,
        celdasDorso: [],
        cortes: [],
        markMarginMm: 0,
        doubleSided: false,
        singlePage: true,
      };
      const tabId = openInTab(tpl, { name, forceNew: true });
      setPendingAutoAssign({
        templateId: `tabtpl_${tabId}`,
        images: loaded,
        cellMapping,
      });
      setToast({
        kind: 'success',
        text: pageCount > 1
          ? `Plantilla creada: ${uniqueUsed} imágenes en ${pageCount} hojas (${countPerPage} por hoja).`
          : `Plantilla creada: ${countPerPage} celdas, ${uniqueUsed} imagen${uniqueUsed === 1 ? '' : 'es'}.`,
      });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `Error en acomodar por cantidad: ${err.message}` });
    }
  };

  const submitAutoPack = async ({
    paperWidthMm, paperHeightMm, pages, files, cellMapping,
    totalCells, uniqueUsed, totalInput, repeated, pageCount,
  }) => {
    setAutoPackFiles(null);
    if (!files?.length) return;
    try {
      const loaded = await readImageFiles(files);
      if (loaded.length === 0) {
        setToast({ kind: 'error', text: 'No se pudieron leer las imágenes.' });
        return;
      }
      const name = repeated
        ? `Auto-acomodar (${totalCells} celdas, ${loaded.length} imgs)`
        : pageCount > 1
          ? `Auto-acomodar (${loaded.length} imgs · ${pageCount} hojas)`
          : `Auto-acomodar (${loaded.length})`;
      const tpl = {
        name,
        pdfBase64: null,
        pageWidthMm: paperWidthMm,
        pageHeightMm: paperHeightMm,
        pageCount,
        // Modelo multi-page: cada hoja tiene sus propias celdas. celdas legacy
        // queda como las de la primera hoja (para compatibilidad de helpers
        // que aun lo usan, como templateOrientation).
        celdas: pages[0]?.celdas ?? [],
        pages,
        celdasDorso: [],
        cortes: [],
        markMarginMm: 0,
        doubleSided: false,
        singlePage: true,
      };
      const tabId = openInTab(tpl, { name, forceNew: true });
      setPendingAutoAssign({
        templateId: `tabtpl_${tabId}`,
        images: loaded,
        cellMapping,
      });
      if (repeated) {
        setToast({
          kind: 'success',
          text: `Plantilla creada: ${totalCells} celdas repitiendo ${uniqueUsed} imagen${uniqueUsed === 1 ? '' : 'es'}.`,
        });
      } else if (uniqueUsed < totalInput) {
        setToast({
          kind: 'success',
          text: `Plantilla creada: ${uniqueUsed} de ${totalInput} imágenes en ${pageCount} hoja${pageCount === 1 ? '' : 's'} (${totalInput - uniqueUsed} no entraron).`,
        });
      } else {
        setToast({
          kind: 'success',
          text: `Plantilla creada: ${uniqueUsed} imágenes en ${pageCount} hoja${pageCount === 1 ? '' : 's'}.`,
        });
      }
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `Error en auto-acomodar: ${err.message}` });
    }
  };

  // Cuando la plantilla recien creada por auto-pack queda activa y el layout
  // hook ya tiene las celdas listas, asignamos las imagenes preloaded segun
  // el cellMapping (que puede repetir indices cuando es modo "repetir").
  useEffect(() => {
    if (!pendingAutoAssign) return;
    if (selected?.id !== pendingAutoAssign.templateId) return;
    if (layout.totalCellsCount === 0) return;
    layout.loadImagesWithMapping(pendingAutoAssign.images, pendingAutoAssign.cellMapping);
    setPendingAutoAssign(null);
  }, [pendingAutoAssign, selected?.id, layout.totalCellsCount, layout.loadImagesWithMapping]);

  // Tras adoptar un template en una tab (abrir job, switchear tab con state
  // viejo, crear nueva tab con preset): esperamos a que el cambio de plantilla
  // este aplicado (selected.id matchea el templateId esperado) y volcamos
  // images + assignments al layout via loadFromJob. loadFromJob marca
  // skipNextSnapshot asi NO marca dirty.
  useEffect(() => {
    if (pendingTabLoads.length === 0) return;
    const entry = pendingTabLoads.find((p) => p.templateId === selected?.id);
    if (!entry) return;
    layout.loadFromJob(entry);
    lastMutationTickRef.current = layout.mutationTick;
    updateActiveTab({ isDirty: false });
    setPendingTabLoads((prev) => prev.filter((p) => p.templateId !== entry.templateId));
  }, [pendingTabLoads, selected?.id, layout, updateActiveTab]);

  // Entrada automática: el main avisa que bajó un pedido de fotos. Armamos UNA
  // hoja por tamaño (reusando readAnyFileToImage + grilla/preset) y la dejamos
  // ABIERTA para que Mariano revise. Nunca imprime/corta solo. Al terminar le
  // confirmamos al main para que marque procesado + limpie el bucket.
  const handleIntakeOrder = useCallback(async (order) => {
    const label = `P-${order?.numero_presupuesto || order?.id}`;
    try {
      setToast({ kind: 'info', text: `Procesando pedido de fotos ${label}…` });
      const { specs, skipped } = await buildOrderJobs(order, {
        templates,
        readFileBytes: (p) => window.printlayout.intake.readFile(p),
      });
      let opened = 0;
      for (const spec of specs) {
        let jobId = null;
        try {
          const r = await saveJobToDisk({
            name: spec.name,
            template: spec.template,
            images: spec.images,
            assignmentsFront: spec.assignmentsFront,
            assignmentsBack: spec.assignmentsBack,
            minPages: spec.minPages,
          });
          if (r?.ok && r.job) jobId = r.job.id;
        } catch (_) {
          /* si falla guardar, igual abrimos la tab para revisar */
        }
        openInTab(spec.template, {
          name: spec.name,
          jobId,
          forceNew: true,
          initialLayout: {
            images: spec.images,
            assignmentsFront: spec.assignmentsFront,
            assignmentsBack: spec.assignmentsBack,
            minPages: spec.minPages,
          },
        });
        opened += 1;
      }

      const ok = opened > 0;
      await window.printlayout.intake.orderBuilt({
        id: order.id,
        ok,
        error: ok ? undefined : (skipped.map((s) => `${s.label}: ${s.reason}`).join('; ') || 'nada para armar'),
      });

      if (ok) {
        try {
          // eslint-disable-next-line no-new
          new Notification('Llegó un pedido de fotos', {
            body: `${label}: ${opened} hoja(s) lista(s) para revisar.`,
          });
        } catch (_) { /* sin permiso de notificaciones: el toast alcanza */ }
        setToast({
          kind: 'success',
          text: `${label}: ${opened} hoja(s) abiertas para revisar${skipped.length ? ` · ${skipped.length} tamaño(s) saltado(s)` : ''}.`,
        });
      } else {
        setToast({
          kind: 'error',
          text: `${label}: no se pudo armar (${skipped.map((s) => s.reason).join('; ') || 'sin tamaños válidos'}).`,
        });
      }
    } catch (err) {
      console.error('[intake] armado falló:', err);
      try {
        await window.printlayout.intake.orderBuilt({ id: order.id, ok: false, error: err.message });
      } catch (_) { /* ignore */ }
      setToast({ kind: 'error', text: `Error armando el pedido ${label}: ${err.message}` });
    }
  }, [templates, openInTab, saveJobToDisk]);

  useEffect(() => {
    const api = window.printlayout?.intake;
    if (!api?.onOrderReady) return undefined;
    return api.onOrderReady((order) => { handleIntakeOrder(order); });
  }, [handleIntakeOrder]);

  // Estado del modo La Recta + atajo OCULTO para la configuración inicial (en
  // las demás PCs el botón "Pedidos" no se muestra). Ctrl+Shift+L abre el panel.
  useEffect(() => {
    refreshLaRecta();
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setIntakePanelOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refreshLaRecta]);

  // Marca dirty en la tab activa cuando hay una accion real del usuario.
  // mutationTick incrementa SOLO con acciones (no en restore por switch de
  // tab, no en undo/redo, no en loadFromJob). Asi switchear entre tabs no
  // ensucia nada.
  useEffect(() => {
    if (layout.mutationTick === lastMutationTickRef.current) return;
    lastMutationTickRef.current = layout.mutationTick;
    updateActiveTab({ isDirty: true });
  }, [layout.mutationTick, updateActiveTab]);

  const cancelPdfExtract = async () => {
    const ctx = pdfExtract;
    setPdfExtract(null);
    if (ctx?.tmpDir) {
      try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
    }
  };

  const submitMarginPrompt = async (raw) => {
    setMarginPrompt(null);
    const margin = parseFloat(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(margin) || margin < 0 || margin > 50) {
      setToast({ kind: 'error', text: 'Margen inválido. Tiene que ser entre 0 y 50 mm.' });
      return;
    }
    if (!selected) return;
    try {
      await update({ ...selected, markMarginMm: margin });
      setToast({ kind: 'success', text: `Margen actualizado a ${margin} mm.` });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo actualizar: ${err.message}` });
    }
  };

  // Una plancha "oficial" (alimenta la web/CRM) es solo-lectura salvo en modo
  // La Recta: no se puede borrar ni sobreescribir desde otras PCs.
  const isTemplateOfficial = (id) => !!templates.find((t) => t.id === id)?.oficial;

  const handleDelete = async (id) => {
    if (isTemplateOfficial(id) && !isLaRecta) {
      setToast({ kind: 'error', text: 'Es una plancha oficial: solo La Recta puede borrarla.' });
      return;
    }
    // Borra la plantilla del sidebar (lista permanente). Si alguna tab
    // adopto una copia derivada, sigue funcionando: el template de la tab
    // es self-contained.
    await remove(id);
  };

  // Marca/desmarca una plancha como oficial (solo modo La Recta). Opera sobre
  // la plantilla GUARDADA (id real). MARCAR pide el id de catálogo (lo confirma
  // Mariano); QUITAR es baja lógica en el catálogo (activo=false, no borra).
  const handleToggleOficial = async (tpl) => {
    if (!isLaRecta) return;
    const stored = templates.find((t) => t.id === tpl.id);
    if (!stored) return;
    if (!stored.oficial) {
      // Pedir el id de catálogo (ej. "polaroid").
      setOficialPrompt({
        templateId: stored.id,
        defaultValue: stored.catalogoId || slugifyCatalogId(stored.name),
      });
      return;
    }
    // Quitar de oficial → baja lógica (activo=false). Mantenemos catalogoId.
    try {
      const updated = await update({ ...stored, oficial: false });
      let msg = '';
      if (updated.catalogoId) {
        const r = await window.printlayout.intake.publishCatalog([catalogRowForTemplate(updated, false)]);
        msg = r?.ok ? ' Marcada inactiva en el catálogo.' : ` (catálogo: ${r?.error || 'no actualizado'})`;
      }
      setToast({ kind: 'success', text: `"${updated.name}" ya no es oficial.${msg}` });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo cambiar: ${err.message}` });
    }
  };

  // Confirma el id de catálogo y marca la plancha como oficial + la publica.
  const submitOficialPrompt = async (rawId) => {
    const ctx = oficialPrompt;
    setOficialPrompt(null);
    if (!ctx?.templateId) return;
    const stored = templates.find((t) => t.id === ctx.templateId);
    if (!stored) return;
    const catalogoId = String(rawId || '').trim();
    if (!catalogoId) {
      setToast({ kind: 'error', text: 'El id de catálogo no puede estar vacío.' });
      return;
    }
    // No permitir que dos planchas usen el mismo id de catálogo.
    const clash = templates.find((t) => t.id !== stored.id && t.catalogoId === catalogoId);
    if (clash) {
      setToast({ kind: 'error', text: `El id "${catalogoId}" ya lo usa "${clash.name}". Elegí otro.` });
      return;
    }
    try {
      const updated = await update({ ...stored, oficial: true, catalogoId });
      const r = await window.printlayout.intake.publishCatalog([catalogRowForTemplate(updated, true)]);
      const msg = r?.ok ? ' Publicada al catálogo.' : ` (catálogo: ${r?.error || 'no publicada'})`;
      setToast({ kind: 'success', text: `"${updated.name}" es oficial — id catálogo: ${catalogoId}.${msg}` });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo marcar oficial: ${err.message}` });
    }
  };

  // Publica TODO el catálogo de planchas oficiales + el criterio del "A medida"
  // a config_fotos (botón "Publicar catálogo" del panel). Para poblar de una.
  const handlePublishCatalog = useCallback(async () => {
    const r = await window.printlayout.intake.publishCatalog(buildCatalogRows(templates));
    await window.printlayout.intake.publishConfig(CRITERIO_CUSTOM_KEY, buildCriterioCustomValue());
    return r;
  }, [templates]);

  // Click en plantilla del sidebar: adopt en la tab actual si esta vacia,
  // sino crea tab nueva con esa plantilla.
  const handleSelectTemplate = (tplId) => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    openInTab(tpl, { name: tpl.name });
  };

  const handleCellClick = (cellIdx) => {
    if (cellIdx === null) {
      layout.setSelectedCell(null);
      return;
    }
    const hasImage = layout.assignments[cellIdx] !== null;
    if (hasImage) {
      layout.setSelectedCell(cellIdx);
    } else {
      pendingCellRef.current = cellIdx;
      cellPickerRef.current?.click();
    }
  };

  const handleCellPickerChange = async (e) => {
    const files = e.target.files;
    if (files && files.length > 0 && pendingCellRef.current !== null) {
      const loaded = await readImageFiles(files);
      if (loaded.length > 0) {
        layout.addImageToCell(pendingCellRef.current, loaded[0]);
        layout.setSelectedCell(pendingCellRef.current);
      }
    }
    pendingCellRef.current = null;
    e.target.value = '';
  };

  const handleDragStart = (event) => {
    setActiveDrag(event.active.data.current);
  };

  const handleDragEnd = (event) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const src = active.data.current;
    const dst = over.data.current;
    if (!src || !dst || dst.target !== 'cell') return;

    if (src.source === 'sidebar') {
      layout.assignImageToCell(dst.cellIdx, src.imageId);
      layout.setSelectedCell(dst.cellIdx);
    } else if (src.source === 'cell') {
      if (src.cellIdx === dst.cellIdx) return;
      layout.swapCells(src.cellIdx, dst.cellIdx);
      layout.setSelectedCell(dst.cellIdx);
    }
  };

  const handleDragCancel = () => setActiveDrag(null);

  // Al cargar imagenes, si la plantilla tiene una orientacion clara
  // (vertical/horizontal) y la imagen viene en la opuesta, la rotamos 90 CW
  // para que entre directo. Casos comunes: photos horizontales en plantilla
  // Polaroid (vertical), o photos verticales en tarjetas horizontales.
  const handleAddImages = async (loadedImages) => {
    if (!selected) {
      layout.addImages(loadedImages);
      return;
    }
    const target = templateOrientation(selected);
    if (target === 'square' || target === null) {
      layout.addImages(loadedImages);
      return;
    }
    const processed = [];
    let rotatedCount = 0;
    for (const img of loadedImages) {
      const imgOr = imageOrientation(img);
      if (imgOr !== 'square' && imgOr !== target) {
        try {
          const r = await rotateImageDataUrl90CW(img.dataUrl);
          processed.push({
            ...img,
            dataUrl: r.dataUrl,
            width: r.width,
            height: r.height,
            faces: rotateFaces90CW(img.faces, img.width, img.height),
            physicalSizeMm: img.physicalSizeMm
              ? { w: img.physicalSizeMm.h, h: img.physicalSizeMm.w }
              : null,
          });
          rotatedCount++;
        } catch (err) {
          console.warn('Auto-rotate fallo, dejo la imagen como esta:', err);
          processed.push(img);
        }
      } else {
        processed.push(img);
      }
    }
    layout.addImages(processed);
    if (rotatedCount > 0) {
      setToast({
        kind: 'success',
        text: `${rotatedCount} imagen${rotatedCount === 1 ? '' : 'es'} rotada${rotatedCount === 1 ? '' : 's'} para coincidir con la plantilla.`,
      });
    }
  };

  const handleRotate = async (imageId) => {
    const img = layout.imageMap.get(imageId);
    if (!img) return;
    try {
      const rotated = await rotateImageDataUrl90CW(img.dataUrl);
      layout.updateImage(imageId, {
        dataUrl: rotated.dataUrl,
        width: rotated.width,
        height: rotated.height,
        faces: rotateFaces90CW(img.faces, img.width, img.height),
        physicalSizeMm: img.physicalSizeMm
          ? { w: img.physicalSizeMm.h, h: img.physicalSizeMm.w }
          : null,
        autoZoomed: false,
      });
    } catch (err) {
      console.error('Rotación falló:', err);
      setToast({ kind: 'error', text: `No se pudo rotar: ${err.message}` });
    }
  };

  const handleAutoZoom = async (imageId) => {
    const img = layout.imageMap.get(imageId);
    if (!img || !img.faces || img.faces.length === 0) return;
    const bbox = facesBoundingBox(img.faces, 0.25);
    if (!bbox) return;
    const x = Math.max(0, bbox.x);
    const y = Math.max(0, bbox.y);
    const w = Math.min(img.width - x, bbox.width);
    const h = Math.min(img.height - y, bbox.height);
    if (w < 4 || h < 4) return;
    try {
      const croppedDataUrl = await cropImageDataUrl(
        img.dataUrl,
        { x, y, w, h },
        img.width,
        img.height,
      );
      const newImg = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('No se pudo leer la imagen recortada.'));
        i.src = croppedDataUrl;
      });
      const remappedFaces = img.faces.map((f) => ({
        ...f,
        x: f.x - x,
        y: f.y - y,
      }));
      layout.updateImage(imageId, {
        dataUrl: croppedDataUrl,
        width: newImg.naturalWidth,
        height: newImg.naturalHeight,
        faces: remappedFaces,
        autoZoomed: true,
      });
    } catch (err) {
      console.error('Auto-zoom falló:', err);
      setToast({ kind: 'error', text: `No se pudo recortar: ${err.message}` });
    }
  };

  // ¿La plantilla actual tiene marcas de corte GENERADAS por nosotros (grilla
  // rápida)? Solo en ese caso se puede elegir imprimir/exportar con o sin marcas;
  // las marcas embebidas en un PDF de fondo no se pueden quitar desde acá.
  const selectedHasGeneratedMarks =
    !!selected
    && !selected.pdfBase64
    && typeof selected.markMarginMm === 'number'
    && selected.markMarginMm > 0
    && Array.isArray(selected.cortes)
    && selected.cortes.length > 0;

  const handleExport = () => {
    if (!selected || exporting) return;
    // Si la plantilla tiene marcas generadas, preguntamos con/sin marcas.
    // Si no, exportamos directo (sin fricción).
    if (selectedHasGeneratedMarks) {
      setExportMarksPrompt(true);
      return;
    }
    doExport(true);
  };

  const doExport = async (drawMarks) => {
    if (!selected || exporting) return;
    setExporting(true);
    setToast(null);
    try {
      // Doble faz: un solo PDF con pag 1 = frente (con marcas) y pag 2 = dorso
      // (sin marcas). Lo viewing no influye, siempre mandamos las dos caras.
      // 1-pagina: no se embebe nada del PDF original (las cajas son guias).
      const result = selected.doubleSided
        ? await exportDoubleSidedLayoutToPdf(
            selected,
            layout.assignmentsFront,
            layout.assignmentsBack,
            layout.imageMap,
            {
              layoutFitMode,
              paperWidthMm: customPaper?.widthMm,
              paperHeightMm: customPaper?.heightMm,
              drawMarks,
            },
          )
        : await exportLayoutToPdf(
            selected,
            layout.assignmentsFront,
            layout.imageMap,
            {
              layoutFitMode,
              embedBackground: !selected.singlePage,
              paperWidthMm: customPaper?.widthMm,
              paperHeightMm: customPaper?.heightMm,
              drawMarks,
            },
          );
      if (result?.canceled) {
        setToast(null);
      } else if (result?.error) {
        setToast({ kind: 'error', text: `Error al guardar: ${result.error}` });
      } else if (result?.path) {
        setToast({ kind: 'success', text: 'PDF guardado', path: result.path });
      }
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `No se pudo generar el PDF: ${err.message}` });
    } finally {
      setExporting(false);
    }
  };

  // Abre el PrintModal donde el usuario elige impresora + copias. La
  // impresion real ocurre en runPrint cuando el modal confirma.
  const handlePrint = (face = 'front') => {
    if (!selected || printing) return;
    const isBack = face === 'back';
    const assignments = isBack ? layout.assignmentsBack : layout.assignmentsFront;
    if (!assignments?.some((id) => id !== null)) {
      setToast({
        kind: 'error',
        text: isBack ? 'No hay imágenes en el dorso.' : 'No hay imágenes para imprimir.',
      });
      return;
    }
    setPrintPrompt({ face });
  };

  const runPrint = async ({ deviceName, copies, pages, cutMarks }) => {
    const prompt = printPrompt;
    setPrintPrompt(null);
    if (!prompt || !selected) return;
    const face = prompt.face;
    const isBack = face === 'back';
    const assignments = isBack ? layout.assignmentsBack : layout.assignmentsFront;
    setPrinting(face);
    setToast(null);
    try {
      // Impresion silent: el helper recibe DEVICE+COPIES y NO abre el
      // dialogo de Windows. Si el usuario eligio un subconjunto de paginas
      // en el modal, lo pasamos como `pages` (indices 0-based).
      const result = await printLayoutPdf(selected, assignments, layout.imageMap, {
        layoutFitMode,
        embedBackground: !isBack && !selected.singlePage,
        // Cara explicita: sino buildPdf la infiere de embedBackground y, en una
        // grilla doble faz (singlePage), el frente se tomaria como dorso y no
        // dibujaria las marcas de corte.
        face,
        faceLabel: selected.doubleSided ? (isBack ? 'dorso' : 'frente') : undefined,
        paperWidthMm: customPaper?.widthMm,
        paperHeightMm: customPaper?.heightMm,
        deviceName,
        copies,
        pages,
        drawMarks: cutMarks !== false,
        showDialog: false,
      });
      if (result?.canceled) {
        setToast(null);
      } else if (result?.ok) {
        setToast({
          kind: 'success',
          text: selected.doubleSided
            ? `Enviado a la impresora (${isBack ? 'dorso' : 'frente'}).`
            : 'Enviado a la impresora.',
        });
      } else {
        setToast({ kind: 'error', text: `No se pudo imprimir: ${result?.error ?? 'desconocido'}` });
      }
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `No se pudo imprimir: ${err.message}` });
    } finally {
      setPrinting(false);
    }
  };

  const handleCut = async () => {
    if (!selected || !hasCuts(selected) || cutting) return;
    const margin = selected.markMarginMm ?? 10;
    if (!confirm(
      `Vas a enviar ${selected.cortes.length} polilíneas al plotter.\n` +
      `Margen de marcas: ${margin} mm.\n` +
      `Asegurate de que la hoja ya esté impresa y posicionada en la máquina.`
    )) return;
    setCutting(true);
    setToast(null);
    try {
      const result = await window.printlayout.plotter.sendCut({
        cortes: selected.cortes,
        pageWidthMm: selected.pageWidthMm,
        pageHeightMm: selected.pageHeightMm,
        markMarginMm: margin,
        bladeOffsetMm,
      });
      if (result?.ok) {
        setToast({
          kind: 'success',
          text: `Corte enviado al plotter (${result.bytes} bytes, ${result.polilineas} polilíneas).`,
        });
      } else {
        setToast({ kind: 'error', text: `No se pudo enviar: ${result?.error ?? 'desconocido'}` });
      }
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `Error enviando al plotter: ${err.message}` });
    } finally {
      setCutting(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    // Errores se quedan mas tiempo (12s) para que se alcancen a leer; los
    // success son menos criticos y bajan en 6s.
    const ms = toast.kind === 'error' ? 12000 : 6000;
    const id = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(id);
  }, [toast]);

  // Warning antes de cerrar la app si hay tabs con cambios sin guardar
  // (isDirty=true). Lo expone como window.__printlayoutCanClose: el main
  // process lo llama via executeJavaScript en el `close` event del window.
  // Devuelve Promise<bool>: true para cerrar, false para abortar el cierre.
  // Usamos confirm() nativo — es bloqueante y feo pero funcional. El estado
  // del editor (auto-save de Fase E) sigue persistido en disco igual, asi
  // que el warning es para advertir, no para evitar perdida.
  useEffect(() => {
    window.__printlayoutCanClose = () => {
      const dirty = tabs.filter((t) => t.isDirty);
      if (dirty.length === 0) return Promise.resolve(true);
      const names = dirty.map((t) => `· ${t.name || 'Sin titulo'}`).join('\n');
      const ok = window.confirm(
        `Hay ${dirty.length} trabajo${dirty.length === 1 ? '' : 's'} con cambios sin guardar:\n\n${names}\n\nSe van a guardar automaticamente y se restauran al reabrir, pero si querés guardarlos como trabajo nombrado hacelo antes de cerrar.\n\n¿Cerrar igual?`,
      );
      return Promise.resolve(ok);
    };
    return () => { delete window.__printlayoutCanClose; };
  }, [tabs]);

  // Auto-update: escuchar status del main y mostrar banner cuando este listo.
  const [updateInfo, setUpdateInfo] = useState(null);
  useEffect(() => {
    if (!window.printlayout?.updater?.onStatus) return undefined;
    return window.printlayout.updater.onStatus((s) => {
      if (s.kind === 'ready') setUpdateInfo({ version: s.version });
      else if (s.kind === 'error') console.warn('[updater]', s.error);
    });
  }, []);

  const overlayImage =
    activeDrag?.imageId ? layout.imageMap.get(activeDrag.imageId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950 text-ink-100">
        {updateInfo && (
          <div className="flex items-center justify-between gap-3 bg-accent-600 px-4 py-1.5 text-xs text-white">
            <span>
              Hay una actualizacion lista
              {updateInfo.version ? ` (v${updateInfo.version})` : ''}.
              Reinicia la app para aplicarla.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.printlayout.updater.installNow()}
                className="rounded bg-white/20 px-2.5 py-0.5 hover:bg-white/30"
              >
                Reiniciar e instalar
              </button>
              <button
                type="button"
                onClick={() => setUpdateInfo(null)}
                title="Ocultar (se aplica al cerrar la app igual)"
                className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
              >
                Despues
              </button>
            </div>
          </div>
        )}
        <TopBar
          canExport={!!selected}
          canCut={!!selected && hasCuts(selected)}
          doubleSided={!!selected?.doubleSided}
          viewingFace={viewingFace}
          onChangeFace={(f) => {
            setViewingFace(f);
            layout.setSelectedCell(null);
          }}
          backMirror={selected ? backMirrorAxis(selected) : 'y'}
          backRotate180={selected ? backRotate180(selected) : false}
          onChangeBackMirror={selected?.doubleSided ? (axis) => {
            // Resolvemos AMBOS campos y borramos el backFlip viejo, asi no queda
            // estado mixto en plantillas que venian del modo acoplado anterior.
            updateActiveTab((tab) => ({
              template: {
                ...tab.template,
                backMirror: axis,
                backRotate180: backRotate180(tab.template),
                backFlip: undefined,
              },
              isDirty: true,
            }));
          } : undefined}
          onChangeBackRotate180={selected?.doubleSided ? (val) => {
            updateActiveTab((tab) => ({
              template: {
                ...tab.template,
                backRotate180: !!val,
                backMirror: backMirrorAxis(tab.template),
                backFlip: undefined,
              },
              isDirty: true,
            }));
          } : undefined}
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
          cellsPerPage={(() => {
            if (!selected) return 0;
            if (fixedPageCount(selected) !== null) {
              return cellsCountOnPage(selected, currentPage, viewingFace);
            }
            return layout.cellsPerPage;
          })()}
          imagesLoaded={layout.images.length}
          hasOccupiedCells={(() => {
            if (!selected) return false;
            let start, count;
            if (fixedPageCount(selected) !== null) {
              start = pageStartOffset(selected, currentPage, viewingFace);
              count = cellsCountOnPage(selected, currentPage, viewingFace);
            } else {
              const cpp = layout.cellsPerPage;
              if (!cpp) return false;
              start = currentPage * cpp;
              count = cpp;
            }
            return layout.assignments.slice(start, start + count).some((id) => id !== null);
          })()}
          hasOccupiedCellsAllPages={
            !!selected && layout.assignments.some((id) => id !== null)
          }
          totalPages={layout.pageCount}
          onDistributeEvenly={(mode, scope) =>
            layout.distributeImagesEvenly(mode, currentPage, scope)
          }
          onOpenQuantities={() => setQuantitiesOpen(true)}
          onOpenFrontBackPose={() => setPoseFrontBackOpen(true)}
          onUndo={layout.undo}
          onRedo={layout.redo}
          canUndo={layout.canUndo}
          canRedo={layout.canRedo}
          jobName={currentJobName}
          jobDirty={isDirty}
          canSaveJob={!!selected}
          onSaveJob={handleSaveJobShortcut}
          onSaveJobAs={handleSaveJobAs}
          onOpenJob={handleOpenJobsList}
          onOpenPdfToImage={() => setPdfToImageOpen(true)}
          onOpenIntake={isLaRecta ? () => setIntakePanelOpen(true) : undefined}
        />
        <TabsBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitch={switchTab}
          onClose={requestCloseTab}
          onRename={(id, name) => updateTab(id, { name })}
          onNew={() => setNewTabModalOpen(true)}
          onReorder={reorderTab}
          onSaveAs={(id) => {
            // Si la tab clickeada no es la activa, la activamos y disparamos
            // saveAs en el proximo tick (asi handleSaveJobAs lee el contexto
            // ya switcheado).
            if (id !== activeTabId) {
              switchTab(id);
              setTimeout(() => handleSaveJobAs(), 0);
            } else {
              handleSaveJobAs();
            }
          }}
          onCloseOthers={(keepId) => {
            const ids = tabs.filter((t) => t.id !== keepId).map((t) => t.id);
            ids.forEach((id) => requestCloseTab(id));
          }}
          onCloseAll={() => {
            tabs.map((t) => t.id).forEach((id) => requestCloseTab(id));
          }}
        />
        <div className="flex flex-1 overflow-hidden">
          <LayoutCanvas
            template={selected}
            assignments={layout.assignments}
            imageMap={layout.imageMap}
            selectedCell={layout.selectedCell}
            layoutFitMode={layoutFitMode}
            cellsPerPage={layout.cellsPerPage}
            pageCount={layout.pageCount}
            currentPage={currentPage}
            face={viewingFace}
            showBackground={viewingFace !== 'back'}
            showCuts={showCuts}
            onPageChange={(p) => {
              setCurrentPage(p);
              layout.setSelectedCell(null);
            }}
            onCellClick={handleCellClick}
            onCellContextMenu={(_cellIdx, img) => {
              if (img?.id) setEditingImageId(img.id);
            }}
            onUploadPdfClick={() => blankPdfInputRef.current?.click()}
            onCreateGridClick={() => setGridModalOpen(true)}
          />
          <PropertiesSidebar
            template={selected}
            images={layout.images}
            assignments={layout.assignments}
            imageMap={layout.imageMap}
            selectedCell={layout.selectedCell}
            viewingFace={viewingFace}
            canShare={canShare}
            sharing={sharing}
            minPages={layout.minPages}
            onChangeMinPages={layout.setMinPages}
            onShare={handleShare}
            onRenameTemplate={handleRenameTemplate}
            onSetCategoria={handleSetCategoria}
            categoriasList={categoriasList}
            onEditMargin={handleEditMargin}
            onUpdateTemporal={handleUpdateTemporalTemplate}
            onSaveTemporal={(tpl) => setSaveTemplatePrompt(tpl)}
            onAddImages={handleAddImages}
            onImportPdfImages={handleImportPdfImages}
            extractingPdf={extractingPdf}
            onRemoveImage={layout.removeImage}
            onClearCell={layout.clearCell}
            onClearAll={layout.clearAll}
            onAddImageToCell={layout.addImageToCell}
            onFillAll={(imageId) => {
              let start, count;
              if (fixedPageCount(selected) !== null) {
                start = pageStartOffset(selected, currentPage, viewingFace);
                count = cellsCountOnPage(selected, currentPage, viewingFace);
              } else {
                const cellsPP = layout.cellsPerPage;
                start = currentPage * cellsPP;
                count = cellsPP;
              }
              const pageSlice = layout.assignments.slice(start, start + count);
              const others = pageSlice.some(
                (id) => id !== null && id !== imageId,
              );
              if (others) {
                if (!confirm('¿Reemplazar todas las celdas de esta hoja con esta imagen?')) return;
              }
              layout.fillAllWith(imageId, currentPage);
            }}
            onAutoZoom={handleAutoZoom}
            onRotate={handleRotate}
            onEditImage={(imageId) => setEditingImageId(imageId)}
            onCropImage={(imageId) => setCroppingImageId(imageId)}
            onCycleFit={(imageId, value) =>
              layout.updateImage(imageId, { fitOverride: value })
            }
            onSelectImage={(imageId) => {
              const idx = layout.assignments.findIndex((id) => id === imageId);
              if (idx >= 0) {
                const info = findCellPageInfo(selected, idx, viewingFace);
                if (info.page !== currentPage) setCurrentPage(info.page);
                layout.setSelectedCell(idx);
              }
            }}
            onResetWork={layout.resetCurrentTemplateWork}
            hasPersistedWork={selected ? layout.templatesWithWork.has(selected.id) : false}
          />
        </div>

        <input
          ref={cellPickerRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={handleCellPickerChange}
        />

        <PromptModal
          open={!!marginPrompt}
          title="Margen de marcas"
          message="Distancia en mm entre el borde de la hoja y las marcas L (típicamente 10)."
          defaultValue={marginPrompt?.defaultValue ?? '10'}
          placeholder="10"
          onConfirm={submitMarginPrompt}
          onCancel={() => setMarginPrompt(null)}
        />

        <PromptModal
          open={!!oficialPrompt}
          title="Marcar como plancha oficial"
          message="ID de catálogo (el enganche con la web y el CRM). Estable: no lo cambies después. Ej: polaroid, 10x15."
          defaultValue={oficialPrompt?.defaultValue ?? ''}
          placeholder="polaroid"
          confirmLabel="Marcar oficial"
          onConfirm={submitOficialPrompt}
          onCancel={() => setOficialPrompt(null)}
        />

        <PdfUploadModal
          open={!!pdfUpload}
          fileName={pdfUpload?.file?.name}
          existingCategories={categoriasList}
          onConfirm={submitPdfUpload}
          onCancel={() => setPdfUpload(null)}
        />

        {gridModalOpen && (
          <GridUploadModal
            open
            onConfirm={handleCreateGrid}
            onCancel={() => setGridModalOpen(false)}
            presets={paperPresetList}
            onOpenPresetsEditor={() => setPresetsModalOpen(true)}
          />
        )}

        <ImageQuantitiesModal
          open={quantitiesOpen}
          images={layout.images}
          cellsPerPage={layout.cellsPerPage}
          onConfirm={(counts) => {
            const res = layout.applyImageQuantities(counts);
            setQuantitiesOpen(false);
            setCurrentPage(0);
            layout.setSelectedCell(null);
            if (res) {
              setToast({
                kind: 'success',
                text: `${res.totalCopies} copia${res.totalCopies === 1 ? '' : 's'} acomodada${res.totalCopies === 1 ? '' : 's'} en ${res.pages} hoja${res.pages === 1 ? '' : 's'}.`,
              });
            }
          }}
          onCancel={() => setQuantitiesOpen(false)}
        />

        <ImageFrontBackPoseModal
          open={poseFrontBackOpen}
          cellsPerPage={layout.cellsPerPage}
          initialImages={layout.images}
          onConfirm={(cards) => {
            const res = layout.applyFrontBackPairs(cards);
            setPoseFrontBackOpen(false);
            setCurrentPage(0);
            layout.setSelectedCell(null);
            if (res) {
              setToast({
                kind: 'success',
                text: `${res.cards} tarjeta${res.cards === 1 ? '' : 's'} posada${res.cards === 1 ? '' : 's'} (frente y dorso) en ${res.pages} hoja${res.pages === 1 ? '' : 's'}.`,
              });
            }
          }}
          onCancel={() => setPoseFrontBackOpen(false)}
        />

        <PaperPresetsModal
          open={presetsModalOpen}
          builtinPresets={BUILTIN_PAPER_PRESETS}
          customPresets={customPaperPresets}
          canSync={canSyncPresets}
          onSave={savePaperPreset}
          onDelete={removePaperPreset}
          onSyncPull={syncPullPaperPresets}
          onSyncPush={syncPushPaperPresets}
          onClose={() => setPresetsModalOpen(false)}
        />

        <PdfToImageModal
          open={pdfToImageOpen}
          onClose={() => setPdfToImageOpen(false)}
        />

        <IntakePanelModal
          open={intakePanelOpen}
          onClose={() => { setIntakePanelOpen(false); refreshLaRecta(); }}
          onPublishCatalog={handlePublishCatalog}
        />

        <ConfirmModal
          open={!!pendingRestore}
          title="¿Restaurar sesión anterior?"
          message={
            pendingRestore
              ? `Tenías ${pendingRestore.tabs.length} pestaña${
                  pendingRestore.tabs.length === 1 ? '' : 's'
                } abierta${pendingRestore.tabs.length === 1 ? '' : 's'} la última vez (${
                  pendingRestore.tabs
                    .slice(0, 3)
                    .map((t) => t.name || 'Sin titulo')
                    .join(', ')
                }${pendingRestore.tabs.length > 3 ? '…' : ''}).`
              : ''
          }
          cancelLabel={null}
          actions={[
            { label: 'Empezar nuevo', value: 'discard', variant: 'default' },
            { label: 'Restaurar', value: 'restore', variant: 'primary' },
          ]}
          onAction={(v) => {
            if (v === 'restore') confirmRestore();
            else discardRestore();
          }}
          onCancel={() => {}}
        />

        <PdfImageExtractModal
          open={!!pdfExtract}
          fileName={pdfExtract?.fileName}
          images={pdfExtract?.images ?? []}
          mode={pdfExtract?.mode ?? 'embedded'}
          busy={extractingPdf}
          onConfirm={submitPdfExtract}
          onCancel={cancelPdfExtract}
          onSwitchToRasterized={handleSwitchToRasterized}
        />

        <ImagePackModal
          open={!!autoPackFiles}
          files={autoPackFiles ?? []}
          onConfirm={submitAutoPack}
          onCancel={() => setAutoPackFiles(null)}
        />

        <ImageCountPackModal
          open={!!countPackFiles}
          files={countPackFiles ?? []}
          onConfirm={submitCountPack}
          onCancel={() => setCountPackFiles(null)}
        />

        <SaveTemplateModal
          open={!!saveTemplatePrompt}
          defaultName={saveTemplatePrompt?.name || ''}
          defaultCategoria={saveTemplatePrompt?.categoria || ''}
          existingCategories={categoriasList}
          onConfirm={submitSaveTemplate}
          onCancel={() => setSaveTemplatePrompt(null)}
        />

        <PrintModal
          open={!!printPrompt}
          faceLabel={
            printPrompt && selected?.doubleSided
              ? (printPrompt.face === 'back' ? 'dorso' : 'frente')
              : undefined
          }
          totalPages={layout.pageCount}
          currentPage={currentPage}
          showCutMarksOption={selectedHasGeneratedMarks}
          onConfirm={runPrint}
          onCancel={() => setPrintPrompt(null)}
        />

        <ConfirmModal
          open={exportMarksPrompt}
          title="Exportar PDF"
          message="¿Querés incluir las marcas de corte (las L de las esquinas que usa el plotter)?"
          actions={[
            { label: 'Sin marcas', value: 'without', variant: 'default' },
            { label: 'Con marcas', value: 'with', variant: 'primary' },
          ]}
          onAction={(value) => {
            setExportMarksPrompt(false);
            doExport(value === 'with');
          }}
          onCancel={() => setExportMarksPrompt(false)}
        />

        <SaveJobModal
          open={!!saveJobModal}
          defaultName={
            saveJobModal?.saveAs
              ? (currentJobName ? `${currentJobName} (copia)` : '')
              : (currentJobName || '')
          }
          onConfirm={submitSaveJob}
          onCancel={() => setSaveJobModal(null)}
        />

        <JobsListModal
          open={jobsListOpen}
          jobs={jobs}
          loading={jobsLoading}
          onOpen={handleOpenJob}
          onDelete={handleDeleteJob}
          onClose={() => setJobsListOpen(false)}
        />

        <ConfirmModal
          open={!!closeTabConfirm}
          title="Cerrar trabajo con cambios sin guardar"
          message={`"${closeTabConfirm?.name ?? ''}" tiene cambios sin guardar. ¿Que querés hacer?`}
          actions={[
            { label: 'Descartar y cerrar', value: 'discard', variant: 'danger' },
            { label: 'Guardar y cerrar', value: 'save', variant: 'primary' },
          ]}
          onAction={handleCloseTabConfirm}
          onCancel={() => setCloseTabConfirm(null)}
        />

        <NewTabModal
          open={newTabModalOpen}
          templates={templates}
          syncing={syncing}
          onSync={() => runSyncWithToast()}
          onDeleteTemplate={handleDelete}
          isLaRecta={isLaRecta}
          onToggleOficial={handleToggleOficial}
          onClose={() => setNewTabModalOpen(false)}
          onPickTemplate={(id) => handleSelectTemplate(id)}
          onCreateGrid={() => setGridModalOpen(true)}
          onAutoPack={() => newTabAutoPickerRef.current?.click()}
          onCountPack={() => newTabCountPickerRef.current?.click()}
          onUploadPdf={() => blankPdfInputRef.current?.click()}
          onOpenJobsList={() => setJobsListOpen(true)}
        />

        <input
          ref={newTabAutoPickerRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (files.length > 0) handleStartAutoPack(files);
          }}
        />
        <input
          ref={newTabCountPickerRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (files.length > 0) handleStartCountPack(files);
          }}
        />

        <input
          ref={blankPdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleUploadPdf(file);
          }}
        />

        {(() => {
          const croppingImage = croppingImageId
            ? layout.imageMap.get(croppingImageId)
            : null;
          if (!croppingImage) return null;
          return (
            <ImageCropModal
              open
              image={croppingImage}
              onApply={(updates) => layout.updateImage(croppingImageId, updates)}
              onClose={() => setCroppingImageId(null)}
            />
          );
        })()}

        {(() => {
          const editingImage = editingImageId
            ? layout.imageMap.get(editingImageId)
            : null;
          if (!editingImage) return null;
          return (
            <ImageEditorModal
              open
              image={editingImage}
              template={selected}
              onSave={(updates) => layout.updateImage(editingImageId, updates)}
              onClose={() => setEditingImageId(null)}
              onTemplateSafetyChange={async (mm) => {
                if (!selected || selected.temporal) return;
                if (Math.abs((selected.safetyMm ?? 3) - mm) < 0.01) return;
                try {
                  await update({ ...selected, safetyMm: mm });
                } catch (err) {
                  console.warn('No se pudo guardar safetyMm:', err);
                }
              }}
            />
          );
        })()}

        {toast && (
          <div
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto fixed bottom-6 left-1/2 z-40 flex max-w-[80vw] -translate-x-1/2 items-start gap-3 rounded-lg border px-5 py-3 text-sm font-medium text-white shadow-2xl ring-1 ring-black/40 ${
              toast.kind === 'success'
                ? 'border-emerald-400 bg-emerald-700'
                : toast.kind === 'info'
                ? 'border-sky-400 bg-sky-700'
                : 'border-red-400 bg-red-700'
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                toast.kind === 'success'
                  ? 'bg-emerald-500'
                  : toast.kind === 'info'
                  ? 'bg-sky-500'
                  : 'bg-red-500'
              }`}
              aria-hidden
            >
              {toast.kind === 'success' ? '✓' : toast.kind === 'info' ? '…' : '!'}
            </span>
            <span className="whitespace-pre-wrap break-words">{toast.text}</span>
            {toast.path && (
              <button
                onClick={() => window.printlayout.shell.showItem(toast.path)}
                className="shrink-0 rounded border border-white/40 bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
              >
                Mostrar en carpeta
              </button>
            )}
            <button
              onClick={() => setToast(null)}
              title="Cerrar"
              className="shrink-0 rounded p-0.5 text-white/70 hover:bg-white/20 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <DragOverlay>
        {overlayImage ? (
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md bg-white shadow-2xl ring-2 ring-accent-500">
            <img
              src={overlayImage.dataUrl}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
