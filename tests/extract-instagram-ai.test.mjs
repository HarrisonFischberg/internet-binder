// Page extraction (in jsdom, not Chrome), Instagram post parsing, and the optional-AI boundary with a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const EXTRACT = readFileSync(new URL('../keepsake/src/extract/extract.js', import.meta.url), 'utf8');

function extractFrom(html, url = 'https://shop.example/products/tent', hints = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.__keepsakeHints = hints;
  return dom.window.eval(EXTRACT);
}

test('extract: JSON-LD Product wins (title, price, currency, brand, image, category)', () => {
  const p = extractFrom(`<html><head><title>Tent | Shop</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Two-person ultralight tent","brand":{"@type":"Brand","name":"North Ridge"},"image":["https://cdn.shop.example/tent.jpg"],"category":"Camping > Tents","offers":{"@type":"Offer","price":"329.00","priceCurrency":"USD"}}</script>
    <meta property="og:title" content="OG title should lose"></head><body><h1>Tent</h1></body></html>`);
  assert.equal(p.title, 'Two-person ultralight tent');
  assert.equal(Number(p.price ?? Number(String(p.priceText).replace(/[^0-9.]/g, ''))), 329);
  assert.equal(p.currency, 'USD');
  assert.equal(p.image, 'https://cdn.shop.example/tent.jpg');
  assert.equal(p.source, 'jsonld');
});

test('extract: Open Graph fallback', () => {
  const p = extractFrom(`<html><head><title>x</title>
    <meta property="og:title" content="Linen lampshade, 40 cm drum">
    <meta property="og:image" content="https://cdn.fenwick.example/shade.jpg">
    <meta property="og:site_name" content="Fenwick Home">
    <meta property="product:price:amount" content="64.00"><meta property="product:price:currency" content="GBP"></head><body></body></html>`);
  assert.equal(p.title, 'Linen lampshade, 40 cm drum');
  assert.equal(p.image, 'https://cdn.fenwick.example/shade.jpg');
  assert.equal(p.retailer, 'Fenwick Home');
  assert.match(String(p.price ?? p.priceText), /64/);
});

test('extract: a page with no product data is marked sparse and keeps the page title', () => {
  const p = extractFrom('<html><head><title>Summer reading list</title></head><body><p>Some words</p></body></html>', 'https://notes.example/list');
  assert.equal(p.title, 'Summer reading list');
  assert.equal(p.sparse, true);
  assert.equal(p.canonicalUrl, 'https://notes.example/list');
});

test('extract: canonical link and selection hint', () => {
  const p = extractFrom('<html><head><title>T</title><link rel="canonical" href="https://shop.example/p/1"></head><body></body></html>', 'https://shop.example/p/1?utm_source=x', { selectionText: 'A selected sentence.' });
  assert.equal(p.canonicalUrl, 'https://shop.example/p/1');
  assert.equal(p.description, 'A selected sentence.');
});

// --- Instagram -----------------------------------------------------------------------------
const { window } = new JSDOM('');
globalThis.DOMParser = window.DOMParser;
const { parsePostHtml, titleFromCaption, postKindFromUrl } = await import('../keepsake/src/instagram/post.js');

test('instagram: post page parsed from meta tags; javascript: and instagram links rejected', () => {
  const html = `<html><head><title>x</title>
    <meta property="og:description" content="1,234 likes, 12 comments - slowmornings on March 3, 2026: &quot;Morning light in the kitchen corner. Lamp from https://fenwick.example/shade and javascript:alert(1) #kitchen #lamp @friend&quot;">
    <meta property="og:image" content="https://scontent.cdninstagram.com/v/abc.jpg"></head><body></body></html>`;
  const d = parsePostHtml(html, 'https://www.instagram.com/p/AbCdE12/');
  assert.equal(d.ok, true);
  assert.equal(d.type, 'post');
  assert.equal(d.shortcode, 'AbCdE12');
  assert.match(d.caption, /Morning light/);
  assert.ok(d.hashtags.includes('kitchen'));
  assert.ok(d.links.some((l) => l.url.startsWith('https://fenwick.example')));
  assert.ok(!d.links.some((l) => /javascript:|instagram\.com/.test(l.url)));
  assert.equal(d.loginWall, false);
});

test('instagram: login wall detected', () => {
  const d = parsePostHtml('<html><head><title>Login</title></head><body><form id="loginForm"><input name="username"></form></body></html>', 'https://www.instagram.com/reel/AbCdE12/');
  assert.equal(d.loginWall, true);
  assert.equal(d.ok, false);
  assert.equal(d.type, 'reel');
});

test('instagram: titles from captions', () => {
  assert.equal(titleFromCaption('✨ Morning light in the kitchen. More soon', 'slow'), 'Morning light in the kitchen.');
  assert.equal(titleFromCaption('#tbt', 'slow', 'reel'), 'Reel by @slow');
  assert.equal(titleFromCaption('', ''), 'Instagram post');
  assert.deepEqual(postKindFromUrl('https://www.instagram.com/reels/XyZ123/'), { shortcode: 'XyZ123', type: 'reel' });
});

// --- Optional AI boundary --------------------------------------------------------------------
const { cleanupWithAI, findProductOnline, describePayload, originFor } = await import('../keepsake/src/ai/provider.js');

function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => JSON.stringify(reply) }; };
  return { fn, calls };
}
const anthropic = { ai: { on: true, provider: 'anthropic', model: 'claude-test' } };
const cols = [{ id: 'k', name: 'Kitchen' }, { id: 'h', name: 'Home Decor' }];

test('AI cleanup: only prices present in the input survive, only existing collections are accepted', async () => {
  const text = JSON.stringify({ items: [
    { ref: 'a', title: 'Dutch oven 5.5 qt', price: 199, currency: 'USD', collection: 'Kitchen', confidence: 0.9 },
    { ref: 'b', title: 'Lamp', price: 12.34, collection: 'Invented collection', confidence: 0.99 },
  ] });
  const { fn, calls } = fakeFetch({ content: [{ type: 'text', text }] });
  globalThis.fetch = fn;
  const out = await cleanupWithAI([
    { ref: 'a', item: { title: 'Buy Dutch Oven 5.5qt | Free shipping', price: 199, currency: 'USD' } },
    { ref: 'b', item: { title: 'lamp', price: 64 } },
  ], cols, anthropic, 'sk-test');
  assert.equal(out.get('a').price, 199);
  assert.equal(out.get('a').collectionId, 'k');
  assert.equal(out.get('b').price, null, 'a price the model made up is dropped');
  assert.equal(out.get('b').collectionId, null, 'a collection the model made up is dropped');
  assert.equal(calls[0].opts.headers['x-api-key'], 'sk-test');
  assert.ok(calls[0].url.startsWith('https://api.anthropic.com'));
  const sent = JSON.stringify(calls[0].body);
  assert.ok(sent.includes('Kitchen') && sent.includes('Dutch'));
});

test('AI find online: links not in the search results are dropped', async () => {
  const text = JSON.stringify({ candidates: [
    { name: 'Real lamp', url: 'https://fenwick.example/shade/', price: 64, confidence: 0.8 },
    { name: 'Made-up lamp', url: 'https://invented.example/x', price: 10 },
  ] });
  const { fn } = fakeFetch({ content: [
    { type: 'web_search_tool_result', content: [{ url: 'https://fenwick.example/shade' }] },
    { type: 'text', text },
  ] });
  globalThis.fetch = fn;
  const r = await findProductOnline({ caption: 'lamp', creator: 'slow', thumbnail: 'https://remote.example/img.jpg' }, anthropic, 'sk-test');
  assert.equal(r.candidates[0].verified, true);
  assert.equal(r.candidates[0].url, 'https://fenwick.example/shade/');
  assert.equal(r.candidates[1].verified, false);
  assert.equal(r.candidates[1].url, '');
});

test('AI: remote thumbnails are never forwarded; only local data: images are', async () => {
  const { fn, calls } = fakeFetch({ content: [{ type: 'text', text: '{"candidates":[]}' }] });
  globalThis.fetch = fn;
  await findProductOnline({ caption: 'x', thumbnail: 'https://scontent.cdninstagram.com/a.jpg' }, anthropic, 'k');
  assert.ok(!JSON.stringify(calls[0].body).includes('cdninstagram'));
  await findProductOnline({ caption: 'x', thumbnail: 'data:image/jpeg;base64,QUJD' }, anthropic, 'k');
  assert.equal(calls[1].body.messages[0].content[0].type, 'image');
});

test('AI: payload preview and provider origin', () => {
  const p = describePayload({ caption: 'Lamp', creator: 'slow', instagram: {} });
  assert.equal(typeof p.text, 'string');
  assert.match(originFor(anthropic), /^https:\/\/api\.anthropic\.com/);
});

test('AI: missing key and provider errors are reported, not swallowed', async () => {
  await assert.rejects(findProductOnline({ caption: 'x' }, anthropic, ''), /API key/);
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(cleanupWithAI([{ ref: 'a', item: { title: 't' } }], cols, anthropic, 'bad'), /Provider error \(401\): invalid x-api-key/);
});

test('extract: a page reached without a reload ignores the previous page’s tags (YouTube in-app navigation)', () => {
  // Head still describes video A; the address, tab title and screen show video B.
  const p = extractFrom(`<html><head><title>Second video title - YouTube</title>
    <meta property="og:url" content="https://www.youtube.com/watch?v=AAAAAAAAAAA">
    <meta property="og:title" content="First video title"><meta property="og:type" content="video.other">
    <meta property="og:description" content="First video description"><meta property="og:image" content="https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg">
    <meta property="og:site_name" content="YouTube"></head><body>
    <span itemprop="author"><link itemprop="name" content="First Channel"></span><meta itemprop="duration" content="PT0M19S"><meta itemprop="uploadDate" content="2005-04-23">
    <ytd-watch-metadata><h1>Second video title</h1><ytd-channel-name><a href="/@second">Second Channel</a></ytd-channel-name></ytd-watch-metadata>
    <div class="html5-video-player"><span class="ytp-time-duration">6:50</span></div></body></html>`, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
  assert.equal(p.title, 'Second video title');
  assert.equal(p.image, 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg');
  assert.equal(p.description, '', 'the first video’s description is not used');
  assert.deepEqual([p.media.channel, p.media.duration, p.media.published], ['Second Channel', '6:50', '']);
  assert.ok(p.signals.includes('stale-head'));

  // While an ad plays, the player's clock is the ad's: no length rather than a wrong one.
  const ad = extractFrom(`<html><head><title>Second video title - YouTube</title><meta property="og:url" content="https://www.youtube.com/watch?v=BBBBBBBBBBB"></head><body>
    <ytd-watch-metadata><h1>Second video title</h1></ytd-watch-metadata><div class="html5-video-player ad-showing"><span class="ytp-time-duration">0:15</span></div></body></html>`, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
  assert.equal(ad.media.duration, '');

  // A shop whose og:url is the short product path is not stale: its tags are still read.
  const shop = extractFrom(`<html><head><title>Linen shirt – Example Shop</title><meta property="og:url" content="https://shop.example/products/linen-shirt">
    <meta property="og:title" content="Linen shirt"><meta property="og:image" content="https://shop.example/shirt.jpg"></head><body><h1>Linen shirt</h1></body></html>`, 'https://shop.example/collections/summer/products/linen-shirt');
  assert.equal(shop.image, 'https://shop.example/shirt.jpg');
  assert.ok(!shop.signals.includes('stale-head'));

  // The home page's tags on an inner page are stale.
  const home = extractFrom(`<html><head><title>A recipe – Cook</title><meta property="og:url" content="https://cook.example/"><meta property="og:title" content="Cook"><meta property="og:image" content="https://cook.example/logo.png"></head><body><h1>A recipe</h1></body></html>`, 'https://cook.example/recipes/a-recipe');
  assert.notEqual(home.image, 'https://cook.example/logo.png');
});
