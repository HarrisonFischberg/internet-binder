// IndexedDB versions (db.js): 1 -> 2 adds goals and checkins without touching saves, and a build that
// knows an older version can still open a database a newer build upgraded (a rollback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { idbBackend, DB_VERSION } from '../keepsake/src/shared/db.js';

const open = (name, version, upgrade) => new Promise((resolve, reject) => {
  const r = indexedDB.open(name, version);
  r.onupgradeneeded = () => upgrade && upgrade(r.result, r);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

test('a version 1 database (M1) gains goals and checkins and keeps every save', async () => {
  const name = `upgrade-${process.pid}-1`;
  const v1 = await open(name, 1, (db) => {
    db.createObjectStore('items', { keyPath: 'id' }).createIndex('urlKey', 'urlKey', { unique: false });
    db.createObjectStore('collections', { keyPath: 'id' });
    db.createObjectStore('kv', { keyPath: 'key' });
  });
  await new Promise((resolve) => { const tx = v1.transaction('items', 'readwrite'); tx.objectStore('items').put({ id: 'a', title: 'Hoodie', urlKey: 'x' }); tx.oncomplete = resolve; });
  v1.close();

  const be = idbBackend(indexedDB, name);
  assert.equal((await be.get('items', 'a')).title, 'Hoodie');
  assert.deepEqual(await be.all('goals'), []);
  await be.put('goals', [{ id: 'g', itemId: 'a' }]);
  assert.equal((await be.byIndex('goals', 'itemId', 'a')).length, 1);
  await be.close();
  const after = await open(name);
  assert.equal(after.version, DB_VERSION);
  after.close();
});

test('a database from a newer Keepsake still opens (rolled back to this build)', async () => {
  const name = `upgrade-${process.pid}-2`;
  const newer = await open(name, DB_VERSION + 1, (db) => {
    db.createObjectStore('items', { keyPath: 'id' }).createIndex('urlKey', 'urlKey', { unique: false });
    for (const s of ['collections', 'goals', 'checkins', 'future']) db.createObjectStore(s, { keyPath: 'id' });
    db.createObjectStore('kv', { keyPath: 'key' });
  });
  await new Promise((resolve) => { const tx = newer.transaction('items', 'readwrite'); tx.objectStore('items').put({ id: 'b', title: 'Lamp' }); tx.oncomplete = resolve; });
  newer.close();
  const be = idbBackend(indexedDB, name);
  assert.equal((await be.get('items', 'b')).title, 'Lamp');
  await be.close();
});
