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

test('extract: structured data wrapped in CDATA comments is still read (a film page)', () => {
  const p = extractFrom(`<html><head><title>A Film (1999) • Films Example</title><meta property="og:type" content="video.movie">
    <script type="application/ld+json">
/* <![CDATA[ */
{"@context":"http://schema.org","@type":"Movie","name":"A Film","director":[{"@type":"Person","name":"A. Director"}],"dateCreated":"1999-03-31","genre":["Science Fiction"],"image":"https://films.example/poster.jpg"}
/* ]]> */
</script></head><body><h1>A Film</h1></body></html>`, 'https://films.example/film/a-film/');
  assert.ok(p.schemaTypes.includes('movie'));
  assert.equal(p.screen.director[0].name, 'A. Director');
  assert.equal(p.image, 'https://films.example/poster.jpg');
});

test('extract: an Instagram reel reached from the grid: its own caption from the page data (not the grid’s), or from the screen', () => {
  const data = JSON.stringify({ items: [
    { code: 'GRIDPOST1', caption: { text: 'Some other post 📍 Somewhere Else' }, user: { username: 'other' } },
    { code: 'REEL12345', caption: { text: 'Best donuts\n📍 Example Donuts\n186 Bleecker St, New York, NY' }, user: { username: 'nyceats' }, location: { name: 'Example Donuts NYC' } },
  ] });
  const p = extractFrom(`<html><head><title>Instagram</title><meta property="og:url" content="https://www.instagram.com/explore/"><meta property="og:title" content="Instagram"></head>
    <body><main><script type="application/json">${data}</script></main></body></html>`, 'https://www.instagram.com/reel/REEL12345/');
  assert.ok(p.isInstagram);
  assert.equal(p.igBundle.scripts.length, 1);
  assert.equal(Object.keys(p.igBundle.meta).length, 0, 'the grid’s head tags are not used');
  const onScreen = extractFrom(`<html><head><title>Instagram</title></head><body><main><div><span dir="auto">Best donuts 🍩
📍 Example Donuts
186 Bleecker St, New York, NY</span></div></main></body></html>`, 'https://www.instagram.com/reel/REEL99999/');
  assert.match(onScreen.igBundle.visibleCaption, /📍 Example Donuts\n186 Bleecker St/);
});

test('extract: a restaurant’s own site with no place data: its visible address block, phone and hours', () => {
  const p = extractFrom(`<html><head><title>Home | Example Banh Mi</title><meta property="og:site_name" content="Example Banh Mi"><meta property="og:type" content="website"></head><body>
<main><h1>Fresh sandwiches daily</h1></main><footer>
Visit Our Shop
Location
560 Larkin St
San Francisco, CA 94102
Phone
(415) 555-0123
Opening Hours
Mon–Tue: 7:00 AM – 5:30 PM
Wed-Sunday: 7:00 AM - 6:00 PM
</footer></body></html>`, 'https://banhmi.example/');
  assert.deepEqual([p.pagePlace.address, p.pagePlace.locality, p.pagePlace.region, p.pagePlace.postalCode, p.pagePlace.phone, p.pagePlace.hours.length, p.pagePlace.visit],
    ['560 Larkin St', 'San Francisco', 'CA', '94102', '(415) 555-0123', 2, true]);
});

test('extract: a listing’s Address block (city and postcode on their own lines) and time-only hours', () => {
  const p = extractFrom(`<html><head><title>Example Shoppe | Listings</title></head><body><main><h1>Example Shoppe</h1><p>Lovely ice cream.</p>

Details
Address
5337 W Devon Ave
Chicago
60646
Opening hours:
10am–11pm
Directions
</main></body></html>`, 'https://listings.example/chicago/example-shoppe');
  assert.deepEqual([p.pagePlace.address, p.pagePlace.locality, p.pagePlace.postalCode, [...p.pagePlace.hours], p.pagePlace.labeled], ['5337 W Devon Ave', 'Chicago', '60646', ['10am–11pm'], true]);
});

test('extract: an Instagram profile’s name and bio (only from its own head tags), and a Facebook page’s Intro', () => {
  const ig = extractFrom(`<html><head><title>GO DONUTS (@godonuts_harlem) • Instagram photos and videos</title><meta property="og:url" content="https://www.instagram.com/godonuts_harlem/">
<meta property="og:title" content="GO DONUTS (@godonuts_harlem) • Instagram photos and videos"><meta name="description" content="32K Followers, 2 Following, 125 Posts - GO DONUTS (@godonuts_harlem) on Instagram: &quot;The Best Mini Donuts&#10;2309 2nd avenue New York, NY 10035&quot;"></head><body><header><div>godonuts_harlem</div><div>31.9K</div><div>followers</div></header></body></html>`, 'https://www.instagram.com/godonuts_harlem/');
  assert.deepEqual([ig.profile.platform, ig.profile.handle, ig.profile.name, ig.profile.bio], ['instagram', 'godonuts_harlem', 'GO DONUTS', 'The Best Mini Donuts\n2309 2nd avenue New York, NY 10035']);
  const stale = extractFrom(`<html><head><meta property="og:url" content="https://www.instagram.com/someoneelse/"><meta property="og:title" content="Other (@someoneelse)"></head><body></body></html>`, 'https://www.instagram.com/godonuts_harlem/');
  assert.equal(stale.profile.name, '', 'another page’s tags are not read');
  assert.equal(extractFrom('<html><body></body></html>', 'https://www.instagram.com/p/ABCDE12345/').profile, null, 'a post is not a profile');
  const fb = extractFrom(`<html><head><meta property="og:url" content="https://www.facebook.com/riseokc/"><meta property="og:title" content="Rise Bakery"><meta property="og:description" content="Rise Bakery, Oklahoma City. 294 followers."></head>
<body><div role="main">
Rise Bakery
Intro
Sourdough cinnamon rolls every Friday!
Page · Entrepreneur
Oklahoma City, OK, United States, Oklahoma
(405) 201-3982
Photos
See all photos
</div></body></html>`, 'https://www.facebook.com/riseokc');
  assert.deepEqual([fb.profile.platform, fb.profile.name, [...fb.profile.intro]], ['facebook', 'Rise Bakery', ['Sourdough cinnamon rolls every Friday!', 'Page · Entrepreneur', 'Oklahoma City, OK, United States, Oklahoma', '(405) 201-3982']]);
});

test('extract: a home page with no address: the business’s name, about, phone and a locations link', () => {
  const p = extractFrom(`<html><head><title>Mighty Example Donuts | Organic Donuts</title><meta property="og:site_name" content="Mighty Example Donuts">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},{"@type":"Organization","name":"Mighty Example Donuts","description":"Donuts for everyone","telephone":"+12065550335"}]}</script></head>
<body><main><h1>Best donut shop</h1></main><footer><a href="/locations/">Our Locations</a></footer></body></html>`, 'https://donuts.example/');
  assert.deepEqual([p.home.name, p.home.siteName, p.home.phone, p.home.visitLink], ['Mighty Example Donuts', 'Mighty Example Donuts', '+12065550335', true]);
  assert.ok(!extractFrom('<html><body><p>x</p></body></html>', 'https://donuts.example/menu/').home, 'only a home page');
});

test('instagram: a post’s location tag keeps its street, city and pin', () => {
  const data = JSON.stringify({ items: [{ code: 'LOCTAG123', caption: { text: 'Best slice in the city' }, user: { username: 'nyceats' },
    location: { pk: 1, name: 'Example Pizza', address: '7 Carmine St', city: 'New York, New York', lat: 40.7305, lng: -74.0021 } }] });
  const d = parsePostHtml(`<html><head><title>x</title></head><body><script type="application/json">${data}</script></body></html>`, 'https://www.instagram.com/p/LOCTAG123/');
  assert.equal(d.location, 'Example Pizza');
  assert.deepEqual({ ...d.place }, { name: 'Example Pizza', address: '7 Carmine St', city: 'New York, New York', region: '', postalCode: '', lat: 40.7305, lng: -74.0021 });
  const old = JSON.stringify({ shortcode_media: { shortcode: 'LOCTAG456', edge_media_to_caption: { edges: [{ node: { text: 'yum' } }] },
    location: { id: '2', name: 'Example Diner', address_json: '{"street_address":"1 Main St","zip_code":"10001","city_name":"New York","region_name":"NY"}' } } });
  const e = parsePostHtml(`<html><body><script type="application/json">${old}</script></body></html>`, 'https://www.instagram.com/p/LOCTAG456/');
  assert.deepEqual([e.place.address, e.place.city, e.place.region, e.place.postalCode, e.place.lat], ['1 Main St', 'New York', 'NY', '10001', null]);
});
