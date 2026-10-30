// Screenshots of the place choices in the dashboard (Chrome, Mac Safari): renders the real dashboard place view (jsdom, as tests/dashboard.test.mjs boots it) with a save holding
// two place choices, then screenshots the rendered page with the real CSS in Chromium.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
const REPO = new URL('../../', import.meta.url).pathname;
const { fakeChrome } = await import(REPO + 'tests/helpers/fake-chrome.mjs');
const ROOT = new URL('file://' + REPO + 'keepsake/');
const html = readFileSync(new URL('src/dashboard/dashboard.html', ROOT), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'chrome-extension://test-extension-id/src/dashboard/dashboard.html#home', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
for (const key of Object.getOwnPropertyNames(window)) if (!(key in globalThis)) { try { globalThis[key] = window[key]; } catch {} }
Object.assign(globalThis, { window, document: window.document, location: window.location });
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = window.matchMedia; window.scrollTo = () => {}; globalThis.scrollTo = () => {};
const F = fakeChrome(); globalThis.chrome = F.chrome; window.chrome = F.chrome;
window.eval(readFileSync(new URL('src/instagram/adapter.js', ROOT), 'utf8')); globalThis.KeepsakeInstagram = window.KeepsakeInstagram;
await import(REPO + 'keepsake/src/dashboard/dashboard.js');
await new Promise((r) => setTimeout(r, 800));
const { createStore, chromeBackend, idbBackend } = await import(REPO + 'keepsake/src/shared/storage.js');
const { openPlace } = await import(REPO + 'keepsake/src/dashboard/places.js');
const store = createStore(chromeBackend(), idbBackend());
const a = await store.addItem({ title: "Joe's Pizza", url: 'https://www.instagram.com/p/joe1/', type: 'instagram', kind: 'place', instagram: { caption: "Classic slice 🍕 📍 Joe's Pizza, New York", creator: 'nycslices' }, details: { locality: 'New York', region: 'NY', source: 'page' },
  placeChoices: [
    { name: "Joe's Pizza", address: '7 Carmine Street', locality: 'New York', region: 'NY', lat: 40.73, lng: -74.0, url: 'https://www.openstreetmap.org/node/103', source: 'openstreetmap', confirmedBy: ['openstreetmap'], why: 'same name, same area' },
    { name: "Joe's Pizza Broadway (Times Square location, open late)", address: '1435 Broadway', locality: 'New York', region: 'NY', lat: 40.75, lng: -73.98, url: 'https://www.openstreetmap.org/node/104', source: 'openstreetmap', confirmedBy: ['openstreetmap', 'cited-page'], why: 'same name, same area' },
    { name: "Joe's Pizza", address: '', locality: 'Brooklyn', region: 'NY', url: 'https://www.joespizzanyc.com/locations', source: 'web', confirmedBy: [], why: 'named like the post' }] });
await new Promise((r) => setTimeout(r, 500));
openPlace(a.id);
await new Promise((r) => setTimeout(r, 800));
const css = ['src/shared/fonts.css', 'src/shared/tokens.css', 'src/shared/base.css', 'src/shared/looks.css', 'src/dashboard/dashboard.css'].map((p) => `<link rel="stylesheet" href="file://${REPO}keepsake/${p}">`).join('');
let out = '<!doctype html>' + window.document.documentElement.outerHTML.replace(/<link[^>]+stylesheet[^>]*>/g, '').replace('</head>', css + '</head>');
// Each style at desktop and phone width, through Chromium (Playwright is on this Mac).
//   node tools/qa/place-shots.mjs <out dir>
const dir = process.argv[2] || 'replica/m3/screens';
const page = `${dir}/.place-choices.html`;
writeFileSync(page, out);
// Playwright isn't a dependency here: it is found on NODE_PATH (any project's node_modules on this Mac).
const { chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
for (const style of ['', 'paper', 'chromatic']) for (const [w, h, name] of [[1280, 900, 'mac'], [390, 844, 'narrow']]) {
  const tab = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await tab.goto(`file://${resolve(page)}`);
  await tab.evaluate((s) => { if (s) document.documentElement.dataset.style = s; else delete document.documentElement.dataset.style; }, style);
  await tab.waitForTimeout(300);
  const box = await tab.$('.modal-place') || tab;
  await box.screenshot({ path: `${dir}/place-choices-${name}-${style || 'nocturne'}.png` });
  await tab.close();
}
await browser.close();
unlinkSync(page);
console.log('rendered', !!window.document.querySelector('.place-choices'), '→', dir);
process.exit(0);
