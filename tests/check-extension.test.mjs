// Static checks on the shipped extension folder (keepsake/). No browser involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'keepsake');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const js = files.filter((f) => f.endsWith('.js'));
const html = files.filter((f) => f.endsWith('.html'));

test('manifest is MV3 with a semver version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.background.type, 'module');
});

test('every file the manifest references exists', () => {
  const refs = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
  for (const r of refs) assert.ok(existsSync(join(ROOT, r)), `missing ${r}`);
});

test('permissions stay least-privilege (changes here need a privacy review)', () => {
  // unlimitedStorage (1.4): saves live in IndexedDB without the 10 MB chrome.storage.local cap.
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage', 'unlimitedStorage']);
  assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
  assert.equal(manifest.host_permissions, undefined);
  for (const forbidden of ['tabs', 'history', 'cookies', 'webRequest', 'identity', 'alarms']) {
    assert.ok(!manifest.permissions.includes(forbidden), `unexpected permission ${forbidden}`);
  }
});

test('extension pages CSP forbids remote and inline script', () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test('every JS file parses', () => {
  for (const f of js) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${relative(ROOT, f)}: ${r.stderr}`);
  }
});

test('no HTML-string or eval APIs (one reviewed constant SVG allowed)', () => {
  const allowed = new Set([
    'src/dashboard/dashboard.js:insertAdjacentHTML',
    // MapLibre GL 4.7.1 (vendored CSP build, BSD-3): innerHTML for its attribution line (the map style's
    // "© OpenStreetMap" credit), the scale control and Popup.setHTML. Keepsake uses neither of the last two
    // (popups use setDOMContent), and the extension CSP (script-src 'self', no inline) stops any script in
    // that markup from running. Reviewed 2026-10-13; no eval or new Function in this build.
    'vendor/maplibre/maplibre-gl-csp.js:innerHTML',
  ]);
  for (const f of js) {
    const src = readFileSync(f, 'utf8');
    for (const api of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'new Function']) {
      const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      if (code.includes(api)) assert.ok(allowed.has(`${relative(ROOT, f)}:${api}`), `${relative(ROOT, f)} uses ${api}`);
    }
    assert.doesNotMatch(src, /\beval\(/, `${relative(ROOT, f)} uses eval`);
  }
});

test('HTML pages load only local scripts and have no inline scripts or styles', () => {
  for (const f of html) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(m[1], /\bsrc="(?!https?:|\/\/)[^"]+"/, `${relative(ROOT, f)} has an inline or remote script`);
      assert.equal(m[2].trim(), '', `${relative(ROOT, f)} has inline script content`);
    }
    assert.doesNotMatch(src, /<style\b|\sstyle="/, `${relative(ROOT, f)} has inline styles`);
    assert.doesNotMatch(src, /<link[^>]+href="https?:/, `${relative(ROOT, f)} loads a remote stylesheet`);
  }
});

test('the release package excludes dev tooling (tests and package.json live outside keepsake/)', () => {
  assert.ok(!existsSync(join(ROOT, 'package.json')));
  assert.ok(!existsSync(join(ROOT, 'tests')));
  assert.ok(!existsSync(join(ROOT, 'node_modules')));
});
