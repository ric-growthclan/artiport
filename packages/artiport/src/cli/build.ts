import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ShellConfig } from '../shell/index';
import { injectRuntime, loginHtml, shellHtml, webManifest } from './html';
import { generateIcons } from './icons';
import { CLIENT_DIR, PACKAGE_VERSION } from './package-info';
import { compileReactSection } from './react';
import { CliError, listSections, readHubConfig, sourcePath } from './sections';

export interface BuildOptions {
  outDir?: string;
  dev?: boolean;
  clientDir?: string;
}

export interface BuildResult {
  outDir: string;
  sections: string[];
  version: string;
  files: number;
}

export async function build(root: string, options: BuildOptions = {}): Promise<BuildResult> {
  const config = await readHubConfig(root);
  const sections = await listSections(root);
  const outDir = resolve(root, options.outDir ?? 'dist');
  const client = await readClient(options.clientDir ?? CLIENT_DIR);
  const files = new Map<string, string | Buffer>();

  for (const section of sections) {
    const dir = join(root, 'sections', section.slug);
    const path = sourcePath(root, section);
    const source = await readFile(path, 'utf8');
    const page =
      section.format === 'react' ? await compileReactSection(source, path, { title: section.title, lang: config.lang }) : source;
    files.set(`sections/${section.slug}/index.html`, injectRuntime(page, section.slug, client.runtime));
    for (const asset of await listFiles(join(dir, 'assets'))) {
      files.set(`sections/${section.slug}/assets/${asset}`, await readFile(join(dir, 'assets', asset)));
    }
  }

  const assetHash = shortHash(client.shellJs + client.shellCss);
  const shell: ShellConfig = {
    title: config.title,
    lang: config.lang,
    version: PACKAGE_VERSION,
    dev: options.dev === true,
    sections: sections.map(({ slug, title, emoji }) => ({ slug, title, emoji })),
  };
  files.set('index.html', shellHtml(config, shell, assetHash));
  files.set(`shell.${assetHash}.js`, client.shellJs);
  files.set(`shell.${assetHash}.css`, client.shellCss);
  files.set('login/index.html', loginHtml(config, client.loginJs));
  files.set('manifest.webmanifest', JSON.stringify(webManifest(config), null, 2) + '\n');
  for (const icon of generateIcons(config.themeColor)) files.set(`icons/${icon.name}`, icon.data);

  // Anything in public/ is copied last and wins (custom icons, robots.txt, ...).
  const publicDir = join(root, 'public');
  for (const file of await listFiles(publicDir)) files.set(file, await readFile(join(publicDir, file)));

  // The login page is left out on purpose: it must always come from the network.
  const precached = [...files.keys()].filter((path) => !path.startsWith('login/')).sort();
  const version = shortHash(precached.map((path) => `${path}:${shortHash(files.get(path)!)}`).join('\n'));
  const precache = { version, urls: precached.map(toUrl) };
  files.set('sw.js', `self.__ARTIPORT_PRECACHE__=${JSON.stringify(precache)};\n${client.sw}`);

  await rm(outDir, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(outDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { outDir, sections: sections.map((section) => section.slug), version, files: files.size };
}

async function readClient(dir: string) {
  const read = async (name: string) => {
    try {
      return await readFile(join(dir, name), 'utf8');
    } catch {
      throw new CliError('client_missing', `Missing ${name} in ${dir}: the artiport package has not been built`);
    }
  };
  const [runtime, shellJs, shellCss, loginJs, sw] = await Promise.all([
    read('runtime.js'),
    read('shell.js'),
    read('shell.css'),
    read('login.js'),
    read('sw.js'),
  ]);
  return { runtime, shellJs, shellCss, loginJs, sw };
}

function toUrl(path: string): string {
  if (path === 'index.html') return '/';
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`;
  return `/${path}`;
}

function shortHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    if (!(await stat(dir)).isDirectory()) return [];
  } catch {
    return [];
  }
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}
