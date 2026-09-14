import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GitHubStore } from '../server/github-store';
import { PACKAGE_VERSION } from './package-info';
import { CONFIG_FILE, readHubConfig, readSection, sourcePath } from './sections';

export interface Check {
  name: string;
  level: 'ok' | 'warning' | 'error';
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  version: string;
  node: string;
  root: string;
  /** What this version supports, so skills written for another version can adapt. */
  capabilities: string[];
  checks: Check[];
}

export const CAPABILITIES = [
  'sections:html',
  'sections:react',
  'storage:localStorage',
  'storage:window.storage',
  'claude.use:downloads,permissions,user',
  'sync:github',
  'sync:fs',
  'auth:passphrase',
  'pwa:offline',
  'cli:init,add,sync,list,build,dev,secrets,doctor',
];

const INSTANCE_FILES = ['vercel.json', 'middleware.ts', 'api/sync.ts', 'api/pull.ts', 'api/login.ts', 'api/logout.ts', 'api/session.ts'];

export async function doctor(root: string, options: { checkRemote?: boolean } = {}): Promise<DoctorReport> {
  const checks: Check[] = [];
  const report = (name: string, level: Check['level'], detail: string) => checks.push({ name, level, detail });
  const finish = (): DoctorReport => ({
    ok: checks.every((check) => check.level !== 'error'),
    version: PACKAGE_VERSION,
    node: process.versions.node,
    root,
    capabilities: CAPABILITIES,
    checks,
  });

  const major = Number(process.versions.node.split('.')[0]);
  report('node', major >= 20 ? 'ok' : 'error', `Node ${process.versions.node}${major >= 20 ? '' : ' (20 or newer is required)'}`);

  let sections: string[];
  try {
    const config = await readHubConfig(root);
    sections = config.sections;
    report('config', 'ok', `${CONFIG_FILE}: "${config.title}" with ${sections.length} section(s)`);
  } catch (error) {
    report('config', 'error', message(error));
    return finish();
  }

  for (const slug of sections) {
    try {
      const section = await readSection(root, slug);
      await access(sourcePath(root, section));
      const { warnings } = section.detection;
      const label = `${section.title} (${section.format})`;
      report(`section:${slug}`, warnings.length ? 'warning' : 'ok', [label, ...warnings].join(' — '));
    } catch (error) {
      report(`section:${slug}`, 'error', message(error));
    }
  }

  try {
    const dirs = (await readdir(join(root, 'sections'), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    const orphans = dirs.map((entry) => entry.name).filter((name) => !sections.includes(name));
    if (orphans.length) report('orphans', 'warning', `Folders not listed in ${CONFIG_FILE}: ${orphans.join(', ')}`);
  } catch {
    // no sections folder yet
  }

  for (const file of INSTANCE_FILES) {
    const present = await exists(join(root, file));
    report(`file:${file}`, present ? 'ok' : 'error', present ? 'present' : 'missing: run "artiport init" to restore it');
  }

  try {
    process.loadEnvFile(join(root, '.env.local'));
  } catch {
    // optional
  }
  const env = process.env;
  report(
    'env:auth',
    env.HUB_PASSPHRASE && env.HUB_SESSION_SECRET ? 'ok' : 'warning',
    env.HUB_PASSPHRASE && env.HUB_SESSION_SECRET
      ? 'HUB_PASSPHRASE and HUB_SESSION_SECRET are set locally'
      : 'HUB_PASSPHRASE and HUB_SESSION_SECRET are not set locally (they are required on Vercel)',
  );

  if (env.ARTIPORT_DATA_REPO && env.ARTIPORT_GITHUB_TOKEN) {
    const branch = env.ARTIPORT_DATA_BRANCH || 'main';
    if (options.checkRemote === false) {
      report('data-repo', 'ok', `${env.ARTIPORT_DATA_REPO}@${branch} (not contacted)`);
    } else {
      try {
        const store = new GitHubStore({ repo: env.ARTIPORT_DATA_REPO, token: env.ARTIPORT_GITHUB_TOKEN, branch });
        const listing = await store.list(['sections/']);
        if (!listing.head) {
          report('data-repo', 'error', `${env.ARTIPORT_DATA_REPO} has no commits on "${branch}": create it with an initial README`);
        } else {
          const expiry = store.tokenExpiration ? `, token expires ${store.tokenExpiration}` : '';
          report('data-repo', 'ok', `${env.ARTIPORT_DATA_REPO}@${branch}: ${Object.keys(listing.files).length} data file(s)${expiry}`);
        }
      } catch (error) {
        report('data-repo', 'error', message(error));
      }
    }
  } else {
    report(
      'data-repo',
      'warning',
      env.ARTIPORT_FS_DATA_DIR
        ? `Using the local folder ${env.ARTIPORT_FS_DATA_DIR} (development)`
        : 'ARTIPORT_DATA_REPO and ARTIPORT_GITHUB_TOKEN are not set locally (they are required on Vercel)',
    );
  }

  return finish();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
