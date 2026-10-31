// The first-pass journey, run the way the iPhone Share sheet runs it, against one evaluation case:
// what was shared → the product the Share Extension builds (Library.sharedProduct) → saveCapture (kind,
// collection, persistence) → the after-save work the app runs when it opens (fill.js tidySave / fillSave,
// which is where Apple Intelligence or your provider reads the save) → the save read back from a fresh
// store on the same records (a relaunch). Nothing here is a mock of the engine: it is the shipped
// keepsake/src code. Only the network is the harness's (a recorder around fetch).

import { createStore, memoryBackend, memoryRecordBackend } from '../../../keepsake/src/shared/storage.js';
import { saveCapture } from '../../../keepsake/src/shared/capture.js';
import { tidySave, fillSave } from '../../../keepsake/src/shared/fill.js';
import { titleFromCaption } from '../../../keepsake/src/instagram/post.js';
import { kindOf, hasOwnView } from '../../../keepsake/src/shared/kinds.js';
import { makeCollection, makeItem } from '../../../keepsake/src/shared/storage.js';

// The product the Share Extension hands to capture for an Instagram share, built from the evidence the
// case says was available. capture 'page': the public post page was read (caption, creator, hashtags);
// 'url-only': the page was a login wall or unreadable, so only the link (and any shared text) is there.
export function sharedProduct(evidence, capture = 'page') {
  const url = evidence.url || '';
  const p = { sparse: true, url, canonicalUrl: url };
  if (evidence.sharedText) p.description = evidence.sharedText;
  if (evidence.sharedTitle) p.title = evidence.sharedTitle;
  const ig = /(^|\.)instagram\.com\//i.test(url.replace(/^https?:\/\//, ''));
  if (ig) p.isInstagram = true;
  if (capture === 'page' && ig) {
    const caption = evidence.caption || '';
    const type = /\/reels?\//.test(url) ? 'reel' : 'post';
    p.sparse = false;
    if (!p.title) p.title = titleFromCaption(caption, evidence.creator || '', type);
    if (caption && (!p.description || p.description.length < caption.length)) p.description = caption;
    p.instagram = { caption, creator: evidence.creator || '', location: evidence.location || '', hashtags: evidence.hashtags?.length ? evidence.hashtags : hashtagsOf(caption), postedAt: '', links: [], products: [] };
    if (evidence.location) p.igLocation = { name: evidence.location };
  } else if (capture === 'page') {
    // A web page read by Safari's page reader: what the case recorded about it.
    Object.assign(p, { sparse: false, title: evidence.title || p.title || '', description: evidence.description || p.description || '' }, evidence.page || {});
  }
  return p;
}

const hashtagsOf = (caption) => [...new Set([...String(caption).matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase()))].slice(0, 30);

// A fresh library holding the case's collections (stable ids), settings and any learned preferences.
export async function libraryFor({ collections = [], prefs = null, settings = {}, secret = '', items = [] } = {}) {
  const kv = memoryBackend();
  const db = memoryRecordBackend();
  await db.put('collections', collections.map((c, i) => makeCollection({ ...c, sortOrder: i + 1 })));
  if (items.length) await db.put('items', items.map((i) => makeItem(i)));
  const store = createStore(kv, db);
  await store.init();
  if (prefs) await store.setPrefs(prefs);
  if (Object.keys(settings).length) await store.updateSettings(settings);
  if (secret) await store.setSecret('aiApiKey', secret);
  return { store, kv, db, reopen: () => createStore(kv, db) };
}

// What a save looks like to the person: its kind, the collection it shows in (or Review), and whether
// work on it is still pending.
export async function outcomeOf(store, id) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt) return { lost: true };
  const col = item.collectionId ? await store.getCollection(item.collectionId) : null;
  return {
    lost: false,
    kind: kindOf(item),
    collection: hasOwnView(kindOf(item)) ? null : col ? col.name : null,
    review: !hasOwnView(kindOf(item)) && (!col || !!item.needsReview),
    pending: item.captureState === 'pending',
    title: item.title,
    source: item.categorizationSource,
    reason: item.categorizationReason,
    confidence: item.confidence,
    details: item.details,
    filing: item.filing || null,
  };
}

// Runs one case through the first pass. `ai` decides who reads the save after it is saved:
//   null       no AI (Apple Intelligence unavailable and no key): the local engine only
//   { key, settings } your provider through the shipped adapter, as Fix-free automatic work would
//                when no device model is present (Chrome, an older iPhone with Optional AI on)
// Returns the immediate result (what the Share sheet card shows) and the settled one after the app's
// after-save work, both read back from a reopened store.
export async function runFirstPass(c, { capture = 'page', ai = null, deps = {} } = {}) {
  const { store, reopen } = await libraryFor({ collections: c.library.collections, prefs: c.library.prefs, items: c.library.items || [], settings: ai?.settings || {}, secret: ai?.key || '' });
  const product = sharedProduct(c.evidence, capture);
  const pending = [];
  const fills = [];
  const t0 = Date.now();
  const r = await saveCapture(store, product, { source: 'share-sheet', instant: true }, { enrich: (id) => pending.push(id), fill: (id) => fills.push(id) });
  if (!r.ok || !r.item) return { error: 'not saved', immediate: { lost: true }, settled: { lost: true } };
  const id = r.item.id;
  const immediate = await outcomeOf(reopen(), id);
  const t1 = Date.now();
  let error = '';
  try {
    for (const p of pending) await tidySave(store, p, deps);
    for (const f of fills) await fillSave(store, f, {}, { fetchFn: async () => { throw new Error('no network in eval'); }, allowed: async () => false, ...deps });
  } catch (e) {
    error = String(e?.message || e);
  }
  const settled = await outcomeOf(reopen(), id);
  return { id, immediate, settled, error, ms: { save: t1 - t0, settle: Date.now() - t1 } };
}
