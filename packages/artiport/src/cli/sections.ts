import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSlug } from '../shared/paths';
import { detectArtifact, SYNCED_APIS, unsupportedImports, type ArtifactKind, type Detection } from './detect';

export type SourceKind = 'claude-code' | 'chat' | 'file';

export interface HubConfig {
  title: string;
  shortName: string;
  lang: string;
  themeColor: string;
  backgroundColor: string;
  sections: string[];
}

export interface SectionMeta {
  slug: string;
  title: string;
  emoji: string;
  /** "html" pages are served as they are; "react" sources are compiled at build time. */
  format: ArtifactKind;
  source: { kind: SourceKind; url?: string };
  hash: string;
  detection: Detection;
  addedAt: string;
  updatedAt: string;
}

export interface StorageDiff {
  apisAdded: string[];
  apisRemoved: string[];
  keysAdded: string[];
  keysRemoved: string[];
  /** False when the new version stops reading keys or storage APIs the old one wrote to. */
  compatible: boolean;
}

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const CONFIG_FILE = 'hub.config.json';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SOURCE_KINDS: SourceKind[] = ['claude-code', 'chat', 'file'];

export function resolveConfig(raw: Record<string, unknown>): HubConfig {
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Artiport';
  const color = (value: unknown, fallback: string) => (typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback);
  return {
    title,
    shortName: typeof raw.shortName === 'string' && raw.shortName.trim() ? raw.shortName.trim() : title.slice(0, 14),
    lang: typeof raw.lang === 'string' && raw.lang ? raw.lang : 'it',
    themeColor: color(raw.themeColor, '#4c6ef5'),
    backgroundColor: color(raw.backgroundColor, '#f6f5f1'),
    sections: Array.isArray(raw.sections) ? raw.sections.filter((slug): slug is string => typeof slug === 'string' && isSlug(slug)) : [],
  };
}

export async function readRawConfig(root: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILE), 'utf8');
  } catch {
    throw new CliError('not_an_instance', `No ${CONFIG_FILE} in ${root}. Run "artiport init" there first.`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new CliError('bad_config', `${CONFIG_FILE} is not valid JSON`);
  }
}

export async function readHubConfig(root: string): Promise<HubConfig> {
  return resolveConfig(await readRawConfig(root));
}

async function writeRawConfig(root: string, raw: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, CONFIG_FILE), JSON.stringify(raw, null, 2) + '\n');
}

export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').trimEnd() + '\n';
}

export function hashSource(source: string): string {
  return createHash('sha256').update(normalizeSource(source)).digest('hex');
}

export function sourceFileName(format: ArtifactKind | undefined): string {
  return format === 'react' ? 'source.jsx' : 'source.html';
}

export function sourcePath(root: string, section: Pick<SectionMeta, 'slug' | 'format'>): string {
  return join(root, 'sections', section.slug, sourceFileName(section.format));
}

export async function readSection(root: string, slug: string): Promise<SectionMeta> {
  if (!isSlug(slug)) throw new CliError('bad_slug', `"${slug}" is not a valid section slug`);
  let section: SectionMeta;
  try {
    section = JSON.parse(await readFile(join(root, 'sections', slug, 'section.json'), 'utf8')) as SectionMeta;
  } catch {
    throw new CliError('no_such_section', `Section "${slug}" does not exist`);
  }
  // Sections added before React support have no format.
  return { ...section, format: section.format ?? 'html', detection: { ...section.detection, imports: section.detection.imports ?? [] } };
}

export async function listSections(root: string): Promise<SectionMeta[]> {
  const config = await readHubConfig(root);
  return Promise.all(config.sections.map((slug) => readSection(root, slug)));
}

function assertBuildable(detection: Detection): void {
  const unsupported = unsupportedImports(detection.imports);
  if (unsupported.length > 0) {
    throw new CliError(
      'unsupported_imports',
      `This React artifact imports ${unsupported.join(', ')}, which the hub cannot bundle yet (only react and react-dom).`,
    );
  }
}

export interface AddInput {
  source: string;
  slug: string;
  title: string;
  emoji?: string;
  kind?: string;
  url?: string;
}

export async function addSection(root: string, input: AddInput): Promise<{ section: SectionMeta; warnings: string[] }> {
  if (!isSlug(input.slug)) {
    throw new CliError('bad_slug', 'The slug must use lowercase letters, digits and dashes (at most 64 characters)');
  }
  if (!input.title?.trim()) throw new CliError('missing_title', 'A title is required (--title)');
  const kind = (input.kind ?? 'file') as SourceKind;
  if (!SOURCE_KINDS.includes(kind)) throw new CliError('bad_source', `--source must be one of ${SOURCE_KINDS.join(', ')}`);

  const raw = await readRawConfig(root);
  const existing = Array.isArray(raw.sections) ? (raw.sections as unknown[]) : [];
  const dir = join(root, 'sections', input.slug);
  if (existing.includes(input.slug) || (await exists(join(dir, 'section.json')))) {
    throw new CliError('section_exists', `Section "${input.slug}" already exists: update it with "artiport sync ${input.slug}"`);
  }

  const source = normalizeSource(input.source);
  const detection = detectArtifact(source);
  assertBuildable(detection);

  const now = new Date().toISOString();
  const section: SectionMeta = {
    slug: input.slug,
    title: input.title.trim(),
    emoji: input.emoji?.trim() || '📄',
    format: detection.kind,
    source: input.url ? { kind, url: input.url } : { kind },
    hash: hashSource(source),
    detection,
    addedAt: now,
    updatedAt: now,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(sourcePath(root, section), source);
  await writeFile(join(dir, 'section.json'), JSON.stringify(section, null, 2) + '\n');
  raw.sections = [...existing, input.slug];
  await writeRawConfig(root, raw);
  return { section, warnings: detection.warnings };
}

export interface SyncResult {
  slug: string;
  changed: boolean;
  previousHash: string;
  hash: string;
  storage: StorageDiff;
  warnings: string[];
}

export async function syncSection(root: string, slug: string, sourceText: string, url?: string): Promise<SyncResult> {
  const section = await readSection(root, slug);
  const source = normalizeSource(sourceText);
  const detection = detectArtifact(source);
  assertBuildable(detection);
  const hash = hashSource(source);
  const storage = diffStorage(section.detection, detection);
  const result = { slug, previousHash: section.hash, hash, storage, warnings: detection.warnings };
  if (hash === section.hash) return { ...result, changed: false };

  const updated: SectionMeta = {
    ...section,
    format: detection.kind,
    hash,
    detection,
    source: url ? { ...section.source, url } : section.source,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(sourcePath(root, updated), source);
  if (updated.format !== section.format) await rm(sourcePath(root, section), { force: true });
  await writeFile(join(root, 'sections', slug, 'section.json'), JSON.stringify(updated, null, 2) + '\n');
  return { ...result, changed: true };
}

export function diffStorage(before: Detection, after: Detection): StorageDiff {
  const minus = (a: string[], b: string[]) => a.filter((item) => !b.includes(item));
  const apisRemoved = minus(before.apis, after.apis);
  const keysRemoved = minus(before.storageKeys, after.storageKeys);
  return {
    apisAdded: minus(after.apis, before.apis),
    apisRemoved,
    keysAdded: minus(after.storageKeys, before.storageKeys),
    keysRemoved,
    compatible: keysRemoved.length === 0 && !apisRemoved.some((api) => SYNCED_APIS.includes(api)),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
