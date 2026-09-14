import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Both src/cli (tests) and dist/cli (published) sit two levels below the package root.

export const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

/** Browser bundles built by tsup: runtime, shell, login page script and service worker. */
export const CLIENT_DIR = fileURLToPath(new URL('../../dist/client/', import.meta.url));
