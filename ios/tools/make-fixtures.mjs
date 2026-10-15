// Fixtures for the iOS tests, made by the Chrome extension's own store code (no hand-written records):
//   chrome-export.json         a varied library exported by Chrome (every kind, Instagram, a goal with
//                              check-ins, the Trash, user-edited fields, prefs, settings)
//   chrome-reimport.json       what Chrome exports after importing chrome-export.json into an empty
//                              profile (replace): the iOS import must produce the same records
//   golden-classify.json       classify()/kindOf() answers for the same inputs, for JavaScriptCore
//
//   node ios/tools/make-fixtures.mjs [outDir]

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, memoryBackend, memoryRecordBackend } from '../../keepsake/src/shared/storage.js';
import * as categorizer from '../../keepsake/src/shared/categorizer.js';
import * as kinds from '../../keepsake/src/shared/kinds.js';
import { normalizeUrl } from '../../keepsake/src/shared/url.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, '..', 'KeepsakeKit', 'Tests', 'KeepsakeKitTests', 'Fixtures');
mkdirSync(out, { recursive: true });

const store = createStore(memoryBackend(), memoryRecordBackend());
await store.init();
const cols = await store.getCollections();
const kitchen = cols.find((c) => /kitchen/i.test(c.name));

const saves = [
  { title: 'Enameled cast iron Dutch oven 5.5 qt', url: 'https://shop.example.com/p/dutch-oven?utm_source=newsletter', price: 89.5, currency: 'USD', retailer: 'Example Shop', collectionId: kitchen?.id, note: 'wait for the sale' },
  { title: 'Café Azulejo', url: 'https://www.instagram.com/p/AbCdEf12345/', kind: 'place', details: { name: 'Café Azulejo', address: 'Rua de São Miguel', city: 'Lisbon', region: 'Lisboa', country: 'Portugal', lat: 38.7118, lng: -9.13, cuisine: 'Café' }, instagram: { caption: 'Best pastéis in Alfama 📍 Café Azulejo', creator: 'lisboa.eats', collectionName: 'Travel' } },
  { title: 'Brown butter pasta with sage', url: 'https://recipes.example.org/brown-butter-pasta', kind: 'recipe', details: { ingredients: ['350 g rigatoni', '90 g butter', '12 sage leaves'], steps: ['Boil the pasta.', 'Brown the butter.', 'Toss.'], servings: '2', totalTime: 'PT25M' } },
  { title: 'Morning mobility', url: 'https://www.instagram.com/reel/XyZ987abcde/', instagram: { caption: 'Morning mobility\n1. Hip circles 2x10\n2. World\'s greatest stretch 3x5 each side\n3. Deep squat hold 3x30s\nRest 30s between sets. Training every morning.', creator: 'move.daily' } },
  { title: 'How to fold dumplings, three ways', url: 'https://www.youtube.com/watch?v=abcdefghijk', kind: 'video', details: { channel: 'Mia Chen', durationSeconds: 480 } },
  { title: 'The case for slow cities', url: 'https://longform.example.net/slow-cities', kind: 'article', details: { author: 'R. Okafor', siteName: 'Longform', wordCount: 2900 } },
  { title: 'The Long Summer', url: 'https://letterboxd.com/film/the-long-summer/', kind: 'media', details: { year: 1998 } },
  { title: 'Notes on Gardens', url: 'https://www.goodreads.com/book/show/123-notes-on-gardens', kind: 'book', details: { author: 'M. Ilves', year: 2019 } },
  { title: 'Ramen Kiri', url: 'https://maps.apple.com/?q=Ramen%20Kiri&ll=35.6595,139.7005', kind: 'place' },
  { title: 'Linen apron, washed olive', url: 'https://fieldwork.example.com/apron', price: 48, currency: 'USD', favorite: true, purchased: true },
  { title: 'Push-up ladder', url: 'https://training.example.com/ladder', kind: 'workout', details: { exercises: [{ name: 'Push-ups', sets: 3, reps: 12, restSeconds: 60 }, { name: 'Plank', sets: 3, durationSeconds: 45 }] } },
  { title: 'Unsorted thing', url: 'https://example.com/something', needsReview: true },
];
const ids = [];
for (const s of saves) ids.push((await store.addItem(s)).id);
// A person's edit, a move, the Trash, a goal with check-ins.
await store.updateItem(ids[0], { title: 'Dutch oven (the blue one)', note: 'wait for the sale, or birthday' });
await store.deleteItems([ids[11]]);
const workout = await store.getItem(ids[3]);
let goal = null;
if (workout) {
  goal = await store.createGoal({ itemId: ids[3], kind: 'frequency', spec: { perWeek: 3, weeks: 4 } });
  await store.addCheckin(goal.id, { sets: 3, reps: 10 }, { at: '2026-10-01T08:00:00.000Z' });
  await store.addCheckin(goal.id, { note: 'felt good' }, { at: '2026-10-03T08:00:00.000Z' });
}
const exp = await store.exportJSON();
writeFileSync(join(out, 'chrome-export.json'), JSON.stringify(exp, null, 1));

const fresh = createStore(memoryBackend(), memoryRecordBackend());
await fresh.init();
await fresh.importJSON(structuredClone(exp), { mode: 'replace' });
writeFileSync(join(out, 'chrome-reimport.json'), JSON.stringify(await fresh.exportJSON(), null, 1));

const prefs = categorizer.emptyPrefs();
const golden = Object.values(exp.items).map((it) => ({
  input: { title: it.title, url: it.url, price: it.price, retailer: it.retailer },
  kindOf: kinds.kindOf({ title: it.title, url: it.url, price: it.price }),
  urlKey: normalizeUrl(it.url),
  classify: categorizer.classify({ title: it.title, url: it.url, price: it.price, retailer: it.retailer }, { collections: Object.values(exp.collections), prefs }),
}));
writeFileSync(join(out, 'golden-classify.json'), JSON.stringify(golden, null, 1));
console.log(`fixtures in ${out}: ${Object.keys(exp.items).length} items, ${Object.keys(exp.collections).length} collections, ${exp.goals.length} goals, ${exp.checkins.length} check-ins`);

// What the screens should list for the re-imported library, decided by Chrome's modules.
{
  const { needsCollection, keyFact } = await import('../../keepsake/src/shared/kinds.js');
  const { formatPrice } = await import('../../keepsake/src/shared/util.js');
  const { searchItems } = await import('../../keepsake/src/shared/search.js');
  const { placeReviewReasons, placeState } = await import('../../keepsake/src/shared/places.js');
  const items = await fresh.getItems();
  const cols = await fresh.getCollections();
  const names = new Map(cols.map((c) => [c.id, c.name]));
  const queries = ['dutch oven', 'dutch ovn', 'pasta', 'lisbon', 'nothing like this at all'];
  const views = {
    review: items.filter((i) => needsCollection(i) && !i.purchased).map((i) => i.id),
    search: Object.fromEntries(queries.map((q) => {
      const r = searchItems(items, q, (i) => names.get(i.collectionId) || '');
      return [q, { ids: r.results.map((x) => x.item.id), query: r.query, corrected: r.corrected }];
    })),
    facts: Object.fromEntries(items.map((i) => [i.id, keyFact(i, { formatPrice })])),
    places: items.filter((i) => i.kind === 'place').map((i) => ({ id: i.id, reasons: placeReviewReasons(i), state: placeState(i)?.name || null })),
  };
  writeFileSync(join(out, 'views-expected.json'), JSON.stringify(views, null, 1));
}
