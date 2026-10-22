// Bowerbird record storage (schema 3). Saves, collections and learned data live in IndexedDB,
// one record per item, so a save writes one record instead of rewriting the whole library, and
// every read-modify-write runs inside a single transaction. Settings and the AI key stay in
// chrome.storage.local (see storage.js).
//
// Two implementations share one small interface, so tests run the same store code in Node:
//   all(store)                      every record
//   get(store, key)                 one record or undefined
//   byIndex(store, index, value)    records whose index matches
//   count(store)
//   put(store, records[])           insert or replace
//   remove(store, keys[])
//   update(store, keys[], fn)       atomic: fn(record|undefined) -> record to write, null to delete, undefined to leave
//   clear(stores[])
//   onChanged(fn)                   fn({ stores }) after any write, in this context and every other Bowerbird context
//
// Stores: items (keyPath id, index urlKey), collections (keyPath id), kv (keyPath key: prefs, importHistory, aiLog),
// goals (keyPath id, index itemId) and checkins (keyPath id, index goalId): workout goals, see goals.js.
//
// Versions: 1 = items, collections, kv (M1). 2 = adds goals and checkins (M2). Upgrades only ever add
// stores, so an older build can still read a newer database: if it asks for a lower version than the
// one on disk, it opens the database as it is instead of failing (see open()).

export const DB_NAME = 'keepsake';
export const DB_VERSION = 2;
export const STORES = ['items', 'collections', 'kv', 'goals', 'checkins'];
const CHANNEL = 'keepsake-records';

export class StorageFullError extends Error {
  constructor() {
    super('Bowerbird is out of space in this browser profile. Nothing already saved was lost. Free some space or export your library from Settings.');
    this.name = 'StorageFullError';
  }
}

const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(e.message || '')));

function notifier(shared) {
  const listeners = new Set();
  let channel = null;
  try {
    if (shared && typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (ev) => listeners.forEach((fn) => fn(ev.data));
      if (typeof channel.unref === 'function') channel.unref(); // Node (tests): don't keep the process alive
    }
  } catch {
    channel = null;
  }
  return {
    emit(stores) {
      const msg = { stores };
      listeners.forEach((fn) => fn(msg));
      try {
        channel && channel.postMessage(msg);
      } catch {
        /* other contexts will catch up on their next read */
      }
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// --- IndexedDB --------------------------------------------------------------------------------

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
});

export function idbBackend(factory = globalThis.indexedDB, name = DB_NAME) {
  if (!factory) return null;
  const events = notifier(true);
  let dbp = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const attach = (r, retry) => {
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' }).createIndex('urlKey', 'urlKey', { unique: false });
            if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('goals')) db.createObjectStore('goals', { keyPath: 'id' }).createIndex('itemId', 'itemId', { unique: false });
            if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'id' }).createIndex('goalId', 'goalId', { unique: false });
          };
          r.onsuccess = () => {
            const db = r.result;
            db.onversionchange = () => { db.close(); dbp = null; };
            resolve(db);
          };
          r.onerror = (ev) => {
            // A newer Bowerbird already upgraded this database (rolled back to an older build): open it as is.
            if (retry && r.error && r.error.name === 'VersionError') {
              if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
              attach(factory.open(name), false);
              return;
            }
            dbp = null;
            reject(r.error);
          };
          // An open Bowerbird tab from before an upgrade closes its connection (onversionchange), so this is
          // rare; dbp is reset so the next call tries again instead of failing for good.
          r.onblocked = () => { dbp = null; reject(new Error('Bowerbird storage is busy in another tab. Close other Bowerbird tabs and try again.')); };
        };
        attach(factory.open(name, DB_VERSION), true);
      });
    }
    return dbp;
  };
  const write = async (stores, fn) => {
    const db = await open();
    const tx = db.transaction(stores, 'readwrite');
    let out;
    try {
      out = fn(tx);
      await done(tx);
    } catch (e) {
      if (isQuota(e)) throw new StorageFullError();
      throw e;
    }
    events.emit(stores);
    return out;
  };
  return {
    kind: 'idb',
    async all(store) {
      const db = await open();
      return req(db.transaction(store).objectStore(store).getAll());
    },
    async get(store, key) {
      const db = await open();
      return req(db.transaction(store).objectStore(store).get(key));
    },
    async byIndex(store, index, value) {
      const db = await open();
      return req(db.transaction(store).objectStore(store).index(index).getAll(value));
    },
    async count(store) {
      const db = await open();
      return req(db.transaction(store).objectStore(store).count());
    },
    put(store, records) {
      return write([store], (tx) => { const os = tx.objectStore(store); for (const r of records) os.put(r); });
    },
    remove(store, keys) {
      return write([store], (tx) => { const os = tx.objectStore(store); for (const k of keys) os.delete(k); });
    },
    // Reads and writes happen in one transaction; fn must be synchronous.
    update(store, keys, fn) {
      const results = [];
      return write([store], (tx) => {
        const os = tx.objectStore(store);
        for (const key of keys) {
          const r = os.get(key);
          r.onsuccess = () => {
            const next = fn(r.result);
            if (next === null) { if (r.result) os.delete(key); }
            else if (next !== undefined) { os.put(next); results.push(next); }
          };
        }
      }).then(() => results);
    },
    clear(stores) {
      return write(stores, (tx) => { for (const s of stores) tx.objectStore(s).clear(); });
    },
    onChanged: (fn) => events.on(fn),
    async close() {
      if (dbp) (await dbp).close();
      dbp = null;
    },
  };
}

// --- in memory (tests, and a fallback where IndexedDB is unavailable) --------------------------

export function memoryRecordBackend({ failWrites = null } = {}) {
  const data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  const events = notifier(false);
  const keyOf = (store, r) => (store === 'kv' ? r.key : r.id);
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  const guard = () => { if (failWrites) throw failWrites(); };
  const after = (stores) => { events.emit(stores); };
  return {
    kind: 'memory',
    data,
    async all(store) { return [...data[store].values()].map(clone); },
    async get(store, key) { return clone(data[store].get(key)); },
    async byIndex(store, index, value) { return [...data[store].values()].filter((r) => r[index] === value).map(clone); },
    async count(store) { return data[store].size; },
    async put(store, records) {
      try { guard(); } catch (e) { if (isQuota(e)) throw new StorageFullError(); throw e; }
      for (const r of records) data[store].set(keyOf(store, r), clone(r));
      after([store]);
    },
    async remove(store, keys) { guard(); for (const k of keys) data[store].delete(k); after([store]); },
    async update(store, keys, fn) {
      try { guard(); } catch (e) { if (isQuota(e)) throw new StorageFullError(); throw e; }
      const results = [];
      for (const key of keys) {
        const next = fn(clone(data[store].get(key)));
        if (next === null) data[store].delete(key);
        else if (next !== undefined) { data[store].set(key, clone(next)); results.push(clone(next)); }
      }
      after([store]);
      return results;
    },
    async clear(stores) { for (const s of stores) data[s].clear(); after(stores); },
    onChanged: (fn) => events.on(fn),
    setFailWrites(f) { failWrites = f; },
  };
}
