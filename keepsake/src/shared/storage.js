// Keepsake storage (schema 3).
//
// chrome.storage.local (the `kv` backend):
//   keepsake_meta          { schemaVersion, installedAt, updatedAt, migratedToRecordsAt?, textRepairedAt? }
//   keepsake_settings      UI + feature settings (per device)
//   keepsake_secrets       { aiApiKey }: never exported
// IndexedDB "keepsake" (the `db` backend, see db.js):
//   items                  one record per save, including the Trash (deletedAt set)
//   collections            one record per collection
//   kv: prefs              categorization preferences (threshold, learned keywords…)
//   kv: importHistory      { instagram: { [normalizedUrl]: itemId } }
//   kv: aiLog              [AiChange]: what AI changed, for undo. Never exported.
//
// Schema 1/2 kept everything in chrome.storage.local under keepsake_items, keepsake_collections,
// keepsake_prefs, keepsake_importHistory and keepsake_aiLog. init() copies those into IndexedDB once,
// checks the copy, and leaves the old keys untouched so a rollback to 1.3.x still finds its data.

import { uid, nowIso, sanitizeText, sanitizeMultiline, sanitizeUrl, deepMerge, hostnameOf, prettyRetailer, decodeEntities, hasEntities } from './util.js';
import { normalizeUrl, cleanUrl } from './url.js';
import { DEFAULT_TAXONOMY } from './taxonomy.js';
import { emptyPrefs, findSimilarCollection, normalizeName, learnFromCorrection, forgetCollection } from './categorizer.js';
import { memoryRecordBackend, STORES } from './db.js';
import { isKind, kindOf, sanitizeDetails, recipeFromText, workoutFromText, looksLikeWorkout, needsCollection, STATUSES } from './kinds.js';
import { makeGoal, makeCheckin } from './goals.js';
import { cleanTopics } from './topics.js';

export { idbBackend, memoryRecordBackend, StorageFullError } from './db.js';

export const SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_VERSION = 2; // the last schema stored entirely in chrome.storage.local
export const KEYS = {
  meta: 'keepsake_meta',
  collections: 'keepsake_collections',
  items: 'keepsake_items',
  prefs: 'keepsake_prefs',
  settings: 'keepsake_settings',
  importHistory: 'keepsake_importHistory',
  secrets: 'keepsake_secrets',
};
const AI_LOG_KEY = 'keepsake_aiLog';
const AI_LOG_MAX = 3000;
// Where a schema 1/2 library lives (read once by the migration, then left for rollback).
const LEGACY = { collections: KEYS.collections, items: KEYS.items, prefs: KEYS.prefs, importHistory: KEYS.importHistory };
const LEGACY_KEYS = [...Object.values(LEGACY), AI_LOG_KEY];
export const TRASH_DAYS = 30;
// Fields a person edits by hand. Once edited, AI and enrichment leave them alone.
// Fields you set by hand: automation (Lookups, AI) leaves them as they are. kind: you put the save in a
// Lifestyle view (or took it out), so your AI provider fills in that kind's details and never changes it.
const USER_FIELDS = ['title', 'price', 'currency', 'note', 'image', 'images', 'url', 'description', 'topics', 'kind'];
const CAPTURE_STATES = ['pending', 'complete', 'failed'];
export const LIMITS = { maxItems: 20000, maxCollections: 500, maxImportBytes: 150 * 1024 * 1024, maxImageBytes: 400 * 1024, maxGoals: 2000, maxCheckins: 50000, maxCheckinsPerGoal: 2000 };

// Styles a person can pick in Settings → Appearance. The first is the default.
// `about` and `swatch` (page, card, accent, a kind colour) are for the picker in Settings.
export const STYLES = [
  { value: 'pantry', label: 'Pantry Pop', about: 'Bold outlines, hard shadows, a bright colour per kind.', swatch: ['#FFF7E8', '#FFFFFF', '#FFC23D', '#FF5A36'] },
  { value: 'notebook', label: 'Field Notebook', about: 'Graph paper, serif names, a highlighter swipe.', swatch: ['#F6F2E7', '#FFFDF7', '#F7EBA8', '#A63A28'] },
  { value: 'gallery', label: 'Gallery', about: 'White walls, big serif titles, photos first.', swatch: ['#FFFFFF', '#F6F6F4', '#111111', '#E4E4E4'] },
  { value: 'atlas', label: 'Night Atlas', about: 'Dark panels, lamp-lit photos, one amber action.', swatch: ['#0B0F17', '#1B2433', '#FFB547', '#6FE3E8'] },
  { value: 'swiss', label: 'Swiss Index', about: 'Hairlines, condensed type, one signal red.', swatch: ['#FAFAF7', '#FFFFFF', '#CC2A1E', '#0A0A0A'] },
];

// Toolbar icons (Settings → Appearance): one per style. Pantry's (id pantry) is the app's own Patchwork
// icon and the default, so it carries the app's name rather than its style's.
export const ICONS = STYLES.map((s) => ({ value: s.value, label: s.value === 'pantry' ? 'Keepsake' : s.label }));

// Sets data-style / data-theme on <html> (or any element) from settings. Pantry Pop needs no attribute.
// Styles from before 1.5 (modern, moss, minimal) fall back to the default.
export function applyLook(node, settings) {
  const theme = settings?.theme || 'system';
  const style = STYLES.some((s) => s.value === settings?.style) ? settings.style : STYLES[0].value;
  if (theme === 'light' || theme === 'dark') node.dataset.theme = theme;
  else delete node.dataset.theme;
  if (style === STYLES[0].value) delete node.dataset.style;
  else node.dataset.style = style;
}

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  style: 'pantry', // pantry | notebook | gallery | atlas | swiss: the look, per device (see src/shared/tokens.css)
  icon: 'pantry', // toolbar icon: a style id (see ICONS and src/toolbar/icon.js)
  home: { comeBack: true }, // Home's "Come back to": saves not opened in 6+ weeks (worked out on this device)
  // Lookups (off until turned on, each needs its site granted): fill in places (OpenStreetMap), films and
  // shows (Wikidata) and books (Open Library) from free public sources. See src/shared/lookups.js.
  lookups: { places: false, media: false, books: false },
  floating: {
    mode: 'off', // off | all | selected
    sites: [], // origin patterns like *://www.example.com/*
    hiddenSites: [], // hostnames where buttons are hidden even if permitted
    size: 'medium', // small | medium | large
    position: 'top-right', // top-right | top-left | bottom-right | bottom-left
  },
  instagram: {
    storeThumbnails: true,
    safetyLimit: 300,
    idleTimeoutMs: 6000,
    readPostDetails: true, // after a scan, read each post's page for caption/creator/links (needs instagram.com access)
    readDelayMs: 1500,
  },
  ai: {
    // One switch for everything AI: instant save (the AI tidies the title and picks the
    // collection at save time), "Fix with AI", and "Find products" for Instagram saves.
    on: false,
    webLookup: false, // "Find products": also run the provider's web search for listings
    provider: 'anthropic', // anthropic | openai | custom
    effort: 'medium', // low | medium | high (Claude models)
    baseUrl: '',
    model: '',
  },
  onboardingDone: false,
};

// --- backends -------------------------------------------------------------------

export function memoryBackend(initial = {}) {
  const data = { ...initial };
  const listeners = new Set();
  return {
    async get(keys) {
      const out = {};
      const list = keys === null || keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = structuredClone(v);
      }
      listeners.forEach((fn) => fn(changes));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    onChanged(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function chromeBackend() {
  const area = globalThis.chrome?.storage?.local;
  if (!area) return null;
  return {
    get: (keys) => area.get(keys),
    set: (obj) => area.set(obj),
    remove: (keys) => area.remove(keys),
    clear: () => area.clear(),
    getBytesInUse: (keys) => area.getBytesInUse(keys),
    onChanged(fn) {
      const handler = (changes, areaName) => {
        if (areaName === 'local') fn(changes);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}

// --- migrations ------------------------------------------------------------------
// Each migration transforms the full record set from version N to N+1.
const MIGRATIONS = {
  // 0 -> 1: initial schema. Nothing stored before v1 (kept as the pattern for later).
  0: (data) => data,
  // 1 -> 2: "rules" (Settings) and collection keywords were the same idea. Each rule's
  // keywords move onto its collection, and rules are gone.
  1: (data) => {
    const prefs = data[KEYS.prefs];
    if (!prefs || !Array.isArray(prefs.rules)) return data;
    const { rules, ...rest } = prefs;
    return { ...data, [KEYS.collections]: foldRulesIntoKeywords(data[KEYS.collections] || {}, rules), [KEYS.prefs]: rest };
  },
};

// Adds each rule's keywords to its collection's keywords. Returns new collections.
function foldRulesIntoKeywords(collections, rules) {
  const out = { ...collections };
  for (const r of rules || []) {
    const col = r && out[r.collectionId];
    if (!col || !Array.isArray(r.keywords)) continue;
    out[r.collectionId] = { ...col, keywords: uniqStrings([...(col.keywords || []), ...r.keywords.map((k) => String(k).toLowerCase())], 40) };
  }
  return out;
}

// A collection nobody picked a color for gets the least-used one, so empty
// collections' placeholder tiles don't all look alike.
export const COLLECTION_COLORS = ['#8A9A88', '#5F6F5E', '#B9924F', '#A6503F', '#6B7C9B', '#8C6B8F', '#4F6F57', '#9C7A5B', '#6A6A6A', '#C97B4A'];
function nextColor(collections) {
  const used = new Map(COLLECTION_COLORS.map((c) => [c.toLowerCase(), 0]));
  for (const c of collections) if (used.has(String(c.color).toLowerCase())) used.set(c.color.toLowerCase(), used.get(c.color.toLowerCase()) + 1);
  return COLLECTION_COLORS.reduce((best, c) => (used.get(c.toLowerCase()) < used.get(best.toLowerCase()) ? c : best));
}

export function migrate(data) {
  let version = Number(data[KEYS.meta]?.schemaVersion || 0);
  let out = data;
  while (version < LEGACY_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    out = step(out);
    version += 1;
  }
  out[KEYS.meta] = { ...(out[KEYS.meta] || {}), schemaVersion: Math.max(version, LEGACY_SCHEMA_VERSION) };
  return out;
}

// --- record factories ----------------------------------------------------------------

export function makeCollection(input = {}) {
  const now = nowIso();
  return {
    id: input.id || uid(),
    name: sanitizeText(input.name, 80) || 'Untitled',
    description: sanitizeText(input.description, 300),
    coverImage: sanitizeUrl(input.coverImage, { allowData: true }),
    color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#8A9A88',
    keywords: uniqStrings(input.keywords, 40).map((k) => sanitizeText(k, 40).toLowerCase()).filter(Boolean),
    aliases: uniqStrings(input.aliases, 20).map((k) => sanitizeText(k, 40)).filter(Boolean),
    taxonomyKey: typeof input.taxonomyKey === 'string' ? input.taxonomyKey : null,
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
    pinned: input.pinned === true,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function makeItem(input = {}) {
  const now = nowIso();
  const url = sanitizeUrl(input.url || input.sourceUrl);
  const sourceUrl = sanitizeUrl(input.sourceUrl || input.url);
  const canonicalUrl = sanitizeUrl(input.canonicalUrl) || cleanUrl(url) || url;
  const host = hostnameOf(canonicalUrl || url);
  const price = input.price === '' || input.price === null || input.price === undefined ? null : Number(input.price);
  const type = ['product', 'inspiration', 'instagram'].includes(input.type) ? input.type : /instagram\.com/.test(host) ? 'instagram' : 'product';
  // What the save is. Records from before kinds existed get one derived from their type; an
  // Instagram caption with an ingredient list makes the save a recipe.
  // A caption that lists exercises and talks about training makes it a workout.
  const caption = !isKind(input.kind) && input.instagram && typeof input.instagram === 'object' ? input.instagram.caption : '';
  const captionRecipe = caption ? recipeFromText(caption) : null;
  const captionWorkout = caption && !captionRecipe && looksLikeWorkout(caption) ? workoutFromText(caption) : null;
  const kind = isKind(input.kind) ? input.kind : captionRecipe ? 'recipe' : captionWorkout ? 'workout' : kindOf({ ...input, type });
  const details = sanitizeDetails(kind, input.details && typeof input.details === 'object' && Object.keys(input.details).length ? input.details : captionRecipe || captionWorkout || {});
  return {
    id: input.id || uid(),
    collectionId: input.collectionId || null,
    type,
    kind,
    details,
    status: STATUSES.includes(input.status) ? input.status : 'saved',
    title: sanitizeText(decodeEntities(input.title), 200) || (type === 'instagram' ? 'Instagram post' : 'Untitled item'),
    description: sanitizeMultiline(decodeEntities(input.description), 2200),
    note: sanitizeText(input.note, 1000),
    price: Number.isFinite(price) && price >= 0 ? price : null,
    currency: sanitizeText(input.currency, 8).toUpperCase(),
    retailer: sanitizeText(decodeEntities(input.retailer), 80) || (type === 'instagram' ? 'Instagram' : prettyRetailer(host)),
    host,
    url: canonicalUrl || url,
    canonicalUrl,
    sourceUrl,
    urlKey: normalizeUrl(canonicalUrl || sourceUrl || url),
    image: sanitizeUrl(input.image, { allowData: true }),
    images: uniqStrings(input.images, 8).map((u) => sanitizeUrl(u, { allowData: true })).filter(Boolean),
    // The store's own product type and tags, kept so the item can be re-sorted later (Review suggestions).
    productType: sanitizeText(input.productType, 80),
    tags: uniqStrings(input.tags, 12).map((t) => sanitizeText(t, 40)).filter(Boolean),
    // What it's about ("AI", "Video games"): guessed on save (topics.js) or set by you.
    // When you last opened it in Keepsake (for Home's "Come back to"). Only ever set on this device.
    openedAt: typeof input.openedAt === 'string' && !Number.isNaN(Date.parse(input.openedAt)) ? input.openedAt : null,
    topics: cleanTopics(input.topics).map((t) => sanitizeText(t, 30)).filter(Boolean),
    topicsBy: input.topicsBy === 'guess' || input.topicsBy === 'you' ? input.topicsBy : '',
    imageAspect: Number.isFinite(input.imageAspect) && input.imageAspect > 0.2 && input.imageAspect < 5 ? input.imageAspect : null,
    favorite: !!input.favorite,
    // No longer used (Archive was removed in M2): kept so older data and exports round-trip unchanged.
    archived: !!input.archived,
    purchased: !!input.purchased,
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : null,
    categorizationSource: sanitizeText(input.categorizationSource, 40) || 'local',
    categorizationReason: sanitizeText(input.categorizationReason, 300),
    needsReview: !!input.needsReview,
    previousCollections: uniqStrings(input.previousCollections, 20),
    instagram: input.instagram && typeof input.instagram === 'object' ? sanitizeInstagram(input.instagram, now) : null,
    ai: input.ai && typeof input.ai === 'object' ? sanitizeAi(input.ai) : null,
    relatedItemId: typeof input.relatedItemId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(input.relatedItemId) ? input.relatedItemId : null,
    // Schema 3: what was captured, which fields the person edited, how far the save got, and the Trash.
    originalTitle: sanitizeText(decodeEntities(input.originalTitle), 200) || sanitizeText(decodeEntities(input.title), 200),
    userFields: uniqStrings(input.userFields, 20).filter((f) => USER_FIELDS.includes(f) || f === 'collectionId'),
    captureState: CAPTURE_STATES.includes(input.captureState) ? input.captureState : 'complete',
    captureError: sanitizeText(input.captureError, 200),
    // When your AI provider last read the save to work out what it is (src/shared/understand.js).
    understoodAt: typeof input.understoodAt === 'string' && !Number.isNaN(Date.parse(input.understoodAt)) ? input.understoodAt : null,
    // Brought in by a bulk import (open tabs, Instagram, a backup) and not read by your AI provider yet.
    // Nothing reads it automatically; "Run AI on imported saves" does, when you ask (src/shared/aiQueue.js).
    needsAi: !!input.needsAi,
    deletedAt: typeof input.deletedAt === 'string' && !Number.isNaN(Date.parse(input.deletedAt)) ? input.deletedAt : null,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

function sanitizePlaceTag(p) {
  if (!p || typeof p !== 'object' || !p.name) return null;
  const coord = (v, max) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Math.abs(Number(v)) <= max ? Number(v) : null);
  const lat = coord(p.lat, 90);
  const lng = coord(p.lng, 180);
  const pin = lat !== null && lng !== null && !(lat === 0 && lng === 0);
  return { name: sanitizeText(p.name, 120), address: sanitizeText(p.address, 200), city: sanitizeText(p.city, 80), region: sanitizeText(p.region, 60), postalCode: sanitizeText(p.postalCode, 20), lat: pin ? lat : null, lng: pin ? lng : null };
}

function sanitizeInstagram(ig, now) {
  const priceOf = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    collectionName: sanitizeText(ig.collectionName, 80),
    creator: sanitizeText(ig.creator, 80),
    caption: sanitizeMultiline(ig.caption, 2200),
    postType: sanitizeText(ig.postType, 20),
    importedAt: ig.importedAt || now,
    postedAt: sanitizeText(ig.postedAt, 40),
    location: sanitizeText(ig.location, 120),
    // The location tag's street, city and pin, when the post's page had them (1.4.2+; older builds drop it).
    place: sanitizePlaceTag(ig.place),
    originalImage: sanitizeUrl(ig.originalImage),
    hashtags: uniqStrings(ig.hashtags, 30).map((h) => sanitizeText(h, 60)),
    links: (Array.isArray(ig.links) ? ig.links : []).slice(0, 10)
      .map((l) => (l && typeof l === 'object' ? { url: sanitizeUrl(l.url), label: sanitizeText(l.label, 80) } : null))
      .filter((l) => l && l.url),
    products: (Array.isArray(ig.products) ? ig.products : []).slice(0, 10)
      .map((p) => (p && typeof p === 'object' && p.name ? { name: sanitizeText(p.name, 160), price: priceOf(p.price), currency: sanitizeText(p.currency, 8).toUpperCase(), url: sanitizeUrl(p.url), retailer: sanitizeText(p.retailer, 80) } : null))
      .filter(Boolean),
    linkInBio: !!ig.linkInBio,
    details: !!ig.details,
  };
}

function sanitizeAi(ai) {
  const priceOf = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    provider: sanitizeText(ai.provider, 40),
    model: sanitizeText(ai.model, 80),
    analyzedAt: ai.analyzedAt || nowIso(),
    suggestions: (Array.isArray(ai.suggestions) ? ai.suggestions : []).slice(0, 8).map((s) => ({
      name: sanitizeText(s.name, 120),
      category: sanitizeText(s.category, 60),
      brand: sanitizeText(s.brand, 60),
      searchPhrases: uniqStrings(s.searchPhrases, 6).map((p) => sanitizeText(p, 100)),
      note: sanitizeText(s.note, 200),
    })),
    // "Found online" candidates: links only ever come from the provider's real search results.
    candidates: (Array.isArray(ai.candidates) ? ai.candidates : []).slice(0, 8).map((c) => ({
      name: sanitizeText(c.name, 160),
      brand: sanitizeText(c.brand, 60),
      retailer: sanitizeText(c.retailer, 80),
      price: priceOf(c.price),
      currency: sanitizeText(c.currency, 8).toUpperCase(),
      url: sanitizeUrl(c.url),
      note: sanitizeText(c.note, 200),
      confidence: Number.isFinite(Number(c.confidence)) ? Math.max(0, Math.min(1, Number(c.confidence))) : null,
      verified: !!c.verified,
    })).filter((c) => c.name),
    searchedAt: ai.searchedAt || null,
  };
}

function uniqStrings(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// --- the store ---------------------------------------------------------------------

// `kv` holds settings, the AI key and meta (chrome.storage.local in the extension); `db` holds
// saves, collections and learned data (IndexedDB in the extension, see db.js). Both have in-memory
// versions for tests. On first run of schema 3 the store copies a schema 1/2 library out of
// chrome.storage.local into `db`, checks the copy, and leaves the old keys in place for rollback.
export function createStore(kv, db = memoryRecordBackend()) {
  if (!db) throw new Error('Keepsake needs IndexedDB, which is turned off for this browser profile.');
  const be = kv;
  let writeQueue = Promise.resolve();
  const serial = (fn) => {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
  };
  // One init/migration at a time across popup, dashboard and worker where Web Locks exist.
  const exclusive = (name, fn) => (globalThis.navigator?.locks?.request ? navigator.locks.request(name, fn) : serial(fn));

  const kvGet = async (name, fallback) => {
    const r = await db.get('kv', name);
    return r ? r.value : fallback;
  };
  const kvSet = (name, value) => db.put('kv', [{ key: name, value }]);
  const kvUpdate = async (name, fallback, fn) => {
    const [r] = await db.update('kv', [name], (rec) => ({ key: name, value: fn(rec ? rec.value : structuredClone(fallback)) }));
    return r.value;
  };
  const live = (i) => i && !i.deletedAt;
  const mapOf = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

  async function readSettings() {
    const raw = await be.get([KEYS.meta, KEYS.settings, KEYS.secrets]);
    return { meta: raw[KEYS.meta] || null, settings: deepMerge(DEFAULT_SETTINGS, raw[KEYS.settings] || {}), secrets: raw[KEYS.secrets] || {} };
  }

  async function readAll() {
    const [{ meta, settings, secrets }, items, collections, prefs, importHistory, goals] = await Promise.all([
      readSettings(), db.all('items'), db.all('collections'), kvGet('prefs', null), kvGet('importHistory', null), db.all('goals'),
    ]);
    return {
      meta,
      collections: mapOf(collections),
      items: mapOf(items.filter(live)),
      goals: goals.filter((g) => !g.deletedAt),
      prefs: { ...emptyPrefs(), ...(prefs || {}) },
      settings,
      importHistory: importHistory || { instagram: {} },
      secrets,
    };
  }

  // v1/v2 library in chrome.storage.local -> v3 records. Never overwrites a record that already
  // exists in `db`, so running it again is always safe. `since` (the first migration time) limits a
  // re-run to saves and collections an older Keepsake created after that point: e.g. a rollback to
  // 1.3.x, or an old background worker still running after an update. Older v2 entries are not
  // brought back, so something deleted for good in schema 3 stays deleted.
  async function migrateToRecords(raw, { since = null } = {}) {
    const legacy = migrate({ ...raw });
    const newer = (r) => !since || (typeof r.createdAt === 'string' && r.createdAt > since);
    const haveCols = mapOf(await db.all('collections'));
    const haveItems = mapOf(await db.all('items'));
    const collections = Object.values(legacy[KEYS.collections] || {}).filter((c) => c && c.id && !haveCols[c.id] && newer(c));
    const colIds = new Set([...Object.keys(haveCols), ...collections.map((c) => c.id)]);
    const items = Object.values(legacy[KEYS.items] || {}).filter((i) => i && i.id && !haveItems[i.id] && newer(i)).map((i) => {
      const known = !i.collectionId || colIds.has(i.collectionId);
      return {
        ...i,
        ...(known ? {} : { collectionId: null, needsReview: true }),
        originalTitle: i.originalTitle || i.title || '',
        userFields: Array.isArray(i.userFields) ? i.userFields : [],
        captureState: 'complete',
        captureError: '',
        deletedAt: null,
      };
    });
    if (collections.length) await db.put('collections', collections);
    for (let i = 0; i < items.length; i += 500) await db.put('items', items.slice(i, i + 500));
    if (!since) {
      if (legacy[KEYS.prefs] && !(await db.get('kv', 'prefs'))) await kvSet('prefs', { ...emptyPrefs(), ...legacy[KEYS.prefs] });
      if (legacy[KEYS.importHistory] && !(await db.get('kv', 'importHistory'))) await kvSet('importHistory', legacy[KEYS.importHistory]);
      if (Array.isArray(raw[AI_LOG_KEY]) && !(await db.get('kv', 'aiLog'))) await kvSet('aiLog', raw[AI_LOG_KEY]);
    }
    // The check: every id and title arrived.
    const got = mapOf(await db.all('items'));
    const missing = items.filter((i) => !got[i.id] || got[i.id].title !== i.title);
    const gotCols = mapOf(await db.all('collections'));
    const missingCols = collections.filter((c) => !gotCols[c.id]);
    if (missing.length || missingCols.length) {
      throw new Error(`Keepsake couldn't finish updating its storage (${missing.length} saves and ${missingCols.length} collections didn't copy). Your saves are untouched; reload to try again.`);
    }
    return { items: items.length, collections: collections.length };
  }

  // Saves made before Keepsake decoded HTML entities ("14&#215;8-inch"): decode them once. Only records
  // that contain an entity are rewritten, and only their text changes (same id, dates, collection).
  const encodedText = (i) => [i.title, i.description, i.retailer, i.originalTitle, ...Object.values(i.details || {}).flat()].some(hasEntities);
  async function repairEncodedText() {
    const ids = (await db.all('items')).filter((i) => i && encodedText(i)).map((i) => i.id);
    let repaired = 0;
    if (ids.length) {
      await db.update('items', ids, (item) => {
        if (!item || !encodedText(item)) return undefined;
        repaired++;
        return { ...item, ...makeItem(item), id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt };
      });
    }
    return repaired;
  }

  // Before M2 shipped, recipes, videos, places… each got an automatic collection of the same name as
  // their view. They now live in their views only, so those collections are removed once, but only
  // ones that still have the default name and hold nothing except that kind; their saves just leave
  // the collection (they stay in their view). Anything renamed or used for other saves is left alone.
  const KIND_COLLECTIONS = { recipes: ['recipe', 'Recipes'], workouts: ['workout', 'Workouts'], places: ['place', 'Places'], videos: ['video', 'Videos'], 'watch-later': ['video', 'Watch later'],
    articles: ['article', 'Articles'], 'read-later': ['article', 'Read later'], watchlist: ['media', 'Watchlist'], 'reading-list': ['book', 'Reading list'] };
  async function removeKindCollections() {
    const cols = (await db.all('collections')).filter((c) => KIND_COLLECTIONS[c.taxonomyKey] && normalizeName(c.name) === normalizeName(KIND_COLLECTIONS[c.taxonomyKey][1]));
    if (!cols.length) return 0;
    const items = await db.all('items');
    const removed = [];
    for (const c of cols) {
      const inside = items.filter((i) => i.collectionId === c.id);
      if (inside.some((i) => kindOf(i) !== KIND_COLLECTIONS[c.taxonomyKey][0])) continue;
      if (inside.length) await db.update('items', inside.map((i) => i.id), (i) => (i ? { ...i, collectionId: null, needsReview: false, previousCollections: [...(i.previousCollections || []), c.id].slice(-20) } : undefined));
      removed.push(c.id);
    }
    if (removed.length) await db.remove('collections', removed);
    return removed.length;
  }

  // Before bulk imports waited for Run AI, an import sent every save to your AI provider straight away,
  // and a big one could stall there. Once: saves still waiting for the AI tidy, and Instagram imports
  // your provider never read, join the imported-saves queue (needsAi) instead.
  async function queueUnreadImports() {
    const ids = (await db.all('items')).filter((i) => live(i) && !i.needsAi && (i.captureState === 'pending' || (i.type === 'instagram' && i.instagram?.importedAt && !i.understoodAt))).map((i) => i.id);
    if (ids.length) await db.update('items', ids, (i) => (i ? { ...i, captureState: i.captureState === 'pending' ? 'complete' : i.captureState, needsAi: true } : undefined));
    return ids.length;
  }

  // Goals and every check-in they have, for good.
  async function removeGoals(goalIds) {
    const checkins = (await Promise.all(goalIds.map((id) => db.byIndex('checkins', 'goalId', id)))).flat();
    if (checkins.length) await db.remove('checkins', checkins.map((c) => c.id));
    await db.remove('goals', goalIds);
  }

  const api = {
    backend: be,
    db,

    async init() {
      return exclusive('keepsake-init', async () => {
        const raw = await be.get([...Object.values(KEYS), ...LEGACY_KEYS]);
        const hadMeta = !!raw[KEYS.meta];
        const version = Number(raw[KEYS.meta]?.schemaVersion || 0);
        const now = nowIso();
        const since = raw[KEYS.meta]?.migratedToRecordsAt || null;
        let migrated = null;
        let caughtUp = null;
        if (raw[LEGACY.items] || raw[LEGACY.collections]) {
          if (!since && version < SCHEMA_VERSION) migrated = await migrateToRecords(raw);
          else if (since) {
            // An older Keepsake wrote to the v2 keys after the upgrade: bring its new saves across.
            const r = await migrateToRecords(raw, { since });
            if (r.items || r.collections) caughtUp = r;
          }
        }
        if (!(await db.count('collections'))) await db.put('collections', Object.values(defaultCollections()));
        if (!(await db.get('kv', 'prefs'))) await kvSet('prefs', emptyPrefs());
        if (!(await db.get('kv', 'importHistory'))) await kvSet('importHistory', { instagram: {} });
        const textRepaired = raw[KEYS.meta]?.textRepairedAt ? null : await repairEncodedText();
        const kindCollections = raw[KEYS.meta]?.kindCollectionsRemovedAt ? null : await removeKindCollections();
        const aiBacklog = raw[KEYS.meta]?.aiBacklogAt ? null : await queueUnreadImports();
        const write = { [KEYS.meta]: { installedAt: now, ...(raw[KEYS.meta] || {}), schemaVersion: SCHEMA_VERSION, updatedAt: now, ...(migrated ? { migratedToRecordsAt: now, migratedCounts: migrated } : {}), ...(caughtUp ? { caughtUpAt: now, caughtUpCounts: caughtUp } : {}), ...(textRepaired !== null ? { textRepairedAt: now, textRepairedCount: textRepaired } : {}), ...(kindCollections !== null ? { kindCollectionsRemovedAt: now, kindCollectionsRemoved: kindCollections } : {}), ...(aiBacklog !== null ? { aiBacklogAt: now, aiBacklogQueued: aiBacklog } : {}) } };
        if (!raw[KEYS.settings]) write[KEYS.settings] = structuredClone(DEFAULT_SETTINGS);
        else if (raw[KEYS.settings].ai && raw[KEYS.settings].ai.on === undefined) {
          // Before the single switch, each AI feature had its own. Carry over only the
          // widest one (instant save); the others agreed to send less, so they start off.
          const { enabled, useForCategorization, instantSave, ...ai } = raw[KEYS.settings].ai;
          write[KEYS.settings] = { ...raw[KEYS.settings], ai: { ...ai, on: !!instantSave } };
        }
        if (!raw[KEYS.meta]?.aiDefaultClaudeAt) {
          // OpenAI used to be the default provider. A library that never set AI up (no key, model
          // or address) moves once to the new default, Claude Haiku 5.5 at Medium.
          write[KEYS.meta].aiDefaultClaudeAt = now;
          const settings = write[KEYS.settings] || raw[KEYS.settings];
          const ai = settings?.ai;
          if (ai && ai.provider === 'openai' && !ai.model && !ai.baseUrl && !raw[KEYS.secrets]?.aiApiKey) {
            write[KEYS.settings] = { ...settings, ai: { ...ai, provider: 'anthropic', effort: ai.effort || 'medium' } };
          }
        }
        await be.set(write);
        return { fresh: !hadMeta, migrated, caughtUp };
      });
    },

    async getAll() {
      const d = await readAll();
      delete d.secrets;
      return d;
    },

    // -- collections --
    async getCollections() {
      return sortCollections(await db.all('collections'));
    },

    async getCollection(id) {
      return (await db.get('collections', id)) || null;
    },

    // Creates a collection unless one with the same name exists (returns that one then).
    // "Same" allows case, plural and "&"/"and" differences, but not related names: a user
    // who types "Food" gets a Food collection even though Kitchen lists food as an alias.
    async createCollection(input, { allowSimilar = false } = {}) {
      return serial(async () => {
        const list = await db.all('collections');
        if (list.length >= LIMITS.maxCollections) throw new Error('Collection limit reached');
        if (!allowSimilar) {
          const target = normalizeName(input.name);
          const same = target && list.find((c) => normalizeName(c.name) === target);
          if (same) return { collection: same, existed: true };
        }
        const maxOrder = list.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
        const col = makeCollection({ ...input, color: input.color || nextColor(list), sortOrder: input.sortOrder ?? maxOrder + 1 });
        await db.put('collections', [col]);
        return { collection: col, existed: false };
      });
    },

    async ensureCollectionForTaxonomy(taxonomyKey) {
      const tax = DEFAULT_TAXONOMY.find((t) => t.key === taxonomyKey);
      if (!tax) return null;
      const cols = await api.getCollections();
      const exact = cols.find((c) => c.taxonomyKey === tax.key);
      if (exact) return exact;
      const similar = findSimilarCollection(tax.name, cols);
      if (similar) return similar;
      const { collection } = await api.createCollection({ name: tax.name, description: tax.description, color: tax.color, aliases: tax.aliases, taxonomyKey: tax.key }, { allowSimilar: true });
      return collection;
    },

    async updateCollection(id, patch) {
      const [merged] = await db.update('collections', [id], (existing) => (existing ? makeCollection({ ...existing, ...patch, id, createdAt: existing.createdAt }) : undefined));
      if (!merged) throw new Error('Collection not found');
      return merged;
    },

    async reorderCollections(orderedIds) {
      const all = await db.all('collections');
      const byId = mapOf(all);
      // Listed ids come first in the given order; anything not listed keeps
      // its current relative order behind them.
      const listed = orderedIds.filter((id) => byId[id]);
      const rest = sortCollections(all).filter((c) => !listed.includes(c.id)).map((c) => c.id);
      const order = new Map([...listed, ...rest].map((id, i) => [id, i + 1]));
      await db.update('collections', [...order.keys()], (c) => (c ? { ...c, sortOrder: order.get(c.id), updatedAt: nowIso() } : undefined));
    },

    // Deleting uncategorizes its items (or moves them to `moveTo`) unless deleteItems is true,
    // in which case they go to the Trash.
    async deleteCollection(id, { moveTo = null, deleteItems = false } = {}) {
      const col = await db.get('collections', id);
      if (!col) return;
      const target = moveTo && (await db.get('collections', moveTo)) ? moveTo : null;
      const ids = (await db.all('items')).filter((i) => i.collectionId === id).map((i) => i.id);
      const now = nowIso();
      await db.update('items', ids, (item) => {
        if (!item || item.collectionId !== id) return undefined;
        const next = { ...item, collectionId: target, previousCollections: [...(item.previousCollections || []), id].slice(-20), updatedAt: now };
        if (deleteItems) next.deletedAt = item.deletedAt || now;
        else next.needsReview = item.needsReview || !target;
        return next;
      });
      await db.remove('collections', [id]);
      await kvUpdate('prefs', emptyPrefs(), (prefs) => forgetCollection(prefs, id, target));
    },

    // Deletes several collections (deleteCollection's rules for each) and resolves what Undo needs to put
    // them back as they were: the collections, where each of their saves was filed, and what was learned.
    // Resolves null when none of them exist.
    async deleteCollections(ids, { deleteItems = false } = {}) {
      const cols = (await Promise.all([...new Set(ids)].map((id) => db.get('collections', id)))).filter(Boolean);
      if (!cols.length) return null;
      const gone = new Set(cols.map((c) => c.id));
      const items = (await db.all('items')).filter((i) => gone.has(i.collectionId))
        .map((i) => ({ id: i.id, collectionId: i.collectionId, needsReview: !!i.needsReview, deletedAt: i.deletedAt || null, previousCollections: i.previousCollections || [] }));
      const prefs = await kvGet('prefs', null);
      for (const c of cols) await api.deleteCollection(c.id, { deleteItems });
      return { collections: cols, items, prefs };
    },

    // Undo for deleteCollections: the collections come back and their saves are filed in them again.
    async restoreCollections(undo) {
      if (!undo?.collections?.length) return;
      await db.put('collections', undo.collections);
      const was = new Map((undo.items || []).map((i) => [i.id, i]));
      const now = nowIso();
      await db.update('items', [...was.keys()], (item) => {
        if (!item) return undefined;
        const w = was.get(item.id);
        const next = { ...item, collectionId: w.collectionId, needsReview: w.needsReview, previousCollections: w.previousCollections, updatedAt: now };
        if (w.deletedAt) next.deletedAt = w.deletedAt;
        else delete next.deletedAt;
        return next;
      });
      if (undo.prefs) await kvSet('prefs', undo.prefs);
    },

    async mergeCollections(sourceId, targetId) {
      const source = await db.get('collections', sourceId);
      const target = await db.get('collections', targetId);
      if (!source || !target || sourceId === targetId) throw new Error('Pick two different collections');
      const ids = (await db.all('items')).filter((i) => i.collectionId === sourceId).map((i) => i.id);
      const now = nowIso();
      await db.update('items', ids, (item) => (item && item.collectionId === sourceId
        ? { ...item, collectionId: targetId, previousCollections: [...(item.previousCollections || []), sourceId].slice(-20), updatedAt: now }
        : undefined));
      const [merged] = await db.update('collections', [targetId], (t) => (t ? {
        ...t,
        aliases: uniqStrings([...(t.aliases || []), source.name, ...(source.aliases || [])], 20),
        keywords: uniqStrings([...(t.keywords || []), ...(source.keywords || [])], 40),
        coverImage: t.coverImage || source.coverImage || '',
        taxonomyKey: t.taxonomyKey || source.taxonomyKey || null,
        updatedAt: now,
      } : undefined));
      await db.remove('collections', [sourceId]);
      await kvUpdate('prefs', emptyPrefs(), (prefs) => forgetCollection(prefs, sourceId, targetId));
      return merged;
    },

    // -- items --
    async getItems() {
      return (await db.all('items')).filter(live).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    // Includes items in the Trash, so links to them still resolve.
    async getItem(id) {
      return (await db.get('items', id)) || null;
    },

    async findByUrl(url) {
      const key = normalizeUrl(url);
      if (!key) return null;
      return (await db.byIndex('items', 'urlKey', key)).find(live) || null;
    },

    async addItem(input) {
      if ((await db.count('items')) >= LIMITS.maxItems) throw new Error('Item limit reached');
      const item = makeItem(input);
      await db.put('items', [item]);
      return item;
    },

    // by: 'user' records hand-edited fields in userFields, so AI and enrichment never overwrite them.
    async updateItem(id, patch, { by = 'user' } = {}) {
      const [next] = await db.update('items', [id], (existing) => {
        if (!existing) return undefined;
        // A patch may add to them (kindChangePatch for a kind you picked); it never takes any away.
        const userFields = new Set([...(existing.userFields || []), ...(Array.isArray(patch.userFields) ? patch.userFields : [])]);
        if (by === 'user') for (const f of USER_FIELDS) if (f in patch && patch[f] !== existing[f]) userFields.add(f);
        // A kind you picked is read again by your AI provider, for that kind's details.
        const rekinded = by === 'user' && 'kind' in patch && patch.kind !== existing.kind;
        return makeItem({ ...existing, ...patch, id, createdAt: existing.createdAt, userFields: [...userFields], ...(rekinded ? { understoodAt: null } : {}) });
      });
      if (!next) throw new Error('Item not found');
      return next;
    },

    // Moves items to the Trash. They stay restorable for TRASH_DAYS.
    async deleteItems(ids) {
      const now = nowIso();
      await db.update('items', ids, (item) => (item && !item.deletedAt ? { ...item, deletedAt: now, updatedAt: now } : undefined));
    },

    async restoreItems(ids) {
      const cols = mapOf(await db.all('collections'));
      const now = nowIso();
      await db.update('items', ids, (item) => {
        if (!item || !item.deletedAt) return undefined;
        const gone = item.collectionId && !cols[item.collectionId];
        return { ...item, deletedAt: null, updatedAt: now, ...(gone ? { collectionId: null, needsReview: true } : {}) };
      });
    },

    // Opening a save: remembered for "Come back to". Not an edit, so updatedAt stays as it was.
    async markOpened(id) {
      await db.update('items', [id], (i) => (i && !i.deletedAt ? { ...i, openedAt: nowIso() } : undefined));
    },

    async getTrash() {
      return (await db.all('items')).filter((i) => i.deletedAt).sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
    },

    // Permanently removes items (Trash → Delete forever, emptying the Trash, or undoing a save).
    async deleteForever(ids) {
      const set = new Set(ids);
      await db.remove('items', ids);
      // A workout's goals and their check-ins go with it.
      const goals = (await Promise.all(ids.map((id) => db.byIndex('goals', 'itemId', id)))).flat();
      if (goals.length) await removeGoals(goals.map((g) => g.id));
      await kvUpdate('importHistory', { instagram: {} }, (h) => {
        const ig = { ...(h.instagram || {}) };
        for (const [k, v] of Object.entries(ig)) if (set.has(v)) delete ig[k];
        return { ...h, instagram: ig };
      });
    },

    async purgeTrash({ olderThanDays = TRASH_DAYS, now = Date.now() } = {}) {
      const cutoff = new Date(now - olderThanDays * 864e5).toISOString();
      const old = (await db.all('items')).filter((i) => i.deletedAt && i.deletedAt < cutoff).map((i) => i.id);
      if (old.length) await api.deleteForever(old);
      const oldGoals = (await db.all('goals')).filter((g) => g.deletedAt && g.deletedAt < cutoff).map((g) => g.id);
      if (oldGoals.length) await removeGoals(oldGoals);
      return old.length;
    },

    async getPendingItems() {
      return (await db.all('items')).filter((i) => live(i) && i.captureState === 'pending');
    },

    // Saves a bulk import brought in that your AI provider hasn't read yet (needsAi), newest first.
    async getAiBacklog() {
      return (await db.all('items')).filter((i) => live(i) && i.needsAi).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    // Moves saves still waiting for the AI tidy into the imported-saves queue: they keep what Keepsake
    // worked out on the device and wait for Run AI. A thousand of them would otherwise go to your provider
    // all at once the next time the extension wakes.
    async parkPending(ids) {
      if (!ids.length) return 0;
      let moved = 0;
      await db.update('items', ids, (i) => {
        if (!i || i.captureState !== 'pending') return undefined;
        moved++;
        return { ...i, captureState: 'complete', needsAi: true, updatedAt: nowIso() };
      });
      return moved;
    },

    // Move items; optionally learn from the correction. `learn`: 'light' | 'strong' | false
    async moveItems(ids, collectionId, { learn = 'light' } = {}) {
      if (!(await db.get('collections', collectionId))) throw new Error('Collection not found');
      const learned = [];
      const now = nowIso();
      await db.update('items', ids, (item) => {
        if (!item || item.collectionId === collectionId) return undefined;
        learned.push({ item, from: item.collectionId });
        const userFields = new Set(item.userFields || []);
        userFields.add('collectionId');
        return {
          ...item,
          previousCollections: [...(item.previousCollections || []), item.collectionId].filter(Boolean).slice(-20),
          collectionId, needsReview: false, categorizationSource: 'manual', confidence: 1, userFields: [...userFields], updatedAt: now,
        };
      });
      if (learn && learned.length) {
        await kvUpdate('prefs', emptyPrefs(), (prefs) => learned.reduce((p, { item, from }) => learnFromCorrection(item, from, collectionId, p, { strong: learn === 'strong' }), { ...emptyPrefs(), ...prefs }));
      }
    },

    // -- prefs & settings --
    async getPrefs() {
      return { ...emptyPrefs(), ...((await kvGet('prefs', null)) || {}) };
    },
    async setPrefs(prefs) {
      return kvSet('prefs', { ...emptyPrefs(), ...prefs });
    },
    async updatePrefs(patch) {
      return kvUpdate('prefs', emptyPrefs(), (prefs) => ({ ...emptyPrefs(), ...prefs, ...patch }));
    },
    async getSettings() {
      return (await readSettings()).settings;
    },
    async updateSettings(patch) {
      return serial(async () => {
        const { settings } = await readSettings();
        const next = deepMerge(settings, patch);
        await be.set({ [KEYS.settings]: next });
        return next;
      });
    },
    async getSecret(name) {
      const { secrets } = await readSettings();
      return secrets[name] || '';
    },
    async setSecret(name, value) {
      return serial(async () => {
        const { secrets } = await readSettings();
        if (value) secrets[name] = String(value);
        else delete secrets[name];
        await be.set({ [KEYS.secrets]: secrets });
      });
    },

    // -- AI change log --
    // Entry: { id, runId, at, itemId, itemTitle, changes: [{ field, from, to }], before, after, reason, undone }
    async getAiLog() {
      const log = await kvGet('aiLog', []);
      return Array.isArray(log) ? log : [];
    },
    async appendAiLog(entries) {
      return kvUpdate('aiLog', [], (log) => [...(Array.isArray(log) ? log : []), ...entries].slice(-AI_LOG_MAX));
    },
    async markAiLogUndone(ids) {
      const set = new Set(ids);
      return kvUpdate('aiLog', [], (log) => (Array.isArray(log) ? log : []).map((e) => (set.has(e.id) ? { ...e, undone: true } : e)));
    },
    async clearAiLog() {
      return db.remove('kv', ['aiLog']);
    },

    // -- import history (Instagram) --
    async getImportHistory() {
      return kvGet('importHistory', { instagram: {} });
    },
    async clearImportHistory() {
      return kvSet('importHistory', { instagram: {} });
    },
    async markImported(entries) {
      return kvUpdate('importHistory', { instagram: {} }, (h) => {
        const ig = { ...(h.instagram || {}) };
        for (const [url, itemId] of entries) {
          const key = normalizeUrl(url);
          if (key) ig[key] = itemId;
        }
        return { ...h, instagram: ig };
      });
    },
    async importedItemIdFor(url) {
      const h = await kvGet('importHistory', { instagram: {} });
      const id = (h.instagram || {})[normalizeUrl(url)];
      return id && (await db.get('items', id)) ? id : null;
    },

    // -- workout goals (goals.js) --
    async getGoals({ itemId = null, includeDeleted = false } = {}) {
      const list = itemId ? await db.byIndex('goals', 'itemId', itemId) : await db.all('goals');
      return list.filter((g) => includeDeleted || !g.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },

    async getGoal(id) {
      return (await db.get('goals', id)) || null;
    },

    async createGoal(input) {
      const item = input && typeof input.itemId === 'string' ? await db.get('items', input.itemId) : null;
      if (!item || item.deletedAt) throw new Error('That workout no longer exists.');
      if ((await db.count('goals')) >= LIMITS.maxGoals) throw new Error('Goal limit reached. Delete an old goal first.');
      const goal = makeGoal({ ...input, id: undefined, createdAt: undefined, updatedAt: undefined, deletedAt: null });
      await db.put('goals', [goal]);
      return goal;
    },

    async updateGoal(id, patch = {}) {
      const [goal] = await db.update('goals', [id], (g) => (g ? makeGoal({ ...g, ...patch, id: g.id, itemId: g.itemId, createdAt: g.createdAt, updatedAt: nowIso() }) : undefined));
      return goal || null;
    },

    // Ending a goal keeps it and its check-ins for TRASH_DAYS, so it can be undone.
    async deleteGoal(id) {
      return api.updateGoal(id, { deletedAt: nowIso() });
    },

    async restoreGoal(id) {
      return api.updateGoal(id, { deletedAt: null });
    },

    async getCheckins(goalId) {
      return (await db.byIndex('checkins', 'goalId', goalId)).sort((a, b) => (a.at < b.at ? -1 : 1));
    },

    async addCheckin(goalId, result = {}, { at } = {}) {
      const goal = await db.get('goals', goalId);
      if (!goal || goal.deletedAt) throw new Error('That goal no longer exists.');
      if ((await db.byIndex('checkins', 'goalId', goalId)).length >= LIMITS.maxCheckinsPerGoal) throw new Error('This goal has as many check-ins as Keepsake keeps. Start a new goal.');
      const checkin = makeCheckin({ goalId, result, at });
      await db.put('checkins', [checkin]);
      return checkin;
    },

    // Only offered as Undo right after a check-in: check-ins are otherwise add-only.
    async removeCheckin(id) {
      await db.remove('checkins', [id]);
    },

    // -- export / import --
    // Every save is exported, including the Trash (with deletedAt), so a backup restores everything.
    async exportJSON() {
      const [items, collections, prefs, importHistory, { settings }, goals, checkins] = await Promise.all([
        db.all('items'), db.all('collections'), kvGet('prefs', emptyPrefs()), kvGet('importHistory', { instagram: {} }), readSettings(), db.all('goals'), db.all('checkins'),
      ]);
      return {
        format: 'keepsake-export',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: nowIso(),
        collections: mapOf(collections),
        items: mapOf(items.map(packImages)),
        goals,
        checkins,
        prefs,
        settings,
        importHistory,
      };
    },

    async importJSON(payload, { mode = 'merge' } = {}) {
      const validated = validateExport(payload);
      return serial(async () => {
        if (mode === 'replace') {
          await db.clear(['items', 'collections', 'goals', 'checkins']);
          await kvSet('prefs', emptyPrefs());
          await kvSet('importHistory', { instagram: {} });
        }
        const collections = mapOf(await db.all('collections'));
        const existingItems = await db.all('items');
        let prefs = await api.getPrefs();
        const importHistory = await api.getImportHistory();
        const idMap = new Map();
        let addedCollections = 0;
        let addedItems = 0;
        let skippedItems = 0;
        const newCols = [];
        for (const col of Object.values(validated.collections)) {
          const existing = Object.values(collections);
          // Same collection: same id, same name (give or take case and plurals), or the same
          // default category. Not just a related name, or a backup's Kitchen lands in Food.
          const similar = collections[col.id]
            || existing.find((c) => normalizeName(c.name) === normalizeName(col.name))
            || (col.taxonomyKey && existing.find((c) => c.taxonomyKey === col.taxonomyKey));
          if (similar) {
            idMap.set(col.id, similar.id);
            if (col.keywords.length) {
              collections[similar.id] = { ...similar, keywords: uniqStrings([...(similar.keywords || []), ...col.keywords], 40) };
              newCols.push(collections[similar.id]);
            }
            continue;
          }
          collections[col.id] = col;
          newCols.push(col);
          idMap.set(col.id, col.id);
          addedCollections++;
        }
        const ids = new Set(existingItems.map((i) => i.id));
        const keys = new Set(existingItems.filter(live).map((i) => i.urlKey).filter(Boolean));
        // Where each backup item ended up: itself, or the save already here with the same id or link.
        const itemIdMap = new Map();
        const byKey = new Map(existingItems.filter(live).filter((i) => i.urlKey).map((i) => [i.urlKey, i.id]));
        const newItems = [];
        for (const item of Object.values(validated.items)) {
          if (ids.has(item.id) || (item.urlKey && !item.deletedAt && keys.has(item.urlKey))) {
            itemIdMap.set(item.id, ids.has(item.id) ? item.id : byKey.get(item.urlKey));
            skippedItems++;
            continue;
          }
          itemIdMap.set(item.id, item.id);
          const resolvedId = idMap.get(item.collectionId) || (collections[item.collectionId] ? item.collectionId : null);
          item.collectionId = resolvedId;
          if (!resolvedId && needsCollection(item)) item.needsReview = true;
          // Not read by your AI provider yet: it waits for Run AI instead of going to your provider by itself.
          if (item.captureState === 'pending') item.captureState = 'complete';
          if (!item.understoodAt && !item.deletedAt) item.needsAi = true;
          newItems.push(item);
          ids.add(item.id);
          if (item.urlKey && !item.deletedAt) keys.add(item.urlKey);
          addedItems++;
        }
        if ((await db.count('items')) + newItems.length > LIMITS.maxItems) throw new Error('Item limit reached');
        if (newCols.length) await db.put('collections', newCols);
        for (let i = 0; i < newItems.length; i += 500) await db.put('items', newItems.slice(i, i + 500));
        // Goals follow their workout; check-ins follow their goal. Anything already here is kept as is.
        const haveGoals = new Set((await db.all('goals')).map((g) => g.id));
        const newGoals = validated.goals.filter((g) => !haveGoals.has(g.id) && itemIdMap.get(g.itemId)).map((g) => ({ ...g, itemId: itemIdMap.get(g.itemId) }));
        if (haveGoals.size + newGoals.length > LIMITS.maxGoals) throw new Error('Goal limit reached');
        if (newGoals.length) await db.put('goals', newGoals);
        newGoals.forEach((g) => haveGoals.add(g.id));
        const haveCheckins = new Set((await db.all('checkins')).map((c) => c.id));
        const newCheckins = validated.checkins.filter((c) => !haveCheckins.has(c.id) && haveGoals.has(c.goalId));
        for (let i = 0; i < newCheckins.length; i += 1000) await db.put('checkins', newCheckins.slice(i, i + 1000));
        if (validated.prefs) prefs = mergePrefs(prefs, validated.prefs, idMap);
        await kvSet('prefs', prefs);
        if (validated.importHistory?.instagram) {
          const ig = { ...(importHistory.instagram || {}) };
          for (const [k, v] of Object.entries(validated.importHistory.instagram)) if (ids.has(v)) ig[k] = v;
          await kvSet('importHistory', { ...importHistory, instagram: ig });
        }
        const write = { [KEYS.meta]: { ...((await readSettings()).meta || {}), schemaVersion: SCHEMA_VERSION, updatedAt: nowIso() } };
        if (mode === 'replace' && validated.settings) write[KEYS.settings] = deepMerge(DEFAULT_SETTINGS, validated.settings);
        await be.set(write);
        return { addedCollections, addedItems, skippedItems, addedGoals: newGoals.length, addedCheckins: newCheckins.length };
      });
    },

    async loadSampleData() {
      // Sample data spans more than the starter collections, so create the rest
      // of the default taxonomy entries it references on demand (this also
      // demonstrates auto-created collections). ensureCollectionForTaxonomy is
      // a no-op for ones that already exist.
      const neededKeys = ['home', 'camping', 'clothing', 'tech', 'kitchen', 'van', 'care', 'books', 'tools', 'travel'];
      for (const k of neededKeys) await api.ensureCollectionForTaxonomy(k);
      const cols = await api.getCollections();
      const byKey = (k) => cols.find((c) => c.taxonomyKey === k) || null;
      const samples = sampleItems(byKey);
      for (const s of samples) await api.addItem(s);
      return samples.length;
    },

    // Wipes everything Keepsake keeps: records, settings, the AI key and the v2 rollback copy.
    async clearAll() {
      await db.clear(STORES);
      await be.remove([...Object.values(KEYS), ...LEGACY_KEYS]);
    },

    // Bytes used: settings in chrome.storage.local plus the origin's IndexedDB estimate where available.
    async storageUsage() {
      let kvBytes = null;
      let dbBytes = null;
      try { kvBytes = be.getBytesInUse ? await be.getBytesInUse(null) : null; } catch { /* unknown */ }
      try { dbBytes = globalThis.navigator?.storage?.estimate ? (await navigator.storage.estimate()).usage : null; } catch { /* unknown */ }
      return { kvBytes, dbBytes };
    },

    onChanged(fn) {
      const offKv = be.onChanged ? be.onChanged(fn) : () => {};
      const offDb = db.onChanged ? db.onChanged(({ stores = [] } = {}) => {
        const changes = {};
        for (const s of stores) changes[s === 'kv' ? KEYS.prefs : `keepsake_${s}`] = {};
        fn(changes);
      }) : () => {};
      return () => { offKv(); offDb(); };
    },
  };
  return api;
}

function sortCollections(list) {
  return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
}

// Only a small starter set is pre-created on first install. The rest of
// DEFAULT_TAXONOMY still exists and is used for auto-categorization —
// ensureCollectionForTaxonomy() creates those collections on demand the
// first time an item actually matches one (see categorizer.js). Items
// Keepsake can't place confidently are simply left uncategorized
// (collectionId: null) and surface in the Review queue — there is no
// separate "Inbox" collection to keep in sync.
const STARTER_TAXONOMY_KEYS = ['home', 'clothing', 'tech'];

export function defaultCollections() {
  const out = {};
  DEFAULT_TAXONOMY.filter((t) => STARTER_TAXONOMY_KEYS.includes(t.key)).forEach((t, i) => {
    const c = makeCollection({ name: t.name, description: t.description, color: t.color, aliases: t.aliases, taxonomyKey: t.key, sortOrder: i + 1 });
    out[c.id] = c;
  });
  return out;
}

function mergePrefs(base, incoming, idMap) {
  const out = { ...emptyPrefs(), ...base };
  const map = (id) => idMap.get(id) || id;
  out.learnedKeywords = { ...(out.learnedKeywords || {}) };
  for (const [term, entry] of Object.entries(incoming.learnedKeywords || {})) {
    const e = { ...(out.learnedKeywords[term] || {}) };
    for (const [cid, w] of Object.entries(entry)) e[map(cid)] = Math.min(6, (e[map(cid)] || 0) + Number(w));
    out.learnedKeywords[term] = e;
  }
  out.retailerPrefs = { ...(out.retailerPrefs || {}) };
  for (const [host, entry] of Object.entries(incoming.retailerPrefs || {})) {
    const e = { ...(out.retailerPrefs[host] || {}) };
    for (const [cid, n] of Object.entries(entry)) e[map(cid)] = (e[map(cid)] || 0) + Number(n);
    out.retailerPrefs[host] = e;
  }
  out.corrections = [...(out.corrections || []), ...(incoming.corrections || [])].slice(-200);
  if (Number.isFinite(Number(incoming.confidenceThreshold))) out.confidenceThreshold = Number(incoming.confidenceThreshold);
  if (typeof incoming.autoCreateCollections === 'boolean') out.autoCreateCollections = incoming.autoCreateCollections;
  return out;
}

// The cover picture is usually also the first gallery picture, and pictures are inline data: URLs,
// so writing it twice doubled the size of an export. The gallery copy is left out and coverAt says
// where it goes back. Older versions ignore coverAt: their gallery just misses the cover.
export function packImages(item) {
  const at = item.image && Array.isArray(item.images) ? item.images.indexOf(item.image) : -1;
  if (at < 0) return item;
  return { ...item, images: item.images.filter((u) => u !== item.image), coverAt: at };
}

export function unpackImages(raw) {
  if (!Number.isInteger(raw.coverAt) || typeof raw.image !== 'string' || !raw.image) return raw;
  const images = Array.isArray(raw.images) ? [...raw.images] : [];
  images.splice(Math.max(0, Math.min(raw.coverAt, images.length)), 0, raw.image);
  const { coverAt, ...rest } = raw;
  return { ...rest, images };
}

// Validates and sanitizes an export payload. Throws with a readable message.
export function validateExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('This file is not a Keepsake export.');
  if (payload.format !== 'keepsake-export') throw new Error('This file is not a Keepsake export (missing format marker).');
  const version = Number(payload.schemaVersion);
  if (!Number.isFinite(version) || version < 1 || version > SCHEMA_VERSION) throw new Error(`Unsupported export version ${payload.schemaVersion}.`);
  const rawCollections = payload.collections && typeof payload.collections === 'object' ? payload.collections : {};
  const rawItems = payload.items && typeof payload.items === 'object' ? payload.items : {};
  const colEntries = Object.values(rawCollections);
  const itemEntries = Object.values(rawItems);
  if (colEntries.length > LIMITS.maxCollections) throw new Error(`Too many collections (${colEntries.length}).`);
  if (itemEntries.length > LIMITS.maxItems) throw new Error(`Too many items (${itemEntries.length}).`);
  const collections = {};
  for (const raw of colEntries) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') continue;
    const c = makeCollection({ ...raw, id: safeId(raw.id) });
    collections[c.id] = c;
  }
  const items = {};
  for (const entry of itemEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = unpackImages(entry);
    if (typeof raw.image === 'string' && raw.image.startsWith('data:') && raw.image.length > LIMITS.maxImageBytes * 1.4) raw.image = '';
    const it = makeItem({ ...raw, id: safeId(raw.id) });
    if (!it.url && !it.sourceUrl && !it.image && it.title === 'Untitled item') continue;
    items[it.id] = it;
  }
  // Workout goals and check-ins (exports from M2 on). A goal needs its workout in the file; a check-in its goal.
  const rawGoals = Array.isArray(payload.goals) ? payload.goals : [];
  const rawCheckins = Array.isArray(payload.checkins) ? payload.checkins : [];
  if (rawGoals.length > LIMITS.maxGoals) throw new Error(`Too many goals (${rawGoals.length}).`);
  if (rawCheckins.length > LIMITS.maxCheckins) throw new Error(`Too many check-ins (${rawCheckins.length}).`);
  const goals = [];
  for (const raw of rawGoals) {
    if (!raw || typeof raw !== 'object' || typeof raw.itemId !== 'string' || !items[raw.itemId]) continue;
    goals.push(makeGoal({ ...raw, id: safeId(raw.id) }));
  }
  const goalIds = new Set(goals.map((g) => g.id));
  const checkins = [];
  for (const raw of rawCheckins) {
    if (!raw || typeof raw !== 'object' || !goalIds.has(raw.goalId)) continue;
    checkins.push(makeCheckin({ ...raw, id: safeId(raw.id) }));
  }
  let prefs = null;
  if (payload.prefs && typeof payload.prefs === 'object') {
    const p = payload.prefs;
    // Older exports (schema 1) have rules; they become their collections' keywords.
    const rules = (Array.isArray(p.rules) ? p.rules : []).slice(0, 500).filter((r) => r && typeof r === 'object' && typeof r.collectionId === 'string').map((r) => ({
      collectionId: safeId(r.collectionId), keywords: uniqStrings(r.keywords, 20).map((k) => sanitizeText(k, 40).toLowerCase()).filter(Boolean),
    }));
    Object.assign(collections, foldRulesIntoKeywords(collections, rules));
    prefs = {
      learnedKeywords: {},
      retailerPrefs: {},
      corrections: (Array.isArray(p.corrections) ? p.corrections : []).slice(-200).filter((c) => c && typeof c === 'object'),
      confidenceThreshold: Number.isFinite(Number(p.confidenceThreshold)) ? Math.max(0.2, Math.min(0.95, Number(p.confidenceThreshold))) : 0.6,
      autoCreateCollections: p.autoCreateCollections !== false,
    };
    const lk = p.learnedKeywords && typeof p.learnedKeywords === 'object' ? p.learnedKeywords : {};
    let n = 0;
    for (const [term, entry] of Object.entries(lk)) {
      if (n++ > 5000 || typeof term !== 'string' || !entry || typeof entry !== 'object') continue;
      const e = {};
      for (const [cid, w] of Object.entries(entry)) if (typeof cid === 'string' && Number.isFinite(Number(w))) e[cid] = Math.max(0, Math.min(6, Number(w)));
      if (Object.keys(e).length) prefs.learnedKeywords[sanitizeText(term, 60).toLowerCase()] = e;
    }
    const rp = p.retailerPrefs && typeof p.retailerPrefs === 'object' ? p.retailerPrefs : {};
    for (const [host, entry] of Object.entries(rp).slice(0, 2000)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = {};
      for (const [cid, c] of Object.entries(entry)) if (Number.isFinite(Number(c))) e[cid] = Math.max(0, Number(c));
      prefs.retailerPrefs[sanitizeText(host, 120).toLowerCase()] = e;
    }
  }
  let settings = null;
  if (payload.settings && typeof payload.settings === 'object') {
    const s = deepMerge(DEFAULT_SETTINGS, payload.settings);
    delete s.apiKey;
    settings = s;
  }
  let importHistory = null;
  if (payload.importHistory && typeof payload.importHistory === 'object' && payload.importHistory.instagram && typeof payload.importHistory.instagram === 'object') {
    importHistory = { instagram: {} };
    for (const [k, v] of Object.entries(payload.importHistory.instagram).slice(0, 20000)) {
      if (typeof k === 'string' && typeof v === 'string') importHistory.instagram[k.slice(0, 200)] = v.slice(0, 64);
    }
  }
  return { collections, items, goals, checkins, prefs, settings, importHistory };
}

function safeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : uid();
}

function sampleItems(byKey) {
  const d = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  // A null key means "leave uncategorized" — the item shows up in Review.
  const S = (key, o, days) => ({ ...o, collectionId: key ? byKey(key)?.id || null : null, createdAt: d(days), confidence: o.confidence ?? 0.82, categorizationSource: 'sample' });
  return [
    S('home', { title: 'Hand-thrown ceramic bedside lamp with linen shade', price: 148, currency: 'USD', retailer: 'Studio Fenne', url: 'https://example.com/lamps/ceramic-bedside', image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800', imageAspect: 0.8, favorite: true, description: 'Matte glaze, dimmable warm bulb included.' }, 1),
    S('camping', { title: 'Two-person ultralight backpacking tent', price: 329, currency: 'USD', retailer: 'North Ridge Outfitters', url: 'https://example.com/tents/ultralight-2p', image: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800', imageAspect: 1.5, description: 'Trail weight 2 lb 3 oz. Two doors, two vestibules.' }, 2),
    S('clothing', { title: 'Waxed cotton field jacket, olive', price: 245, currency: 'USD', retailer: 'Harbor & Hale', url: 'https://example.com/jackets/waxed-field', image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800', imageAspect: 0.75 }, 3),
    S('tech', { title: 'Noise-cancelling over-ear headphones', price: 279, currency: 'USD', retailer: 'Soundfield', url: 'https://example.com/audio/over-ear-anc', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800', imageAspect: 1, purchased: true }, 5),
    S('kitchen', { title: 'Enameled cast iron Dutch oven, 5.5 qt', price: 199, currency: 'USD', retailer: 'Copper Lane Kitchen', url: 'https://example.com/cookware/dutch-oven', image: 'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800', imageAspect: 1.2, note: 'Wait for the autumn sale.' }, 6),
    S('van', { title: '12V roof fan with rain sensor, fits ProMaster', price: 289, currency: 'USD', retailer: 'Overland Supply Co.', url: 'https://example.com/van/roof-fan-12v', image: '', imageAspect: null }, 8),
    S('care', { title: 'Mineral SPF 40 daily moisturizer', price: 32, currency: 'USD', retailer: 'Clearwater Skin', url: 'https://example.com/skin/spf40', image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800', imageAspect: 1.25 }, 9),
    S(null, { title: 'Morning light, kitchen corner', type: 'instagram', retailer: 'Instagram', url: 'https://www.instagram.com/p/sample000001/', image: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800', imageAspect: 0.9, confidence: 0.2, needsReview: true, categorizationReason: 'No category signals found in the caption', instagram: { collectionName: 'Kitchen ideas', creator: 'slowmornings', caption: 'Morning light in the kitchen corner ✨', postType: 'post' } }, 10),
    S('books', { title: 'A Pattern Language — hardcover, 1977 edition', price: 68, currency: 'USD', retailer: 'Riverbend Books', url: 'https://example.com/books/a-pattern-language', image: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=800', imageAspect: 0.7 }, 12),
    S('tools', { title: 'Cordless brushless drill driver kit, 18V', price: 159, currency: 'USD', retailer: 'Workbench Depot', url: 'https://example.com/tools/drill-18v', image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800', imageAspect: 1.4 }, 14),
    S('travel', { title: 'Carry-on suitcase with front laptop pocket', price: 275, currency: 'USD', retailer: 'Northline Luggage', url: 'https://example.com/travel/carry-on-front-pocket', image: 'https://images.unsplash.com/photo-1553531384-cc64ac80f931?w=800', imageAspect: 0.8 }, 20),
    S('home', { title: 'This title is intentionally very long to test how the dashboard wraps and truncates titles that run on and on without a natural break point in sight', price: null, retailer: 'Example Store', url: 'https://example.com/long-title', image: 'https://example.invalid/broken.jpg', imageAspect: 1 }, 25),
    ...lifestyleSamples(S),
  ];
}

// One or more of every Lifestyle kind, so each view (and the Places map) has something in it. The
// places are made up: their names and pins are near real Seattle streets, not real businesses.
function lifestyleSamples(S) {
  const img = (id) => `https://images.unsplash.com/photo-${id}?w=800`;
  // A place saved from a maps search, as you would from Google Maps.
  const maps = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const place = (title, id, d, days, extra = {}) => S(null, { kind: 'place', title, url: maps(`${title}, Seattle, WA`), image: img(id), imageAspect: 1.33, retailer: 'Google Maps', details: { locality: 'Seattle', region: 'WA', country: 'United States', source: 'you', ...d }, ...extra }, days);
  return [
    place('Rye & Ember Bakery', '1509440159596-0249088772ff', { address: 'E Pike St & 11th Ave', lat: 47.6142, lng: -122.3178, category: 'bakery', hours: ['Tue–Sun 7am–3pm'] }, 1, { favorite: true, note: 'Get the seeded rye before 10.' }),
    place('Lantern Coffee', '1501339847302-ac426a4a7cbb', { address: 'Fremont Ave N & N 35th St', lat: 47.6505, lng: -122.3497, category: 'cafe', hours: ['Daily 6:30am–5pm'] }, 2),
    place('Shoyu House', '1569718212165-3a8278d5f624', { address: 'S Jackson St & 6th Ave S', lat: 47.5990, lng: -122.3266, category: 'restaurant', cuisine: 'Ramen', priceRange: '$$' }, 3),
    place('Basecamp Bouldering', '1522163182402-834f871fd851', { address: 'NW Leary Way & 15th Ave NW', lat: 47.6633, lng: -122.3760, category: 'climbing gym' }, 4),
    place('Sprinkle Donut Co.', '1551024601-bec78aea704b', { address: 'NW Market St & 22nd Ave NW', lat: 47.6687, lng: -122.3847, category: 'bakery', cuisine: 'Donuts', priceRange: '$' }, 6),
    place('Two Scoops Creamery', '1501443762994-82bd5dace89a', { address: 'Stone Way N & N 45th St', lat: 47.6614, lng: -122.3420, category: 'ice cream' }, 7),
    place('Slice of Belltown', '1513104890138-7c749659a591', { address: '2nd Ave & Bell St', lat: 47.6145, lng: -122.3460, category: 'restaurant', cuisine: 'Pizza', priceRange: '$$' }, 9),
    S(null, { kind: 'recipe', title: 'Fluffy buttermilk pancakes', url: 'https://example.com/recipes/buttermilk-pancakes', image: img('1528207776546-365bb710ee93'), imageAspect: 1.33, retailer: 'Weeknight Kitchen', favorite: true,
      details: { yield: '8 pancakes', prepMinutes: 10, cookMinutes: 15, totalMinutes: 25, category: 'Breakfast', source: 'page',
        ingredients: ['2 cups all-purpose flour', '2 tbsp sugar', '2 tsp baking powder', '1/2 tsp baking soda', '1/2 tsp salt', '2 cups buttermilk', '2 eggs', '3 tbsp melted butter', 'Blueberries and maple syrup, to serve'],
        steps: ['Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.', 'In another bowl, whisk the buttermilk, eggs and melted butter.', 'Pour the wet ingredients into the dry and stir until just combined; a few lumps are fine.', 'Heat a lightly buttered pan over medium heat. Pour 1/4 cup of batter per pancake.', 'Cook until bubbles form on top, about 2 minutes, then flip and cook 1 to 2 minutes more.', 'Serve warm with blueberries and maple syrup.'] } }, 2),
    S(null, { kind: 'recipe', title: 'Rainbow chickpea bowl', url: 'https://example.com/recipes/rainbow-chickpea-bowl', image: img('1512621776951-a57141f2eefd'), imageAspect: 1.33, retailer: 'Weeknight Kitchen',
      details: { yield: '2 bowls', totalMinutes: 20, category: 'Lunch', source: 'page',
        ingredients: ['1 can chickpeas, drained', '1 cup cherry tomatoes, halved', '1 avocado, sliced', '1 cup shredded red cabbage', '1 roasted sweet potato, cubed', '2 handfuls salad greens', '2 tbsp tahini', '1 lemon', 'Salt and pepper'],
        steps: ['Toss the chickpeas with a pinch of salt and pepper.', 'Whisk the tahini with the juice of the lemon and a splash of water.', 'Divide the greens between two bowls and arrange the vegetables and chickpeas on top.', 'Drizzle with the tahini dressing and serve.'] } }, 5),
    S(null, { kind: 'workout', title: 'Full-body strength in 30 minutes', url: 'https://example.com/workouts/full-body-30', image: img('1517836357463-d25dfeac3438'), imageAspect: 1.33, retailer: 'Strong at Home',
      details: { durationMinutes: 30, focus: 'Full body', source: 'page', exercises: [
        { name: 'Goblet squat', sets: 3, reps: 10, restSeconds: 60 }, { name: 'Push-ups', sets: 3, reps: 12, restSeconds: 60 }, { name: 'Bent-over row', sets: 3, reps: 10, restSeconds: 60 },
        { name: 'Romanian deadlift', sets: 3, reps: 8, restSeconds: 90 }, { name: 'Plank', sets: 3, durationSeconds: 45, restSeconds: 30 }] } }, 3),
    S(null, { kind: 'workout', title: '10-minute core', url: 'https://example.com/workouts/core-10', image: img('1571019613454-1cb2f99b2d8b'), imageAspect: 1.33, retailer: 'Strong at Home',
      details: { durationMinutes: 10, focus: 'Core', source: 'page', exercises: [{ name: 'Crunches', sets: 3, reps: 15, restSeconds: 30 }, { name: 'Dead bug', sets: 3, reps: 10, restSeconds: 30 }, { name: 'Side plank', sets: 2, durationSeconds: 30, restSeconds: 30 }] } }, 8),
    S(null, { kind: 'video', title: 'A weekend in the North Cascades', url: 'https://example.com/videos/north-cascades', image: img('1464822759023-fed622ff2c3b'), imageAspect: 16 / 9, retailer: 'Trail Notes',
      details: { durationSeconds: 754, channel: 'Trail Notes', source: 'page' }, topics: ['Travel', 'Outdoors'], topicsBy: 'guess' }, 4),
    S(null, { kind: 'article', title: 'How to brew better coffee at home', url: 'https://example.com/articles/better-coffee-at-home', image: img('1495474472287-4d71bcdd2085'), imageAspect: 1.33, retailer: 'The Daily Grind',
      details: { author: 'Sam Rivera', siteName: 'The Daily Grind', readingMinutes: 6, source: 'page' }, topics: ['Coffee'], topicsBy: 'guess' }, 5),
    S(null, { kind: 'media', title: 'Metropolis', url: 'https://letterboxd.com/search/metropolis/', image: img('1489599849927-2ee91cede3ba'), imageAspect: 0.67, retailer: 'Letterboxd',
      details: { format: 'film', year: 1927, director: 'Fritz Lang', genres: ['Science fiction', 'Drama'], source: 'you' } }, 6),
    S(null, { kind: 'book', title: 'Walden', url: 'https://openlibrary.org/search?q=walden+thoreau', image: '', imageAspect: 0.67, retailer: 'Open Library',
      details: { author: 'Henry David Thoreau', year: 1854, genres: ['Nonfiction', 'Nature'], source: 'you' } }, 11),
  ];
}
