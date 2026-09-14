import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PACKAGE_VERSION } from './package-info';
import { registerInstance } from './registry';
import { generateSecrets } from './secrets';

export interface InitOptions {
  title?: string;
  lang?: string;
}

export interface InitResult {
  root: string;
  created: string[];
  skipped: string[];
  /** Passphrase written to .env.local for local development, when that file was created. */
  devPassphrase: string | null;
}

const API_ROUTES: [route: string, method: string][] = [
  ['sync', 'POST'],
  ['pull', 'POST'],
  ['login', 'POST'],
  ['logout', 'POST'],
  ['session', 'GET'],
];

const ENV_EXAMPLE = `# "artiport dev" reads .env.local. On Vercel set these under Project → Settings → Environment Variables.

# Sign-in (generate with: npx artiport secrets)
HUB_PASSPHRASE=
HUB_SESSION_SECRET=
# Change to sign out every device
HUB_SESSION_VERSION=1

# Private GitHub repository holding your data (needs at least one commit)
ARTIPORT_DATA_REPO=owner/my-artiport-data
ARTIPORT_DATA_BRANCH=main
# Fine-grained token: only that repository, Contents read and write
ARTIPORT_GITHUB_TOKEN=

# Development: keep data in a local folder instead of GitHub
# ARTIPORT_FS_DATA_DIR=.artiport-data
`;

export async function init(target: string, options: InitOptions = {}): Promise<InitResult> {
  const root = resolve(target);
  const name = basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-artiport';
  const lang = options.lang ?? (Intl.DateTimeFormat().resolvedOptions().locale.split('-')[0] || 'en');
  const title = options.title ?? (lang === 'it' ? 'Il mio hub' : 'My hub');

  const files: Record<string, string> = {
    'package.json': json({
      name,
      private: true,
      type: 'module',
      scripts: { dev: 'artiport dev', build: 'artiport build', doctor: 'artiport doctor' },
      dependencies: { artiport: `^${PACKAGE_VERSION}` },
    }),
    'hub.config.json': json({ title, shortName: title.slice(0, 14), lang, themeColor: '#4c6ef5', backgroundColor: '#f6f5f1', sections: [] }),
    'vercel.json': json({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      regions: ['iad1'],
      headers: [{ source: '/sw.js', headers: [{ key: 'cache-control', value: 'no-cache' }] }],
    }),
    'tsconfig.json': json({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, noEmit: true },
      include: ['api', 'middleware.ts'],
    }),
    'middleware.ts': `export { default } from 'artiport/middleware';\n`,
    ...Object.fromEntries(API_ROUTES.map(([route, method]) => [`api/${route}.ts`, `export { ${method} } from 'artiport/api/${route}';\n`])),
    '.gitignore': ['node_modules/', 'dist/', '.artiport/', '.artiport-data/', '.vercel/', '.env', '.env.*', '!.env.example', '.DS_Store', ''].join('\n'),
    '.env.example': ENV_EXAMPLE,
    'sections/.gitkeep': '',
    'README.md': readme(title),
  };

  const created: string[] = [];
  const skipped: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    if (await exists(file)) {
      skipped.push(path);
      continue;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
    created.push(path);
  }

  let devPassphrase: string | null = null;
  const envLocal = join(root, '.env.local');
  if (await exists(envLocal)) {
    skipped.push('.env.local');
  } else {
    const secrets = generateSecrets();
    await writeFile(
      envLocal,
      `# Local development only: production secrets live in Vercel.\nHUB_PASSPHRASE=${secrets.HUB_PASSPHRASE}\nHUB_SESSION_SECRET=${secrets.HUB_SESSION_SECRET}\nARTIPORT_FS_DATA_DIR=.artiport-data\n`,
    );
    created.push('.env.local');
    devPassphrase = secrets.HUB_PASSPHRASE;
  }

  await registerInstance(root);
  return { root, created, skipped, devPassphrase };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function readme(title: string): string {
  return `# ${title}

A personal [artiport](https://github.com/ric-growthclan/artiport) hub: Claude artifacts as sections of one installable app.

- \`npm run dev\` runs it locally, keeping data in \`.artiport-data/\`.
- \`npx artiport add <file> --slug <slug> --title <title>\` adds an artifact; \`npx artiport sync <slug> <file>\` updates it.
- Pushing to GitHub deploys on Vercel. Required environment variables are listed in \`.env.example\`.
- \`npm run doctor\` checks the setup.

Your data lives in a separate private repository, as readable JSON files with full history.
`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
