// Real-browser upgrade check: run Keepsake from <oldDir> in a throwaway profile, give it a library,
// then swap in <newDir> at the same path (same extension id) and confirm the migration.
//   node replica/tools/cdp_upgrade.mjs <oldDir> <newDir> [--browser path] [--headed]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const [oldDir, newDir] = process.argv.slice(2);
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const BROWSER = arg('--browser', '/Applications/Comet.app/Contents/MacOS/Comet');
const HEADED = process.argv.includes('--headed');
const work = mkdtempSync(join(tmpdir(), 'keepsake-upgrade-'));
const profile = join(work, 'profile');
const ext = join(work, 'keepsake');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch() {
  const port = 9800 + Math.floor(Math.random() * 150);
  const proc = spawn(BROWSER, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${ext}`, `--disable-extensions-except=${ext}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', ...(HEADED ? [] : ['--headless=new']), 'about:blank'], { stdio: 'ignore' });
  return { proc, port };
}
async function json(port, path) {
  for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${port}${path}`)).json(); } catch { await sleep(500); } }
  throw new Error('DevTools endpoint did not come up');
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => { await ready; return new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); }); };
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  return { evaluate, close: () => ws.close() };
}
async function openDashboard(port) {
  let id = null;
  for (let i = 0; i < 40 && !id; i++) { const t = (await json(port, '/json/list')).find((x) => x.url.startsWith('chrome-extension://') && x.url.endsWith('/background.js')); if (t) id = new URL(t.url).host; else await sleep(500); }
  if (!id) throw new Error('extension not loaded');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`chrome-extension://${id}/src/dashboard/dashboard.html#all`)}`, { method: 'PUT' })).json();
  await sleep(3000);
  return { id, page: connect(target.webSocketDebuggerUrl) };
}
async function stop(proc) { proc.kill('SIGTERM'); await sleep(2500); }

async function main() {
  cpSync(oldDir, ext, { recursive: true });
  // Phase 1: the old version with a library.
  let { proc, port } = launch();
  let { id, page } = await openDashboard(port);
  const lib = readFileSync(join(homedir(), '.keepsake-test', 'keepsake-test-5000.json'), 'utf8');
  const before = await page.evaluate(`(async () => {
    const mod = await import('chrome-extension://${id}/src/shared/storage.js');
    const store = mod.createStore(mod.chromeBackend());
    await store.init();
    await store.importJSON(JSON.parse(${JSON.stringify(lib)}));
    await store.updateSettings({ theme: 'dark' });
    await store.setSecret('aiApiKey', 'sk-upgrade-test');
    const items = await store.getItems();
    const sample = items.slice(0, 50).map((i) => [i.id, i.title, i.collectionId, i.price, i.note]);
    return { version: chrome.runtime.getManifest().version, schema: (await chrome.storage.local.get('keepsake_meta')).keepsake_meta.schemaVersion, items: items.length, collections: (await store.getCollections()).length, sample };
  })()`);
  page.close();
  await stop(proc);

  // Phase 2: same profile, same path, new code.
  rmSync(ext, { recursive: true, force: true });
  cpSync(newDir, ext, { recursive: true });
  ({ proc, port } = launch());
  ({ id, page } = await openDashboard(port));
  const after = await page.evaluate(`(async () => {
    const mod = await import('chrome-extension://${id}/src/shared/storage.js');
    const store = mod.createStore(mod.chromeBackend(), mod.idbBackend());
    await store.init();
    const items = await store.getItems();
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const sample = ${JSON.stringify(null)};
    const raw = await chrome.storage.local.get(null);
    return {
      meta: raw.keepsake_meta,
      items: items.length,
      collections: (await store.getCollections()).length,
      theme: (await store.getSettings()).theme,
      keyKept: (await store.getSecret('aiApiKey')) === 'sk-upgrade-test',
      legacyItemsKept: raw.keepsake_items ? Object.keys(raw.keepsake_items).length : 0,
      byId: Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, [v.id, v.title, v.collectionId, v.price, v.note, v.originalTitle, v.captureState, v.deletedAt]])),
      cardsShown: document.querySelectorAll('.grid-item').length,
      bootError: /couldn.t start/i.test(document.getElementById('view')?.textContent || ''),
    };
  })()`);
  page.close();
  await stop(proc);

  const mismatched = before.sample.filter(([id, title, col, price, note]) => {
    const a = after.byId[id];
    return !a || a[1] !== title || a[2] !== col || a[3] !== price || a[4] !== note || a[5] !== title || a[6] !== 'complete' || a[7] !== null;
  });
  console.log(JSON.stringify({
    before: { version: before.version, schema: before.schema, items: before.items, collections: before.collections },
    after: { schema: after.meta.schemaVersion, migratedCounts: after.meta.migratedCounts, items: after.items, collections: after.collections, theme: after.theme, keyKept: after.keyKept, legacyItemsKept: after.legacyItemsKept, cardsShown: after.cardsShown, bootError: after.bootError },
    sampleChecked: before.sample.length, sampleMismatched: mismatched.length,
  }, null, 1));
}
main().catch((e) => { console.error('UPGRADE CHECK FAILED:', e.message); process.exitCode = 1; }).finally(() => { try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } });
