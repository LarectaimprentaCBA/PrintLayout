const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printlayout', {
  version: '0.2.0',
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (template) => ipcRenderer.invoke('templates:save', template),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    parsePdf: (bytes, opts) =>
      ipcRenderer.invoke('templates:parse-pdf', { bytes, ...(opts || {}) }),
    canShare: () => ipcRenderer.invoke('templates:can-share'),
    syncPull: () => ipcRenderer.invoke('templates:sync-pull'),
    share: (template) => ipcRenderer.invoke('templates:share', template),
    deleteShared: (id) => ipcRenderer.invoke('templates:delete-shared', id),
  },
  // Rótulos escolares (cargar tipografías + modelos).
  rotulos: {
    fontsList: () => ipcRenderer.invoke('rotulos:fonts-list'),
    fontAdd: () => ipcRenderer.invoke('rotulos:font-add'),
    fontRemove: (id) => ipcRenderer.invoke('rotulos:font-remove', id),
    modelsList: () => ipcRenderer.invoke('rotulos:models-list'),
    modelSave: (payload) => ipcRenderer.invoke('rotulos:model-save', payload),
    modelRemove: (id) => ipcRenderer.invoke('rotulos:model-remove', id),
    readImage: (filePath) => ipcRenderer.invoke('rotulos:read-image', filePath),
    readFont: (id) => ipcRenderer.invoke('rotulos:read-font', id),
    savePdf: (defaultName, bytes) => ipcRenderer.invoke('rotulos:save-pdf', { defaultName, bytes }),
  },
  workStates: {
    list: () => ipcRenderer.invoke('work-states:list'),
    load: (templateId) => ipcRenderer.invoke('work-states:load', templateId),
    save: (templateId, state) =>
      ipcRenderer.invoke('work-states:save', { templateId, state }),
    delete: (templateId) => ipcRenderer.invoke('work-states:delete', templateId),
  },
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    load: (id) => ipcRenderer.invoke('jobs:load', id),
    save: (payload) => ipcRenderer.invoke('jobs:save', payload),
    delete: (id) => ipcRenderer.invoke('jobs:delete', id),
    saveAs: (payload, defaultName) =>
      ipcRenderer.invoke('jobs:save-as', { payload, defaultName }),
    saveToPath: (filePath, payload) =>
      ipcRenderer.invoke('jobs:save-to-path', { path: filePath, payload }),
    openFromFile: () => ipcRenderer.invoke('jobs:open-from-file'),
    loadFromPath: (filePath) =>
      ipcRenderer.invoke('jobs:load-from-path', { path: filePath }),
  },
  openTabs: {
    load: () => ipcRenderer.invoke('open-tabs:load'),
    save: (payload) => ipcRenderer.invoke('open-tabs:save', payload),
  },
  paperPresets: {
    list: () => ipcRenderer.invoke('paper-presets:list'),
    save: (preset) => ipcRenderer.invoke('paper-presets:save', preset),
    delete: (id) => ipcRenderer.invoke('paper-presets:delete', id),
    canSync: () => ipcRenderer.invoke('paper-presets:can-sync'),
    syncPull: () => ipcRenderer.invoke('paper-presets:sync-pull'),
    syncPush: () => ipcRenderer.invoke('paper-presets:sync-push'),
  },
  plotter: {
    sendCut: (payload) => ipcRenderer.invoke('plotter:send-cut', payload),
    // Escribe el corte como .plt en la carpeta del server QR (no lo envía por socket).
    exportCut: (payload) => ipcRenderer.invoke('plotter:export-cut', payload),
  },
  dobble: {
    importRecipe: () => ipcRenderer.invoke('dobble:import-recipe'),
    // Guardado silencioso del PDF final (sin diálogo) para el exportador
    // automático. El main arma el nombre "PR-<presupuesto> - <mazo>.pdf".
    saveSilent: (dir, numeroPresupuesto, nombreMazo, bytes) =>
      ipcRenderer.invoke('dobble:save-pdf-silent', { dir, numeroPresupuesto, nombreMazo, bytes }),
    // Elegir el PDF ya armado de un mazo de catálogo (mapa mazo_id → PDF).
    choosePdf: () => ipcRenderer.invoke('dobble:choose-pdf'),
  },
  contour: {
    tracePotrace: (arrayBuffer, opts) =>
      ipcRenderer.invoke('contour:trace-potrace', arrayBuffer, opts),
  },
  pdf: {
    save: (defaultName, bytes) =>
      ipcRenderer.invoke('export:save-pdf', { defaultName, bytes }),
    saveImage: (defaultName, dataUrl) =>
      ipcRenderer.invoke('export:save-image', { defaultName, dataUrl }),
    repair: () => ipcRenderer.invoke('pdf:repair'),
    print: (payload) => ipcRenderer.invoke('print:pdf', payload),
    listPrinters: () => ipcRenderer.invoke('print:list-printers'),
    openPrinterConfig: (deviceName) =>
      ipcRenderer.invoke('print:open-printer-config', { deviceName }),
    resetPrinterConfig: (deviceName) =>
      ipcRenderer.invoke('print:reset-printer-config', { deviceName }),
    hasPrinterConfig: (deviceName) =>
      ipcRenderer.invoke('print:has-printer-config', { deviceName }),
    extractImages: (bytes) => ipcRenderer.invoke('pdf:extract-images', { bytes }),
    readExtractedImage: (filePath) =>
      ipcRenderer.invoke('pdf:read-extracted-image', { path: filePath }),
    cleanupExtracted: (tmpDir) =>
      ipcRenderer.invoke('pdf:cleanup-extracted', { tmpDir }),
    toImageSaveBatch: (files) =>
      ipcRenderer.invoke('pdf-to-image:save-batch', { files }),
  },
  shell: {
    showItem: (p) => ipcRenderer.invoke('shell:show-item', p),
  },
  updater: {
    onStatus: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
    installNow: () => ipcRenderer.invoke('updater:install-now'),
    checkNow: () => ipcRenderer.invoke('updater:check-now'),
  },
  app: {
    // Reporta cuántas tabs tienen cambios sin guardar (el main lo usa para el
    // aviso de cierre, sin depender de que el renderer responda).
    setDirtyCount: (n) => ipcRenderer.send('app:dirty-count', n),
  },
  // Entrada automática de pedidos de fotos (Supabase).
  intake: {
    getConfig: () => ipcRenderer.invoke('intake:get-config'),
    isLaRecta: () => ipcRenderer.invoke('intake:is-la-recta'),
    setConfig: (patch) => ipcRenderer.invoke('intake:set-config', patch),
    setActive: (activo) => ipcRenderer.invoke('intake:set-active', activo),
    chooseDir: () => ipcRenderer.invoke('intake:choose-dir'),
    testConnection: () => ipcRenderer.invoke('intake:test-connection'),
    pollNow: () => ipcRenderer.invoke('intake:poll-now'),
    readFile: (localPath) => ipcRenderer.invoke('intake:read-file', localPath),
    orderBuilt: (payload) => ipcRenderer.invoke('intake:order-built', payload),
    dobbleOrderBuilt: (payload) => ipcRenderer.invoke('intake:dobble-order-built', payload),
    // Guarda silencioso el PDF listo-para-imprimir de un pedido de fotos.
    savePhotoPdf: (filePath, bytes) =>
      ipcRenderer.invoke('intake:save-photo-pdf', { filePath, bytes }),
    publishCatalog: (rows) => ipcRenderer.invoke('intake:publish-catalog', rows),
    publishConfig: (clave, valor) => ipcRenderer.invoke('intake:publish-config', { clave, valor }),
    // Eventos push del main:
    onOrderReady: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('intake:order-ready', handler);
      return () => ipcRenderer.removeListener('intake:order-ready', handler);
    },
    onDobbleOrderReady: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('intake:dobble-order-ready', handler);
      return () => ipcRenderer.removeListener('intake:dobble-order-ready', handler);
    },
    onStatus: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('intake:status', handler);
      return () => ipcRenderer.removeListener('intake:status', handler);
    },
    onLog: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('intake:log', handler);
      return () => ipcRenderer.removeListener('intake:log', handler);
    },
  },
  // Servidor de corte QR (nuestra File Center, reemplazo de QRFileCut.exe).
  qrcut: {
    getConfig: () => ipcRenderer.invoke('qrcut:get-config'),
    getStatus: () => ipcRenderer.invoke('qrcut:get-status'),
    setConfig: (patch) => ipcRenderer.invoke('qrcut:set-config', patch),
    reconnect: () => ipcRenderer.invoke('qrcut:reconnect'),
    chooseDir: () => ipcRenderer.invoke('qrcut:choose-dir'),
    // Asegura el corte base <planchaId>.plt en la carpeta QR (lo genera si falta).
    ensureBaseCut: (payload) => ipcRenderer.invoke('qrcut:ensure-base-cut', payload),
    // Eventos push del main:
    onStatus: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('qrcut:status', handler);
      return () => ipcRenderer.removeListener('qrcut:status', handler);
    },
    onLog: (cb) => {
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('qrcut:log', handler);
      return () => ipcRenderer.removeListener('qrcut:log', handler);
    },
  },
});
