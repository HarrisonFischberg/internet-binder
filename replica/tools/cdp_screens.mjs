// Screenshots of the real extension UI in every style × theme, in a throwaway headless profile.
//   node replica/tools/cdp_screens.mjs <extensionDir> <outDir> [--browser path]
// 1. Dashboard (#review, #all) with the sample library, for modern/moss/minimal × light/dark.
// 2. The in-page capture card (src/content/toast.js + tokens-content.js, unmodified) on a stand-in page.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [extDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const BROWSER = arg('--browser', '/Applications/Comet.app/Contents/MacOS/Comet');
const PORT = 9600 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), 'keepsake-screens-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const proc = spawn(BROWSER, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--headless=new', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

async function json(path, opts) {
  for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, opts)).json(); } catch { await sleep(500); } }
  throw new Error('DevTools endpoint did not come up');
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => { await ready; return new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  return { send, evaluate, close: () => ws.close() };
}
async function shot(page, file, clip) {
  const r = await page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  writeFileSync(join(outDir, file), Buffer.from(r.data, 'base64'));
}

const LOOKS = [['modern', 'light'], ['modern', 'dark'], ['moss', 'light'], ['moss', 'dark'], ['minimal', 'light'], ['minimal', 'dark']];

async function main() {
  let id = null;
  for (let i = 0; i < 40 && !id; i++) { const t = (await json('/json/list')).find((x) => x.url.startsWith('chrome-extension://') && x.url.endsWith('/background.js')); if (t) id = new URL(t.url).host; else await sleep(500); }
  if (!id) throw new Error('extension not loaded');

  // 1. Dashboard
  const dash = await json(`/json/new?${encodeURIComponent(`chrome-extension://${id}/src/dashboard/dashboard.html#review`)}`, { method: 'PUT' });
  const page = connect(dash.webSocketDebuggerUrl);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);
  await page.evaluate(`(async () => {
    const m = await import('chrome-extension://${id}/src/shared/storage.js');
    const s = m.createStore(m.chromeBackend(), m.idbBackend());
    await s.init();
    await s.loadSampleData();
    // Two more saves for Review, so it shows more than one row.
    await s.addItem({ title: 'Linen table runner, 180 cm', url: 'https://example.com/runner', price: 42, currency: 'USD', retailer: 'Fenwick Home', collectionId: null, needsReview: true, categorizationReason: 'Not sure (52%): “linen” fits Home Decor and Kitchen' });
    await s.addItem({ title: 'Merino base layer, long sleeve', url: 'https://example.com/merino', price: 89, currency: 'USD', retailer: 'Northline', collectionId: null, needsReview: true, categorizationReason: 'Not sure (48%): “merino” fits Clothing and Camping & Outdoors' });
  })()`);
  for (const [style, theme] of LOOKS) {
    await page.evaluate(`(async () => {
      const m = await import('chrome-extension://${id}/src/shared/storage.js');
      const s = m.createStore(m.chromeBackend(), m.idbBackend());
      await s.updateSettings({ style: '${style}', theme: '${theme}' });
    })()`);
    for (const route of ['review', 'all']) {
      await page.evaluate(`location.hash = '#${route}'`);
      await sleep(900);
      await shot(page, `dashboard-${route}-${style}-${theme}.png`);
    }
  }
  page.close();

  // 2. In-page capture card on a stand-in product page
  const harness = join(profile, 'card.html');
  const src = (p) => pathToFileURL(join(extDir, p)).href;
  writeFileSync(harness, `<!doctype html><meta charset="utf-8"><title>Stand-in product page</title>
    <body style="margin:0;font:16px Georgia,serif;background:#e9e4dc;color:#333">
    <div style="padding:40px 60px"><h1 style="font-weight:400">Enamelled cast-iron Dutch oven, 5.5 qt</h1><p>$199.00 · Copper Lane Kitchen (stand-in page for screenshots)</p></div>
    <script src="${src('src/content/tokens-content.js')}"></script><script src="${src('src/content/toast.js')}"></script>`);
  const t = await json(`/json/new?${encodeURIComponent(pathToFileURL(harness).href)}`, { method: 'PUT' });
  const card = connect(t.webSocketDebuggerUrl);
  await card.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 560, deviceScaleFactor: 2, mobile: false });
  await sleep(1500);
  const thumb = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#a8452c"/><circle cx="40" cy="44" r="22" fill="#7a2e1c"/></svg>').toString('base64')}`;
  const states = {
    saved: `{ tone: 'ok', title: 'Saved to', picker: { options: [{ id: 'k', name: 'Kitchen' }, { id: 'h', name: 'Home Decor' }], selectedId: 'k' }, thumb: '${thumb}', message: 'Enamelled cast-iron Dutch oven, 5.5 qt', meta: '$199.00 · Copper Lane Kitchen', status: 'Finishing details… · Saved on this device', actions: [{ label: 'Undo', quiet: true }, { label: 'Edit', quiet: true }], duration: 0 }`,
    review: `{ tone: 'review', title: 'Saved. Pick a collection now or later', thumb: '${thumb}', message: 'Linen table runner, 180 cm', meta: '$42.00 · Fenwick Home', suggestions: { items: [{ id: 'h', name: 'Home Decor' }, { id: 'k', name: 'Kitchen' }, { id: 'g', name: 'Gifts' }], onPick() {} }, status: 'Saved on this device', actions: [{ label: 'Undo', quiet: true }, { label: 'Edit', quiet: true }], duration: 0 }`,
    error: `{ tone: 'error', title: 'Not saved', message: 'Keepsake is out of space in this browser profile. Nothing already saved was lost. Free some space or export your library from Settings.' }`,
  };
  for (const [style, theme] of LOOKS) {
    for (const [name, opts] of Object.entries(states)) {
      await card.evaluate(`globalThis.__keepsakeToast.show(Object.assign(${opts}, { look: { style: '${style}', theme: '${theme}' } }))`);
      await sleep(400);
      await shot(card, `card-${name}-${style}-${theme}.png`, { x: 900 - 400, y: 560 - 300, width: 400, height: 300 });
    }
  }
  card.close();
  console.log('wrote screenshots to', outDir);
}
main().catch((e) => { console.error('SCREENS FAILED:', e.message); process.exitCode = 1; }).finally(async () => { proc.kill('SIGTERM'); await sleep(1500); try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } });
