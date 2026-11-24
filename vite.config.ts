import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes every asset path relative, so the same build works at
// https://<user>.github.io/<repo>/ (GitHub Pages), at a custom domain root,
// or behind any CDN without changes.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // pdf.js's worker ships as .mjs; save it as .js so every static host
        // (GitHub Pages included) serves it as JavaScript.
        assetFileNames: (info) => (info.names?.[0] ?? '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
