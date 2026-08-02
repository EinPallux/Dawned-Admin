import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /** Server integration tests share one local Postgres — no parallel files. */
    fileParallelism: false,
  },
});
