// Real-browser benchmark for Keepsake in a throwaway Chromium profile (Comet or Chrome), driven over
// the DevTools protocol. Loads an unpacked extension, imports generated libraries, and times saves,
// dashboard readiness and storage use. Never touches your normal browser profile.
//
//   node replica/tools/cdp_bench.mjs <extensionDir> <label> [--browser /Applications/Comet.app/Contents/MacOS/Comet] [--headed]
//
// Libraries come from replica/tools/make_test_library.mjs (~/.keepsake-test/keepsake-test-<n>.json).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const [extDir, label = 'run'] = process.argv.slice(2);
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const BROWSER = arg('--browser', '/Applications/Comet.app/Contents/MacOS/Comet');
const HEADED = process.argv.includes('--headed');
const LIB_SUFFIX = arg('--lib-suffix', ''); // '-v2' for 1.3.x, which only reads schema-2 exports
const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'keepsake-bench-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)];

const proc = spawn(BROWSER, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-sync', ...(HEADED ? [] : ['--headless=new']), 'about:blank',
], { stdio: 'ignore' });

async function json(path) {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json(); } catch { await sleep(500); }
  }
  throw new Error('DevTools endpoint did not come up');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => { await ready; return new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); }); };
  const evaluate = async (expression, timeout = 600000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function main() {
  const version = await json('/json/version');
  // Find the extension id from its service worker.
  let id = null;
  for (let i = 0; i < 40 && !id; i++) {
    const t = (await json('/json/list')).find((x) => x.url.startsWith('chrome-extension://') && x.url.endsWith('/background.js'));
    if (t) id = new URL(t.url).host;
    else await sleep(500);
  }
  if (!id) throw new Error('Extension service worker not found: did the browser accept --load-extension?');
  const dash = `chrome-extension://${id}/src/dashboard/dashboard.html`;
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(dash + '#all')}`, { method: 'PUT' })).json();
  const page = connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  // Records when the first card (or an empty state) is in the DOM, measured from navigation start.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const done = () => { if (window.__ksReady) return; window.__ksReady = performance.now(); };
    const check = () => { if (document.querySelector('.grid-item, .empty-state')) { done(); obs.disconnect(); } };
    const obs = new MutationObserver(check);
    document.addEventListener('DOMContentLoaded', () => { obs.observe(document.documentElement, { childList: true, subtree: true }); check(); });
  })();` });
  await sleep(2500);

  const out = { label, browser: version.Browser, extensionId: id, headless: !HEADED, results: {} };
  const storage = () => page.evaluate(`(async () => ({ localBytes: await chrome.storage.local.getBytesInUse(null), originUsage: (await navigator.storage.estimate()).usage, manifest: chrome.runtime.getManifest().version, perms: chrome.runtime.getManifest().permissions }))()`);
  out.results.empty = await storage();

  const save = (n) => page.evaluate(`(async () => {
    const t = [];
    for (let i = 0; i < ${n}; i++) {
      const product = { title: 'Bench tent ' + i + ' ' + Math.random().toString(36).slice(2), url: 'https://bench.example.com/p/' + Date.now() + '-' + i, price: '$129.00', images: [], image: '' };
      const t0 = performance.now();
      const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'keepsake:save-item', product, instant: true }, r));
      t.push(performance.now() - t0);
      if (!res || !res.ok) return { error: (res && res.error) || 'no response', after: i };
    }
    return { times: t };
  })()`);
  const dashReady = async () => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      await page.send('Page.reload', { ignoreCache: false });
      let ms = null;
      for (let k = 0; k < 600 && ms === null; k++) {
        await sleep(50);
        ms = await page.evaluate('window.__ksReady || null').catch(() => null);
      }
      times.push(ms ?? NaN);
    }
    return { medianMs: Math.round(median(times)), p95Ms: Math.round(p95(times)) };
  };
  const importLib = (n) => page.evaluate(`(async () => {
    const text = ${JSON.stringify(readFileSync(join(homedir(), '.keepsake-test', `keepsake-test-${n}${n === 15000 ? LIB_SUFFIX : ''}.json`), 'utf8'))};
    const mod = await import('${`chrome-extension://${id}/src/shared/storage.js`}');
    const store = mod.idbBackend ? mod.createStore(mod.chromeBackend(), mod.idbBackend()) : mod.createStore(mod.chromeBackend());
    await store.init();
    const t0 = performance.now();
    try {
      const r = await store.importJSON(JSON.parse(text), { mode: 'merge' });
      return { ok: true, ms: Math.round(performance.now() - t0), ...r, total: (await store.getItems()).length };
    } catch (e) {
      return { ok: false, ms: Math.round(performance.now() - t0), error: String(e && e.message || e), total: (await store.getItems()).length };
    }
  })()`);

  const s0 = await save(20);
  out.results.save_empty = s0.times ? { medianMs: +median(s0.times).toFixed(1), p95Ms: +p95(s0.times).toFixed(1) } : s0;
  out.results.import_5000 = await importLib(5000);
  out.results.storage_5000 = await storage();
  const s1 = await save(20);
  out.results.save_at_5000 = s1.times ? { medianMs: +median(s1.times).toFixed(1), p95Ms: +p95(s1.times).toFixed(1) } : s1;
  out.results.dashboard_ready_5000 = await dashReady();
  out.results.import_15000_more = await importLib(15000);
  out.results.storage_after_15000 = await storage();
  const s2 = await save(10);
  out.results.save_after_15000 = s2.times ? { medianMs: +median(s2.times).toFixed(1), p95Ms: +p95(s2.times).toFixed(1) } : s2;
  out.results.dashboard_ready_after_15000 = await dashReady();
  page.close();
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => { console.error('BENCH FAILED:', e.message); process.exitCode = 1; }).finally(async () => {
  proc.kill('SIGTERM');
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
});
