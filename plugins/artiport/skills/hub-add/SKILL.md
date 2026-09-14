---
name: hub-add
description: Add a Claude artifact (Claude Code artifact URL, pasted chat artifact code, or HTML file) as a new section of the user's artiport hub app, then deploy it.
---

# Add an artifact to the artiport hub

artiport turns artifacts into sections of one installable app on Vercel. A section is the artifact's HTML, unchanged: a runtime injected before the artifact's code makes `localStorage`, `window.storage` and `window.claude.use` save into the hub's synced store. So **never rewrite the artifact to fit the hub**.

## 1. Find the hub instance

- An instance is a folder containing `hub.config.json`. Look in the current directory first, then in the paths listed in `~/.config/artiport/instances.json`.
- No instance: switch to the **hub-setup** skill.
- In the instance, run `npx artiport doctor --json --offline`. Check `capabilities`; if the CLI is older than this skill expects, suggest `npm install artiport@latest`.

## 2. Get the artifact source, byte for byte

| The user gives you | Do this | `--source` |
|---|---|---|
| A Claude Code artifact URL (`claude.ai/code/artifact/<id>`) | Call the Artifact tool with `action: "read"` and that `url`; save the returned HTML unchanged to a temporary file | `claude-code --url <url>` |
| Code pasted from a claude.ai chat | Save it unchanged to a temporary file | `chat` |
| A file path | Use the file | `file` |

React/JSX chat artifacts (`import …`, `export default`) are compiled at build time: save them as `.jsx`. They may import only `react` and `react-dom`. If `add` fails with `unsupported_imports`, offer to replace those parts (for example inline SVG instead of `lucide-react` icons), show the user the change, then add the edited version.

## 3. Name the section

Propose a slug (lowercase letters, digits, dashes), a short title and one emoji based on the artifact. Confirm them with the user in a single question.

## 4. Add it

```bash
npx artiport add /tmp/artifact.html --slug <slug> --title "<title>" --emoji "<emoji>" --source <kind> [--url <url>] --json
```

- `ok: false` with `error: "section_exists"` → the section is already there: use **hub-sync**.
- Explain any `warnings` in plain words, only the ones that matter to the user (for example: calls to Claude inside the artifact only work on claude.ai).

## 5. Existing data

Say what happens to data the artifact already saved, without promising a migration:

- Claude Code artifact using `localStorage`: that data stayed in the browser where it was used, so the section starts empty.
- claude.ai chat artifact using `window.storage`: the data stays on claude.ai. Importing it is not available in this version.

## 6. Build and deploy

```bash
npx artiport build --json
git add sections hub.config.json
git commit -m "Add section <slug>"
git push
```

Pushing deploys the hub on Vercel. Ask before pushing if the user has not asked you to publish. When the Vercel MCP is connected, check the new deployment (`list_deployments`, then `get_deployment`) and share the URL. Tell the user that installed apps show an update banner.
