import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import TopBar from './components/TopBar.jsx';
import TemplatesSidebar from './components/TemplatesSidebar.jsx';
import LayoutCanvas from './components/LayoutCanvas.jsx';
import PropertiesSidebar from './components/PropertiesSidebar.jsx';
import PromptModal from './components/PromptModal.jsx';
import PdfUploadModal from './components/PdfUploadModal.jsx';
import ImageEditorModal from './components/ImageEditorModal.jsx';
import { useTemplates } from './hooks/useTemplates.js';
import { useLayoutEditor } from './hooks/useLayoutEditor.js';
import { readImageFiles } from './lib/images.js';
import {
  exportLayoutToPdf,
  exportDoubleSidedLayoutToPdf,
  printLayoutPdf,
} from './lib/exportPdf.js';
import { hasCuts, templateOrientation, imageOrientation } from './lib/templates.js';
import { facesBoundingBox } from './lib/faceDetection.js';
import { cropImageDataUrl } from './lib/imageCrop.js';
import { rotateImageDataUrl90CW } from './lib/imageRotate.js';

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
  const [selectedId, setSelectedId] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const [viewingFace, setViewingFace] = useState('front');
  const layout = useLayoutEditor(selected, viewingFace);

  // Si la plantilla deja de ser doble-faz, volvemos al frente.
  useEffect(() => {
    if (!selected?.doubleSided && viewingFace !== 'front') {
      setViewingFace('front');
    }
  }, [selected?.doubleSided, viewingFace]);
  const cellPickerRef = useRef(null);
  const pendingCellRef = useRef(null);

  const [activeDrag, setActiveDrag] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [toast, setToast] = useState(null);
  const [layoutFitMode, setLayoutFitMode] = useState('contain');
  const [currentPage, setCurrentPage] = useState(0);
  const [showCuts, setShowCuts] = useState(true);
  // Override de tamano fisico de hoja para esta sesion. null = usar plantilla.
  // No persiste; se resetea al cambiar de plantilla.
  const [customPaper, setCustomPaper] = useState(null);

  useEffect(() => {
    setCustomPaper(null);
  }, [selected?.id]);

  // Sync inicial al arrancar: cuando termina de cargar las plantillas locales,
  // pulla el manifest remoto. Si trae cambios, refresca local y avisa con un
  // toast. Solo corre una vez, no entorpece nada si falla (red caida, etc).
  const syncedOnceRef = useRef(false);
  useEffect(() => {
    if (templatesLoading || syncedOnceRef.current) return;
    syncedOnceRef.current = true;
    runSyncWithToast({ silent: true });
  }, [templatesLoading, syncPull]);

  const handleShare = async (template) => {
    if (!template || sharing) return;
    setSharing(true);
    setToast(null);
    try {
      const r = await share(template);
      if (r?.ok) {
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
  // Modal de subida de PDF (margen + doble faz).
  const [pdfUpload, setPdfUpload] = useState(null);
  // Imagen abierta en el editor.
  const [editingImageId, setEditingImageId] = useState(null);

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
  useEffect(() => {
    if (layout.selectedCell === null || !selected) return;
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        layout.clearCell(layout.selectedCell);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, selected]);

  const handleUploadPdf = (file) => {
    if (uploading) return;
    setPdfUpload({ file });
  };

  const handleEditMargin = () => {
    if (!selected) return;
    setMarginPrompt({ defaultValue: String(selected.markMarginMm ?? 10) });
  };

  const submitPdfUpload = async ({ margin: rawMargin, doubleSided }) => {
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
      });
      setSelectedId(saved.id);
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

  const handleDelete = async (id) => {
    await remove(id);
    if (id === selectedId) setSelectedId(null);
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
            faces: [],
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
        // Las caras detectadas previamente ya no aplican; las invalidamos.
        faces: [],
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

  const handleExport = async () => {
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

  const handlePrint = async (face = 'front') => {
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
    setPrinting(face);
    setToast(null);
    // Defensa en profundidad: si por algún motivo la promesa nunca resuelve
    // (callback de Chromium colgado), liberamos el botón a los 10s.
    const safety = setTimeout(() => setPrinting(false), 10000);
    try {
      const result = await printLayoutPdf(selected, assignments, layout.imageMap, {
        layoutFitMode,
        embedBackground: !isBack && !selected.singlePage,
        faceLabel: selected.doubleSided ? (isBack ? 'dorso' : 'frente') : undefined,
        paperWidthMm: customPaper?.widthMm,
        paperHeightMm: customPaper?.heightMm,
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
      clearTimeout(safety);
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
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

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
      <div className="flex h-screen flex-col bg-ink-950 text-ink-100">
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
        />
        <div className="flex flex-1 overflow-hidden">
          <TemplatesSidebar
            templates={templates}
            selectedId={selectedId}
            uploading={uploading}
            syncing={syncing}
            onSelect={setSelectedId}
            onUploadPdf={handleUploadPdf}
            onDelete={handleDelete}
            onSync={() => runSyncWithToast()}
          />
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
            onShare={handleShare}
            onEditMargin={handleEditMargin}
            onAddImages={handleAddImages}
            onRemoveImage={layout.removeImage}
            onClearCell={layout.clearCell}
            onClearAll={layout.clearAll}
            onAddImageToCell={layout.addImageToCell}
            onFillAll={(imageId) => {
              const cellsPP = layout.cellsPerPage;
              const start = currentPage * cellsPP;
              const end = start + cellsPP;
              const pageSlice = layout.assignments.slice(start, end);
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
            onCycleFit={(imageId, value) =>
              layout.updateImage(imageId, { fitOverride: value })
            }
            onSelectImage={(imageId) => {
              const idx = layout.assignments.findIndex((id) => id === imageId);
              if (idx >= 0) {
                const page = Math.floor(idx / layout.cellsPerPage);
                if (page !== currentPage) setCurrentPage(page);
                layout.setSelectedCell(idx);
              }
            }}
          />
        </div>

        <input
          ref={cellPickerRef}
          type="file"
          accept="image/jpeg,image/png,image/jpg"
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

        <PdfUploadModal
          open={!!pdfUpload}
          fileName={pdfUpload?.file?.name}
          onConfirm={submitPdfUpload}
          onCancel={() => setPdfUpload(null)}
        />

        {(() => {
          const editingImage = editingImageId
            ? layout.imageMap.get(editingImageId)
            : null;
          if (!editingImage) return null;
          return (
            <ImageEditorModal
              open
              image={editingImage}
              onSave={(updates) => layout.updateImage(editingImageId, updates)}
              onClose={() => setEditingImageId(null)}
            />
          );
        })()}

        {toast && (
          <div
            className={`pointer-events-auto fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-2xl ${
              toast.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
                : 'border-red-500/40 bg-red-500/15 text-red-100'
            }`}
          >
            <span>{toast.text}</span>
            {toast.path && (
              <button
                onClick={() => window.printlayout.shell.showItem(toast.path)}
                className="rounded border border-emerald-400/40 px-2 py-0.5 text-xs hover:bg-emerald-500/20"
              >
                Mostrar en carpeta
              </button>
            )}
            <button
              onClick={() => setToast(null)}
              className="text-xs text-ink-300 hover:text-ink-100"
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
