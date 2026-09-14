import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export interface RegisteredInstance {
  path: string;
  name: string;
}

export function registryPath(): string {
  return process.env.ARTIPORT_REGISTRY ?? join(homedir(), '.config', 'artiport', 'instances.json');
}

export async function readRegistry(): Promise<RegisteredInstance[]> {
  try {
    const data = JSON.parse(await readFile(registryPath(), 'utf8')) as { instances?: RegisteredInstance[] };
    return Array.isArray(data.instances) ? data.instances : [];
  } catch {
    return [];
  }
}

/** Remembers a hub instance so the Claude Code hook can tell when a published artifact belongs to it. */
export async function registerInstance(root: string): Promise<void> {
  const path = resolve(root);
  const instances = (await readRegistry()).filter((instance) => instance.path !== path);
  instances.push({ path, name: basename(path) });
  await mkdir(dirname(registryPath()), { recursive: true });
  await writeFile(registryPath(), JSON.stringify({ instances }, null, 2) + '\n');
}
