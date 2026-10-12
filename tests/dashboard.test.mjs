// Boots the real dashboard module in jsdom against the fake chrome.* and visits every route.
// A smoke test for "does each page render without throwing"; layout and pixels are not checked.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const ROOT = new URL('../keepsake/', import.meta.url);
const html = readFileSync(new URL('src/dashboard/dashboard.html', ROOT), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'chrome-extension://test-extension-id/src/dashboard/dashboard.html#home', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const errors = [];

before(async () => {
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!(key in globalThis)) { try { globalThis[key] = window[key]; } catch { /* read-only */ } }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  globalThis.matchMedia = window.matchMedia;
  window.scrollTo = () => {};
  globalThis.scrollTo = window.scrollTo;
  const F = fakeChrome();
  globalThis.chrome = F.chrome;
  window.chrome = F.chrome;
  window.eval(readFileSync(new URL('src/instagram/adapter.js', ROOT), 'utf8'));
  globalThis.KeepsakeInstagram = window.KeepsakeInstagram;
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  await import('../keepsake/src/dashboard/dashboard.js');
  await settle();
  console.error = origError;
});

const settle = () => new Promise((r) => setTimeout(r, 60));
const view = () => window.document.getElementById('view');
async function go(hash) {
  window.location.hash = hash;
  await settle();
  return view().textContent;
}

test('the dashboard boots without errors', () => {
  assert.deepEqual(errors, []);
  assert.ok(view(), 'the #view container exists');
  assert.doesNotMatch(view().textContent, /couldn.t start/i);
});

const ROUTES = ['#home', '#all', '#favorites', '#purchased', '#archive', '#trash', '#collections', '#import', '#settings', '#ai', '#ailog', '#privacy', '#welcome'];
for (const r of ROUTES) {
  test(`route ${r} renders`, async () => {
    const text = await go(r);
    assert.ok(text.trim().length > 0, `${r} rendered nothing`);
    assert.doesNotMatch(text, /couldn.t start|undefined|\[object Object\]/i);
  });
}

test('an empty library shows the first-run empty state', async () => {
  const text = await go('#all');
  assert.match(text, /Nothing saved yet/);
});

test('sample data appears in All saves and Review', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  await store.loadSampleData();
  await settle();
  await settle();
  const all = await go('#all');
  assert.match(all, /Two-person ultralight backpacking tent/);
  const review = await go('#review');
  assert.match(review, /Morning light, kitchen corner/);
});

test('deleting from Review moves the save to Trash, with Undo, and Trash can restore it', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  assert.match(await go('#trash'), /Nothing in Trash/);
  await go('#review');
  const del = [...view().querySelectorAll('button')].find((b) => b.textContent === 'Delete');
  del.click();
  await settle();
  await settle();
  const toast = window.document.body.textContent;
  assert.match(toast, /Moved to Trash/);
  assert.equal((await store.getTrash()).length, 1);
  const trashText = await go('#trash');
  assert.match(trashText, /Morning light, kitchen corner/);
  assert.match(trashText, /removed for good in 30 days/);
  [...view().querySelectorAll('button')].find((b) => b.textContent === 'Restore').click();
  await settle();
  assert.equal((await store.getTrash()).length, 0);
});

test('an unknown collection route says so', async () => {
  const text = await go('#c/does-not-exist');
  assert.match(text, /Collection not found/);
});
