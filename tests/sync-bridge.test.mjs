// iCloud sync in Safari on the Mac (syncBridge.js + the db.js journal), with a fake native side: what the
// extension marks, sends, acknowledges and takes back from iCloud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { idbBackend } from '../keepsake/src/shared/db.js';
import { createSyncBridge, batches, SYNC_KEY } from '../keepsake/src/shared/syncBridge.js';

let n = 0;
function setup({ onPush } = {}) {
  const db = idbBackend(indexedDB, `sync-${process.pid}-${++n}`, { journal: true });
  const local = new Map();
  let settings = { ai: { on: false, model: 'claude-haiku-5-5' } };
  const store = {
    getSettings: async () => settings,
    updateSettings: async (patch) => { settings = { ...settings, ...patch }; },
  };
  // The Mac app's side: keeps what was pushed, hands back what "iCloud" sent since a cursor.
  const native = { got: [], outbound: [], synced: 0, offs: 0 };
  const send = async (msg) => {
    if (msg.type === 'push') {
      native.got.push(...msg.changes);
      if (onPush) await onPush(msg);
      return { ok: true, acked: msg.changes.map(({ store: s, key, rev }) => ({ store: s, key, rev })) };
    }
    if (msg.type === 'sync') { native.synced++; return { ok: true, status: 'upToDate' }; }
    if (msg.type === 'pull') {
      const changes = native.outbound.filter((c) => c.seq > msg.cursor);
      return { ok: true, changes, cursor: native.outbound.length ? native.outbound.at(-1).seq : msg.cursor, more: false };
    }
    if (msg.type === 'off') { native.offs++; return { ok: true }; }
    return { ok: false };
  };
  const bridge = createSyncBridge({ db, store, local: { get: async (k) => local.get(k), set: async (o) => { for (const [k, v] of Object.entries(o)) local.set(k, v); } }, send });
  return { db, bridge, native, local, store, getSettings: () => settings };
}

test('the journal marks synced records, with a revision, and leaves the AI undo log out', async () => {
  const { db } = setup();
  await db.put('items', [{ id: 'a', title: 'Lamp' }]);
  await db.put('items', [{ id: 'a', title: 'Lamp, linen shade' }]);
  await db.put('kv', [{ key: 'prefs', value: {} }, { key: 'aiLog:1', value: {} }]);
  await db.update('collections', ['c'], () => ({ id: 'c', name: 'Home' }));
  await db.remove('items', ['gone']);
  const pending = Object.fromEntries((await db.syncPending()).map((p) => [`${p.store}/${p.key}`, p.rev]));
  assert.deepEqual(pending, { 'items/a': 2, 'kv/prefs': 1, 'collections/c': 1, 'items/gone': 1 });
});

test('Chrome (no journal) marks nothing', async () => {
  const db = idbBackend(indexedDB, `sync-${process.pid}-chrome`);
  await db.put('items', [{ id: 'a' }]);
  assert.deepEqual(await db.syncPending(), []);
});

test('a new install turns sync on; a Mac with a library waits to be asked', async () => {
  const fresh = setup();
  assert.equal((await fresh.bridge.decide()).on, true);
  const old = setup();
  await old.db.put('items', [{ id: 'a' }]);
  assert.equal((await old.bridge.decide()).on, null);
});

test('a round sends what changed, clears it, and writes what came from iCloud without marking it', async () => {
  const { db, bridge, native } = setup();
  await db.put('items', [{ id: 'a', title: 'Lamp' }]);
  await bridge.setOn(true);
  assert.equal(native.got.find((c) => c.key === 'a').body.title, 'Lamp');
  assert.deepEqual(await db.syncPending(), []);

  native.outbound.push({ seq: 1, store: 'items', key: 'b', body: { id: 'b', title: 'Saved on the iPhone' } }, { seq: 2, store: 'items', key: 'a', body: null });
  const st = await bridge.run();
  assert.equal(st.status, 'upToDate');
  assert.equal((await db.get('items', 'b')).title, 'Saved on the iPhone');
  assert.equal(await db.get('items', 'a'), undefined, 'emptied from the Trash on the iPhone');
  assert.deepEqual(await db.syncPending(), [], 'nothing from iCloud goes back up');
  assert.equal(st.cursor, 2);
});

test('an edit made while a round is running stays pending, and isn\'t overwritten by iCloud', async () => {
  let db;
  const s = setup({ onPush: async () => { await db.put('items', [{ id: 'a', title: 'Edited meanwhile' }]); } });
  db = s.db;
  await db.put('items', [{ id: 'a', title: 'First' }]);
  await s.bridge.setOn(true);
  s.native.outbound.push({ seq: 1, store: 'items', key: 'a', body: { id: 'a', title: 'From iCloud' } });
  await s.bridge.run();
  assert.equal((await db.get('items', 'a')).title, 'Edited meanwhile');
  assert.deepEqual((await db.syncPending()).map((p) => p.key), ['a']);
});

test('AI settings go up when changed here and come down when changed on the iPhone', async () => {
  const s = setup();
  await s.bridge.setOn(true);
  assert.equal(s.native.got.find((c) => c.key === 'aiSettings').body.value.model, 'claude-haiku-5-5');
  await s.bridge.settingsChanged({ ai: { on: false } }, { ai: { on: true } });
  assert.equal((await s.bridge.state()).aiRev, 1);
  await s.bridge.run();
  assert.equal((await s.bridge.state()).aiRev, 0);
  s.native.outbound.push({ seq: 1, store: 'kv', key: 'aiSettings', body: { key: 'aiSettings', value: { on: true, model: 'claude-sonnet-5-5' } } });
  await s.bridge.run();
  assert.equal(s.getSettings().ai.model, 'claude-sonnet-5-5');
});

test('turning sync off forgets what was pending and tells the Mac app; on again sends everything', async () => {
  const s = setup();
  await s.db.put('items', [{ id: 'a' }]);
  await s.bridge.setOn(false);
  assert.equal(s.native.offs, 1);
  await s.db.clear(['items']); // deleted while off
  await s.db.put('items', [{ id: 'b' }]);
  s.native.got = [];
  await s.bridge.setOn(true);
  assert.deepEqual(s.native.got.filter((c) => c.store === 'items').map((c) => c.key), ['b'], 'a deletion made while off never reaches iCloud');
  assert.equal(s.local.get(SYNC_KEY).on, true);
});

test('changes go to the Mac app in batches of a few megabytes', () => {
  const big = { store: 'items', key: 'x', body: { image: 'x'.repeat(3 * 1024 * 1024) } };
  assert.equal(batches([big, big, { store: 'items', key: 'y', body: {} }]).length, 2);
});
