---
name: hub-setup
description: Set up a personal artiport hub - an installable app on Vercel that hosts Claude artifacts as sections, with data synced to a private GitHub repo.
---

# Set up an artiport hub

The result is two private GitHub repositories and one Vercel project:

- `<name>`: the hub instance (sections and configuration). Vercel deploys it on every push.
- `<name>-data`: the user's data as JSON files. Only the app's token can write to it.

Every step that creates something outside this computer (repositories, the Vercel project, environment variables) needs the user's go-ahead. Ask once, listing the steps, before step 3.

## 1. Check prerequisites

- Node 20 or newer: `node -v`.
- GitHub CLI signed in: `gh auth status`. Note the account or organization that will own the repositories.
- A Vercel account. When the Vercel MCP is connected, `list_teams` shows which team to use; ask the user to pick one.

## 2. Create the instance locally

```bash
npx artiport@latest init <name> --title "<title>" --lang <it|en>
cd <name> && npm install
npx artiport doctor --offline
```

`init` writes `.env.local` with a local passphrase and registers the instance for the Claude Code hook. `npm run dev` then works locally, keeping data in `.artiport-data/`.

## 3. Create the GitHub repositories

```bash
gh repo create <owner>/<name>-data --private --add-readme
git init -b main && git add -A && git commit -m "Create artiport hub"
gh repo create <owner>/<name> --private --source . --push
```

The data repository must have at least one commit, which `--add-readme` provides.

## 4. Token for the data repository (the user does this)

You cannot create tokens. Guide the user through https://github.com/settings/personal-access-tokens/new:

- Repository access: **Only select repositories** → `<name>-data`.
- Permissions: **Contents: Read and write**. Metadata read-only is added automatically.
- Expiration: their choice. The app's Settings screen shows when the token expires.

Never ask the user to paste the token into the chat. They add it to Vercel themselves in step 6.

## 5. Production secrets

```bash
npx artiport secrets
```

The user saves the passphrase in their password manager and enters these values in Vercel in step 6. Do not write them to any file that gets committed.

## 6. Vercel project

- Link the repository: with the Vercel MCP, `create_git_project` with `repo: <owner>/<name>` and the chosen team. Otherwise, import it at vercel.com/new with the **Other** framework preset.
- Environment variables, for Production (and Preview if wanted). The user enters them in Project → Settings → Environment Variables, or with `npx vercel env add <NAME> production`:
  - `HUB_PASSPHRASE`, `HUB_SESSION_SECRET` (from step 5)
  - `ARTIPORT_DATA_REPO` = `<owner>/<name>-data`
  - `ARTIPORT_GITHUB_TOKEN` (from step 4)
  - optional: `ARTIPORT_DATA_BRANCH` (default `main`), `HUB_SESSION_VERSION` (change it to sign out every device)
- Redeploy after adding the variables, then check the deployment and its build logs.

## 7. First run

Open the production URL and sign in with the passphrase. On iPhone, use Share → Add to Home Screen and sign in once more inside the installed app, which keeps its own cookies. On Android or desktop, use "Install app".

Continue with **hub-add** to add the first artifact.
