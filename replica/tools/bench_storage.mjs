// Storage-layer baseline for Keepsake's real store (keepsake/src/shared/storage.js)
// against its in-memory backend, with generated items. This measures the store's own
// algorithmic cost (read everything, rewrite the whole items map per write) in Node.
// It is NOT a Chrome measurement: chrome.storage.local adds serialization and IPC on top.
//
//   node replica/tools/bench_storage.mjs            # 1k, 5k, 20k items
//   node replica/tools/bench_storage.mjs 2000 10000
import { createStore, memoryBackend, makeItem, KEYS } from '../../keepsake/src/shared/storage.js';

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const N = sizes.length ? sizes : [1000, 5000, 20000];
const words = ['ceramic', 'lamp', 'linen', 'tent', 'ultralight', 'jacket', 'waxed', 'headphones', 'dutch', 'oven', 'drill', 'carry-on', 'moisturizer', 'roof', 'fan', 'book', 'chair', 'rug', 'kettle', 'boots'];
const pick = (i, n) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ');
// Instagram imports store a local JPEG thumbnail (<= 320 px). ~25 KB of base64 is a typical size.
const THUMB = 'data:image/jpeg;base64,' + 'A'.repeat(25 * 1024);

function genItem(i, withThumb) {
  return makeItem({
    title: `${pick(i, 6)} #${i}`, price: (i % 500) + 0.99, currency: 'USD', retailer: `Shop ${i % 300}`,
    url: `https://shop${i % 300}.example.com/p/${i}?utm_source=x`, image: withThumb ? THUMB : `https://cdn.example.com/${i}.jpg`,
    description: pick(i + 1, 30), note: i % 5 ? '' : 'wait for sale', collectionId: null,
  });
}

const ms = (t) => Number((performance.now() - t).toFixed(2));
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

for (const n of N) {
  for (const thumbShare of [0, 0.25]) {
    const items = {};
    for (let i = 0; i < n; i++) { const it = genItem(i, i < n * thumbShare); items[it.id] = it; }
    const backend = memoryBackend({ [KEYS.items]: items });
    const store = createStore(backend);
    await store.init();
    const bytes = Buffer.byteLength(JSON.stringify(items));
    const addT = [], dupT = [], updT = [], getAllT = [], searchT = [];
    for (let r = 0; r < 15; r++) {
      let t = performance.now(); const it = await store.addItem(genItem(n + r, false)); addT.push(ms(t));
      t = performance.now(); await store.findByUrl(`https://shop${r}.example.com/p/${r}`); dupT.push(ms(t));
      t = performance.now(); await store.updateItem(it.id, { favorite: true }); updT.push(ms(t));
      t = performance.now(); const all = await store.getAll(); getAllT.push(ms(t));
      t = performance.now();
      const q = 'linen lamp'; Object.values(all.items).filter((i) => [i.title, i.retailer, i.note, i.description].join(' \n ').toLowerCase().includes(q)); searchT.push(ms(t));
    }
    console.log(JSON.stringify({ items: n, thumbShare, jsonMB: Number((bytes / 1048576).toFixed(2)), addItem_ms: median(addT), findByUrl_ms: median(dupT), updateItem_ms: median(updT), getAll_ms: median(getAllT), substringSearch_ms: median(searchT) }));
  }
}
