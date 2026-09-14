import type { ShellConfig } from '../shell/index';
import type { HubConfig } from './sections';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** JSON that is safe inside an inline <script>: no "</script>" or "<!--" can appear. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function inlineScript(code: string): string {
  return `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
}

/** Puts the runtime shim first in <head> so it runs before any artifact script. */
export function injectRuntime(html: string, slug: string, runtime: string): string {
  const tag = `<script>window.__ARTIPORT_SLUG__=${scriptJson(slug)};</script>${inlineScript(runtime)}`;
  const insertAfter = (match: RegExpExecArray, content: string) =>
    html.slice(0, match.index + match[0].length) + content + html.slice(match.index + match[0].length);

  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return insertAfter(head, tag);
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) return insertAfter(root, `<head>${tag}</head>`);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return insertAfter(doctype, tag);
  return tag + html;
}

export function shellHtml(config: HubConfig, shell: ShellConfig, assetHash: string): string {
  return `<!doctype html>
<html lang="${escapeHtml(config.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(config.title)}</title>
<meta name="theme-color" content="${config.themeColor}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(config.shortName)}">
<meta name="robots" content="noindex">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/shell.${assetHash}.css">
<style>:root{--accent:${config.themeColor}}</style>
</head>
<body>
<div id="app"></div>
<script>window.__ARTIPORT_CONFIG__=${scriptJson(shell)};</script>
<script src="/shell.${assetHash}.js"></script>
</body>
</html>
`;
}

const LOGIN_TEXT = {
  it: {
    title: 'Accedi',
    label: 'Passphrase',
    submit: 'Entra',
    invalid: 'Passphrase non valida.',
    failed: 'Accesso non riuscito, riprova.',
    offline: 'Sei offline: connettiti per accedere.',
  },
  en: {
    title: 'Sign in',
    label: 'Passphrase',
    submit: 'Sign in',
    invalid: 'Wrong passphrase.',
    failed: 'Sign-in failed, try again.',
    offline: 'You are offline: connect to sign in.',
  },
};

const LOGIN_CSS = `:root{color-scheme:light dark;--bg:#f6f5f1;--card:#fff;--ink:#1d1c1a;--muted:#6f6c64;--line:#e5e2d9}
@media (prefers-color-scheme:dark){:root{--bg:#131312;--card:#1c1b19;--ink:#f0eee6;--muted:#a19d92;--line:#2d2b27}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:360px;padding:28px 24px;border:1px solid var(--line);border-radius:18px;background:var(--card);box-shadow:0 10px 30px rgb(0 0 0/7%)}
h1{margin:0 0 20px;font-size:21px;letter-spacing:-.02em}label{display:block;margin-bottom:6px;color:var(--muted);font-size:13px}
input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:16px}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:12px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.6}.error{margin:12px 0 0;color:#e03131;font-size:14px}.error[hidden]{display:none}`;

export function loginHtml(config: HubConfig, script: string): string {
  const text = config.lang.toLowerCase().startsWith('it') ? LOGIN_TEXT.it : LOGIN_TEXT.en;
  return `<!doctype html>
<html lang="${escapeHtml(config.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${config.themeColor}">
<title>${escapeHtml(text.title)} · ${escapeHtml(config.title)}</title>
<style>${LOGIN_CSS}:root{--accent:${config.themeColor}}</style>
</head>
<body data-invalid="${escapeHtml(text.invalid)}" data-failed="${escapeHtml(text.failed)}" data-offline="${escapeHtml(text.offline)}">
<main class="card">
<h1>${escapeHtml(config.title)}</h1>
<form>
<input type="text" name="username" value="artiport" autocomplete="username" hidden>
<label for="passphrase">${escapeHtml(text.label)}</label>
<input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required autofocus>
<button type="submit">${escapeHtml(text.submit)}</button>
<p class="error" role="alert" hidden></p>
</form>
</main>
${inlineScript(script)}
</body>
</html>
`;
}

export function webManifest(config: HubConfig): Record<string, unknown> {
  return {
    id: '/',
    name: config.title,
    short_name: config.shortName,
    lang: config.lang,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: config.backgroundColor,
    theme_color: config.themeColor,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
