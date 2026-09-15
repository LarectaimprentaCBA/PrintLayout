// Aplica una calibración de color a páginas PNG al imprimir (lado main).
// Decodifica/codifica PNG con nativeImage (rápido, C++) y corre el bucle de píxeles en un
// worker_threads para no congelar la UI. Un worker por trabajo de impresión.
'use strict';
const path = require('path');
const { nativeImage } = require('electron');
const { Worker } = require('worker_threads');

class ColorApplier {
  constructor(lut) {
    this.lut = lut; // { V, S }
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
    this._readyPromise = null;
  }

  async _ensure() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(path.join(__dirname, 'lutWorker.cjs'));
      } catch (e) { reject(e); return; }
      this.worker.on('message', (m) => {
        if (m.type === 'ready') { resolve(); return; }
        if (m.type === 'done') {
          const cb = this.pending.get(m.id);
          if (cb) { this.pending.delete(m.id); cb(m); }
        }
      });
      this.worker.on('error', (e) => {
        for (const cb of this.pending.values()) cb({ error: e });
        this.pending.clear();
        reject(e);
      });
      // Enviar la LUT como Array plano (se copia una vez).
      this.worker.postMessage({ type: 'init', V: Array.from(this.lut.V), size: this.lut.S });
    });
    return this._readyPromise;
  }

  // pngBuffer (Buffer) → { buffer, ok, reason, ms }. Si algo falla, buffer = original
  // (best-effort: nunca rompe la impresión) y ok=false con el motivo.
  async applyPng(pngBuffer) {
    const t0 = Date.now();
    try {
      await this._ensure();
      const img = nativeImage.createFromBuffer(pngBuffer);
      const { width, height } = img.getSize();
      if (!width || !height) return { buffer: pngBuffer, ok: false, reason: 'no se pudo decodificar la hoja', ms: Date.now() - t0 };
      const bmp = img.toBitmap(); // Buffer BGRA
      const ab = bmp.buffer.slice(bmp.byteOffset, bmp.byteOffset + bmp.byteLength);
      const id = ++this.seq;
      const res = await new Promise((resolve) => {
        this.pending.set(id, resolve);
        this.worker.postMessage({ type: 'apply', id, buffer: ab, width, height }, [ab]);
      });
      if (res.error || !res.buffer) return { buffer: pngBuffer, ok: false, reason: 'el proceso de corrección falló', ms: Date.now() - t0 };
      const out = nativeImage.createFromBitmap(Buffer.from(res.buffer), { width, height });
      const png = out.toPNG();
      if (!png || !png.length) return { buffer: pngBuffer, ok: false, reason: 'no se pudo recodificar la hoja', ms: Date.now() - t0 };
      return { buffer: png, ok: true, reason: null, ms: Date.now() - t0 };
    } catch (e) {
      return { buffer: pngBuffer, ok: false, reason: e.message || 'error desconocido', ms: Date.now() - t0 };
    }
  }

  dispose() {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* noop */ } this.worker = null; }
    this.pending.clear();
    this._readyPromise = null;
  }
}

module.exports = { ColorApplier };
