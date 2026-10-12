// The real background worker (keepsake/background.js) wired to a fake chrome.* (tests/helpers/fake-chrome.mjs).
// This exercises the message hub and save pipeline; it does not prove behaviour in real Chrome.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const F = fakeChrome();
globalThis.chrome = F.chrome;
await import('../keepsake/background.js');
const { MSG } = await import('../keepsake/src/shared/messages.js');
const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
// A second store over the same storage, like the popup or dashboard would have.
const S = createStore(chromeBackend(), idbBackend());
const items = async () => Object.fromEntries((await S.db.all('items')).map((i) => [i.id, i]));
const collections = async () => S.getCollections();

const popup = { url: F.chrome.runtime.getURL('src/popup/popup.html') };
const pageTab = { tab: { id: 7, url: 'https://shop.example/x' }, url: 'https://shop.example/x' };

async function install() {
  for (const k of Object.keys(F.local)) delete F.local[k];
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('keepsake'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  F.calls.tabsCreated.length = 0;
  for (const fn of F.listeners.installed) await fn({ reason: 'install' });
}
beforeEach(install);

const tent = { title: 'Two-person ultralight backpacking tent', url: 'https://shop.example/tent?utm_source=ig', price: '$329.00', images: [], image: '' };

test('install: starter data, context menu, welcome page', async () => {
  assert.equal(F.local.keepsake_meta.schemaVersion, 3);
  assert.equal((await collections()).length, 3);
  assert.equal(F.calls.contextMenus[0].title, 'Save to Keepsake');
  assert.ok(F.calls.tabsCreated.some((t) => t.url.endsWith('#welcome')));
});

test('save: a confident product is filed and its default collection is created on demand', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(res.ok, true);
  assert.equal(res.collection.name, 'Camping & Outdoors');
  assert.equal(res.item.price, 329);
  assert.equal(res.item.needsReview, false);
  assert.equal(res.item.categorizationSource, 'local');
});

test('save: the same page again is reported as a duplicate; force saves a copy', async () => {
  await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  const dup = await F.send({ type: MSG.SAVE_ITEM, product: { ...tent, url: 'https://shop.example/tent' } }, popup);
  assert.equal(dup.duplicate, true);
  const copy = await F.send({ type: MSG.SAVE_ITEM, product: tent, force: true }, popup);
  assert.equal(copy.ok, true);
  assert.equal(copy.duplicate, undefined);
  assert.equal(Object.keys(await items()).length, 2);
});

test('save: an unsure instant save waits in Review with the best guess suggested', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Linen thing', url: 'https://a.example/1' }, instant: true }, popup);
  assert.equal(res.item.collectionId, null);
  assert.equal(res.item.needsReview, true);
  assert.equal(res.classification.isInbox, true);
});

test('save: choosing a collection overrides the suggestion, is marked manual, and teaches', async () => {
  const home = (await collections()).find((c) => c.name === 'Home Decor');
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, collectionId: home.id, learn: 'strong' }, popup);
  assert.equal(res.item.collectionId, home.id);
  assert.equal(res.item.categorizationSource, 'manual');
  assert.ok(Object.values((await S.getPrefs()).learnedKeywords).some((e) => e[home.id] > 0));
});

test('undoing a save removes it outright (it does not go to the Trash)', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  await F.send({ type: MSG.UNDO_SAVE, itemId: res.item.id }, popup);
  assert.equal((await items())[res.item.id], undefined);
  assert.equal((await S.getTrash()).length, 0);
});

test('update: moving learns; only allowed fields can be patched', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  const home = (await collections()).find((c) => c.name === 'Home Decor');
  const up = await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { collectionId: home.id, note: 'for the trip', url: 'https://evil.example', type: 'instagram' } }, pageTab);
  assert.equal(up.item.collectionId, home.id);
  assert.equal(up.item.note, 'for the trip');
  assert.equal(up.item.url, res.item.url, 'url cannot be changed from a page message');
  assert.equal(up.item.type, 'product');
  assert.ok(up.item.userFields.includes('note'));
  assert.ok(up.item.userFields.includes('collectionId'));
});

test('a suggestion chip can file into a default collection that does not exist yet', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Linen thing', url: 'https://a.example/1' }, instant: true }, popup);
  const up = await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { collectionId: 'new:kitchen' } }, pageTab);
  assert.equal(up.ok, true);
  const kitchen = (await collections()).find((c) => c.taxonomyKey === 'kitchen');
  assert.equal(up.item.collectionId, kitchen.id);
});

test('the capture card on the page loads the design tokens first and follows the chosen style', async () => {
  F.local.keepsake_settings = { ...F.local.keepsake_settings, style: 'minimal', theme: 'dark' };
  F.state.executeScript = async (opts) => (opts.files && opts.files[0] === 'src/extract/extract.js' ? [{ result: { ...tent } }] : [{ result: null }]);
  F.calls.executeScript.length = 0;
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: tent.url }, { id: 3, url: tent.url });
  const inject = F.calls.executeScript.find((c) => c.files && c.files.includes('src/content/toast.js'));
  assert.deepEqual(inject.files, ['src/content/tokens-content.js', 'src/content/toast.js']);
  const show = F.calls.executeScript.find((c) => c.args && c.args[0] && c.args[0].kind === 'saved');
  assert.deepEqual(show.args[0].look, { style: 'minimal', theme: 'dark' });
  assert.equal(show.args[0].title, tent.title);
  F.state.executeScript = async () => [{ result: null }];
});

test('privileged messages are refused from web-page contexts', async () => {
  const r = await F.send({ type: MSG.IG_START_SCAN, tabId: 7 }, pageTab);
  assert.equal(r.ok, false);
  assert.match(r.error, /Not allowed/);
  const r2 = await F.send({ type: MSG.IG_READ_POST, url: 'https://www.instagram.com/p/AbCdE1/' }, pageTab);
  assert.equal(r2.ok, false);
});

test('open dashboard only accepts plain hashes', async () => {
  F.calls.tabsCreated.length = 0;
  await F.send({ type: MSG.OPEN_DASHBOARD, hash: '#item/abc123' }, popup);
  await F.send({ type: MSG.OPEN_DASHBOARD, hash: '#x"><script>' }, popup);
  assert.ok(F.calls.tabsCreated[0].url.endsWith('dashboard.html#item/abc123'));
  assert.ok(F.calls.tabsCreated[1].url.endsWith('dashboard.html'));
});

test('context menu on a restricted page does nothing', async () => {
  F.calls.executeScript.length = 0;
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: 'chrome://settings' }, { id: 3, url: 'chrome://settings' });
  assert.equal(F.calls.executeScript.length, 0);
  assert.equal(Object.keys(await items()).length, 0);
});

test('context menu save: extracts the page, saves, shows a toast', async () => {
  F.state.executeScript = async (opts) => (opts.files && opts.files[0] === 'src/extract/extract.js' ? [{ result: { ...tent } }] : [{ result: null }]);
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: tent.url }, { id: 3, url: tent.url });
  assert.equal(Object.values(await items())[0].title, tent.title);
  assert.ok(F.calls.executeScript.some((c) => c.files && c.files.includes('src/content/toast.js')));
  F.state.executeScript = async () => [{ result: null }];
});

// --- Optional AI after the save (fixes audit A1, A2) ----------------------------------------------
async function aiOn() {
  const st = F.local.keepsake_settings;
  F.local.keepsake_settings = { ...st, ai: { ...st.ai, on: true, provider: 'anthropic', model: 'm' } };
  F.local.keepsake_secrets = { aiApiKey: 'sk-test' };
}
const aiReply = (obj, delay = 0) => async () => {
  await new Promise((r) => setTimeout(r, delay));
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) };
};
const finish = () => F.send({ type: MSG.ENRICH_PENDING }, popup);

test('with AI on, the save is stored before any network call and answers without waiting', async () => {
  await aiOn();
  let storedBeforeCall = null;
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async () => {
    storedBeforeCall = Object.keys(await items()).length;
    await gate;
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }] }) };
  };
  const t0 = performance.now();
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  const elapsed = performance.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(res.item.captureState, 'pending');
  assert.ok(elapsed < 1000, `save answered in ${elapsed.toFixed(0)} ms while the provider was still busy`);
  assert.equal((await items())[res.item.id].captureState, 'pending');
  release();
  await finish();
  assert.equal(storedBeforeCall, 1, 'the item existed before the provider was called');
  assert.equal((await items())[res.item.id].captureState, 'complete');
});

test('AI on, provider down: the save stays with the local result and is marked complete', async () => {
  await aiOn();
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(res.collection.name, 'Camping & Outdoors');
  await finish();
  const it = (await items())[res.item.id];
  assert.equal(it.captureState, 'complete');
  assert.equal(it.categorizationSource, 'local');
  assert.match(it.captureError, /AI tidy skipped: Failed to fetch/);
});

test('an AI-tidied title keeps the captured title and is logged with undo data (fixes A2)', async () => {
  await aiOn();
  const kitchen = await S.ensureCollectionForTaxonomy('kitchen');
  globalThis.fetch = aiReply({ items: [{ ref: 'new', title: 'Ultralight 2P tent', collection: kitchen.name, confidence: 0.9 }] });
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  await finish();
  const it = (await items())[res.item.id];
  assert.equal(it.title, 'Ultralight 2P tent');
  assert.equal(it.originalTitle, tent.title);
  assert.equal(it.collectionId, kitchen.id);
  assert.equal(it.categorizationSource, 'ai');
  const [entry] = await S.getAiLog();
  assert.equal(entry.itemId, it.id);
  assert.equal(entry.before.title, tent.title);
  assert.deepEqual(entry.changes.map((c) => c.field).sort(), ['collection', 'title']);
});

test('a title edited or a collection chosen while AI was working is never overwritten', async () => {
  await aiOn();
  const kitchen = await S.ensureCollectionForTaxonomy('kitchen');
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async () => { await gate; return aiReply({ items: [{ ref: 'new', title: 'AI title', collection: kitchen.name, confidence: 0.95 }] })(); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  const home = (await collections()).find((c) => c.name === 'Home Decor');
  await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { title: 'My own title', collectionId: home.id } }, popup);
  release();
  await finish();
  const it = (await items())[res.item.id];
  assert.equal(it.title, 'My own title');
  assert.equal(it.collectionId, home.id);
  assert.equal(it.captureState, 'complete');
  assert.equal((await S.getAiLog()).length, 0);
});

test('a save left pending (worker stopped) is finished on the next pickup', async () => {
  await aiOn();
  const it = await S.addItem({ title: 'cast iron pan', url: 'https://a.example/pan', captureState: 'pending' });
  globalThis.fetch = aiReply({ items: [{ ref: 'new', title: 'Cast-iron skillet', collection: null, confidence: 0 }] });
  await finish();
  const got = (await items())[it.id];
  assert.equal(got.captureState, 'complete');
  assert.equal(got.title, 'Cast-iron skillet');
});

test('with AI off, saves are complete straight away and nothing is sent', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not be called'); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  await finish();
  assert.equal(res.item.captureState, 'complete');
  assert.equal(called, false);
});
