// Checks the iOS core bundle in Node:
// 1. the URL polyfill (used by JavaScriptCore) agrees with Node's WHATWG URL on every URL in the
//    Chrome tests plus edge cases;
// 2. the bundle, run with Node's URL removed (as on iOS), gives the same answers as the ES modules.
// Run: node --test ios/tools/core-bundle.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { bundle, shareExtract, shareExtractPath } from './bundle-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function jscLikeContext() {
  // A context with no URL, URLSearchParams, structuredClone or crypto: like JavaScriptCore.
  const ctx = vm.createContext({ __forceUrlPolyfill: false, Intl, console });
  ctx.globalThis = ctx;
  for (const k of ['URL', 'URLSearchParams', 'structuredClone', 'crypto', 'setTimeout']) vm.runInContext(`delete globalThis.${k}`, ctx);
  return ctx;
}

const corpus = (() => {
  const urls = new Set();
  const dirs = [join(root, 'tests')];
  for (const d of dirs) for (const f of readdirSync(d)) {
    if (!f.endsWith('.mjs')) continue;
    for (const m of readFileSync(join(d, f), 'utf8').matchAll(/https?:\/\/[^\s'"`)<>\]]+/g)) urls.add(m[0].replace(/[.,;]+$/, ''));
  }
  [
    'HTTPS://WWW.Example.COM:443/a/./b/../c?x=1&y=2#frag',
    'http://example.com:8080',
    'https://example.com/path with spaces/ü?q=a b&ü=ö#h é',
    'https://user:pa ss@example.com/',
    'https://münchen.de/straße',
    'https://例え.jp/',
    'http://192.168.0.1:80/',
    'http://0x7f.1/',
    'https://example.com/%7Euser/%2e%2E/x',
    'https://example.com?',
    'https://example.com/#',
    'https://www.instagram.com/reel/ABC123xyz/?igsh=abc&utm_source=ig_web_copy_link',
    'https://www.google.com/maps/place/Caf%C3%A9+Azulejo/@38.7,-9.13,17z/data=!3d38.71!4d-9.13',
    'https://maps.apple.com/?q=Ramen&ll=35.66,139.70&address=Shibuya%20Tokyo',
    'https://youtu.be/dQw4w9WgXcQ?t=42',
    'https://example.com/a\\b\\c',
    'https:example.com/x',
    '  https://example.com/trim  ',
    'https://example.com/q?a=1&a=2&b=%zz&c=+plus+',
    "https://example.com/?quote='x'",
    'mailto:someone@example.com',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'ftp://files.example.com/pub',
    'https://[::1]:8443/x',
  ].forEach((u) => urls.add(u));
  return [...urls];
})();

test('URL polyfill matches Node across the corpus', () => {
  const ctx = jscLikeContext();
  vm.runInContext(readFileSync(join(here, 'jsc-polyfills.js'), 'utf8'), ctx);
  const P = ctx.URL;
  let compared = 0;
  for (const u of corpus) {
    let want = null;
    try { want = new URL(u); } catch { /* invalid in Node */ }
    let got = null;
    try { got = new P(u); } catch { /* invalid in polyfill */ }
    if (!want) { assert.equal(got, null, `should reject ${u}`); continue; }
    assert.ok(got, `should parse ${u}`);
    if (u.includes('[')) { assert.equal(got.protocol, want.protocol); continue; } // IPv6 compression isn't modelled
    for (const k of ['href', 'protocol', 'hostname', 'port', 'pathname', 'search', 'hash', 'origin']) assert.equal(got[k], want[k], `${k} of ${u}`);
    assert.equal(JSON.stringify([...got.searchParams.entries()]), JSON.stringify([...want.searchParams.entries()]), `params of ${u}`);
    // Mutations Keepsake makes: drop tracking params, clear the hash, set params.
    for (const key of [...want.searchParams.keys()]) if (key.startsWith('utm_') || key === 'igsh') { want.searchParams.delete(key); got.searchParams.delete(key); }
    want.hash = ''; got.hash = '';
    want.searchParams.set('api', '1 2'); got.searchParams.set('api', '1 2');
    assert.equal(got.href, want.href, `mutated ${u}`);
    compared++;
  }
  assert.ok(compared > 60, `compared ${compared} URLs`);
});

test('bundle loads without Web APIs and matches the ES modules', async () => {
  const ctx = jscLikeContext();
  vm.runInContext(bundle(), ctx);
  const core = ctx.KeepsakeCore;
  for (const m of ['util', 'url', 'kinds', 'places', 'goals', 'topics', 'search', 'categorizer', 'lookups', 'storage', 'db', 'taxonomy']) assert.ok(core[m], m);
  const url = await import(join(root, 'keepsake/src/shared/url.js'));
  const kinds = await import(join(root, 'keepsake/src/shared/kinds.js'));
  for (const u of corpus) {
    assert.equal(core.url.normalizeUrl(u), url.normalizeUrl(u), `normalizeUrl ${u}`);
    assert.equal(core.url.cleanUrl(u), url.cleanUrl(u), `cleanUrl ${u}`);
    assert.equal(JSON.stringify(core.kinds.kindOf({ url: u, title: 'x' })), JSON.stringify(kinds.kindOf({ url: u, title: 'x' })), `kindOf ${u}`);
  }
  // A whole store runs in the context: init, save, export, import.
  const out = await vm.runInContext(`(async () => {
    const S = KeepsakeCore.storage;
    const store = S.createStore(S.memoryBackend(), S.memoryRecordBackend());
    await store.init();
    const exp = await store.exportJSON();
    const store2 = S.createStore(S.memoryBackend(), S.memoryRecordBackend());
    await store2.init();
    await store2.importJSON(exp, { mode: 'replace' });
    return JSON.stringify({ a: Object.keys(exp.collections).length, b: (await store2.getCollections()).length });
  })()`, ctx);
  const { a, b } = JSON.parse(out);
  assert.ok(a >= 1, `collections ${a}`);
  assert.equal(a, b);
});

test('the bundled core in KeepsakeKit is up to date with keepsake/src/shared', () => {
  const shipped = readFileSync(join(root, 'ios/KeepsakeKit/Sources/KeepsakeKit/Resources/keepsake-core.js'), 'utf8');
  assert.equal(shipped, bundle(), 'run: node ios/tools/bundle-core.mjs');
});

test('the Share Extension page reader is up to date with keepsake/src/extract/extract.js', () => {
  assert.equal(readFileSync(shareExtractPath, 'utf8'), shareExtract(), 'run: node ios/tools/bundle-core.mjs');
});
