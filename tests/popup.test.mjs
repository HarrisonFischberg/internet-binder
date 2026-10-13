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
  assert.equal(page.getElementById('savedTitle').textContent, 'Saved to Videos');
  assert.ok(!visible('savedMoveRow'), 'no collection picker: collections are for shopping');
  assert.ok(visible('savedUndo'));
});

test('popup: opening it again on a saved video shows that save, not the duplicate preview', async () => {
  await openPopup(video);
  assert.equal(page.getElementById('savedTitle').textContent, 'Already in Videos');
  assert.ok(!visible('savedMoveRow'));
  assert.ok(!visible('savedUndo'), 'nothing new was saved, so nothing to undo');
  assert.match(page.getElementById('savedInboxHint').textContent, /^Saved .*on this device\.$/);
  assert.ok(!page.querySelector('#state-product:not(.hidden)'), 'no preview');
  F.calls.tabsCreated.length = 0;
  page.getElementById('savedOpen').click();
  for (let i = 0; i < 40 && !F.calls.tabsCreated.length; i++) await settle(25);
  assert.match(F.calls.tabsCreated.at(-1)?.url || '', /dashboard\.html#kind\/video$/, 'Open in dashboard goes to Videos, not Review');
});

test('popup: the preview for a video names its Lifestyle view, with no collection picker or price', async () => {
  // A preview is shown after Undo on a save made straight away.
  const fresh = { ...video, title: 'Another sketch', url: 'https://www.youtube.com/watch?v=popup2' };
  await openPopup(fresh);
  page.getElementById('savedUndo').click();
  await settle(150);
  await ready();
  assert.ok(page.querySelector('.collection-picker').classList.contains('hidden'), 'no collection picker for a video');
  assert.equal(page.getElementById('shelfTarget').textContent, 'Videos, under Lifestyle');
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
