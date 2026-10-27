// The design tokens the extension ships: in sync with replica/design, and readable (WCAG AA) in every
// appearance. Contrast is computed here with the WCAG 2 formula; no browser involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const DESIGN = '../replica/design/';
const files = readdirSync(new URL(`${DESIGN}tokens/`, import.meta.url)).filter((f) => f.endsWith('.json'));

test('three token sets from the brand kit: nocturne, paper and chromatic, with identical roles', () => {
  assert.deepEqual(files.sort(), ['chromatic.json', 'nocturne.json', 'paper.json']);
  const roles = files.map((f) => Object.keys(JSON.parse(read(`${DESIGN}tokens/${f}`)).color).sort().join(','));
  assert.equal(new Set(roles).size, 1, 'every style defines the same colour roles');
});

test('the extension ships the generated tokens unchanged (run replica/design/build_tokens.py after editing tokens)', () => {
  assert.equal(read('../keepsake/src/shared/tokens.css'), read(`${DESIGN}tokens.css`));
  const js = read('../keepsake/src/content/tokens-content.js');
  const g = {};
  new Function('globalThis', js)(g);
  assert.match(g.__keepsakeTokenCss, /:host\(\[data-style="chromatic"\]\)/);
  assert.doesNotMatch(g.__keepsakeTokenCss, /data-theme/);
  assert.doesNotMatch(g.__keepsakeTokenCss, /:root/);
});

test('extension pages load tokens.css before base.css', () => {
  for (const page of ['../keepsake/src/popup/popup.html', '../keepsake/src/dashboard/dashboard.html']) {
    const html = read(page);
    assert.ok(html.indexOf('tokens.css') > 0 && html.indexOf('tokens.css') < html.indexOf('base.css'), page);
  }
});

const lum = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

for (const f of files) {
  test(`WCAG AA contrast: ${f}`, () => {
    const t = JSON.parse(read(`${DESIGN}tokens/${f}`));
    assert.ok(t.pairs.length >= 40);
    for (const [fg, bg, kind] of t.pairs) {
      const need = kind === 'ui' || kind === 'large' ? 3 : 4.5;
      const r = ratio(t.color[fg], t.color[bg]);
      assert.ok(r >= need, `${f}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${need}:1`);
    }
  });
}
