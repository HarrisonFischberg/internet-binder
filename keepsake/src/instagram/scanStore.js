// An Instagram scan's post list and the thumbnails it copied (small JPEG data: URLs, tens of KB each),
// in their own IndexedDB database. chrome.storage.session holds only the scan's small summary (status,
// count, which tab), which the popup and dashboard watch: Safari's session area fills up when a big entry
// is rewritten every second, and its messages drop pictures by the megabyte, so the page sends each
// thumbnail once (IG_SCAN_THUMB) and the import reads them from here. Cleared when a scan starts, after
// its import and with Delete all local data.

const DB = 'keepsake-scan';
const THUMBS = 'thumbs';
const SCAN = 'scan';

// A post's key: its shortcode (what the page sends with each thumbnail), else its link.
export const thumbKey = (p) => p.shortcode || p.url;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      for (const name of [THUMBS, SCAN]) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(stores, mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const out = fn(tx);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const request = (r) => new Promise((resolve) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => resolve(undefined);
});

export async function putThumbs(map) {
  if (map.size) await run(THUMBS, 'readwrite', (tx) => map.forEach((v, k) => tx.objectStore(THUMBS).put(v, k)));
}

export async function getThumbs(keys) {
  const pairs = await run(THUMBS, 'readonly', (tx) => Promise.all(keys.map(async (k) => [k, await request(tx.objectStore(THUMBS).get(k))])));
  return new Map(pairs.filter(([, v]) => typeof v === 'string'));
}

export async function savePosts(posts) {
  await run(SCAN, 'readwrite', (tx) => tx.objectStore(SCAN).put(posts, 'posts'));
}

export async function loadPosts() {
  const posts = await run(SCAN, 'readonly', (tx) => request(tx.objectStore(SCAN).get('posts')));
  return Array.isArray(posts) ? posts : [];
}

export async function clearScanStore() {
  await run([THUMBS, SCAN], 'readwrite', (tx) => { tx.objectStore(THUMBS).clear(); tx.objectStore(SCAN).clear(); });
}
