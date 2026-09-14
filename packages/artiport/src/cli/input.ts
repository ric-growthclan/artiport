import { readFile } from 'node:fs/promises';
import { CliError } from './sections';

/** Reads a file, or stdin when the path is "-". */
export async function readInput(path: string | undefined): Promise<string> {
  if (!path) throw new CliError('missing_input', 'Pass the artifact file, or - to read it from stdin');
  if (path !== '-') {
    try {
      return await readFile(path, 'utf8');
    } catch {
      throw new CliError('unreadable_input', `Cannot read ${path}`);
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
