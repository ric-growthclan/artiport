import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from './build';
import { dev } from './dev';
import { doctor } from './doctor';
import { init } from './init';
import { readInput } from './input';
import { PACKAGE_VERSION } from './package-info';
import { addSection, CliError, listSections, syncSection } from './sections';
import { generateSecrets } from './secrets';

const HELP = `artiport ${PACKAGE_VERSION} — your Claude artifacts as sections of one installable app

Usage
  artiport init [dir] [--title <title>] [--lang it|en]   scaffold a hub instance
  artiport add <file|-> --slug <slug> --title <title>     add an HTML or React (.jsx) artifact
               [--emoji <emoji>] [--source claude-code|chat|file] [--url <artifact url>]
  artiport sync <slug> <file|-> [--url <artifact url>]    replace a section with a new version
  artiport list                                           list sections and where they came from
  artiport build [--out dist]                             build the app
  artiport dev [--port 5173]                              run locally with a folder as data store
  artiport secrets                                        generate sign-in secrets for production
  artiport doctor [--offline]                             check the instance and the data repo

Options
  --cwd <dir>   instance directory (default: the current directory)
  --json        machine-readable output, used by the Claude skills`;

const OPTIONS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  offline: { type: 'boolean' },
  cwd: { type: 'string' },
  slug: { type: 'string' },
  title: { type: 'string' },
  emoji: { type: 'string' },
  source: { type: 'string' },
  url: { type: 'string' },
  out: { type: 'string' },
  port: { type: 'string' },
  lang: { type: 'string' },
} as const;

async function run(argv: string[], json: boolean): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command, ...args] = positionals;
  const root = resolve(values.cwd ?? process.cwd());
  const print = (result: object, human: () => string) =>
    console.log(json ? JSON.stringify({ ok: true, ...result }, null, 2) : human());

  if (values.version) return console.log(PACKAGE_VERSION);
  if (values.help || command === undefined || command === 'help') return console.log(HELP);

  switch (command) {
    case 'init': {
      const result = await init(args[0] ? resolve(root, args[0]) : root, { title: values.title, lang: values.lang });
      return print(result, () =>
        [
          `Hub ready in ${result.root}`,
          ...result.created.map((file) => `  + ${file}`),
          ...result.skipped.map((file) => `  = ${file} (kept)`),
          result.devPassphrase ? `\nLocal passphrase (npm run dev): ${result.devPassphrase}` : '',
          '\nNext: npm install, then add an artifact with "npx artiport add <file> --slug <slug> --title <title>".',
        ].join('\n'),
      );
    }
    case 'add': {
      const source = await readInput(args[0]);
      const result = await addSection(root, {
        source,
        slug: values.slug ?? '',
        title: values.title ?? '',
        emoji: values.emoji,
        kind: values.source,
        url: values.url,
      });
      return print(result, () =>
        [`Added ${result.section.emoji} ${result.section.title} as sections/${result.section.slug}`, ...result.warnings.map((w) => `  ! ${w}`)].join('\n'),
      );
    }
    case 'sync': {
      const [slug, file] = args;
      if (!slug) throw new CliError('missing_slug', 'Usage: artiport sync <slug> <file|->');
      const result = await syncSection(root, slug, await readInput(file), values.url);
      return print(result, () => {
        const lines = [result.changed ? `Updated ${slug}` : `${slug} is already up to date`];
        const { storage } = result;
        if (storage.keysRemoved.length) lines.push(`  ! no longer uses storage keys: ${storage.keysRemoved.join(', ')}`);
        if (storage.apisRemoved.length) lines.push(`  ! no longer uses: ${storage.apisRemoved.join(', ')}`);
        if (storage.keysAdded.length) lines.push(`  + new storage keys: ${storage.keysAdded.join(', ')}`);
        return [...lines, ...result.warnings.map((w) => `  ! ${w}`)].join('\n');
      });
    }
    case 'list': {
      const sections = await listSections(root);
      return print({ sections }, () =>
        sections.length === 0
          ? 'No sections yet.'
          : sections
              .map((s) => `${s.emoji} ${s.slug} — ${s.title} (${s.source.kind}${s.source.url ? ` ${s.source.url}` : ''})`)
              .join('\n'),
      );
    }
    case 'build': {
      const result = await build(root, { outDir: values.out });
      return print(result, () => `Built ${result.sections.length} section(s) into ${result.outDir} (version ${result.version})`);
    }
    case 'dev': {
      await dev(root, { port: Number(values.port ?? 5173) });
      return;
    }
    case 'secrets': {
      const secrets = generateSecrets();
      return print({ secrets }, () =>
        [
          ...Object.entries(secrets).map(([key, value]) => `${key}=${value}`),
          '\nSet these as environment variables of the Vercel project, and keep the passphrase in your password manager.',
        ].join('\n'),
      );
    }
    case 'doctor': {
      const report = await doctor(root, { checkRemote: !values.offline });
      if (!report.ok) process.exitCode = 1;
      if (json) return console.log(JSON.stringify(report, null, 2));
      const marks = { ok: '✓', warning: '!', error: '✗' };
      return console.log(
        [`artiport ${report.version} · Node ${report.node}`, ...report.checks.map((c) => `${marks[c.level]} ${c.name}: ${c.detail}`)].join('\n'),
      );
    }
    default:
      throw new CliError('unknown_command', `Unknown command "${command}". Run "artiport help".`);
  }
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
run(argv, json).catch((error: unknown) => {
  const code = error instanceof CliError ? error.code : 'error';
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ ok: false, error: code, message }, null, 2));
  else console.error(`artiport: ${message}`);
  process.exitCode = 1;
});
