// Wish List (src/shared/wishlist.js): which saves are on it, and Find deals with a fake provider and fake
// store pages. Shared by Chrome, Safari and iOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { onWishList, hiddenFromWishList, wishList, dealsToCheck, dealSummary, confirmOffer, dealsInput, findDeals, setWishHidden, sortOffers } from '../keepsake/src/shared/wishlist.js';
import { dealsAnswer, findDealsWithAI } from '../keepsake/src/ai/provider.js';
import { createStore, memoryRecordBackend, makeItem, sanitizeDeals } from '../keepsake/src/shared/storage.js';

const product = (extra = {}) => makeItem({ id: 'w1', kind: 'product', type: 'product', title: 'Soundfield Arc 2 headphones, black', url: 'https://soundfield.example/arc-2', price: 279, currency: 'USD', collectionId: 'tech', ...extra });
const offer = (store, price, extra = {}) => ({ store, price, currency: 'USD', url: `https://${store.toLowerCase()}.example/arc-2`, title: 'Soundfield Arc 2', sale: '', note: '', ...extra });
const seenFor = (offers) => new Set(offers.map((o) => o.url));

async function newStore(settings = { ai: { on: true, provider: 'anthropic', model: 'm' } }, key = 'sk') {
  const kv = {};
  const store = createStore({ get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in kv).map((x) => [x, kv[x]])), set: async (o) => Object.assign(kv, o), remove: async () => {}, clear: async () => {}, onChanged: () => () => {} }, memoryRecordBackend());
  await store.init();
  await store.updateSettings(settings);
  if (key) await store.setSecret('aiApiKey', key);
  return store;
}

// The provider's reply to one web search request: the pages the search returned, then its JSON answer.
const reply = (answer, urls) => ({ ok: true, status: 200, text: async () => JSON.stringify({
  content: [{ type: 'web_search_tool_result', content: urls.map((url) => ({ url })) }, { type: 'text', text: JSON.stringify(answer) }],
  usage: { input_tokens: 21000, output_tokens: 400, server_tool_use: { web_search_requests: 3 } },
}) });
const shopPage = (price, { currency = 'USD', availability = 'https://schema.org/InStock' } = {}) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Soundfield Arc 2', offers: { '@type': 'Offer', price, priceCurrency: currency, availability } })}</script></head></html>`;

test('the Wish List holds things to buy that are not bought, binned or hidden', () => {
  assert.equal(onWishList(product()), true);
  assert.equal(onWishList(product({ collectionId: null })), true, 'a product waiting in Review counts');
  assert.equal(onWishList(product({ purchased: true })), false);
  assert.equal(onWishList(product({ deletedAt: new Date().toISOString() })), false);
  assert.equal(onWishList(product({ wishHidden: true })), false);
  assert.equal(onWishList(product({ captureState: 'pending' })), false);
  assert.equal(onWishList(makeItem({ kind: 'recipe', title: 'Shakshuka', url: 'https://food.example/shakshuka' })), false);
  assert.equal(onWishList(makeItem({ kind: 'link', title: 'A lamp', url: 'https://lamps.example/a', collectionId: 'home' })), true, 'a page saved into a collection is shopping');
  assert.equal(onWishList(makeItem({ kind: 'link', title: 'A lamp', url: 'https://lamps.example/a' })), false, 'a plain link in Review is not');
  assert.equal(hiddenFromWishList(product({ wishHidden: true })), true);
  assert.equal(hiddenFromWishList(product({ wishHidden: true, purchased: true })), false);
});

test('the provider answer keeps only links the search returned, real prices, one offer per store, lowest first', () => {
  const offers = [
    offer('Bigbox', 229),
    offer('Bigbox', 219, { url: 'https://bigbox.example/arc-2?color=black' }),
    offer('Madeup', 99.5, { url: 'https://madeup.example/arc-2' }),
    offer('Noprice', null),
    offer('Euro', 180, { currency: 'EUR' }),
    offer('Cable', 19, { title: 'Arc 2 replacement cable' }),
    offer('Plain', 249, { url: 'http://plain.example/arc-2' }),
    offer('Soundfield', '$259.00'),
  ];
  const seen = seenFor(offers.filter((o) => o.store !== 'Madeup'));
  const r = dealsAnswer({ product: 'Soundfield Arc 2 (black)', offers, confidence: 0.9 }, seen, { amount: 279, currency: 'USD' });
  assert.deepEqual(r.offers.map((o) => [o.store, o.price]), [['Bigbox', 219], ['Soundfield', 259]]);
  assert.equal(r.offers[0].host, 'bigbox.example');
  assert.equal(r.product, 'Soundfield Arc 2 (black)');
});

test('with no currency on the save, the most common currency among the offers stands', () => {
  const offers = [offer('A', 100), offer('B', 90, { currency: 'GBP' }), offer('C', 110)];
  const r = dealsAnswer({ offers, confidence: 0.9 }, seenFor(offers), {});
  assert.deepEqual(r.offers.map((o) => o.store), ['A', 'C']);
});

test("a store page's own price wins and marks the offer confirmed; an odd page leaves the search price alone", () => {
  const o = offer('Bigbox', 229);
  assert.deepEqual(confirmOffer(o, null, 279), { ...o, confirmed: false });
  assert.equal(confirmOffer(o, { price: 199.99, currency: 'USD', availability: 'in_stock' }, 279).price, 199.99);
  assert.equal(confirmOffer(o, { price: 199.99, currency: 'USD' }, 279).confirmed, true);
  assert.equal(confirmOffer(o, { price: 199.99, currency: 'CAD' }, 279).confirmed, false, 'another currency');
  assert.equal(confirmOffer(o, { price: 12, currency: 'USD' }, 279).price, 229, 'far too low: another item on that page');
  const gone = confirmOffer(o, { price: 229, currency: 'USD', availability: 'out_of_stock' }, 279);
  assert.equal(gone.outOfStock, true);
  assert.deepEqual(sortOffers([gone, offer('Other', 240)]).map((x) => x.store), ['Other', 'Bigbox'], 'in stock comes first');
});

test('what a row says: unchecked, a saving against the saved price, nothing lower, nothing found', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const checkedAt = '2026-11-27T10:00:00Z';
  assert.equal(dealSummary(product(), now).state, 'unchecked');
  const found = dealSummary(product({ deals: { checkedAt, offers: [offer('Bigbox', 199), offer('Other', 249)] } }), now);
  assert.equal(found.state, 'found');
  assert.equal(found.best.store, 'Bigbox');
  assert.equal(found.saving, 80);
  assert.equal(found.savingPct, 29);
  assert.equal(found.old, false);
  const dearer = dealSummary(product({ deals: { checkedAt, offers: [offer('Other', 289)] } }), now);
  assert.equal(dearer.saving, null);
  assert.equal(dealSummary(product({ price: null, deals: { checkedAt, offers: [offer('Other', 289)] } }), now).saving, null);
  assert.equal(dealSummary(product({ deals: { checkedAt, offers: [], empty: 'unsure' } }), now).state, 'unsure');
  assert.equal(dealSummary(product({ deals: { checkedAt, offers: [] } }), now).state, 'none');
  assert.equal(dealSummary(product({ deals: { checkedAt: '2026-11-20T10:00:00Z', offers: [offer('Other', 200)] } }), now).old, true);
});

test('the list puts the biggest savings first, and Check all skips what was checked a moment ago', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const fresh = '2026-11-27T11:00:00Z';
  const items = [
    product({ id: 'plain', createdAt: '2026-11-01T00:00:00Z' }),
    product({ id: 'small', deals: { checkedAt: fresh, offers: [offer('A', 269)] } }),
    product({ id: 'big', deals: { checkedAt: '2026-11-25T11:00:00Z', offers: [offer('A', 139)] } }),
    product({ id: 'bought', purchased: true }),
    product({ id: 'newer', createdAt: '2026-11-20T00:00:00Z' }),
  ];
  assert.deepEqual(wishList(items, now).map((r) => r.item.id), ['big', 'small', 'newer', 'plain']);
  assert.deepEqual(dealsToCheck(items, now).map((i) => i.id).sort(), ['big', 'newer', 'plain']);
});

test('what the provider is told: the shop listing over a post, never a social link', () => {
  const post = makeItem({ id: 'p', type: 'instagram', kind: 'product', title: 'Arc 2 headphones', url: 'https://www.instagram.com/p/ABC/', price: 279, currency: 'USD',
    details: { brand: 'Soundfield', model: 'ARC2-BLK', shopUrl: 'https://soundfield.example/arc-2', shopName: 'Soundfield', shopTitle: 'Arc 2 Wireless', specs: [{ label: 'Colour', value: 'Black' }, { label: 'Weight', value: '250 g' }] } });
  const input = dealsInput(post, { region: 'US', today: '2026-11-27' });
  assert.equal(input.url, 'https://soundfield.example/arc-2');
  assert.equal(input.retailer, 'Soundfield');
  assert.equal(input.brand, 'Soundfield');
  assert.deepEqual(input.specs, [{ label: 'Colour', value: 'Black' }]);
  assert.equal(input.amount, 279);
  const bare = dealsInput(makeItem({ type: 'instagram', kind: 'product', title: 'Arc 2', url: 'https://www.instagram.com/p/ABC/' }));
  assert.equal(bare.url, '');
  assert.equal(bare.retailer, '');
  assert.equal(bare.amount, null);
});

test('Find deals: searches with your key, reads each store page for its price, and keeps the result on the save', async () => {
  const store = await newStore();
  const { id } = await store.addItem(product());
  const offers = [offer('Bigbox', 229), offer('Shopco', 239), offer('Madeup', 150)];
  const realFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (url, init) => { body = JSON.parse(init.body); return reply({ product: 'Soundfield Arc 2 (black)', offers, confidence: 0.9 }, offers.slice(0, 2).map((o) => o.url)); };
  try {
    const pages = { 'https://bigbox.example/arc-2': shopPage(199.99), 'https://shopco.example/arc-2': null };
    const asked = [];
    const r = await findDeals(store, id, { fetchShopPage: async (u) => { asked.push(u); return pages[u] ?? null; }, region: 'US', now: () => new Date('2026-11-27T12:00:00Z') });
    assert.equal(body.tools[0].name, 'web_search');
    assert.match(body.messages[0].content.at(-1).text, /Soundfield Arc 2 headphones, black/);
    assert.match(body.messages[0].content.at(-1).text, /Saved at: \$279/);
    assert.match(body.messages[0].content.at(-1).text, /Today is 2026-11-27/);
    assert.deepEqual(asked.sort(), ['https://bigbox.example/arc-2', 'https://shopco.example/arc-2'], 'only pages the search returned are read');
    assert.deepEqual(r.summary.offers.map((o) => [o.store, o.price, o.confirmed]), [['Bigbox', 199.99, true], ['Shopco', 239, false]]);
    assert.equal(r.summary.saving, 79.01);
    const kept = await store.getItem(id);
    assert.equal(kept.deals.checkedAt, '2026-11-27T12:00:00.000Z');
    assert.equal(kept.deals.offers.length, 2);
    assert.deepEqual(kept.deals.usage, { inputTokens: 21000, outputTokens: 400, searches: 3 });
    assert.deepEqual(kept.userFields, [], 'finding deals is not a hand edit');
    assert.equal(kept.title, 'Soundfield Arc 2 headphones, black');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Find deals: an unsure answer shows no offers; a provider error leaves the last results alone', async () => {
  const store = await newStore();
  const { id } = await store.addItem(product({ deals: { checkedAt: '2026-11-20T10:00:00Z', offers: [offer('Old', 250)] } }));
  const offers = [offer('Bigbox', 229)];
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'slow down' } }) });
    await assert.rejects(findDeals(store, id, {}), /429/);
    assert.equal((await store.getItem(id)).deals.offers[0].store, 'Old');
    globalThis.fetch = async () => reply({ product: '', offers, confidence: 0.2 }, offers.map((o) => o.url));
    const r = await findDeals(store, id, { fetchShopPage: async () => { throw new Error('never read'); } });
    assert.equal(r.summary.state, 'unsure');
    assert.equal((await store.getItem(id)).deals.offers.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Find deals needs your own key and a provider that can search; nothing is sent without them', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no network'); };
  try {
    const noKey = await newStore({ ai: { on: true, provider: 'anthropic' } }, '');
    await assert.rejects(findDeals(noKey, (await noKey.addItem(product())).id, {}), /your own AI key/);
    const off = await newStore({ ai: { on: false, provider: 'anthropic' } });
    await assert.rejects(findDeals(off, (await off.addItem(product())).id, {}), /your own AI key/);
    const custom = await newStore({ ai: { on: true, provider: 'custom', baseUrl: 'https://llm.example/v1', model: 'x' } });
    await assert.rejects(findDeals(custom, (await custom.addItem(product())).id, {}), /web search/);
    await assert.rejects(findDealsWithAI({ title: 'x' }, { ai: { provider: 'anthropic' } }, ''), /API key/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('hiding takes a save off the list and keeps its deals; deals survive a round trip through the store', async () => {
  const store = await newStore();
  const { id } = await store.addItem(product({ deals: { checkedAt: '2026-11-27T10:00:00Z', offers: [offer('Bigbox', 199, { confirmed: true }), { store: 'Bad', price: -1, url: 'nope' }] } }));
  await setWishHidden(store, [id], true);
  let it = await store.getItem(id);
  assert.equal(onWishList(it), false);
  assert.equal(it.deals.offers.length, 1);
  assert.equal(it.deals.offers[0].confirmed, true);
  await setWishHidden(store, [id], false);
  it = await store.getItem(id);
  assert.equal(onWishList(it), true);
  assert.equal('wishHidden' in it, false);
  assert.equal(sanitizeDeals({ offers: [] }), null, 'no time checked: not kept');
  assert.equal('deals' in makeItem({ title: 'x' }), false, 'saves without deals stay as they were');
});
