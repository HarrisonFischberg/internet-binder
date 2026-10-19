// Renders the style icons from style-icons.mjs to PNG.
//   tools/icons/styles/<id>/{light,dark,tinted}-1024.png   full-bleed squares for iOS and Mac (the OS rounds them)
//   keepsake/icons/styles/<id>/icon<N>.png, .../dark/icon<N>.png   rounded toolbar icons for Chrome and Safari
//   tools/icons/styles/manifest.json
// Run from the repo root: node tools/icons/make-style-icons.mjs
// Needs Playwright with Chromium (set PLAYWRIGHT_MODULE to its index.mjs if it is not resolvable).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_ICONS, ICON_LABELS, iconSVG } from './style-icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, size, file, filter = '') {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace('width="1024" height="1024">', `width="${size}" height="${size}">`);
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="filter:${filter};width:${size}px;height:${size}px">${sized}</div></body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const manifest = { default: 'pocket', icons: [{ id: 'pocket', label: ICON_LABELS.pocket }] };
for (const id of STYLE_ICONS) {
  const out = path.join(ROOT, 'tools/icons/styles', id);
  await render(iconSVG(id, false), 1024, path.join(out, 'light-1024.png'));
  await render(iconSVG(id, true), 1024, path.join(out, 'dark-1024.png'));
  // Tinted home screens want a grayscale icon; the system adds the tint.
  await render(iconSVG(id, true), 1024, path.join(out, 'tinted-1024.png'), 'grayscale(1) contrast(1.15)');
  for (const size of [16, 32, 48, 128]) {
    const dir = path.join(ROOT, 'keepsake/icons/styles', id);
    await render(iconSVG(id, false, { rounded: true }), size, path.join(dir, `icon${size}.png`));
    await render(iconSVG(id, true, { rounded: true }), size, path.join(dir, 'dark', `icon${size}.png`));
  }
  manifest.icons.push({ id, label: ICON_LABELS[id] });
}
fs.writeFileSync(path.join(ROOT, 'tools/icons/styles/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await browser.close();
console.log('rendered', STYLE_ICONS.join(', '));
