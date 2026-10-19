import { readFileSync } from 'node:fs';

// A minimal in-memory stand-in for the chrome.* APIs the background worker uses.
// It records calls so tests can assert on side effects (scripts injected, tabs opened).
// It is not a browser: nothing here proves behaviour in real Chrome.

function areaOf(data, name, notify, quota = () => ({ bytes: Infinity })) {
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  let written = 0;
  return {
    async get(keys) {
      const out = {};
      const list = keys === null || keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      for (const k of list) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(obj) {
      // A quota, like Safari's session area: the write fails and nothing changes. `countsReplaced`
      // also counts the value a key is about to lose, so a full area refuses even a smaller value;
      // `leaks` counts every byte ever written, replaced or removed, until the browser restarts.
      const q = quota();
      const add = Buffer.byteLength(JSON.stringify(obj));
      const size = q.leaks ? written + add : q.countsReplaced ? Buffer.byteLength(JSON.stringify(data)) + add : Buffer.byteLength(JSON.stringify({ ...data, ...obj }));
      if (size > q.bytes) throw new Error(`Invalid call to browser.storage.${name}.set(). Exceeded storage quota.`);
      written += add;
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      notify(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in data) changes[k] = { oldValue: data[k], newValue: undefined };
        delete data[k];
      }
      notify(changes, name);
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    async getBytesInUse(keys) {
      const all = keys == null ? data : Object.fromEntries(Object.entries(data).filter(([k]) => (Array.isArray(keys) ? keys : [keys]).includes(k)));
      return Buffer.byteLength(JSON.stringify(all));
    },
  };
}

const event = (set) => ({ addListener: (fn) => set.add(fn), removeListener: (fn) => set.delete(fn), hasListener: (fn) => set.has(fn) });

export function fakeChrome() {
  const L = { storage: new Set(), message: new Set(), installed: new Set(), startup: new Set(), menu: new Set(), permAdded: new Set(), permRemoved: new Set(), tabUpdated: new Set(), tabRemoved: new Set() };
  const local = {};
  const session = {};
  const notify = (changes, area) => L.storage.forEach((fn) => fn(changes, area));
  const calls = { executeScript: [], tabsCreated: [], tabsRemoved: [], tabsUpdated: [], contextMenus: [], registered: [] };
  const state = { granted: [], executeScript: async () => [{ result: null }], registered: [], sessionQuota: { bytes: Infinity }, tabUrls: {} };
  let nextTab = 100;

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (p = '') => `chrome-extension://test-extension-id/${p}`,
      getManifest: () => JSON.parse(readFileSync(new URL('../../keepsake/manifest.json', import.meta.url), 'utf8')),
      onMessage: event(L.message),
      onInstalled: event(L.installed),
      onStartup: event(L.startup),
      lastError: undefined,
      sendMessage: () => {},
    },
    storage: { local: areaOf(local, 'local', notify), session: areaOf(session, 'session', notify, () => state.sessionQuota), onChanged: event(L.storage) },
    contextMenus: {
      removeAll: (cb) => { calls.contextMenus.length = 0; cb && cb(); },
      create: (opts, cb) => { calls.contextMenus.push(opts); cb && cb(); },
      onClicked: event(L.menu),
    },
    scripting: {
      executeScript: async (opts) => { calls.executeScript.push(opts); return state.executeScript(opts); },
      getRegisteredContentScripts: async ({ ids } = {}) => state.registered.filter((s) => !ids || ids.includes(s.id)),
      registerContentScripts: async (list) => { state.registered.push(...list); calls.registered.push(...list); },
      updateContentScripts: async (list) => { state.registered = state.registered.map((s) => list.find((n) => n.id === s.id) || s); },
      unregisterContentScripts: async ({ ids } = {}) => { state.registered = state.registered.filter((s) => !ids.includes(s.id)); },
    },
    permissions: {
      getAll: async () => ({ origins: [...state.granted], permissions: [] }),
      contains: async ({ origins = [] }) => origins.every((o) => state.granted.includes(o)),
      request: async ({ origins = [] }) => { state.granted.push(...origins); return true; },
      remove: async ({ origins = [] }) => { state.granted = state.granted.filter((o) => !origins.includes(o)); return true; },
      onAdded: event(L.permAdded),
      onRemoved: event(L.permRemoved),
    },
    tabs: {
      create: async (opts) => { const tab = { id: nextTab++, ...opts, status: 'complete' }; calls.tabsCreated.push(tab); return tab; },
      remove: async (id) => { calls.tabsRemoved.push(id); },
      get: async (id) => ({ id, status: 'complete', url: state.tabUrls[id] }),
      // A navigation: "loading" then "complete", a moment later.
      update: async (id, props) => {
        calls.tabsUpdated.push({ id, ...props });
        if (props.url) state.tabUrls[id] = props.url;
        setTimeout(() => { for (const status of ['loading', 'complete']) L.tabUpdated.forEach((fn) => fn(id, { status })); }, 0);
        return { id, ...props };
      },
      query: async () => [],
      sendMessage: (id, msg, cb) => cb && cb(),
      onUpdated: event(L.tabUpdated),
      onRemoved: event(L.tabRemoved),
    },
  };

  // Deliver a runtime message the way Chrome does and resolve with the response.
  function send(msg, sender = { url: chrome.runtime.getURL('src/popup/popup.html') }) {
    return new Promise((resolve) => {
      let answered = false;
      for (const fn of L.message) {
        const keepOpen = fn(msg, sender, (res) => { answered = true; resolve(res); });
        if (keepOpen === true) return;
      }
      if (!answered) resolve(undefined);
    });
  }

  return { chrome, local, session, calls, state, listeners: L, send };
}
