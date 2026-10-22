// Your AI provider working out what a save is and filling in its card (src/shared/understand.js), with a
// fake provider. Shared by Chrome, Safari and iOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { planUnderstanding, pageText, pagesToRead, contextFor, statedShare, understandItem, productFromHtml, planProduct } from '../keepsake/src/shared/understand.js';
import { understandWithAI, understandProductWithAI } from '../keepsake/src/ai/provider.js';
import { sanitizeDetails } from '../keepsake/src/shared/kinds.js';
import { createStore, memoryRecordBackend } from '../keepsake/src/shared/storage.js';

const post = (caption, extra = {}) => ({ id: 'p1', type: 'instagram', kind: 'link', title: caption.split('\n')[0], url: 'https://www.instagram.com/reel/ABCDE/', collectionId: 'kitchen', categorizationSource: 'local', details: {}, instagram: { caption, creator: 'cook', hashtags: [] }, userFields: [], ...extra });
const ai = (kind, details = {}, extra = {}) => ({ kind, confidence: 0.92, title: 'Sugar-free marshmallows', details, drafted: [], reason: 'A recipe in the caption', ...extra });

test('a link in Kitchen that is a recipe moves to Recipes with its ingredients and steps, read from the caption', () => {
  const caption = 'Sugar free marshmallows\nIngredients: 60g powdered gelatin, 400g allulose, 2 tsp vanilla extract\nAdd the gelatin to cold water, then whisk in the hot syrup';
  const item = post(caption);
  const { patch, changes } = planUnderstanding(item, ai('recipe', { ingredients: ['60g powdered gelatin', '400g allulose', '2 tsp vanilla extract'], steps: ['Add the gelatin to cold water', 'Whisk in the hot syrup'], cuisine: 'Dessert' }), caption.toLowerCase());
  assert.equal(patch.kind, 'recipe');
  assert.equal(patch.collectionId, null);
  assert.equal(patch.previousCollections.at(-1), 'kitchen');
  assert.equal(patch.title, 'Sugar-free marshmallows');
  assert.equal(patch.details.ingredients.length, 3);
  assert.equal(patch.details.source, 'ai');
  assert.equal(patch.details.drafted, undefined, 'all of it is in the caption');
  assert.deepEqual(changes.map((c) => c.field), ['kind', 'recipe details', 'title']);
});

test('a recipe that is only in the video: what the provider drafted is marked, even when it says it read it', () => {
  const caption = 'The best brownies I have ever made 😍 #baking';
  const { patch } = planUnderstanding(post(caption), ai('recipe', { ingredients: ['200g dark chocolate', '150g butter', '3 eggs', '120g flour'], steps: ['Melt the chocolate and butter', 'Fold in eggs and flour', 'Bake 25 minutes'] }, { drafted: [] }), caption.toLowerCase());
  assert.equal(patch.kind, 'recipe');
  assert.equal(patch.details.source, 'ai-draft');
  assert.deepEqual(patch.details.drafted.sort(), ['ingredients', 'steps']);
});

test('a workout reel with a drafted routine is a Workout, marked as drafted', () => {
  const caption = 'Full body kettlebell burner 🔥 #homeworkout';
  const { patch } = planUnderstanding(post(caption), ai('workout', { exercises: [{ name: 'Goblet squat', sets: 3, reps: 12 }, { name: 'Kettlebell swing', sets: 3, durationSeconds: 40 }] }, { drafted: ['exercises'] }), caption.toLowerCase());
  assert.equal(patch.kind, 'workout');
  assert.deepEqual(patch.details.exercises.map((e) => [e.name, e.sets, e.reps, e.durationSeconds]), [['Goblet squat', 3, 12, null], ['Kettlebell swing', 3, null, 40]]);
  assert.deepEqual(patch.details.drafted, ['exercises']);
});

test('a restaurant: city, state and cuisine are kept; a street address, phone or hours the post never gave are not', () => {
  const caption = 'Best tacos in Austin 🌮 📍 Veracruz All Natural';
  const { patch } = planUnderstanding(post(caption), ai('place', { address: '1704 E Cesar Chavez St', locality: 'Austin', region: 'TX', cuisine: 'Mexican', phone: '512 555 0100', hours: ['Mon 7–3'], category: 'restaurant' }, { title: 'Veracruz All Natural' }), caption.toLowerCase());
  assert.equal(patch.kind, 'place');
  assert.equal(patch.title, 'Veracruz All Natural');
  assert.deepEqual([patch.details.address, patch.details.phone, patch.details.hours, patch.details.locality, patch.details.region, patch.details.cuisine], ['', '', [], 'Austin', 'TX', 'Mexican']);
  // Stated in the post: kept.
  const withStreet = 'Tacos 📍 Veracruz, 1704 E Cesar Chavez St, Austin TX';
  assert.equal(planUnderstanding(post(withStreet), ai('place', { address: '1704 E Cesar Chavez St', locality: 'Austin' }), withStreet.toLowerCase()).patch.details.address, '1704 E Cesar Chavez St');
});

test('what the save already said stays; the answer only fills the gaps', () => {
  const item = post('pasta', { kind: 'recipe', collectionId: null, details: sanitizeDetails('recipe', { ingredients: ['500g spaghetti', '2 cloves garlic'], steps: [], source: 'caption' }) });
  const { patch } = planUnderstanding(item, ai('recipe', { ingredients: ['1 box pasta'], steps: ['Boil the pasta', 'Toss with garlic oil'], totalMinutes: 20 }), 'pasta boil toss garlic oil');
  assert.equal(patch.kind, undefined);
  assert.deepEqual(patch.details.ingredients, ['500g spaghetti', '2 cloves garlic']);
  assert.deepEqual(patch.details.steps, ['Boil the pasta', 'Toss with garlic oil']);
  assert.equal(patch.details.totalMinutes, 20);
  assert.equal(patch.details.source, 'caption');
});

test('never moved: saves you filed or put in a view yourself, details you wrote, and unsure answers', () => {
  const caption = 'tiramisu recipe';
  assert.deepEqual(planUnderstanding(post(caption, { categorizationSource: 'manual' }), ai('recipe', { ingredients: ['mascarpone'] }), caption).patch, {});
  assert.deepEqual(planUnderstanding(post(caption, { userFields: ['collectionId'] }), ai('recipe', { ingredients: ['mascarpone'] }), caption).patch, {});
  assert.deepEqual(planUnderstanding(post(caption), ai('recipe', { ingredients: ['mascarpone'] }, { confidence: 0.5 }), caption).patch, {});
  const yours = post(caption, { kind: 'workout', userFields: ['kind'], details: { exercises: [], source: 'you' } });
  assert.equal(planUnderstanding(yours, ai('recipe', { ingredients: ['mascarpone'] }, { confidence: 0.99 }), caption).patch.kind, undefined);
  // A Lifestyle kind Patchwork picked changes only when the provider is very sure.
  const picked = post(caption, { kind: 'workout', collectionId: null, details: {} });
  assert.equal(planUnderstanding(picked, ai('recipe', {}, { confidence: 0.8 }), caption).patch.kind, undefined);
  assert.equal(planUnderstanding(picked, ai('recipe', {}, { confidence: 0.9 }), caption).patch.kind, 'recipe');
  // Products and links stay for the shopping check.
  assert.deepEqual(planUnderstanding(post(caption), ai('product'), caption).patch, {});
});

test('a title you wrote stays; a web page keeps its own title unless it is a site name', () => {
  const caption = 'brownies';
  assert.equal(planUnderstanding(post(caption, { userFields: ['title'] }), ai('recipe', { ingredients: ['chocolate'] }), caption).patch.title, undefined);
  const web = { id: 'w', type: 'product', kind: 'link', title: 'Classic Brownies Recipe | Example Kitchen', url: 'https://example.com/brownies', details: {}, userFields: [] };
  assert.equal(planUnderstanding(web, ai('recipe', { ingredients: ['chocolate'] }), 'brownies').patch.title, undefined);
});

test('statedShare: how much of a list the text states', () => {
  assert.equal(statedShare(['60g gelatin', '400g allulose'], 'add 60g gelatin and 400g allulose'), 1);
  assert.equal(statedShare(['200g chocolate', '3 eggs', 'flour'], 'best brownies ever'), 0);
  assert.equal(statedShare([{ name: 'Goblet squat' }], 'goblet squat 3x12'), 1);
});

test('pageText: a page\'s schema.org recipe is written out, then its text without scripts or menus', () => {
  const html = `<html><head><meta property="og:description" content="Fluffy &amp; light">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Recipe","name":"Pancakes","recipeIngredient":["2 cups flour","2 eggs"],"recipeInstructions":[{"@type":"HowToStep","text":"Whisk."},{"@type":"HowToStep","text":"Fry."}],"recipeYield":"8"}]}</script>
    <script>var tracking = 1;</script></head><body><nav>Home Shop</nav><p>Grandma's pancakes.</p></body></html>`;
  const t = pageText(html);
  assert.match(t, /The page's recipe: Pancakes\. Ingredients: 2 cups flour; 2 eggs\. Steps: Whisk\. Fry\./);
  assert.match(t, /Fluffy & light/);
  assert.match(t, /Grandma's pancakes\./);
  assert.doesNotMatch(t, /tracking|Home Shop/);
});

test('pagesToRead: caption links and a web save\'s own page, never social sites or a product', () => {
  assert.deepEqual(pagesToRead({ type: 'instagram', kind: 'link', url: 'https://www.instagram.com/p/X/', instagram: { links: [{ url: 'https://cook.example/brownies' }, { url: 'https://linktr.ee/cook' }, { url: 'https://www.youtube.com/watch?v=1' }] } }), ['https://cook.example/brownies']);
  assert.deepEqual(pagesToRead({ type: 'product', kind: 'link', url: 'https://blog.example/tacos' }), ['https://blog.example/tacos']);
  assert.deepEqual(pagesToRead({ type: 'product', kind: 'product', url: 'https://shop.example/tent' }), []);
});

test('contextFor: the caption, tag and a stored thumbnail go; a remote image link does not', () => {
  const c = contextFor({ ...post('tacos'), image: 'data:image/jpeg;base64,AAAA', instagram: { caption: 'tacos', location: 'Veracruz', place: { name: 'Veracruz', city: 'Austin' }, hashtags: ['austin'] } });
  assert.equal(c.image, 'data:image/jpeg;base64,AAAA');
  assert.match(c.location, /Veracruz · Veracruz, Austin/);
  assert.equal(contextFor({ ...post('tacos'), image: 'https://scontent.cdninstagram.com/1.jpg' }).image, '');
});

test('understandWithAI: one request with the image; the answer is normalised', async () => {
  let body = null;
  globalThis.fetch = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: '```json\n{"kind":"workout","confidence":1.4,"title":"  Leg day  ","details":{"exercises":[{"name":"Squat","sets":3,"seconds":30}]},"drafted":["exercises",5]}\n```' }] }) }; };
  const r = await understandWithAI({ title: 'Leg day', caption: 'legs', image: 'data:image/jpeg;base64,QUJD' }, { ai: { provider: 'anthropic', model: 'm' } }, 'sk');
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.deepEqual([r.kind, r.confidence, r.title, r.details.exercises[0].durationSeconds, r.drafted], ['workout', 1, 'Leg day', 30, ['exercises']]);
});

test('understandItem: reads a save once, applies the answer with Undo, and reads it again when asked', async () => {
  const kv = {};
  const store = createStore({ get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in kv).map((x) => [x, kv[x]])), set: async (o) => Object.assign(kv, o), remove: async () => {}, clear: async () => {}, onChanged: () => () => {} }, memoryRecordBackend());
  await store.init();
  await store.updateSettings({ ai: { on: true, provider: 'anthropic', model: 'm' } });
  await store.setSecret('aiApiKey', 'sk');
  const it = await store.addItem(post('Brownies 😍'));
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ kind: 'recipe', confidence: 0.95, title: 'Brownies', details: { ingredients: ['200g chocolate', '3 eggs'], steps: ['Bake'] }, drafted: ['ingredients', 'steps'] }) }] }) }; };
  const r = await understandItem(store, it.id, { runId: 'run1' });
  assert.deepEqual([r.kind, r.changed], ['recipe', true]);
  const saved = await store.getItem(it.id);
  assert.deepEqual([saved.kind, saved.title, saved.details.source, saved.details.drafted.length, !!saved.understoodAt], ['recipe', 'Brownies', 'ai-draft', 2, true]);
  const log = await store.getAiLog();
  assert.equal(log.at(-1).runId, 'run1');
  assert.equal(log.at(-1).before.kind, 'link');
  assert.equal(await understandItem(store, it.id), null, 'once');
  assert.equal(calls, 1);
  await understandItem(store, it.id, { force: true });
  assert.equal(calls, 2, 'Fix with AI reads it again');
});

// --- Something to buy: the picture says what it is, the shop page says the rest -------------------------

const SHOP = `<html><head><title>Orange Shower Caddy | Bathhaus</title>
<meta property="og:site_name" content="Bathhaus">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Pole Shower Caddy, Tangerine","brand":{"@type":"Brand","name":"Bathhaus"},"description":"A tension-pole caddy with three powder-coated shelves.","sku":"BH-220","color":"Tangerine","material":"Aluminium","offers":{"@type":"Offer","price":"89.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
</head><body>Shop</body></html>`;

test('productFromHtml: a shop page\'s schema.org product, without a DOM', () => {
  const p = productFromHtml(SHOP, 'https://bathhaus.example/caddy');
  assert.deepEqual([p.name, p.brand, p.price, p.currency, p.availability, p.sku, p.siteName, p.structured], ['Pole Shower Caddy, Tangerine', 'Bathhaus', 89, 'USD', 'in_stock', 'BH-220', 'Bathhaus', true]);
  assert.deepEqual(p.specs.map((s) => s.label), ['Colour', 'Material']);
  const og = productFromHtml('<meta property="og:title" content="Lamp"><meta property="product:price:amount" content="40"><meta property="product:price:currency" content="EUR">');
  assert.deepEqual([og.title, og.price, og.currency, og.structured], ['Lamp', 40, 'EUR', false]);
});

const igPost = (extra = {}) => ({ id: 'p2', type: 'instagram', kind: 'link', title: 'Your sign to add more color, every day ✨', url: 'https://www.instagram.com/reel/XYZ/', host: 'www.instagram.com', price: null, currency: '', details: {}, instagram: { caption: 'Your sign to add more color, every day ✨ #bathroom', creator: 'homes', hashtags: ['bathroom'] }, userFields: [], ...extra });
const found = (extra = {}) => ({ name: 'Bathhaus Pole Shower Caddy', brand: 'Bathhaus', model: '', category: 'Shower caddy', summary: 'An orange tension-pole shower caddy with shelves.', features: ['Fits ceilings up to 9 ft'], specs: [{ label: 'Material', value: 'Steel' }, { label: 'Shelves', value: '3' }], listing: { url: 'https://bathhaus.example/caddy', retailer: 'Bathhaus', title: 'Pole Shower Caddy', price: 79, currency: 'USD', availability: '' }, confidence: 0.85, reason: 'The image shows it', searched: true, ...extra });

test('planProduct: a post becomes a product named and priced from its shop page, with the AI summary alongside', () => {
  const page = productFromHtml(SHOP, 'https://bathhaus.example/caddy');
  const { patch, changes } = planProduct(igPost(), found(), page);
  assert.equal(patch.kind, 'product');
  assert.equal(patch.title, 'Pole Shower Caddy, Tangerine', 'the page\'s name wins over the caption and the AI');
  assert.deepEqual([patch.price, patch.currency], [89, 'USD'], 'the page\'s price, not the search snippet\'s');
  assert.equal(patch.details.source, 'page');
  assert.equal(patch.details.summary, 'An orange tension-pole shower caddy with shelves.');
  assert.equal(patch.details.shopUrl, 'https://bathhaus.example/caddy');
  assert.equal(patch.details.shopDescription, 'A tension-pole caddy with three powder-coated shelves.');
  assert.deepEqual(patch.details.specs.map((s) => `${s.label}: ${s.value}`), ['Colour: Tangerine', 'Material: Aluminium', 'Shelves: 3'], 'the page\'s specs first; the AI adds only new ones');
  assert.deepEqual(changes.map((c) => c.field), ['kind', 'product details', 'title', 'price']);
});

test('planProduct: unsure, no page, or your own edits: only what is safe changes', () => {
  const unsure = planProduct(igPost(), found({ confidence: 0.3 }), null);
  assert.equal(unsure.patch.title, undefined, 'not renamed on a guess');
  assert.equal(unsure.patch.price, undefined);
  assert.equal(unsure.patch.details.shopUrl, '');
  assert.equal(unsure.patch.details.source, 'ai');
  const noPage = planProduct(igPost(), found(), null);
  assert.deepEqual([noPage.patch.title, noPage.patch.price, noPage.patch.details.source], ['Bathhaus Pole Shower Caddy', 79, 'ai']);
  const mine = planProduct(igPost({ userFields: ['title', 'price', 'kind'], price: 50 }), found(), null);
  assert.deepEqual([mine.patch.kind, mine.patch.title, mine.patch.price], [undefined, undefined, undefined]);
  const shopSave = planProduct({ ...igPost(), type: 'product', kind: 'product', title: 'Pole Caddy – Bathhaus', host: 'bathhaus.example', price: 89 }, found(), null);
  assert.equal(shopSave.patch.title, undefined, 'a shop page\'s own title stays');
});

test('understandItem: a post of a product is read from its picture, searched, and filled from its shop page', async () => {
  const kv = {};
  const store = createStore({ get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in kv).map((x) => [x, kv[x]])), set: async (o) => Object.assign(kv, o), remove: async () => {}, clear: async () => {}, onChanged: () => () => {} }, memoryRecordBackend());
  await store.init();
  await store.updateSettings({ ai: { on: true, provider: 'anthropic', model: 'm' } });
  await store.setSecret('aiApiKey', 'sk');
  const it = await store.addItem({ ...igPost(), id: undefined, image: 'https://scontent.cdninstagram.com/caddy.jpg' });
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if (!body.tools) return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ kind: 'product', confidence: 0.9, title: 'Shower caddy', details: {}, reason: 'A caddy' }) }] }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [
      { type: 'web_search_tool_result', content: [{ url: 'https://bathhaus.example/caddy' }] },
      { type: 'text', text: JSON.stringify({ ...found(), listing: { ...found().listing }, confidence: 0.88 }) },
    ] }) };
  };
  const pictures = [];
  const r = await understandItem(store, it.id, { runId: 'p' }, { fetchShopPage: async (u) => (u === 'https://bathhaus.example/caddy' ? SHOP : null), loadImage: async (u) => { pictures.push(u); return 'data:image/jpeg;base64,QUJD'; } });
  assert.deepEqual([r.kind, r.changed], ['product', true]);
  assert.equal(bodies.length, 2, 'what it is, then the product with web search');
  assert.equal(bodies[0].messages[0].content[0].type, 'image', 'the picture goes to the first read');
  assert.equal(bodies[1].messages[0].content[0].type, 'image', 'and to the product read');
  assert.match(bodies[1].messages[0].content.at(-1).text, /may be wrong/);
  assert.deepEqual(pictures, ['https://scontent.cdninstagram.com/caddy.jpg'], 'the picture is copied once');
  const saved = await store.getItem(it.id);
  assert.deepEqual([saved.kind, saved.title, saved.price, saved.details.shopName, saved.url], ['product', 'Pole Shower Caddy, Tangerine', 89, 'Bathhaus', 'https://www.instagram.com/reel/XYZ/']);
  const log = (await store.getAiLog()).at(-1);
  assert.deepEqual([log.before.kind, log.before.price, log.before.title], ['link', null, 'Your sign to add more color, every day ✨']);
});

test('understandProductWithAI: a link the search never returned is dropped', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'web_search_tool_result', content: [{ url: 'https://real.example/a' }] }, { type: 'text', text: JSON.stringify(found({ listing: { url: 'https://made-up.example/x', price: 10 } })) }] }) });
  const r = await understandProductWithAI({ title: 't', image: '' }, { ai: { provider: 'anthropic', model: 'm' } }, 'sk');
  assert.equal(r.listing, null);
  assert.equal(r.name, 'Bathhaus Pole Shower Caddy');
});
