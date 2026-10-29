import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': process.cwd() } },
  test: { globalSetup: ['./tests/setup.ts'], fileParallelism: false, testTimeout: 20000 },
});
