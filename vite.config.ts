import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'esnext',
    // Brutale Minifizierung für mobile Ladezeiten
    minify: 'esbuild',
    // Warnung, falls wir die Dateigrößen-Grenze sprengen (unsere Qualitätskontrolle)
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Trennt Vendor-Code (Phaser) von unserer Logik für perfektes Cloudflare Edge-Caching
        manualChunks: {
          phaser: ['phaser']
        }
      }
    }
  }
});