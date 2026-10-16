// The Safari copy (safari/build.mjs → safari/dist) is the Chrome extension, file for file: only the
// background script (bundled, Safari runs no module service workers) and two manifest keys differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { build, safariManifest, SKIPPED } from '../safari/build.mjs';

const root = new URL('..', import.meta.url).pathname;
const chrome = join(root, 'keepsake');
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, f)).isFile()).map(String).sort();

const out = mkdtempSync(join(tmpdir(), 'keepsake-safari-'));
build(out);
test.after(() => rmSync(out, { recursive: true }));

test('safari: every Chrome file ships unchanged, except background.js and manifest.json', () => {
  const want = files(chrome).filter((f) => !SKIPPED.test(f));
  assert.deepEqual(files(out), want);
  for (const f of want) {
    if (f === 'background.js' || f === 'manifest.json') continue;
    assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(chrome, f))), `${f} differs`);
  }
});

test('safari: manifest is Chrome\'s without the Chrome-only keys', () => {
  const source = JSON.parse(readFileSync(join(chrome, 'manifest.json'), 'utf8'));
  const safari = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(safari, safariManifest(source));
  assert.equal(safari.version, source.version);
  assert.equal(safari.background.service_worker, 'background.js');
  assert.equal(safari.background.type, undefined);
});

test('safari: the bundled background is a classic script that starts and listens', () => {
  const code = readFileSync(join(out, 'background.js'), 'utf8');
  assert.doesNotMatch(code, /^\s*(import|export)\b/m);
  const listened = new Set();
  const api = (path) => new Proxy(function () {}, {
    get: (_, k) => (k === 'then' ? undefined : k === 'addListener' ? () => listened.add(path) : api(`${path}.${String(k)}`)),
    apply: () => api(path),
  });
  const ctx = { chrome: api('chrome'), console, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone, fetch: () => Promise.reject(new Error('offline')), indexedDB: api('indexedDB'), self: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(code, ctx);
  for (const e of ['chrome.runtime.onInstalled', 'chrome.runtime.onStartup', 'chrome.runtime.onMessage', 'chrome.contextMenus.onClicked']) assert.ok(listened.has(e), `${e} not registered`);
});

test('safari: the Mac app ships every top-level Chrome file, at Chrome\'s version', () => {
  const pbx = readFileSync(join(root, 'safari', 'Keepsake', 'Keepsake.xcodeproj', 'project.pbxproj'), 'utf8');
  const top = [...new Set(files(chrome).filter((f) => !SKIPPED.test(f)).map((f) => f.split('/')[0]))];
  for (const name of top) assert.ok(pbx.includes(`/* ${name} in Resources */`), `${name} is not in the extension's Resources`);
  const { version } = JSON.parse(readFileSync(join(chrome, 'manifest.json'), 'utf8'));
  const versions = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(versions.length > 0);
  assert.deepEqual([...new Set(versions)], [version]);
});
