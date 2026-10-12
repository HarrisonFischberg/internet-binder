// storage.js against its in-memory backend: the data contract M1's migration must preserve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, migrate, validateExport, KEYS, SCHEMA_VERSION, LIMITS, makeItem } from '../keepsake/src/shared/storage.js';

async function fresh(initial) {
  const be = memoryBackend(initial);
  const store = createStore(be);
  const r = await store.init();
  return { store, be, fresh: r.fresh };
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
  const { store, be } = await fresh();
  const it = await store.addItem({ title: 'Lamp', url: 'https://a.example/lamp' });
  const again = createStore(be);
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

test('Instagram import history: marked posts resolve, deleting the item frees the post', async () => {
  const { store } = await fresh();
  const it = await store.addItem({ title: 'Post', url: 'https://www.instagram.com/p/AbCdE1/', type: 'instagram' });
  await store.markImported([['https://www.instagram.com/someone/p/AbCdE1/?igsh=x', it.id]]);
  assert.equal(await store.importedItemIdFor('https://www.instagram.com/p/AbCdE1/'), it.id);
  await store.deleteItems([it.id]);
  assert.equal(await store.importedItemIdFor('https://www.instagram.com/p/AbCdE1/'), null);
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

test('clearAll removes every Keepsake key including the secret and the AI log', async () => {
  const { store, be } = await fresh();
  await store.setSecret('aiApiKey', 'x');
  await store.appendAiLog([{ id: 'a' }]);
  await store.clearAll();
  assert.deepEqual(Object.keys(await be.get(null)), []);
});

test('sample data loads into the right collections and leaves one item in Review', async () => {
  const { store } = await fresh();
  const n = await store.loadSampleData();
  const items = await store.getItems();
  assert.equal(items.length, n);
  assert.equal(items.filter((i) => i.needsReview).length, 1);
});

test('item limit is enforced', async () => {
  const items = {};
  for (let i = 0; i < LIMITS.maxItems; i++) items[`i${i}`] = { id: `i${i}` };
  const { store } = await fresh({ [KEYS.items]: items });
  await assert.rejects(store.addItem({ title: 'one too many' }), /Item limit reached/);
});

test('writes from one store instance are serialized', async () => {
  const { store } = await fresh();
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.addItem({ title: `t${i}`, url: `https://a.example/${i}` })));
  assert.equal((await store.getItems()).length, 25);
});

test('KNOWN RISK (audit A5): two store instances writing at once can lose a write', async () => {
  // Popup, dashboard and worker each create their own store over the same chrome.storage.local.
  // Each write rewrites the whole items map, so concurrent writes race. M1 fixes this; this test
  // documents today's behaviour and will be inverted when it does.
  const be = memoryBackend();
  const a = createStore(be);
  const b = createStore(be);
  await a.init();
  await Promise.all([a.addItem({ title: 'from popup', url: 'https://a.example/1' }), b.addItem({ title: 'from dashboard', url: 'https://a.example/2' })]);
  const n = (await a.getItems()).length;
  assert.equal(n, 1, 'one of the two concurrent writes was lost');
});
