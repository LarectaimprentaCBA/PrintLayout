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
  },
  pdf: {
    save: (defaultName, bytes) =>
      ipcRenderer.invoke('export:save-pdf', { defaultName, bytes }),
    print: (payload) => ipcRenderer.invoke('print:pdf', payload),
    extractImages: (bytes) => ipcRenderer.invoke('pdf:extract-images', { bytes }),
    readExtractedImage: (filePath) =>
      ipcRenderer.invoke('pdf:read-extracted-image', { path: filePath }),
    cleanupExtracted: (tmpDir) =>
      ipcRenderer.invoke('pdf:cleanup-extracted', { tmpDir }),
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
});
