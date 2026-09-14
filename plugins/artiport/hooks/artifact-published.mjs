#!/usr/bin/env node
// PostToolUse hook for the Artifact tool: when the artifact just published is a section of a registered
// artiport hub, tell Claude so it can offer to update the hub. Silent in every other case.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ARTIFACT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const event = JSON.parse((await readStdin()) || '{}');
  const input = event.tool_input ?? {};
  if (input.action && input.action !== 'publish') return;

  const response = typeof event.tool_response === 'string' ? event.tool_response : JSON.stringify(event.tool_response ?? '');
  const published = new Set([...`${input.url ?? ''} ${response}`.matchAll(ARTIFACT_ID)].map((match) => match[0].toLowerCase()));
  if (published.size === 0) return;

  const registry = await readJson(process.env.ARTIPORT_REGISTRY ?? join(homedir(), '.config', 'artiport', 'instances.json'));
  const matches = [];
  for (const instance of registry?.instances ?? []) {
    const config = await readJson(join(instance.path, 'hub.config.json'));
    for (const slug of config?.sections ?? []) {
      const section = await readJson(join(instance.path, 'sections', slug, 'section.json'));
      const id = section?.source?.url?.match(ARTIFACT_ID)?.[0]?.toLowerCase();
      if (id && published.has(id)) matches.push(`"${section.title}" (section "${slug}" of the hub in ${instance.path})`);
    }
  }
  if (matches.length === 0) return;

  const context =
    `The artifact just published is part of the user's artiport hub: ${matches.join('; ')}. ` +
    'The hub still serves the previous version. Offer to update it now with the hub-sync skill.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }));
}

main().catch(() => {
  // A hook must never get in the way of publishing.
});
