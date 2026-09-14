---
name: hub-sync
description: Update the user's artiport hub app after one of its Claude artifacts changed. Re-reads artifacts, checks the saved data stays compatible, then deploys.
---

# Update hub sections from their artifacts

Use this when the user wants the hub to show a newer version of an artifact, or when a hook reports that an artifact just published is a hub section.

## 1. Find the instance and its sections

Locate the instance as in **hub-add** (`hub.config.json` in the current directory, or `~/.config/artiport/instances.json`), then:

```bash
npx artiport list --json
```

Each section has `source.kind` and, for Claude Code artifacts, `source.url`.

## 2. Fetch each new version, byte for byte

Update the section the user named. If they said "update the hub", update every `claude-code` section.

- `claude-code`: call the Artifact tool with `action: "read"` and `source.url`, save the HTML unchanged to a temporary file.
- `chat` or `file`: there is no way to fetch these. Ask the user to paste the new code or give the file, and save it unchanged.

Then run:

```bash
npx artiport sync <slug> /tmp/<slug>.html --json
```

## 3. Read the result before deploying

- `changed: false`: already current, nothing to do for that section.
- `storage.compatible: false`: **stop before committing.** The new version no longer uses some storage keys (`storage.keysRemoved`) or storage APIs (`storage.apisRemoved`), so data saved so far may not show up. Explain this in plain words and let the user choose:
  1. keep the previous version (`git checkout -- sections/<slug>`);
  2. ask you to adjust the artifact so it keeps reading the old keys, then sync again;
  3. accept the change.
- `warnings`: mention only the ones that matter to the user.

## 4. Build and deploy

When at least one section changed:

```bash
npx artiport build --json
git add sections hub.config.json
git commit -m "sync(<slug>): update from artifact"
git push
```

Ask before pushing if the user has not asked you to publish. When the Vercel MCP is connected, check the new deployment and share its URL.

## 5. Report

Say which sections changed and where the deployment is. Open apps show an update banner; a reload picks up the new version, and saved data is untouched.
