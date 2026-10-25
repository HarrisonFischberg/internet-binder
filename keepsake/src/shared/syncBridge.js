// iCloud sync for Safari on the Mac. Safari keeps the library in IndexedDB as everywhere else; the
// Mac app's native side (safari/Keepsake/Keepsake Extension/SafariWebExtensionHandler.swift) holds a
// copy and talks to iCloud with the same Swift sync code as the iPhone (ios/KeepsakeKit/.../Sync).
//
// One round, run by the background (never in Chrome, which has no native side):
//   push   every change marked in syncPending (db.js `journal`), in batches; the native side keeps them
//   sync   the native side fetches from iCloud and sends what it has
//   pull   what came from iCloud since our cursor, written without being marked pending again
//   hold   records skipped in a pull because they were edited here meanwhile (see pull)
// A save edited here while a round is running stays pending and goes in the next one.
//
// State in chrome.storage.local `keepsake_sync`: { on (null until decided), cursor, aiRev, status, at, message }.

export const SYNC_KEY = 'keepsake_sync';
const BATCH_BYTES = 4 * 1024 * 1024;

export function syncCapable(runtime = globalThis.chrome && globalThis.chrome.runtime) {
  try {
    return !!runtime && typeof runtime.sendNativeMessage === 'function' && (runtime.getManifest().permissions || []).includes('nativeMessaging');
  } catch {
    return false;
  }
}

export function nativeSender(runtime = globalThis.chrome && globalThis.chrome.runtime) {
  return (msg) => new Promise((resolve, reject) => {
    try {
      const p = runtime.sendNativeMessage('application.id', msg, (res) => {
        const err = globalThis.chrome && chrome.runtime && chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve(res);
      });
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

// Groups changes so no message to the native side is much over BATCH_BYTES.
export function batches(changes, limit = BATCH_BYTES) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const c of changes) {
    const n = JSON.stringify(c).length;
    if (cur.length && size + n > limit) { out.push(cur); cur = []; size = 0; }
    cur.push(c);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

// db: the idb backend with journal on. store: the shared store (settings). local: { get(key), set(obj) }
// over chrome.storage.local. send: a message to the native side, resolving with its answer.
export function createSyncBridge({ db, store, local, send }) {
  let running = null;
  let applyingAi = false;

  const state = async () => ({ on: null, cursor: 0, aiRev: 0, ...((await local.get(SYNC_KEY)) || {}) });
  const setState = async (patch) => {
    const next = { ...(await state()), ...patch };
    await local.set({ [SYNC_KEY]: next });
    return next;
  };
  const ask = async (msg) => {
    const res = await send(msg);
    if (!res || res.ok !== true) throw new Error((res && res.message) || 'The Internet Binder app on this Mac didn’t answer.');
    return res;
  };

  async function push(st) {
    const pending = await db.syncPending();
    const changes = [];
    for (const p of pending) {
      const body = await db.get(p.store, p.key);
      changes.push({ store: p.store, key: p.key, rev: p.rev, body: body === undefined ? null : body });
    }
    if (st.aiRev) {
      const ai = ((await store.getSettings()) || {}).ai || {};
      changes.push({ store: 'kv', key: 'aiSettings', rev: st.aiRev, body: { key: 'aiSettings', value: ai } });
    }
    for (const batch of batches(changes)) {
      const res = await ask({ type: 'push', cursor: st.cursor || 0, changes: batch });
      const acked = res.acked || [];
      const ai = acked.find((a) => a.store === 'kv' && a.key === 'aiSettings');
      await db.syncAck(acked.filter((a) => a !== ai));
      if (ai) {
        const now = await state();
        if (now.aiRev === ai.rev) await setState({ aiRev: 0 });
      }
    }
  }

  async function pull(cursor) {
    for (;;) {
      const res = await ask({ type: 'pull', cursor });
      const pendingNow = new Set((await db.syncPending()).map((p) => `${p.store}\u0000${p.key}`));
      const all = res.changes || [];
      const changes = all.filter((c) => !pendingNow.has(`${c.store}\u0000${c.key}`));
      // Edited here meanwhile: the Mac app keeps the iCloud version as unseen, so this edit is merged
      // with it when it's pushed (not written over it), and the merge comes back on the next pull.
      const held = all.filter((c) => !changes.includes(c)).map(({ store: s, key }) => ({ store: s, key }));
      if (held.length) await ask({ type: 'hold', changes: held });
      const ai = changes.find((c) => c.store === 'kv' && c.key === 'aiSettings');
      await db.syncApply(changes.filter((c) => c !== ai));
      if (ai && ai.body && (await state()).aiRev === 0) {
        applyingAi = true;
        try { await store.updateSettings({ ai: ai.body.value || {} }); } finally { applyingAi = false; }
      }
      cursor = res.cursor || cursor;
      await setState({ cursor });
      if (!res.more) return changes.length;
    }
  }

  async function round() {
    let st = await state();
    if (st.on !== true) return st;
    await setState({ status: 'syncing' });
    try {
      await push(st);
      const res = await ask({ type: 'sync' });
      st = await state();
      await pull(st.cursor);
      return await setState({ status: res.status || 'upToDate', at: new Date().toISOString(), message: res.message || '' });
    } catch (e) {
      return setState({ status: 'failed', at: new Date().toISOString(), message: String((e && e.message) || e) });
    }
  }

  return {
    state,
    // One round at a time; a request during a round waits for it, then runs again.
    run() {
      const next = (running || Promise.resolve()).catch(() => {}).then(round);
      running = next.finally(() => { if (running === next) running = null; });
      return next;
    },
    // Turning sync on marks the whole library (anything pending from while it was off is dropped first,
    // so a library deleted then can't delete iCloud); off tells the native side to forget iCloud.
    async setOn(on) {
      if (on) {
        await db.syncReset({ markAll: true });
        const ai = ((await store.getSettings()) || {}).ai;
        await setState({ on: true, cursor: 0, aiRev: ai ? 1 : 0, status: 'syncing' });
        return this.run();
      }
      await db.syncReset();
      await setState({ on: false, status: '', aiRev: 0 });
      try { await send({ type: 'off' }); } catch { /* the app is gone: nothing to forget */ }
      return state();
    },
    // The first time: on for an empty library (a new install), asked for one that has saves (the dashboard asks).
    async decide() {
      const st = await state();
      if (st.on !== null) return st;
      if ((await db.count('items')) === 0) return this.setOn(true);
      return st;
    },
    // chrome.storage.onChanged: a change to the AI settings made here (not one that came from iCloud).
    async settingsChanged(oldSettings, newSettings) {
      if (applyingAi) return;
      if (JSON.stringify((oldSettings || {}).ai || null) === JSON.stringify((newSettings || {}).ai || null)) return;
      const st = await state();
      if (st.on !== true) return;
      await setState({ aiRev: (st.aiRev || 0) + 1 });
    },
  };
}
