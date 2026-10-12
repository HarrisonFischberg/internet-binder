// The real background worker (keepsake/background.js) wired to a fake chrome.* (tests/helpers/fake-chrome.mjs).
// This exercises the message hub and save pipeline; it does not prove behaviour in real Chrome.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const F = fakeChrome();
globalThis.chrome = F.chrome;
await import('../keepsake/background.js');
const { MSG } = await import('../keepsake/src/shared/messages.js');

const popup = { url: F.chrome.runtime.getURL('src/popup/popup.html') };
const pageTab = { tab: { id: 7, url: 'https://shop.example/x' }, url: 'https://shop.example/x' };

async function install() {
  for (const k of Object.keys(F.local)) delete F.local[k];
  F.calls.tabsCreated.length = 0;
  for (const fn of F.listeners.installed) await fn({ reason: 'install' });
}
beforeEach(install);

const tent = { title: 'Two-person ultralight backpacking tent', url: 'https://shop.example/tent?utm_source=ig', price: '$329.00', images: [], image: '' };

test('install: starter data, context menu, welcome page', async () => {
  assert.equal(F.local.keepsake_meta.schemaVersion, 2);
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
  assert.equal(Object.keys(F.local.keepsake_items).length, 2);
});

test('save: an unsure instant save waits in Review with the best guess suggested', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Linen thing', url: 'https://a.example/1' }, instant: true }, popup);
  assert.equal(res.item.collectionId, null);
  assert.equal(res.item.needsReview, true);
  assert.equal(res.classification.isInbox, true);
});

test('save: choosing a collection overrides the suggestion, is marked manual, and teaches', async () => {
  const cols = Object.values(F.local.keepsake_collections);
  const home = cols.find((c) => c.name === 'Home Decor');
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, collectionId: home.id, learn: 'strong' }, popup);
  assert.equal(res.item.collectionId, home.id);
  assert.equal(res.item.categorizationSource, 'manual');
  assert.ok(Object.values(F.local.keepsake_prefs.learnedKeywords).some((e) => e[home.id] > 0));
});

test('undo removes the saved item', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  await F.send({ type: MSG.UNDO_SAVE, itemId: res.item.id }, popup);
  assert.equal(F.local.keepsake_items[res.item.id], undefined);
});

test('update: moving learns; only allowed fields can be patched', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  const home = Object.values(F.local.keepsake_collections).find((c) => c.name === 'Home Decor');
  const up = await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { collectionId: home.id, note: 'for the trip', url: 'https://evil.example', type: 'instagram' } }, pageTab);
  assert.equal(up.item.collectionId, home.id);
  assert.equal(up.item.note, 'for the trip');
  assert.equal(up.item.url, res.item.url, 'url cannot be changed from a page message');
  assert.equal(up.item.type, 'product');
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
  assert.equal(Object.keys(F.local.keepsake_items).length, 0);
});

test('context menu save: extracts the page, saves, shows a toast', async () => {
  F.state.executeScript = async (opts) => (opts.files && opts.files[0] === 'src/extract/extract.js' ? [{ result: { ...tent } }] : [{ result: null }]);
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: tent.url }, { id: 3, url: tent.url });
  assert.equal(Object.values(F.local.keepsake_items)[0].title, tent.title);
  assert.ok(F.calls.executeScript.some((c) => c.files && c.files.includes('src/content/toast.js')));
  F.state.executeScript = async () => [{ result: null }];
});

// --- Optional AI on the save path: today's behaviour (audit A1, A2) ------------------------------
async function aiOn() {
  F.local.keepsake_settings = { ...F.local.keepsake_settings, ai: { ...F.local.keepsake_settings.ai, on: true, provider: 'anthropic', model: 'm' } };
  F.local.keepsake_secrets = { aiApiKey: 'sk-test' };
}

test('KNOWN ISSUE (audit A1): with AI on, the save is not stored until the AI call returns', async () => {
  await aiOn();
  let storedBeforeReply = null;
  globalThis.fetch = async () => {
    storedBeforeReply = Object.keys(F.local.keepsake_items).length;
    await new Promise((r) => setTimeout(r, 150));
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }] }) };
  };
  const t0 = performance.now();
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  const elapsed = performance.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(storedBeforeReply, 0, 'nothing was stored while waiting on the network');
  assert.ok(elapsed >= 150, `save took ${elapsed.toFixed(0)} ms because it waited for the provider`);
});

test('AI on, provider down: the save still lands with the local result', async () => {
  await aiOn();
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(res.ok, true);
  assert.equal(res.item.categorizationSource, 'local');
  assert.equal(res.collection.name, 'Camping & Outdoors');
});

test('KNOWN ISSUE (audit A2): an AI-tidied title replaces the captured title with no record of the original', async () => {
  await aiOn();
  const cols = Object.values(F.local.keepsake_collections);
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ items: [{ ref: 'new', title: 'Ultralight 2P tent', collection: cols[0].name, confidence: 0.9 }] }) }] }) });
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(res.item.title, 'Ultralight 2P tent');
  assert.equal(res.item.categorizationSource, 'ai');
  assert.ok(!JSON.stringify(res.item).includes(tent.title), 'the captured title is gone');
  assert.equal((F.local.keepsake_aiLog || []).length, 0, 'and the change is not in the AI log');
});
