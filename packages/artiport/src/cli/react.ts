import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { build as esbuild } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { escapeHtml } from './html';
import { CliError } from './sections';

// React chat artifacts become plain pages: the JSX is bundled with React 18, and Tailwind generates exactly
// the utilities the source uses (claude.ai renders React artifacts with Tailwind, preflight included).

const require = createRequire(import.meta.url);

export interface ReactPage {
  title: string;
  lang: string;
}

export async function compileReactSection(source: string, sourcePath: string, page: ReactPage): Promise<string> {
  const [script, css] = await Promise.all([bundle(sourcePath), tailwind(source)]);
  return `<!doctype html>
<html lang="${escapeHtml(page.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${script.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

/** node_modules folders holding the React copy artiport ships, so an instance needs no React install of its own. */
function reactNodePaths(): string[] {
  return [...new Set(['react', 'react-dom'].map((name) => dirname(dirname(require.resolve(`${name}/package.json`)))))];
}

async function bundle(sourcePath: string): Promise<string> {
  const entry = `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import App from ${JSON.stringify(sourcePath)};
createRoot(document.getElementById('root')).render(createElement(App));
`;
  try {
    const result = await esbuild({
      stdin: { contents: entry, resolveDir: dirname(sourcePath), loader: 'jsx', sourcefile: 'artiport-entry.jsx' },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      legalComments: 'none',
      jsx: 'automatic',
      loader: { '.js': 'jsx', '.jsx': 'jsx' },
      nodePaths: reactNodePaths(),
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    return result.outputFiles[0].text;
  } catch (error) {
    const errors = (error as { errors?: { text: string; location?: { line: number } | null }[] }).errors;
    const detail = errors?.length
      ? errors.map((item) => (item.location ? `line ${item.location.line}: ${item.text}` : item.text)).join('; ')
      : error instanceof Error
        ? error.message
        : String(error);
    throw new CliError('react_build_failed', `Could not compile the React artifact: ${detail}`);
  }
}

async function tailwind(source: string): Promise<string> {
  const result = await postcss([tailwindcss({ content: [{ raw: source, extension: 'jsx' }] })]).process(
    '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    { from: undefined },
  );
  return result.css;
}
