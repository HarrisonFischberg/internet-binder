// Apple Intelligence on iPhone and iPad (src/ai/provider.js setLocalModel): it reads saves by itself, with
// nothing sent; your key is used only when you ask. A fake device model and a fake provider.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { setLocalModel, localModelReady, aiAvailable, keyFor, understandWithAI, cleanupWithAI, understandProductWithAI } from '../keepsake/src/ai/provider.js';
import { understandItem } from '../keepsake/src/shared/understand.js';
import { tidySave } from '../keepsake/src/shared/fill.js';
import { createStore, memoryRecordBackend } from '../keepsake/src/shared/storage.js';

const answer = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(o) }] }) });
const recipe = { kind: 'recipe', confidence: 0.95, title: 'Brownies', details: { ingredients: ['200g chocolate', '3 eggs'], steps: ['Bake'] }, drafted: [] };

// A device model that answers with `reply` and remembers what it was asked.
function device(reply, { ready = true } = {}) {
  const asked = [];
  setLocalModel({ ready: () => ready, respond: async (req) => { asked.push(req); if (reply instanceof Error) throw reply; return typeof reply === 'string' ? reply : JSON.stringify(reply); } });
  return asked;
}
function provider(reply) {
  const sent = [];
  globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return answer(reply); };
  return sent;
}
async function makeStore({ key = '', on = false } = {}) {
  const kv = {};
  const store = createStore({ get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in kv).map((x) => [x, kv[x]])), set: async (o) => Object.assign(kv, o), remove: async () => {}, clear: async () => {}, onChanged: () => () => {} }, memoryRecordBackend());
  await store.init();
  await store.updateSettings({ ai: { on, provider: 'anthropic', model: 'm' } });
  if (key) await store.setSecret('aiApiKey', key);
  return store;
}
const post = (caption) => ({ id: 'p1', type: 'instagram', kind: 'link', title: caption, url: 'https://www.instagram.com/reel/ABCDE/', collectionId: null, details: {}, instagram: { caption, creator: 'cook', hashtags: [] }, userFields: [] });

afterEach(() => setLocalModel(null));

test('nothing registered (Chrome): AI needs your key, as before', () => {
  assert.equal(localModelReady(), false);
  assert.equal(aiAvailable({ ai: { on: true } }, 'sk'), true);
  assert.equal(aiAvailable({ ai: { on: false } }, 'sk'), false);
  assert.equal(aiAvailable({}, ''), false);
});

test('a device model that is ready makes AI available with no key; one that is not ready does not', () => {
  device(recipe);
  assert.equal(aiAvailable({}, ''), true);
  device(recipe, { ready: false });
  assert.equal(aiAvailable({}, ''), false);
});

test('keyFor: work that runs by itself never uses your key while the device model is there', () => {
  const on = { ai: { on: true } };
  assert.equal(keyFor(on, 'sk', { deviceOnly: true }), 'sk', 'no device model: your key, as before');
  device(recipe);
  assert.equal(keyFor(on, 'sk', { deviceOnly: true }), '');
  assert.equal(keyFor(on, 'sk'), 'sk', 'you asked');
  assert.equal(keyFor({ ai: { on: false } }, 'sk'), '', 'Optional AI off');
});

test('without a key the device model reads the save and nothing is sent; with your key your provider does', async () => {
  const asked = device(recipe);
  const sent = provider({ ...recipe, title: 'Fudgy brownies' });
  const settings = { ai: { provider: 'anthropic', model: 'm' } };
  const r = await understandWithAI({ title: 'Brownies', caption: 'x'.repeat(20000), image: 'data:image/jpeg;base64,QUJD' }, settings, '');
  assert.deepEqual([r.kind, r.title, r.onDevice], ['recipe', 'Brownies', true]);
  assert.equal(sent.length, 0);
  assert.ok(asked[0].userText.length <= 6000, 'cut to fit the device model');
  assert.ok(asked[0].maxTokens <= 1500);
  const c = await understandWithAI({ title: 'Brownies' }, settings, 'sk');
  assert.deepEqual([c.title, c.onDevice, sent.length], ['Fudgy brownies', undefined, 1]);
});

test('the device model failing with no key is an error, so the save stays as it was', async () => {
  device(new Error('Apple Intelligence couldn’t answer'));
  const sent = provider(recipe);
  await assert.rejects(understandWithAI({ title: 'Brownies' }, {}, ''), /couldn’t answer/);
  assert.equal(sent.length, 0);
});

test('a product with no key: the device model names it without a search, and no shop page is made up', async () => {
  const asked = device({ name: 'Bathhaus shower caddy', confidence: 0.8, listing: { url: 'https://made.up/caddy' } });
  const r = await understandProductWithAI({ title: 'Love this caddy' }, { ai: { provider: 'anthropic' } }, '');
  assert.equal(r.name, 'Bathhaus shower caddy');
  assert.equal(r.listing, null);
  assert.match(asked[0].system, /cannot search the web/);
});

test('cleanup with the device model files into your own collections only', async () => {
  device({ items: [{ ref: 'a', title: 'Linen shirt', collection: 'Clothes', confidence: 0.9 }, { ref: 'b', collection: 'Made up', confidence: 0.9 }] });
  const out = await cleanupWithAI([{ ref: 'a', item: { title: 'shirt!!' } }, { ref: 'b', item: { title: 'lamp' } }], [{ id: 'c1', name: 'Clothes' }], {}, '');
  assert.deepEqual([out.get('a').collectionId, out.get('b').collectionId], ['c1', null]);
});

test('understandItem after a save (deviceOnly): Apple Intelligence reads it even with your key set, and nothing is sent', async () => {
  const store = await makeStore({ key: 'sk', on: true });
  const it = await store.addItem(post('Brownies 😍'));
  device(recipe);
  const sent = provider(recipe);
  const r = await understandItem(store, it.id, {}, { deviceOnly: true });
  assert.equal(r.kind, 'recipe');
  assert.equal(sent.length, 0);
  assert.equal((await store.getItem(it.id)).kind, 'recipe');
  // Fix with AI (you asked) takes it further with your key.
  await understandItem(store, it.id, { force: true });
  assert.equal(sent.length, 1);
});

test('understandItem with no key and no device model does nothing', async () => {
  const store = await makeStore();
  const it = await store.addItem(post('Brownies'));
  assert.equal(await understandItem(store, it.id), null);
});

test('tidySave with only the device model: a new save is read and tidied with no key at all', async () => {
  const store = await makeStore();
  const it = await store.addItem({ ...post('Brownies 😍'), captureState: 'pending' });
  device(recipe);
  const sent = provider(recipe);
  const r = await tidySave(store, it.id, { deviceOnly: true });
  assert.equal(r.kind, 'recipe');
  const saved = await store.getItem(it.id);
  assert.deepEqual([saved.kind, saved.captureState], ['recipe', 'complete']);
  assert.equal(sent.length, 0);
});

// What Apple Intelligence really answered (FoundationModels on a Mac, Oct 2026): the format's examples
// copied as details, and a second object after the answer.
test('the device model: examples it copied are dropped, a second object after the answer is ignored, and it gets the note', async () => {
  const place = '{"kind":"place","confidence":0.9,"title":"Lilia","details":{"locality":"Brooklyn","region":"NY","category":"restaurant","hours":["Mon–Fri 8am–3pm"],"phone":null},"drafted":[]}\n{"reason":"a restaurant"}';
  const asked = device(place);
  const r = await understandWithAI({ title: 'Lilia', caption: 'Finally got a table', location: 'Lilia, Brooklyn' }, {}, '');
  assert.deepEqual([r.kind, r.details.locality, r.details.hours], ['place', 'Brooklyn', []]);
  assert.match(asked[0].system, /never copy them/);
  device({ kind: 'recipe', confidence: 0.6, title: 'Pasta', details: { ingredients: ['quantity + ingredient', '200g pasta'], steps: ['one step'], yield: 'e.g. 4 servings', category: 'dinner' } });
  const p = await understandWithAI({ title: 'Pasta' }, {}, '');
  assert.deepEqual(p.details, { ingredients: ['200g pasta'], steps: [], category: 'dinner' });
});

test('your provider is not sent the device note', async () => {
  const sent = provider(recipe);
  await understandWithAI({ title: 'Brownies' }, { ai: { provider: 'anthropic', model: 'm' } }, 'sk');
  assert.doesNotMatch(JSON.stringify(sent[0]), /never copy them/);
});
