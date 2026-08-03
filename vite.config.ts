import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The panel lives under `/admin` (Caddy `handle_path /admin*` strips the prefix
 * before the service sees the request — game repo deploy/Caddyfile). Assets are
 * therefore built with base `/admin/` while the server serves `dist/client` at
 * its own root; the browser-visible prefix and the stripped service paths meet
 * in the middle. Dev mirrors production: Vite serves at /admin/ and proxies
 * `/admin/api` onto the local API with the prefix stripped.
 */
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    // Never inline assets as data: URIs — the production CSP declares
    // font-src 'self' (game repo deploy/Caddyfile), and data:-inlined Inter
    // subsets were silently refused there (system-font fallback, console full
    // of CSP violations). Files are same-origin and cacheable instead.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5174,
    proxy: {
      '/admin/api': {
        target: 'http://127.0.0.1:8082',
        rewrite: (path) => path.replace(/^\/admin/, ''),
      },
    },
  },
});
