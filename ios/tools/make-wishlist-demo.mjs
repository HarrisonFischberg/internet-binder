// The demo library with Wish List deals on a few products, as Find deals leaves them (shared/wishlist.js):
// one with a lower price at three stores, one with nothing lower, one with no prices found, one hidden.
// The rest are unchecked. For WishListTests and screenshots; "Checked … ago" counts from when this runs,
// so run it again before taking screenshots.
//
//   node ios/tools/make-wishlist-demo.mjs [out.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, memoryBackend, memoryRecordBackend } from '../../keepsake/src/shared/storage.js';
import { wishList } from '../../keepsake/src/shared/wishlist.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, '..', 'demo', 'keepsake-wishlist-demo.json');

const store = createStore(memoryBackend(), memoryRecordBackend());
await store.init();
await store.importJSON(JSON.parse(readFileSync(join(here, '..', 'demo', 'keepsake-demo.json'), 'utf8')), { mode: 'replace' });

const items = await store.getItems();
const id = (title) => items.find((i) => i.title === title).id;
const checkedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
const offer = (store_, host, price, extra = {}) => ({ store: store_, url: `https://${host}/p/${extra.slug || 'item'}`, price, currency: 'USD', title: '', sale: '', note: '', confirmed: false, ...extra });
const by = { provider: 'anthropic', model: 'claude-haiku-5-5' };

await store.updateItem(id('Glass pour-over coffee maker, 6 cup'), { deals: { checkedAt, product: 'Glass pour-over coffee maker, 6 cup', ...by, offers: [
  offer('Brewhaus', 'brewhaus.example', 36.99, { sale: 'Black Friday deal', confirmed: true }),
  offer('Kitchen & Table', 'kitchenandtable.example', 41.5, { confirmed: true }),
  offer('Northfield Goods', 'northfield.example', 44),
  offer('Corner Roasters', 'cornerroasters.example', 39, { confirmed: true, outOfStock: true }),
] } }, { by: 'deals' });
await store.updateItem(id('Stoneware mugs, set of 4'), { deals: { checkedAt, product: 'Stoneware mugs, set of 4', ...by, offers: [
  offer('Hearth & Clay', 'hearthandclay.example', 64, { confirmed: true }),
  offer('Table Supply', 'tablesupply.example', 68),
] } }, { by: 'deals' });
await store.updateItem(id('Adjustable desk lamp'), { deals: { checkedAt, product: 'Adjustable desk lamp', ...by, offers: [], empty: 'none' } }, { by: 'deals' });
await store.updateItem(id('Something from a newsletter'), { wishHidden: true }, { by: 'deals' });

const exp = await store.exportJSON();
writeFileSync(out, JSON.stringify(exp, null, 1));
const rows = wishList(await store.getItems());
console.log(`${out}: ${rows.length} on the Wish List (${rows.map((r) => r.summary.state).join(', ')}), ${(JSON.stringify(exp).length / 1024).toFixed(0)} KB`);
