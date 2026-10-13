// Runs keepsake/src/extract/extract.js on live pages in a throwaway headless browser and prints
// what Keepsake would save (kind, title, price, recipe or workout summary). Reads pages like a visitor would.
//   node replica/tools/cdp_extract.mjs <url> [<url>…] [--browser path]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recipeFromSchema, recipeFromText, kindFromSchemaTypes, workoutFromText, looksLikeWorkout, formatExercise, placeFromSchema, placeFromMapsUrl, addressLine, videoPlatform, videoFromCapture, articleFromCapture, formatDuration } from '../../keepsake/src/shared/kinds.js';

const args = process.argv.slice(2);
const bi = args.indexOf('--browser');
const BROWSER = bi >= 0 ? args.splice(bi, 2)[1] : '/Applications/Comet.app/Contents/MacOS/Comet';
const li = args.indexOf('--lines');
const SHOW_LINES = li >= 0 && !!args.splice(li, 1);
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
    // Same order as background.js kindOfCapture (minus Instagram).
    const types = kindFromSchemaTypes(p.schemaTypes);
    const wk = looksLikeWorkout(`${p.title} ${p.description}`) ? (p.isInstagram ? [p.title, p.description].filter(Boolean).sort((a, b) => b.length - a.length).map((t) => workoutFromText(t)).find(Boolean) : workoutFromText(p.description, { source: 'page' })) || workoutFromText((p.workoutLines || []).join('\n'), { source: 'page' }) : null;
    const kind = placeFromMapsUrl(url) ? 'place' : p.isInstagram ? (recipeFromText(p.description) ? 'recipe' : wk ? 'workout' : 'link') : (types === 'video' || types === 'article') && wk ? 'workout' : types && types !== 'product' ? types : p.recipe ? 'recipe'
      : !types && p.price == null && !p.priceText && wk ? 'workout'
        : !types && (videoPlatform(url) || /^video\./i.test(p.media?.ogType || '')) ? 'video'
          : !types && /^article$/i.test(p.media?.ogType || '') ? 'article' : types === 'product' || p.price != null || p.priceText ? 'product' : p.sparse ? 'link' : 'product';
    const rec = kind === 'recipe' ? recipeFromSchema(p.recipe) || recipeFromText(p.description) : null;
    console.log(JSON.stringify({ url, kind, title: p.title, priceText: p.priceText || p.price, source: p.source, image: !!p.image, types: (p.schemaTypes || []).slice(0, 8),
      video: kind === 'video' ? (() => { const d = videoFromCapture(p.media || {}, url); return { ...d, length: formatDuration(d.durationSeconds) }; })() : null,
      article: kind === 'article' ? articleFromCapture({ ...(p.media || {}), siteName: p.media?.siteName || p.siteName }) : null,
      place: kind === 'place' ? (() => { const d = placeFromSchema(p.place) || placeFromMapsUrl(url) || {}; return { address: addressLine(d), pin: d.lat != null, hours: d.hours, cuisine: d.cuisine, price: d.priceRange, name: d.name }; })() : null,
      workout: kind === 'workout' ? { lines: (p.workoutLines || []).length, exercises: wk.exercises.map(formatExercise) } : null,
      recipe: rec ? { ingredients: rec.ingredients.length, steps: rec.steps.length, totalMinutes: rec.totalMinutes, yield: rec.yield, first: rec.ingredients[0] } : null }));
    if (SHOW_LINES) console.log(JSON.stringify({ description: p.description }), (p.workoutLines || []).join('\n'));
    page.close();
  }
} catch (e) { console.error('FAILED', e.message); process.exitCode = 1; }
proc.kill('SIGTERM'); await sleep(1000); rmSync(profile, { recursive: true, force: true });
