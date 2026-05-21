import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    // Version del package.json embebida en el bundle. Asi el renderer la
    // muestra sin necesidad de IPC. Si bumpea el version, hay que rebuilder.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['face-api.js'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
