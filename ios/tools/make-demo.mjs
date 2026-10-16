// A demo library for trying the iOS app on a phone: every kind, real photos, places across several US
// states and abroad, a workout goal with check-ins, Review, Come back to, Trash. Made by the Chrome
// extension's own store code, so it is an ordinary Keepsake export (Import from Chrome, merge).
//
//   node ios/tools/make-demo.mjs [out.json]
//
// Photos come from Wikimedia Commons (licences listed in PHOTOS below), downscaled to 480 px with sips
// and kept inside the file as data: URLs, so nothing is fetched on the phone. Shop, recipe and article
// links are example.* addresses: this is demo data, not real listings. Places are real, with their
// public addresses.

import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createStore, memoryBackend, memoryRecordBackend } from '../../keepsake/src/shared/storage.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, '..', 'demo', 'keepsake-demo.json');

const C = 'https://upload.wikimedia.org/wikipedia/commons/thumb';
// key: 960 px thumbnail on Commons, then its licence
const PHOTOS = {
  nata: `${C}/5/5c/Pasteis_de_nata_from_Belem_%2822023386232%29.jpg/960px-Pasteis_de_nata_from_Belem_%2822023386232%29.jpg`, // CC BY-SA 2.0
  tartine: `${C}/0/0a/Tartine_bakery_exterior_in_2006.jpg/960px-Tartine_bakery_exterior_in_2006.jpg`, // CC BY 2.0
  flore: `${C}/7/7d/Cafe_de_Flore%2C_Paris_4_June_2015.jpg/960px-Cafe_de_Flore%2C_Paris_4_June_2015.jpg`, // CC BY 2.0
  katz: `${C}/1/15/Katz%27s_Deli_Exterior_Night.jpg/960px-Katz%27s_Deli_Exterior_Night.jpg`, // CC BY-SA 3.0
  franklin: `${C}/7/7f/Franklin_Barbecue_-_Austin.jpg/960px-Franklin_Barbecue_-_Austin.jpg`, // CC BY 2.0
  pike: `${C}/6/6a/Pike_Place_Market_Seattle.jpg/960px-Pike_Place_Market_Seattle.jpg`, // CC BY-SA 4.0
  carbonara: `${C}/9/93/Spaghetti_alla_Carbonara.jpg/960px-Spaghetti_alla_Carbonara.jpg`, // Public domain
  shakshuka: `${C}/2/26/Shakshuka1.jpg/960px-Shakshuka1.jpg`, // CC BY 2.0
  cake: `${C}/f/f3/Lemon_olive_oil_cake.jpg/960px-Lemon_olive_oil_cake.jpg`, // CC BY-SA 2.0
  ramen: `${C}/6/69/Ramen_Bowl_2.jpg/960px-Ramen_Bowl_2.jpg`, // CC BY 4.0
  chemex: `${C}/f/f4/Chemex_coffeemaker_with_filter.jpg/960px-Chemex_coffeemaker_with_filter.jpg`, // CC BY 4.0
  shoes: `${C}/e/e1/Brooks_Ghost_14_GTX.jpg/960px-Brooks_Ghost_14_GTX.jpg`, // CC BY-SA 4.0
  mugs: `${C}/0/07/02024_1733_ceramic_mugs.jpg/960px-02024_1733_ceramic_mugs.jpg`, // CC BY-SA 4.0
  chair: `${C}/6/60/LCW_%28Lounge_Chair_Wood%29_Chair_by_Charles_and_Ray_Eames%2C_Honolulu_Museum_of_Art_4410.1.JPG/960px-LCW_%28Lounge_Chair_Wood%29_Chair_by_Charles_and_Ray_Eames%2C_Honolulu_Museum_of_Art_4410.1.JPG`, // CC0
  lamp: `${C}/0/00/Christian-dell_molitor-office-work-lamp-light.jpg/960px-Christian-dell_molitor-office-work-lamp-light.jpg`, // CC BY-SA 3.0
  kettlebell: `${C}/8/87/Kettlebell_truebalance_romeike.jpg/960px-Kettlebell_truebalance_romeike.jpg`, // CC BY-SA 2.5
  bridge: `${C}/d/d3/Golden_Gate_Bridge_at_sunset_1.jpg/960px-Golden_Gate_Bridge_at_sunset_1.jpg`, // CC BY-SA 3.0
};

const TALL = new Set(['chemex']);
const work = mkdtempSync(join(tmpdir(), 'keepsake-demo-'));
async function photo(key, tries = 0) {
  const res = await fetch(PHOTOS[key], { headers: { 'User-Agent': 'KeepsakeDemoFixture/1.0 (local dev tool)' } });
  if (res.status === 429 && tries < 4) { await new Promise((r) => setTimeout(r, 3000 * (tries + 1))); return photo(key, tries + 1); }
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const src = join(work, `${key}.src`);
  const jpg = join(work, `${key}.jpg`);
  writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '480', src, '--out', jpg], { stdio: 'ignore' });
  // Shaped like an Instagram reel's thumbnail (9:16), so the library shows a tall picture in a card
  // (the UI tests check a tall picture never takes a tap meant for something above it).
  if (TALL.has(key)) execFileSync('sips', ['--cropToHeightWidth', '480', '270', jpg], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400)); // gentle on Commons
  return `data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}`;
}

const NOW = Date.parse('2026-10-15T15:00:00Z');
const daysAgo = (d, h = 0) => new Date(NOW - d * 86_400_000 - h * 3_600_000).toISOString();

const store = createStore(memoryBackend(), memoryRecordBackend());
await store.init();
const col = async (name, extra = {}) => (await store.createCollection({ name, ...extra }, { allowSimilar: true })).collection;
const byName = Object.fromEntries((await store.getCollections()).map((c) => [c.name, c]));
const kitchen = await col('Kitchen', { keywords: ['dutch oven', 'chemex', 'mug', 'knife'], pinned: true });
const coffee = await col('Coffee corner', { keywords: ['coffee', 'grinder', 'pour over'] });
const running = await col('Running', { keywords: ['running', 'shoes', 'trail'] });

const P = {};
for (const k of Object.keys(PHOTOS)) P[k] = await photo(k); // one at a time: Commons limits bursts

const saves = [
  // Places: several states, then abroad; one without a state for Places review.
  { at: daysAgo(0, 2), title: 'Tartine Bakery', url: 'https://maps.apple.com/?q=Tartine%20Bakery&ll=37.7614,-122.4241', kind: 'place', image: P.tartine, note: 'Morning bun. Go before 9.', details: { name: 'Tartine Bakery', address: '600 Guerrero St', locality: 'San Francisco', region: 'CA', postalCode: '94110', country: 'United States', lat: 37.7614, lng: -122.4241, source: 'you' } },
  { at: daysAgo(3), title: "Katz's Delicatessen", url: 'https://maps.apple.com/?q=Katz%27s%20Delicatessen&ll=40.7223,-73.9874', kind: 'place', image: P.katz, details: { name: "Katz's Delicatessen", address: '205 E Houston St', locality: 'New York', region: 'NY', postalCode: '10002', country: 'United States', lat: 40.7223, lng: -73.9874, source: 'you' } },
  { at: daysAgo(9), title: 'Franklin Barbecue', url: 'https://maps.apple.com/?q=Franklin%20Barbecue&ll=30.2701,-97.7313', kind: 'place', image: P.franklin, note: 'Line starts early. Bring a chair.', details: { name: 'Franklin Barbecue', address: '900 E 11th St', locality: 'Austin', region: 'TX', postalCode: '78702', country: 'United States', lat: 30.2701, lng: -97.7313, source: 'you' } },
  { at: daysAgo(14), title: 'Pike Place Market', url: 'https://maps.apple.com/?q=Pike%20Place%20Market&ll=47.6097,-122.3422', kind: 'place', image: P.pike, details: { name: 'Pike Place Market', address: '85 Pike St', locality: 'Seattle', region: 'WA', postalCode: '98101', country: 'United States', lat: 47.6097, lng: -122.3422, source: 'you' } },
  { at: daysAgo(55), title: 'Golden Gate Bridge viewpoint', url: 'https://maps.apple.com/?q=Battery%20Spencer&ll=37.8297,-122.4826', kind: 'place', image: P.bridge, details: { name: 'Battery Spencer', locality: 'Sausalito', region: 'CA', country: 'United States', lat: 37.8297, lng: -122.4826, source: 'you' } },
  { at: daysAgo(20), title: 'Pastéis de Belém', url: 'https://maps.apple.com/?q=Past%C3%A9is%20de%20Bel%C3%A9m&ll=38.6975,-9.2032', kind: 'place', image: P.nata, details: { name: 'Pastéis de Belém', address: 'Rua de Belém 84-92', locality: 'Lisboa', postalCode: '1300-085', country: 'Portugal', lat: 38.6975, lng: -9.2032, source: 'you' } },
  { at: daysAgo(48), title: 'Café de Flore', url: 'https://maps.apple.com/?q=Caf%C3%A9%20de%20Flore&ll=48.8542,2.3326', kind: 'place', image: P.flore, details: { name: 'Café de Flore', address: '172 Bd Saint-Germain', locality: 'Paris', postalCode: '75006', country: 'France', lat: 48.8542, lng: 2.3326, source: 'you' } },
  { at: daysAgo(6), title: 'Taco spot from Maya', url: 'https://www.instagram.com/p/DemoTaco123/', kind: 'place', details: { name: 'Taco spot from Maya', locality: 'Portland', source: 'page' }, instagram: { caption: 'best al pastor in town, ask for the green salsa', creator: 'maya.eats', collectionName: 'Food' } },

  // Recipes
  { at: daysAgo(1), title: 'Spaghetti alla carbonara', url: 'https://recipes.example.org/carbonara', kind: 'recipe', image: P.carbonara, details: { ingredients: ['200 g spaghetti', '100 g guanciale', '3 egg yolks', '1 whole egg', '50 g pecorino romano, grated', 'Black pepper'], steps: ['Cook the guanciale slowly until crisp; keep the fat.', 'Whisk the yolks, egg and pecorino with lots of pepper.', 'Boil the spaghetti in salted water until just al dente.', 'Toss the pasta in the pan off the heat, then stir in the egg mix with a splash of pasta water until glossy.'], servings: '2', totalTime: 'PT25M' } },
  { at: daysAgo(4), title: 'Shakshuka', url: 'https://recipes.example.org/shakshuka', kind: 'recipe', image: P.shakshuka, details: { ingredients: ['2 tbsp olive oil', '1 onion, sliced', '1 red pepper, sliced', '3 cloves garlic', '1 tsp cumin', '1 tsp paprika', '800 g canned tomatoes', '4 eggs', 'Feta and parsley'], steps: ['Soften the onion and pepper in the oil.', 'Add garlic and spices for a minute.', 'Pour in the tomatoes and simmer 10 minutes.', 'Make four wells, crack in the eggs, cover until the whites set.', 'Finish with feta and parsley.'], servings: '4', totalTime: 'PT35M' } },
  { at: daysAgo(60), title: 'Lemon olive oil cake', url: 'https://recipes.example.org/lemon-olive-oil-cake', kind: 'recipe', image: P.cake, details: { ingredients: ['200 g flour', '200 g sugar', '3 eggs', '160 ml olive oil', '2 lemons, zest and juice', '2 tsp baking powder', 'Pinch of salt'], steps: ['Heat the oven to 180 °C and line a tin.', 'Whisk sugar, eggs and zest until pale.', 'Stream in the oil, then the juice.', 'Fold in flour, baking powder and salt.', 'Bake 40 minutes.'], servings: '8', totalTime: 'PT1H' } },
  { at: daysAgo(11), title: 'Weeknight shoyu ramen', url: 'https://recipes.example.org/shoyu-ramen', kind: 'recipe', image: P.ramen, status: 'done', details: { ingredients: ['2 portions fresh ramen noodles', '1 l chicken stock', '3 tbsp soy sauce', '1 tbsp mirin', '2 soft-boiled eggs', 'Spring onions', 'Nori'], steps: ['Warm the stock with soy and mirin.', 'Cook the noodles.', 'Assemble with eggs, spring onions and nori.'], servings: '2', totalTime: 'PT20M' } },

  // Workouts
  { at: daysAgo(2), title: 'Kettlebell basics', url: 'https://training.example.com/kettlebell-basics', kind: 'workout', image: P.kettlebell, details: { exercises: [{ name: 'Kettlebell swing', sets: 5, reps: 15, restSeconds: 60 }, { name: 'Goblet squat', sets: 3, reps: 10, restSeconds: 60 }, { name: 'Turkish get-up', sets: 3, reps: 2 }, { name: 'Farmer carry', sets: 3, durationSeconds: 45 }] } },
  { at: daysAgo(16), title: 'Push-up ladder', url: 'https://training.example.com/ladder', kind: 'workout', details: { exercises: [{ name: 'Push-ups', sets: 3, reps: 12, restSeconds: 60 }, { name: 'Plank', sets: 3, durationSeconds: 45 }] } },

  // Films & shows, books (their cards are drawn: ticket stub, cover)
  { at: daysAgo(5), title: 'Past Lives', url: 'https://letterboxd.com/film/past-lives/', kind: 'media', details: { year: 2023 } },
  { at: daysAgo(30), title: 'In the Mood for Love', url: 'https://letterboxd.com/film/in-the-mood-for-love/', kind: 'media', status: 'done', details: { year: 2000 } },
  { at: daysAgo(70), title: 'Paris, Texas', url: 'https://letterboxd.com/film/paris-texas/', kind: 'media', details: { year: 1984 } },
  { at: daysAgo(8), title: 'Piranesi', url: 'https://www.goodreads.com/search?q=Piranesi%20Susanna%20Clarke', kind: 'book', details: { author: 'Susanna Clarke', year: 2020 } },
  { at: daysAgo(25), title: 'The Overstory', url: 'https://www.goodreads.com/search?q=The%20Overstory%20Richard%20Powers', kind: 'book', status: 'done', details: { author: 'Richard Powers', year: 2018 } },
  { at: daysAgo(65), title: 'Braiding Sweetgrass', url: 'https://www.goodreads.com/search?q=Braiding%20Sweetgrass', kind: 'book', details: { author: 'Robin Wall Kimmerer', year: 2013 } },

  // Video and articles
  { at: daysAgo(7), title: 'How to fold dumplings, three ways', url: 'https://www.youtube.com/watch?v=demoDumplng', kind: 'video', details: { channel: 'Demo Kitchen', durationSeconds: 480 } },
  { at: daysAgo(12), title: 'The case for slow cities', url: 'https://longform.example.net/slow-cities', kind: 'article', details: { author: 'R. Okafor', siteName: 'Longform', wordCount: 2900 } },

  // Products: in collections, one purchased, a favourite, and a few for Review
  { at: daysAgo(0, 5), title: 'Glass pour-over coffee maker, 6 cup', url: 'https://shop.example.com/p/pour-over-6', image: P.chemex, price: 49, currency: 'USD', retailer: 'Example Shop', collectionId: coffee.id, favorite: true },
  { at: daysAgo(10), title: 'Stoneware mugs, set of 4', url: 'https://shop.example.com/p/stoneware-mugs', image: P.mugs, price: 64, currency: 'USD', retailer: 'Example Shop', collectionId: kitchen.id, note: 'the speckled ones' },
  { at: daysAgo(18), title: 'Cushioned road running shoes', url: 'https://run.example.com/p/road-shoe', image: P.shoes, price: 140, currency: 'USD', retailer: 'Example Run', collectionId: running.id, purchased: true },
  { at: daysAgo(50), title: 'Molded plywood lounge chair', url: 'https://design.example.com/p/plywood-lounge', image: P.chair, price: 1195, currency: 'USD', retailer: 'Example Design', collectionId: byName['Home Decor']?.id },
  { at: daysAgo(1, 3), title: 'Adjustable desk lamp', url: 'https://design.example.com/p/desk-lamp', image: P.lamp, price: 220, currency: 'USD', retailer: 'Example Design' },
  { at: daysAgo(3, 4), title: 'Something from a newsletter', url: 'https://example.com/newsletter/item' },
];

const ids = [];
for (const { at, ...s } of saves) ids.push((await store.addItem({ ...s, createdAt: at })).id);
// Opened lately, so Come back to shows only the older ones.
for (let i = 0; i < saves.length; i++) if (Date.parse(saves[i].at) > NOW - 42 * 86_400_000) await store.markOpened(ids[i]);
// Review: the lamp and the newsletter link have no collection and no Lifestyle view.
// Trash: one save, so the Trash isn't empty.
const gone = (await store.addItem({ title: 'Old phone case', url: 'https://shop.example.com/p/case', price: 19, currency: 'USD', createdAt: daysAgo(40) })).id;
await store.deleteItems([gone]);

// A workout goal: 3 a week for 6 weeks, with check-ins over the last three weeks and this week.
const kb = ids[saves.findIndex((s) => s.title === 'Kettlebell basics')];
const goal = await store.createGoal({ itemId: kb, kind: 'frequency', spec: { perWeek: 3, weeks: 6 } });
for (const d of [20, 18, 15, 13, 11, 9, 6, 4, 1]) await store.addCheckin(goal.id, {}, { at: daysAgo(d, -2) });

const exp = await store.exportJSON();
writeFileSync(out, JSON.stringify(exp));
const kb2 = (Buffer.byteLength(JSON.stringify(exp)) / 1024).toFixed(0);
console.log(`${out}: ${Object.keys(exp.items).length} saves, ${Object.keys(exp.collections).length} collections, 1 goal, ${exp.checkins.length} check-ins, ${kb2} KB`);
