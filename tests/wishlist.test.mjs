// Wish List (src/shared/wishlist.js): which saves are on it, and Find deals with a fake provider and fake
// store pages. Shared by Chrome, Safari and iOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { onWishList, hiddenFromWishList, wishList, dealsToCheck, dealSummary, confirmOffer, dealsInput, findDeals, setWishHidden, sortOffers, pageIsOtherModel } from '../keepsake/src/shared/wishlist.js';
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

test('a price written another way is not guessed at, and the link kept is the one the search returned', () => {
  const offers = [offer('Euro', '1.299,00'), offer('From', 'from 99'), offer('Ok', '$259.00', { url: 'https://ok.example/arc-2?utm=evil' })];
  const r = dealsAnswer({ offers, confidence: 0.9 }, new Set(['https://euro.example/arc-2', 'https://from.example/arc-2', 'https://ok.example/arc-2']), { currency: 'USD' });
  assert.deepEqual(r.offers.map((o) => [o.store, o.price, o.url]), [['Ok', 259, 'https://ok.example/arc-2']]);
});

test('a page with a price per variant, or a "from" price, says its price varies', async () => {
  const { productFromHtml } = await import('../keepsake/src/shared/understand.js');
  const page = (offers) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'X', offers })}</script>`;
  assert.equal(productFromHtml(page({ '@type': 'AggregateOffer', lowPrice: 499, highPrice: 899, priceCurrency: 'USD' })).priceVaries, true);
  assert.equal(productFromHtml(page([{ '@type': 'Offer', price: 499, priceCurrency: 'USD' }, { '@type': 'Offer', price: 899, priceCurrency: 'USD' }])).priceVaries, true);
  assert.equal(productFromHtml(page({ '@type': 'Offer', price: 199.99, priceCurrency: 'USD' })).priceVaries, false);
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
  assert.equal(confirmOffer(offer('Bigbox', 899), { price: 499, currency: 'USD', priceVaries: true }, 899).price, 899, 'a page that prices several variants confirms nothing');
  assert.equal(confirmOffer(o, { price: 150, currency: 'USD' }, null).confirmed, false, "well under the search price: another variant's");
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
  assert.equal(dealSummary(product({ currency: '', deals: { checkedAt, offers: [offer('Other', 100)] } }), now).saving, null, 'no currency on the save: nothing to compare');
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
    product({ id: 'big', deals: { checkedAt: '2026-11-25T11:00:00Z', offers: [offer('A', 139, { url: 'https://www.target.com/p/arc-2' })] } }),
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

test('Find deals sends nothing for a save hidden or bought since you asked', async () => {
  const store = await newStore();
  const { id } = await store.addItem(product({ purchased: true }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('nothing should be sent'); };
  try {
    const r = await findDeals(store, id, {});
    assert.equal(r.skipped, true);
    assert.equal('deals' in (await store.getItem(id)), false);
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

test('a store page for another model or size is dropped, and a page price far from the search price is not trusted', () => {
  const o = offer('Runshop', 116, {});
  const hoka = "Hoka Clifton 9 men's running shoes";
  assert.equal(confirmOffer(o, { title: "Men's HOKA Clifton 11 Neutral Road Shoe", price: 154.95, currency: 'USD' }, 145, hoka), null);
  assert.equal(confirmOffer(o, { title: "Men's HOKA Clifton 9 | Runshop", price: 115, currency: 'USD' }, 145, hoka).confirmed, true);
  assert.equal(pageIsOtherModel({ title: 'Kindle Paperwhite 16 GB | Amazon' }, 'Kindle Paperwhite 16GB (2024)'), false, 'years and spacing do not matter');
  assert.equal(pageIsOtherModel({ title: 'Sony WH-1000XM4 headphones' }, 'Sony WH-1000XM5 headphones black'), true);
  assert.equal(pageIsOtherModel({ title: '' }, hoka), false, 'a page with no title says nothing');
  assert.equal(pageIsOtherModel({ title: 'Signature Round Dutch Oven | Le Creuset' }, 'Le Creuset Signature 5.5 qt Dutch oven'), false, 'a title with no number cannot disagree');
  const far = confirmOffer(offer('Abt', 849), { title: 'Dyson V15 Detect', price: 599.99, currency: 'USD' }, 749.99, 'Dyson V15 Detect vacuum');
  assert.equal(far.confirmed, false);
  assert.equal(far.price, 849, 'the search result stands');
});

test('review, comparison and search pages are not offers', () => {
  const urls = ['https://shop.example/site/reviews/arc-2', 'https://shop.example/compare/arc-2', 'https://shop.example/s?q=arc+2', 'https://shop.example/p/arc-2'];
  const offers = urls.map((url, i) => ({ store: `S${i}`, price: 250 + i, currency: 'USD', url }));
  const kept = dealsAnswer({ product: 'Arc 2', offers, confidence: 0.9 }, new Set(urls), { currency: 'USD', amount: 279 }).offers;
  assert.deepEqual(kept.map((o) => o.url), ['https://shop.example/p/arc-2']);
});

// --- Naming the product, "Not the same item", too-good prices, cost ---------------------------------
import { markDoubt, knownStore, removeOffer, restoreOffer, setWishName, addSpend, spendThisMonth } from '../keepsake/src/shared/wishlist.js';
import { lookupCost, lookupEstimate, TYPICAL_LOOKUP } from '../keepsake/src/ai/provider.js';

const at = (host, price, extra = {}) => ({ store: host, url: `https://${host}/p`, price, currency: 'USD', title: '', sale: '', note: '', confirmed: false, ...extra });

test('a store you know sets the bar: a far lower price elsewhere is doubted and never the best', () => {
  const item = product({ deals: { checkedAt: new Date().toISOString(), offers: [at('tedstore.example', 150, { confirmed: true }), at('www.amazon.com', 248), at('bestbuy.com', 259)] } });
  const s = dealSummary(item);
  assert.equal(s.best.url, 'https://www.amazon.com/p');
  assert.equal(s.saving, 31);
  assert.deepEqual(s.offers.map((o) => [hostOf(o.url), !!o.doubt]), [['www.amazon.com', false], ['bestbuy.com', false], ['tedstore.example', true]], 'the doubted one sorts last');
  // Close to the known stores' price: no warning, and it can be the best.
  const near = dealSummary(product({ deals: { checkedAt: new Date().toISOString(), offers: [at('tedstore.example', 230), at('amazon.com', 248)] } }));
  assert.equal(near.best.price, 230);
});
const hostOf = (u) => new URL(u).hostname;

test('with no store you know, the other stores or your saved price set the bar', () => {
  const marked = markDoubt([at('a.example', 100), at('b.example', 250), at('c.example', 260)], product());
  assert.deepEqual(marked.map((o) => !!o.doubt), [true, false, false], 'far under the others');
  assert.equal(markDoubt([at('a.example', 150)], product())[0].doubt, true, 'alone, and far under the 279 it was saved at');
  assert.equal(markDoubt([at('a.example', 200)], product())[0].doubt, undefined);
  assert.equal(markDoubt([at('a.example', 20)], product({ price: null }))[0].doubt, undefined, 'nothing to compare with: no claim');
  // Every price doubted: nothing is called the best, and no saving is claimed.
  const s = dealSummary(product({ deals: { checkedAt: new Date().toISOString(), offers: [at('a.example', 150)] } }));
  assert.equal(s.state, 'found');
  assert.equal(s.best, null);
  assert.equal(s.saving, null);
});

test('known stores: big retailers, the shop it was saved from, and the brand’s own site', () => {
  assert.equal(knownStore('www.amazon.com'), true);
  assert.equal(knownStore('smile.amazon.co.uk'), true);
  assert.equal(knownStore('amazon.com.evil.example'), false);
  assert.equal(knownStore('notamazon.com'), false);
  assert.equal(knownStore('soundfield.example', product()), true, 'where you saved it');
  assert.equal(knownStore('shop.dyson.com', product({ details: { brand: 'Dyson' } })), true);
  assert.equal(knownStore('dyson-outlet.example', product({ details: { brand: 'Dyson' } })), false);
  assert.equal(knownStore('dyson.co.uk', product({ details: { brand: 'Dyson' } })), true);
  assert.equal(knownStore('dyson.top', product({ details: { brand: 'Dyson' } })), false, 'a lookalike ending is not the brand');
  assert.equal(knownStore('dyson.shop', product({ details: { brand: 'Dyson' } })), false);
  assert.equal(knownStore('instagram.com', makeItem({ id: 'i', type: 'instagram', kind: 'product', title: 'x', url: 'https://instagram.com/p/1' })), false);
});

test('your own name for the product is what gets searched, and old prices are cleared', async () => {
  const store = await newStore();
  await store.addItem(product({ details: { brand: 'Soundfield', model: 'ARC1', specs: [{ label: 'Color', value: 'white' }] }, deals: { checkedAt: new Date().toISOString(), offers: [at('amazon.com', 248)] } }));
  await setWishName(store, 'w1', '  Soundfield Arc 2 Pro,   midnight blue ');
  let it = await store.getItem('w1');
  assert.equal(it.wishName, 'Soundfield Arc 2 Pro, midnight blue');
  assert.equal(it.deals, undefined, 'prices for the old name are gone');
  assert.equal(it.title, 'Soundfield Arc 2 headphones, black', 'the save keeps its title');
  assert.equal((it.userFields || []).includes('title'), false);
  const input = dealsInput(it);
  assert.equal(input.title, 'Soundfield Arc 2 Pro, midnight blue');
  assert.equal(input.model, '', 'the model read from the page could be what you corrected');
  assert.deepEqual(input.specs, []);
  assert.equal(input.brand, 'Soundfield');
  // Stores skipped under the old name get another chance under the new one.
  await store.updateItem('w1', { deals: { checkedAt: new Date().toISOString(), offers: [at('amazon.com', 248)] } }, { by: 'deals' });
  await removeOffer(store, 'w1', 'https://amazon.com/p');
  assert.deepEqual((await store.getItem('w1')).dealSkip, ['amazon.com']);
  await setWishName(store, 'w1', 'Soundfield Arc 2 Pro, silver');
  assert.equal('dealSkip' in (await store.getItem('w1')), false);
  it = await store.getItem('w1');
  // Back to the title clears it.
  await setWishName(store, 'w1', it.title);
  it = await store.getItem('w1');
  assert.equal('wishName' in it, false);
});

test('Not the same item: the offer goes, its store is skipped next time, and Undo puts both back', async () => {
  const store = await newStore();
  const checkedAt = new Date().toISOString();
  await store.addItem(product({ deals: { checkedAt, offers: [at('www.wrong.example', 199), at('amazon.com', 248)] } }));
  const gone = await removeOffer(store, 'w1', 'https://www.wrong.example/p');
  assert.equal(gone.price, 199);
  let it = await store.getItem('w1');
  assert.deepEqual(it.deals.offers.map((o) => o.price), [248]);
  assert.deepEqual(it.dealSkip, ['wrong.example']);
  assert.deepEqual(dealsInput(it).skip, ['wrong.example']);
  assert.equal(await removeOffer(store, 'w1', 'https://www.wrong.example/p'), null, 'already gone');
  // The provider returning that store again doesn't bring it back.
  const answer = dealsAnswer({ offers: [offer('Wrong', 190, { url: 'https://www.wrong.example/p' }), offer('Other', 240)], confidence: 0.9 }, new Set(['https://www.wrong.example/p', 'https://other.example/arc-2']), dealsInput(it));
  assert.deepEqual(answer.offers.map((o) => o.host), ['other.example']);
  const sub = dealsAnswer({ offers: [offer('Wrong', 190, { url: 'https://shop.wrong.example/p' })], confidence: 0.9 }, new Set(['https://shop.wrong.example/p']), dealsInput(it));
  assert.deepEqual(sub.offers, [], 'the same store on another subdomain is skipped too');
  await restoreOffer(store, 'w1', gone, checkedAt);
  it = await store.getItem('w1');
  assert.deepEqual(it.deals.offers.map((o) => o.price), [199, 248]);
  assert.equal('dealSkip' in it, false);
  // Undo after a newer lookup: the store is searched again, but old prices aren't mixed into new ones.
  const again = await removeOffer(store, 'w1', 'https://amazon.com/p');
  await store.updateItem('w1', { deals: { checkedAt: new Date(Date.now() + 1000).toISOString(), offers: [at('target.com', 250)] } }, { by: 'deals' });
  await restoreOffer(store, 'w1', again, checkedAt);
  it = await store.getItem('w1');
  assert.deepEqual(it.deals.offers.map((o) => o.price), [250]);
  assert.equal('dealSkip' in it, false);
});

test('the last removed offer leaves the save saying no prices were found', async () => {
  const store = await newStore();
  await store.addItem(product({ deals: { checkedAt: new Date().toISOString(), offers: [at('wrong.example', 199)] } }));
  await removeOffer(store, 'w1', 'https://wrong.example/p');
  assert.equal(dealSummary(await store.getItem('w1')).state, 'none');
});

test('what a lookup costs: known for Claude models, never guessed for others', () => {
  const usage = { inputTokens: 30000, outputTokens: 600, searches: 3 };
  assert.equal(Math.round(lookupCost(usage, 'anthropic', 'claude-haiku-5-5') * 1e4) / 1e4, 0.0333);
  assert.equal(markDoubt([at('a.example', 100, { currency: 'EUR' }), at('amazon.com', 250)], product({ price: null, currency: '' }))[0].doubt, undefined, 'prices in two currencies are not measured against each other');
  assert.equal(Math.round(lookupCost(usage, 'anthropic', 'claude-sonnet-5-5') * 1e4) / 1e4, 0.096);
  assert.equal(lookupCost(usage, 'openai', 'gpt-x'), null);
  assert.equal(lookupCost(usage, 'anthropic', 'claude-some-future-model'), null);
  assert.equal(lookupCost(null, 'anthropic', 'claude-haiku-5-5'), null);
  const est = lookupEstimate({ ai: { on: true, provider: 'anthropic', model: 'claude-haiku-5-5' } });
  assert.ok(est > 0.02 && est < 0.04, `about 3 cents on Haiku, was ${est}`);
  assert.equal(lookupEstimate({ ai: { on: true, provider: 'openai', model: 'gpt-x' } }), null);
  assert.ok(TYPICAL_LOOKUP.searches > 0);
});

test('the monthly total adds each lookup, starts again each month, and counts what it cannot price', () => {
  const u = { inputTokens: 30000, outputTokens: 600, searches: 3 };
  let s = addSpend(null, u, 'anthropic', 'claude-haiku-5-5', '2026-11');
  s = addSpend(s, u, 'anthropic', 'claude-haiku-5-5', '2026-11');
  assert.deepEqual(s, { month: '2026-11', lookups: 2, usd: 0.0666, unpriced: 0 });
  s = addSpend(s, u, 'openai', 'gpt-x', '2026-11');
  assert.deepEqual(s, { month: '2026-11', lookups: 3, usd: 0.0666, unpriced: 1 });
  s = addSpend(s, u, 'anthropic', 'claude-haiku-5-5', '2026-12');
  assert.deepEqual(s, { month: '2026-12', lookups: 1, usd: 0.0333, unpriced: 0 });
  assert.deepEqual(spendThisMonth({ wish: { spend: s } }, new Date('2026-12-05T00:00:00Z')), s);
  assert.equal(spendThisMonth({ wish: { spend: s } }, new Date('2027-01-05T00:00:00Z')).lookups, 0);
  assert.equal(spendThisMonth({}).lookups, 0);
});

test('Find deals puts the lookup on this month’s total, even when it finds nothing', async () => {
  const store = await newStore({ ai: { on: true, provider: 'anthropic', model: 'claude-haiku-5-5' } });
  await store.addItem(product());
  const real = globalThis.fetch;
  globalThis.fetch = async () => reply({ product: 'Soundfield Arc 2', offers: [], confidence: 0.9 }, []);
  try {
    await findDeals(store, 'w1', { now: () => new Date('2026-11-23T10:00:00Z') });
    await findDeals(store, 'w1', { now: () => new Date('2026-11-23T11:00:00Z') });
  } finally { globalThis.fetch = real; }
  const sp = spendThisMonth(await store.getSettings(), new Date('2026-11-24T00:00:00Z'));
  assert.equal(sp.lookups, 2);
  assert.ok(sp.usd > 0.05 && sp.usd < 0.07, `two lookups at about 3 cents, was ${sp.usd}`);
});

test('a rename while the search runs keeps the old name’s prices off the save, and an unusable answer still counts as spent', async () => {
  const store = await newStore({ ai: { on: true, provider: 'anthropic', model: 'claude-haiku-5-5' } });
  await store.addItem(product());
  const real = globalThis.fetch;
  const offers = [offer('Amazon', 248, { url: 'https://www.amazon.com/arc-2' })];
  globalThis.fetch = async () => {
    await setWishName(store, 'w1', 'Soundfield Arc 2 Pro');   // you renamed it mid-search
    return reply({ product: 'Soundfield Arc 2', offers, confidence: 0.9 }, offers.map((o) => o.url));
  };
  try {
    const r = await findDeals(store, 'w1');
    assert.equal(r.skipped, true);
    const it = await store.getItem('w1');
    assert.equal(it.deals, undefined);
    assert.equal(it.wishName, 'Soundfield Arc 2 Pro');
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'Sorry, no.' }], usage: { input_tokens: 9000, output_tokens: 50, server_tool_use: { web_search_requests: 1 } } }) });
    await assert.rejects(findDeals(store, 'w1'), /usable answer/);
  } finally { globalThis.fetch = real; }
  assert.equal(spendThisMonth(await store.getSettings()).lookups, 2);
});

// --- The line on a product's card ---------------------------------------------------------------------
import { dealLine } from '../keepsake/src/shared/wishlist.js';

test('a card says the lowest trusted price only when it beats what you saved it at', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const fresh = '2026-11-27T11:00:00Z';
  const deals = (offers, checkedAt = fresh) => ({ deals: { checkedAt, offers } });
  assert.equal(dealLine(product(deals([at('amazon.com', 248, { store: 'Amazon' }), at('bestbuy.com', 259)])), now), 'Now $248.00 at Amazon');
  assert.equal(dealLine(product(deals([at('amazon.com', 299, { store: 'Amazon' })])), now), '', 'not lower than the 279 it was saved at');
  assert.equal(dealLine(product({ price: null, ...deals([at('amazon.com', 248, { store: 'Amazon' })]) }), now), '$248.00 at Amazon', 'no saved price: just the price');
  assert.equal(dealLine(product(deals([at('tedstore.example', 150), at('amazon.com', 290, { store: 'Amazon' })])), now), '', 'a too-good price is never put on the card');
  assert.equal(dealLine(product(deals([at('amazon.com', 248, { outOfStock: true })])), now), '', 'out of stock');
  assert.equal(dealLine(product(deals([at('amazon.com', 248)], '2026-11-24T11:00:00Z')), now), '', 'three days old: prices may have moved');
  assert.equal(dealLine(product({ purchased: true, ...deals([at('amazon.com', 248)]) }), now), '');
  assert.equal(dealLine(product({ wishHidden: true, ...deals([at('amazon.com', 248)]) }), now), '');
  assert.equal(dealLine(product(), now), '');
  assert.equal(dealLine(null, now), '');
});
