// The sorter learns from every collection choice: moves and picks (clear lessons) and suggestions you
// kept (quiet ones). These tests replay a person filing saves and check the sorter gets better at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, emptyPrefs, learnFromCorrection, learnFromConfirmation, learnFromSaves } from '../keepsake/src/shared/categorizer.js';
import { createStore, memoryBackend, memoryRecordBackend, makeCollection } from '../keepsake/src/shared/storage.js';
import { saveCapture } from '../keepsake/src/shared/capture.js';

// Collections a person made for how they shop, with no keywords typed in: the built-in words
// don't know "Coffee setup" from Kitchen, or that their "Desk" is where lamps and chairs go.
const coffee = makeCollection({ name: 'Coffee setup' });
const camp = makeCollection({ name: 'Trip prep' });
const desk = makeCollection({ name: 'Desk' });
const clothes = makeCollection({ name: 'Wardrobe' });
const collections = [coffee, camp, desk, clothes];

const TRAIN = [
  ['Hario V60 ceramic pour over dripper', coffee], ['Fellow Stagg gooseneck kettle', coffee],
  ['Baratza Encore burr grinder', coffee], ['Chemex pour over glass coffeemaker', coffee],
  ['Acaia Pearl coffee scale', coffee], ['AeroPress espresso maker', coffee], ['Paper filters for V60 dripper', coffee],
  ['Ultralight backpacking tent 2 person', camp], ['Down sleeping bag 20 degree', camp],
  ['Titanium camp stove', camp], ['Headlamp rechargeable 400 lumen', camp], ['Trekking poles carbon', camp],
  ['Inflatable sleeping pad', camp], ['Water filter for backpacking', camp],
  ['Ergonomic office chair mesh', desk], ['LED desk lamp with USB port', desk], ['Standing desk converter', desk],
  ['Monitor arm dual', desk], ['Wool felt desk mat', desk], ['Mechanical keyboard tenkeyless', desk], ['Cable tray under desk', desk],
  ['Merino wool crew sweater', clothes], ['Selvedge denim jeans slim', clothes], ['Oxford button down shirt', clothes],
  ['Waxed canvas field jacket', clothes], ['Leather chelsea boots', clothes], ['Linen camp collar shirt', clothes], ['Wool overshirt', clothes],
];
// Different saves of the same sorts of things, never trained on.
const HELD_OUT = [
  ['Kalita Wave pour over dripper 185', coffee], ['Electric gooseneck kettle with temperature control', coffee],
  ['Comandante hand burr grinder', coffee], ['Espresso scale with timer', coffee], ['Chemex bonded filters', coffee],
  ['Freestanding backpacking tent', camp], ['Synthetic sleeping bag', camp], ['Camp stove fuel canister', camp],
  ['Headlamp waterproof', camp], ['Ultralight sleeping pad', camp],
  ['Mesh office chair with lumbar support', desk], ['Desk lamp architect', desk], ['Monitor arm single', desk],
  ['Desk mat leather', desk], ['Low profile mechanical keyboard', desk],
  ['Cashmere crew sweater', clothes], ['Raw denim jeans straight', clothes], ['Flannel button down shirt', clothes],
  ['Chore jacket canvas', clothes], ['Suede chelsea boots', clothes],
];

const product = ([title], i) => ({ id: `p${i}`, title, host: 'shop.example' });
const right = (prefs, set) => set.filter((row, i) => classify(product(row, i), { collections, prefs }).collectionId === row[1].id).length / set.length;

// A person going through saves: where the sorter got it right they keep it (a quiet lesson), where it
// didn't they move it (a clear one, from wherever it went: Review or the wrong collection).
function file(prefs, rows) {
  return rows.reduce((p, row, i) => {
    const got = classify(product(row, i), { collections, prefs: p });
    return got.collectionId === row[1].id ? learnFromConfirmation(product(row, i), row[1].id, p) : learnFromCorrection(product(row, i), got.collectionId, row[1].id, p);
  }, prefs);
}

test('sorting gets better as you file: held-out saves land right far more often', () => {
  const before = right(emptyPrefs(), HELD_OUT);
  const half = file(emptyPrefs(), TRAIN.filter((_, i) => i % 2 === 0));
  const all = file(emptyPrefs(), TRAIN);
  const mid = right(half, HELD_OUT);
  const after = right(all, HELD_OUT);
  console.log(`held-out accuracy: ${Math.round(before * 100)}% → ${Math.round(mid * 100)}% (half the saves filed) → ${Math.round(after * 100)}% (all)`);
  assert.ok(before <= 0.5, `starts poor on collections it knows nothing about (${before})`);
  assert.ok(mid > before, 'better after some choices');
  assert.ok(after >= mid, 'and better still after more');
  assert.ok(after >= 0.8, `files most new saves right after ${TRAIN.length} choices (${after})`);
});

test('kept suggestions teach too: filing the same saves again with every one kept keeps it right', () => {
  const learned = file(emptyPrefs(), TRAIN);
  const again = file(learned, TRAIN);
  assert.equal(right(again, TRAIN), 1, 'every save it was taught lands where you put it');
  assert.ok(right(again, HELD_OUT) >= right(learned, HELD_OUT), 'confirming never makes it worse');
});

test('kept suggestions are quiet: one move outweighs a kept suggestion, and moving it back takes it back', () => {
  const item = { title: 'Enamel camp mug', host: 'mugs.example' };
  const kept = learnFromConfirmation(item, camp.id, emptyPrefs());
  const moved = learnFromCorrection(item, null, camp.id, emptyPrefs());
  assert.ok(kept.learnedKeywords.mug[camp.id] < moved.learnedKeywords.mug[camp.id]);
  assert.equal(kept.corrections.length, 0, 'the move log lists moves only');
  // Kept in Trip prep, later moved to Coffee setup: Trip prep's pull is gone, Coffee's is there.
  const undone = learnFromCorrection(item, camp.id, coffee.id, kept);
  assert.equal(undone.learnedKeywords.mug[camp.id], undefined);
  assert.ok(undone.learnedKeywords.mug[coffee.id] > 0);
  assert.equal(undone.retailerPrefs['mugs.example'][camp.id], undefined);
});

test('a word you file everywhere does not drag saves anywhere; a word you file in one place does', () => {
  let p = emptyPrefs();
  // "black" turns up in every collection; "espresso" only in Coffee setup.
  for (const [title, col] of [['Black wool sweater', clothes], ['Black desk lamp', desk], ['Black camp chair', camp], ['Black kettle', coffee], ['Black espresso cups', coffee]]) {
    p = learnFromCorrection({ title }, null, col.id, p);
  }
  assert.equal(classify({ title: 'Black' }, { collections, prefs: p }).isInbox, true, 'one everyday word decides nothing');
  const tamper = classify({ title: 'Espresso tamper' }, { collections, prefs: p });
  assert.equal(tamper.collectionId || tamper.suggested?.collectionId, coffee.id);
});

test('a shop you file everywhere counts for less than one you file in one place', () => {
  let p = emptyPrefs();
  const at = (host, col, n) => { for (let i = 0; i < n; i++) p = learnFromCorrection({ title: `thing ${host} ${i}`, host }, null, col.id, p); };
  at('everything.example', desk, 3); at('everything.example', clothes, 3); at('everything.example', camp, 3);
  at('outfitter.example', camp, 3);
  const score = (host) => classify({ title: 'Gift card', host }, { collections, prefs: p }).alternatives.find((a) => a.collectionId === camp.id)?.score || 0;
  assert.ok(score('outfitter.example') > score('everything.example'));
});

async function freshStore() {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.init();
  return store;
}

test('store.confirmFiling learns once per save, and never for a save you moved', async () => {
  const store = await freshStore();
  const { collection: col } = await store.createCollection({ name: 'Coffee setup' });
  const a = await store.addItem({ title: 'Gooseneck kettle', url: 'https://a.example/k', collectionId: col.id, categorizationSource: 'local' });
  assert.equal(await store.confirmFiling(a.id), true);
  const once = (await store.getPrefs()).learnedKeywords;
  assert.ok(Object.values(once).some((e) => e[col.id] > 0));
  assert.equal(await store.confirmFiling(a.id), false, 'a second Done teaches nothing more');
  assert.deepEqual((await store.getPrefs()).learnedKeywords, once);
  const { collection: other } = await store.createCollection({ name: 'Trip prep' });
  const b = await store.addItem({ title: 'Camp stove', url: 'https://a.example/s', collectionId: col.id, categorizationSource: 'local' });
  await store.moveItems([b.id], other.id);
  const afterMove = (await store.getPrefs()).learnedKeywords;
  assert.equal(await store.confirmFiling(b.id), false, 'the move already taught it');
  assert.deepEqual((await store.getPrefs()).learnedKeywords, afterMove);
  const review = await store.addItem({ title: 'Mystery thing', url: 'https://a.example/m', collectionId: null });
  assert.equal(await store.confirmFiling(review.id), false, 'nothing to learn from a save left in Review');
});

test('saving where the toolbar suggested teaches the sorter; an instant save nobody looked at does not', async () => {
  const store = await freshStore();
  const { collection: col } = await store.createCollection({ name: 'Coffee setup', keywords: ['stagg'] });
  const shown = await saveCapture(store, { title: 'Fellow Stagg EKG', url: 'https://shop.example/stagg' }, { confirmed: true });
  assert.equal(shown.item.collectionId, col.id);
  const learned = (await store.getPrefs()).learnedKeywords;
  assert.ok(Object.values(learned).some((e) => e[col.id] > 0), 'kept suggestion learned');
  assert.equal((await store.getItem(shown.item.id)).filingConfirmed, true);
  const before = JSON.stringify((await store.getPrefs()).learnedKeywords);
  await saveCapture(store, { title: 'Stagg pour over set', url: 'https://shop.example/electric' }, { instant: true });
  assert.equal(JSON.stringify((await store.getPrefs()).learnedKeywords), before);
});

test('learnFromSaves is the same as keeping each save where it is, one by one', () => {
  const saves = TRAIN.map(([title, col], i) => ({ id: `s${i}`, title, host: 'shop.example', collectionId: col.id }));
  const oneByOne = saves.reduce((p, s) => learnFromConfirmation(s, s.collectionId, p), emptyPrefs());
  const together = learnFromSaves(saves, emptyPrefs());
  assert.deepEqual(together.learnedKeywords, oneByOne.learnedKeywords);
  assert.deepEqual(together.retailerPrefs, oneByOne.retailerPrefs);
  assert.ok(right(together, HELD_OUT) > right(emptyPrefs(), HELD_OUT), 'a filed library teaches it before any new choice');
});

test('store.learnFromLibrary teaches from what you already filed, once, skipping moves, Review and samples', async () => {
  const store = await freshStore();
  const { collection: trip } = await store.createCollection({ name: 'Trip prep' });
  const add = (title, extra = {}) => store.addItem({ title, url: `https://shop.example/${encodeURIComponent(title)}`, collectionId: trip.id, ...extra });
  await add('Titanium camp stove');
  await add('Folding camp stove');
  await add('Camp stove windscreen');
  await add('Moved lantern', { categorizationSource: 'manual' });
  await add('Sample tarp', { categorizationSource: 'sample' });
  await store.addItem({ title: 'Mystery stove thing', url: 'https://shop.example/m', collectionId: null, needsReview: true });
  assert.equal(await store.learnFromLibrary(), 3);
  const learned = (await store.getPrefs()).learnedKeywords;
  assert.equal(learned['camp stove'][trip.id], 1.5);
  assert.equal(learned.lantern, undefined, 'a moved save taught it when it was moved');
  assert.equal(learned.tarp, undefined, 'samples are not yours');
  assert.equal(await store.learnFromLibrary(), 0, 'only once');
  assert.deepEqual((await store.getPrefs()).learnedKeywords, learned);
  const next = await saveCapture(store, { title: 'Camp stove pot set', url: 'https://shop.example/pot' }, { instant: true });
  assert.equal(next.item.collectionId || next.classification.suggested?.collectionId, trip.id, 'the next stove goes with the others (or is suggested there)');
});

test('your keyword beats a collection you do not have yet', async () => {
  const kept = makeCollection({ name: 'Coffee setup', keywords: ['stagg'] });
  const r = classify({ title: 'Stagg gooseneck kettle' }, { collections: [kept], prefs: emptyPrefs() });
  assert.equal(r.collectionId, kept.id);
  assert.ok(r.confidence >= 0.85);
  // With no keyword of yours in play, a new Kitchen is still suggested.
  assert.equal(classify({ title: 'Gooseneck kettle' }, { collections: [kept], prefs: emptyPrefs() }).collectionName, 'Kitchen');
});

// --- learning kinds and skipping everyday words (QA 2026-10-30) ---------------------------------
import { learnedKindOf, learnKindFromCorrection, salientTerms } from '../keepsake/src/shared/categorizer.js';

const igPost = (caption, extra = {}) => ({ isInstagram: true, host: 'www.instagram.com', url: 'https://www.instagram.com/reel/x/', title: caption.split('\n')[0], description: caption, instagram: { caption, hashtags: [...caption.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase()) }, ...extra });

test('everyday words and post boilerplate are never learned; hashtags are', () => {
  const terms = salientTerms(igPost('What do you think of this reel? Comment below #vanlife #roadtrip'));
  for (const w of ['what', 'you', 'think', 'reel', 'comment']) assert.ok(!terms.includes(w), w);
  assert.ok(terms.includes('vanlife') && terms.includes('roadtrip'));
});

test('posts you keep as Workouts teach the kind; a new post like them becomes one, others stay links', () => {
  const saves = [
    'Ankle stability drill most people fail #mobility #fascia', 'Fix your posture with this fascia release #mobility',
    'Hip mobility for desk workers #mobility #fascia', 'Your fascia and tendons lose their spring #mobility',
  ].map((c) => ({ ...igPost(c), kind: 'workout' }));
  const links = ['Funniest dog compilation #dogs', 'My dog hates the vacuum #dogs'].map((c) => ({ ...igPost(c), kind: 'link', collectionId: 'funny' }));
  const prefs = learnFromSaves([...saves, ...links], emptyPrefs());
  assert.equal(learnedKindOf(igPost('Knee pain when skiing? It starts in your fascia #mobility'), prefs)?.kind, 'workout');
  assert.equal(learnedKindOf(igPost('My dog learned to open the fridge #dogs'), prefs), null);
  // A web page says what it is: never re-kinded from posts.
  assert.equal(learnedKindOf({ title: 'Fascia and mobility explained', url: 'https://example.com/a', host: 'example.com' }, prefs), null);
});

test('a kind you change teaches it; changing it back unteaches it', () => {
  const p = igPost('Pecking House fried chicken, NYC #nycfood #friedchicken');
  let prefs = learnKindFromCorrection(p, 'link', 'place', emptyPrefs());
  assert.equal(learnedKindOf(igPost('Best fried chicken in NYC #nycfood #friedchicken'), prefs)?.kind, 'place');
  prefs = learnKindFromCorrection(p, 'place', 'link', learnKindFromCorrection(p, 'place', 'link', prefs));
  assert.equal(learnedKindOf(igPost('Best fried chicken in NYC #nycfood #friedchicken'), prefs), null);
});

test('saving a post: the learned kind files it, a recipe the rules read is never overridden', async () => {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.init();
  const prefs = learnFromSaves(['Ankle stability drill #mobility #fascia', 'Fascia release for posture #mobility #fascia', 'Hip mobility flow #mobility #fascia'].map((c) => ({ ...igPost(c), kind: 'workout' })), await store.getPrefs());
  await store.setPrefs(prefs);
  const a = await saveCapture(store, igPost('Why your fascia is tight in the morning #mobility'), { source: 'share-sheet', instant: true });
  assert.equal(a.item.kind, 'workout');
  assert.match(a.item.categorizationReason, /learned/);
  const b = await saveCapture(store, igPost('Fascia-friendly smoothie #mobility\nIngredients:\n1 banana\n1 cup oat milk\n1 tbsp chia seeds\nBlend.', { url: 'https://www.instagram.com/reel/y/' }), { source: 'share-sheet', instant: true });
  assert.equal(b.item.kind, 'recipe');
});

test('updateItem with a new kind teaches the sorter; learnFromLibrary learns kinds once, even after collections', async () => {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.init();
  const r = await saveCapture(store, igPost('Pecking House fried chicken #nycfood #friedchicken'), { source: 'share-sheet', instant: true });
  await store.updateItem(r.item.id, { kind: 'place' });
  assert.equal(learnedKindOf(igPost('Fried chicken spot #nycfood #friedchicken'), await store.getPrefs())?.kind, 'place');
  await store.setPrefs({ ...(await store.getPrefs()), learnedKinds: {}, libraryLearnedAt: '2026-10-01T00:00:00Z' });
  assert.ok((await store.learnFromLibrary()) > 0);
  assert.equal(learnedKindOf(igPost('Fried chicken spot #nycfood #friedchicken'), await store.getPrefs())?.kind, 'place');
  assert.equal(await store.learnFromLibrary(), 0);
});
