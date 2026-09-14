export type ArtifactKind = 'html' | 'react';

export interface Detection {
  kind: ArtifactKind;
  /** Storage and platform APIs the source refers to. */
  apis: string[];
  /** Capabilities requested through claude.use(). */
  capabilities: string[];
  /** Modules a React artifact imports. */
  imports: string[];
  /** Literal localStorage / window.storage keys (best effort). */
  storageKeys: string[];
  externalAssets: string[];
  warnings: string[];
}

export const SUPPORTED_CAPABILITIES = ['downloads', 'permissions', 'user'];
export const SYNCED_APIS = ['localStorage', 'window.storage'];
/** What a React section may import; anything else cannot be bundled yet. */
export const SUPPORTED_IMPORTS = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];

const API_PATTERNS: [string, RegExp][] = [
  ['localStorage', /\blocalStorage\b/],
  ['window.storage', /\bwindow\.storage\b|(?<![\w$.])storage\.(?:get|set|delete|list)\s*\(/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['claude.use', /\bclaude\.use\s*\(/],
  ['claude.complete', /\bclaude\.complete\s*\(/],
  ['anthropic-api', /api\.anthropic\.com/],
];

export function detectArtifact(source: string): Detection {
  const kind = detectKind(source);
  const apis = API_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
  const capabilities = unique([...source.matchAll(/\bclaude\.use\s*\(\s*(['"`])(\w+)\1/g)].map((match) => match[2]));
  const imports = kind === 'react' ? moduleImports(source) : [];
  const storageKeys = literalStorageKeys(source);
  const externalAssets = unique([
    ...[...source.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi)].map((m) => m[1]),
    ...[...source.matchAll(/@import\s+url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi)].map((m) => m[1]),
  ]);

  const warnings: string[] = [];
  const unsupported = unsupportedImports(imports);
  if (unsupported.length > 0) {
    warnings.push(`Imports the hub cannot bundle yet: ${unsupported.join(', ')} (only react and react-dom are available).`);
  }
  if (apis.includes('sessionStorage')) warnings.push('sessionStorage is not synced and is lost when the app closes.');
  if (apis.includes('indexedDB')) warnings.push('Data the artifact keeps in IndexedDB stays on one device and is not synced.');
  if (apis.includes('claude.complete') || apis.includes('anthropic-api')) {
    warnings.push('Calls to Claude from inside the artifact only work on claude.ai; they will fail in the hub.');
  }
  const unsupportedCapabilities = capabilities.filter((name) => !SUPPORTED_CAPABILITIES.includes(name));
  if (unsupportedCapabilities.length > 0) {
    warnings.push(`claude.use() resolves null for: ${unsupportedCapabilities.join(', ')}. The artifact must cope without them.`);
  }
  if (externalAssets.length > 0) {
    warnings.push(
      `${externalAssets.length} external asset(s) (scripts, stylesheets or fonts) load from the network: without a connection the section falls back to what the device has.`,
    );
  }
  return { kind, apis, capabilities, imports, storageKeys, externalAssets, warnings };
}

export function unsupportedImports(imports: string[] = []): string[] {
  return imports.filter((name) => !SUPPORTED_IMPORTS.includes(name));
}

function detectKind(source: string): ArtifactKind {
  const start = source.trimStart();
  if (/^<(?:!doctype|html|head|body|meta|title|style|script|link|div|main|section|header)\b/i.test(start)) return 'html';
  if (/^\s*(?:import\s[^;]*?\sfrom\s|export\s+default\b)/m.test(source) || /\bclassName=\{?["'`]/.test(source)) return 'react';
  return 'html';
}

function moduleImports(source: string): string[] {
  return unique([
    ...[...source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)].map((match) => match[1]),
    ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  ]);
}

function literalStorageKeys(source: string): string[] {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]{1,200})\2/g)) {
    constants.set(match[1], match[3]);
  }
  const keys = new Set<string>();
  const calls =
    /(?:\blocalStorage\.(?:getItem|setItem|removeItem)|(?:\bwindow\.|(?<![\w$.]))storage\.(?:get|set|delete))\s*\(\s*(?:(['"`])([^'"`\n]{1,200})\1|([A-Za-z_$][\w$]*))/g;
  for (const match of source.matchAll(calls)) {
    const key = match[2] ?? constants.get(match[3] ?? '');
    if (key && !key.includes('${')) keys.add(key);
  }
  return [...keys].sort();
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
