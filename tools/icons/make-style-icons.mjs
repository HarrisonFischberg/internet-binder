// Renders the style icons from style-icons.mjs to PNG.
//   tools/icons/styles/<id>/{light,dark,tinted}-1024.png   full-bleed squares for iOS and Mac (the OS rounds them)
//   keepsake/icons/styles/<id>/icon<N>.png, .../dark/icon<N>.png   rounded toolbar icons for Chrome and Safari
//   tools/icons/styles/manifest.json
//   and for the app's own icon (pantry, the Patchwork art) the Xcode assets that use it: the iOS AppIcon and
//   its Appearance preview, and the Safari for Mac app icon plus its Icon-pantry picker tile.
// Run from the repo root: node tools/icons/make-style-icons.mjs [id ...]   (no ids: every style)
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

// A macOS app icon on Apple's grid: an 824/1024 rounded body with a soft drop shadow.
async function renderMac(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const u = size / 1024;
  await page.setContent(`<html><body style="margin:0;background:transparent;position:relative"><div style="position:absolute;left:${100 * u}px;top:${90 * u}px;width:${824 * u}px;height:${824 * u}px;border-radius:${185 * u}px;overflow:hidden;box-shadow:0 ${10 * u}px ${20 * u}px rgba(0,0,0,.28)"><img src="${uri}" style="width:100%;height:100%;display:block"></div></body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

// The app's own icon goes everywhere the bundle uses its icon.
async function writeAppAssets(out) {
  const ios = path.join(ROOT, 'ios/App/Assets.xcassets');
  copy(path.join(out, 'light-1024.png'), path.join(ios, 'AppIcon.appiconset/icon-1024.png'));
  copy(path.join(out, 'dark-1024.png'), path.join(ios, 'AppIcon.appiconset/icon-1024-dark.png'));
  copy(path.join(out, 'tinted-1024.png'), path.join(ios, 'AppIcon.appiconset/icon-1024-tinted.png'));
  copy(path.join(out, 'light-1024.png'), path.join(ios, 'AppIconPreview.imageset/preview.png'));
  copy(path.join(out, 'dark-1024.png'), path.join(ios, 'AppIconPreview.imageset/preview-dark.png'));
  const mac = path.join(ROOT, 'safari/Keepsake/Keepsake/Assets.xcassets');
  // Finder lists, Spotlight and the menu bar show 64 px and under: those get the straight, bolder toolbar art.
  const macSVG = (px) => iconSVG('pantry', false, { small: px <= 64 });
  for (const s of [16, 32, 128, 256, 512]) {
    await renderMac(macSVG(s), s, path.join(mac, `AppIcon.appiconset/mac-icon-${s}@1x.png`));
    await renderMac(macSVG(s * 2), s * 2, path.join(mac, `AppIcon.appiconset/mac-icon-${s}@2x.png`));
  }
  await renderMac(iconSVG('pantry', false), 512, path.join(mac, 'Icon-pantry.imageset/icon.png'));
  await renderMac(iconSVG('pantry', true), 512, path.join(mac, 'Icon-pantry.imageset/icon-dark.png'));
}

const only = process.argv.slice(2);
const manifest = { default: 'pantry', icons: [] };
for (const id of STYLE_ICONS) {
  manifest.icons.push({ id, label: ICON_LABELS[id] });
  if (only.length && !only.includes(id)) continue;
  const out = path.join(ROOT, 'tools/icons/styles', id);
  await render(iconSVG(id, false), 1024, path.join(out, 'light-1024.png'));
  await render(iconSVG(id, true), 1024, path.join(out, 'dark-1024.png'));
  // Tinted home screens want a grayscale icon; the system adds the tint.
  await render(iconSVG(id, true, { noShadow: true }), 1024, path.join(out, 'tinted-1024.png'), 'grayscale(1) contrast(1.15)');
  for (const size of [16, 32, 48, 128]) {
    const dir = path.join(ROOT, 'keepsake/icons/styles', id);
    const small = size <= 48;
    await render(iconSVG(id, false, { rounded: true, small }), size, path.join(dir, `icon${size}.png`));
    await render(iconSVG(id, true, { rounded: true, small }), size, path.join(dir, 'dark', `icon${size}.png`));
  }
  if (id === 'pantry') await writeAppAssets(out);
}
fs.writeFileSync(path.join(ROOT, 'tools/icons/styles/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await browser.close();
console.log('rendered', (only.length ? only : STYLE_ICONS).join(', '));
