// Writes Keepsake export files (schema 2) with generated items, for importing into a TEST browser
// profile (Settings -> Data -> Import). Uses reserved example.* domains and no remote images, so a
// test library makes no network requests to real sites.
//
//   node replica/tools/make_test_library.mjs [outDir] [count...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeItem, makeCollection, SCHEMA_VERSION } from '../../keepsake/src/shared/storage.js';

const [outDir = '.', ...counts] = process.argv.slice(2);
const sizes = counts.length ? counts.map(Number) : [1000, 5000];
const products = [
  ['Two-person ultralight backpacking tent', 'Camping & Outdoors'], ['Noise-cancelling over-ear headphones', 'Technology'],
  ['Enameled cast iron Dutch oven 5.5 qt', 'Kitchen'], ['Waxed cotton field jacket', 'Clothing'], ['Ceramic bedside lamp with linen shade', 'Home Decor'],
  ['Cordless brushless drill driver kit 18V', 'Tools'], ['Carry-on suitcase with laptop pocket', 'Travel'], ['Mineral SPF 40 daily moisturizer', 'Personal Care'],
  ['Merino crew sweater', 'Clothing'], ['Walnut desk shelf 90 cm', 'Home Decor'], ['Burr coffee grinder', 'Kitchen'], ['Trail running shoes', 'Clothing'],
];
const colors = ['#8A9A88', '#B9924F', '#6B7C9B', '#A6503F', '#4F6F57', '#8C6B8F'];
const tile = (c) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${c}"/></svg>`).toString('base64')}`;
mkdirSync(outDir, { recursive: true });
for (const n of sizes) {
  const collections = {};
  const byName = {};
  for (const [, name] of products) if (!byName[name]) { const c = makeCollection({ name }); collections[c.id] = c; byName[name] = c.id; }
  const items = {};
  for (let i = 0; i < n; i++) {
    const [title, col] = products[i % products.length];
    const day = 864e5 * (i % 400);
    const it = makeItem({
      title: `${title} #${i + 1}`, url: `https://shop${i % 40}.example.com/p/${i + 1}`, price: (i % 300) + 9.99, currency: 'USD',
      retailer: `Test Shop ${i % 40}`, image: tile(colors[i % colors.length]), imageAspect: 4 / 3,
      note: i % 7 === 0 ? 'wait for the sale' : '', favorite: i % 11 === 0, purchased: i % 17 === 0,
      collectionId: i % 25 === 0 ? null : byName[col], needsReview: i % 25 === 0, confidence: 0.8, categorizationSource: 'sample',
      createdAt: new Date(Date.now() - day).toISOString(),
    });
    items[it.id] = it;
  }
  const file = join(outDir, `keepsake-test-${n}.json`);
  writeFileSync(file, JSON.stringify({ format: 'keepsake-export', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), collections, items }));
  console.log(file, `${(JSON.stringify(items).length / 1048576).toFixed(1)} MB of items`);
}
