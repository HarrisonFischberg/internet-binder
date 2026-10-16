// The Instagram scan in a jsdom Saved-collection page (src/instagram/scan.js), and the import picking up
// the thumbnails it captured. Pictures travel on their own, once each: progress reports and the scan's
// stored state carry none (Safari drops multi-MB messages and has a small session area).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const ROOT = new URL('../keepsake/', import.meta.url);
const F = fakeChrome();
let MSG;

before(async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://www.instagram.com/' });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame']) {
    if (!(key in globalThis) && dom.window[key]) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
  }
  globalThis.chrome = F.chrome;
  ({ MSG } = await import('../keepsake/src/shared/messages.js'));
});

function collectionPage(count) {
  const tiles = Array.from({ length: count }, (_, n) => `<a href="/p/TILE${n}xx/"><img src="https://scontent.cdninstagram.com/${n}.jpg" alt="Photo by Cook on May 1, 2026. May be an image of food ${n}."></a>`).join('');
  const dom = new JSDOM(`<html><body><main>${tiles}</main></body></html>`, { url: 'https://www.instagram.com/me/saved/food/17900000000000000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  w.chrome = { runtime: { id: 'test-extension-id', lastError: undefined, sendMessage: (m, cb) => { sent.push(structuredClone(m)); cb && cb(); }, onMessage: { addListener() {} } } };
  w.scrollTo = () => {};
  w.fetch = async () => ({ ok: true, blob: async () => ({ type: 'image/jpeg', size: 2000 }) });
  w.createImageBitmap = async () => ({ width: 640, height: 640, close() {} });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = function () { return `data:image/jpeg;base64,${'B'.repeat(40_000)}`; };
  w.__keepsakeIgScanOptions = { autoScroll: true, idleTimeoutMs: 40, intervalMs: 5, storeThumbnails: true };
  return { w, sent };
}

test('scan: each captured thumbnail is sent once on its own; progress reports carry no pictures', async () => {
  const { w, sent } = collectionPage(30);
  w.eval(readFileSync(new URL('src/instagram/adapter.js', ROOT), 'utf8'));
  w.eval(readFileSync(new URL('src/instagram/scan.js', ROOT), 'utf8'));
  for (let i = 0; i < 400 && !sent.some((m) => m.type === MSG.IG_SCAN_UPDATE && m.status === 'done'); i++) await new Promise((r) => setTimeout(r, 10));
  const updates = sent.filter((m) => m.type === MSG.IG_SCAN_UPDATE);
  const thumbs = sent.filter((m) => m.type === MSG.IG_SCAN_THUMB);
  const done = updates.at(-1);
  assert.equal(done.status, 'done');
  assert.equal(done.posts.length, 30);
  assert.ok(done.posts.every((p) => p.captured && /^https:\/\/scontent\./.test(p.thumbnail)), 'reports keep Instagram links, not pictures');
  for (const u of updates) assert.ok(JSON.stringify(u).length < 50_000, `a ${u.posts.length}-post report stays small`);
  assert.deepEqual(thumbs.map((t) => t.shortcode).sort(), done.posts.map((p) => p.shortcode).sort());
  assert.ok(thumbs.every((t) => t.data.startsWith('data:image/jpeg')));
});

test('import: a save gets the thumbnail the scan stored, else Instagram\'s link', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const { putThumbs, clearScanStore } = await import('../keepsake/src/instagram/scanStore.js');
  const { importPosts } = await import('../keepsake/src/dashboard/importer.js');
  const store = createStore(chromeBackend(), idbBackend());
  await store.init();
  await putThumbs(new Map([['KEPT1xx', 'data:image/jpeg;base64,KEPT']]));
  const ctx = { store, state: { collections: await store.getCollections(), prefs: await store.getPrefs(), settings: await store.getSettings() }, send: async () => ({ ok: true }) };
  const post = (code) => ({ url: `https://www.instagram.com/p/${code}/`, shortcode: code, type: 'post', thumbnail: `https://scontent.cdninstagram.com/${code}.jpg`, captured: true, caption: 'Linen lampshade for the bedroom' });
  await importPosts(ctx, { collectionName: 'Home' }, [post('KEPT1xx'), post('NONE1xx')]);
  const saved = Object.fromEntries((await store.db.all('items')).map((i) => [i.url, i]));
  assert.equal(saved['https://www.instagram.com/p/KEPT1xx/'].image, 'data:image/jpeg;base64,KEPT');
  assert.equal(saved['https://www.instagram.com/p/NONE1xx/'].image, 'https://scontent.cdninstagram.com/NONE1xx.jpg');
  await clearScanStore();
});
