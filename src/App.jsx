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
import { buildDobbleJob, buildComboTemplate } from './dobble/buildDobbleJob.js';
import { validarReceta } from './dobble/vendor/receta.js';
import DobblePoseModal from './components/DobblePoseModal.jsx';
import DobbleComboModal from './components/DobbleComboModal.jsx';
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
import QrCutPanelModal from './components/QrCutPanelModal.jsx';
import ImageEditorModal from './components/ImageEditorModal.jsx';
import ImageCropModal from './components/ImageCropModal.jsx';
import SaveTemplateModal from './components/SaveTemplateModal.jsx';
import PrintModal from './components/PrintModal.jsx';
import SaveJobModal from './components/SaveJobModal.jsx';
import JobsListModal from './components/JobsListModal.jsx';
import NewTabModal from './components/NewTabModal.jsx';
import TemplatesManagerModal from './components/TemplatesManagerModal.jsx';
import RotulosManagerModal from './components/RotulosManagerModal.jsx';
import RotulosPlanchaModal from './components/RotulosPlanchaModal.jsx';
import { buildRotulosSheet, buildRotulosPdfBytes, buildRotulosTemplate } from './rotulos/planchaJob.js';
import PaperPresetsModal from './components/PaperPresetsModal.jsx';
import { useTemplates } from './hooks/useTemplates.js';
import { usePaperPresets } from './hooks/usePaperPresets.js';
import { useJobs } from './hooks/useJobs.js';
import { useTabs } from './hooks/useTabs.js';
import { BUILTIN_PAPER_PRESETS } from './lib/grid.js';
import { useLayoutEditor } from './hooks/useLayoutEditor.js';
import { readImageFiles, readImageFile } from './lib/images.js';
import { prepareIncomingImageFiles } from './lib/heic.js';
import { setImportSkipReporter, reportImportSkips } from './lib/importReport.js';
import {
  exportLayoutToPdf,
  exportDoubleSidedLayoutToPdf,
  printLayoutPdf,
  buildPdf,
  buildDoubleSidedPdf,
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
import { contourCutsByAssignments } from './lib/stickerContour.js';
import {
  buildCatalogRows,
  catalogRowForTemplate,
  slugifyCatalogId,
  buildCriterioCustomValue,
  CRITERIO_CUSTOM_KEY,
} from './intake/catalog.js';
import { rasterizePdfPages, renderPdfBytesToImages } from './lib/pdfPreview.js';
import { facesBoundingBox } from './lib/faceDetection.js';
import { cropImageDataUrl } from './lib/imageCrop.js';
import { rotateImageDataUrl90CW, rotateFaces90CW } from './lib/imageRotate.js';
import { dbg } from './lib/debugLog.js';

// Slug estable para el cutId (QR + nombre del .plt) derivado del NOMBRE de una
// plantilla guardada. Minúsculas, sin acentos, espacios/símbolos -> '-', colapsa
// y recorta a ~24 chars (un QR de 8mm con nombre corto lo lee la cámara del
// plotter; nombres largos = QR denso). El server exige safeName===rawName, y
// [a-z0-9-] cumple [A-Za-z0-9_-].
function slugCutId(name) {
  const s = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca tildes/diacríticos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, ''); // por si el corte a 24 dejó un guión colgando
  return s || 'corte';
}

// Sufijo corto y ESTABLE (derivado del id del store) para desambiguar dos
// plantillas guardadas distintas que slugifican al mismo nombre.
function cutIdSuffix(storeId) {
  const s = String(storeId || '').replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase();
  return s || 'x';
}

export default function App() {
  const {
    templates,
    loading: templatesLoading,
    canShare,
    createFromPdf,
    update,
    remove,
    removeShared,
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
  const [qrCutPanelOpen, setQrCutPanelOpen] = useState(false);
  // Config del server QR (posición del QR + prefijo del nombre). Se usa para
  // dibujar el QR en la vista previa y en la impresión directa. Se refresca al
  // abrir la app y al cerrar el panel "Corte QR".
  const [qrConfig, setQrConfig] = useState(null);
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
      const rem = r.removed?.length ?? 0;
      const errs = r.errors?.length ?? 0;
      if (errs > 0) {
        const failed = r.errors.map((e) => `${e.name}: ${e.error}`).join('; ');
        setToast({ kind: 'error', text: `Sync con errores — ${failed}` });
      } else if (a + u + rep + c + rem > 0) {
        const parts = [];
        if (a) parts.push(`${a} nueva${a === 1 ? '' : 's'}`);
        if (u) parts.push(`${u} actualizada${u === 1 ? '' : 's'}`);
        if (rep) parts.push(`${rep} reemplazada${rep === 1 ? '' : 's'}`);
        if (c) parts.push(`${c} duplicada${c === 1 ? '' : 's'} eliminada${c === 1 ? '' : 's'}`);
        if (rem) parts.push(`${rem} borrada${rem === 1 ? '' : 's'} en el equipo`);
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
  // Dobble: receta por pestaña (templateId → receta resuelta) para re-render al
  // cambiar el fondo de carta o re-posar en otra plantilla; flag de ocupado.
  const dobbleRecetasRef = useRef(new Map());
  const [dobblePose, setDobblePose] = useState(null); // { receta } | null  (modal de posado abierto)
  const [gridForDobbleReceta, setGridForDobbleReceta] = useState(null); // receta esperando una plantilla nueva
  const [dobbleComboOpen, setDobbleComboOpen] = useState(false); // config del combo Mazo Dobble
  const [comboForReceta, setComboForReceta] = useState(null); // receta esperando un combo nuevo
  const [dobbleBusy, setDobbleBusy] = useState(false);
  // Editor de plantillas (botón "Plantillas" de la barra) + edición de medidas.
  const [templatesManagerOpen, setTemplatesManagerOpen] = useState(false);
  const [rotulosOpen, setRotulosOpen] = useState(false);
  const [rotulosPlanchaOpen, setRotulosPlanchaOpen] = useState(false);
  // Precarga del armador: { planchaId, modeloId } (nuevo) o la receta completa
  // + { editing:true } (editar la pestaña activa).
  const [rotulosPlanchaInit, setRotulosPlanchaInit] = useState(null);
  const [editGeometryTemplate, setEditGeometryTemplate] = useState(null);
  const [quantitiesOpen, setQuantitiesOpen] = useState(false);
  const [poseFrontBackOpen, setPoseFrontBackOpen] = useState(false);
  // Imagen abierta en el editor.
  const [editingImageId, setEditingImageId] = useState(null);
  // Imagen abierta en el modal de recorte manual.
  const [croppingImageId, setCroppingImageId] = useState(null);
  // Extraccion de imagenes desde PDF.
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [pdfExtract, setPdfExtract] = useState(null); // { fileName, tmpDir, images }
  // Destino de las imagenes elegidas en el modal de PDF: null = panel Fotos (como
  // siempre); 'autopack'/'countpack' = alimentan el acomodar (mismo modal de PDF).
  const [pdfExtractDest, setPdfExtractDest] = useState(null);
  const [pdfExtractPending, setPdfExtractPending] = useState([]); // imagenes sueltas junto al PDF
  // Cola para importar VARIOS PDFs juntos (panel Fotos): se procesan de a uno
  // (abrir modal → elegir → confirmar → sigue el próximo). El ref evita que el
  // effect que avanza la cola dispare dos a la vez.
  const [pdfQueue, setPdfQueue] = useState([]);
  const pdfQueueBusyRef = useRef(false);
  // Auto-acomodar imagenes.
  const [autoPackFiles, setAutoPackFiles] = useState(null);
  // Cache de contornos por imagen+tolerancia (modo corte "Contorno"): ajustar
  // sangrado/huecos no re-traza, solo re-mapea.
  const contourCacheRef = useRef(new Map());
  // Acomodar por cantidad (N por hoja, maximo tamano).
  const [countPackFiles, setCountPackFiles] = useState(null);
  // Imagenes precargadas que se asignan a una plantilla recien creada.
  const [pendingAutoAssign, setPendingAutoAssign] = useState(null); // { templateId, images }
  const processedAutoAssignRef = useRef(null); // guard idempotencia (StrictMode doble-run)

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
    dbg(`[open] openInTab rawTplId=${rawTemplate?.id ?? '-'} forceNew=${forceNew} reuse=${reuse} activeTab=${activeTab?.id ?? '-'} initImages=${initialLayout?.images?.length ?? 0}`);

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

  // Rótulos: el armador confirmó una receta → arma la HOJA (template + 3 PNG por
  // tamaño) y la vuelca en una PESTAÑA normal. Si spec.editing, re-arma la MISMA
  // pestaña; si no, abre una nueva. El corte .plt fijo se asegura acá (idempotente).
  const handleRotulosSubmit = useCallback(async (spec) => {
    setRotulosPlanchaOpen(false);
    setRotulosPlanchaInit(null);
    setToast({ kind: 'info', text: 'Armando plancha de rótulos…' });
    try {
      const sheet = await buildRotulosSheet(spec);
      try {
        await window.printlayout.qrcut.ensureBaseCut({
          planchaId: sheet.template.cutId,
          cortes: sheet.template.cortes,
          pageWidthMm: sheet.template.pageWidthMm,
          pageHeightMm: sheet.template.pageHeightMm,
          markMarginMm: sheet.template.markMarginMm,
          bladeOffsetMm,
        });
      } catch { /* best-effort: el .plt no bloquea armar la pestaña */ }

      const initialLayout = {
        images: sheet.images,
        assignmentsFront: sheet.assignmentsFront,
        assignmentsBack: [],
        minPages: 1,
      };
      if (spec.editing && activeTab?.id) {
        // Re-armar EN LA MISMA pestaña: id nuevo del template → el layout se
        // resetea limpio (soporta cambio de tipo de plancha) y luego se cargan
        // los PNG + asignaciones nuevas.
        const tplId = `tabtpl_${activeTab.id}_${Date.now().toString(36)}`;
        updateActiveTab({
          template: { ...sheet.template, id: tplId, temporal: true, tabBacked: true },
          name: sheet.template.name,
          isDirty: false,
        });
        setPendingTabLoads((prev) => [
          ...prev.filter((p) => p.templateId !== tplId),
          { templateId: tplId, ...initialLayout },
        ]);
      } else {
        openInTab(sheet.template, { name: sheet.template.name, forceNew: true, initialLayout });
      }
      const n = sheet.assignmentsFront.filter(Boolean).length;
      setToast({ kind: 'success', text: `Plancha de rótulos armada (${n} rótulos).` });
    } catch (e) {
      setToast({ kind: 'error', text: `No se pudo armar la plancha: ${e.message}` });
    }
  }, [openInTab, activeTab, updateActiveTab, bladeOffsetMm]);

  // === Dobble: importar mazo (recta-dobble-deck) → POSAR sobre una plantilla ===
  // Ya no arma la hoja solo: abre el modal de posado para elegir (o crear) una
  // plantilla redonda. La plantilla define hoja/márgenes/separación/⌀ de celda/
  // corte; el ⌀ de la carta sale de la celda. Mismo principio que stickers.
  const handleImportDobble = useCallback(async () => {
    try {
      const r = await window.printlayout.dobble.importRecipe();
      if (!r || r.canceled) return;
      if (!r.ok) { setToast({ kind: 'error', text: `No se pudo importar: ${r.error}` }); return; }
      const val = validarReceta(r.receta);
      if (!val.ok) { setToast({ kind: 'error', text: `Receta inválida: ${val.errores.join(' · ')}` }); return; }
      if (val.avisos?.length) setToast({ kind: 'info', text: val.avisos.join(' · ') });
      setDobblePose({ receta: r.receta });
    } catch (err) {
      setToast({ kind: 'error', text: `Error importando: ${err.message}` });
    }
  }, []);

  // Posa una receta sobre una plantilla concreta (guardada o recién creada).
  // Abre una pestaña nueva con la plantilla + las cartas posadas y guarda la
  // receta (por tab) para re-renderizar al cambiar el fondo o re-posar.
  const poseDobbleOnTemplate = useCallback(async (template, receta) => {
    if (!template || !receta) return;
    setDobbleBusy(true);
    try {
      const fondo = template.dobbleFondo || {};
      const { spec, error, warning } = await buildDobbleJob(receta, {
        template,
        fondo: fondo.color,
        fondoImagen: fondo.imagen,
      });
      if (!spec) { setToast({ kind: 'error', text: error || 'No se pudo posar el mazo.' }); return; }
      const tabId = openInTab(spec.template, {
        name: spec.name,
        forceNew: true,
        initialLayout: {
          images: spec.images,
          assignmentsFront: spec.assignmentsFront,
          assignmentsBack: spec.assignmentsBack,
          minPages: spec.minPages,
        },
      });
      dobbleRecetasRef.current.set(`tabtpl_${tabId}`, receta);
      const d = spec.template.dobble;
      const resumen = d.combo
        ? `Mazo posado en combo: ${Math.min(d.cardCells, d.cartas)}/${d.cartas} cartas en ${d.pages} hojas${d.doubleSided ? ' (doble faz)' : ''}.`
        : `Mazo posado: ${d.cartas} cartas (⌀ ${d.diametroMM} mm), ${d.cellsPerPage}/hoja, ${spec.minPages} hoja(s).`;
      // No truncar en silencio: si sobran cartas, avisamos (kind info).
      setToast(warning
        ? { kind: 'info', text: `${resumen} ⚠ ${warning}` }
        : { kind: 'success', text: resumen });
    } catch (err) {
      setToast({ kind: 'error', text: `Error posando: ${err.message}` });
    } finally {
      setDobbleBusy(false);
    }
  }, [openInTab]);

  // Elegir una plantilla guardada desde el modal de posado.
  const handlePosePickTemplate = useCallback((templateId) => {
    const tpl = templates.find((t) => t.id === templateId);
    const receta = dobblePose?.receta;
    setDobblePose(null);
    if (!tpl || !receta) return;
    poseDobbleOnTemplate(tpl, receta);
  }, [templates, dobblePose, poseDobbleOnTemplate]);

  // Crear una plantilla redonda nueva y posar encima: dejamos la receta pendiente
  // y abrimos la grilla rápida (arranca en modo círculo).
  const handlePoseCreateTemplate = useCallback(() => {
    const receta = dobblePose?.receta;
    setDobblePose(null);
    if (!receta) return;
    setGridForDobbleReceta(receta);
    setGridModalOpen(true);
  }, [dobblePose]);

  // Armar un combo Mazo Dobble (3 hojas): dejamos la receta pendiente y abrimos
  // el config del combo (elegir 2 plantillas de Corel).
  const handlePoseCreateCombo = useCallback(() => {
    const receta = dobblePose?.receta;
    setDobblePose(null);
    setComboForReceta(receta || null);
    setDobbleComboOpen(true);
  }, [dobblePose]);

  // Confirmar el combo: arma la plantilla multi-hoja (pages=[A,A,B]), la GUARDA en
  // el store (reutilizable) y posa el mazo pendiente encima.
  const handleCreateCombo = useCallback(async ({ aId, bId, name }) => {
    const A = templates.find((t) => t.id === aId);
    const B = templates.find((t) => t.id === bId);
    const receta = comboForReceta;
    setDobbleComboOpen(false);
    setComboForReceta(null);
    if (!A || !B) { setToast({ kind: 'error', text: 'Faltan las plantillas del combo.' }); return; }
    const { template: combo, error } = buildComboTemplate(A, B, { name });
    if (!combo) { setToast({ kind: 'error', text: error || 'No se pudo armar el combo.' }); return; }
    setDobbleBusy(true);
    try {
      const saved = await update(combo);
      setToast({ kind: 'success', text: `Combo "${saved.name}" guardado (3 hojas). Ya podés reusarlo.` });
      if (receta) await poseDobbleOnTemplate(saved, receta);
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo guardar el combo: ${err.message}` });
    } finally {
      setDobbleBusy(false);
    }
  }, [templates, comboForReceta, update, poseDobbleOnTemplate]);

  // Re-posar el mazo de la pestaña activa en otra plantilla (sin re-elegir el .json).
  const handleReposeDobble = useCallback(() => {
    const t = activeTab?.template;
    const receta = t ? dobbleRecetasRef.current.get(t.id) : null;
    if (!receta) {
      setToast({ kind: 'error', text: 'No tengo la receta de este mazo (reimportá el .json).' });
      return;
    }
    setDobblePose({ receta });
  }, [activeTab]);

  // Cambiar el fondo de carta (color o imagen) de la pestaña Dobble activa:
  // re-renderiza TODAS las cartas con el nuevo fondo, lo persiste con la plantilla
  // (si la pestaña referencia una guardada) y recarga el layout.
  const applyDobbleFondo = useCallback(async (nextFondo) => {
    const tpl = activeTab?.template;
    if (!tpl?.dobble) return;
    const receta = dobbleRecetasRef.current.get(tpl.id);
    if (!receta) {
      setToast({ kind: 'error', text: 'No tengo la receta de este mazo (reimportá el .json).' });
      return;
    }
    const fondo = {};
    if (nextFondo?.color) fondo.color = nextFondo.color;
    if (nextFondo?.imagen) fondo.imagen = nextFondo.imagen;
    const fondoOut = Object.keys(fondo).length ? fondo : undefined;
    setDobbleBusy(true);
    try {
      const { spec, error } = await buildDobbleJob(receta, {
        template: { ...tpl, dobbleFondo: fondoOut },
        fondo: fondo.color,
        fondoImagen: fondo.imagen,
        dobleFaz: tpl.dobble.doubleSided,
        dpi: tpl.dobble.dpi,
      });
      if (!spec) { setToast({ kind: 'error', text: error || 'No se pudo aplicar el fondo.' }); return; }
      updateActiveTab({ template: { ...spec.template, id: tpl.id, temporal: true, tabBacked: true } });
      layout.loadFromJob({
        images: spec.images,
        assignmentsFront: spec.assignmentsFront,
        assignmentsBack: spec.assignmentsBack,
        minPages: spec.minPages,
      });
      if (tpl.sourceTemplateId) {
        const storeTpl = templates.find((t) => t.id === tpl.sourceTemplateId);
        if (storeTpl) update({ ...storeTpl, dobbleFondo: fondoOut }).catch(() => {});
      }
    } catch (err) {
      setToast({ kind: 'error', text: `Error aplicando fondo: ${err.message}` });
    } finally {
      setDobbleBusy(false);
    }
  }, [activeTab, updateActiveTab, layout, templates, update]);

  // Helpers de fondo de carta: parten del fondo actual y cambian una clave.
  const dobbleFondoActual = () => activeTab?.template?.dobbleFondo || {};
  const handleDobbleColor = useCallback((color) => {
    applyDobbleFondo({ ...dobbleFondoActual(), color });
  }, [applyDobbleFondo, activeTab]);
  const handleDobbleImage = useCallback((dataUrl) => {
    applyDobbleFondo({ ...dobbleFondoActual(), imagen: dataUrl });
  }, [applyDobbleFondo, activeTab]);
  const handleDobbleClearImage = useCallback(() => {
    const { imagen, ...rest } = dobbleFondoActual();
    applyDobbleFondo(rest);
  }, [applyDobbleFondo, activeTab]);

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
    dbg(`[save] persistJobToPath tab=${targetTabId} tpl=${selected?.id ?? '-'} path="${filePath}" images=${layout.images.length}`);
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
    dbg(`[open] pljob desde lista jobId=${jobId} jobTplId=${job.template?.id ?? '-'} images=${job.images?.length ?? 0} | tabsAbiertas=${tabs.length} activa=${activeTabId}`);
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
    dbg(`[open] pljob desde archivo path="${r.path}" jobTplId=${job.template?.id ?? '-'} src=${job.template?.sourceTemplateId ?? '-'} images=${job.images?.length ?? 0} | tabsAbiertas=${tabs.length} activa=${activeTabId}`);
    const baseName = r.path.replace(/^.*[\\/]/, '').replace(/\.(pljob|json)$/i, '');
    const newTabId = openInTab(job.template, {
      name: job.name || baseName,
      forceNew: true,
      initialLayout: {
        images: job.images || [],
        assignmentsFront: job.assignmentsFront || [],
        assignmentsBack: job.assignmentsBack || [],
        minPages: job.minPages ?? 1,
      },
    });
    // Asignamos jobPath al tab NUEVO por su id explícito (openInTab lo devuelve).
    // Antes se hacía con updateActiveTab dentro de un setTimeout: ese closure
    // capturaba el activeTabId VIEJO (la pestaña anterior), así que el jobPath
    // caía en la pestaña equivocada → al guardar (Ctrl+S) se pisaba el .pljob de
    // otra pestaña. updateTab apunta por id y encola después del createTab.
    if (newTabId) updateTab(newTabId, { jobPath: r.path, isDirty: false });
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
      // Forma de corte "Contorno": los cortes son los contornos por imagen, los
      // recalcula un efecto async (contourCutsByAssignments). NO los regeneramos
      // como rectángulos acá para no pisarlos.
      if (next.cutShape === 'contour') return { template: next };
      const cutM = next.cutMarginMm ?? 0;
      const markM = next.markMarginMm ?? 0;
      const shape = next.cutShape ?? 'rect';
      next.cortes = markM > 0
        ? generateCuts(next.celdas ?? [], { cutShape: shape, cutMarginMm: cutM })
        : [];
      return { template: next };
    });
  };

  // Parchea la plantilla de la tab activa SIN regenerar cortes. Para ajustes que
  // no afectan el corte (ej. el borde blanco de las fotos). Sirve para cualquier
  // plantilla de la tab (grilla temporal, trabajo abierto, etc.).
  // Config del server QR: se lee al montar (y al cerrar el panel) para dibujar
  // el QR en la vista previa y en la impresión con la misma posición.
  useEffect(() => {
    window.printlayout?.qrcut?.getConfig?.()
      .then((c) => setQrConfig(c || null))
      .catch(() => {});
  }, []);

  // Marcador de arranque de sesión en el log de diagnóstico (temporal).
  useEffect(() => {
    dbg('===== SESIÓN nueva (app abierta) =====');
  }, []);

  // ¿La plantilla en curso está respaldada por el store (guardada, con nombre)?
  // sourceTemplateId guarda el id real (tpl_…) de la plantilla del store; una
  // grilla suelta / corte temporal no lo tiene.
  const isSavedTemplate = (t) => !!(t && t.sourceTemplateId);

  // cutId ESTABLE derivado del nombre de una plantilla guardada. Si otra
  // plantilla guardada distinta slugifica igual, agrega un sufijo estable del
  // id para no pisar el mismo <cutId>.plt. Devuelve { cutId, collided }.
  const deriveCutId = useCallback((tpl) => {
    const base = slugCutId(tpl?.name);
    const myId = tpl?.sourceTemplateId || tpl?.id;
    const clash = templates.some((t) => t.id !== myId && slugCutId(t.name) === base);
    if (!clash) return { cutId: base, collided: false };
    return { cutId: `${base}-${cutIdSuffix(myId)}`, collided: true };
  }, [templates]);

  // Nombre de corte por defecto UNA vez, cuando la hoja tiene cortes y todavía no
  // tiene nombre. Para plantillas GUARDADAS se deriva del nombre (estable → un
  // solo QR/.plt por plantilla, no uno por impresión); para cortes sueltos /
  // grillas no guardadas se mantiene el timestamp de siempre. Se persiste con la
  // hoja (viaja en el template del .pljob). Editable en las propiedades.
  useEffect(() => {
    if (!qrConfig || !selected || !hasCuts(selected) || selected.cutId) return;
    let def;
    if (isSavedTemplate(selected)) {
      def = deriveCutId(selected).cutId;
    } else {
      const prefix = qrConfig.cutPrefix || '';
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const stamp = `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}`
        + `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      def = `${prefix}${stamp}`.replace(/[^A-Za-z0-9_-]/g, '');
    }
    updateActiveTab((tab) => (tab.template && hasCuts(tab.template) && !tab.template.cutId
      ? { template: { ...tab.template, cutId: def } }
      : {}));
  }, [qrConfig, selected, updateActiveTab, deriveCutId]);

  const handlePatchActiveTemplate = (updates) => {
    if (!activeTab?.template) return;
    updateActiveTab((tab) =>
      tab.template ? { template: { ...tab.template, ...updates } } : {},
    );
  };

  // Agregar / quitar doble faz a la plantilla en curso (la de la tab). Al
  // activarlo, el dorso se deriva espejando el frente (backMirror). Deja el
  // espejo tipo "libro" (izq-der = 'x', lo validado por el usuario) si la
  // plantilla no traía uno; se puede cambiar arriba con "Cara: Dorso ↔/↕".
  // No toca la plantilla guardada hasta que se use "Guardar plantilla".
  const handleToggleDoubleSided = () => {
    const t = activeTab?.template;
    if (!t) return;
    const enabling = !t.doubleSided;
    handlePatchActiveTemplate({
      doubleSided: enabling,
      ...(enabling
        ? {
            backMirror: t.backMirror || 'x',
            backRotate180: typeof t.backRotate180 === 'boolean' ? t.backRotate180 : false,
          }
        : {}),
    });
    setToast(
      enabling
        ? { kind: 'success', text: 'Doble faz activado: elegí “Cara: Dorso” arriba para editar el reverso.' }
        : { kind: 'info', text: 'Doble faz quitado.' },
    );
  };

  // Renombrar el template = renombrar localmente la copia de la tab. No toca
  // la plantilla original guardada (que vive en templatesStore con su id
  // real). Para renombrar la guardada, hay que editarla desde el sidebar.
  const handleRenameTemplate = (template, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed === template.name) return;
    // Si es una plantilla guardada, con corte y sin override manual del cutId,
    // el QR/.plt sigue al nombre nuevo (como pediste).
    const followName = isSavedTemplate(template)
      && hasCuts(template)
      && !template.cutIdManual;
    const nextCutId = followName
      ? deriveCutId({ name: trimmed, sourceTemplateId: template.sourceTemplateId }).cutId
      : null;
    updateActiveTab((tab) => ({
      template: tab.template
        ? {
            ...tab.template,
            name: trimmed,
            ...(nextCutId ? { cutId: nextCutId, cutIdManual: false } : {}),
          }
        : tab.template,
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
      let saved = await update({
        ...rest,
        ...(tpl.sourceTemplateId ? { id: tpl.sourceTemplateId } : {}),
        name,
        categoria: categoria || undefined,
      });
      // Sellar el cutId derivado del NOMBRE (estable) salvo override manual. Se
      // hace con el id ya asignado por el store, así el sufijo de colisión es
      // estable y no depende de cuándo corrió el efecto de generación.
      let collidedCut = false;
      if (hasCuts(saved) && !tpl.cutIdManual) {
        const r = deriveCutId({ name: saved.name, sourceTemplateId: saved.id });
        collidedCut = r.collided;
        if (r.cutId !== saved.cutId) {
          saved = await update({ ...saved, cutId: r.cutId });
        }
      }
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
            ...(hasCuts(saved) && !tpl.cutIdManual
              ? { cutId: saved.cutId, cutIdManual: false }
              : {}),
          },
        };
      });
      setToast({
        kind: collidedCut ? 'info' : 'success',
        text: collidedCut
          ? `Plantilla "${saved.name}" guardada. Ya había otra con el mismo nombre: su QR/corte quedó como "${saved.cutId}" para no pisarlas.`
          : `Plantilla "${saved.name}" guardada en la lista.`,
      });
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
    conQr = true,
    gridParams,
  }) => {
    // Solo generamos cortes si va a poder usarlos (necesita marcas L para
    // que el plotter alinee). Con markMarginMm=0 la grilla es sin corte.
    const cortes = markMarginMm > 0
      ? generateCuts(cells, { cutShape, cutMarginMm })
      : [];
    // Doble faz: NO horneamos las celdas del dorso. Se derivan al vuelo desde
    // `celdas` espejando segun backMirror (cellPositions/mirrorCellsForBack).
    // Posicion (backMirror) y rotacion (backRotate180) son INDEPENDIENTES y se
    // ajustan con dos toggles en la UI. Default: espejo izquierda-derecha
    // ("libro", lo validado por el usuario), sin rotar. Mismo default que el
    // toggle de doble faz y que el combo automático.
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
      // ¿Se dibuja el QR de corte en la hoja? Al crear "Con QR" ya reservó la
      // franja inferior (las celdas vienen subidas en `cells`).
      conQr,
      backMirror: doubleSided ? 'x' : undefined,
      backRotate180: doubleSided ? false : undefined,
      singlePage: true,
      // Guardamos los parámetros crudos para poder re-editar medidas exacto.
      gridParams,
    };
    // Si la grilla se creó para posar un mazo Dobble, posamos encima en vez de
    // abrir una hoja vacía. La plantilla queda como "Guardar como plantilla…".
    if (gridForDobbleReceta) {
      const receta = gridForDobbleReceta;
      setGridForDobbleReceta(null);
      setGridModalOpen(false);
      tpl.name = doubleSided ? 'Plantilla Dobble doble faz' : 'Plantilla Dobble';
      poseDobbleOnTemplate(tpl, receta);
      return;
    }
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

  // Renderiza cada PIEZA del PDF (recorta la region de cada imagen desde la
  // pagina, componiendo mascaras/overlays) via el motor Python. Devuelve
  // { images, tmpDir } con la misma forma que extract (paths en tmpDir) o null.
  const regionsEntriesFromBytes = async (bytes) => {
    try {
      const res = await window.printlayout.pdf.renderRegions(bytes, 300);
      if (!res?.ok || !res.images?.length) return null;
      return { images: res.images, tmpDir: res.tmpDir };
    } catch (err) {
      console.error(err);
      return null;
    }
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
        // Si el PDF trae imagenes con transparencia (mascaras), las embebidas
        // salen como circulos/recuadros vacios: renderizamos cada PIEZA desde la
        // pagina (compone la mascara → el diseno real). Caso "tira de stickers".
        if (result.maskedImages) {
          const regions = await regionsEntriesFromBytes(bytes);
          if (regions) {
            if (result.tmpDir) {
              try { await window.printlayout.pdf.cleanupExtracted(result.tmpDir); } catch {}
            }
            setPdfExtract({
              fileName: file.name,
              tmpDir: regions.tmpDir,
              images: regions.images,
              mode: 'regions',
              pdfBytes: bytes,
            });
            return;
          }
          // Si el render de piezas falló, seguimos con las embebidas (tmpDir intacto).
        }
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

  // Importar VARIOS PDFs juntos (panel Fotos): acepta un File o un array. Los
  // encola; el effect de abajo los procesa de a uno (el modal de PDF es por
  // archivo). Cada PDF elegido suma sus imágenes al panel; al confirmar, sigue
  // el próximo solo.
  const handleImportPdfs = (input) => {
    const files = (Array.isArray(input) ? input : [input]).filter(Boolean);
    if (files.length === 0) return;
    setPdfQueue((q) => [...q, ...files]);
    if (files.length > 1) {
      setToast({ kind: 'info', text: `${files.length} PDFs en cola: los vas eligiendo de a uno.` });
    }
  };

  // Avanza la cola de PDFs: cuando no hay modal abierto ni extracción en curso y
  // quedan PDFs, procesa el siguiente. El ref sincrónico evita doble disparo.
  useEffect(() => {
    if (pdfExtract || extractingPdf || pdfQueueBusyRef.current || pdfQueue.length === 0) return;
    pdfQueueBusyRef.current = true;
    const [next, ...rest] = pdfQueue;
    setPdfQueue(rest);
    Promise.resolve(handleImportPdfImages(next)).finally(() => {
      pdfQueueBusyRef.current = false;
    });
  }, [pdfExtract, extractingPdf, pdfQueue]);

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

  // Modo "piezas": recorta cada imagen del PDF desde la pagina (compone
  // mascaras/overlays). Lo dispara el boton del modal si el auto no acerto.
  const handleSwitchToRegions = async () => {
    const ctx = pdfExtract;
    if (!ctx?.pdfBytes || extractingPdf) return;
    setExtractingPdf(true);
    try {
      const regions = await regionsEntriesFromBytes(ctx.pdfBytes);
      if (!regions) {
        setToast({ kind: 'error', text: 'No se pudieron recortar las piezas del PDF.' });
        return;
      }
      if (ctx.tmpDir) {
        try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
      }
      setPdfExtract({
        fileName: ctx.fileName,
        tmpDir: regions.tmpDir,
        images: regions.images,
        mode: 'regions',
        pdfBytes: ctx.pdfBytes,
      });
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `No se pudieron recortar las piezas: ${err.message}` });
    } finally {
      setExtractingPdf(false);
    }
  };

  const submitPdfExtract = async (chosen) => {
    const ctx = pdfExtract;
    setPdfExtract(null);
    const dest = pdfExtractDest;
    const pending = pdfExtractPending;
    if (!ctx || !chosen?.length) {
      setPdfExtractDest(null);
      setPdfExtractPending([]);
      if (ctx?.tmpDir) {
        try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
      }
      // Si el PDF era para el acomodar y había imágenes sueltas en el lote, abrí
      // el pack igual con esas (el usuario canceló solo la parte del PDF).
      if (dest && pending.length) {
        if (dest === 'autopack') setAutoPackFiles(pending);
        else setCountPackFiles(pending);
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
      // Destino = acomodar: las imágenes del PDF (+ las sueltas del lote) van al
      // pack, no al panel Fotos. Mismo modal/params que la importación normal.
      if (dest) {
        setPdfExtractDest(null);
        setPdfExtractPending([]);
        if (ctx?.tmpDir) {
          try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
        }
        const packFiles = [...pending, ...filesWithMeta.map((m) => m.file)];
        if (dest === 'autopack') setAutoPackFiles(packFiles);
        else setCountPackFiles(packFiles);
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
    const skipped = [];
    const out = await prepareIncomingImageFiles(files, {
      onHeicStart: (n) => setToast({
        kind: 'info',
        text: `Convirtiendo ${n} foto${n === 1 ? '' : 's'} de iPhone (HEIC)…`,
      }),
      onSkip: (s) => skipped.push(s),
    });
    reportImportSkips(skipped);
    return out;
  };

  const isPdfFile = (f) => (f?.type || '').toLowerCase().includes('pdf') || /\.pdf$/i.test(f?.name || '');

  // Arranca el acomodar (por tamaño o por cantidad). Si entre los archivos hay un
  // PDF, lo mandamos al MISMO modal de importar PDF (elegir páginas/imágenes,
  // "usar páginas enteras", copias); lo que el usuario elija alimenta el pack.
  // Las imágenes sueltas del mismo lote se juntan con lo que salga del PDF.
  const startPack = async (files, dest, setFiles) => {
    if (!files?.length) return;
    const pdfs = files.filter(isPdfFile);
    const imgs = files.filter((f) => !isPdfFile(f));
    const prepared = imgs.length ? await convertHeicWithToast(imgs) : [];
    if (pdfs.length === 0) {
      if (prepared.length) setFiles(prepared);
      return;
    }
    if (pdfs.length > 1) {
      setToast({ kind: 'info', text: 'Se procesa un PDF por vez; cargá los demás después.' });
    }
    setPdfExtractDest(dest);
    setPdfExtractPending(prepared);
    await handleImportPdfImages(pdfs[0]);
  };

  const handleStartAutoPack = (files) => startPack(files, 'autopack', setAutoPackFiles);
  const handleStartCountPack = (files) => startPack(files, 'countpack', setCountPackFiles);

  const submitCountPack = async ({
    paperWidthMm, paperHeightMm, pages, files, cellMapping,
    totalCells, uniqueUsed, totalInput, pageCount, countPerPage, conQr = false,
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
        // "Con QR": el acomodo ya reservó la franja del QR (celdas centradas con
        // lugar). conQr controla si el QR se dibuja cuando después agregás las
        // marcas de corte. Sin QR → false (no dibuja aunque agregues marcas).
        conQr,
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
    totalCells, uniqueUsed, totalInput, repeated, pageCount, conQr = false,
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
        // "Con QR": el acomodo ya reservó la franja del QR (celdas centradas con
        // lugar). conQr controla si el QR se dibuja al agregar las marcas.
        conQr,
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

  // Cortes por contorno. Separamos dos clases de cambio:
  //  - TRAZADO (caro: quita-fondo + Potrace): motor/tolerancia/umbral/tamaño/
  //    suavizado/simplificación → requiere tocar "Aplicar contorno".
  //  - MAPEO (barato: solo offset + filtrar huecos): sangría y huecos →
  //    se aplican AL INSTANTE (re-mapean sobre lo ya trazado, cacheOnly).
  const contourAssignSig = (layout.assignmentsFront || []).join(',');
  const pickByImage = (byImg, keys) => {
    if (!byImg) return null;
    const out = {};
    for (const [id, o] of Object.entries(byImg)) {
      const picked = {};
      for (const k of keys) if (o[k] !== undefined) picked[k] = o[k];
      if (Object.keys(picked).length) out[id] = picked;
    }
    return Object.keys(out).length ? out : null;
  };
  // includeHoles y suavizado ya NO afectan la máscara/trazado (detectHoles siempre
  // on; la unión/suavizado se hacen al mapear) → son MAPEO barato e instantáneo.
  const TRACE_KEYS = ['engine', 'tolerance', 'threshold', 'turdsize', 'alphamax', 'opttolerance'];
  const MAP_KEYS = ['bleedMm', 'includeHoles', 'smoothMm'];
  const contourTraceSig = selected?.cutShape === 'contour'
    ? JSON.stringify({
      e: selected.contourEngine ?? 'potrace',
      t: selected.contourTolerance ?? 32,
      th: selected.contourThreshold ?? 128,
      tu: selected.contourTurdsize ?? 2,
      a: selected.contourAlphamax ?? 1.0,
      o: selected.contourOpttolerance ?? 0.2,
      by: pickByImage(selected.contourByImage, TRACE_KEYS),
    })
    : '';
  // Sangría + huecos + suavizado son mapeo barato (offset/unión) → instantáneo.
  const contourMapSig = selected?.cutShape === 'contour'
    ? JSON.stringify({
      b: selected.contourBleedMm ?? 0,
      h: selected.contourIncludeHoles === true,
      s: selected.contourSmoothMm ?? 0.12,
      by: pickByImage(selected.contourByImage, MAP_KEYS),
    })
    : '';
  const appliedTraceSigRef = useRef('');
  const [contourComputing, setContourComputing] = useState(false);

  const computeContourNow = useCallback(async (cacheOnly = false) => {
    if (!selected || selected.cutShape !== 'contour') return;
    const cells = selected.celdas ?? [];
    const assignments = layout.assignmentsFront || [];
    if (!cells.length || !assignments.some(Boolean)) {
      if (!cacheOnly) appliedTraceSigRef.current = contourTraceSig;
      return;
    }
    const params = {
      engine: selected.contourEngine ?? 'potrace',
      tolerance: selected.contourTolerance ?? 32,
      threshold: selected.contourThreshold ?? 128,
      turdsize: selected.contourTurdsize ?? 2,
      alphamax: selected.contourAlphamax ?? 1.0,
      opttolerance: selected.contourOpttolerance ?? 0.2,
      bleedMm: selected.contourBleedMm ?? 0,
      includeHoles: selected.contourIncludeHoles === true,
      smoothMm: selected.contourSmoothMm ?? 0.12,
    };
    if (!cacheOnly) setContourComputing(true);
    try {
      const cortes = await contourCutsByAssignments(assignments, cells, layout.imageMap, {
        params,
        paramsByImage: selected.contourByImage || null,
        cache: contourCacheRef.current,
        cacheOnly,
      });
      handlePatchActiveTemplate({ cortes });
      if (!cacheOnly) appliedTraceSigRef.current = contourTraceSig;
    } catch (err) {
      console.error('Calcular contornos falló', err);
    } finally {
      if (!cacheOnly) setContourComputing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, layout.assignmentsFront, layout.imageMap, contourTraceSig]);

  // Auto FULL (traza): al entrar a Contorno o al cambiar las imágenes asignadas.
  useEffect(() => {
    if (!selected || selected.cutShape !== 'contour') return;
    computeContourNow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.cutShape, contourAssignSig]);

  // Instantáneo (cacheOnly): sangría/huecos → re-mapea sobre lo ya trazado.
  // Se salta hasta que haya al menos un trazado hecho (evita el flash inicial).
  useEffect(() => {
    if (!selected || selected.cutShape !== 'contour') return;
    if (!appliedTraceSigRef.current) return;
    computeContourNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contourMapSig]);

  // Cambios de TRAZADO sin aplicar → resalta el botón "Aplicar contorno".
  const contourDirty = selected?.cutShape === 'contour'
    && contourTraceSig !== appliedTraceSigRef.current;

  // Cuando la plantilla recien creada por auto-pack queda activa y el layout
  // hook ya tiene las celdas listas, asignamos las imagenes preloaded segun
  // el cellMapping (que puede repetir indices cuando es modo "repetir").
  useEffect(() => {
    if (!pendingAutoAssign) return;
    if (selected?.id !== pendingAutoAssign.templateId) return;
    if (layout.totalCellsCount === 0) return;
    // Idempotencia: loadImagesWithMapping AGREGA imágenes. En dev, StrictMode
    // corre el efecto dos veces con el mismo pendingAutoAssign → sin este guard
    // la imagen se cargaba duplicada en la lista. Procesamos cada objeto una vez.
    if (processedAutoAssignRef.current === pendingAutoAssign) return;
    processedAutoAssignRef.current = pendingAutoAssign;
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
    dbg(`[open] pendingLoad MATCH selected=${selected?.id} → loadFromJob images=${entry.images?.length ?? 0}`);
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
    // Nombre de archivo seguro para Windows: saca los invalidos < > : " / \ | ? *.
    // Conserva guiones y espacios (P-123-fotos ...).
    const safeFileName = (s) =>
      (String(s || 'pedido')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'pedido');
    try {
      setToast({ kind: 'info', text: `Procesando pedido de fotos ${label}…` });

      // Modo de entrega (config del intake): 'carpeta' guarda un .pljob por hoja
      // SIN abrir pestañas; 'abrir' deja cada hoja abierta para revisar.
      const cfg = await window.printlayout.intake.getConfig().catch(() => null);
      let modo = cfg?.modoEntrega === 'abrir' ? 'abrir' : 'carpeta';
      const outputDir = (cfg?.outputDir || '').replace(/[\\/]+$/, '');
      if (modo === 'carpeta' && !outputDir) {
        // Sin carpeta no podemos guardar: avisamos y caemos a 'abrir' (no perder el pedido).
        setToast({ kind: 'error', text: 'No hay carpeta de salida configurada: abro las hojas para revisar.' });
        modo = 'abrir';
      }

      const { specs, skipped } = await buildOrderJobs(order, {
        templates,
        readFileBytes: (p) => window.printlayout.intake.readFile(p),
      });

      // Config del server QR (carpeta de cortes + posición del QR). La usamos
      // para dejar el corte base por plancha y dibujar el QR en el PDF.
      const qrcutCfg = await window.printlayout.qrcut?.getConfig?.().catch(() => null);

      let delivered = 0;
      for (const spec of specs) {
        const payload = {
          name: spec.name,
          template: spec.template,
          images: spec.images,
          assignmentsFront: spec.assignmentsFront,
          assignmentsBack: spec.assignmentsBack,
          minPages: spec.minPages,
        };
        // Corte por QR de planchas FIJAS (presets). En AMBOS modos aseguramos el
        // corte base <planchaId>.plt (reusable, no se regenera si ya está). Las
        // grillas custom (planchaId=null) no llevan QR automático.
        if (spec.planchaId) {
          try {
            await window.printlayout.qrcut.ensureBaseCut({
              planchaId: spec.planchaId,
              cortes: spec.template.cortes,
              pageWidthMm: spec.template.pageWidthMm,
              pageHeightMm: spec.template.pageHeightMm,
              markMarginMm: spec.template.markMarginMm ?? 10,
              bladeOffsetMm,
            });
          } catch (_) { /* no bloquea la entrega del pedido */ }
        }
        if (modo === 'carpeta') {
          // <outputDir>/Pedidos/<nombre seguro>.pljob (autocontenido). El main
          // crea la subcarpeta "Pedidos" si no existe.
          const filePath = `${outputDir}/Pedidos/${safeFileName(spec.name)}.pljob`;
          try {
            const r = await window.printlayout.jobs.saveToPath(filePath, payload);
            if (r?.ok) delivered += 1;
          } catch (_) { /* si falla, queda sin entregar y el pedido se reintenta */ }
          // Además: PDF listo para imprimir CON el QR de la plancha dibujado
          // (camino rápido; el .pljob queda como fallback para retocar). Solo
          // presets: las planchas ya dejan lugar para el QR → sin reserva.
          if (spec.planchaId && qrcutCfg) {
            try {
              const imageMap = new Map(spec.images.map((im) => [im.id, im]));
              const bytes = await buildPdf(spec.template, spec.assignmentsFront, imageMap, {
                // Frente explícito (mismo que imprimir): con singlePage sin este
                // face buildPdf lo inferiría como 'back'.
                face: 'front',
                embedBackground: !spec.template.singlePage,
                qr: {
                  text: spec.planchaId,
                  sizeMm: qrcutCfg.qrSizeMm,
                  bottomMm: qrcutCfg.qrBottomMm,
                  centered: qrcutCfg.qrCentered,
                  showText: true,
                },
              });
              // El PDF listo-para-imprimir va a la RAÍZ de la carpeta de entrega
              // (a la vista, como los PDF de Dobble); el .pljob queda en /Pedidos
              // como fallback para retocar.
              const pdfPath = `${outputDir}/${safeFileName(spec.name)}.pdf`;
              await window.printlayout.intake.savePhotoPdf(pdfPath, bytes);
            } catch (_) { /* el .pljob ya quedó entregado; el PDF es un extra */ }
          }
        } else {
          let jobId = null;
          try {
            const r = await saveJobToDisk(payload);
            if (r?.ok && r.job) jobId = r.job.id;
          } catch (_) { /* si falla guardar, igual abrimos la tab para revisar */ }
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
          delivered += 1;
        }
      }

      const ok = delivered > 0;
      await window.printlayout.intake.orderBuilt({
        id: order.id,
        ok,
        error: ok ? undefined : (skipped.map((s) => `${s.label}: ${s.reason}`).join('; ') || 'nada para armar'),
      });

      if (ok) {
        const enCarpeta = modo === 'carpeta';
        try {
          // eslint-disable-next-line no-new
          new Notification('Llegó un pedido de fotos', {
            body: `${label}: ${delivered} hoja(s) ${enCarpeta ? 'guardada(s) en la carpeta' : 'lista(s) para revisar'}.`,
          });
        } catch (_) { /* sin permiso de notificaciones: el toast alcanza */ }
        setToast({
          kind: 'success',
          text: `${label}: ${delivered} hoja(s) ${enCarpeta ? 'guardada(s) en la carpeta (\\Pedidos)' : 'abiertas para revisar'}${skipped.length ? ` · ${skipped.length} tamaño(s) saltado(s)` : ''}.`,
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
  }, [templates, openInTab, saveJobToDisk, bladeOffsetMm]);

  useEffect(() => {
    const api = window.printlayout?.intake;
    if (!api?.onOrderReady) return undefined;
    return api.onOrderReady((order) => { handleIntakeOrder(order); });
  }, [handleIntakeOrder]);

  // Entrada automática Dobble (TOTALMENTE automático, sin clic): el main bajó
  // <id>/receta.json (+ caja.jpg si hay). Acá posamos el combo por defecto,
  // exportamos el PDF doble faz y lo GUARDAMOS EN LA CARPETA sin diálogo. Al
  // terminar confirmamos al main para que marque procesado + limpie el bucket.
  const handleDobbleIntakeOrder = useCallback(async (order) => {
    const id = order?.id;
    const label = `PR-${order?.numero_presupuesto || id}`;
    // bytes (IPC: Buffer→Uint8Array/ArrayBuffer) → dataUrl base64 en chunks
    // (evita desbordar el call stack de String.fromCharCode con imágenes grandes).
    const bytesToDataUrl = (raw, mime) => {
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return `data:${mime};base64,${btoa(bin)}`;
    };
    const mimeFromPath = (p) => {
      const ext = String(p || '').toLowerCase().split('.').pop();
      if (ext === 'png') return 'image/png';
      if (ext === 'webp') return 'image/webp';
      return 'image/jpeg';
    };
    try {
      setToast({ kind: 'info', text: `Procesando pedido busca2 ${label}…` });
      const cfg = await window.printlayout.intake.getConfig().catch(() => null);
      const comboId = cfg?.dobbleComboTemplateId || '';
      const outDir = (cfg?.dobbleOutputDir || '').replace(/[\\/]+$/, '');
      const comboBase = templates.find((t) => t.id === comboId) || null;

      // Sin combo o sin carpeta configurados no podemos exportar: NO marcamos
      // procesado (se reintenta cuando Mariano configure), avisamos.
      if (!comboBase) throw new Error('No hay plantilla combo busca2 configurada (elegila en Pedidos).');
      if (!outDir) throw new Error('No hay carpeta de salida busca2 configurada (elegila en Pedidos).');

      // Estampar el espejo/rotación del DORSO desde la config (default 'x' =
      // "libro", sin rotar). El combo guardado puede haberse creado antes de este
      // fix y NO traer backMirror → backMirrorAxis() caería al default 'y' y el
      // dorso quedaría mal ubicado. Los forzamos SIEMPRE con lo configurado.
      const combo = {
        ...comboBase,
        backMirror: cfg?.dobbleBackMirror === 'y' ? 'y' : 'x',
        backRotate180: !!cfg?.dobbleBackRotate180,
      };

      // 1) Leer receta.json (+ caja) desde temp (el main las bajó).
      const recetaBytes = await window.printlayout.intake.readFile(order.recetaPath);
      if (!recetaBytes) throw new Error('No se pudo leer la receta descargada.');
      const receta = JSON.parse(new TextDecoder('utf-8').decode(recetaBytes));
      let cajaDataUrl = null;
      if (order.cajaPath) {
        const cajaBytes = await window.printlayout.intake.readFile(order.cajaPath);
        if (cajaBytes) cajaDataUrl = bytesToDataUrl(cajaBytes, mimeFromPath(order.cajaPath));
      }

      // 2) Posar el combo (3 hojas A,A,B). La receta ya trae carta.fondoImagen y
      //    el dorso; la caja va al rol frente-caja vía caja.imagen.
      const { spec, warning, error } = await buildDobbleJob(receta, {
        template: combo,
        dobleFaz: order.doble_faz !== false,
        fondoImagen: receta?.carta?.fondoImagen || undefined,
        caja: cajaDataUrl ? { imagen: cajaDataUrl } : undefined,
      });
      if (error || !spec) throw new Error(error || 'No se pudo posar el mazo sobre el combo.');
      if (warning) console.warn('[intake-dobble]', warning);

      // 3) Exportar el PDF (doble faz si corresponde) → bytes, sin diálogo.
      const imageMap = new Map(spec.images.map((im) => [im.id, im]));
      const bytes = spec.template.doubleSided
        ? await buildDoubleSidedPdf(spec.template, spec.assignmentsFront, spec.assignmentsBack, imageMap)
        : await buildPdf(spec.template, spec.assignmentsFront, imageMap);

      // 4) Guardar SOLO en la carpeta (sin diálogo). El main arma el nombre
      //    "PR-<presupuesto> - <nombre del mazo>.pdf".
      const saved = await window.printlayout.dobble.saveSilent(
        outDir, order.numero_presupuesto, order.nombre_mazo, bytes,
      );
      if (!saved?.ok) throw new Error(saved?.error || 'No se pudo guardar el PDF.');
      const fileName = saved.fileName || 'PDF';

      await window.printlayout.intake.dobbleOrderBuilt({ id, ok: true });
      try {
        // eslint-disable-next-line no-new
        new Notification('Pedido busca2 procesado', {
          body: `${label}: ${spec.minPages} hoja(s) guardadas en la carpeta.${warning ? ' (aviso: ' + warning + ')' : ''}`,
        });
      } catch (_) { /* sin permiso de notificaciones */ }
      setToast({ kind: 'success', text: `${label}: PDF busca2 guardado (${fileName})${warning ? ' · ' + warning : ''}.` });
    } catch (err) {
      console.error('[intake-dobble] armado falló:', err);
      try {
        await window.printlayout.intake.dobbleOrderBuilt({ id, ok: false, error: err.message });
      } catch (_) { /* ignore */ }
      setToast({ kind: 'error', text: `Error procesando el pedido busca2 ${label}: ${err.message}` });
    }
  }, [templates]);

  useEffect(() => {
    const api = window.printlayout?.intake;
    if (!api?.onDobbleOrderReady) return undefined;
    return api.onDobbleOrderReady((order) => { handleDobbleIntakeOrder(order); });
  }, [handleDobbleIntakeOrder]);

  // Entrada automática de RÓTULOS (sin clic). La receta viene INLINE en la fila
  // (no baja nada del bucket): el arte y la fuente ya están en el catálogo
  // local/compartido de esta PC. Mapeamos la receta web → la spec del escritorio
  // y generamos el PDF con el MISMO motor probado (buildRotulosPdfBytes: raster
  // 600dpi, marcas L, QR, corte fijo) → guardamos en la carpeta sin diálogo → al
  // confirmar, el main marca procesado.
  const handleRotuloIntakeOrder = useCallback(async (order) => {
    const id = order?.id;
    const label = `PR-${order?.numero_presupuesto || id}`;
    try {
      setToast({ kind: 'info', text: `Procesando pedido de rótulos ${label}…` });
      const cfg = await window.printlayout.intake.getConfig().catch(() => null);
      const outDir = (cfg?.rotulosOutputDir || '').replace(/[\\/]+$/, '');
      if (!outDir) throw new Error('No hay carpeta de salida de rótulos configurada (elegila en Pedidos).');

      // overrides puede venir como objeto jsonb o como string JSON.
      let ov = order?.overrides ?? {};
      if (typeof ov === 'string') { try { ov = JSON.parse(ov); } catch { ov = {}; } }
      if (!ov || typeof ov !== 'object') ov = {};

      // Receta web → spec del escritorio (la MISMA que arma RotulosPlanchaModal y
      // que consume buildRotulosPdfBytes). Claves: planchaId/modeloId/fontId/text/
      // color + (de overrides) noBox/boxColor/boxPadMm/outline/lineModes/boxOverrides.
      const spec = {
        planchaId: order.plancha_id,
        modeloId: order.modelo_id,
        fontId: order.tipografia_id,
        text: order.nombre || '',
        color: order.color || '#000000',
        noBox: !!ov.noBox,
        boxColor: ov.boxColor || '#ffffff',
        // objeto {grande,intermedio,chico} o número; padForSize maneja ambos + default 0.8.
        boxPadMm: ov.boxPadMm ?? undefined,
        outline: ov.outline || null,
        lineModes: ov.lineModes || {},
        boxOverrides: ov.boxOverrides || {},
      };
      if (!spec.planchaId) throw new Error('El pedido no trae plancha_id.');
      if (!spec.modeloId) throw new Error('El pedido no trae modelo_id.');
      if (!spec.fontId) throw new Error('El pedido no trae tipografia_id.');

      // Asegurar el corte base .plt de la plancha (idempotente), igual que el
      // flujo manual (handleRotulosSubmit): así cada pedido que entra deja el
      // .plt garantizado en la carpeta Cortes QR, sin depender de haber armado
      // esa plancha a mano. best-effort: no bloquea generar el PDF.
      try {
        const tpl = buildRotulosTemplate(spec.planchaId, spec);
        await window.printlayout.qrcut.ensureBaseCut({
          planchaId: tpl.cutId,
          cortes: tpl.cortes,
          pageWidthMm: tpl.pageWidthMm,
          pageHeightMm: tpl.pageHeightMm,
          markMarginMm: tpl.markMarginMm,
          bladeOffsetMm,
        });
      } catch { /* best-effort: el .plt no bloquea generar el PDF */ }

      // Genera con el motor probado. Si el modelo/fuente no están en el catálogo
      // local, buildRotulosPdfBytes lanza → cae al catch → NO se marca procesado
      // (se reintenta cuando el modelo se publique/copie a esta PC). El QR queda
      // en automático (config del server QR + qrId de la plancha), igual que a mano.
      const bytes = await buildRotulosPdfBytes(spec);

      const saved = await window.printlayout.intake.saveRotuloPdf(
        outDir, order.numero_presupuesto, order.nombre, bytes,
      );
      if (!saved?.ok) throw new Error(saved?.error || 'No se pudo guardar el PDF.');
      const fileName = saved.fileName || 'PDF';

      await window.printlayout.intake.rotuloOrderBuilt({ id, ok: true });
      try {
        // eslint-disable-next-line no-new
        new Notification('Pedido de rótulos procesado', {
          body: `${label}: PDF guardado en la carpeta (${fileName}).`,
        });
      } catch (_) { /* sin permiso de notificaciones */ }
      setToast({ kind: 'success', text: `${label}: PDF de rótulos guardado (${fileName}).` });
    } catch (err) {
      console.error('[intake-rotulos] armado falló:', err);
      try {
        await window.printlayout.intake.rotuloOrderBuilt({ id, ok: false, error: err.message });
      } catch (_) { /* ignore */ }
      setToast({ kind: 'error', text: `Error procesando el pedido de rótulos ${label}: ${err.message}` });
    }
  }, [bladeOffsetMm]);

  useEffect(() => {
    const api = window.printlayout?.intake;
    if (!api?.onRotuloOrderReady) return undefined;
    return api.onRotuloOrderReady((order) => { handleRotuloIntakeOrder(order); });
  }, [handleRotuloIntakeOrder]);

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
    const dest = pdfExtractDest;
    const pending = pdfExtractPending;
    setPdfExtract(null);
    setPdfExtractDest(null);
    setPdfExtractPending([]);
    if (ctx?.tmpDir) {
      try { await window.printlayout.pdf.cleanupExtracted(ctx.tmpDir); } catch {}
    }
    // Acomodar con imágenes sueltas del lote aunque se cancele la parte del PDF.
    if (dest && pending.length) {
      if (dest === 'autopack') setAutoPackFiles(pending);
      else setCountPackFiles(pending);
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

  // Borra una plantilla del REPOSITORIO COMPARTIDO: desaparece de esta PC y de
  // todas las demas (en su proximo sync). Solo para plantillas ya compartidas
  // y en PCs con permiso de escritura (canShare). Es irreversible.
  const handleDeleteShared = async (id) => {
    if (isTemplateOfficial(id) && !isLaRecta) {
      setToast({ kind: 'error', text: 'Es una plancha oficial: solo La Recta puede borrarla.' });
      return;
    }
    const name = templates.find((t) => t.id === id)?.name || 'la plantilla';
    setToast({ kind: 'info', text: `Borrando "${name}" de todas las PCs…` });
    try {
      const res = await removeShared(id);
      if (res?.ok) {
        setToast({ kind: 'success', text: `"${name}" borrada de todas las PCs.` });
      } else {
        setToast({ kind: 'error', text: `No se pudo borrar: ${res?.error ?? 'error'}` });
      }
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo borrar: ${err.message}` });
    }
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

  // --- Editor de plantillas (modal "Plantillas") ---

  // Parámetros de grilla para re-editar medidas. Usa los guardados (gridParams)
  // y, si no están (plantillas viejas), los reconstruye desde las celdas lo mejor
  // posible para dar un punto de partida; el preview en vivo permite ajustar.
  const gridParamsForEdit = (t) => {
    const round = (n) => Math.round((Number(n) || 0) * 10) / 10;
    if (t?.gridParams) return t.gridParams;
    const cells = Array.isArray(t?.celdas) ? t.celdas : [];
    if (cells.length === 0) {
      return {
        paperW: t?.pageWidthMm, paperH: t?.pageHeightMm,
        cellW: 50, cellH: 50, margin: 0, spacingX: 0, spacingY: 0,
        cutMargin: t?.cutMarginMm || 0, markMargin: t?.markMarginMm ?? 10,
        cutShape: t?.cutShape || 'rect', diameter: 0, rotateMode: 'auto',
      };
    }
    const xs = cells.map((c) => Number(c.x));
    const ys = cells.map((c) => Number(c.y));
    const cellW = round(cells[0].w);
    const cellH = round(cells[0].h);
    const uniq = (arr) => Array.from(new Set(arr.map((n) => round(n)))).sort((a, b) => a - b);
    const colXs = uniq(xs);
    const rowYs = uniq(ys);
    const spacingX = colXs.length > 1 ? round(colXs[1] - colXs[0] - cellW) : 0;
    const spacingY = rowYs.length > 1 ? round(rowYs[1] - rowYs[0] - cellH) : 0;
    const isCircle = t?.cutShape === 'circle';
    return {
      paperW: t?.pageWidthMm, paperH: t?.pageHeightMm,
      cellW, cellH,
      margin: Math.max(0, Math.min(round(Math.min(...xs)), round(Math.min(...ys)))),
      spacingX: Math.max(0, spacingX), spacingY: Math.max(0, spacingY),
      cutMargin: t?.cutMarginMm || 0, markMargin: t?.markMarginMm ?? 10,
      cutShape: t?.cutShape || 'rect',
      diameter: isCircle ? cellW : 0,
      rotateMode: 'auto',
    };
  };

  const handleSaveTemplateDetails = async (template, { name, categoria, catalogoId }) => {
    if (template.oficial && !isLaRecta) {
      setToast({ kind: 'error', text: 'Es una plancha oficial: solo La Recta puede editarla.' });
      return;
    }
    const trimmedName = (name || '').trim();
    // El id de catálogo solo se toca en oficiales y en modo La Recta.
    const idEditable = template.oficial && isLaRecta && catalogoId !== undefined;
    let nextCatId = template.catalogoId;
    if (idEditable) {
      const next = (catalogoId || '').trim();
      if (!next) {
        setToast({ kind: 'error', text: 'El id de catálogo no puede quedar vacío.' });
        return;
      }
      const clash = templates.find((t) => t.id !== template.id && t.catalogoId === next);
      if (clash) {
        setToast({ kind: 'error', text: `El id "${next}" ya lo usa "${clash.name}". Elegí otro.` });
        return;
      }
      nextCatId = next;
    }
    const idChanged = idEditable && nextCatId !== template.catalogoId;
    try {
      const updated = await update({
        ...template,
        name: trimmedName,
        categoria: (categoria || '').trim() || undefined,
        ...(idEditable ? { catalogoId: nextCatId } : {}),
      });
      let msg = '';
      if (idChanged) {
        // Reacomodar el catálogo: baja la fila vieja (activo=false) y publica la
        // nueva. La fila vieja conserva su id (PK) pero queda inactiva.
        try {
          const oldId = template.catalogoId;
          if (oldId) {
            await window.printlayout.intake.publishCatalog([
              { ...catalogRowForTemplate(updated, false), id: oldId },
            ]);
          }
          const r = await window.printlayout.intake.publishCatalog([
            catalogRowForTemplate(updated, true),
          ]);
          msg = r?.ok ? ' Catálogo actualizado.' : ` (catálogo: ${r?.error || 'no actualizado'})`;
        } catch (e) {
          msg = ` (catálogo: ${e.message})`;
        }
      }
      setToast({ kind: 'success', text: `Plantilla "${updated.name}" actualizada.${msg}` });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo guardar: ${err.message}` });
    }
  };

  const handleDuplicateTemplate = async (template) => {
    try {
      // Copia EDITABLE: id nuevo, sin estado de oficial/compartido.
      const {
        id: _i, oficial: _o, catalogoId: _c,
        sharedAt: _sa, sharedHash: _sh, createdAt: _ca, updatedAt: _ua,
        ...rest
      } = template;
      const saved = await update({ ...rest, name: `${template.name} (copia)` });
      setToast({ kind: 'success', text: `Se creó "${saved.name}".` });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo duplicar: ${err.message}` });
    }
  };

  const handleEditTemplateGeometry = (template) => {
    if (template.oficial && !isLaRecta) {
      setToast({ kind: 'error', text: 'Es una plancha oficial: solo La Recta puede editarla.' });
      return;
    }
    if (template.pdfBase64) {
      setToast({ kind: 'error', text: 'Las plantillas de PDF se editan subiendo el PDF de nuevo, no acá.' });
      return;
    }
    setEditGeometryTemplate(template);
  };

  // Guarda nuevas medidas sobre la MISMA plantilla (conserva id/nombre/carpeta/
  // oficial). Regenera cortes y, si es doble faz, conserva espejo/rotación.
  const submitEditGeometry = async ({
    paperWidthMm, paperHeightMm, cells,
    cutMarginMm = 0, markMarginMm = 0, cutShape = 'rect', doubleSided = false,
    conQr = true, gridParams,
  }) => {
    const base = editGeometryTemplate;
    setEditGeometryTemplate(null);
    if (!base) return;
    const cortes = markMarginMm > 0
      ? generateCuts(cells, { cutShape, cutMarginMm })
      : [];
    try {
      await update({
        ...base,
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
        conQr,
        backMirror: doubleSided ? (base.backMirror || 'x') : undefined,
        backRotate180: doubleSided ? !!base.backRotate180 : undefined,
        backFlip: undefined,
        singlePage: true,
        gridParams,
      });
      setToast({ kind: 'success', text: `Medidas de "${base.name}" actualizadas.` });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo guardar: ${err.message}` });
    }
  };

  const handleOpenTemplateFromManager = (id) => {
    setTemplatesManagerOpen(false);
    handleSelectTemplate(id);
  };

  // Renombra una carpeta = mueve TODAS sus plantillas a la nueva categoría.
  // (La carpeta "General" = sin carpeta, no se renombra; para crear una nueva,
  // se asigna desde el editor de cada plantilla.)
  const handleRenameCategoria = async (oldId, newName) => {
    const target = (newName || '').trim();
    if (!oldId || oldId === 'General' || target === oldId) return;
    const affected = templates.filter((t) => (t.categoria || '').trim() === oldId);
    if (affected.length === 0) return;
    try {
      for (const t of affected) {
        await update({ ...t, categoria: target || undefined });
      }
      setToast({
        kind: 'success',
        text: target
          ? `Carpeta "${oldId}" → "${target}" (${affected.length} plantilla${affected.length === 1 ? '' : 's'}).`
          : `Carpeta "${oldId}" eliminada; sus plantillas quedaron sin carpeta.`,
      });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo renombrar la carpeta: ${err.message}` });
    }
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

  // Reparar PDF (para Corel): elige uno o varios PDF (típico Canva "bloqueado")
  // y Ghostscript los re-destila → copia "<nombre>_reparado.pdf" al lado, editable.
  const handleRepairPdf = async () => {
    try {
      setToast({ kind: 'info', text: 'Reparando PDF… puede tardar unos segundos.' });
      const r = await window.printlayout.pdf.repair();
      if (r?.canceled) { setToast(null); return; }
      if (!r?.ok) {
        setToast({ kind: 'error', text: `No se pudo reparar: ${r?.error ?? 'error'}` });
        return;
      }
      const okOnes = (r.results || []).filter((x) => x.ok);
      const failed = (r.results || []).filter((x) => !x.ok);
      if (okOnes.length === 0) {
        setToast({ kind: 'error', text: `No se pudo reparar: ${failed[0]?.error ?? 'error'}` });
        return;
      }
      let text = okOnes.length === 1
        ? `PDF reparado: "${okOnes[0].name}_reparado.pdf". Ya lo podés abrir en Corel.`
        : `${okOnes.length} PDF reparados (copia "_reparado" al lado de cada original).`;
      if (failed.length) text += ` ${failed.length} no se pudo reparar.`;
      setToast({ kind: 'success', text, path: okOnes[0].path });
    } catch (err) {
      setToast({ kind: 'error', text: `No se pudo reparar: ${err.message}` });
    }
  };

  // Descargar una imagen (como quedó editada) a disco. Abre "Guardar como" y
  // escribe el PNG. El nombre sugerido = nombre original sin extensión + .png
  // (el dataUrl interno siempre es PNG, aunque el archivo original fuera JPG).
  const handleDownloadImage = async (imageId) => {
    const img = layout.imageMap.get(imageId);
    if (!img?.dataUrl) return;
    const base = String(img.name || 'imagen')
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'imagen';
    try {
      const result = await window.printlayout.pdf.saveImage(`${base}.png`, img.dataUrl);
      if (result?.canceled) {
        setToast(null);
      } else if (result?.error) {
        setToast({ kind: 'error', text: `No se pudo descargar: ${result.error}` });
      } else if (result?.path) {
        setToast({ kind: 'success', text: 'Imagen descargada', path: result.path });
      }
    } catch (err) {
      console.error('Descargar imagen falló:', err);
      setToast({ kind: 'error', text: `No se pudo descargar: ${err.message}` });
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
      // Rótulos: el PDF lo genera el MOTOR PROBADO (marcas L + QR + corte fijo),
      // no el render normal. Mismo camino de guardado que el resto.
      if (selected.rotulos) {
        const bytes = await buildRotulosPdfBytes(selected.rotulos, { qr: selected.conQr === false ? null : undefined });
        const safe = `${(selected.name || 'Rotulos').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
        const r = await window.printlayout.pdf.save(safe, bytes);
        if (r?.canceled) setToast(null);
        else if (r?.error) setToast({ kind: 'error', text: `Error al guardar: ${r.error}` });
        else if (r?.path) setToast({ kind: 'success', text: 'PDF guardado', path: r.path });
        return;
      }
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

  // IO puro para escribir <cutId>.plt en la carpeta del server QR, SIN tocar
  // estado de UI (toast/cutting). Lo usa el guardado automático al imprimir.
  // Mismo destino y payload que el botón manual "Guardar corte QR"
  // (handleExportCutToQr), que queda intacto. Devuelve {ok, error?}.
  const saveCutToQrFolder = async () => {
    try {
      const cfg = await window.printlayout.qrcut.getConfig();
      const dir = (cfg?.cortesDir || '').trim();
      if (!dir) return { ok: false, error: 'no hay carpeta de cortes configurada' };
      const sep = dir.includes('\\') || !dir.includes('/') ? '\\' : '/';
      const outPath = `${dir.replace(/[\\/]+$/, '')}${sep}${selected.cutId}.plt`;
      const result = await window.printlayout.plotter.exportCut({
        cortes: selected.cortes,
        pageWidthMm: selected.pageWidthMm,
        pageHeightMm: selected.pageHeightMm,
        markMarginMm: selected.markMarginMm ?? 10,
        bladeOffsetMm,
        outPath,
      });
      return result?.ok ? { ok: true, bytes: result.bytes } : { ok: false, error: result?.error ?? 'desconocido' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
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
      let result;
      if (selected.rotulos) {
        // Rótulos: el PDF lo genera el MOTOR PROBADO; lo rasterizamos y lo
        // mandamos por el MISMO camino de impresión silent que el resto.
        const bytes = await buildRotulosPdfBytes(selected.rotulos, { qr: selected.conQr === false ? null : undefined });
        const allImages = await renderPdfBytesToImages(bytes, 240);
        let images = allImages;
        if (Array.isArray(pages) && pages.length > 0) images = pages.map((i) => allImages[i]).filter(Boolean);
        result = await window.printlayout.pdf.print({
          defaultName: `${(selected.name || 'Rotulos').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`,
          images,
          pageWidthMm: selected.pageWidthMm,
          pageHeightMm: selected.pageHeightMm,
          deviceName,
          copies,
          showDialog: false,
        });
      } else {
        result = await printLayoutPdf(selected, assignments, layout.imageMap, {
          layoutFitMode,
          embedBackground: !isBack && !selected.singlePage,
          // Cara explicita: sino buildPdf la infiere de embedBackground y, en una
          // grilla doble faz (singlePage), el frente se tomaria como dorso y no
          // dibujaria las marcas de corte.
          face,
          faceLabel: selected.doubleSided ? (isBack ? 'dorso' : 'frente') : undefined,
          paperWidthMm: customPaper?.widthMm,
          paperHeightMm: customPaper?.heightMm,
          // El QR es parte de la hoja con corte: se imprime SOLO en el frente, en
          // la misma posición que la vista previa. Solo si la hoja tiene cortes,
          // nombre, config cargada y el interruptor "QR" prendido (conQr).
          qr: (!isBack && (selected.conQr ?? true) && hasCuts(selected) && selected.cutId && qrConfig) ? {
            text: selected.cutId,
            sizeMm: qrConfig.qrSizeMm,
            bottomMm: qrConfig.qrBottomMm,
            centered: qrConfig.qrCentered,
            showText: true,
          } : undefined,
          deviceName,
          copies,
          pages,
          drawMarks: cutMarks !== false,
          showDialog: false,
        });
      }
      if (result?.canceled) {
        setToast(null);
      } else if (result?.ok) {
        const base = selected.doubleSided
          ? `Enviado a la impresora (${isBack ? 'dorso' : 'frente'}).`
          : 'Enviado a la impresora.';
        // Guardado AUTOMÁTICO del corte al imprimir: así no hay que acordarse de
        // apretar "Guardar corte QR". Se hace solo en el frente que lleva el QR,
        // con la MISMA condición con que se dibuja el QR (línea ~2607) → el .plt
        // guardado siempre corresponde al QR impreso. Best-effort: si falla, avisa
        // pero NO tumba el "Enviado a la impresora". El botón manual sigue igual.
        let cutNote = '';
        if (!isBack && (selected.conQr ?? true) && hasCuts(selected) && selected.cutId && qrConfig) {
          const cut = await saveCutToQrFolder();
          cutNote = cut.ok
            ? ` Corte "${selected.cutId}.plt" guardado en la carpeta QR.`
            : ` ⚠ No se pudo guardar el corte automáticamente (${cut.error}). Usá "Guardar corte QR".`;
        }
        setToast({ kind: 'success', text: base + cutNote });
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

  // Guardar el corte: escribe SOLO <cutId>.plt en la carpeta del server QR
  // (mismo payload TB26 que va por socket). El cutId es el nombre editable de la
  // hoja, el MISMO que dibuja el QR → el .plt matchea el QR impreso. Sobrescribe
  // si ya existe (misma hoja): NO se renombra, así el QR sigue apuntando bien.
  // Imprimir es una acción separada; la impresión ya lleva el QR por ser parte
  // de la hoja.
  const handleExportCutToQr = async () => {
    if (!selected || !hasCuts(selected) || cutting) return;
    const cutId = selected.cutId;
    if (!cutId) {
      setToast({ kind: 'error', text: 'La hoja todavía no tiene nombre de corte.' });
      return;
    }
    setCutting(true);
    setToast(null);
    try {
      const cfg = await window.printlayout.qrcut.getConfig();
      const dir = (cfg?.cortesDir || '').trim();
      if (!dir) {
        setToast({ kind: 'error', text: 'No hay carpeta de cortes configurada. Abrí el panel "Corte QR" y elegí una.' });
        return;
      }
      // Respetar el separador propio de la carpeta (Windows/UNC vs POSIX).
      const sep = dir.includes('\\') || !dir.includes('/') ? '\\' : '/';
      const outPath = `${dir.replace(/[\\/]+$/, '')}${sep}${cutId}.plt`;
      const result = await window.printlayout.plotter.exportCut({
        cortes: selected.cortes,
        pageWidthMm: selected.pageWidthMm,
        pageHeightMm: selected.pageHeightMm,
        markMarginMm: selected.markMarginMm ?? 10,
        bladeOffsetMm,
        outPath,
      });
      if (result?.ok) {
        setToast({
          kind: 'success',
          text: `Corte "${cutId}.plt" guardado en la carpeta QR (${result.bytes} bytes). El QR de la hoja apunta a ese nombre — imprimí y escaneá.`,
        });
      } else {
        setToast({ kind: 'error', text: `No se pudo guardar: ${result?.error ?? 'desconocido'}` });
      }
    } catch (err) {
      console.error(err);
      setToast({ kind: 'error', text: `Error guardando el corte: ${err.message}` });
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

  // Reporta al proceso principal cuántas tabs tienen cambios sin guardar. El
  // main usa ese número para mostrar (o no) el aviso de cierre con un diálogo
  // NATIVO — así la decisión no depende de que el renderer responda. Antes el
  // main preguntaba al renderer (executeJavaScript) y, si el renderer estaba
  // colgado, la app no se cerraba y el instalador "no la podía cerrar".
  // El trabajo igual queda auto-guardado y se restaura al reabrir.
  useEffect(() => {
    const n = tabs.filter((t) => t.isDirty).length;
    window.printlayout?.app?.setDirtyCount?.(n);
  }, [tabs]);

  // Aviso de fotos que NO se pudieron importar (HEIC que no convirtió, formato
  // no soportado, archivo ilegible). Se registra una vez y cubre todos los
  // flujos de importación. Antes desaparecían en silencio sin decir cuáles.
  useEffect(() => {
    setImportSkipReporter((skipped) => {
      const names = skipped.map((s) => s.name).filter(Boolean);
      const shown = names.slice(0, 6).join(', ');
      const more = names.length > 6 ? ` y ${names.length - 6} más` : '';
      const heic = skipped.filter((s) => /heic/i.test(s.reason || '')).length;
      const motivo = heic === skipped.length
        ? 'son HEIC que no se pudieron convertir'
        : heic > 0
          ? 'la mayoría son HEIC que no se pudieron convertir'
          : (skipped[0]?.reason || 'no se pudieron leer');
      setToast({
        kind: 'error',
        text: `No se importaron ${skipped.length} foto${skipped.length === 1 ? '' : 's'}: ${shown}${more}. Motivo: ${motivo}.`,
      });
    });
    return () => setImportSkipReporter(null);
  }, []);

  // Auto-update: escuchar status del main y mostrar banner cuando este listo.
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  useEffect(() => {
    if (!window.printlayout?.updater?.onStatus) return undefined;
    return window.printlayout.updater.onStatus((s) => {
      if (s.kind === 'ready') {
        setUpdateInfo({ version: s.version });
        setUpdateChecking(false);
      } else if (s.kind === 'available') {
        // La descarga arranca sola (autoDownload). Avisamos y liberamos el botón.
        setUpdateChecking(false);
        setToast({ kind: 'info', text: `Descargando actualización${s.version ? ` v${s.version}` : ''}… te aviso cuando esté lista.` });
      } else if (s.kind === 'none') {
        setUpdateChecking(false);
        setToast({ kind: 'success', text: 'Ya tenés la última versión instalada.' });
      } else if (s.kind === 'error') {
        setUpdateChecking(false);
        console.warn('[updater]', s.error);
        setToast({ kind: 'error', text: `No se pudo buscar actualizaciones: ${s.error}` });
      }
    });
  }, []);

  // Botón "Actualizar": busca una versión nueva y la baja ahora (sin cerrar la
  // app). El resto del flujo (descargando → lista) llega por los eventos de
  // arriba; cuando queda lista aparece el banner "Reiniciar e instalar".
  const handleCheckUpdates = async () => {
    if (updateChecking || !window.printlayout?.updater?.checkNow) return;
    setUpdateChecking(true);
    setToast({ kind: 'info', text: 'Buscando actualizaciones…' });
    try {
      const r = await window.printlayout.updater.checkNow();
      if (!r?.ok) {
        setUpdateChecking(false);
        setToast({ kind: 'error', text: r?.error || 'No se pudo buscar actualizaciones.' });
      }
      // Si ok: los eventos update-available / update-not-available / ready
      // continúan el flujo y liberan updateChecking.
    } catch (err) {
      setUpdateChecking(false);
      setToast({ kind: 'error', text: `Error buscando actualizaciones: ${err.message}` });
    }
  };

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
          onExportCutToQr={handleExportCutToQr}
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
          onOpenTemplates={() => setTemplatesManagerOpen(true)}
          onOpenRotulos={() => setRotulosOpen(true)}
          onEditRotulos={selected?.rotulos ? () => { setRotulosPlanchaInit({ ...selected.rotulos, editing: true }); setRotulosPlanchaOpen(true); } : null}
          onOpenPdfToImage={() => setPdfToImageOpen(true)}
          onRepairPdf={handleRepairPdf}
          onCheckUpdates={handleCheckUpdates}
          updateChecking={updateChecking}
          onOpenIntake={isLaRecta ? () => setIntakePanelOpen(true) : undefined}
          onOpenQrCut={() => setQrCutPanelOpen(true)}
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
            qr={(selected?.conQr ?? true) && hasCuts(selected) && selected.cutId && qrConfig ? {
              text: selected.cutId,
              sizeMm: qrConfig.qrSizeMm,
              bottomMm: qrConfig.qrBottomMm,
              centered: qrConfig.qrCentered,
            } : null}
            onPageChange={(p) => {
              setCurrentPage(p);
              layout.setSelectedCell(null);
            }}
            onCellClick={handleCellClick}
            onCellContextMenu={(_cellIdx, img) => {
              if (img?.id) setEditingImageId(img.id);
            }}
            onSetFocalPoint={(imageId, fp) => layout.updateImage(imageId, { focalPoint: fp })}
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
            onSetCutId={(v) => updateActiveTab((tab) => (tab.template
              // Editar el nombre a mano = override manual: ese valor gana y NO lo
              // pisa el slug del nombre. Vaciarlo vuelve a "derivado del nombre"
              // (el efecto de generación lo re-deriva).
              ? { template: { ...tab.template, cutId: v, cutIdManual: !!v }, isDirty: true }
              : {}))}
            onSetConQr={(v) => updateActiveTab((tab) => (tab.template
              ? { template: { ...tab.template, conQr: v }, isDirty: true }
              : {}))}
            dobbleBusy={dobbleBusy}
            onReposeDobble={handleReposeDobble}
            onChangeDobbleColor={handleDobbleColor}
            onSetDobbleImage={handleDobbleImage}
            onClearDobbleImage={handleDobbleClearImage}
            onToggleDoubleSided={handleToggleDoubleSided}
            onChangeWhiteBorder={(v) => handlePatchActiveTemplate({ cellWhiteBorderMm: v })}
            onChangeBorderLine={(v) => handlePatchActiveTemplate({ cellBorderLineMm: v })}
            onChangeBorderColor={(v) => handlePatchActiveTemplate({ cellBorderColor: v })}
            onUpdateTemporal={handleUpdateTemporalTemplate}
            onApplyContour={computeContourNow}
            contourDirty={contourDirty}
            contourComputing={contourComputing}
            onSaveTemporal={(tpl) => setSaveTemplatePrompt(tpl)}
            onAddImages={handleAddImages}
            onImportPdfImages={handleImportPdfs}
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
            onDownloadImage={handleDownloadImage}
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
            layoutFitMode={layoutFitMode}
            onResetFocalPoint={(imageId) => layout.updateImage(imageId, { focalPoint: null })}
            onSetImageFrame={(imageId, frame) => layout.updateImage(imageId, { frame })}
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
          zClass="z-[60]"
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
            onCancel={() => { setGridModalOpen(false); setGridForDobbleReceta(null); }}
            presets={paperPresetList}
            onOpenPresetsEditor={() => setPresetsModalOpen(true)}
            qrConfig={qrConfig}
            showQrReserve={!gridForDobbleReceta}
            defaultCutShape={gridForDobbleReceta ? 'circle' : 'rect'}
            {...(gridForDobbleReceta ? {
              title: 'Plantilla redonda para el mazo Dobble',
              description: 'Definí hoja, separación, diámetro de celda y corte circular. Las cartas se posan sobre estas celdas. El ⌀ de la carta = diámetro de celda − 2× margen de corte.',
              submitLabel: 'Crear y posar',
            } : {})}
          />
        )}

        <TemplatesManagerModal
          open={templatesManagerOpen}
          templates={templates}
          categorias={categoriasList}
          isLaRecta={isLaRecta}
          canShare={canShare}
          onSaveDetails={handleSaveTemplateDetails}
          onDuplicate={handleDuplicateTemplate}
          onDelete={handleDelete}
          onDeleteShared={handleDeleteShared}
          onToggleOficial={handleToggleOficial}
          onEditGeometry={handleEditTemplateGeometry}
          onOpenInTab={handleOpenTemplateFromManager}
          onRenameCategoria={handleRenameCategoria}
          onClose={() => setTemplatesManagerOpen(false)}
        />

        <RotulosManagerModal
          open={rotulosOpen}
          onClose={() => setRotulosOpen(false)}
        />

        <RotulosPlanchaModal
          open={rotulosPlanchaOpen}
          init={rotulosPlanchaInit}
          onSubmit={handleRotulosSubmit}
          onClose={() => { setRotulosPlanchaOpen(false); setRotulosPlanchaInit(null); }}
        />

        {editGeometryTemplate && (
          <GridUploadModal
            open
            key={editGeometryTemplate.id}
            initial={{
              ...gridParamsForEdit(editGeometryTemplate),
              doubleSided: !!editGeometryTemplate.doubleSided,
              conQr: editGeometryTemplate.conQr !== false,
            }}
            title={`Editar medidas — ${editGeometryTemplate.name}`}
            description="Cambiá medidas, márgenes, separación y cortes. Se guarda sobre la misma plantilla."
            submitLabel="Guardar medidas"
            onConfirm={submitEditGeometry}
            onCancel={() => setEditGeometryTemplate(null)}
            presets={paperPresetList}
            onOpenPresetsEditor={() => setPresetsModalOpen(true)}
            qrConfig={qrConfig}
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

        <QrCutPanelModal
          open={qrCutPanelOpen}
          onClose={() => {
            setQrCutPanelOpen(false);
            // La posición del QR / prefijo pudo cambiar: refrescar para el preview.
            window.printlayout?.qrcut?.getConfig?.().then((c) => setQrConfig(c || null)).catch(() => {});
          }}
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
          onSwitchToRegions={handleSwitchToRegions}
        />

        <ImagePackModal
          open={!!autoPackFiles}
          files={autoPackFiles ?? []}
          onConfirm={submitAutoPack}
          onCancel={() => setAutoPackFiles(null)}
          qrConfig={qrConfig}
        />

        <ImageCountPackModal
          open={!!countPackFiles}
          files={countPackFiles ?? []}
          onConfirm={submitCountPack}
          onCancel={() => setCountPackFiles(null)}
          qrConfig={qrConfig}
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
          onDeleteSharedTemplate={handleDeleteShared}
          canShare={canShare}
          isLaRecta={isLaRecta}
          onToggleOficial={handleToggleOficial}
          onClose={() => setNewTabModalOpen(false)}
          onPickTemplate={(id) => handleSelectTemplate(id)}
          onCreateGrid={() => { setNewTabModalOpen(false); setGridModalOpen(true); }}
          onAutoPack={() => newTabAutoPickerRef.current?.click()}
          onCountPack={() => newTabCountPickerRef.current?.click()}
          onUploadPdf={() => blankPdfInputRef.current?.click()}
          onOpenJobsList={() => setJobsListOpen(true)}
          onImportDobble={() => { setNewTabModalOpen(false); handleImportDobble(); }}
          onCreateRotulos={(init) => { setNewTabModalOpen(false); setRotulosPlanchaInit(init); setRotulosPlanchaOpen(true); }}
        />

        <DobblePoseModal
          open={!!dobblePose}
          receta={dobblePose?.receta}
          templates={templates}
          busy={dobbleBusy}
          onPickTemplate={handlePosePickTemplate}
          onCreateTemplate={handlePoseCreateTemplate}
          onCreateCombo={handlePoseCreateCombo}
          onClose={() => setDobblePose(null)}
        />

        <DobbleComboModal
          open={dobbleComboOpen}
          templates={templates}
          busy={dobbleBusy}
          onConfirm={handleCreateCombo}
          onCancel={() => { setDobbleComboOpen(false); setComboForReceta(null); }}
        />

        <input
          ref={newTabAutoPickerRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
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
          accept="image/jpeg,image/png,image/jpg,image/heic,image/heif,.heic,.heif,application/pdf,.pdf"
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
              sheetImages={layout.images}
              onApply={(updates) => layout.updateImage(croppingImageId, updates)}
              onApplyAll={(entries) => {
                layout.updateImages(entries);
                setToast({
                  kind: 'success',
                  text: `Recorte aplicado a ${entries.length} ${entries.length === 1 ? 'imagen' : 'imágenes'}. (Ctrl+Z para deshacer)`,
                });
              }}
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
              sheetImages={layout.images}
              onSave={(updates) => layout.updateImage(editingImageId, updates)}
              onApplyAll={(entries) => {
                layout.updateImages(entries);
                setToast({
                  kind: 'success',
                  text: `Edición aplicada a ${entries.length} ${entries.length === 1 ? 'imagen' : 'imágenes'}. (Ctrl+Z para deshacer)`,
                });
              }}
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
