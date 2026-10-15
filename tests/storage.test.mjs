// storage.js against its in-memory backend: the data contract M1's migration must preserve.
// Every test runs twice: against the in-memory record backend and against the real IndexedDB
// backend (db.js) on fake-indexeddb. Neither is Chrome; real-browser checks are listed in the audit.
import { test as nodeTest, describe } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createStore, memoryBackend, memoryRecordBackend, idbBackend, migrate, validateExport, KEYS, SCHEMA_VERSION, LIMITS, makeItem, TRASH_DAYS, StorageFullError } from '../keepsake/src/shared/storage.js';

let dbn = 0;
const KINDS = {
  memory: () => memoryRecordBackend(),
  idb: () => idbBackend(indexedDB, `keepsake-test-${process.pid}-${++dbn}`),
};
let makeDb = KINDS.memory;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function fresh(initial, db = makeDb()) {
  const be = memoryBackend(initial);
  const store = createStore(be, db);
  const r = await store.init();
  return { store, be, db, fresh: r.fresh, migrated: r.migrated };
}

test('init on an empty profile creates meta, settings and the three starter collections', async () => {
  const { store, fresh: isFresh } = await fresh();
  assert.equal(isFresh, true);
  const all = await store.getAll();
  assert.equal(all.meta.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual((await store.getCollections()).map((c) => c.name), ['Home Decor', 'Clothing', 'Technology']);
  assert.equal(all.settings.ai.on, false, 'AI is off by default');
  assert.equal(all.settings.floating.mode, 'off', 'on-page buttons are off by default');
  assert.equal('secrets' in all, false, 'getAll never returns secrets');
});

test('init is idempotent and keeps user data', async () => {
  const { store, be, db } = await fresh();
  const it = await store.addItem({ title: 'Lamp', url: 'https://a.example/lamp' });
  const again = createStore(be, db);
  const r = await again.init();
  assert.equal(r.fresh, false);
  assert.equal((await again.getItem(it.id)).title, 'Lamp');
});

test('items: add, update keeps createdAt, sanitizes input', async () => {
  const { store } = await fresh();
  const it = await store.addItem({ title: '  Tent  ', url: 'https://shop.example/tent?utm_source=x', price: '129.5', currency: 'usd', image: 'javascript:alert(1)' });
  assert.equal(it.title, 'Tent');
  assert.equal(it.price, 129.5);
  assert.equal(it.currency, 'USD');
  assert.equal(it.image, '');
  assert.equal(it.urlKey, 'shop.example/tent');
  const up = await store.updateItem(it.id, { note: 'wait for sale', favorite: true });
  assert.equal(up.createdAt, it.createdAt);
  assert.equal(up.note, 'wait for sale');
  await assert.rejects(store.updateItem('nope', {}), /not found/);
});

test('saves stored with HTML entities are decoded once on init; nothing else changes', async () => {
  const { store, be, db } = await fresh();
  const clean = await store.addItem({ title: 'Lamp', url: 'https://a.example/lamp' });
  const raw = { ...makeItem({ url: 'https://a.example/rolls', title: 'Rolls', kind: 'recipe', details: { ingredients: ['flour'], steps: ['x'] } }),
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', collectionId: clean.collectionId, extraField: 'kept' };
  raw.title = 'Mac &amp;amp; cheese';
  raw.details = { ...raw.details, steps: ['Roll out a 14&#215;8-inch (36&#215;20-cm) rectangle'] };
  await db.put('items', [raw]);
  await be.set({ [KEYS.meta]: { ...(await be.get([KEYS.meta]))[KEYS.meta], textRepairedAt: undefined } });

  const again = createStore(be, db);
  await again.init();
  const got = await again.getItem(raw.id);
  assert.equal(got.title, 'Mac & cheese');
  assert.deepEqual(got.details.steps, ['Roll out a 14×8-inch (36×20-cm) rectangle']);
  assert.equal(got.createdAt, raw.createdAt);
  assert.equal(got.updatedAt, raw.updatedAt);
  assert.equal(got.collectionId, raw.collectionId);
  assert.equal(got.extraField, 'kept');
  assert.deepEqual(await again.getItem(clean.id), clean, 'saves without entities are not rewritten');
  const meta = (await be.get([KEYS.meta]))[KEYS.meta];
  assert.ok(meta.textRepairedAt);
  assert.equal(meta.textRepairedCount, 1);

  // Runs once: text the user types later with an entity in it stays as typed until they edit it.
  await db.put('items', [{ ...got, title: 'Fish &amp; chips' }]);
  await createStore(be, db).init();
  assert.equal((await again.getItem(raw.id)).title, 'Fish &amp; chips');
});

test('workout goals: create, check in, end and restore; deleting the workout for good takes them along', async () => {
  const { store, db } = await fresh();
  const w = await store.addItem({ title: 'Leg day', url: 'https://fit.example/legs', kind: 'workout', details: { exercises: [{ name: 'Squats', sets: 3, reps: 12 }] } });
  await assert.rejects(store.createGoal({ itemId: 'nope', kind: 'frequency' }), /no longer exists/);
  const g = await store.createGoal({ itemId: w.id, kind: 'frequency', spec: { perWeek: 3, weeks: 4 }, id: 'forged', createdAt: '1999-01-01' });
  assert.notEqual(g.id, 'forged');
  assert.notEqual(g.createdAt, '1999-01-01');
  const c1 = await store.addCheckin(g.id, { sets: 3, reps: 12 });
  await store.addCheckin(g.id, {});
  assert.equal((await store.getCheckins(g.id)).length, 2);
  await store.removeCheckin(c1.id);
  assert.equal((await store.getCheckins(g.id)).length, 1);
  assert.equal((await store.getAll()).goals.length, 1);

  const updated = await store.updateGoal(g.id, { plan: [{ week: 1, perWeek: 2 }], planSource: 'ai-suggested', itemId: 'moved' });
  assert.equal(updated.itemId, w.id, 'a goal stays with its workout');
  assert.equal(updated.plan.length, 1);
  await store.deleteGoal(g.id);
  assert.equal((await store.getGoals({ itemId: w.id })).length, 0);
  await assert.rejects(store.addCheckin(g.id, {}), /no longer exists/);
  await store.restoreGoal(g.id);
  assert.equal((await store.getGoals({ itemId: w.id })).length, 1);

  await store.deleteItems([w.id]);
  assert.equal((await store.getGoals()).length, 1, 'a workout in Trash keeps its goal, for restore');
  await store.deleteForever([w.id]);
  assert.equal((await db.all('goals')).length, 0);
  assert.equal((await db.all('checkins')).length, 0);
});

test('ended goals are purged with the Trash after 30 days, with their check-ins', async () => {
  const { store, db } = await fresh();
  const w = await store.addItem({ title: 'Core', url: 'https://fit.example/core', kind: 'workout' });
  const g = await store.createGoal({ itemId: w.id, kind: 'target', spec: { exercise: 'Plank', sets: 3, durationSeconds: 60 } });
  await store.addCheckin(g.id, { sets: 3, durationSeconds: 40 });
  await store.deleteGoal(g.id);
  assert.equal(await store.purgeTrash({ now: Date.now() + 5 * 864e5 }), 0);
  assert.equal((await db.all('goals')).length, 1);
  await store.purgeTrash({ now: Date.now() + 31 * 864e5 });
  assert.equal((await db.all('goals')).length, 0);
  assert.equal((await db.all('checkins')).length, 0);
});

test('export and import carry goals and check-ins; a goal follows its workout to the save already here', async () => {
  const a = await fresh();
  const w = await a.store.addItem({ title: 'Leg day', url: 'https://fit.example/legs', kind: 'workout' });
  const g = await a.store.createGoal({ itemId: w.id, kind: 'frequency', spec: { perWeek: 2, weeks: 2 } });
  await a.store.addCheckin(g.id, { note: 'felt good' });
  const file = await a.store.exportJSON();
  assert.equal(file.goals.length, 1);
  assert.equal(file.checkins.length, 1);

  // Another profile already has the same workout (same link, different id).
  const b = await fresh();
  const mine = await b.store.addItem({ title: 'Leg day (mine)', url: 'https://fit.example/legs', kind: 'workout' });
  const r = await b.store.importJSON(JSON.parse(JSON.stringify(file)));
  assert.equal(r.addedGoals, 1);
  assert.equal(r.addedCheckins, 1);
  const [goal] = await b.store.getGoals();
  assert.equal(goal.itemId, mine.id);
  assert.equal((await b.store.getCheckins(goal.id))[0].result.note, 'felt good');
  const again = await b.store.importJSON(JSON.parse(JSON.stringify(file)));
  assert.equal(again.addedGoals, 0, 'importing twice adds nothing');

  // A goal without its workout, or a check-in without its goal, is dropped.
  const orphan = { ...JSON.parse(JSON.stringify(file)), goals: [{ ...file.goals[0], itemId: 'missing' }] };
  const v = validateExport(orphan);
  assert.equal(v.goals.length, 0);
  assert.equal(v.checkins.length, 0);

  // Replace wipes goals too.
  await b.store.importJSON({ format: 'keepsake-export', schemaVersion: SCHEMA_VERSION, items: {}, collections: {} }, { mode: 'replace' });
  assert.equal((await b.store.getGoals({ includeDeleted: true })).length, 0);
});

test('the automatic kind collections (Videos, Recipes…) are removed once; their saves stay, in their views', async () => {
  const { store, be, db } = await fresh();
  const mk = (id, name, taxonomyKey) => ({ id, name, taxonomyKey, keywords: [], aliases: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
  await db.put('collections', [mk('colVideos', 'Videos', 'videos'), mk('colRecipes', 'Recipes', 'recipes'), mk('colMine', 'Recipes to try', 'recipes'), mk('colMixed', 'Places', 'places')]);
  const v = await store.addItem({ title: 'A video', url: 'https://www.youtube.com/watch?v=k1', kind: 'video', collectionId: 'colVideos' });
  const r = await store.addItem({ title: 'A recipe', url: 'https://cook.example/k1', kind: 'recipe', collectionId: 'colMine' });
  const p = await store.addItem({ title: 'A place', url: 'https://eat.example/k1', kind: 'place', collectionId: 'colMixed' });
  const shop = await store.addItem({ title: 'A lamp', url: 'https://shop.example/k1', kind: 'product', collectionId: 'colMixed' });
  await be.set({ [KEYS.meta]: { ...(await be.get([KEYS.meta]))[KEYS.meta], kindCollectionsRemovedAt: undefined } });
  await createStore(be, db).init();
  const ids = (await db.all('collections')).map((c) => c.id);
  assert.ok(!ids.includes('colVideos'), 'default name, only videos inside: removed');
  assert.ok(!ids.includes('colRecipes'), 'empty and default: removed');
  assert.ok(ids.includes('colMine'), 'renamed: kept');
  assert.ok(ids.includes('colMixed'), 'holds a product too: kept');
  const moved = await store.getItem(v.id);
  assert.deepEqual([moved.collectionId, moved.needsReview, moved.kind], [null, false, 'video']);
  assert.equal((await store.getItem(r.id)).collectionId, 'colMine');
  assert.equal((await store.getItem(p.id)).collectionId, 'colMixed');
  assert.equal((await store.getItem(shop.id)).collectionId, 'colMixed');
  const meta = (await be.get([KEYS.meta]))[KEYS.meta];
  assert.equal(meta.kindCollectionsRemoved, 2);
});

test('makeItem: types and defaults', () => {
  assert.equal(makeItem({ url: 'https://www.instagram.com/p/AbCdE1/' }).type, 'instagram');
  assert.equal(makeItem({ url: 'https://www.instagram.com/p/AbCdE1/' }).title, 'Instagram post');
  assert.equal(makeItem({ url: 'https://shop.example/x' }).title, 'Untitled item');
  assert.equal(makeItem({ price: -3 }).price, null);
  assert.equal(makeItem({ confidence: 4 }).confidence, 1);
});

test('duplicate detection ignores tracking parameters', async () => {
  const { store } = await fresh();
  const it = await store.addItem({ title: 'Tent', url: 'https://www.shop.example/tent/?utm_campaign=x' });
  assert.equal((await store.findByUrl('https://shop.example/tent?fbclid=123')).id, it.id);
  assert.equal(await store.findByUrl('https://shop.example/other'), null);
});

test('moveItems learns, marks manual and clears Review', async () => {
  const { store } = await fresh();
  const [home, clothing] = await store.getCollections();
  const it = await store.addItem({ title: 'Linen throw', url: 'https://a.example/1', collectionId: null, needsReview: true });
  await store.moveItems([it.id], home.id, { learn: 'strong' });
  const moved = await store.getItem(it.id);
  assert.equal(moved.collectionId, home.id);
  assert.equal(moved.needsReview, false);
  assert.equal(moved.categorizationSource, 'manual');
  assert.equal(moved.confidence, 1);
  const prefs = await store.getPrefs();
  assert.ok(Object.values(prefs.learnedKeywords).some((e) => e[home.id] > 0));
  await assert.rejects(store.moveItems([it.id], 'missing'), /not found/);
  assert.ok(clothing);
});

test('collections: same-name dedupe, similar allowed on request, limit enforced', async () => {
  const { store } = await fresh();
  const a = await store.createCollection({ name: 'Lamps' });
  const b = await store.createCollection({ name: 'lamp' });
  assert.equal(b.existed, true);
  assert.equal(b.collection.id, a.collection.id);
  const c = await store.createCollection({ name: 'lamp' }, { allowSimilar: true });
  assert.notEqual(c.collection.id, a.collection.id);
});

test('deleting a collection sends its items to Review (or to moveTo), and forgets learned weights', async () => {
  const { store } = await fresh();
  const [home, clothing] = await store.getCollections();
  const i1 = await store.addItem({ title: 'Lamp', url: 'https://a.example/1', collectionId: home.id });
  await store.moveItems([i1.id], clothing.id);
  await store.moveItems([i1.id], home.id);
  await store.deleteCollection(home.id);
  const after = await store.getItem(i1.id);
  assert.equal(after.collectionId, null);
  assert.equal(after.needsReview, true);
  assert.ok(after.previousCollections.includes(home.id));
  const prefs = await store.getPrefs();
  for (const e of Object.values(prefs.learnedKeywords)) assert.equal(e[home.id], undefined);
});

test('merging collections moves items and carries the name over as an alias', async () => {
  const { store } = await fresh();
  const [home, clothing] = await store.getCollections();
  const it = await store.addItem({ title: 'Lamp', url: 'https://a.example/1', collectionId: clothing.id });
  const target = await store.mergeCollections(clothing.id, home.id);
  assert.ok(target.aliases.includes('Clothing'));
  assert.equal((await store.getItem(it.id)).collectionId, home.id);
  assert.equal(await store.getCollection(clothing.id), null);
});

test('reorderCollections puts listed ids first', async () => {
  const { store } = await fresh();
  const cols = await store.getCollections();
  await store.reorderCollections([cols[2].id]);
  assert.equal((await store.getCollections())[0].id, cols[2].id);
});

test('export never contains the API key or the AI log', async () => {
  const { store } = await fresh();
  await store.setSecret('aiApiKey', 'sk-test-SECRET');
  await store.appendAiLog([{ id: 'l1', itemId: 'x', changes: [] }]);
  await store.addItem({ title: 'Lamp', url: 'https://a.example/1' });
  const exp = await store.exportJSON();
  const text = JSON.stringify(exp);
  assert.equal(exp.format, 'keepsake-export');
  assert.equal(exp.schemaVersion, SCHEMA_VERSION);
  assert.ok(!text.includes('sk-test-SECRET'));
  assert.ok(!text.includes(KEYS.secrets));
  assert.ok(!('aiLog' in exp));
  assert.equal(await store.getSecret('aiApiKey'), 'sk-test-SECRET');
});

test('import merge: dedupes collections by name and items by URL, reports counts', async () => {
  const src = await fresh();
  await src.store.addItem({ title: 'Lamp', url: 'https://a.example/lamp' });
  await src.store.createCollection({ name: 'Ramen spots' });
  const exp = await src.store.exportJSON();

  const dst = await fresh();
  await dst.store.addItem({ title: 'Lamp again', url: 'https://a.example/lamp?utm_source=x' });
  const r = await dst.store.importJSON(exp, { mode: 'merge' });
  assert.equal(r.skippedItems, 1);
  assert.equal(r.addedItems, 0);
  assert.equal(r.addedCollections, 1);
  assert.ok((await dst.store.getCollections()).some((c) => c.name === 'Ramen spots'));
});

test('import replace wipes existing items and keeps the API key', async () => {
  const src = await fresh();
  await src.store.addItem({ title: 'From backup', url: 'https://a.example/b' });
  const exp = await src.store.exportJSON();
  const dst = await fresh();
  await dst.store.setSecret('aiApiKey', 'keep-me');
  await dst.store.addItem({ title: 'Current', url: 'https://a.example/c' });
  await dst.store.importJSON(exp, { mode: 'replace' });
  const titles = (await dst.store.getItems()).map((i) => i.title);
  assert.deepEqual(titles, ['From backup']);
  assert.equal(await dst.store.getSecret('aiApiKey'), 'keep-me');
});

test('validateExport rejects foreign or future files', () => {
  assert.throws(() => validateExport(null), /not a Keepsake export/);
  assert.throws(() => validateExport({ format: 'other' }), /missing format marker/);
  assert.throws(() => validateExport({ format: 'keepsake-export', schemaVersion: SCHEMA_VERSION + 1 }), /Unsupported export version/);
  assert.throws(() => validateExport({ format: 'keepsake-export', schemaVersion: 0 }), /Unsupported/);
});

test('validateExport sanitizes hostile content', () => {
  const v = validateExport({
    format: 'keepsake-export', schemaVersion: 2,
    collections: { x: { id: '../../evil', name: '<img src=x onerror=alert(1)>'.repeat(5), keywords: ['A'], color: 'red;background:url(x)' } },
    items: {
      a: { id: 'ok_id_1', title: 'Fine', url: 'javascript:alert(1)', image: 'data:text/html,<script>', price: 'NaN' },
      b: { id: 'ok_id_2', title: 'Untitled item' },
      c: 'not an object',
      d: { id: 'ok_id_3', title: 'Huge', image: 'data:image/png;base64,' + 'A'.repeat(LIMITS.maxImageBytes * 2) },
    },
    settings: { apiKey: 'should-not-survive', theme: 'dark' },
    prefs: { learnedKeywords: { tent: { c1: 999 } }, confidenceThreshold: 7 },
  });
  const col = Object.values(v.collections)[0];
  assert.notEqual(col.id, '../../evil');
  assert.ok(col.name.length <= 80);
  assert.equal(col.color, '#8A9A88');
  assert.equal(col.keywords[0], 'a');
  const items = Object.values(v.items);
  assert.equal(items.length, 2, 'the empty item and the non-object are dropped');
  const fine = items.find((i) => i.title === 'Fine');
  assert.equal(fine.url, '');
  assert.equal(fine.price, null);
  assert.equal(items.find((i) => i.title === 'Huge').image, '');
  assert.equal(v.settings.apiKey, undefined);
  assert.equal(v.prefs.learnedKeywords.tent.c1, 6, 'learned weights are capped');
  assert.equal(v.prefs.confidenceThreshold, 0.95, 'threshold is clamped');
});

test('validateExport enforces item and collection limits', () => {
  const items = {};
  for (let i = 0; i <= LIMITS.maxItems; i++) items[i] = {};
  assert.throws(() => validateExport({ format: 'keepsake-export', schemaVersion: 2, items }), /Too many items/);
});

test('migration 1 -> 2 folds rules into collection keywords', () => {
  const out = migrate({
    [KEYS.meta]: { schemaVersion: 1 },
    [KEYS.collections]: { c1: { id: 'c1', name: 'Gifts', keywords: ['mug'] } },
    [KEYS.prefs]: { rules: [{ collectionId: 'c1', keywords: ['For Mum', 'mug'] }], confidenceThreshold: 0.7 },
  });
  assert.equal(out[KEYS.meta].schemaVersion, 2);
  assert.deepEqual(out[KEYS.collections].c1.keywords, ['mug', 'for mum']);
  assert.equal(out[KEYS.prefs].rules, undefined);
  assert.equal(out[KEYS.prefs].confidenceThreshold, 0.7);
});

test('a v1 export with rules imports into v2 keywords', async () => {
  const { store } = await fresh();
  await store.importJSON({
    format: 'keepsake-export', schemaVersion: 1,
    collections: { gifts1: { id: 'gifts1', name: 'Gifts' } },
    items: {},
    prefs: { rules: [{ collectionId: 'gifts1', keywords: ['Birthday'] }] },
  });
  const gifts = (await store.getCollections()).find((c) => c.name === 'Gifts');
  assert.ok(gifts.keywords.includes('birthday'));
});

test('init upgrades old per-feature AI settings to the single switch', async () => {
  const { store } = await fresh({ [KEYS.meta]: { schemaVersion: 2 }, [KEYS.settings]: { ai: { enabled: true, instantSave: true, useForCategorization: true, provider: 'anthropic' } } });
  const s = await store.getSettings();
  assert.equal(s.ai.on, true);
  assert.equal(s.ai.provider, 'anthropic');
  assert.equal(s.ai.instantSave, undefined);
});

test('Instagram import history: trashed posts stay remembered; deleting forever frees the post', async () => {
  const { store } = await fresh();
  const it = await store.addItem({ title: 'Post', url: 'https://www.instagram.com/p/AbCdE1/', type: 'instagram' });
  await store.markImported([['https://www.instagram.com/someone/p/AbCdE1/?igsh=x', it.id]]);
  assert.equal(await store.importedItemIdFor('https://www.instagram.com/p/AbCdE1/'), it.id);
  await store.deleteItems([it.id]);
  assert.equal(await store.importedItemIdFor('https://www.instagram.com/p/AbCdE1/'), it.id, 'restorable, so a re-scan does not duplicate it');
  await store.deleteForever([it.id]);
  assert.equal(await store.importedItemIdFor('https://www.instagram.com/p/AbCdE1/'), null);
  await store.clearImportHistory();
  assert.deepEqual((await store.getImportHistory()).instagram, {});
});

test('AI log: append, mark undone, capped at 3000', async () => {
  const { store } = await fresh();
  await store.appendAiLog(Array.from({ length: 3005 }, (_, i) => ({ id: `e${i}`, itemId: 'x', changes: [] })));
  const log = await store.getAiLog();
  assert.equal(log.length, 3000);
  assert.equal(log[0].id, 'e5');
  await store.markAiLogUndone(['e10']);
  assert.equal((await store.getAiLog()).find((e) => e.id === 'e10').undone, true);
});

test('clearAll removes every Keepsake key and record, including the secret, the AI log and the v2 copy', async () => {
  const { store, be, db } = await fresh({ [KEYS.items]: { a1b2: { id: 'a1b2', title: 'old' } } });
  await store.setSecret('aiApiKey', 'x');
  await store.appendAiLog([{ id: 'a' }]);
  await store.clearAll();
  assert.deepEqual(Object.keys(await be.get(null)), []);
  for (const s of ['items', 'collections', 'kv']) assert.equal(await db.count(s), 0);
});

test('sample data loads into the right collections and leaves one item in Review', async () => {
  const { store } = await fresh();
  const n = await store.loadSampleData();
  const items = await store.getItems();
  assert.equal(items.length, n);
  assert.equal(items.filter((i) => i.needsReview).length, 1);
  // Every Lifestyle view has something in it, outside the collections, and the places have pins for the map.
  const lifestyle = items.filter((i) => i.kind !== 'product' && i.kind !== 'link');
  assert.deepEqual([...new Set(lifestyle.map((i) => i.kind))].sort(), ['article', 'book', 'media', 'place', 'recipe', 'video', 'workout']);
  assert.ok(lifestyle.every((i) => i.collectionId === null && !i.needsReview && i.categorizationSource === 'sample'));
  assert.ok(items.filter((i) => i.kind === 'place').every((i) => Number.isFinite(i.details.lat) && Number.isFinite(i.details.lng) && i.details.locality === 'Seattle'));
  assert.ok(items.find((i) => i.kind === 'recipe').details.ingredients.length > 0);
  assert.ok(items.find((i) => i.kind === 'workout').details.exercises.length > 0);
});

test('item limit is enforced', async () => {
  const { store, db } = await fresh();
  await db.put('items', Array.from({ length: LIMITS.maxItems }, (_, i) => makeItem({ id: `item${i}`, title: `t${i}` })));
  await assert.rejects(store.addItem({ title: 'one too many' }), /Item limit reached/);
});

test('writes from one store instance are serialized', async () => {
  const { store } = await fresh();
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.addItem({ title: `t${i}`, url: `https://a.example/${i}` })));
  assert.equal((await store.getItems()).length, 25);
});

test('two store instances writing at once both land (fixes audit A5)', async () => {
  // Popup, dashboard and worker each create their own store over the same storage.
  const be = memoryBackend();
  const db = makeDb();
  const a = createStore(be, db);
  const b = createStore(be, db);
  await a.init();
  await Promise.all([
    a.addItem({ title: 'from popup', url: 'https://a.example/1' }),
    b.addItem({ title: 'from dashboard', url: 'https://a.example/2' }),
    ...Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).addItem({ title: `burst ${i}`, url: `https://a.example/b${i}` })),
  ]);
  assert.equal((await a.getItems()).length, 12);
});

test('concurrent edits to different fields of one item from two contexts both survive', async () => {
  const be = memoryBackend();
  const db = makeDb();
  const a = createStore(be, db);
  const b = createStore(be, db);
  await a.init();
  const it = await a.addItem({ title: 'Lamp', url: 'https://a.example/1' });
  await Promise.all([a.updateItem(it.id, { note: 'n' }), b.updateItem(it.id, { favorite: true })]);
  const got = await a.getItem(it.id);
  assert.equal(got.note, 'n');
  assert.equal(got.favorite, true);
});

// --- schema 3 ------------------------------------------------------------------------------------

function v2Library() {
  return {
    [KEYS.meta]: { schemaVersion: 2, installedAt: '2026-09-01T00:00:00.000Z' },
    [KEYS.collections]: { colA1: { id: 'colA1', name: 'Kitchen', keywords: ['pan'], sortOrder: 1 } },
    [KEYS.items]: {
      itm001: { id: 'itm001', title: 'Dutch oven', url: 'https://shop.example/oven', collectionId: 'colA1', createdAt: '2026-09-02T00:00:00.000Z', image: 'data:image/jpeg;base64,QUJD' },
      itm002: { id: 'itm002', title: 'Post', url: 'https://www.instagram.com/p/AbCdE1/', type: 'instagram', collectionId: null, needsReview: true, createdAt: '2026-09-03T00:00:00.000Z' },
    },
    [KEYS.prefs]: { confidenceThreshold: 0.7, learnedKeywords: { oven: { colA1: 2 } }, retailerPrefs: {}, corrections: [] },
    [KEYS.importHistory]: { instagram: { 'instagram.com/p/AbCdE1': 'itm002' } },
    keepsake_aiLog: [{ id: 'log1', itemId: 'itm001', changes: [] }],
    [KEYS.settings]: { theme: 'dark' },
    [KEYS.secrets]: { aiApiKey: 'keep-me' },
  };
}

test('migration v2 -> v3 copies every save, collection, preference, history and log entry', async () => {
  const { store, be, migrated } = await fresh(v2Library());
  assert.deepEqual(migrated, { items: 2, collections: 1 });
  const all = await store.getAll();
  assert.equal(all.meta.schemaVersion, 3);
  assert.equal(all.items.itm001.title, 'Dutch oven');
  assert.equal(all.items.itm001.originalTitle, 'Dutch oven');
  assert.equal(all.items.itm001.captureState, 'complete');
  assert.equal(all.items.itm001.image, 'data:image/jpeg;base64,QUJD');
  assert.equal(all.items.itm002.needsReview, true);
  assert.equal(all.collections.colA1.name, 'Kitchen');
  assert.equal(all.prefs.confidenceThreshold, 0.7);
  assert.equal(all.prefs.learnedKeywords.oven.colA1, 2);
  assert.equal(all.settings.theme, 'dark');
  assert.equal(await store.getSecret('aiApiKey'), 'keep-me');
  assert.equal(await store.importedItemIdFor('https://www.instagram.com/p/AbCdE1/'), 'itm002');
  assert.equal((await store.getAiLog())[0].id, 'log1');
  // The v2 copy is left in place for rollback.
  const raw = await be.get(null);
  assert.ok(raw[KEYS.items].itm001);
});

test('migration runs once; later edits are not overwritten by a second init', async () => {
  const { store, be, db } = await fresh(v2Library());
  await store.updateItem('itm001', { title: 'Edited after migration' });
  const again = createStore(be, db);
  const r = await again.init();
  assert.equal(r.migrated, null);
  assert.equal((await again.getItem('itm001')).title, 'Edited after migration');
});

test('an older Keepsake saving after the upgrade (rollback or stale worker): its saves are caught up, nothing newer is overwritten', async () => {
  const { store, be, db } = await fresh(v2Library());
  await store.updateItem('itm001', { title: 'Edited in 1.4' });
  await store.deleteForever(['itm002']);
  // A 1.3.1 worker writes a new save into the v2 keys and resets the schema number, as its init does.
  const raw = await be.get(null);
  const later = new Date(Date.now() + 1000).toISOString();
  await be.set({
    [KEYS.items]: { ...raw[KEYS.items], hoodie1: { id: 'hoodie1', title: 'The Shevlin Double-Layer Hoodie', url: 'https://bruntworkwear.example/hoodie', collectionId: 'gone99', createdAt: later } },
    [KEYS.meta]: { ...raw[KEYS.meta], schemaVersion: 2 },
  });
  const again = createStore(be, db);
  const r = await again.init();
  assert.deepEqual(r.caughtUp, { items: 1, collections: 0 });
  const hoodie = await again.getItem('hoodie1');
  assert.equal(hoodie.title, 'The Shevlin Double-Layer Hoodie');
  assert.equal(hoodie.collectionId, null, 'a collection that no longer exists sends it to Review');
  assert.equal(hoodie.needsReview, true);
  assert.equal((await again.getItem('itm001')).title, 'Edited in 1.4', 'the v2 copy did not overwrite a newer edit');
  assert.equal(await again.getItem('itm002'), null, 'deleted for good stays deleted');
  assert.equal((await be.get(KEYS.meta))[KEYS.meta].schemaVersion, 3);
  const third = await createStore(be, db).init();
  assert.equal(third.caughtUp, null, 'catching up happens once');
});

test('a v1 library (rules) migrates straight to v3', async () => {
  const { store } = await fresh({
    [KEYS.meta]: { schemaVersion: 1 },
    [KEYS.collections]: { g1g1: { id: 'g1g1', name: 'Gifts' } },
    [KEYS.items]: {},
    [KEYS.prefs]: { rules: [{ collectionId: 'g1g1', keywords: ['Birthday'] }] },
  });
  const gifts = (await store.getCollections()).find((c) => c.name === 'Gifts');
  assert.ok(gifts.keywords.includes('birthday'));
  assert.equal((await store.getPrefs()).rules, undefined);
});

test('trash: delete hides, restore returns, collection gone sends to Review', async () => {
  const { store } = await fresh();
  const [home] = await store.getCollections();
  const it = await store.addItem({ title: 'Lamp', url: 'https://a.example/lamp', collectionId: home.id });
  await store.deleteItems([it.id]);
  assert.equal((await store.getItems()).length, 0);
  assert.equal((await store.getAll()).items[it.id], undefined);
  assert.equal(await store.findByUrl('https://a.example/lamp'), null, 'a trashed page can be saved again');
  assert.equal((await store.getTrash()).length, 1);
  await store.restoreItems([it.id]);
  assert.equal((await store.getItem(it.id)).collectionId, home.id);
  await store.deleteItems([it.id]);
  await store.deleteCollection(home.id);
  await store.restoreItems([it.id]);
  const back = await store.getItem(it.id);
  assert.equal(back.deletedAt, null);
  assert.equal(back.collectionId, null);
  assert.equal(back.needsReview, true);
});

test('trash: purge removes only saves older than 30 days', async () => {
  const { store } = await fresh();
  const old = await store.addItem({ title: 'old', url: 'https://a.example/o' });
  const recent = await store.addItem({ title: 'recent', url: 'https://a.example/r' });
  await store.deleteItems([old.id, recent.id]);
  await store.updateItem(old.id, { deletedAt: new Date(Date.now() - (TRASH_DAYS + 1) * 864e5).toISOString() }, { by: 'machine' });
  assert.equal(await store.purgeTrash(), 1);
  assert.equal(await store.getItem(old.id), null);
  assert.ok(await store.getItem(recent.id));
});

test('trash is exported and restored by import', async () => {
  const src = await fresh();
  const it = await src.store.addItem({ title: 'Binned', url: 'https://a.example/b' });
  await src.store.deleteItems([it.id]);
  const exp = await src.store.exportJSON();
  assert.equal(exp.schemaVersion, 3);
  assert.ok(exp.items[it.id].deletedAt);
  const dst = await fresh();
  await dst.store.importJSON(exp);
  assert.equal((await dst.store.getTrash())[0].id, it.id);
});

test('hand-edited fields are recorded; machine edits are not', async () => {
  const { store } = await fresh();
  const it = await store.addItem({ title: 'tent', url: 'https://a.example/t' });
  const a = await store.updateItem(it.id, { title: 'Ultralight tent', favorite: true });
  assert.deepEqual(a.userFields, ['title']);
  assert.equal(a.originalTitle, 'tent');
  const b = await store.updateItem(it.id, { price: 99 }, { by: 'ai' });
  assert.deepEqual(b.userFields, ['title']);
  const [home] = await store.getCollections();
  await store.moveItems([it.id], home.id);
  assert.ok((await store.getItem(it.id)).userFields.includes('collectionId'));
});

test('pending saves are listed until finished', async () => {
  const { store } = await fresh();
  const it = await store.addItem({ title: 'x', url: 'https://a.example/x', captureState: 'pending' });
  assert.deepEqual((await store.getPendingItems()).map((i) => i.id), [it.id]);
  await store.updateItem(it.id, { captureState: 'complete' }, { by: 'machine' });
  assert.equal((await store.getPendingItems()).length, 0);
});

test('a full disk gives a clear error and loses nothing already saved', async () => {
  const db = memoryRecordBackend();
  const { store } = await fresh(undefined, db);
  const kept = await store.addItem({ title: 'kept', url: 'https://a.example/k' });
  db.setFailWrites(() => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' }));
  await assert.rejects(store.addItem({ title: 'new', url: 'https://a.example/n' }), (e) => e instanceof StorageFullError && /out of space/.test(e.message) && /Nothing already saved was lost/.test(e.message));
  db.setFailWrites(null);
  assert.equal((await store.getItem(kept.id)).title, 'kept');
});

test('changes are announced to listeners', async () => {
  const { store } = await fresh();
  const seen = [];
  const off = store.onChanged((c) => seen.push(Object.keys(c)));
  await store.addItem({ title: 'x', url: 'https://a.example/x' });
  off();
  assert.ok(seen.some((k) => k.includes('keepsake_items')));
});

test('an Instagram post keeps its location tag (bounded, a pin only with both real coordinates); older saves without one are unchanged', async () => {
  const { store } = await fresh();
  const a = await store.addItem({ type: 'instagram', title: 't', url: 'https://www.instagram.com/p/TAG1/', instagram: { caption: 'c', location: 'Example Pizza',
    place: { name: 'Example Pizza', address: '7 Carmine St', city: 'New York, New York', lat: 40.7305, lng: -74.0021, extra: 'dropped' } } });
  assert.deepEqual(a.instagram.place, { name: 'Example Pizza', address: '7 Carmine St', city: 'New York, New York', region: '', postalCode: '', lat: 40.7305, lng: -74.0021 });
  const b = await store.addItem({ type: 'instagram', title: 't', url: 'https://www.instagram.com/p/TAG2/', instagram: { caption: 'c', place: { name: 'X', lat: 0, lng: 0 } } });
  assert.deepEqual([b.instagram.place.lat, b.instagram.place.lng], [null, null]);
  const c = await store.addItem({ type: 'instagram', title: 't', url: 'https://www.instagram.com/p/TAG3/', instagram: { caption: 'c' } });
  assert.equal(c.instagram.place, null);
});

for (const [kind, factory] of Object.entries(KINDS)) {
  describe(`storage on ${kind}`, () => {
    for (const [name, fn] of tests) {
      nodeTest(name, async () => {
        makeDb = factory;
        await fn();
      });
    }
  });
}
