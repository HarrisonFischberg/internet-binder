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

test('a recipe page is saved as a recipe in its own view (no collection, not Review), with no price', async () => {
  const res = await F.send({ type: MSG.SAVE_ITEM, product: recipePage, instant: true }, popup);
  assert.equal(res.item.kind, 'recipe');
  assert.deepEqual(res.item.details.ingredients, ['200 g pasta', '50 g butter', 'sage']);
  assert.equal(res.item.details.totalMinutes, 25);
  assert.equal(res.item.price, null, 'a price on a recipe page is not the save’s price');
  assert.deepEqual([res.collection, res.item.collectionId, res.item.needsReview], [null, null, false], 'in its own view: no collection, not in Review');
  assert.match(res.item.categorizationReason, /3 ingredients/);
});

test('collections are for shopping: a recipe matching a collection keyword still stays out of it', async () => {
  await S.createCollection({ name: 'Weeknight dinners', keywords: ['pasta'] });
  const res = await F.send({ type: MSG.SAVE_ITEM, product: recipePage, instant: true }, popup);
  assert.deepEqual([res.item.collectionId, res.item.needsReview], [null, false]);
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

test('a workout page with an exercise list is saved as a workout in its own view', async () => {
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
  assert.deepEqual([res.collection, res.item.collectionId, res.item.needsReview], [null, null, false], 'in its own view: no collection, not in Review');
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

test('a restaurant page is saved as a place with its address and hours, with no price', async () => {
  const page = {
    title: 'Little Kitchen', url: 'https://eat.example/little-kitchen', price: '$25', images: [], image: '', schemaTypes: ['restaurant'],
    place: { '@type': 'Restaurant', address: { streetAddress: '12 Mill Lane', addressLocality: 'Bristol' }, geo: { latitude: 51.45, longitude: -2.59 }, servesCuisine: 'Georgian', openingHours: 'Tu-Sa 17:00-22:00' },
  };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: page, instant: true }, popup);
  assert.equal(res.item.kind, 'place');
  assert.equal(res.item.details.locality, 'Bristol');
  assert.deepEqual(res.item.details.hours, ['Tue–Sat 17:00–22:00']);
  assert.equal(res.item.price, null);
  assert.deepEqual([res.collection, res.item.collectionId, res.item.needsReview], [null, null, false], 'in its own view: no collection, not in Review');
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
  assert.deepEqual([v.collection, v.item.collectionId, v.item.needsReview], [null, null, false], 'in its own view: no collection, not in Review');
  const post = { title: 'Why bread goes stale', url: 'https://read.example/stale', images: [], image: '', price: null, priceText: '$4.99', siteName: 'Read Example', schemaTypes: [],
    media: { ogType: 'article', author: 'A. Writer', wordCount: 1150 } };
  const a = await F.send({ type: MSG.SAVE_ITEM, product: post, instant: true }, popup);
  assert.equal(a.item.kind, 'article', 'a price in the text does not make an article a product');
  assert.equal(a.item.details.readingMinutes, 5);
  assert.equal(a.item.details.siteName, 'Read Example');
  assert.deepEqual([a.collection, a.item.collectionId, a.item.needsReview], [null, null, false], 'in its own view: no collection, not in Review');
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

test('films and books: a Movie page and a Book page are saved to their views; a book for sale stays a product', async () => {
  const film = { title: 'A Film', url: 'https://films.example/title/1', images: [], image: '', price: null, schemaTypes: ['movie'],
    screen: { '@type': 'Movie', datePublished: '1999-03-31', director: { name: 'A. Director' }, duration: 'PT2H16M', genre: 'Sci-Fi' } };
  const f = await F.send({ type: MSG.SAVE_ITEM, product: film, instant: true }, popup);
  assert.deepEqual([f.item.kind, f.item.details.year, f.item.details.runtimeMinutes, f.collection, f.item.needsReview], ['media', 1999, 136, null, false]);
  const titled = { title: 'Another Film (2019)', url: 'https://films.example/title/3', images: [], image: '', price: null, schemaTypes: [], screen: { '@type': 'Movie' } };
  const t = await F.send({ type: MSG.SAVE_ITEM, product: titled, instant: true }, popup);
  assert.deepEqual([t.item.title, t.item.details.year], ['Another Film', 2019], 'the year moves from the title to the details');
  const show = { title: 'A Show', url: 'https://films.example/title/2', images: [], image: '', price: null, schemaTypes: [], screen: { '@type': 'TVSeries', datePublished: '2019-01-01' } };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: show, instant: true }, popup)).item.details.format, 'series', 'og:type video.tv_show stand-in');
  const book = { title: 'A Book', url: 'https://books.example/book/1', images: [], image: '', price: null, schemaTypes: ['book'], book: { '@type': 'Book', author: { name: 'A. Author' }, numberOfPages: 300 } };
  const bk = await F.send({ type: MSG.SAVE_ITEM, product: book, instant: true }, popup);
  assert.deepEqual([bk.item.kind, bk.item.details.author, bk.collection, bk.item.needsReview], ['book', 'A. Author', null, false]);
  const forSale = { title: 'A Book (Paperback)', url: 'https://shop.example/book', price: '$12.99', images: [], image: '', schemaTypes: ['product', 'book'] };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: forSale, instant: true }, popup)).item.kind, 'product');
});

test('the popup’s “where would this go?” knows kinds: a YouTube video is saved to Videos (its view), not Review (popup without AI)', async () => {
  // What the popup does without AI: ask first, then save with that answer.
  const page = { title: 'Polygraph test debate', url: 'https://www.youtube.com/watch?v=u751e3_PZq8', images: [], image: '', price: null, schemaTypes: [],
    description: 'Seven guests, one chair, one machine.', media: { ogType: 'video.other', channel: 'Example Talk' } };
  const cls = await F.send({ type: MSG.CLASSIFY, product: page }, popup);
  assert.equal(cls.classification.collectionName, 'Videos');
  assert.equal(cls.classification.isInbox, false);
  assert.ok(cls.classification.confidence >= 0.75, 'sure enough for the popup to save straight away');
  const res = await F.send({ type: MSG.SAVE_ITEM, product: page, classification: cls.classification }, popup);
  assert.deepEqual([res.item.kind, res.collection, res.item.needsReview, res.item.retailer], ['video', null, false, 'YouTube']);
  // Same for a recipe page.
  const rc = await F.send({ type: MSG.CLASSIFY, product: { title: 'Soup', url: 'https://cook.example/soup-cls', images: [], image: '', schemaTypes: ['recipe'], recipe: { recipeIngredient: ['a', 'b'] } } }, popup);
  assert.equal(rc.classification.collectionName, 'Recipes');
});

test('a film or book site title page is saved as a film/show or book even with no data on the page', async () => {
  const rt = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'Severance', url: 'https://www.rottentomatoes.com/tv/severance', images: [], image: '', price: null, schemaTypes: [] }, instant: true }, popup);
  assert.deepEqual([rt.item.kind, rt.item.details.format], ['media', 'series']);
  const gr = await F.send({ type: MSG.SAVE_ITEM, product: { title: 'A Wizard of Earthsea', url: 'https://www.goodreads.com/book/show/13642.A_Wizard_of_Earthsea', images: [], image: '', price: '$9.99', schemaTypes: [] }, instant: true }, popup);
  assert.deepEqual([gr.item.kind, gr.item.price], ['book', null], 'a price on Goodreads is a shop link, not the save’s price');
});

test('fill-in: a place saved with lookups on gets its address and pin; with lookups off nothing is sent', async () => {
  const post = { title: 'nyceats on Instagram: "Glazed heaven"', url: 'https://www.instagram.com/reel/fill1/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [],
    description: 'Glazed heaven 🍩\n📍 Peter Pan Donut & Pastry Shop, Greenpoint' };
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => [{ name: 'Peter Pan Donut & Pastry Shop', lat: '40.726', lon: '-73.952', type: 'bakery', address: { house_number: '727', road: 'Manhattan Avenue', suburb: 'Greenpoint', city: 'New York' } }] }; };
  let res = await F.send({ type: MSG.SAVE_ITEM, product: post, instant: true }, popup);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.length, 0, 'lookups off: nothing sent');
  assert.deepEqual([res.item.kind, res.item.title], ['place', 'Peter Pan Donut & Pastry Shop']);

  F.local.keepsake_settings = { ...F.local.keepsake_settings, lookups: { places: true, media: false, books: false } };
  F.state.granted.push('https://nominatim.openstreetmap.org/*', 'https://tiles.openfreemap.org/*');
  await F.send({ type: MSG.FILL_ITEM, itemId: res.item.id }, popup);
  for (let i = 0; i < 60 && !(await S.getItem(res.item.id)).details.lat; i++) await new Promise((r) => setTimeout(r, 50));
  const filled = await S.getItem(res.item.id);
  assert.ok(calls.some((u) => u.startsWith('https://nominatim.openstreetmap.org/search')));
  assert.deepEqual([filled.details.address, filled.details.locality, filled.details.lat, filled.details.lookup.source], ['727 Manhattan Avenue', 'Greenpoint', 40.726, 'OpenStreetMap']);
});

test('with AI on: a post your provider recognises as a place becomes one, named, logged with Undo', async () => {
  await aiOn();
  globalThis.fetch = aiReply({ kind: 'place', confidence: 0.9, title: 'Doughnut Plant', details: { locality: 'Lower East Side', region: 'NY', cuisine: 'Doughnuts' }, reason: 'A doughnut shop' });
  const post = { title: 'Instagram', url: 'https://www.instagram.com/reel/fill2/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [], description: 'best donut in nyc, the tres leches one 😍' };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: post, instant: true }, popup);
  for (let i = 0; i < 60 && (await S.getItem(res.item.id)).title === 'Instagram'; i++) await new Promise((r) => setTimeout(r, 50));
  const it = await S.getItem(res.item.id);
  assert.deepEqual([it.kind, it.title, it.details.locality, it.details.region, it.details.cuisine, it.collectionId], ['place', 'Doughnut Plant', 'Lower East Side', 'NY', 'Doughnuts', null]);
  const entry = (await S.getAiLog()).find((e) => e.itemId === it.id);
  assert.ok(entry && entry.changes.some((c) => c.field === 'kind'));
  assert.equal(entry.before.kind, 'link', 'Undo puts it back as it was');
});

test('with AI on: a place you filed yourself is read for that kind, and a kind you chose is never changed', async () => {
  await aiOn();
  let asked = '';
  globalThis.fetch = async (url, opts) => { asked = String(opts?.body || ''); return aiReply({ kind: 'link', confidence: 0.4, title: 'Tres leches donut' })(); };
  const post = { title: 'Instagram', url: 'https://www.instagram.com/reel/fill3/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [], description: 'the tres leches one 😍' };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: post, instant: true }, popup);
  for (let i = 0; i < 60 && !(await S.getItem(res.item.id)).understoodAt; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await S.getItem(res.item.id)).kind, 'link', 'not sure: it stays a link');
  globalThis.fetch = async (url, opts) => { asked = String(opts?.body || ''); return aiReply({ kind: 'place', confidence: 0.6, title: 'Doughnut Plant', details: { locality: 'New York' } })(); };
  await F.send({ type: MSG.UPDATE_ITEM, itemId: res.item.id, patch: { kind: 'place' } }, popup);
  for (let i = 0; i < 60 && (await S.getItem(res.item.id)).title === 'Instagram'; i++) await new Promise((r) => setTimeout(r, 50));
  const it = await S.getItem(res.item.id);
  assert.deepEqual([it.kind, it.title, it.details.locality], ['place', 'Doughnut Plant', 'New York']);
  assert.match(asked, /filed this as a place/);
  // Your provider calling it something else later doesn't move it.
  globalThis.fetch = aiReply({ kind: 'recipe', confidence: 0.99, title: 'Tres leches', details: { ingredients: ['milk', 'sugar'] } });
  await F.send({ type: MSG.FILL_BATCH, itemIds: [it.id], force: true, understand: true }, popup);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await S.getItem(it.id)).kind, 'place');
});

test('one click on an Instagram reel: its own caption is read, so it saves as the place, with the address', async () => {
  const data = JSON.stringify({ items: [{ code: 'REEL55555', caption: { text: 'Best donuts in the city 🍩\n📍 Example Donuts\n186 Bleecker St, New York, NY' }, user: { username: 'nyceats' } }] });
  const product = { title: 'Instagram', url: 'https://www.instagram.com/reel/REEL55555/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [],
    igBundle: { meta: {}, scripts: [{ type: 'application/json', text: data }], visibleCaption: '' } };
  const res = await F.send({ type: MSG.SAVE_ITEM, product, instant: true }, popup);
  assert.deepEqual([res.item.kind, res.item.title, res.item.details.address, res.item.details.locality, res.item.details.region], ['place', 'Example Donuts', '186 Bleecker St', 'New York', 'NY']);
  assert.equal(res.item.instagram.creator, 'nyceats');
  assert.match(res.item.instagram.caption, /\n📍 Example Donuts\n/, 'line breaks kept');
});

test('a business’s own site with an address and hours is a place named after the site; an office address alone is not', async () => {
  const shop = { title: 'Home | Example Banh Mi', siteName: 'Example Banh Mi', url: 'https://banhmi.example/', images: [], image: '', price: null, schemaTypes: ['website'],
    pagePlace: { address: '560 Larkin St', locality: 'San Francisco', region: 'CA', postalCode: '94102', phone: '(415) 555-0123', hours: ['Mon–Tue: 7:00 AM – 5:30 PM'], visit: true } };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: shop, instant: true }, popup);
  assert.deepEqual([res.item.kind, res.item.title, res.item.details.address, res.item.details.locality, res.item.details.postalCode, res.item.details.phone],
    ['place', 'Example Banh Mi', '560 Larkin St', 'San Francisco', '94102', '(415) 555-0123']);
  // A restaurant site with its menu prices on the page is still a place.
  const menu = { ...shop, url: 'https://banhmi.example/menu', price: 6.5, priceText: '$6.50' };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: menu, instant: true }, popup)).item.kind, 'place');
  const office = { title: 'Example Software — Plans', siteName: 'Example Software', url: 'https://software.example/pricing', images: [], image: '', price: null, schemaTypes: ['website'],
    pagePlace: { address: '100 Main St', locality: 'Austin', region: 'TX', postalCode: '78701', phone: '', hours: [], visit: false } };
  assert.notEqual((await F.send({ type: MSG.SAVE_ITEM, product: office, instant: true }, popup)).item.kind, 'place');
});

test('smoke-test fixes: a review of one venue is the place (named from the title), a salon listing is a place, a Facebook page is a link', async () => {
  const review = { title: 'Example Ice Cream | Time Out Chicago', siteName: 'Time Out', url: 'https://reviews.example/chicago/restaurants/example-ice-cream', images: [], image: '', price: null,
    schemaTypes: ['review'], media: { ogType: 'article' }, pagePlace: { address: '608 W 31st St', locality: '', region: '', postalCode: '', phone: '', hours: ['Sun–Thu 11am–10pm'], visit: true } };
  const r = await F.send({ type: MSG.SAVE_ITEM, product: review, instant: true }, popup);
  assert.deepEqual([r.item.kind, r.item.title, r.item.details.address], ['place', 'Example Ice Cream', '608 W 31st St'], 'not "Time Out"');
  const salon = { title: "Example Barber Shop", url: 'https://book.example/lvp/example-barber', images: [], image: '', price: null, schemaTypes: ['healthandbeautybusiness', 'hairsalon', 'website', 'organization'] };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: salon, instant: true }, popup)).item.kind, 'place');
  const fb = { title: 'Example Bakery', url: 'https://www.facebook.com/examplebakery/', images: [], image: '', price: null, schemaTypes: [], media: { ogType: 'video.other' } };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: fb, instant: true }, popup)).item.kind, 'link');
  const fbVideo = { ...fb, url: 'https://www.facebook.com/examplebakery/videos/123/' };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: fbVideo, instant: true }, popup)).item.kind, 'video');
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

test('business profiles: an Instagram profile or Facebook page for a business is a place; a person’s is a link', async () => {
  const ig = { title: 'GO DONUTS (@godonuts_harlem) • Instagram photos and videos', url: 'https://www.instagram.com/godonuts_harlem/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [],
    profile: { platform: 'instagram', handle: 'godonuts_harlem', name: 'GO DONUTS', bio: 'The Best Mini Donuts In NYC 🍩\n2309 2nd avenue New York, NY 10035\nClosed on Sunday', header: '' } };
  const a = (await F.send({ type: MSG.SAVE_ITEM, product: ig, instant: true }, popup)).item;
  assert.deepEqual([a.kind, a.title, a.details.address, a.details.locality, a.details.region, a.details.postalCode], ['place', 'GO DONUTS', '2309 2nd avenue', 'New York', 'NY', '10035']);
  const fb = { title: "Mrs. Powell's Cinnamon Rolls Rexburg 19 E Main | Rexburg ID", url: 'https://www.facebook.com/examplerolls/', images: [], image: '', price: null, schemaTypes: [], media: { ogType: 'video.other' },
    profile: { platform: 'facebook', handle: 'examplerolls', name: "Mrs. Powell's Cinnamon Rolls Rexburg 19 E Main | Rexburg ID", about: '1,241 followers · 61 were here.', bio: '',
      intro: ['Page · Bakery · Restaurant · Dessert Shop', '19 East Main Street, Rexburg, ID, United States, Idaho', '(208) 419-0273', 'Closed now'] } };
  const b = (await F.send({ type: MSG.SAVE_ITEM, product: fb, instant: true }, popup)).item;
  assert.deepEqual([b.kind, b.title, b.details.address, b.details.locality, b.details.phone, b.details.category], ['place', "Mrs. Powell's Cinnamon Rolls", '19 East Main Street', 'Rexburg', '(208) 419-0273', 'Bakery']);
  const person = { title: 'Jane (@jane.eats) • Instagram photos and videos', url: 'https://www.instagram.com/jane.eats/', isInstagram: true, images: [], image: '', price: null, schemaTypes: [],
    profile: { platform: 'instagram', handle: 'jane.eats', name: 'Jane', bio: 'NYC food reviews 🍩 best donuts daily · DM for collabs', header: '' } };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: person, instant: true }, popup)).item.kind, 'link');
});

test('a business home page with no address: a place when it says what it is and where (a lookup finds the rest); a brand is not', async () => {
  const bakery = { title: 'Example Artisan', siteName: 'Example Artisan', url: 'https://artisan.example/', images: [], image: '', price: null, schemaTypes: ['website'],
    home: { name: 'Example Artisan', siteName: 'Example Artisan', title: 'Example Artisan', about: '<p>Example Artisan Bakery | Portland, Oregon</p>', phone: '', visitLink: false } };
  const a = (await F.send({ type: MSG.SAVE_ITEM, product: bakery, instant: true }, popup)).item;
  assert.deepEqual([a.kind, a.title, a.details.locality, a.details.region, a.details.address], ['place', 'Example Artisan', 'Portland', 'Oregon', '']);
  const scoops = { title: 'Craft Ice Cream | Example Scoops', url: 'https://scoops.example/', images: [], image: '', price: 15, priceText: '$15', schemaTypes: ['organization'],
    home: { name: 'Example Scoops', siteName: 'Example Scoops', title: 'Craft Ice Cream | Example Scoops', about: 'Small-batch ice cream. Shop pints online.', phone: '', visitLink: true } };
  const b = (await F.send({ type: MSG.SAVE_ITEM, product: scoops, instant: true }, popup)).item;
  assert.deepEqual([b.kind, b.title], ['place', 'Example Scoops'], 'pints for sale on the page don’t make it a product');
  const brand = { title: 'Example Shoes', url: 'https://shoes.example/', images: [], image: '', price: 98, priceText: '$98', schemaTypes: ['organization'],
    home: { name: 'Example Shoes', siteName: 'Example Shoes', title: 'Example Shoes', about: 'Comfortable shoes made from wool.', phone: '', visitLink: true } };
  assert.equal((await F.send({ type: MSG.SAVE_ITEM, product: brand, instant: true }, popup)).item.kind, 'product');
});

test('a venue listing’s labeled Address block with its city is a place, even with no phone or day names', async () => {
  const listing = { title: 'Example Shoppe Ice Cream | Restaurants in Forest Glen, Chicago', url: 'https://listings.example/chicago/example-shoppe', images: [], image: '', price: null, schemaTypes: ['review'], media: { ogType: 'article' },
    pagePlace: { address: '5337 W Devon Ave', locality: 'Chicago', region: '', postalCode: '60646', phone: '', hours: [], visit: true, labeled: true } };
  const r = (await F.send({ type: MSG.SAVE_ITEM, product: listing, instant: true }, popup)).item;
  assert.deepEqual([r.kind, r.details.address, r.details.locality], ['place', '5337 W Devon Ave', 'Chicago']);
});

test('fill-in with AI on: an imported Instagram place that says nothing about where it is gets a name and city', async () => {
  await aiOn();
  let asked = '';
  globalThis.fetch = async (url, opts) => { asked = String(opts?.body || ''); return aiReply({ kind: 'place', confidence: 0.9, title: 'Example Noodle Bar', details: { locality: 'East Village', address: '1 Invented Ave', phone: '212 555 0199' } })(); };
  const item = await S.addItem({ type: 'instagram', kind: 'place', title: 'Slurp-worthy noodles tonight', url: 'https://www.instagram.com/p/IMPFILL1/', details: { source: 'page' },
    instagram: { caption: 'Slurp-worthy noodles tonight 🍜', location: 'Example Noodle Bar' } });
  await F.send({ type: MSG.FILL_ITEM, itemId: item.id }, popup);
  for (let i = 0; i < 60 && (await S.getItem(item.id)).title !== 'Example Noodle Bar'; i++) await new Promise((r) => setTimeout(r, 50));
  const it = await S.getItem(item.id);
  assert.deepEqual([it.title, it.details.locality], ['Example Noodle Bar', 'East Village']);
  assert.deepEqual([it.details.address, it.details.phone], ['', ''], 'a street or phone the post never gave is not kept');
  assert.match(asked, /Location tag: Example Noodle Bar/, 'the location tag goes with the caption');
  // One that already has its street keeps it: the answer only fills gaps.
  const known = await S.addItem({ type: 'instagram', kind: 'place', title: 'Example Pizza', url: 'https://www.instagram.com/p/IMPFILL2/', details: { address: '7 Carmine St', locality: 'New York', source: 'page' }, instagram: { caption: 'pizza 7 Carmine St', location: 'Example Pizza' } });
  globalThis.fetch = aiReply({ kind: 'place', confidence: 0.9, title: 'Example Pizza', details: { address: '9 Other St', locality: 'Manhattan', cuisine: 'Pizza', region: 'NY' } });
  await F.send({ type: MSG.FILL_ITEM, itemId: known.id }, popup);
  for (let i = 0; i < 60 && !(await S.getItem(known.id)).understoodAt; i++) await new Promise((r) => setTimeout(r, 50));
  const k = await S.getItem(known.id);
  assert.deepEqual([k.details.address, k.details.locality, k.details.cuisine, k.details.region], ['7 Carmine St', 'New York', 'Pizza', 'NY']);
});

test('Places review: the caption is read again first; then your AI provider names the place and its state', async () => {
  // Read again (AI off): the address in the caption fills the place in, with nothing sent anywhere.
  const st = F.local.keepsake_settings;
  F.local.keepsake_settings = { ...st, ai: { ...st.ai, on: false } };
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no network'); };
  const a = await S.addItem({ type: 'instagram', kind: 'place', title: 'Our famous stuffed rolls', url: 'https://www.instagram.com/p/REVIEW1/', details: { source: 'page' },
    instagram: { caption: 'Our famous stuffed rolls 16051 dessau rd suite f Pflugerville, TX,78660 📍' } });
  await F.send({ type: MSG.FILL_ITEM, itemId: a.id, review: true }, popup);
  for (let i = 0; i < 40 && !(await S.getItem(a.id)).details.address; i++) await new Promise((r) => setTimeout(r, 25));
  const ra = await S.getItem(a.id);
  assert.deepEqual([ra.details.address, ra.details.locality, ra.details.region, ra.details.postalCode], ['16051 dessau rd suite f', 'Pflugerville', 'TX', '78660']);
  assert.equal(calls, 0, 'nothing sent');
  // Fix with AI: a titled post that names no place gets the place, its city and its state.
  await aiOn();
  globalThis.fetch = aiReply({ name: 'Example Tavern', address: '54 Pearl St', city: 'New York', state: 'New York' });
  const b = await S.addItem({ type: 'instagram', kind: 'place', title: 'Tucked into Manhattan is a place', url: 'https://www.instagram.com/p/REVIEW2/', details: { source: 'page' },
    instagram: { caption: 'Tucked into Manhattan is a place that feels like another era. Example Tavern is more than a historic spot.' } });
  await F.send({ type: MSG.FILL_ITEM, itemId: b.id, review: true }, popup);
  for (let i = 0; i < 60 && (await S.getItem(b.id)).title !== 'Example Tavern'; i++) await new Promise((r) => setTimeout(r, 50));
  const rb = await S.getItem(b.id);
  assert.deepEqual([rb.title, rb.details.address, rb.details.locality, rb.details.region], ['Example Tavern', '54 Pearl St', 'New York', 'NY']);
});

test('a fill-in batch runs one save at a time, keeps its progress in session storage, counts places that leave review, and stops', async () => {
  const st = F.local.keepsake_settings;
  F.local.keepsake_settings = { ...st, ai: { ...st.ai, on: false } };
  globalThis.fetch = async () => { throw new Error('no network'); };
  const mk = (n, caption) => S.addItem({ type: 'instagram', kind: 'place', title: caption.split(' 📍')[0], url: `https://www.instagram.com/p/BATCH${n}/`, details: { source: 'page' }, instagram: { caption } });
  const a = await mk(1, 'Best slice 📍Example Pizza, 7 Carmine St, New York, NY');
  const b = await mk(2, 'Just vibes');
  const res = await F.send({ type: MSG.FILL_BATCH, itemIds: [a.id, b.id], review: true, label: 'Reading posts again', kind: 'place' }, popup);
  assert.equal(res.ok, true);
  assert.deepEqual([res.job.total, res.job.running], [2, true]);
  const busy = await F.send({ type: MSG.FILL_BATCH, itemIds: [a.id] }, popup);
  assert.equal(busy.ok, false, 'one batch at a time');
  for (let i = 0; i < 80 && F.session.keepsake_fillJob?.running; i++) await new Promise((r) => setTimeout(r, 25));
  const job = F.session.keepsake_fillJob;
  assert.deepEqual([job.done, job.total, job.running, job.ready, job.changed], [2, 2, false, 1, 1], 'Example Pizza left review; the other found nothing');
  assert.equal((await S.getItem(a.id)).title, 'Example Pizza');
  // Stop: the batch ends after the save it's on.
  const ids = [];
  for (let n = 3; n < 13; n++) ids.push((await mk(n, `Post ${n}`)).id);
  await F.send({ type: MSG.FILL_BATCH, itemIds: ids, review: true }, popup);
  await F.send({ type: MSG.FILL_STOP }, popup);
  for (let i = 0; i < 80 && F.session.keepsake_fillJob?.running; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(F.session.keepsake_fillJob.stopped, true);
  assert.ok(F.session.keepsake_fillJob.done < ids.length, 'stopped early');
});

test('a fill-in batch can’t be started from a web page', async () => {
  const r = await F.send({ type: MSG.FILL_BATCH, itemIds: ['x'] }, pageTab);
  assert.match(r.error, /Not allowed/);
});

test('Check with AI on the Places list: a place missing its city or state gets them; its name and street stay; a complete place isn’t sent', async () => {
  await aiOn();
  let asked = 0;
  globalThis.fetch = async (url, opts) => { asked++; return aiReply({ name: 'Some Other Name', address: '999 Wrong St', city: 'New York', state: 'NY' })(); };
  const partial = await S.addItem({ title: 'Example Bistro', url: 'https://bistro.example/', kind: 'place', details: { address: '12 Main St', source: 'page' } });
  const complete = await S.addItem({ title: 'Example Diner', url: 'https://diner.example/', kind: 'place', details: { address: '1 Elm St', locality: 'Austin', region: 'TX', lat: 30.27, lng: -97.74, source: 'page' } });
  await F.send({ type: MSG.FILL_BATCH, itemIds: [partial.id, complete.id], review: true, verify: true, kind: 'place' }, popup);
  for (let i = 0; i < 80 && F.session.keepsake_fillJob?.running; i++) await new Promise((r) => setTimeout(r, 25));
  const p = await S.getItem(partial.id);
  assert.deepEqual([p.title, p.details.address, p.details.locality, p.details.region], ['Example Bistro', '12 Main St', 'New York', 'NY'], 'only the missing fields');
  assert.equal(asked, 1, 'the complete place was not sent');
  assert.deepEqual(await S.getItem(complete.id).then((c) => [c.title, c.details.locality]), ['Example Diner', 'Austin']);
});

test('instagram scan: thumbnails arrive one by one into IndexedDB; the post list and its messages stay small', async () => {
  const { getThumbs } = await import('../keepsake/src/instagram/scanStore.js');
  F.state.sessionQuota = { bytes: 1_000_000 }; // a 1 MB area; 80 thumbnails are ~3 MB
  try {
    const igTab = { tab: { id: 9, url: 'https://www.instagram.com/me/saved/food/123/' }, url: 'https://www.instagram.com/me/saved/food/123/' };
    const thumb = (n) => `data:image/jpeg;base64,${String(n).padStart(4, '0')}${'A'.repeat(40_000)}`;
    const posts = Array.from({ length: 80 }, (_, n) => ({ url: `https://www.instagram.com/p/FOOD${n}x/`, shortcode: `FOOD${n}x`, type: 'post', thumbnail: `https://scontent.cdninstagram.com/${n}.jpg`, captured: true, caption: `Post ${n}` }));
    for (const [n, p] of posts.entries()) assert.equal((await F.send({ type: MSG.IG_SCAN_THUMB, shortcode: p.shortcode, data: thumb(n) }, igTab)).ok, true);
    assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', collectionName: 'Food', posts }, igTab)).ok, true);
    assert.ok(Buffer.byteLength(JSON.stringify(F.session)) < 100_000, 'the session entry stays small');
    const { scan } = await F.send({ type: MSG.IG_SCAN_STATE }, popup);
    assert.equal(scan.status, 'done');
    assert.equal(scan.posts.length, 80);
    assert.equal(scan.posts[42].thumbnail, 'https://scontent.cdninstagram.com/42.jpg');
    assert.equal((await getThumbs(['FOOD42x'])).get('FOOD42x'), thumb(42));
    // Only an Instagram tab can hand in a thumbnail, and only a picture.
    assert.equal((await F.send({ type: MSG.IG_SCAN_THUMB, shortcode: 'FOOD1x', data: thumb(1) }, pageTab)).ok, false);
    assert.equal((await F.send({ type: MSG.IG_SCAN_THUMB, shortcode: 'FOOD1x', data: 'javascript:alert(1)' }, igTab)).ok, false);
    // An older page that still puts the pictures in the list: they are moved out too.
    await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', collectionName: 'Food', posts: posts.map((p, n) => ({ ...p, thumbnail: thumb(n), originalThumbnail: p.thumbnail })) }, igTab);
    assert.ok(Buffer.byteLength(JSON.stringify(F.session)) < 100_000);
    await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
    assert.equal((await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan, null);
    assert.equal((await getThumbs(['FOOD42x'])).size, 0);
    // The session copy is a summary: 80 posts fit an area of 2 KB, and only a change is written.
    F.state.sessionQuota = { bytes: 2_000 };
    assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'scanning', collectionName: 'Food', posts }, igTab)).ok, true);
    assert.equal(F.session.keepsake_igScan.count, 80);
    assert.equal(F.session.keepsake_igScan.posts, undefined);
    assert.equal((await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan.posts.length, 80);
    let writes = 0;
    const count = (changes, area) => { if (area === 'session' && changes.keepsake_igScan) writes++; };
    F.listeners.storage.add(count);
    for (let i = 0; i < 5; i++) await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'scanning', collectionName: 'Food', posts }, igTab);
    F.listeners.storage.delete(count);
    assert.equal(writes, 0, 'the same progress again writes nothing');
    // No room even for that: the worker answers instead of throwing at the page.
    F.state.sessionQuota = { bytes: 50 };
    assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', collectionName: 'Food', posts }, igTab)).ok, false);
  } finally {
    F.state.sessionQuota = { bytes: Infinity };
    await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
  }
});

test('instagram scan: a new scan starts even when an older one left the session area full', async () => {
  const igTab = { tab: { id: 9, url: 'https://www.instagram.com/me/saved/food/123/' }, url: 'https://www.instagram.com/me/saved/food/123/' };
  // What 1.4.3 left behind in Safari: the scan with its thumbnails, filling the area.
  F.session.keepsake_igScan = { tabId: 9, status: 'scanning', posts: [{ url: 'https://www.instagram.com/p/OLD1x/', shortcode: 'OLD1x', thumbnail: `data:image/jpeg;base64,${'A'.repeat(950_000)}` }] };
  F.state.sessionQuota = { bytes: 1_000_000, countsReplaced: true };
  try {
    assert.equal((await F.send({ type: MSG.IG_START_SCAN, tabId: 9 }, popup)).ok, true);
    const posts = [{ url: 'https://www.instagram.com/p/NEW1x/', shortcode: 'NEW1x', type: 'post', thumbnail: 'https://scontent.cdninstagram.com/1.jpg' }];
    assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'scanning', collectionName: 'Food', posts }, igTab)).ok, true);
    const { scan } = await F.send({ type: MSG.IG_SCAN_STATE }, popup);
    assert.deepEqual(scan.posts.map((p) => p.shortcode), ['NEW1x']);
    // A full area mid-scan: the write still lands.
    F.session.keepsake_igScan = { ...F.session.keepsake_igScan, filler: 'A'.repeat(950_000) };
    assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', collectionName: 'Food', posts }, igTab)).ok, true);
    assert.equal((await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan.status, 'done');
  } finally {
    F.state.sessionQuota = { bytes: Infinity };
    await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
  }
});

test('instagram scan: 289 posts reported every second fit a session area that never frees what it wrote', async () => {
  const igTab = { tab: { id: 9, url: 'https://www.instagram.com/me/saved/food/123/' }, url: 'https://www.instagram.com/me/saved/food/123/' };
  F.state.sessionQuota = { bytes: 200_000, leaks: true };
  try {
    await F.send({ type: MSG.IG_START_SCAN, tabId: 9 }, popup);
    const all = Array.from({ length: 289 }, (_, n) => ({ url: `https://www.instagram.com/p/ALL${n}xx/`, shortcode: `ALL${n}xx`, type: 'post', thumbnail: `https://scontent.cdninstagram.com/${n}.jpg`, caption: 'A long caption about sugar free marshmallows '.repeat(20) }));
    // The page reports its whole list on every tick, a few new posts at a time, then several ticks with nothing new.
    for (let tick = 0, n = 0; n < 289 || tick < 120; tick++, n = Math.min(289, n + 3)) {
      assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'scanning', collectionName: 'Food', posts: all.slice(0, n) }, igTab)).ok, true, `tick ${tick}`);
    }
    assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', reason: 'end', collectionName: 'Food', posts: all }, igTab)).ok, true);
    const { scan } = await F.send({ type: MSG.IG_SCAN_STATE }, popup);
    assert.equal(scan.status, 'done');
    assert.equal(scan.posts.length, 289);
  } finally {
    F.state.sessionQuota = { bytes: Infinity };
    await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
  }
});

test('instagram: "Import all collections" opens each collection in turn and merges its posts, noting their collections', async () => {
  const { BULK } = await import('../keepsake/background.js');
  const pause = BULK.pauseMs;
  BULK.pauseMs = 0;
  const tabId = 21;
  const base = 'https://www.instagram.com/me/saved/';
  const post = (code, caption = '') => ({ url: `https://www.instagram.com/p/${code}/`, shortcode: code, type: 'post', thumbnail: '', caption });
  const pages = {
    [`${base}recipes/111/`]: [post('RECIPE1'), post('BOTH001')],
    [`${base}living-room/222/`]: [post('LAMP001'), post('BOTH001')],
    [`${base}all-posts/`]: [post('RECIPE1'), post('LAMP001'), post('BOTH001'), post('LOOSE01')],
  };
  F.state.tabUrls[tabId] = base;
  F.calls.executeScript.length = 0;
  F.calls.tabsUpdated.length = 0;
  F.state.executeScript = async (opts) => {
    // The overview's tiles, as adapter.collectCollections reads them ("All posts" listed first, as Instagram does).
    if (opts.func && !opts.args) return [{ result: [
      { name: 'All posts', url: `${base}all-posts/`, kind: 'all' },
      { name: 'Recipes', url: `${base}recipes/111/`, kind: 'collection' },
      { name: 'Living room', url: `${base}living-room/222/`, kind: 'collection' },
    ] }];
    // The scan on a collection page: one progress report, then done.
    if (opts.files?.includes('src/instagram/scan.js')) {
      const url = F.state.tabUrls[tabId];
      const sender = { tab: { id: tabId, url }, url };
      setTimeout(async () => {
        await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'scanning', posts: pages[url].slice(0, 1) }, sender);
        await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', reason: 'end', posts: pages[url] }, sender);
      }, 0);
    }
    return [{ result: null }];
  };
  try {
    assert.equal((await F.send({ type: MSG.IG_START_ALL, tabId }, pageTab)).ok, false, 'only from Keepsake’s own pages');
    const res = await F.send({ type: MSG.IG_START_ALL, tabId }, popup);
    assert.equal(res.ok, true);
    assert.deepEqual(res.collections, ['Recipes', 'Living room', 'All posts'], 'All posts last');
    let scan;
    for (let i = 0; i < 100; i++) {
      scan = (await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan;
      if (scan.status === 'done') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(scan.status, 'done');
    assert.equal(scan.reason, 'end');
    assert.deepEqual(F.calls.tabsUpdated.map((u) => u.url), [`${base}recipes/111/`, `${base}living-room/222/`, `${base}all-posts/`]);
    assert.deepEqual(scan.bulk.collections.map((c) => [c.name, c.count, c.status]), [['Recipes', 2, 'done'], ['Living room', 2, 'done'], ['All posts', 4, 'done']]);
    const by = Object.fromEntries(scan.posts.map((p) => [p.shortcode, p.collections]));
    assert.deepEqual(by, { RECIPE1: ['Recipes'], BOTH001: ['Recipes', 'Living room'], LAMP001: ['Living room'], LOOSE01: [] });
    // The dashboard writes the list back after reading the posts: their collections survive.
    await F.send({ type: MSG.IG_SCAN_SET_POSTS, posts: scan.posts.map((p) => ({ ...p, caption: 'read' })) }, popup);
    assert.deepEqual((await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan.posts.find((p) => p.shortcode === 'BOTH001').collections, ['Recipes', 'Living room']);
    // Not from a collection page: it needs the Saved overview.
    F.state.tabUrls[tabId] = `${base}recipes/111/`;
    assert.match((await F.send({ type: MSG.IG_START_ALL, tabId }, popup)).error, /Saved page/);
  } finally {
    BULK.pauseMs = pause;
    F.state.executeScript = async () => [{ result: null }];
    await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
  }
});

test('instagram: stopping "Import all collections" keeps what was found and skips the rest', async () => {
  const { BULK } = await import('../keepsake/background.js');
  const pause = BULK.pauseMs;
  BULK.pauseMs = 0;
  const tabId = 22;
  const base = 'https://www.instagram.com/me/saved/';
  F.state.tabUrls[tabId] = base;
  F.state.executeScript = async (opts) => {
    if (opts.func && !opts.args) return [{ result: [{ name: 'A', url: `${base}a/1/`, kind: 'collection' }, { name: 'B', url: `${base}b/2/`, kind: 'collection' }] }];
    if (opts.files?.includes('src/instagram/scan.js')) {
      const url = F.state.tabUrls[tabId];
      const sender = { tab: { id: tabId, url }, url };
      setTimeout(async () => {
        await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'scanning', posts: [{ url: 'https://www.instagram.com/p/AAAAA1/', shortcode: 'AAAAA1', type: 'post' }] }, sender);
        await F.send({ type: MSG.IG_STOP_SCAN }, popup);
        await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', reason: 'stopped', posts: [{ url: 'https://www.instagram.com/p/AAAAA1/', shortcode: 'AAAAA1', type: 'post' }] }, sender);
      }, 0);
    }
    return [{ result: null }];
  };
  try {
    assert.equal((await F.send({ type: MSG.IG_START_ALL, tabId }, popup)).ok, true);
    let scan;
    for (let i = 0; i < 100; i++) {
      scan = (await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan;
      if (scan.status === 'done') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(scan.reason, 'stopped');
    assert.deepEqual(scan.bulk.collections.map((c) => c.status), ['done', 'skipped']);
    assert.equal(scan.posts.length, 1);
  } finally {
    BULK.pauseMs = pause;
    F.state.executeScript = async () => [{ result: null }];
    await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
  }
});

test('instagram scan: Safari without instagram.com access sends no tab address; reports from the scan\'s own tab still count', async () => {
  await F.send({ type: MSG.IG_START_SCAN, tabId: 31 }, popup);
  const post = { url: 'https://www.instagram.com/p/SAFARI1/', shortcode: 'SAFARI1', type: 'post' };
  // No url on the tab or the sender, as Safari reports a content script on activeTab alone.
  assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', reason: 'end', collectionName: 'Food', posts: [post] }, { tab: { id: 31 } })).ok, true);
  assert.equal((await F.send({ type: MSG.IG_SCAN_STATE }, popup)).scan.posts.length, 1);
  // Another tab without an address is still refused, and so is a tab on another site.
  assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', posts: [post] }, { tab: { id: 32 } })).ok, false);
  assert.equal((await F.send({ type: MSG.IG_SCAN_UPDATE, status: 'done', posts: [post] }, { tab: { id: 31, url: 'https://evil.example/' }, url: 'https://evil.example/' })).ok, false);
  await F.send({ type: MSG.IG_SCAN_CLEAR }, popup);
});

test('bulk import from open tabs: with AI on, nothing goes to your provider; the save is flagged for Run AI', async () => {
  await aiOn();
  let asked = 0;
  globalThis.fetch = async () => { asked++; return aiReply({ kind: 'product', confidence: 0.9 })(); };
  const res = await F.send({ type: MSG.SAVE_ITEM, product: { ...tent, url: 'https://shop.example/tent-bulk' }, source: 'tabs-import', deferAi: true }, popup);
  await finish();
  await new Promise((r) => setTimeout(r, 100));
  const it = await S.getItem(res.item.id);
  assert.deepEqual([it.captureState, it.needsAi, asked], ['complete', true, 0]);
});

test('Run AI on imported saves: reads the flagged saves you picked, clears their flag, reports progress; a bad key pauses it', async () => {
  await aiOn();
  globalThis.fetch = aiReply({ kind: 'recipe', confidence: 0.95, title: 'Weeknight pasta', details: { ingredients: ['pasta', 'salt'], steps: ['Boil.'] } });
  const mk = (n) => S.addItem({ type: 'instagram', title: `Post ${n}`, url: `https://www.instagram.com/p/RUNAI${n}/`, instagram: { caption: `Post ${n}` }, needsAi: true });
  const a = await mk(1);
  const b = await mk(2);
  const c = await mk(3);
  const res = await F.send({ type: MSG.AI_BACKLOG_RUN, itemIds: [a.id, b.id] }, popup);
  assert.equal(res.ok, true);
  assert.deepEqual([res.job.backlog, res.job.total], [true, 2]);
  for (let i = 0; i < 100 && F.session.keepsake_fillJob?.running; i++) await new Promise((r) => setTimeout(r, 25));
  const job = F.session.keepsake_fillJob;
  assert.deepEqual([job.running, job.done, job.paused], [false, 2, false]);
  assert.deepEqual([(await S.getItem(a.id)).needsAi, (await S.getItem(a.id)).kind, (await S.getItem(c.id)).needsAi], [false, 'recipe', true], 'only the ones picked');
  // A bad key: paused with the reason, and the save stays waiting.
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
  await F.send({ type: MSG.AI_BACKLOG_RUN }, popup);
  for (let i = 0; i < 100 && F.session.keepsake_fillJob?.running; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(F.session.keepsake_fillJob.paused, true);
  assert.match(F.session.keepsake_fillJob.error, /401/);
  assert.equal((await S.getItem(c.id)).needsAi, true);
  assert.equal((await F.send({ type: MSG.AI_BACKLOG_RUN }, pageTab)).error, 'Not allowed.');
});
