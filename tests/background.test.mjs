// The real background worker (keepsake/background.js) wired to a fake chrome.* (tests/helpers/fake-chrome.mjs).
// This exercises the message hub and save pipeline; it does not prove behaviour in real Chrome.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const F = fakeChrome();
globalThis.chrome = F.chrome;
await import('../keepsake/background.js');
const { MSG } = await import('../keepsake/src/shared/messages.js');
const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
// A second store over the same storage, like the popup or dashboard would have.
const S = createStore(chromeBackend(), idbBackend());
const items = async () => Object.fromEntries((await S.db.all('items')).map((i) => [i.id, i]));
const collections = async () => S.getCollections();

const popup = { url: F.chrome.runtime.getURL('src/popup/popup.html') };
const pageTab = { tab: { id: 7, url: 'https://shop.example/x' }, url: 'https://shop.example/x' };

async function install() {
  for (const k of Object.keys(F.local)) delete F.local[k];
  globalThis.fetch = async () => { throw new Error('no network in tests'); };
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('keepsake'); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  F.calls.tabsCreated.length = 0;
  for (const fn of F.listeners.installed) await fn({ reason: 'install' });
}
beforeEach(install);

const tent = { title: 'Two-person ultralight backpacking tent', url: 'https://shop.example/tent?utm_source=ig', price: '$329.00', images: [], image: '' };

test('install: starter data, context menu, welcome page', async () => {
  assert.equal(F.local.keepsake_meta.schemaVersion, 3);
  assert.equal((await collections()).length, 3);
  assert.equal(F.calls.contextMenus[0].title, 'Save to Keepsake');
  assert.ok(F.calls.tabsCreated.some((t) => t.url.endsWith('#welcome')));
});

test('save: a confident product is filed and its default collection is created on demand', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(res.ok, true);
  assert.equal(res.collection.name, 'Camping & Outdoors');
  assert.equal(res.item.price, 329);
  assert.equal(res.item.needsReview, false);
  assert.equal(res.item.categorizationSource, 'local');
});

test('save: the same page again is reported as a duplicate; force saves a copy', async () => {
  await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  const dup = await F.send({ type: MSG.SAVE_ITEM, product: { ...tent, url: 'https://shop.example/tent' } }, popup);
  assert.equal(dup.duplicate, true);
  const copy = await F.send({ type: MSG.SAVE_ITEM, product: tent, force: true }, popup);
  assert.equal(copy.ok, true);
  assert.equal(copy.duplicate, undefined);
  assert.equal(Object.keys(await items()).length, 2);
});

test('save: an unsure instant save waits in Review with the best guess suggested', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Linen thing', url: 'https://a.example/1' }, instant: true }, popup);
  assert.equal(res.item.collectionId, null);
  assert.equal(res.item.needsReview, true);
  assert.equal(res.classification.isInbox, true);
});

test('save: choosing a collection overrides the suggestion, is marked manual, and teaches', async () => {
  const home = (await collections()).find((c) => c.name === 'Home Decor');
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, collectionId: home.id, learn: 'strong' }, popup);
  assert.equal(res.item.collectionId, home.id);
  assert.equal(res.item.categorizationSource, 'manual');
  assert.ok(Object.values((await S.getPrefs()).learnedKeywords).some((e) => e[home.id] > 0));
});

test('undoing a save removes it outright (it does not go to the Trash)', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  await F.send({ type: MSG.UNDO_SAVE, itemId: res.item.id }, popup);
  assert.equal((await items())[res.item.id], undefined);
  assert.equal((await S.getTrash()).length, 0);
});

test('update: moving learns; only allowed fields can be patched', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent }, popup);
  const home = (await collections()).find((c) => c.name === 'Home Decor');
  const up = await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { collectionId: home.id, note: 'for the trip', url: 'https://evil.example', type: 'instagram' } }, pageTab);
  assert.equal(up.item.collectionId, home.id);
  assert.equal(up.item.note, 'for the trip');
  assert.equal(up.item.url, res.item.url, 'url cannot be changed from a page message');
  assert.equal(up.item.type, 'product');
  assert.ok(up.item.userFields.includes('note'));
  assert.ok(up.item.userFields.includes('collectionId'));
});

test('a suggestion chip can file into a default collection that does not exist yet', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Linen thing', url: 'https://a.example/1' }, instant: true }, popup);
  const up = await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { collectionId: 'new:kitchen' } }, pageTab);
  assert.equal(up.ok, true);
  const kitchen = (await collections()).find((c) => c.taxonomyKey === 'kitchen');
  assert.equal(up.item.collectionId, kitchen.id);
});

test('the capture card on the page loads the design tokens first and follows the chosen style', async () => {
  F.local.keepsake_settings = { ...F.local.keepsake_settings, style: 'minimal', theme: 'dark' };
  F.state.executeScript = async (opts) => (opts.files && opts.files[0] === 'src/extract/extract.js' ? [{ result: { ...tent } }] : [{ result: null }]);
  F.calls.executeScript.length = 0;
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: tent.url }, { id: 3, url: tent.url });
  const inject = F.calls.executeScript.find((c) => c.files && c.files.includes('src/content/toast.js'));
  assert.deepEqual(inject.files, ['src/content/tokens-content.js', 'src/content/toast.js']);
  const show = F.calls.executeScript.find((c) => c.args && c.args[0] && c.args[0].kind === 'saved');
  assert.deepEqual(show.args[0].look, { style: 'minimal', theme: 'dark' });
  assert.equal(show.args[0].title, tent.title);
  F.state.executeScript = async () => [{ result: null }];
});

const recipePage = {
  title: 'Brown butter pasta', url: 'https://cook.example/pasta', price: '$29.99', images: [], image: '',
  schemaTypes: ['webpage', 'recipe'],
  recipe: { recipeIngredient: ['200 g pasta', '50 g butter', 'sage'], recipeInstructions: ['Boil.', 'Brown the butter.', 'Toss.'], totalTime: 'PT25M', recipeYield: '2 servings' },
};

test('a recipe page is saved as a recipe, filed in Recipes, with no price', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: recipePage, instant: true }, popup);
  assert.equal(res.item.kind, 'recipe');
  assert.deepEqual(res.item.details.ingredients, ['200 g pasta', '50 g butter', 'sage']);
  assert.equal(res.item.details.totalMinutes, 25);
  assert.equal(res.item.price, null, 'a price on a recipe page is not the save’s price');
  assert.equal(res.collection.name, 'Recipes');
  assert.match(res.item.categorizationReason, /3 ingredients/);
});

test('a recipe matching one of your own collection keywords goes there instead', async () => {
  const weeknight = await S.createCollection({ name: 'Weeknight dinners', keywords: ['pasta'] });
  const res = await F.send({ type: MSG.SAVE_ITEM, product: recipePage, instant: true }, popup);
  assert.equal(res.item.collectionId, weeknight.collection.id);
});

test('with AI on, recipes are not sent for the product tidy', async () => {
  await aiOn();
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('no'); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: recipePage, instant: true }, popup);
  await finish();
  assert.equal(res.item.captureState, 'complete');
  assert.equal(called, false);
});

test('a workout page with an exercise list is saved as a workout, filed in Workouts', async () => {
  const page = {
    title: '20-minute full body workout', url: 'https://fit.example/full-body', description: 'A quick routine you can do at home.', images: [], image: '', price: null,
    schemaTypes: ['webpage', 'article'],
    workoutLines: ['Warm up for 5 minutes', '1. Squats 3x12', '2. Push-ups 3x10', 'Plank 3 x 45s', 'Rest 60s', 'Posted on 12 March 2026'],
  };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: page, instant: true }, popup);
  assert.equal(res.item.kind, 'workout');
  assert.deepEqual(res.item.details.exercises.map((e) => e.name), ['Squats', 'Push-ups', 'Plank']);
  assert.equal(res.item.details.exercises[2].restSeconds, 60);
  assert.equal(res.item.details.source, 'page');
  assert.equal(res.collection.name, 'Workouts');
  assert.match(res.item.categorizationReason, /3 exercises/);
});

test('workout gear with a price stays a product; a caption that lists exercises is a workout', async () => {
  const gear = { title: 'High-rise workout leggings', url: 'https://shop.example/leggings', price: '$68.00', images: [], image: '', schemaTypes: ['product'], workoutLines: ['Squats 3x12', 'Lunges 3x10'] };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: gear, instant: true }, popup)).item.kind, 'product');
  const post = { title: 'Instagram post', url: 'https://www.instagram.com/p/legday1/', isInstagram: true, images: [], image: '', price: null,
    description: 'Leg day 🔥\n3x12 squats\n3x10 lunges\n3x15 glute bridges' };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: post, instant: true }, popup);
  assert.equal(res.item.kind, 'workout');
  assert.equal(res.item.details.source, 'caption');
});

test('a restaurant page is saved as a place with its address and hours, filed in Places, with no price', async () => {
  const page = {
    title: 'Little Kitchen', url: 'https://eat.example/little-kitchen', price: '$25', images: [], image: '', schemaTypes: ['restaurant'],
    place: { '@type': 'Restaurant', address: { streetAddress: '12 Mill Lane', addressLocality: 'Bristol' }, geo: { latitude: 51.45, longitude: -2.59 }, servesCuisine: 'Georgian', openingHours: 'Tu-Sa 17:00-22:00' },
  };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: page, instant: true }, popup);
  assert.equal(res.item.kind, 'place');
  assert.equal(res.item.details.locality, 'Bristol');
  assert.deepEqual(res.item.details.hours, ['Tue–Sat 17:00–22:00']);
  assert.equal(res.item.price, null);
  assert.equal(res.collection.name, 'Places');
});

test('a Google Maps link is saved as a place named from the link', async () => {
  const page = { title: 'Google Maps', url: 'https://www.google.com/maps/place/Little+Kitchen/@51.4,-2.5,15z/data=!3d51.4551!4d-2.5911', images: [], image: '', price: null };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: page, instant: true }, popup);
  assert.equal(res.item.kind, 'place');
  assert.equal(res.item.title, 'Little Kitchen');
  assert.deepEqual([res.item.details.lat, res.item.details.lng, res.item.details.source], [51.4551, -2.5911, 'maps-link']);
});

test('videos and articles: a YouTube link is a video with its length; an og:type article gets a reading time', async () => {
  const yt = { title: 'How to sharpen a knife', url: 'https://www.youtube.com/watch?v=abc123', images: [], image: '', price: null, schemaTypes: [],
    media: { ogType: 'video.other', duration: 'PT12M3S', channel: 'Example Channel', published: '2026-09-30' } };
  const v = await F.send({ type: MSG.SAVE_ITEM, product: yt, instant: true }, popup);
  assert.equal(v.item.kind, 'video');
  assert.deepEqual([v.item.details.durationSeconds, v.item.details.channel, v.item.details.platform], [723, 'Example Channel', 'YouTube']);
  assert.equal(v.collection.name, 'Videos');
  const post = { title: 'Why bread goes stale', url: 'https://read.example/stale', images: [], image: '', price: null, priceText: '$4.99', siteName: 'Read Example', schemaTypes: [],
    media: { ogType: 'article', author: 'A. Writer', wordCount: 1150 } };
  const a = await F.send({ type: MSG.SAVE_ITEM, product: post, instant: true }, popup);
  assert.equal(a.item.kind, 'article', 'a price in the text does not make an article a product');
  assert.equal(a.item.details.readingMinutes, 5);
  assert.equal(a.item.details.siteName, 'Read Example');
  assert.equal(a.collection.name, 'Articles');
  assert.equal(a.item.price, null);
  const gym = { title: '15 min full body workout', url: 'https://www.youtube.com/watch?v=def456', images: [], image: '', price: null, schemaTypes: [],
    description: 'No equipment workout\n3x12 squats\n3x10 push-ups\n3x30s plank', media: { ogType: 'video.other' } };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: gym, instant: true }, popup)).item.kind, 'video', 'anything on YouTube is a video, workouts too');
  const channel = { title: 'Better Stack - YouTube', url: 'https://www.youtube.com/@BetterStack', images: [], image: '', price: null, schemaTypes: [] };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: channel, instant: true }, popup)).item.kind, 'video', 'a channel page too');
  const game = { title: 'I Put Black Ops 3 Zombies in GTA 5 With One Prompt', url: 'https://www.youtube.com/watch?v=zzz999', images: [], image: '', price: null, schemaTypes: [], media: { channel: 'Better Stack' } };
  const g = await F.send({ type: MSG.SAVE_ITEM, product: game, instant: true }, popup);
  assert.deepEqual([g.item.topics, g.item.topicsBy], [['Video games', 'AI'], 'guess'], 'tags guessed from the title');
});

test('films and books: a Movie page goes to Watchlist, a Book page to Reading list; a book for sale stays a product', async () => {
  const film = { title: 'A Film', url: 'https://films.example/title/1', images: [], image: '', price: null, schemaTypes: ['movie'],
    screen: { '@type': 'Movie', datePublished: '1999-03-31', director: { name: 'A. Director' }, duration: 'PT2H16M', genre: 'Sci-Fi' } };
  const f = await F.send({ type: MSG.SAVE_ITEM, product: film, instant: true }, popup);
  assert.deepEqual([f.item.kind, f.item.details.year, f.item.details.runtimeMinutes, f.collection.name], ['media', 1999, 136, 'Watchlist']);
  const titled = { title: 'Another Film (2019)', url: 'https://films.example/title/3', images: [], image: '', price: null, schemaTypes: [], screen: { '@type': 'Movie' } };
  const t = await F.send({ type: MSG.SAVE_ITEM, product: titled, instant: true }, popup);
  assert.deepEqual([t.item.title, t.item.details.year], ['Another Film', 2019], 'the year moves from the title to the details');
  const show = { title: 'A Show', url: 'https://films.example/title/2', images: [], image: '', price: null, schemaTypes: [], screen: { '@type': 'TVSeries', datePublished: '2019-01-01' } };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: show, instant: true }, popup)).item.details.format, 'series', 'og:type video.tv_show stand-in');
  const book = { title: 'A Book', url: 'https://books.example/book/1', images: [], image: '', price: null, schemaTypes: ['book'], book: { '@type': 'Book', author: { name: 'A. Author' }, numberOfPages: 300 } };
  const bk = await F.send({ type: MSG.SAVE_ITEM, product: book, instant: true }, popup);
  assert.deepEqual([bk.item.kind, bk.item.details.author, bk.collection.name], ['book', 'A. Author', 'Reading list']);
  const forSale = { title: 'A Book (Paperback)', url: 'https://shop.example/book', price: '$12.99', images: [], image: '', schemaTypes: ['product', 'book'] };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: forSale, instant: true }, popup)).item.kind, 'product');
});

test('a sparse page with nothing to sell is saved as a link; a shop page stays a product', async () => {
  const link = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Reading list', url: 'https://notes.example/x', sparse: true }, instant: true }, popup);
  assert.equal(link.item.kind, 'link');
  const prod = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(prod.item.kind, 'product');
});

test('privileged messages are refused from web-page contexts', async () => {
  const r = await F.send({ type: MSG.IG_START_SCAN, tabId: 7 }, pageTab);
  assert.equal(r.ok, false);
  assert.match(r.error, /Not allowed/);
  const r2 = await F.send({ type: MSG.IG_READ_POST, url: 'https://www.instagram.com/p/AbCdE1/' }, pageTab);
  assert.equal(r2.ok, false);
});

test('open dashboard only accepts plain hashes', async () => {
  F.calls.tabsCreated.length = 0;
  await F.send({ type: MSG.OPEN_DASHBOARD, hash: '#item/abc123' }, popup);
  await F.send({ type: MSG.OPEN_DASHBOARD, hash: '#x"><script>' }, popup);
  assert.ok(F.calls.tabsCreated[0].url.endsWith('dashboard.html#item/abc123'));
  assert.ok(F.calls.tabsCreated[1].url.endsWith('dashboard.html'));
});

test('context menu on a restricted page does nothing', async () => {
  F.calls.executeScript.length = 0;
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: 'chrome://settings' }, { id: 3, url: 'chrome://settings' });
  assert.equal(F.calls.executeScript.length, 0);
  assert.equal(Object.keys(await items()).length, 0);
});

test('context menu save: extracts the page, saves, shows a toast', async () => {
  F.state.executeScript = async (opts) => (opts.files && opts.files[0] === 'src/extract/extract.js' ? [{ result: { ...tent } }] : [{ result: null }]);
  for (const fn of F.listeners.menu) await fn({ menuItemId: 'keepsake-save', pageUrl: tent.url }, { id: 3, url: tent.url });
  assert.equal(Object.values(await items())[0].title, tent.title);
  assert.ok(F.calls.executeScript.some((c) => c.files && c.files.includes('src/content/toast.js')));
  F.state.executeScript = async () => [{ result: null }];
});

// --- Optional AI after the save (fixes audit A1, A2) ----------------------------------------------
async function aiOn() {
  const st = F.local.keepsake_settings;
  F.local.keepsake_settings = { ...st, ai: { ...st.ai, on: true, provider: 'anthropic', model: 'm' } };
  F.local.keepsake_secrets = { aiApiKey: 'sk-test' };
}
const aiReply = (obj, delay = 0) => async () => {
  await new Promise((r) => setTimeout(r, delay));
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) };
};
const finish = () => F.send({ type: MSG.ENRICH_PENDING }, popup);

test('with AI on, the save is stored before any network call and answers without waiting', async () => {
  await aiOn();
  let storedBeforeCall = null;
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async () => {
    storedBeforeCall = Object.keys(await items()).length;
    await gate;
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }] }) };
  };
  const t0 = performance.now();
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  const elapsed = performance.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(res.item.captureState, 'pending');
  assert.ok(elapsed < 1000, `save answered in ${elapsed.toFixed(0)} ms while the provider was still busy`);
  assert.equal((await items())[res.item.id].captureState, 'pending');
  release();
  await finish();
  assert.equal(storedBeforeCall, 1, 'the item existed before the provider was called');
  assert.equal((await items())[res.item.id].captureState, 'complete');
});

test('AI on, provider down: the save stays with the local result and is marked complete', async () => {
  await aiOn();
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  assert.equal(res.collection.name, 'Camping & Outdoors');
  await finish();
  const it = (await items())[res.item.id];
  assert.equal(it.captureState, 'complete');
  assert.equal(it.categorizationSource, 'local');
  assert.match(it.captureError, /AI tidy skipped: Failed to fetch/);
});

test('an AI-tidied title keeps the captured title and is logged with undo data (fixes A2)', async () => {
  await aiOn();
  const kitchen = await S.ensureCollectionForTaxonomy('kitchen');
  globalThis.fetch = aiReply({ items: [{ ref: 'new', title: 'Ultralight 2P tent', collection: kitchen.name, confidence: 0.9 }] });
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  await finish();
  const it = (await items())[res.item.id];
  assert.equal(it.title, 'Ultralight 2P tent');
  assert.equal(it.originalTitle, tent.title);
  assert.equal(it.collectionId, kitchen.id);
  assert.equal(it.categorizationSource, 'ai');
  const [entry] = await S.getAiLog();
  assert.equal(entry.itemId, it.id);
  assert.equal(entry.before.title, tent.title);
  assert.deepEqual(entry.changes.map((c) => c.field).sort(), ['collection', 'title']);
});

test('a title edited or a collection chosen while AI was working is never overwritten', async () => {
  await aiOn();
  const kitchen = await S.ensureCollectionForTaxonomy('kitchen');
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async () => { await gate; return aiReply({ items: [{ ref: 'new', title: 'AI title', collection: kitchen.name, confidence: 0.95 }] })(); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  const home = (await collections()).find((c) => c.name === 'Home Decor');
  await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { title: 'My own title', collectionId: home.id } }, popup);
  release();
  await finish();
  const it = (await items())[res.item.id];
  assert.equal(it.title, 'My own title');
  assert.equal(it.collectionId, home.id);
  assert.equal(it.captureState, 'complete');
  assert.equal((await S.getAiLog()).length, 0);
});

test('a save left pending (worker stopped) is finished on the next pickup', async () => {
  await aiOn();
  const it = await S.addItem({ title: 'cast iron pan', url: 'https://a.example/pan', captureState: 'pending' });
  globalThis.fetch = aiReply({ items: [{ ref: 'new', title: 'Cast-iron skillet', collection: null, confidence: 0 }] });
  await finish();
  const got = (await items())[it.id];
  assert.equal(got.captureState, 'complete');
  assert.equal(got.title, 'Cast-iron skillet');
});

test('with AI off, saves are complete straight away and nothing is sent', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not be called'); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: tent, instant: true }, popup);
  await finish();
  assert.equal(res.item.captureState, 'complete');
  assert.equal(called, false);
});
