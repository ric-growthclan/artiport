import { defineConfig, type Options } from 'tsup';

// Browser bundles are plain IIFE scripts that `artiport build` copies (or inlines) into the instance.
const browser: Options = {
  format: ['iife'],
  platform: 'browser',
  target: 'es2020',
  minify: true,
  outDir: 'dist/client',
  outExtension: () => ({ js: '.js' }),
};

export default defineConfig([
  { ...browser, entry: { runtime: 'src/runtime/index.ts' }, clean: true },
  { ...browser, entry: { shell: 'src/shell/index.ts', login: 'src/shell/login.ts' } },
  { ...browser, entry: { sw: 'src/sw/index.ts' }, tsconfig: 'tsconfig.sw.json' },
  {
    entry: {
      middleware: 'src/middleware.ts',
      'api/sync': 'src/api/sync.ts',
      'api/pull': 'src/api/pull.ts',
      'api/login': 'src/api/login.ts',
      'api/logout': 'src/api/logout.ts',
      'api/session': 'src/api/session.ts',
    },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    outDir: 'dist',
    dts: true,
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    outDir: 'dist',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
