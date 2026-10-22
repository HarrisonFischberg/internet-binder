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

test('adapter: the Saved overview lists each collection once, "All posts" included, Instagram\'s own folders left out', async () => {
  const dom = new JSDOM(`<html><body><main>
    <a href="/me/saved/all-posts/"><span>All posts</span></a>
    <a href="/me/saved/dinner-ideas/17841000000000001/"><img alt=""><span>Dinner ideas</span></a>
    <a href="/me/saved/living-room/17841000000000002/" aria-label="Living room"><img alt=""></a>
    <a href="/me/saved/dinner-ideas/17841000000000001/">again</a>
    <a href="/me/saved/audio/">Audio</a>
    <a href="/p/NOTACOLL1/">a post</a>
  </main></body></html>`, { url: 'https://www.instagram.com/me/saved/', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(readFileSync(new URL('src/instagram/adapter.js', ROOT), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(w.KeepsakeInstagram.collectCollections(w.document))), [
    { name: 'All posts', url: 'https://www.instagram.com/me/saved/all-posts/', kind: 'all' },
    { name: 'Dinner ideas', url: 'https://www.instagram.com/me/saved/dinner-ideas/17841000000000001/', kind: 'collection' },
    { name: 'Living room', url: 'https://www.instagram.com/me/saved/living-room/17841000000000002/', kind: 'collection' },
  ]);
});

test('import all collections: each Instagram collection becomes a group; recipes still go to Recipes; loose posts are sorted', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const { importPosts } = await import('../keepsake/src/dashboard/importer.js');
  const store = createStore(chromeBackend(), idbBackend());
  await store.init();
  const ctx = { store, state: { collections: await store.getCollections(), prefs: await store.getPrefs(), settings: await store.getSettings() }, send: async () => ({ ok: true }) };
  const post = (code, caption, collections) => ({ url: `https://www.instagram.com/p/${code}/`, shortcode: code, type: 'post', thumbnail: '', caption, collections });
  const scan = { collectionName: 'All collections', bulk: { collections: [] } };
  const summary = await importPosts(ctx, scan, [
    post('GRP0001', 'Linen lampshade for the bedroom', ['Cozy corner', 'Wishlist']),
    post('GRP0002', 'Walnut side table', ['Cozy corner']),
    post('GRP0003', 'Weeknight pasta', ['Dinner ideas']),
    post('GRP0004', 'Two-person ultralight backpacking tent', []),
  ]);
  const saved = Object.fromEntries((await store.db.all('items')).map((i) => [i.url.split('/')[4], i]));
  const cols = Object.fromEntries((await store.getCollections()).map((c) => [c.id, c.name]));
  assert.equal(cols[saved.GRP0001.collectionId], 'Cozy corner', 'the first collection it was in');
  assert.equal(saved.GRP0002.collectionId, saved.GRP0001.collectionId, 'one group per collection');
  assert.equal(saved.GRP0001.instagram.collectionName, 'Cozy corner');
  assert.equal(saved.GRP0003.kind, 'recipe', '“Dinner ideas” sounds like recipes');
  assert.equal(cols[saved.GRP0004.collectionId], 'Camping & Outdoors', 'in no collection: sorted as usual');
  assert.equal(summary.imported, 4);
  // Turned off: everything is sorted by Bowerbird.
  ctx.state.igKeepGroups = false;
  await importPosts(ctx, scan, [post('GRP0005', 'Two-person ultralight backpacking tent, green', ['Cozy corner'])]);
  const tent = (await store.db.all('items')).find((i) => i.url.includes('GRP0005'));
  assert.equal((await store.getCollection(tent.collectionId)).name, 'Camping & Outdoors');
});

test('import: nothing is sent to your AI provider; every post is flagged for Run AI', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const { importPosts } = await import('../keepsake/src/dashboard/importer.js');
  const store = createStore(chromeBackend(), idbBackend());
  await store.init();
  const sent = [];
  const settings = { ...(await store.getSettings()), ai: { on: true, provider: 'anthropic' } };
  const ctx = { store, state: { collections: await store.getCollections(), prefs: await store.getPrefs(), settings }, send: async (m) => { sent.push(m); return { ok: true }; } };
  const post = (code, caption) => ({ url: `https://www.instagram.com/p/${code}/`, shortcode: code, type: 'post', thumbnail: '', caption });
  const summary = await importPosts(ctx, { collectionName: 'Saved' }, [post('NOAI001', 'Linen lampshade'), post('NOAI002', 'Weeknight pasta\nIngredients\n200 g pasta\nSalt')]);
  assert.equal(summary.ids.length, 2);
  assert.ok(!sent.some((m) => m.type === MSG.FILL_BATCH || m.understand), 'no AI batch');
  for (const id of summary.ids) assert.equal((await store.getItem(id)).needsAi, true);
});
