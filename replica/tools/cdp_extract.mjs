// Runs keepsake/src/extract/extract.js on live pages in a throwaway headless browser and prints
// what Keepsake would save (kind, title, price, recipe summary). Reads pages like a visitor would.
//   node replica/tools/cdp_extract.mjs <url> [<url>…] [--browser path]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recipeFromSchema, recipeFromText, kindFromSchemaTypes } from '../../keepsake/src/shared/kinds.js';

const args = process.argv.slice(2);
const bi = args.indexOf('--browser');
const BROWSER = bi >= 0 ? args.splice(bi, 2)[1] : '/Applications/Comet.app/Contents/MacOS/Comet';
const urls = args;
const PORT = 9750 + Math.floor(Math.random() * 100);
const profile = mkdtempSync(join(tmpdir(), 'keepsake-extract-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXTRACT = readFileSync(new URL('../../keepsake/src/extract/extract.js', import.meta.url), 'utf8');
const proc = spawn(BROWSER, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--headless=new', 'about:blank'], { stdio: 'ignore' });

async function json(path, opts) { for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, opts)).json(); } catch { await sleep(500); } } throw new Error('no devtools'); }
function connect(u) {
  const ws = new WebSocket(u); let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => { await ready; return new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
  return { send, close: () => ws.close() };
}
try {
  for (const url of urls) {
    const t = await json(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const page = connect(t.webSocketDebuggerUrl);
    await sleep(7000);
    const r = await page.send('Runtime.evaluate', { expression: EXTRACT, returnByValue: true, timeout: 20000 });
    const p = r.result.value || {};
    const kind = kindFromSchemaTypes(p.schemaTypes) || (p.recipe ? 'recipe' : p.price != null || p.priceText ? 'product' : p.sparse ? 'link' : 'product');
    const rec = kind === 'recipe' ? recipeFromSchema(p.recipe) || recipeFromText(p.description) : null;
    console.log(JSON.stringify({ url, kind, title: p.title, priceText: p.priceText || p.price, source: p.source, image: !!p.image, types: (p.schemaTypes || []).slice(0, 8),
      recipe: rec ? { ingredients: rec.ingredients.length, steps: rec.steps.length, totalMinutes: rec.totalMinutes, yield: rec.yield, first: rec.ingredients[0] } : null }));
    page.close();
  }
} catch (e) { console.error('FAILED', e.message); process.exitCode = 1; }
proc.kill('SIGTERM'); await sleep(1000); rmSync(profile, { recursive: true, force: true });
