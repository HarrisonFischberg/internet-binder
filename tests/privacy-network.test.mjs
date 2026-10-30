// What reaches the network on a save, by setting: every request is recorded and refused. Saves are local;
// your provider is only asked when AI is on with your key, and a bulk import asks nothing until you start
// Run AI on imported saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, memoryRecordBackend } from '../keepsake/src/shared/storage.js';
import { saveCapture } from '../keepsake/src/shared/capture.js';
import { tidySave, fillSave, pendingToTidy } from '../keepsake/src/shared/fill.js';
import { setLocalModel, keyFor } from '../keepsake/src/ai/provider.js';

const post = (n) => ({ sparse: true, url: `https://www.instagram.com/p/priv${n}/`, isInstagram: true, title: 'Claude Code tips for AI agents', description: 'I checked 60 days of my Claude Code logs. Prompts, AI agents and more.' });

async function run(settings, { key = '', deferAi = false, device = null } = {}) {
  const hosts = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => { hosts.push(new URL(String(url)).hostname); throw new Error('refused'); };
  setLocalModel(device);
  try {
    const store = createStore(memoryBackend(), memoryRecordBackend());
    await store.updateSettings(settings);
    if (key) await store.setSecret('aiApiKey', key);
    await store.createCollection({ name: 'AI' });
    const pending = [];
    const r = await saveCapture(store, post(hosts.length), { source: 'share-sheet', instant: true, deferAi }, { enrich: (id) => pending.push(id) });
    for (const id of pending) await tidySave(store, id, { deviceOnly: true });
    await fillSave(store, r.item.id, {}, { fetchFn: globalThis.fetch, allowed: async () => false, deviceOnly: true });
    return { hosts, item: await store.getItem(r.item.id), waiting: (await pendingToTidy(store)).length };
  } finally {
    globalThis.fetch = before;
    setLocalModel(null);
  }
}

test('AI off, no key: a save sends nothing', async () => {
  const { hosts, item } = await run({ ai: { on: false } });
  assert.deepEqual(hosts, []);
  assert.equal(item.captureState, 'complete');
});

test('a key stored with AI turned off is never used', async () => {
  const { hosts } = await run({ ai: { on: false, provider: 'anthropic' } }, { key: 'sk-ant-stored-but-off' });
  assert.deepEqual(hosts, []);
});

test('a bulk import asks nothing of your provider until you start Run AI', async () => {
  const { hosts, item } = await run({ ai: { on: true, provider: 'anthropic' } }, { key: 'sk-ant-on', deferAi: true });
  assert.deepEqual(hosts, []);
  assert.equal(item.needsAi, true);
});

test('with the device model ready, work that runs by itself stays on the device even with a key', async () => {
  const device = { ready: () => true, respond: async () => JSON.stringify({ type: 'link', topic: 'AI', collection: null, evidence: [], needsReview: true, uncertainty: 'test' }) };
  setLocalModel(device);
  assert.equal(keyFor({ ai: { on: true } }, 'sk-ant-on', { deviceOnly: true }), '');
  setLocalModel(null);
  const { hosts } = await run({ ai: { on: true, provider: 'anthropic' } }, { key: 'sk-ant-on', device });
  assert.deepEqual(hosts, []);
});

// Fix with AI on a place (placeResolve.js), by mode: only OpenStreetMap with Places lookups on, and your
// provider only with your key and web lookups on; on the device's own runs, never the provider.
test('the place check reaches only the hosts its settings allow', async () => {
  const { resolvePlaceSave } = await import('../keepsake/src/shared/placeResolve.js');
  const runPlace = async (settings, { key = '', deviceOnly = false } = {}) => {
    const hosts = [];
    const before = globalThis.fetch;
    const refuse = async (url) => { hosts.push(new URL(String(url)).hostname); throw new Error('refused'); };
    globalThis.fetch = refuse;
    try {
      const store = createStore(memoryBackend(), memoryRecordBackend());
      await store.updateSettings(settings);
      if (key) await store.setSecret('aiApiKey', key);
      const item = await store.addItem({ kind: 'place', type: 'instagram', title: 'Lucali', url: 'https://www.instagram.com/p/pl1/', instagram: { caption: '📍 Lucali, Brooklyn' }, details: { source: 'page' } });
      await resolvePlaceSave(store, item.id, { fetchFn: refuse, allowed: async (s, which) => !!s.lookups?.[which], deviceOnly }).catch(() => null);
      return [...new Set(hosts)].sort();
    } finally { globalThis.fetch = before; }
  };
  assert.deepEqual(await runPlace({ ai: { on: false }, lookups: { places: false } }), []);
  assert.deepEqual(await runPlace({ ai: { on: false, provider: 'anthropic' }, lookups: { places: false } }, { key: 'sk-ant-stored-but-off' }), []);
  assert.deepEqual(await runPlace({ ai: { on: false }, lookups: { places: true } }), ['nominatim.openstreetmap.org']);
  assert.deepEqual(await runPlace({ ai: { on: true, provider: 'anthropic', webLookup: true }, lookups: { places: true } }, { key: 'sk-ant-on', deviceOnly: true }), ['nominatim.openstreetmap.org']);
  assert.deepEqual(await runPlace({ ai: { on: true, provider: 'anthropic', webLookup: true }, lookups: { places: false } }, { key: 'sk-ant-on' }), ['api.anthropic.com']);
});

test('a kind learned from your posts is decided on the device: no request', async () => {
  const { learnFromSaves, emptyPrefs } = await import('../keepsake/src/shared/categorizer.js');
  const hosts = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => { hosts.push(new URL(String(url)).hostname); throw new Error('refused'); };
  try {
    const store = createStore(memoryBackend(), memoryRecordBackend());
    const ig = (c, n) => ({ isInstagram: true, host: 'www.instagram.com', url: `https://www.instagram.com/p/k${n}/`, title: c, description: c, instagram: { caption: c, hashtags: ['mobility', 'fascia'] }, kind: 'workout' });
    await store.setPrefs(learnFromSaves([ig('Ankle drill #mobility #fascia', 1), ig('Hip release #mobility #fascia', 2), ig('Posture fix #mobility #fascia', 3)], emptyPrefs()));
    const r = await saveCapture(store, { ...ig('Why your fascia is tight #mobility', 4), kind: undefined }, { source: 'share-sheet', instant: true });
    assert.equal(r.item.kind, 'workout');
    assert.deepEqual(hosts, []);
  } finally { globalThis.fetch = before; }
});
