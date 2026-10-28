// Fix with AI's shared rules (shared/aiFix.js): what Chrome's dashboard and the apps both apply and undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFixes, applyFix, undoFixes, REFILE_CONFIDENCE } from '../keepsake/src/shared/aiFix.js';
import { createStore, memoryBackend, memoryRecordBackend } from '../keepsake/src/shared/storage.js';

const product = (extra = {}) => ({ id: 'p1', type: 'product', kind: 'product', title: 'BEST Lamp!!! | Shop', price: 20, currency: 'USD', ...extra });
const ai = (extra = {}) => ({ title: 'Ceramic lamp', price: 25, currency: 'USD', collectionId: 'home', collectionName: 'Home', confidence: 0.7, reason: 'a lamp', ...extra });

test('a product gets a tidier title, the confirmed price and a collection from Review', () => {
  const { patch, changes } = planFixes(product(), ai(), { threshold: 0.6 });
  assert.equal(patch.title, 'Ceramic lamp');
  assert.equal(patch.price, 25);
  assert.equal(patch.collectionId, 'home');
  assert.equal(patch.needsReview, false);
  assert.deepEqual(changes.map((c) => c.kind), ['titles', 'prices', 'moved']);
});

test('fields you edited, a title just chosen, and a missing price stay', () => {
  const { patch } = planFixes(product({ userFields: ['price'] }), ai({ price: undefined }), { keepTitle: true });
  assert.ok(!('title' in patch));
  assert.ok(!('price' in patch));
  assert.ok(!('price' in planFixes(product(), ai({ price: null })).patch));
});

test('moving a filed save needs more certainty; your own filing is never moved; Review scope only files Review', () => {
  const filed = product({ collectionId: 'old' });
  assert.ok(!('collectionId' in planFixes(filed, ai({ confidence: 0.8 })).patch));
  const moved = planFixes(filed, ai({ confidence: REFILE_CONFIDENCE })).patch;
  assert.equal(moved.collectionId, 'home');
  assert.deepEqual(moved.previousCollections, ['old']);
  assert.ok(!('collectionId' in planFixes(product({ collectionId: 'old', categorizationSource: 'manual' }), ai({ confidence: 0.99 })).patch));
  assert.ok(!('collectionId' in planFixes(filed, ai({ confidence: 0.99 }), { scope: 'review' }).patch));
});

test('a broken picture is replaced from the live page', () => {
  const { patch } = planFixes(product({ image: 'https://x/old.jpg' }), ai(), { live: { image: 'https://x/new.jpg' }, imageOk: false });
  assert.equal(patch.image, 'https://x/new.jpg');
  assert.deepEqual(patch.images, ['https://x/new.jpg']);
});

test('apply logs what changed; undo puts it back, and a deleted collection sends it to Review', async () => {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.init();
  const col = (await store.createCollection({ name: 'Home' })).collection;
  const item = await store.addItem(product({ needsReview: true }));
  const entry = await applyFix(store, item, planFixes(item, ai({ collectionId: col.id })), { runId: 'r1', reason: 'a lamp' });
  assert.deepEqual(entry.before, { title: item.title, price: 20, currency: 'USD', collectionId: null, needsReview: true, categorizationSource: item.categorizationSource ?? null, categorizationReason: item.categorizationReason ?? null, confidence: item.confidence ?? null });
  assert.ok(entry.changes.every((c) => !('kind' in c)));
  await store.appendAiLog([entry]);
  assert.equal((await store.getItem(item.id)).title, 'Ceramic lamp');
  const n = await undoFixes(store, await store.getAiLog());
  assert.deepEqual(n, { entries: 1, items: 1 });
  assert.equal((await store.getItem(item.id)).title, item.title);
  assert.deepEqual(await undoFixes(store, await store.getAiLog()), { entries: 0, items: 0 }, 'undone entries are skipped');
});
