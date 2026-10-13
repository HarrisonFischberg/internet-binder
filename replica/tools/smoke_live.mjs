// Live smoke test: real pages, the real extension, the real save path.
//
//   node replica/tools/smoke_live.mjs [--only id1,id2] [--no-lookups] [--browser /path/to/Comet]
//
// For each page in replica/smoke/sites.json, in a throwaway headless profile:
//   1. opens it like a visitor would (one page at a time, a pause between pages);
//   2. notes a login wall, bot check or error page as "blocked" (never works around them);
//   3. reads it with keepsake/src/extract/extract.js and saves it through Keepsake's own background
//      worker (the same message the popup sends), so kinds, names, addresses and filing are real;
//   4. with lookups on (default), asks OpenStreetMap / Wikidata / Open Library what Keepsake's lookups
//      would (at most one OpenStreetMap request a second) and records whether a pin was found;
//   5. checks the result against the page's "expect" (and "ideal") and writes a report to
//      replica/smoke/reports/<date>.md and .json.
//
// Polite by design: about 50 pages, one at a time, run occasionally by hand. Not a crawler.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lookupPlace, lookupAddressAt, lookupFilm, lookupBook } from '../../keepsake/src/shared/lookups.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const EXT = join(ROOT, 'keepsake');
const BROWSER = opt('--browser', '/Applications/Comet.app/Contents/MacOS/Comet');
const ONLY = (opt('--only', '') || '').split(',').filter(Boolean);
const LOOKUPS = !flag('--no-lookups');
const PAUSE_MS = 2500;
const sites = JSON.parse(readFileSync(join(ROOT, 'replica/smoke/sites.json'), 'utf8')).sites.filter((s) => !ONLY.length || ONLY.includes(s.id));
const EXTRACT = readFileSync(join(EXT, 'src/extract/extract.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9300 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'keepsake-smoke-'));
const proc = spawn(BROWSER, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
  '--no-first-run', '--no-default-browser-check', '--headless=new', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

async function json(path, opts) { for (let i = 0; i < 60; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, opts)).json(); } catch { await sleep(500); } } throw new Error('DevTools did not come up'); }
function connect(u) {
  const ws = new WebSocket(u); let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => { await ready; return new Promise((res, rej) => { const i = ++id; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
  const evaluate = async (expression, timeout = 20000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// A page we can't read as a visitor would: a login wall, a bot check, an error page.
const BLOCK_RE = /can.t be reached|err_[a-z_]+|access denied|are you a robot|verify (?:you are|that you're) (?:a )?human|press (?:&|and) hold|captcha|unusual traffic|log ?in to (?:continue|see)|sign up to see|you must log in|page not found|forbidden|blocked|something went wrong|attention required|just a moment/i;

let lastOsm = 0;
const osmTurn = async () => { const w = 1100 - (Date.now() - lastOsm); if (w > 0) await sleep(w); lastOsm = Date.now(); };
const ua = { 'User-Agent': 'Keepsake-smoke-test/1.5 (occasional manual run)' };
const fetchUa = (u, o) => fetch(u, { ...o, headers: { ...(o && o.headers), ...ua } });

function check(item, want) {
  if (!want) return { ok: true, why: [] };
  const why = [];
  const kinds = Array.isArray(want.kind) ? want.kind : [want.kind];
  if (want.kind && !kinds.includes(item.kind)) why.push(`kind ${item.kind}, wanted ${kinds.join(' or ')}`);
  if (want.name && !String(item.title || '').toLowerCase().includes(String(want.name).toLowerCase())) why.push(`name "${item.title}" lacks "${want.name}"`);
  if (want.address && !(item.details?.address)) why.push('no street address');
  return { ok: !why.length, why };
}

async function main() {
  let extId = null;
  for (let i = 0; i < 40 && !extId; i++) { const t = (await json('/json/list')).find((x) => x.url.startsWith('chrome-extension://') && x.url.endsWith('/background.js')); if (t) extId = new URL(t.url).host; else await sleep(500); }
  if (!extId) throw new Error('the extension did not load');
  const dashT = await json(`/json/new?${encodeURIComponent(`chrome-extension://${extId}/src/dashboard/dashboard.html#home`)}`, { method: 'PUT' });
  const dash = connect(dashT.webSocketDebuggerUrl);
  await sleep(2500);
  const results = [];
  for (const site of sites) {
    const row = { id: site.id, url: site.url, source: site.source, category: site.category, status: '', kind: '', title: '', address: '', locality: '', pin: '', notes: [] };
    const started = Date.now();
    let page = null;
    try {
      const t = await json(`/json/new?${encodeURIComponent(site.url)}`, { method: 'PUT' });
      page = connect(t.webSocketDebuggerUrl);
      await page.send('Page.enable');
      for (let i = 0; i < 30; i++) { await sleep(500); try { if ((await page.evaluate('document.readyState', 3000)) === 'complete') break; } catch { /* navigating */ } }
      await sleep(3500);
      const look = await page.evaluate(`({ title: document.title, text: String(document.body?.innerText || '').slice(0, 3000), len: String(document.body?.innerText || '').length, url: location.href })`);
      const product = await page.evaluate(EXTRACT, 30000);
      const res = await dash.evaluate(`new Promise((r) => chrome.runtime.sendMessage({ type: 'keepsake:save-item', product: ${JSON.stringify(product)}, force: true, instant: true, source: 'toolbar' }, r))`, 30000);
      if (!res?.ok) throw new Error(res?.error || 'save failed');
      const item = res.item;
      Object.assign(row, { kind: item.kind, title: item.title, address: item.details?.address || '', locality: [item.details?.locality, item.details?.region].filter(Boolean).join(', ') });
      const blockedLook = BLOCK_RE.test(`${look.title} ${look.text.slice(0, 600)}`) || look.len < 120;
      // Lookups: what Keepsake would find with them turned on.
      if (LOOKUPS) {
        try {
          const d = item.details || {};
          if (item.kind === 'place' && d.lat == null) {
            const found = await lookupPlace({ name: item.title, locality: d.locality, address: d.address, region: d.region }, fetchUa, osmTurn);
            row.pin = found ? `${found.lat.toFixed(4)},${found.lng.toFixed(4)} (${[found.address, found.locality].filter(Boolean).join(', ')})` : 'none';
          } else if (item.kind === 'place') {
            row.pin = `${d.lat},${d.lng} (from the page)`;
            if (!d.address) {
              const at = await lookupAddressAt({ lat: d.lat, lng: d.lng }, fetchUa, osmTurn);
              if (at?.address) { row.address = `${at.address} (looked up)`; item.details.address = at.address; }
            }
          }
          else if (item.kind === 'media') row.pin = (await lookupFilm({ title: item.title, year: d.year }, fetchUa)) ? 'Wikidata match' : 'no Wikidata match';
          else if (item.kind === 'book') row.pin = (await lookupBook({ title: item.title, author: d.author }, fetchUa)) ? 'Open Library match' : 'no Open Library match';
        } catch (e) { row.notes.push(`lookup error: ${e.message}`); }
      }
      const exp = check(item, site.expect);
      const ideal = site.ideal ? check(item, site.ideal) : null;
      if (blockedLook && !exp.ok) { row.status = 'blocked'; row.notes.push(`page looked like a login wall or bot check ("${look.title.slice(0, 60)}")`); }
      else row.status = exp.ok ? (ideal && !ideal.ok ? 'gap' : 'pass') : 'fail';
      row.notes.push(...exp.why, ...(ideal && !ideal.ok ? ideal.why.map((w) => `ideal: ${w}`) : []));
    } catch (e) {
      row.status = 'error';
      row.notes.push(e.message.slice(0, 160));
    } finally {
      try { page?.close(); } catch { /* ignore */ }
      try { const list = await json('/json/list'); for (const x of list) if (x.type === 'page' && !x.url.startsWith('chrome-extension://')) await fetch(`http://127.0.0.1:${PORT}/json/close/${x.id}`); } catch { /* ignore */ }
    }
    row.ms = Date.now() - started;
    results.push(row);
    console.log(`${row.status.padEnd(7)} ${row.id.padEnd(32)} ${String(row.kind).padEnd(8)} ${String(row.title).slice(0, 40).padEnd(40)} ${row.address ? `| ${row.address}` : ''} ${row.pin ? `| pin ${row.pin}` : ''} ${row.notes.length ? `| ${row.notes.join('; ')}` : ''}`);
    await sleep(PAUSE_MS);
  }
  dash.close();
  writeReport(results);
}

function writeReport(results) {
  // A partial run (--only) gets its own file, so it never replaces the day's full report.
  const day = `${new Date().toISOString().slice(0, 10)}${ONLY.length ? '-partial' : ''}`;
  const dir = join(ROOT, 'replica/smoke/reports');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${day}.json`), JSON.stringify({ ranAt: new Date().toISOString(), lookups: LOOKUPS, results }, null, 2));
  const count = (s) => results.filter((r) => r.status === s).length;
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    `# Live smoke test, ${day}`,
    '',
    `${results.length} pages: **${count('pass')} pass**, ${count('gap')} gap, **${count('fail')} fail**, ${count('blocked')} blocked, ${count('error')} error. Lookups ${LOOKUPS ? 'on' : 'off'}.`,
    '',
    'pass = what Keepsake must produce · gap = passes, but short of the ideal · fail = wrong · blocked = login wall or bot check (not worked around) · error = the page or save broke',
    '',
    '| status | page | source | kind | name | address | area | lookup | notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.status} | [${esc(r.id)}](${r.url}) | ${esc(r.source)} | ${esc(r.kind)} | ${esc(r.title).slice(0, 60)} | ${esc(r.address)} | ${esc(r.locality)} | ${esc(r.pin)} | ${esc(r.notes.join('; '))} |`),
    '',
  ];
  writeFileSync(join(dir, `${day}.md`), lines.join('\n'));
  console.log(`\nwrote replica/smoke/reports/${day}.md: ${count('pass')} pass, ${count('gap')} gap, ${count('fail')} fail, ${count('blocked')} blocked, ${count('error')} error`);
}

main().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exitCode = 1; })
  .finally(async () => { proc.kill('SIGTERM'); await sleep(1500); try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } });
