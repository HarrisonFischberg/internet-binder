// The real popup (keepsake/src/popup) in jsdom, talking to the real background worker through a fake
// chrome.* (tests/helpers/fake-chrome.mjs). Each run loads a fresh popup page, like opening it again.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const ROOT = new URL('../keepsake/', import.meta.url);
const html = readFileSync(new URL('src/popup/popup.html', ROOT), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const F = fakeChrome();
globalThis.chrome = F.chrome;
// The popup's messages go to the background worker, as in Chrome.
F.chrome.runtime.sendMessage = (msg, cb) => { F.send(msg).then((res) => cb && cb(res)); };
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

let runs = 0;
let page = null;
// Opens the popup on a tab showing `product` (what extract.js would return).
async function openPopup(product) {
  F.chrome.tabs.query = async () => [{ id: 7, url: product.url, active: true }];
  F.state.executeScript = async (opts) => (opts.files && opts.files.includes('src/extract/extract.js') ? [{ result: { ...product } }] : [{ result: null }]);
  const dom = new JSDOM(html, { url: 'chrome-extension://test-extension-id/src/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!(key in globalThis) || key === 'location') { try { globalThis[key] = window[key]; } catch { /* read-only */ } }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  globalThis.matchMedia = window.matchMedia;
  window.chrome = F.chrome;
  window.eval(readFileSync(new URL('src/instagram/adapter.js', ROOT), 'utf8'));
  globalThis.KeepsakeInstagram = window.KeepsakeInstagram;
  await import(`../keepsake/src/popup/popup.js?run=${++runs}`);
  page = window.document;
  await ready();
  return page;
}
// Waits until the popup has left its loading state (up to 4 s).
async function ready() {
  for (let i = 0; i < 80; i++) {
    const loading = page.getElementById('state-loading');
    if (loading && loading.classList.contains('hidden')) return;
    await settle(50);
  }
  throw new Error('the popup never finished loading');
}
const visible = (id) => { const n = page.getElementById(id); return !!n && !n.closest('.hidden') && !n.hidden && !n.closest('[hidden]'); };

before(async () => {
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  await import('../keepsake/background.js');
  for (const fn of F.listeners.installed) await fn({ reason: 'install' });
});

const video = { title: 'Top 5 cold opens', url: 'https://www.youtube.com/watch?v=popup1', images: ['https://i.ytimg.com/vi/popup1/hqdefault.jpg'], image: 'https://i.ytimg.com/vi/popup1/hqdefault.jpg',
  price: null, priceText: '10000', schemaTypes: [], media: { ogType: 'video.other', channel: 'Example Comedy' } };

test('popup: a new YouTube video saves straight to Videos', async () => {
  await openPopup(video);
  assert.equal(page.getElementById('savedTitle').textContent, 'Saved to');
  assert.equal(page.getElementById('savedMove').value, 'kind:video');
  assert.deepEqual([...page.querySelectorAll('#savedMove optgroup')].map((g) => g.label), ['Lifestyle', 'Collections'], 'any Lifestyle view or collection');
  assert.ok(visible('savedUndo'));
});

test('popup: opening it again on a saved video shows that save, not the duplicate preview', async () => {
  await openPopup(video);
  assert.equal(page.getElementById('savedTitle').textContent, 'Already in');
  assert.equal(page.getElementById('savedMove').value, 'kind:video');
  assert.ok(!visible('savedUndo'), 'nothing new was saved, so nothing to undo');
  assert.match(page.getElementById('savedInboxHint').textContent, /^Saved .*on this device\.$/);
  assert.ok(!page.querySelector('#state-product:not(.hidden)'), 'no preview');
  F.calls.tabsCreated.length = 0;
  page.getElementById('savedOpen').click();
  for (let i = 0; i < 40 && !F.calls.tabsCreated.length; i++) await settle(25);
  assert.match(F.calls.tabsCreated.at(-1)?.url || '', /dashboard\.html#kind\/video$/, 'Open in dashboard goes to Videos, not Review');
});

test('popup: the preview for a video picks its Lifestyle view, and shows no price', async () => {
  // A preview is shown after Undo on a save made straight away.
  const fresh = { ...video, title: 'Another sketch', url: 'https://www.youtube.com/watch?v=popup2' };
  await openPopup(fresh);
  page.getElementById('savedUndo').click();
  await settle(150);
  await ready();
  const sel = page.getElementById('collectionSelect');
  assert.equal(sel.value, 'kind:video', 'Videos is picked');
  assert.ok([...sel.querySelectorAll('optgroup')].some((g) => g.label === 'Lifestyle'));
  assert.ok(page.querySelector('.price-row').classList.contains('hidden'), 'no price for a video');
});

test('popup: a product page still shows its price in the preview', async () => {
  const lamp = { title: 'Lamp', url: 'https://shop.example/lamp-popup', price: 12, priceText: '$12.00', currency: 'USD', images: [], image: '', schemaTypes: ['product'] };
  await openPopup(lamp);
  if (page.getElementById('savedUndo') && visible('savedUndo')) {
    page.getElementById('savedUndo').click();
    await settle(150);
    await ready();
  }
  assert.ok(!page.querySelector('.price-row').classList.contains('hidden'));
  assert.equal(page.getElementById('priceInput').value, '12');
});

test('popup: a saved post moved into Places becomes a place named from its caption', async () => {
  const post = { title: 'nyceats on Instagram: "Best donuts in the city"', url: 'https://www.instagram.com/reel/donut1/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [],
    description: '1,234 likes - nyceats: "Best donuts in the city 🍩 Try the glazed. #nyc"' };
  await openPopup(post);
  // Keepsake wasn't sure, so it shows the preview: pick Places from the Lifestyle group and save.
  const sel = page.getElementById('collectionSelect');
  assert.ok(!page.getElementById('state-product').classList.contains('hidden'), 'the preview');
  sel.value = 'kind:place';
  sel.dispatchEvent(new window.Event('change'));
  assert.ok(page.querySelector('.price-row').classList.contains('hidden'), 'no price for a place');
  page.getElementById('saveBtn').click();
  for (let i = 0; i < 60 && page.getElementById('state-saved')?.classList.contains('hidden') !== false; i++) await settle(25);
  assert.equal(page.getElementById('savedMove').value, 'kind:place');
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const saved = await store.findByUrl(post.url);
  assert.deepEqual([saved.kind, saved.collectionId, saved.needsReview], ['place', null, false]);
});

test('popup: an Instagram post with 📍 in its caption is saved as a place, named from it', async () => {
  const post = { title: 'nyceats on Instagram: "Glazed heaven"', url: 'https://www.instagram.com/reel/donut2/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [],
    description: '987 likes - nyceats: "Glazed heaven 🍩\n📍 Peter Pan Donut & Pastry Shop, Greenpoint\n#nycfood"' };
  await openPopup(post);
  assert.equal(page.getElementById('savedMove').value, 'kind:place');
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const saved = await createStore(chromeBackend(), idbBackend()).findByUrl(post.url);
  assert.deepEqual([saved.kind, saved.title, saved.details.locality], ['place', 'Peter Pan Donut & Pastry Shop', 'Greenpoint']);
});

test('popup: the Saved overview asks for instagram.com access up front, and the hint goes once it is granted', async () => {
  F.state.granted = F.state.granted.filter((o) => !/instagram|\*:\/\/\*\//.test(o));
  await openPopup({ title: 'Saved', url: 'https://www.instagram.com/someone/saved/', images: [], image: '', price: null, schemaTypes: [] });
  assert.ok(visible('igAccess'), 'the hint shows on the overview');
  assert.match(page.getElementById('igAccess').textContent, /doesn’t have access to instagram\.com/);
  const realRequest = F.chrome.permissions.request;
  F.chrome.permissions.request = async () => false;
  try {
    page.querySelector('#igAccess button').click();
    await settle(50);
    assert.match(page.getElementById('igAccess').textContent, /Access wasn’t granted\. To allow it yourself: right-click the Keepsake icon/);
  } finally {
    F.chrome.permissions.request = realRequest;
  }
  page.querySelector('#igAccess button').click();
  await settle(50);
  assert.equal(page.getElementById('igAccess'), null, 'granted, so the hint is gone');
  assert.ok(F.state.granted.includes('https://www.instagram.com/*'));
  // With access already granted, the overview opens without the hint.
  await openPopup({ title: 'Saved', url: 'https://www.instagram.com/someone/saved/', images: [], image: '', price: null, schemaTypes: [] });
  assert.equal(page.getElementById('igAccess'), null);
  F.state.granted = F.state.granted.filter((o) => o !== 'https://www.instagram.com/*');
});
