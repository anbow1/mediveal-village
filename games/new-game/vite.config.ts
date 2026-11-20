import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    // Keep three un-prebundled in dev mode so KTX2Loader's `new URL('../libs/basis/basis_transcoder.*', import.meta.url)`
    // resolves cleanly instead of hitting Vite's SPA HTML fallback!
    exclude: ['three'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
