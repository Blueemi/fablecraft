// Bundles the whole game into one self-contained HTML file (no server or extra files needed).
//
//   node tools/build-single.mjs                  -> dist/fablecraft.html (open it directly)
//   node tools/build-single.mjs --page <file>    -> page fragment without <html>/<head>/<body>,
//                                                   for hosts that wrap the page themselves
//
// Uses esbuild through npx (fetched on first use).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = (entry) =>
  execFileSync('npx', ['--yes', 'esbuild@0.25.10', entry, '--bundle', '--format=iife', '--minify', '--target=es2020', '--define:import.meta.url=""', '--log-level=warning'], { cwd: root, maxBuffer: 64 << 20 }).toString();

// inline scripts must never contain a literal closing script tag or an HTML comment opener
const safe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const main = safe(bundle('src/main.js'));
const worker = bundle('src/worker.js');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')).trim();
const workerLiteral = JSON.stringify(worker).replace(/</g, '\\u003c');

const page = `<title>FableCraft</title>
<style>
${css}</style>
${body}
<script>globalThis.FABLECRAFT_WORKER_SOURCE = ${workerLiteral};</script>
<script>
${main}</script>
`;

const args = process.argv.slice(2);
const i = args.indexOf('--page');
if (i >= 0) {
  writeFileSync(args[i + 1], page);
  console.log(`page fragment: ${args[i + 1]} (${(page.length / 1024).toFixed(0)} KB)`);
} else {
  const out = join(root, 'dist', 'fablecraft.html');
  mkdirSync(dirname(out), { recursive: true });
  const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:,">
</head>
<body>
${page}</body>
</html>
`;
  writeFileSync(out, doc);
  console.log(`standalone: ${out} (${(doc.length / 1024).toFixed(0)} KB)`);
}
