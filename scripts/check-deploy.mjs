// Pre-deploy checks:  node scripts/check-deploy.mjs      (exit code 1 = do not deploy)
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url); const has = (p) => existsSync(new URL(p, root));
let bad = 0; const fail = (m) => { bad++; console.error('FAIL', m); }; const warn = (m) => console.warn('WARN', m);
const cfg = readFileSync(new URL('js/model-config.js', root), 'utf8');
const dataUrlsMatch = /externalDataUrls:\s*\[([\s\S]*?)\]/.exec(cfg)?.[1] ?? '';
const dataUrls = [...dataUrlsMatch.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const chunkBytesMatch = /externalDataChunkBytes:\s*\[([^\]]+)\]/.exec(cfg)?.[1] ?? '';
const chunkBytes = chunkBytesMatch.split(',').map((value) => Number(value.trim())).filter(Number.isFinite);
const minBytes = Number(/externalDataMinBytes:\s*(\d+)/.exec(cfg)?.[1]);

for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'css/style.css', 'models/cattle_breeds.onnx', 'models/classes.json']) if (!has(f)) fail(`missing ${f}`);
const classes = JSON.parse(readFileSync(new URL('models/classes.json', root), 'utf8'));
if (!Array.isArray(classes) || classes.length !== 50 || new Set(classes).size !== 50) fail('classes.json must be a plain array of 50 unique names (model output order)');
if (!has('vendor/ort.webgpu.min.mjs')) fail('vendor/ort.webgpu.min.mjs missing (run scripts/copy-runtime.sh)');
const vendorFiles = existsSync(new URL('vendor/', root)) ? readdirSync(new URL('vendor/', root)) : [];
if (!vendorFiles.some((n) => n.endsWith('.wasm'))) fail('no .wasm files in vendor/');

if (dataUrls.length !== 2 || chunkBytes.length !== 2) fail('configure exactly two externalDataUrls and externalDataChunkBytes');
if (chunkBytes.reduce((sum, size) => sum + size, 0) < minBytes) fail('externalDataChunkBytes total is below externalDataMinBytes');
for (const [index, url] of dataUrls.entries()) {
  if (!url.startsWith('./')) { fail(`externalDataUrls[${index}] must be a local ./ path for the GitHub Pages chunk deployment`); continue; }
  const path = url.slice(2);
  if (!has(path)) fail(`${path} is missing from the project`);
  else {
    const actualBytes = statSync(new URL(path, root)).size;
    if (actualBytes > 99 * 1024 * 1024) fail(`${path} is over 99 MB and cannot be pushed to GitHub`);
    if (actualBytes !== chunkBytes[index]) fail(`${path} is ${actualBytes} bytes; model-config.js expects ${chunkBytes[index]}`);
  }
}
if (/YOUR_WEB3FORMS_ACCESS_KEY/.test(readFileSync(new URL('js/feedback-config.js', root), 'utf8'))) warn('Web3Forms access key not set: the feedback button will say "not set up"');
console.log(bad ? `${bad} problem(s): fix before deploying` : 'Deploy checks passed');
process.exit(bad ? 1 : 0);
