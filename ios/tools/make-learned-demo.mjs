// The demo library after a few moves, so sorting has learned words and shops: what Settings → What it
// learned and a collection's "Already files saves here" show in LearnedWordsTests. Made by the Chrome
// extension's own store code from keepsake-demo.json (moveItems with learn 'strong', as filing from
// Review does); photos are dropped to keep the file small.
//
//   node ios/tools/make-learned-demo.mjs [out.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, memoryBackend, memoryRecordBackend } from '../../keepsake/src/shared/storage.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, '..', 'demo', 'keepsake-learned-demo.json');

const store = createStore(memoryBackend(), memoryRecordBackend());
await store.init();
await store.importJSON(JSON.parse(readFileSync(join(here, '..', 'demo', 'keepsake-demo.json'), 'utf8')), { mode: 'replace' });

const cols = await store.getCollections();
const items = await store.getItems();
const col = (name) => cols.find((c) => c.name === name).id;
const item = (title) => items.find((i) => i.title === title).id;
const moves = [
  ['Adjustable desk lamp', 'Home Decor'],
  ['Stoneware mugs, set of 4', 'Coffee corner'],
  ['Glass pour-over coffee maker, 6 cup', 'Kitchen'],
];
for (const [title, to] of moves) await store.moveItems([item(title)], col(to), { learn: 'strong' });

const exp = await store.exportJSON();
const json = JSON.stringify(exp, null, 1).replace(/"data:image\/[^"]*"/g, 'null');
writeFileSync(out, json);
const prefs = exp.prefs;
console.log(`${out}: ${Object.keys(prefs.learnedKeywords).length} words, ${Object.keys(prefs.retailerPrefs).length} shops, ${prefs.corrections.length} moves, ${(json.length / 1024).toFixed(0)} KB`);
