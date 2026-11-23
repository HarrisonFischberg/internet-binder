// Screenshots shared to Internet Binder: the text the phone read from the picture (on the device), and
// what the save becomes. Lines are { text, x, y, w, h } as fractions of the picture, y from the top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenshotFacts } from '../keepsake/src/shared/screenshot.js';
import { createStore, memoryBackend, memoryRecordBackend, makeCollection } from '../keepsake/src/shared/storage.js';
import { saveCapture, normalizeProduct } from '../keepsake/src/shared/capture.js';

// One line per row: [text, y, height]. x and w don't matter to the rules.
const shot = (rows) => ({ lines: rows.map(([text, y, h = 0.018]) => ({ text, x: 0.05, y, w: 0.6, h })) });

const IG_RECIPE = shot([
  ['9:41', 0.02], ['5G', 0.02], ['87', 0.02],
  ['thatchef', 0.09], ['Follow', 0.09],
  ['Liked by sam and others', 0.62],
  ['thatchef One pan lemon chicken', 0.66],
  ['Ingredients:', 0.69], ['2 lbs chicken thighs', 0.71], ['1 lemon, sliced', 0.73], ['3 cloves garlic', 0.75], ['2 tbsp olive oil', 0.77],
  ['Bake at 425 for 35 minutes #dinner #onepan', 0.8],
  ['View all 212 comments', 0.84], ['2 days ago', 0.87],
  ['Home', 0.96], ['Search', 0.96], ['Reels', 0.96], ['Profile', 0.96],
]);

const SHOP_PAGE = shot([
  ['9:41', 0.02], ['100%', 0.02],
  ['stride.example', 0.06, 0.016],
  ['Menu', 0.11], ['Running', 0.42, 0.014],
  ['Pegasus 41 Road', 0.46, 0.034], ['Running Shoes', 0.5, 0.034],
  ['$139.99', 0.55, 0.024], ['4.7 (1,204)', 0.58],
  ['A springy daily trainer for road miles.', 0.62],
  ['Select Size', 0.7], ['Add to Bag', 0.8, 0.02], ['Free shipping over $50', 0.85],
]);

test('the phone’s and the app’s own furniture is not what the save is about', () => {
  const f = screenshotFacts(IG_RECIPE);
  for (const junk of ['9:41', '5G', 'Follow', 'Liked by', 'View all', '2 days ago', 'Home', 'Reels', 'Profile']) assert.ok(!f.description.includes(junk), junk);
  assert.equal(f.title, 'One pan lemon chicken', 'the caption’s first line, without the account’s name');
  assert.equal(f.instagram.creator, 'thatchef');
  assert.deepEqual(f.hashtags, ['dinner', 'onepan']);
  assert.equal(f.priceText, undefined);
});

test('a screenshot of a recipe post is saved as a Recipe, with its ingredients', async () => {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.init();
  const r = await saveCapture(store, { sparse: true, title: 'Picture', ocr: IG_RECIPE, image: 'data:image/jpeg;base64,AAAA' }, { instant: true });
  assert.equal(r.item.kind, 'recipe');
  assert.equal(r.item.title, 'One pan lemon chicken');
  assert.ok(r.item.details.ingredients.length >= 4, JSON.stringify(r.item.details.ingredients));
  assert.equal(r.item.instagram.creator, 'thatchef');
  assert.equal(r.item.image, 'data:image/jpeg;base64,AAAA');
});

test('a screenshot of a shop page: its biggest text is the name, with its price and shop', async () => {
  const f = screenshotFacts(SHOP_PAGE);
  assert.equal(f.title, 'Pegasus 41 Road Running Shoes', 'the heading and the line it wraps onto');
  assert.equal(f.priceText, '$139.99');
  assert.equal(f.retailerHost, 'stride.example');
  assert.equal(f.instagram, undefined);
  const running = makeCollection({ name: 'Running', keywords: ['pegasus'] });
  const db = memoryRecordBackend();
  await db.put('collections', [running]);
  const store = createStore(memoryBackend(), db);
  await store.init();
  const r = await saveCapture(store, { sparse: true, title: 'Picture', ocr: SHOP_PAGE }, { instant: true });
  assert.equal(r.item.kind, 'product');
  assert.equal(r.item.price, 139.99);
  assert.equal(r.item.currency, 'USD');
  assert.equal(r.item.collectionId, running.id);
});

test('a price on a post or a menu is not a product’s price', () => {
  const post = screenshotFacts(shot([['dealfinder', 0.09], ['Liked by sam and others', 0.6], ['dealfinder These are $20 at the outlet right now', 0.65]]));
  assert.equal(post.priceText, undefined);
  assert.equal(post.kind, undefined);
  const menu = screenshotFacts(shot([['Lunch menu', 0.2, 0.04], ['Soup of the day $8', 0.3], ['Grilled cheese $11', 0.35]]));
  assert.equal(menu.priceText, undefined);
  assert.equal(menu.title, 'Lunch menu');
});

test('an @handle anywhere names the account, so what you file from it is learned', async () => {
  const f = screenshotFacts(shot([['@coach.kim', 0.3], ['Three moves for tight hips', 0.35, 0.03], ['#mobility', 0.5]]));
  assert.equal(f.instagram.creator, 'coach.kim');
  assert.equal(f.title, 'Three moves for tight hips');
});

test('a picture with no readable text keeps the title it came with; plain lines (no positions) still work', () => {
  assert.equal(screenshotFacts({ lines: [] }).text, false);
  const p = normalizeProduct({ sparse: true, title: 'Picture', ocr: { lines: [{ text: '9:41', x: 0.1, y: 0.02, w: 0.1, h: 0.02 }] } });
  assert.equal(p.title, 'Picture');
  assert.equal(p.ocr, undefined);
  assert.equal(p.isScreenshot, true);
  const plain = screenshotFacts({ lines: ['9:41', 'Banana bread that never fails', 'Liked by sam and others'] });
  assert.equal(plain.title, 'Banana bread that never fails');
});
