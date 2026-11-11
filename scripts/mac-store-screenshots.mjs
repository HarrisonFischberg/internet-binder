// Retakes the Mac App Store screenshots (2880 x 1800) in store/mac/screenshots/en-US: opens the real
// dashboard (keepsake/, the page the Mac Safari app shows) in headless Chromium with the demo library
// (ios/demo/store-demo.json), then frames each view with the captions from store/mac/screenshots.json.
//   NODE_PATH=<any node_modules with playwright> node scripts/mac-store-screenshots.mjs
// Playwright isn't a dependency here: it is found on NODE_PATH, as in tools/qa/place-shots.mjs.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const EXT = join(ROOT, 'keepsake');
const OUT = join(ROOT, 'store/mac/screenshots/en-US');
const { shots } = JSON.parse(readFileSync(join(ROOT, 'store/mac/screenshots.json'), 'utf8'));
const demo = JSON.parse(readFileSync(join(ROOT, 'ios/demo/store-demo.json'), 'utf8'));
const font = readFileSync(join(EXT, 'fonts/Nunito-400-900.woff2')).toString('base64');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const frame = (shot, png) => `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: B; font-weight: 400 900; src: url(data:font/woff2;base64,${font}); }
  body { margin: 0; width: 1440px; height: 900px; overflow: hidden; background: #070B13;
    background-image: radial-gradient(#141B28 3.5px, transparent 4px); background-size: 40px 40px;
    font-family: B, sans-serif; text-align: center; }
  h1 { margin: 0; padding-top: 44px; font-size: 70px; font-weight: 900; color: #F5F6FA; }
  h1 span { color: ${shot.color}; }
  p { margin: 14px 0 0; font-size: 29px; color: #B5BCCD; }
  .win { position: absolute; left: 146px; top: 230px; width: 1148px; border: 3px solid #2A3550; border-radius: 16px;
    background: #121A29; overflow: hidden; text-align: left; }
  .bar { height: 30px; display: flex; align-items: center; gap: 9px; padding-left: 18px; }
  .bar i { width: 9px; height: 9px; border-radius: 50%; }
  img { display: block; width: 1148px; border-top: 3px solid #2A3550; }
</style><h1>${esc(shot.headline)} <span>${esc(shot.accent)}</span></h1><p>${esc(shot.subtitle)}</p>
<div class="win"><div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i></div>
<img src="data:image/png;base64,${png}"></div>`;

const { chromium } = createRequire(import.meta.url)('playwright');
const profile = mkdtempSync(join(tmpdir(), 'binder-mac-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1366, height: 786 }, deviceScaleFactor: 2,
  args: [`--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, '--hide-scrollbars'],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/src`;
  const page = await context.newPage();
  await page.goto(`${base}/dashboard/dashboard.html#home`);
  await page.waitForTimeout(1500);
  await page.evaluate(async ([src, payload]) => {
    const m = await import(src);
    const s = m.createStore(m.chromeBackend(), m.idbBackend());
    await s.init();
    await s.importJSON(payload, { mode: 'replace' });
    await s.updateSettings({ style: 'nocturne', theme: 'dark' });
  }, [`${base}/shared/storage.js`, demo]);
  const framer = await context.newPage();
  await framer.setViewportSize({ width: 1440, height: 900 });
  for (const shot of shots) {
    await page.evaluate(async ([src, style]) => {
      const m = await import(src);
      await m.createStore(m.chromeBackend(), m.idbBackend()).updateSettings({ style });
    }, [`${base}/shared/storage.js`, shot.style || 'nocturne']);
    await page.goto(`${base}/dashboard/dashboard.html#${shot.view}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    if (shot.open) await page.getByText(shot.open, { exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.waitForFunction(() => [...document.images].every((i) => {
      const box = i.getBoundingClientRect(); // lazy pictures: only the ones on screen load
      return !box.width || box.top >= innerHeight || (i.complete && i.naturalWidth);
    }), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const png = (await page.screenshot()).toString('base64');
    await framer.setContent(frame(shot, png));
    await framer.evaluate(() => document.fonts.ready);
    await framer.screenshot({ path: join(OUT, `${shot.name}.png`), omitBackground: false });
    console.log(`${shot.name}.png`);
  }
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
