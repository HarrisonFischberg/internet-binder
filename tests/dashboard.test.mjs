// Boots the real dashboard module in jsdom against the fake chrome.* and visits every route.
// A smoke test for "does each page render without throwing"; layout and pixels are not checked.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const ROOT = new URL('../keepsake/', import.meta.url);
const html = readFileSync(new URL('src/dashboard/dashboard.html', ROOT), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'chrome-extension://test-extension-id/src/dashboard/dashboard.html#home', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const errors = [];

before(async () => {
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!(key in globalThis)) { try { globalThis[key] = window[key]; } catch { /* read-only */ } }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  globalThis.matchMedia = window.matchMedia;
  window.scrollTo = () => {};
  globalThis.scrollTo = window.scrollTo;
  const F = fakeChrome();
  globalThis.chrome = F.chrome;
  window.chrome = F.chrome;
  window.eval(readFileSync(new URL('src/instagram/adapter.js', ROOT), 'utf8'));
  globalThis.KeepsakeInstagram = window.KeepsakeInstagram;
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  await import('../keepsake/src/dashboard/dashboard.js');
  await settle();
  console.error = origError;
});

const settle = () => new Promise((r) => setTimeout(r, 60));
// The dashboard re-renders 150 ms after a storage change (debounced); wait past that.
const afterChange = () => new Promise((r) => setTimeout(r, 400));
const view = () => window.document.getElementById('view');
async function go(hash) {
  window.location.hash = hash;
  await settle();
  return view().textContent;
}

test('the dashboard boots without errors', () => {
  assert.deepEqual(errors, []);
  assert.ok(view(), 'the #view container exists');
  assert.doesNotMatch(view().textContent, /couldn.t start/i);
});

const ROUTES = ['#home', '#all', '#favorites', '#purchased', '#archive', '#trash', '#collections', '#import', '#settings', '#ai', '#ailog', '#privacy', '#welcome'];
for (const r of ROUTES) {
  test(`route ${r} renders`, async () => {
    const text = await go(r);
    assert.ok(text.trim().length > 0, `${r} rendered nothing`);
    assert.doesNotMatch(text, /couldn.t start|undefined|\[object Object\]/i);
  });
}

test('an empty library shows the first-run empty state', async () => {
  const text = await go('#all');
  assert.match(text, /Nothing saved yet/);
});

test('sample data appears in All saves and Review', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  await store.loadSampleData();
  await settle();
  await settle();
  const all = await go('#all');
  assert.match(all, /Two-person ultralight backpacking tent/);
  const review = await go('#review');
  assert.match(review, /Morning light, kitchen corner/);
});

test('deleting from Review moves the save to Trash, with Undo, and Trash can restore it', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  assert.match(await go('#trash'), /Nothing in Trash/);
  await go('#review');
  const del = [...view().querySelectorAll('button')].find((b) => b.textContent === 'Delete');
  del.click();
  await settle();
  await settle();
  const toast = window.document.body.textContent;
  assert.match(toast, /Moved to Trash/);
  assert.equal((await store.getTrash()).length, 1);
  const trashText = await go('#trash');
  assert.match(trashText, /Morning light, kitchen corner/);
  assert.match(trashText, /removed for good in 30 days/);
  [...view().querySelectorAll('button')].find((b) => b.textContent === 'Restore').click();
  await settle();
  assert.equal((await store.getTrash()).length, 0);
});

test('the Style setting restyles the page (Modern by default, no attribute)', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  assert.equal(window.document.documentElement.dataset.style, undefined);
  const text = await go('#settings');
  assert.match(text, /Style/);
  assert.match(text, /Minimalist/);
  await store.updateSettings({ style: 'moss', theme: 'dark' });
  await afterChange();
  assert.equal(window.document.documentElement.dataset.style, 'moss');
  assert.equal(window.document.documentElement.dataset.theme, 'dark');
  await store.updateSettings({ style: 'modern', theme: 'system' });
  await afterChange();
  assert.equal(window.document.documentElement.dataset.style, undefined);
  assert.equal(window.document.documentElement.dataset.theme, undefined);
});

test('Review rows offer numbered suggestions and file with a number key', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const it = await store.addItem({ title: 'Two-person ultralight backpacking tent', url: 'https://a.example/tent-review', collectionId: null, needsReview: true });
  await afterChange();
  await go('#review');
  const row = [...view().querySelectorAll('.review-row')].find((r) => r.textContent.includes('backpacking tent'));
  assert.ok(row, 'the save is listed in Review');
  const chips = [...row.querySelectorAll('.suggest-chip')];
  assert.ok(chips.length >= 1 && chips.length <= 3);
  assert.equal(chips[0].querySelector('kbd').textContent, '1');
  row.focus();
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true }));
  await afterChange();
  const filed = await store.getItem(it.id);
  assert.ok(filed.collectionId, 'pressing 1 filed it');
  assert.equal(filed.needsReview, false);
});

test('recipes get their own view, a kind badge, and a recipe panel', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const it = await store.addItem({ title: 'Miso butter noodles', url: 'https://cook.example/noodles', kind: 'recipe', details: { ingredients: ['200 g udon', '2 tbsp miso'], steps: ['Boil.', 'Toss.'], totalMinutes: 15, source: 'page' } });
  await afterChange();
  assert.match(window.document.getElementById('navKinds').textContent, /Recipes/);
  const text = await go('#kind/recipe');
  assert.match(text, /Miso butter noodles/);
  assert.match(text, /2 ingredients · 15 min/);
  // Clicking the card opens the recipe itself, not Quick view or Edit details.
  const card = [...view().querySelectorAll('.card')].find((c) => c.textContent.includes('Miso butter noodles'));
  card.querySelector('.card-hit').click();
  await afterChange();
  const rv = window.document.querySelector('.modal-recipe .recipe-view');
  assert.ok(rv, 'the recipe view opened');
  assert.match(rv.textContent, /Ingredients/);
  assert.match(rv.textContent, /200 g udon/);
  assert.match(rv.textContent, /Method/);
  assert.match(rv.textContent, /Toss\./);
  assert.match(rv.textContent, /15 min/);
  const box = rv.querySelector('.recipe-ingredients input');
  box.click();
  assert.match(rv.textContent, /1 of 2/);
  [...window.document.querySelectorAll('.modal-recipe button')].find((b) => b.textContent === 'Mark cooked').click();
  await afterChange();
  assert.equal((await store.getItem(it.id)).status, 'done');
  window.document.querySelectorAll('.modal-close').forEach((b) => b.click());
  await afterChange();
  await go(`#item/${it.id}`);
  await afterChange();
  const panel = window.document.querySelector('.recipe-panel');
  assert.ok(panel, 'the recipe panel is shown');
  assert.match(panel.textContent, /200 g udon/);
  assert.match(panel.textContent, /From the page/);
  window.document.querySelectorAll('.modal button').forEach((b) => { if (b.textContent === 'Cancel') b.click(); });
  await afterChange();
});

test('workouts open into the workout view: exercises, a goal, check-in with undo', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const it = await store.addItem({ title: 'Leg day', url: 'https://fit.example/legs', kind: 'workout', details: { exercises: [{ name: 'Squats', sets: 3, reps: 12 }, { name: 'Plank', sets: 3, durationSeconds: 45, restSeconds: 60 }], durationMinutes: 20, source: 'page' } });
  await afterChange();
  assert.match(window.document.getElementById('navKinds').textContent, /Workouts/);
  const text = await go('#kind/workout');
  assert.match(text, /2 exercises · 20 min/);
  const card = [...view().querySelectorAll('.card')].find((c) => c.textContent.includes('Leg day'));
  card.querySelector('.card-hit').click();
  await afterChange();
  const wv = window.document.querySelector('.modal-workout .workout-view');
  assert.ok(wv, 'the workout view opened');
  const rows = [...wv.querySelectorAll('.exercise-table tbody tr')].map((r) => r.textContent);
  assert.deepEqual(rows, ['Squats312 reps—', 'Plank345s1 min']);
  assert.doesNotMatch(wv.textContent, /Suggest a progression/, 'AI off: never shown');

  const btn = (label) => [...wv.querySelectorAll('button')].find((b) => b.textContent === label);
  btn('Make it a goal').click();
  await afterChange();
  wv.querySelector('.goal-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await afterChange();
  assert.match(wv.querySelector('.goal-card').textContent, /3× a week for 4 weeks/);
  assert.match(wv.textContent, /0 of 3 this week · week 1 of 4/);

  btn('Done today').click();
  await afterChange();
  assert.match(wv.textContent, /1 of 3 this week/);
  const [goal] = await store.getGoals({ itemId: it.id });
  assert.equal((await store.getCheckins(goal.id)).length, 1);
  [...window.document.querySelectorAll('.toast-action')].find((b) => b.textContent === 'Undo').click();
  await afterChange();
  assert.equal((await store.getCheckins(goal.id)).length, 0);
  assert.match(wv.textContent, /0 of 3 this week/);

  window.document.querySelectorAll('.modal-close').forEach((b) => b.click());
  await afterChange();
  await go(`#item/${it.id}`);
  await afterChange();
  const box = window.document.querySelector('textarea[aria-label="Exercises, one per line"]');
  assert.equal(box.value, 'Squats 3×12\nPlank 3×45s rest 60s');
  window.document.querySelectorAll('.modal button').forEach((b) => { if (b.textContent === 'Cancel') b.click(); });
  await afterChange();
});

test('switching an Instagram save to Workout fills in the exercises its caption lists', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const it = await store.addItem({ title: 'Instagram post', url: 'https://www.instagram.com/p/testback1/', type: 'instagram', kind: 'link',
    description: 'Back day with one kettlebell. Exercises: 1. KB Row 2. KB Swing 3. KB Halo ✅ 3 sets ✅ 8–12 reps per exercise ✅ 60 sec rest #workout' });
  await afterChange();
  await go(`#item/${it.id}`);
  await afterChange();
  const kind = window.document.querySelector('select[aria-label="Kind"]');
  kind.value = 'workout';
  kind.dispatchEvent(new window.Event('change'));
  const box = window.document.querySelector('textarea[aria-label="Exercises, one per line"]');
  assert.equal(box.value, 'KB Row 3×8–12 rest 60s\nKB Swing 3×8–12 rest 60s\nKB Halo 3×8–12 rest 60s');
  [...window.document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Save changes').click();
  await afterChange();
  const saved = await store.getItem(it.id);
  assert.equal(saved.kind, 'workout');
  assert.deepEqual(saved.details.exercises.map((e) => [e.name, e.sets, e.reps, e.repsMax, e.restSeconds]), [['KB Row', 3, 8, 12, 60], ['KB Swing', 3, 8, 12, 60], ['KB Halo', 3, 8, 12, 60]]);
  assert.equal(saved.details.source, 'caption', 'kept as found, so labelled as from the caption');
});

test('places: a list grouped by city, the place view with maps links, Been, and editing the address drops the pin', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const a = await store.addItem({ title: 'Little Kitchen', url: 'https://eat.example/lk', kind: 'place', details: { address: '12 Mill Lane', locality: 'Bristol', lat: 51.45, lng: -2.59, cuisine: 'Georgian', hours: ['Tue–Sat 17:00–22:00'], source: 'page' } });
  await store.addItem({ title: 'Harbour Café', url: 'https://eat.example/hc', kind: 'place', details: { locality: 'Bath', source: 'page' } });
  await store.addItem({ title: 'Somewhere', url: 'https://eat.example/s', kind: 'place', details: {} });
  await afterChange();
  assert.match(window.document.getElementById('navKinds').textContent, /Places/);
  await go('#kind/place');
  const cities = [...view().querySelectorAll('.place-city')].map((h) => h.firstChild.textContent);
  assert.deepEqual(cities, ['Bath', 'Bristol', 'Somewhere else']);
  assert.ok(!view().querySelector('.grid'), 'a list, not the grid');
  const row = [...view().querySelectorAll('.place-row')].find((r) => r.textContent.includes('Little Kitchen'));
  assert.match(row.textContent, /Georgian · 12 Mill Lane/);
  assert.ok(row.querySelector('button[aria-haspopup="menu"]'), 'Open in Maps on the row');

  row.querySelector('.place-row-hit').click();
  await afterChange();
  const pv = window.document.querySelector('.modal-place .place-view');
  assert.ok(pv, 'the place view opened');
  assert.match(pv.querySelector('address').textContent, /12 Mill Lane, Bristol/);
  assert.match(pv.textContent, /Tue–Sat 17:00–22:00/);
  const google = [...window.document.querySelectorAll('.modal-place a')].find((x) => x.textContent.includes('Google Maps'));
  assert.equal(new URL(google.href).searchParams.get('query'), 'Little Kitchen, 12 Mill Lane, Bristol');
  [...window.document.querySelectorAll('.modal-place button')].find((b) => b.textContent === 'Mark been').click();
  await afterChange();
  assert.equal((await store.getItem(a.id)).status, 'done');
  window.document.querySelectorAll('.modal-close').forEach((b) => b.click());
  await afterChange();

  await go(`#item/${a.id}`);
  await afterChange();
  const street = window.document.querySelector('input[aria-label="Street address"]');
  assert.equal(street.value, '12 Mill Lane');
  street.value = '3 New Street';
  [...window.document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Save changes').click();
  await afterChange();
  const saved = await store.getItem(a.id);
  assert.equal(saved.details.address, '3 New Street');
  assert.equal(saved.details.lat, null, 'the old pin pointed at the old address');
  assert.equal(saved.details.source, 'you');
});

test('videos open into a view with their length and a Watch link; editing the length is checked', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const it = await store.addItem({ title: 'How to sharpen a knife', url: 'https://www.youtube.com/watch?v=abc123', description: 'Whetstone basics in twelve minutes.', kind: 'video',
    details: { durationSeconds: 723, channel: 'Example Channel', platform: 'YouTube', publishedOn: '2026-09-30', source: 'page' } });
  await afterChange();
  const text = await go('#kind/video');
  assert.match(text, /Example Channel · 12:03/);
  [...view().querySelectorAll('.card')].find((c) => c.textContent.includes('sharpen')).querySelector('.card-hit').click();
  await afterChange();
  const mv = window.document.querySelector('.modal-media .media-view');
  assert.ok(mv, 'the video view opened');
  assert.match(mv.textContent, /Whetstone basics/);
  const watch = [...window.document.querySelectorAll('.modal-media a')].find((x) => x.textContent.includes('Watch on YouTube'));
  assert.equal(watch.getAttribute('href'), 'https://www.youtube.com/watch?v=abc123');
  [...window.document.querySelectorAll('.modal-media button')].find((b) => b.textContent === 'Mark watched').click();
  await afterChange();
  assert.equal((await store.getItem(it.id)).status, 'done');
  window.document.querySelectorAll('.modal-close').forEach((b) => b.click());
  await afterChange();

  await go(`#item/${it.id}`);
  await afterChange();
  const len = window.document.querySelector('input[aria-label="Length, e.g. 12:30"]');
  assert.equal(len.value, '12:03');
  len.value = '1:05:00';
  [...window.document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Save changes').click();
  await afterChange();
  assert.equal((await store.getItem(it.id)).details.durationSeconds, 3900);
  assert.equal((await store.getItem(it.id)).details.source, 'you');
});

test('tags: filter chips in a view, pills on cards, edited in Edit details; Shelves folds the kind views', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const a = await store.addItem({ title: 'GTA mod with one prompt', url: 'https://www.youtube.com/watch?v=t1', kind: 'video', topics: ['Video games', 'AI'], topicsBy: 'guess' });
  await store.addItem({ title: 'Sneaker rotation', url: 'https://www.youtube.com/watch?v=t2', kind: 'video', topics: ['Shoes'], topicsBy: 'guess' });
  await afterChange();
  await go('#kind/video');
  const chips = [...view().querySelectorAll('.topic-chip')].map((c) => c.firstChild.textContent);
  assert.ok(chips.includes('AI') && chips.includes('Shoes') && chips[0] === 'All tags');
  [...view().querySelectorAll('.topic-chip')].find((c) => c.firstChild.textContent === 'Shoes').click();
  await settle();
  assert.match(view().textContent, /Sneaker rotation/);
  assert.doesNotMatch(view().textContent, /GTA mod/);
  [...view().querySelectorAll('.topic-chip')].find((c) => c.firstChild.textContent === 'All tags').click();
  await settle();
  assert.match(view().querySelector('.card-topics').textContent + view().textContent, /Video games/);

  // Shelves: open while on one of its views, and the kind views live inside it.
  const toggle = window.document.getElementById('navShelvesToggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(window.document.getElementById('navShelvesList').querySelector('a[href="#kind/video"]'));
  assert.ok(window.document.getElementById('navShelvesList').querySelector('a[href="#purchased"]'));
  await go('#home');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'closed elsewhere unless you opened it');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(window.document.getElementById('navShelvesList').hidden, false);
  await go('#all');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'remembered');
  toggle.click();

  await go(`#item/${a.id}`);
  await afterChange();
  const tags = window.document.querySelector('input[aria-label="Tags, separated by commas"]');
  assert.equal(tags.value, 'Video games, AI');
  tags.value = 'Video games, Modding';
  [...window.document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Save changes').click();
  await afterChange();
  const saved = await store.getItem(a.id);
  assert.deepEqual([saved.topics, saved.topicsBy], [['Video games', 'Modding'], 'you']);
  assert.ok(saved.userFields.includes('topics'));
});

test('films and books: a list to scroll, to-watch first; tick to move; the view shows the facts', async () => {
  const { createStore, chromeBackend, idbBackend } = await import('../keepsake/src/shared/storage.js');
  const store = createStore(chromeBackend(), idbBackend());
  const a = await store.addItem({ title: 'A Film', url: 'https://films.example/1', retailer: 'Films Example', kind: 'media', details: { format: 'film', year: 1999, director: 'A. Director', runtimeMinutes: 136, genres: ['Sci-Fi'], source: 'page' } });
  await store.addItem({ title: 'A Show', url: 'https://films.example/2', kind: 'media', status: 'done', details: { format: 'series', year: 2019, seasons: 3, source: 'page' } });
  await afterChange();
  await go('#kind/media');
  const heads = [...view().querySelectorAll('.place-city')].map((h) => h.firstChild.textContent);
  assert.deepEqual(heads, ['To watch', 'Watched']);
  assert.match(view().textContent, /1999 · Film/);
  assert.ok(!view().querySelector('.grid'));
  const row = [...view().querySelectorAll('.shelf-row')].find((r) => r.textContent.includes('A Film'));
  row.querySelector('input[type=checkbox]').click();
  await afterChange();
  assert.equal((await store.getItem(a.id)).status, 'done');
  assert.deepEqual([...view().querySelectorAll('.place-city')].map((h) => h.firstChild.textContent), ['Watched']);
  [...view().querySelectorAll('.shelf-row-hit')].find((b) => b.textContent.includes('A Film')).click();
  await afterChange();
  const sv = window.document.querySelector('.modal-shelf .shelf-view');
  assert.match(sv.textContent, /Directed by\s*A\. Director/);
  assert.match(sv.textContent, /2 hr 16 min/);
  assert.ok([...window.document.querySelectorAll('.modal-shelf a')].some((x) => x.textContent.includes('Open on Films Example')));
  window.document.querySelectorAll('.modal-close').forEach((b) => b.click());
  await afterChange();
});

test('an unknown collection route says so', async () => {
  const text = await go('#c/does-not-exist');
  assert.match(text, /Collection not found/);
});
