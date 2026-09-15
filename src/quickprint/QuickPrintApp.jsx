import React, { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import PrinterBar from './PrinterBar.jsx';
import PdfView from './PdfView.jsx';

// PhotoView arrastra el motor de detección de caras (~3.7 MB). Carga diferida:
// abrir SOLO un PDF no lo baja (la ventana abre más rápido).
const PhotoView = lazy(() => import('./PhotoView.jsx'));

const LS_PRINTER = 'quickprint.printer';

export default function QuickPrintApp() {
  const [photos, setPhotos] = useState([]);   // [{path,name}]
  const [pdfs, setPdfs] = useState([]);       // [{path,name}]
  const [unsupported, setUnsupported] = useState([]);
  const [mode, setMode] = useState('loading'); // loading|photos|pdf|empty

  const [printers, setPrinters] = useState([]);
  const [deviceName, setDeviceName] = useState('');
  const [pageInfo, setPageInfo] = useState(null);
  const [colorActive, setColorActive] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);

  // Cargar archivos + suscribir a nuevos (si se hace clic derecho de nuevo).
  useEffect(() => {
    let dead = false;
    const apply = (p) => {
      if (dead || !p) return;
      setPhotos((prev) => [...prev, ...(p.photos || [])]);
      setPdfs((prev) => [...prev, ...(p.pdfs || [])]);
      setUnsupported((prev) => [...prev, ...(p.unsupported || [])]);
    };
    window.printlayout.quickprint.getFiles().then(apply);
    const off = window.printlayout.quickprint.onFilesAdded(apply);
    return () => { dead = true; off && off(); };
  }, []);

  // Decidir el modo inicial cuando llegan archivos.
  useEffect(() => {
    if (mode !== 'loading') return;
    if (photos.length) setMode('photos');
    else if (pdfs.length) setMode('pdf');
    else if (unsupported.length) setMode('empty');
  }, [photos, pdfs, unsupported, mode]);

  // Impresoras + impresora recordada / default.
  useEffect(() => {
    window.printlayout.pdf.listPrinters().then((r) => {
      const list = (r && r.printers) || [];
      setPrinters(list);
      const saved = localStorage.getItem(LS_PRINTER);
      const pick = (saved && list.find((p) => p.name === saved) && saved)
        || (list.find((p) => p.isDefault)?.name)
        || (list[0]?.name) || '';
      setDeviceName(pick);
    });
  }, []);

  // pageInfo + cartel de color al cambiar de impresora.
  const refreshPageInfo = useCallback((dev) => {
    if (!dev) { setPageInfo(null); return; }
    window.printlayout.quickprint.pageInfo(dev).then((r) => setPageInfo(r && r.ok ? r : null));
    window.printlayout.color?.resolveActive?.(dev).then((r) => setColorActive(!!(r && r.active))).catch(() => setColorActive(false));
  }, []);

  useEffect(() => {
    if (deviceName) { localStorage.setItem(LS_PRINTER, deviceName); refreshPageInfo(deviceName); }
  }, [deviceName, refreshPageInfo]);

  const onConfigure = async () => {
    if (!deviceName) return;
    setConfiguring(true);
    try {
      await window.printlayout.pdf.openPrinterConfig(deviceName);
      refreshPageInfo(deviceName); // el papel puede haber cambiado
    } finally { setConfiguring(false); }
  };

  const close = () => window.printlayout.quickprint.close();

  const onPhotosDone = () => { if (pdfs.length) setMode('pdf'); else close(); };

  return (
    <div style={wrap}>
      <PrinterBar
        printers={printers}
        deviceName={deviceName}
        onDeviceChange={setDeviceName}
        onConfigure={onConfigure}
        configuring={configuring}
        pageInfo={pageInfo}
        colorActive={colorActive}
        busy={busy}
      />
      {unsupported.length > 0 && (
        <div style={warnBox}>
          No se pueden imprimir estos archivos (formato no soportado):{' '}
          {unsupported.map((f) => f.name).join(', ')}
        </div>
      )}

      {mode === 'loading' && <div style={{ opacity: 0.7 }}>Cargando…</div>}
      {mode === 'empty' && (
        <div style={{ opacity: 0.8 }}>
          No hay fotos ni PDF para imprimir.
          <div style={{ marginTop: 12 }}><button style={btn} onClick={close}>Cerrar</button></div>
        </div>
      )}
      {mode === 'photos' && (
        <Suspense fallback={<div style={{ opacity: 0.7 }}>Preparando…</div>}>
          <PhotoView
            files={photos}
            deviceName={deviceName}
            pageInfo={pageInfo}
            busy={busy}
            setBusy={setBusy}
            onDone={onPhotosDone}
            onCancel={close}
            hasPdfQueue={pdfs.length > 0}
          />
        </Suspense>
      )}
      {mode === 'pdf' && (
        <PdfView
          files={pdfs}
          deviceName={deviceName}
          pageInfo={pageInfo}
          busy={busy}
          setBusy={setBusy}
          onDone={close}
        />
      )}
    </div>
  );
}

const wrap = {
  display: 'flex', flexDirection: 'column', gap: 12,
  padding: 16, minHeight: '100vh', boxSizing: 'border-box',
  background: '#0b0d10', color: '#e5e7eb',
  fontFamily: 'system-ui, Segoe UI, sans-serif',
};
const warnBox = {
  background: '#3b2a12', color: '#fbbf24', border: '1px solid #6b4e1a',
  borderRadius: 6, padding: '8px 10px', fontSize: 12,
};
const btn = {
  background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer',
};
