# Demo hub

A personal [artiport](https://github.com/ric-growthclan/artiport) hub: Claude artifacts as sections of one installable app.

- `npm run dev` runs it locally, keeping data in `.artiport-data/`.
- `npx artiport add <file> --slug <slug> --title <title>` adds an artifact; `npx artiport sync <slug> <file>` updates it.
- Pushing to GitHub deploys on Vercel. Required environment variables are listed in `.env.example`.
- `npm run doctor` checks the setup.

Your data lives in a separate private repository, as readable JSON files with full history.
