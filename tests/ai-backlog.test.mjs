// Bulk imports wait for Run AI: the queue's pacing (aiQueue.js), the needsAi flag in the store, and the
// after-save work leaving flagged saves alone (fill.js). The worker's side is in background.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAiQueue, aiErrorKind, backoffMs } from '../keepsake/src/shared/aiQueue.js';
import { createStore, memoryBackend, memoryRecordBackend, KEYS } from '../keepsake/src/shared/storage.js';
import { fillSave, pendingToTidy, readImported, PENDING_AT_ONCE } from '../keepsake/src/shared/fill.js';

// A clock the queue's waits move forward, so backoff is tested without real time passing.
function clock() {
  let t = 0;
  const waits = [];
  return { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, waits };
}
const err = (status, retryAfter = null) => Object.assign(new Error(`Provider error (${status}): nope`), { status, retryAfter });

test('errors: a bad key stops the run, a 429 or overload waits, anything else skips that save', () => {
  assert.equal(aiErrorKind(err(401)), 'fatal');
  assert.equal(aiErrorKind(new Error('Provider error (400): Your credit balance is too low')), 'fatal');
  assert.equal(aiErrorKind(err(429)), 'slow');
  assert.equal(aiErrorKind(err(529)), 'slow');
  assert.equal(aiErrorKind(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), 'slow');
  assert.equal(aiErrorKind(new Error('The provider didn’t return a usable answer.')), 'item');
  assert.equal(backoffMs(err(429, 30), 1, { random: () => 0 }), 30000, 'Retry-After wins');
  assert.deepEqual([1, 2, 3].map((n) => backoffMs(err(529), n, { random: () => 0 })), [4000, 8000, 16000]);
  assert.equal(backoffMs(err(529), 20, { random: () => 0 }), 120000, 'capped');
});

test('queue: a 429 waits and tries the same save again; at most two at a time', async () => {
  const c = clock();
  const calls = [];
  let inFlight = 0;
  let most = 0;
  const once = new Set();
  const res = await runAiQueue(['a', 'b', 'c', 'd'], {
    ...c, random: () => 0,
    work: async (id) => {
      calls.push(id);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (id === 'b' && !once.has(id)) {
        once.add(id);
        throw err(429, 2);
      }
      return { changed: id !== 'd' };
    },
  });
  assert.deepEqual([res.done, res.changed, res.failed, res.reason], [4, 3, 0, '']);
  assert.equal(calls.filter((x) => x === 'b').length, 2, 'b was tried again');
  assert.ok(c.waits.reduce((a, b) => a + b, 0) >= 2000, 'waited what the provider asked');
  assert.equal(most, 2);
});

test('queue: a bad key stops at once; saves not reached are left for the next run', async () => {
  const seen = [];
  const res = await runAiQueue(['a', 'b', 'c', 'd', 'e'], { ...clock(), concurrency: 1, work: async (id) => { seen.push(id); if (id === 'b') throw err(401); return null; } });
  assert.deepEqual([res.reason, res.done], ['fatal', 1]);
  assert.deepEqual(seen, ['a', 'b']);
});

test('queue: a provider that keeps saying it is busy pauses the run instead of knocking forever', async () => {
  const c = clock();
  const res = await runAiQueue(['a', 'b', 'c'], { ...c, concurrency: 1, busyStreak: 3, work: async () => { throw err(529); } });
  assert.equal(res.reason, 'busy');
  assert.equal(res.done, 0);
  assert.ok(c.waits.length >= 2);
});

test('queue: a save the provider keeps refusing is skipped after a few tries; one it can’t read is skipped at once', async () => {
  const res = await runAiQueue(['bad', 'odd', 'ok'], {
    ...clock(), concurrency: 1, tries: 2, busyStreak: 99,
    work: async (id) => { if (id === 'bad') throw err(503); if (id === 'odd') throw new Error('no usable answer'); return { changed: true }; },
  });
  assert.deepEqual([res.done, res.failed, res.changed], [3, 2, 1]);
});

test('queue: Pause stops between saves', async () => {
  let stop = false;
  const done = [];
  const res = await runAiQueue(['a', 'b', 'c', 'd'], { ...clock(), concurrency: 1, stopped: () => stop, work: async (id) => { done.push(id); if (id === 'b') stop = true; return null; } });
  assert.deepEqual(done, ['a', 'b']);
  assert.equal(res.stopped, true);
});

async function store() {
  const s = createStore(memoryBackend(), memoryRecordBackend());
  await s.init();
  return s;
}

test('store: needsAi is kept, listed newest first, and cleared on an update', async () => {
  const s = await store();
  const a = await s.addItem({ title: 'A', url: 'https://a.example/1', needsAi: true, createdAt: '2026-01-01T00:00:00.000Z' });
  const b = await s.addItem({ title: 'B', url: 'https://a.example/2', needsAi: true, createdAt: '2026-02-01T00:00:00.000Z' });
  await s.addItem({ title: 'C', url: 'https://a.example/3' });
  assert.deepEqual((await s.getAiBacklog()).map((i) => i.id), [b.id, a.id]);
  await s.updateItem(a.id, { needsAi: false }, { by: 'machine' });
  assert.deepEqual((await s.getAiBacklog()).map((i) => i.id), [b.id]);
});

test('store: an imported backup waits for Run AI; a save your provider already read does not', async () => {
  const s = await store();
  const items = {
    imp001: { id: 'imp001', title: 'Unread', url: 'https://a.example/imp001', createdAt: '2026-01-01T00:00:00.000Z' },
    imp002: { id: 'imp002', title: 'Read', url: 'https://a.example/imp002', understoodAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    imp003: { id: 'imp003', title: 'Was tidying', url: 'https://a.example/imp003', captureState: 'pending', createdAt: '2026-01-01T00:00:00.000Z' },
  };
  await s.importJSON({ format: 'keepsake-export', schemaVersion: 3, collections: {}, items });
  const got = Object.fromEntries((await s.getItems()).map((i) => [i.id, i]));
  assert.deepEqual([got.imp001.needsAi, got.imp002.needsAi, got.imp003.needsAi, got.imp003.captureState], [true, false, true, 'complete']);
});

test('store: once, saves stuck waiting for the AI tidy and Instagram imports never read join the queue', async () => {
  const be = memoryBackend();
  const db = memoryRecordBackend();
  const s = createStore(be, db);
  await s.init();
  const stuck = await s.addItem({ title: 'Stuck', url: 'https://a.example/s', captureState: 'pending' });
  const post = await s.addItem({ title: 'Post', type: 'instagram', url: 'https://www.instagram.com/p/MIGR1/', instagram: { caption: 'x' } });
  const read = await s.addItem({ title: 'Read', type: 'instagram', url: 'https://www.instagram.com/p/MIGR2/', instagram: { caption: 'y' }, understoodAt: '2026-01-01T00:00:00.000Z' });
  const meta = (await be.get([KEYS.meta]))[KEYS.meta];
  delete meta.aiBacklogAt;
  await be.set({ [KEYS.meta]: meta });
  await createStore(be, db).init();
  const got = Object.fromEntries((await s.getItems()).map((i) => [i.id, i]));
  assert.deepEqual([got[stuck.id].needsAi, got[stuck.id].captureState, got[post.id].needsAi, got[read.id].needsAi], [true, 'complete', true, false]);
  assert.equal((await be.get([KEYS.meta]))[KEYS.meta].aiBacklogQueued, 2);
});

test('after-save work: only the newest few pending saves are tidied; the rest wait for Run AI', async () => {
  const s = await store();
  for (let n = 0; n < PENDING_AT_ONCE + 5; n++) await s.addItem({ title: `P${n}`, url: `https://a.example/p${n}`, captureState: 'pending', createdAt: new Date(Date.UTC(2026, 0, n + 1)).toISOString() });
  const now = await pendingToTidy(s);
  assert.equal(now.length, PENDING_AT_ONCE);
  assert.equal(now[0].title, `P${PENDING_AT_ONCE + 4}`, 'newest first');
  assert.equal((await s.getAiBacklog()).length, 5);
  assert.equal((await s.getPendingItems()).length, PENDING_AT_ONCE);
});

test('after-save work: a flagged Lifestyle save gets its Lookups but is not sent to your AI provider', async () => {
  const s = await store();
  await s.updateSettings({ ai: { on: true, provider: 'anthropic', model: 'm' } });
  await s.setSecret('aiApiKey', 'sk-test');
  const it = await s.addItem({ title: 'Weeknight pasta', kind: 'recipe', url: 'https://www.instagram.com/p/FLAG1/', type: 'instagram', needsAi: true });
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => { asked++; throw new Error('should not be called'); };
  try {
    await fillSave(s, it.id, {}, { fetchFn: async () => { throw new Error('offline'); }, allowed: async () => false });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(asked, 0);
  assert.equal((await s.getItem(it.id)).needsAi, true);
});

test('readImported: a save your provider read loses its flag; one it failed on keeps it for the next run', async () => {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.init();
  await store.updateSettings({ ai: { on: true, provider: 'anthropic', model: 'm' } });
  await store.setSecret('aiApiKey', 'sk');
  const post = (title) => ({ type: 'instagram', url: `https://www.instagram.com/p/${title}/`, title, kind: 'link', needsAi: true, instagram: { caption: title } });
  const ok = await store.addItem(post('Brownies'));
  const bad = await store.addItem(post('Broken'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts.body.includes('Broken')) return { ok: false, status: 500, headers: { get: () => null }, text: async () => '{"error":{"message":"down"}}' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ kind: 'recipe', confidence: 0.95, title: 'Brownies', details: { ingredients: ['200g chocolate', '3 eggs'], steps: ['Bake'] } }) }] }) };
  };
  try {
    await readImported(store, ok.id);
    await assert.rejects(readImported(store, bad.id), /500/);
  } finally {
    globalThis.fetch = realFetch;
  }
  const read = await store.getItem(ok.id);
  assert.equal(read.needsAi, false);
  assert.ok(read.understoodAt, 'marked as read');
  const failed = await store.getItem(bad.id);
  assert.equal(failed.needsAi, true, 'still waits for Run AI');
  assert.equal(failed.understoodAt, null);
  assert.deepEqual((await store.getAiBacklog()).map((i) => i.id), [bad.id]);
});
