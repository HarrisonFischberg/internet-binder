// url.js, util.js and categorizer.js: pure logic shared by every platform (and the golden set for iOS later).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, cleanUrl, isRestrictedUrl, openableUrl } from '../keepsake/src/shared/url.js';
import { parsePrice, sanitizeUrl, sanitizeText, deepMerge, prettyRetailer } from '../keepsake/src/shared/util.js';
import { classify, emptyPrefs, learnFromCorrection, forgetCollection, normalizeName, findSimilarCollection, salientTerms } from '../keepsake/src/shared/categorizer.js';
import { defaultCollections, makeCollection } from '../keepsake/src/shared/storage.js';

test('normalizeUrl: tracking parameters are ignored, product parameters kept', () => {
  assert.equal(normalizeUrl('https://www.Shop.com/Products/Tent/?utm_source=x&color=red&fbclid=1'), 'shop.com/products/tent?color=red');
  assert.equal(normalizeUrl('https://shop.com/products/tent?color=red'), normalizeUrl('https://m.shop.com/products/tent/?color=red&gclid=9'));
});

test('normalizeUrl: marketplace and Instagram keys', () => {
  assert.equal(normalizeUrl('https://www.amazon.com/Some-Title/dp/B0ABCDEFGH/ref=sr_1?th=1'), 'amazon.com/dp/B0ABCDEFGH');
  assert.equal(normalizeUrl('https://www.etsy.com/listing/12345/slug?ref=x'), 'etsy.com/listing/12345');
  assert.equal(normalizeUrl('https://www.ebay.com/itm/some-thing/123456789012?hash=1'), 'ebay.com/itm/123456789012');
  assert.equal(normalizeUrl('https://www.instagram.com/someone/reel/AbC123/?igsh=1'), 'instagram.com/reel/AbC123');
  assert.equal(normalizeUrl('https://www.instagram.com/reels/AbC123/'), 'instagram.com/reel/AbC123');
});

test('normalizeUrl: non-web URLs give no key', () => {
  for (const u of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/hosts', '', 'not a url']) assert.equal(normalizeUrl(u), '');
});

test('cleanUrl keeps the path, drops tracking', () => {
  assert.equal(cleanUrl('https://www.Shop.com/Products/Tent/?utm_source=x&color=red&fbclid=1'), 'https://www.shop.com/Products/Tent/?color=red');
});

test('isRestrictedUrl and openableUrl', () => {
  assert.equal(isRestrictedUrl('chrome://settings'), true);
  assert.equal(isRestrictedUrl('javascript:alert(1)'), true);
  assert.equal(isRestrictedUrl('https://shop.com/x'), false);
  // Reels open through /p/ so a logged-in session doesn't reroute to the reels feed (1.0.3 fix).
  assert.equal(openableUrl('https://www.instagram.com/someone/reel/AbC123/?igsh=1'), 'https://www.instagram.com/p/AbC123/');
});

test('parsePrice: common formats', () => {
  assert.deepEqual(parsePrice('$1,299.99'), { amount: 1299.99, currency: 'USD' });
  assert.deepEqual(parsePrice('€ 12,50'), { amount: 12.5, currency: 'EUR' });
  assert.deepEqual(parsePrice('12,50 €'), { amount: 12.5, currency: 'EUR' });
  assert.deepEqual(parsePrice('£45'), { amount: 45, currency: 'GBP' });
  assert.deepEqual(parsePrice('USD 30'), { amount: 30, currency: 'USD' });
  assert.equal(parsePrice('free'), null);
});

test('parsePrice: yen without separators', { todo: 'known bug found in M0: ¥1200 parses as 120' }, () => {
  assert.deepEqual(parsePrice('¥1200'), { amount: 1200, currency: 'JPY' });
});

test('sanitizers reject script URLs and strip control characters', () => {
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('data:image/png;base64,AA'), '');
  assert.equal(sanitizeUrl('data:image/png;base64,AA', { allowData: true }), 'data:image/png;base64,AA');
  assert.equal(sanitizeUrl('https://ok.example/a'), 'https://ok.example/a');
  assert.equal(sanitizeText('  a \u0000 b  ', 10), 'a b');
  assert.equal(sanitizeText('x'.repeat(50), 10).length, 10);
});

test('deepMerge and prettyRetailer', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } }), { a: { b: 1, c: 3 } });
  assert.equal(typeof prettyRetailer('www.copperlane.example'), 'string');
});

// --- categorizer -------------------------------------------------------------------------
const starter = () => Object.values(defaultCollections());
const ctx = (collections = starter(), prefs = emptyPrefs()) => ({ collections, prefs, settings: {} });

test('starter collections are Home Decor, Clothing, Technology', () => {
  assert.deepEqual(starter().map((c) => c.taxonomyKey), ['home', 'clothing', 'tech']);
});

const GOLDEN = [
  ['Two-person ultralight backpacking tent', 'camping', true],
  ['Noise-cancelling over-ear headphones', 'tech', false],
  ['Enameled cast iron Dutch oven, 5.5 qt', 'kitchen', true],
  ['Waxed cotton field jacket', 'clothing', false],
  ['Ceramic bedside lamp with linen shade', 'home', false],
  ['Cordless brushless drill driver kit 18V', 'tools', true],
];
for (const [title, key, isNew] of GOLDEN) {
  test(`classify golden: ${title}`, () => {
    const r = classify({ title }, ctx());
    assert.equal(r.taxonomyKey, key);
    assert.equal(r.isNew, isNew, 'isNew means the default taxonomy collection will be created on save');
    assert.equal(r.isInbox, false);
    assert.ok(r.confidence >= 0.75, `confidence ${r.confidence} should auto-file`);
    assert.ok(r.reason.length > 0);
  });
}

test('classify: no signals goes to Review instead of guessing', () => {
  const r = classify({ title: 'Untitled page' }, ctx());
  assert.equal(r.isInbox, true);
  assert.equal(r.collectionId, null);
});

test('classify: threshold above the score sends to Review with a suggestion', () => {
  const r = classify({ title: 'Waxed cotton field jacket' }, ctx(starter(), { ...emptyPrefs(), confidenceThreshold: 0.95 }));
  assert.equal(r.isInbox, true);
  assert.ok(r.suggested && r.suggested.collectionName);
});

test('classify: a user keyword wins and makes Keepsake at least 85% sure', () => {
  const gifts = makeCollection({ name: 'For Mum', keywords: ['scarf'] });
  const r = classify({ title: 'Cashmere scarf, grey' }, ctx([...starter(), gifts]));
  assert.equal(r.collectionId, gifts.id);
  assert.ok(r.confidence >= 0.85);
});

test('classify: the same user keyword on two collections goes to Review', () => {
  const a = makeCollection({ name: 'Birthday', keywords: ['candle'] });
  const b = makeCollection({ name: 'Bathroom', keywords: ['candle'] });
  const r = classify({ title: 'Soy candle' }, ctx([...starter(), a, b]));
  assert.equal(r.isInbox, true);
});

test('classify: a matching Instagram collection name is a direct hit', () => {
  const cols = starter();
  const r = classify({ title: 'Instagram post', instagram: { collectionName: 'Home decor' } }, ctx(cols));
  assert.equal(r.collectionId, cols[0].id);
  assert.equal(r.confidence, 0.92);
});

test('learnFromCorrection teaches terms and retailer; strong weighs more; forgetCollection moves weights', () => {
  const cols = starter();
  const [home, clothing] = cols;
  const item = { title: 'Linen throw blanket', host: 'fenwick.example' };
  const light = learnFromCorrection(item, clothing.id, home.id, emptyPrefs());
  const strong = learnFromCorrection(item, clothing.id, home.id, emptyPrefs(), { strong: true });
  const term = salientTerms(item)[0];
  assert.ok(light.learnedKeywords[term][home.id] > 0);
  assert.ok(strong.learnedKeywords[term][home.id] > light.learnedKeywords[term][home.id]);
  assert.equal(light.retailerPrefs['fenwick.example'][home.id], 1);
  assert.equal(light.corrections.length, 1);
  const moved = forgetCollection(light, home.id, clothing.id);
  assert.equal(moved.learnedKeywords[term][home.id], undefined);
  assert.ok(moved.learnedKeywords[term][clothing.id] > 0);
});

test('corrections history is capped at 200', () => {
  let p = emptyPrefs();
  const [home, clothing] = starter();
  for (let i = 0; i < 210; i++) p = learnFromCorrection({ title: `thing ${i}` }, clothing.id, home.id, p);
  assert.equal(p.corrections.length, 200);
});

test('collection name similarity', () => {
  assert.equal(normalizeName('Lamps'), normalizeName('lamp'));
  assert.equal(normalizeName('Home Décor'), 'home decor');
  assert.ok(findSimilarCollection('home decor', starter()));
});
