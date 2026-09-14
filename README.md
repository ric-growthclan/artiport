# artiport

**Your Claude artifacts, as one installable app.**

artiport turns the small tools you build with Claude (a meal planner, a habit tracker, a reading list) into sections of a single personal PWA on Vercel. The app works offline and syncs your data across devices as plain JSON files in a private GitHub repository. There is no database.

> Status: early (v0.1). Built for one person and their own artifacts.

## How it works

```
 phone / laptop                                        Vercel                     GitHub (private)
┌──────────────────────────────────────────────┐    ┌──────────────────┐     ┌───────────────────────────┐
│ shell: menu, sign-in, sync status            │    │ middleware:      │     │ my-artiport-data          │
│  ┌────────────┐   ┌────────────┐             │    │  passphrase gate │     │  sections/diet/kv.json    │
│  │ section A  │   │ section B  │  iframes    │◄──►│ /api/pull        │◄───►│  sections/habits/kv.json  │
│  │ artifact   │   │ artifact   │  (unchanged │    │ /api/sync        │     │  … one commit per sync    │
│  │ HTML       │   │ HTML       │   HTML)     │    └──────────────────┘     └───────────────────────────┘
│  └─────┬──────┘   └─────┬──────┘             │
│        └── runtime shim ┘                    │
│   localStorage · window.storage · claude.use │
│        ▼                                     │
│   in-memory store ⇄ IndexedDB (offline)      │
└──────────────────────────────────────────────┘
```

- **Artifacts run unchanged.** A section is the artifact's HTML with a small runtime injected before its code. That runtime swaps `localStorage` (Claude Code artifacts), `window.storage` (claude.ai chat artifacts) and `window.claude.use` for the hub's store.
- **Local-first.** Writes are instant and work offline. Changes are pushed in the background and pulled when the app comes back into view.
- **Last writer wins, per key.** Two classic ways to lose data are guarded against:
  - a device that has never synced cannot overwrite server data before its first download;
  - an open section reloads when another device changed its data, so it cannot save stale values back.
- **Files, not a database.** Each section's data is a readable JSON file with full git history. Old values can be recovered, and Claude can read and analyse the data.

## Quick start

```bash
npx artiport init my-artiport && cd my-artiport && npm install
npx artiport add ../habits.html --slug habits --title "Habits" --emoji "✅"
npm run dev    # http://localhost:5173, passphrase in .env.local
```

To see it working right away, try `examples/demo-hub` in this repository. It includes two demo artifacts, one using `localStorage` and one using `window.storage`.

## Let Claude do it

Install the Claude Code plugin:

```
/plugin marketplace add ric-growthclan/artiport
/plugin install artiport@artiport
```

| Skill | What it does |
|---|---|
| `hub-setup` | Creates the instance, the two private repositories and the Vercel project, and walks you through the token and secrets |
| `hub-add` | Adds an artifact from a Claude Code artifact URL, pasted chat code or a file, then deploys |
| `hub-sync` | Re-reads changed artifacts, checks saved data stays compatible, then deploys |

A hook watches for artifacts you publish from Claude Code. When one of them is a hub section, Claude offers to update the hub right away.

## Deploying

1. Create a private data repository with at least one commit: `gh repo create you/my-artiport-data --private --add-readme`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to only that repository and **Contents: Read and write**.
3. Push the instance to its own private repository and import it in Vercel with the **Other** framework preset.
4. Add these environment variables:

| Variable | Value |
|---|---|
| `HUB_PASSPHRASE`, `HUB_SESSION_SECRET` | from `npx artiport secrets` |
| `ARTIPORT_DATA_REPO` | `you/my-artiport-data` |
| `ARTIPORT_GITHUB_TOKEN` | the token from step 2 |
| `ARTIPORT_DATA_BRANCH` | optional, defaults to `main` |
| `HUB_SESSION_VERSION` | optional; change it to sign out every device |

5. Open the URL and sign in. On iPhone, tap Share → Add to Home Screen.

## Which artifacts work

| The artifact uses | In the hub |
|---|---|
| `localStorage` | ✅ synced |
| `window.storage` (claude.ai chat artifacts) | ✅ synced; personal and shared data are kept apart |
| `claude.use("downloads")`, `claude.use("user")` | ✅ |
| `claude.use("db")`, `"sample"`, `"mcp"`, … | ⚠️ resolves `null` (the `db` capability is planned) |
| React / JSX chat artifacts that import only `react` / `react-dom`, styled with Tailwind or inline styles | ✅ compiled into the section at build time |
| React artifacts importing other libraries (`lucide-react`, `recharts`, shadcn/ui, …) | ⏳ planned |
| calls to Claude from inside the artifact | ❌ only possible on claude.ai |
| `sessionStorage`, `indexedDB` | ⚠️ stays on one device |

## Data format

```json
{
  "format": 1,
  "entries": {
    "ls:habits-v1": { "j": { "habits": [{ "id": "k3j9x1a", "name": "Walk" }], "done": {} }, "t": [1757830000000, "a1b2c3d4e5f6"] },
    "ws:books": { "j": [{ "title": "Dune", "status": "reading" }], "t": [1757830100000, "0f9e8d7c6b5a"] }
  }
}
```

- The key prefix is the API that wrote it: `ls` for `localStorage`, `ws` and `wss` for personal and shared `window.storage`.
- `j` holds values that are valid JSON; `v` holds any other string.
- `t` is the write time and the device that wrote it.

## Security

- Every request passes the middleware, static files included. Pages redirect to the sign-in page; other requests get a `401`.
- Sessions are HMAC-signed `__Host-` cookies. Change `HUB_SESSION_VERSION` to invalidate all of them.
- The GitHub token lives only in Vercel and can reach only the data repository.
- Write endpoints accept only same-origin JSON requests.

## Roadmap

- **v0.2:** push reminders, an agenda with an `.ics` calendar feed, importing data from chat artifacts.
- **v0.3:** React sections, the `claude.use("db")` capability, sections that feed the calendar.

## Development

```bash
npm install
npm run build   # packages/artiport → dist
npm test
cd examples/demo-hub && npm run dev
```

## Credits

The runner idea owes a lot to [claude-artifact-runner](https://github.com/claudio-silva/claude-artifact-runner), and the `window.storage` shim to [artifact-to-pwa](https://github.com/Baaqar-007/artifact-to-pwa).

## License

MIT
