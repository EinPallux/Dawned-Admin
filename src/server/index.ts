/**
 * Dawned-Admin server entry point: config → app → listen → housekeeping.
 * Runs as dawned-admin.service on the VPS (deploy/dawned-admin.service),
 * loopback-only behind Caddy's /admin route.
 */

import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const { app, auth, close } = await buildApp(config);

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info({ host: config.HOST, port: config.PORT, env: config.NODE_ENV }, 'Dawned-Admin ready');

const purgeTimer = setInterval(
  () => {
    auth.purgeExpired().catch((error: unknown) => {
      app.log.error({ err: error }, 'session purge failed');
    });
  },
  60 * 60 * 1000,
);
purgeTimer.unref();

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  clearInterval(purgeTimer);
  void close().then(
    () => {
      process.exit(0);
    },
    (error: unknown) => {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    },
  );
  setTimeout(() => {
    process.exit(0);
  }, 3000).unref();
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
