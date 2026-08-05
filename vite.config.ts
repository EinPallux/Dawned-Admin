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
  optimizeDeps: {
    /**
     * `@dawned/shared` is the sibling game checkout, linked with `file:`. Vite
     * pre-bundles it like any other dependency and then caches the result
     * against a version that never changes, so a rebuild in the game repo
     * leaves the panel importing yesterday's copy — the failure looks like
     * "does not provide an export named X" for a symbol that plainly exists.
     * Excluding it costs one extra dev request and makes the link honest.
     */
    exclude: ['@dawned/shared'],
  },
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
    /**
     * Watch the linked `@dawned/shared` dist as well.
     *
     * Vite ignores everything under `node_modules/`, and `@dawned/shared` is a
     * `file:` link INTO node_modules — so rebuilding it in the game repo left
     * a dev server that had been running since before the rebuild serving the
     * module text it read at boot. The symptom is identical to the stale
     * pre-bundle `optimizeDeps.exclude` above already fixes ("does not provide
     * an export named X" for a symbol that plainly exists in the file on
     * disk), which is what makes it so easy to chase twice. Un-ignoring the
     * package makes a game-side `pnpm --filter @dawned/shared build` reload the
     * panel instead of requiring someone to know to restart it.
     */
    watch: {
      ignored: ['!**/node_modules/@dawned/shared/**'],
    },
    proxy: {
      '/admin/api': {
        target: 'http://127.0.0.1:8082',
        rewrite: (path) => path.replace(/^\/admin/, ''),
      },
    },
  },
});
