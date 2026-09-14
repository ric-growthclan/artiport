import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/cli/build';
import { detectArtifact } from '../src/cli/detect';
import { injectRuntime, scriptJson } from '../src/cli/html';
import { init } from '../src/cli/init';
import { addSection, listSections, readHubConfig, syncSection } from '../src/cli/sections';

const examples = fileURLToPath(new URL('../../../examples/artifacts/', import.meta.url));
const clientDir = fileURLToPath(new URL('../dist/client/', import.meta.url));
const example = (name: string) => readFile(join(examples, name), 'utf8');

beforeAll(async () => {
  // Keep tests away from the real ~/.config/artiport registry.
  process.env.ARTIPORT_REGISTRY = join(await mkdtemp(join(tmpdir(), 'artiport-registry-')), 'instances.json');
});

async function instance(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'artiport-hub-'));
  await init(root, { title: 'Test hub', lang: 'en' });
  return root;
}

describe('artifact detection', () => {
  it('recognises a localStorage artifact and its key', async () => {
    const detection = detectArtifact(await example('habits.html'));
    expect(detection.kind).toBe('html');
    expect(detection.apis).toEqual(['localStorage']);
    expect(detection.storageKeys).toEqual(['habits-v1']);
    expect(detection.warnings).toEqual([]);
  });

  it('recognises a window.storage artifact and its key', async () => {
    const detection = detectArtifact(await example('reading-list.html'));
    expect(detection.apis).toEqual(['window.storage']);
    expect(detection.storageKeys).toEqual(['books']);
  });

  it('recognises a React artifact, its imports and storage key', async () => {
    const detection = detectArtifact(await example('water.jsx'));
    expect(detection).toMatchObject({ kind: 'react', imports: ['react'], apis: ['window.storage'], storageKeys: ['water-v1'] });
    expect(detection.warnings).toEqual([]);
  });

  it('flags imports that cannot be bundled, AI calls, fonts and unsupported capabilities', () => {
    const react = detectArtifact(
      `import { useState } from 'react';\nimport { Heart } from "lucide-react";\nconst css = "@import url('https://fonts.googleapis.com/css2?family=Inter');";\nexport default function App() { return <div className="p-4" />; }`,
    );
    expect(react.imports).toEqual(['lucide-react', 'react']);
    expect(react.warnings.join(' ')).toMatch(/cannot bundle yet: lucide-react/);
    expect(react.externalAssets).toEqual(['https://fonts.googleapis.com/css2?family=Inter']);

    const page = detectArtifact(
      `<html><script>const db = await claude.use("db"); const d = await claude.use('downloads'); window.claude.complete('hi')</script></html>`,
    );
    expect(page.capabilities).toEqual(['db', 'downloads']);
    expect(page.warnings.join(' ')).toMatch(/resolves null for: db/);
    expect(page.warnings.join(' ')).toMatch(/only work on claude\.ai/);
  });
});

describe('runtime injection', () => {
  it('runs before any artifact script', () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"><script>app()</script></head><body></body></html>';
    const out = injectRuntime(html, 'demo', 'shim()');
    expect(out.indexOf('shim()')).toBeGreaterThan(out.indexOf('<head>'));
    expect(out.indexOf('shim()')).toBeLessThan(out.indexOf('app()'));
    expect(out).toContain('window.__ARTIPORT_SLUG__="demo"');
  });

  it('handles pages without <head> and runtime code containing </script>', () => {
    expect(injectRuntime('<html><body>x</body></html>', 'a', 'r()')).toMatch(/^<html><head><script>/);
    expect(injectRuntime('<div>fragment</div>', 'a', 'r()')).toMatch(/^<script>/);
    expect(injectRuntime('<head></head>', 'a', 'x="</script>"')).not.toContain('x="</script>"');
    expect(scriptJson({ t: '</script><b>' })).not.toContain('<');
  });
});

describe('sections', () => {
  it('adds, lists and syncs sections', async () => {
    const root = await instance();
    const habits = await example('habits.html');
    const added = await addSection(root, { source: habits, slug: 'habits', title: 'Habits', emoji: '✅', kind: 'file' });
    expect(added.section).toMatchObject({ format: 'html', detection: { storageKeys: ['habits-v1'] } });
    expect((await readHubConfig(root)).sections).toEqual(['habits']);
    expect((await listSections(root)).map((section) => section.slug)).toEqual(['habits']);

    await expect(addSection(root, { source: habits, slug: 'habits', title: 'Again' })).rejects.toMatchObject({ code: 'section_exists' });
    await expect(addSection(root, { source: '<p>x</p>', slug: 'Bad Slug', title: 'x' })).rejects.toMatchObject({ code: 'bad_slug' });

    expect((await syncSection(root, 'habits', habits)).changed).toBe(false);

    const changed = await syncSection(root, 'habits', habits.replace("'habits-v1'", "'habits-v2'"));
    expect(changed.changed).toBe(true);
    expect(changed.storage).toMatchObject({ keysRemoved: ['habits-v1'], keysAdded: ['habits-v2'], compatible: false });
  });

  it('stores React artifacts as JSX and refuses imports that cannot be bundled', async () => {
    const root = await instance();
    const { section } = await addSection(root, { source: await example('water.jsx'), slug: 'water', title: 'Water', kind: 'chat' });
    expect(section.format).toBe('react');
    expect(existsSync(join(root, 'sections/water/source.jsx'))).toBe(true);

    await expect(
      addSection(root, {
        source: `import { LineChart } from 'recharts';\nexport default function App() { return <LineChart /> }`,
        slug: 'chart',
        title: 'Chart',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_imports' });
  });
});

describe.skipIf(!existsSync(join(clientDir, 'shell.js')))('build', () => {
  it('produces a complete, precached app with HTML and React sections', { timeout: 60_000 }, async () => {
    const root = await instance();
    await addSection(root, { source: await example('habits.html'), slug: 'habits', title: 'Habits', emoji: '✅' });
    await addSection(root, { source: await example('reading-list.html'), slug: 'reading', title: 'Reading', emoji: '📚', kind: 'chat' });
    await addSection(root, { source: await example('water.jsx'), slug: 'water', title: 'Water', emoji: '💧', kind: 'chat' });
    const result = await build(root, { clientDir });
    expect(result.sections).toEqual(['habits', 'reading', 'water']);

    const out = async (path: string) => (await readFile(join(result.outDir, path))).toString();
    expect(await out('index.html')).toContain('"slug":"habits"');

    const html = await out('sections/habits/index.html');
    expect(html.indexOf('__ARTIPORT_SLUG__')).toBeLessThan(html.indexOf("const KEY = 'habits-v1'"));

    const react = await out('sections/water/index.html');
    expect(react).toContain('<div id="root"></div>');
    expect(react).toMatch(/\.bg-sky-50\s*\{/);
    expect(react).toContain('water-v1');
    expect(react.indexOf('__ARTIPORT_SLUG__')).toBeLessThan(react.indexOf('water-v1'));

    expect((await readFile(join(result.outDir, 'icons/icon-512.png'))).subarray(1, 4).toString()).toBe('PNG');
    expect(JSON.parse(await out('manifest.webmanifest'))).toMatchObject({ name: 'Test hub', display: 'standalone' });

    const precache = JSON.parse(/self\.__ARTIPORT_PRECACHE__=(.*?);\n/.exec(await out('sw.js'))![1]) as { urls: string[] };
    expect(precache.urls).toEqual(expect.arrayContaining(['/', '/sections/habits/', '/sections/water/', '/manifest.webmanifest']));
    expect(precache.urls.some((url) => url.startsWith('/login'))).toBe(false);
  });

  it('reports JSX that does not compile', { timeout: 60_000 }, async () => {
    const root = await instance();
    await addSection(root, { source: 'export default function App() { return <div> }', slug: 'broken', title: 'Broken' });
    await expect(build(root, { clientDir })).rejects.toMatchObject({ code: 'react_build_failed' });
  });
});
