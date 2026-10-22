// Patchwork background service worker (MV3, ES module).
// It only wakes up for: install/startup, context-menu clicks, messages from
// the popup/dashboard/content scripts, permission changes and settings changes.
// It has no timers and no alarms. Its only network access is the optional AI
// provider call after a save (never before it), when the user has turned Optional AI on.

import { createStore, chromeBackend, idbBackend } from './src/shared/storage.js';
import { classify, learnFromCorrection, AUTO_FILE_CONFIDENCE } from './src/shared/categorizer.js';
import { parsePrice, sanitizeText, uid, nowIso } from './src/shared/util.js';
import { isRestrictedUrl, openableUrl } from './src/shared/url.js';
import { MSG, SESSION_KEYS } from './src/shared/messages.js';
import { cleanupWithAI, identifyForKind, draftRecipe } from './src/ai/provider.js';
import { parsePostBundle } from './src/instagram/post.js';
import { putThumbs, savePosts, loadPosts, clearScanStore, thumbKey } from './src/instagram/scanStore.js';
import { LOOKUP_SOURCES, lookupPlace, lookupAddressAt, lookupFilm, lookupBook, fillMissing } from './src/shared/lookups.js';
import { isKind, kindOf, kindInfo, hasOwnView, kindChangePatch, shoppingKindFor, detailsForKind, placeFromText, genericTitle, LIFESTYLE, kindFromSchemaTypes, recipeFromSchema, recipeFromText, workoutFromText, looksLikeWorkout, placeFromSchema, placeFromMapsUrl, placeFromProfile, placeFromHome, videoPlatform, videoFromCapture, articleFromCapture, isYouTube, titleSite, mediaFromSchema, bookFromSchema } from './src/shared/kinds.js';
import { guessTopics } from './src/shared/topics.js';
import { normalizeProduct, captureFacts, classifyCapture, saveCapture, FILLED_KINDS } from './src/shared/capture.js';
import { fillSave, tidySave, readImported, pendingToTidy } from './src/shared/fill.js';
import { runAiQueue } from './src/shared/aiQueue.js';
import { understandItem } from './src/shared/understand.js';
import { fetchPage, loadImage } from './src/ai/pages.js';
import { placeNamed, placeReviewReasons, stateCode } from './src/shared/places.js';
import { restoreActionIcon } from './src/toolbar/icon.js';

const store = createStore(chromeBackend(), idbBackend());
const CONTENT_SCRIPT_ID = 'keepsake-floating';
const CONTEXT_MENU_ID = 'keepsake-save';

// --- lifecycle -----------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  const { fresh } = await store.init();
  await createContextMenu();
  await syncContentScripts();
  await restoreActionIcon();
  if (details.reason === 'install' && fresh) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html#welcome') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await store.init();
  await createContextMenu();
  await syncContentScripts();
  await restoreActionIcon();
  enrichPending();
});

async function createContextMenu() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: 'Save to Patchwork', contexts: ['page', 'image', 'link', 'selection'] }, () => void chrome.runtime.lastError);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab || !tab.id) return;
  const pageUrl = info.pageUrl || tab.url || '';
  if (isRestrictedUrl(pageUrl)) return;
  try {
    const hints = { imageUrl: info.srcUrl || '', linkUrl: info.linkUrl || '', selectionText: info.selectionText || '' };
    // Right-clicked an image or link inside a product card (listing pages):
    // read just that card, the same way the on-page buttons do.
    const card = (info.srcUrl || info.linkUrl) ? await extractCardFromTab(tab.id, info.srcUrl || '', info.linkUrl || '') : null;
    if (card && card.url && card.title) {
      if (info.srcUrl && !card.images.includes(info.srcUrl)) card.images.unshift(info.srcUrl);
      if (info.srcUrl) card.image = info.srcUrl;
      const res = await saveProduct(card, { source: 'context-menu', instant: true });
      await showPageToast(tab.id, res, card);
      return;
    }
    const product = await extractFromTab(tab.id, hints);
    if (!product) throw new Error('Patchwork could not read this page.');
    if (info.linkUrl && !info.srcUrl && info.linkText && info.linkUrl !== pageUrl) {
      // Right-clicked a product link: save the link target, titled by the link text.
      product.url = info.linkUrl;
      product.canonicalUrl = info.linkUrl;
      product.title = sanitizeText(info.linkText, 200) || product.title;
      product.image = '';
      product.images = [];
      product.price = null;
      product.priceText = '';
    }
    const res = await saveProduct(product, { source: 'context-menu', instant: true });
    await showPageToast(tab.id, res, product);
  } catch (e) {
    await showPageToast(tab.id, { ok: false, error: friendlyError(e) });
  }
});

// --- extraction ----------------------------------------------------------------------------

async function extractFromTab(tabId, hints = {}) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (h) => { globalThis.__keepsakeHints = h; }, args: [hints] });
  const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extract/extract.js'] });
  let product = results && results[0] ? results[0].result : null;
  if (!product || typeof product !== 'object') {
    const again = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis.__keepsakeExtract ? globalThis.__keepsakeExtract() : null) });
    product = again && again[0] ? again[0].result : null;
  }
  return product && typeof product === 'object' ? product : null;
}

// Find the card around a right-clicked image/link and extract only that card.
async function extractCardFromTab(tabId, srcUrl, linkUrl) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/detector.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [srcUrl, linkUrl],
      func: (src, link) => {
        const det = globalThis.__keepsakeDetector;
        if (!det) return null;
        let node = null;
        if (src) node = Array.from(document.images).find((i) => i.currentSrc === src || i.src === src) || null;
        if (!node && link) node = Array.from(document.querySelectorAll('a[href]')).find((a) => a.href === link) || null;
        if (!node) return null;
        det.resetCache();
        const card = det.resolveCard(node);
        if (!card || card.kind !== 'card') return null;
        return det.extractCard(card);
      },
    });
    const card = results && results[0] ? results[0].result : null;
    return card && typeof card === 'object' ? card : null;
  } catch {
    return null;
  }
}

function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/cannot access|cannot be scripted|extensions gallery|chrome:\/\/|Missing host permission|The extensions gallery/i.test(m)) {
    return 'Chrome does not let extensions read this page (browser pages, the Web Store and some protected sites). Try a regular website.';
  }
  if (/No tab with id|Receiving end does not exist|message port closed/i.test(m)) return 'The page changed before Patchwork could finish. Try again.';
  return m || 'Something went wrong.';
}

// --- saving --------------------------------------------------------------------------------------

// The capture rules live in src/shared/capture.js (shared with iOS). Saving here also queues the
// after-save work this worker owns: the AI tidy and the Lifestyle fill-in.
function saveProduct(rawProduct, options = {}) {
  return saveCapture(store, rawProduct, options, { enrich: queueEnrich, fill: queueFill });
}


// --- after the save: fill in a Lifestyle save ---------------------------------------------------------
// A save you put into a Lifestyle view (or that Patchwork recognised as one) gets what's missing filled in:
//   1. Optional AI, only if you turned it on: names the place, film or book the post is about, lists a
//      workout's exercises, or drafts a recipe. Logged in the AI change log with Undo.
//   2. Lookups you turned on (Settings → Lookups, each site granted): OpenStreetMap for a place's address
//      and pin, Wikidata for a film or show, Open Library for a book. Only missing fields are filled.
// One save at a time; OpenStreetMap gets at most one request a second.
let fillQueue = Promise.resolve();
let lastNominatim = 0;
function queueFill(id, opts = {}) {
  fillQueue = fillQueue.then(() => fillKind(id, opts)).catch(() => {});
  return fillQueue;
}

// A batch you started (Fix with AI in Places review, Check with AI in a Lifestyle view): one save at a time,
// its progress kept in session storage so every open dashboard shows it, and stoppable between saves.
let fillJob = null;
async function publishFillJob() {
  try {
    await chrome.storage.session.set({ [SESSION_KEYS.fillJob]: fillJob });
  } catch {
    /* no session storage: the batch still runs */
  }
}
const fillState = (i) => (i ? JSON.stringify([i.title, i.details]) : '');
async function startFillBatch(ids, { review = false, verify = false, understand = false, force = false, label = '', kind = '' } = {}) {
  if (fillJob?.running) return { ok: false, error: 'A check is already running.', job: fillJob };
  const job = { id: uid(), label: sanitizeText(label, 80), kind: sanitizeText(kind, 20), total: ids.length, done: 0, ready: 0, changed: 0, running: true, stopped: false, startedAt: nowIso(), finishedAt: '' };
  fillJob = job;
  await publishFillJob();
  (async () => {
    for (const id of ids) {
      if (job.stopped) break;
      const before = await store.getItem(id);
      await queueFill(id, { review, verify, understand, force });
      const after = await store.getItem(id);
      if (before && after && fillState(before) !== fillState(after)) job.changed++;
      // A place that was waiting in Places review and now has its name and state.
      if (before && after && kindOf(after) === 'place' && placeReviewReasons(before).length && !placeReviewReasons(after).length) job.ready++;
      job.done++;
      await publishFillJob();
    }
    job.running = false;
    job.finishedAt = nowIso();
    await publishFillJob();
  })();
  return { ok: true, job };
}

// --- Run AI on imported saves --------------------------------------------------------------------
// Bulk imports (open tabs, Instagram) save without AI and flag each save (needsAi). This sends them to your
// provider only when you ask: two at a time, waiting when it says to slow down, with Pause and Cancel.
// Progress goes in the same session slot as a fill-in batch, so the bar under the header shows it. Saves
// not read yet keep their flag, so Resume (or a later run) carries on, even after Chrome restarts.
async function startAiBacklog(ids, { label = '' } = {}) {
  if (fillJob?.running) return { ok: false, error: 'Something is already running. Let it finish or stop it first.', job: fillJob };
  const settings = await store.getSettings();
  if (!settings.ai?.on || !(await store.getSecret('aiApiKey'))) return { ok: false, error: 'Turn on Optional AI and add your API key in Settings first.' };
  const flagged = (await store.getAiBacklog()).map((i) => i.id);
  const want = ids ? new Set(ids) : null;
  const todo = want ? flagged.filter((id) => want.has(id)) : flagged;
  if (!todo.length) return { ok: false, error: 'Nothing here is waiting for AI.' };
  const job = { id: uid(), backlog: true, label: sanitizeText(label, 80) || 'Running AI on imported saves', kind: '', scope: want ? todo : null,
    total: todo.length, done: 0, ready: 0, changed: 0, failed: 0, running: true, paused: false, stopped: false, waitingUntil: '', error: '', startedAt: nowIso(), finishedAt: '' };
  fillJob = job;
  await publishFillJob();
  const runId = `import-ai-${job.id}`;
  (async () => {
    const res = await runAiQueue(todo, {
      work: (id) => readImported(store, id, { runId, fetchPage, loadImage, fetchFn: fetch, allowed: lookupAllowed, waitTurn: nominatimTurn }),
      stopped: () => job.stopped,
      // Saying where it's at every second of a wait also keeps Chrome from putting the worker to sleep.
      sleep: async (ms) => { await new Promise((r) => setTimeout(r, ms)); await publishFillJob(); },
      onProgress: (p) => {
        Object.assign(job, { done: p.done, changed: p.changed, failed: p.failed, waitingUntil: p.waitingUntil ? new Date(p.waitingUntil).toISOString() : '' });
        publishFillJob();
      },
    }).catch((e) => ({ reason: 'fatal', error: String((e && e.message) || e) }));
    Object.assign(job, { running: false, waitingUntil: '', finishedAt: nowIso() });
    // Your provider couldn't go on (a bad key, no credit) or kept saying it's busy: paused, to resume later.
    if (res.reason) Object.assign(job, { paused: true, stopped: true, error: res.reason === 'busy' ? `Your AI provider is busy right now. ${res.error}` : res.error });
    await publishFillJob();
  })();
  return { ok: true, job };
}

// A worker that starts with a run marked as going was stopped by Chrome mid-run: it shows as paused.
(async () => {
  try {
    const job = (await chrome.storage.session.get(SESSION_KEYS.fillJob))?.[SESSION_KEYS.fillJob];
    if (job?.running && !fillJob) {
      await chrome.storage.session.set({ [SESSION_KEYS.fillJob]: { ...job, running: false, stopped: true, paused: !!job.backlog, waitingUntil: '', finishedAt: nowIso() } });
    }
  } catch {
    /* no session storage */
  }
})();

async function lookupAllowed(settings, which) {
  if (!settings.lookups?.[which]) return false;
  try {
    return await chrome.permissions.contains({ origins: LOOKUP_SOURCES[which].origins });
  } catch {
    return false;
  }
}

// The fill-in itself is shared with iOS (src/shared/fill.js); this worker supplies the network, the
// Lookups Chrome has granted, and OpenStreetMap's pace. understand: an Instagram import or Fix with AI,
// where any save (not only a Lifestyle one) is read by your provider first; force reads it again.
async function nominatimTurn() {
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}
async function fillKind(id, opts = {}) {
  const waitTurn = nominatimTurn;
  if (opts.understand) {
    try {
      await understandItem(store, id, { force: !!opts.force }, { fetchPage, loadImage });
    } catch {
      /* the provider didn't answer: the save stays as it was */
    }
  }
  return fillSave(store, id, opts, { fetchFn: fetch, allowed: lookupAllowed, waitTurn, fetchPage, loadImage });
}

// --- after the save: optional AI tidy ---------------------------------------------------------------
// Runs once per pending item. Re-reads the item first, so anything the person did in the meantime
// wins: a hand-edited title is kept, and a save they filed or moved is never re-filed. Every change
// goes to the AI change log with Undo. If the provider fails, the save simply stays as it was.
let enrichQueue = Promise.resolve();
function queueEnrich(id) {
  const job = enrichQueue.then(() => enrichItem(id));
  enrichQueue = job.catch(() => {});
  return job;
}

async function enrichPending() {
  try {
    // A handful at most; a pile left over from an older import waits for Run AI instead.
    for (const it of await pendingToTidy(store)) queueEnrich(it.id);
  } catch {
    /* try again on the next wake */
  }
  return enrichQueue;
}

// Your provider works out what the save is first (src/shared/understand.js); a save that turns out to be
// a place, recipe, workout, film or book then gets its Lifestyle fill-in (Lookups for a place's pin).
async function enrichItem(id) {
  const res = await tidySave(store, id, { fetchPage, loadImage });
  if (res && FILLED_KINDS.includes(res.kind)) queueFill(id);
  return res;
}

// What the capture card on the page needs to look like the person's chosen style and theme.
async function pageLook() {
  const st = await store.getSettings().catch(() => ({}));
  return { style: st.style || 'pantry', theme: st.theme || 'system' };
}

// Up to three likely collections for a save that went to Review. A default collection that doesn't
// exist yet is offered as "new:<key>"; UPDATE_ITEM creates it when picked.
function suggestionsOf(classification) {
  const seen = new Set();
  return (classification?.alternatives || []).filter((a) => a.collectionName && !seen.has(a.collectionName) && seen.add(a.collectionName))
    .slice(0, 3).map((a) => ({ id: a.isNew && a.taxonomyKey ? `new:${a.taxonomyKey}` : a.collectionId, name: a.collectionName }));
}

async function showPageToast(tabId, res, product) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/tokens-content.js', 'src/content/toast.js'] });
    const collections = res.ok && !res.duplicate ? (await store.getCollections()).map((c) => ({ id: c.id, name: c.name })) : [];
    const look = await pageLook();
    const fmt = (n, c) => (Number.isFinite(n) ? new Intl.NumberFormat(undefined, { style: c ? 'currency' : 'decimal', currency: c || undefined }).format(n) : '');
    const payload = res.ok
      ? res.duplicate
        ? { kind: 'duplicate', existing: res.existing, title: (product && product.title) || '', look }
        : {
          kind: 'saved', itemId: res.item.id, title: res.item.title, collectionId: res.item.collectionId || '',
          // Where it went, changeable to any Lifestyle view (it becomes that kind) or collection (shopping).
          collectionName: res.collection ? res.collection.name : '', isInbox: !!res.classification?.isInbox, look,
          lifestyle: hasOwnView(res.item.kind) && !res.collection ? `kind:${res.item.kind}` : '',
          collections: [...LIFESTYLE().map((k) => ({ id: `kind:${k.value}`, name: k.plural, group: 'Lifestyle' })), ...collections.map((c) => ({ ...c, group: 'Collections' }))],
          thumb: /^https:\/\//.test(res.item.image || '') ? res.item.image : '',
          meta: [(() => { try { return fmt(res.item.price, res.item.currency); } catch { return ''; } })(), res.item.retailer || res.item.host].filter(Boolean).join(' · '),
          pending: res.item.captureState === 'pending',
          suggestions: res.classification?.isInbox ? suggestionsOf(res.classification) : [],
        }
      : { kind: 'error', error: res.error || 'Something went wrong.', look };
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [payload, MSG],
      func: (p, M) => {
        const t = globalThis.__keepsakeToast;
        if (!t) return;
        const send = (m) => chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError);
        const cut = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
        if (p.kind === 'error') t.show({ tone: 'error', look: p.look, title: 'Not saved', message: p.error });
        else if (p.kind === 'duplicate') {
          t.show({
            tone: 'info', look: p.look, title: 'Already in Patchwork',
            message: `“${cut(p.existing.title || p.title, 70)}” is ${p.existing.collectionName ? 'in ' + p.existing.collectionName : 'already saved'}.`,
            actions: [{ label: 'Open', primary: true, onClick: () => send({ type: M.OPEN_DASHBOARD, hash: `#item/${p.existing.id}` }) }],
          });
        } else {
          // Say where it went, with a one-step change in case that's the wrong collection.
          const nameOf = (id) => (p.collections.find((c) => c.id === id) || p.suggestions.find((c) => c.id === id) || {}).name || 'collection';
          const move = (id) => {
            if (!id || id === p.collectionId) return;
            chrome.runtime.sendMessage({ type: M.UPDATE_ITEM, itemId: p.itemId, patch: { collectionId: id }, learn: 'light' }, (up) => {
              void chrome.runtime.lastError;
              t.show(up && up.ok
                ? { tone: 'ok', look: p.look, title: `Moved to ${nameOf(id)}`, message: id.startsWith('kind:') ? 'Its details were worked out from the page.' : 'Patchwork will remember this for similar items.', duration: 4000 }
                : { tone: 'error', look: p.look, title: 'Couldn’t move', message: (up && up.error) || '' });
            });
          };
          const status = [p.pending ? 'Finishing details…' : '', 'Saved on this device'].filter(Boolean).join(' · ');
          t.show({
            tone: p.isInbox ? 'review' : 'ok', look: p.look,
            title: p.isInbox ? 'Saved. Pick a collection now or later' : 'Saved to',
            picker: !p.isInbox && p.collections.length ? { options: p.collections, selectedId: p.collectionId || p.lifestyle, label: 'Move to', onChange: (id) => move(id) } : null,
            thumb: p.thumb, message: cut(p.title, 90), meta: p.meta, status,
            suggestions: p.isInbox && p.suggestions.length ? { items: p.suggestions, onPick: (id) => move(id) } : null,
            duration: p.isInbox ? 14000 : 10000,
            actions: [
              { label: 'Undo', quiet: true, onClick: () => send({ type: M.UNDO_SAVE, itemId: p.itemId }) },
              { label: 'Edit', quiet: true, onClick: () => send({ type: M.OPEN_DASHBOARD, hash: `#item/${p.itemId}` }) },
            ],
          });
        }
      },
    });
  } catch {
    /* page may not be scriptable; the save still happened */
  }
}

// --- floating-button content scripts --------------------------------------------------------------

async function grantedOrigins() {
  const perms = await chrome.permissions.getAll();
  return perms.origins || [];
}

function patternGranted(pattern, granted) {
  return granted.includes('<all_urls>') || granted.includes('*://*/*') || granted.includes(pattern) || granted.includes(pattern.replace(/^\*:\/\//, 'https://')) || granted.includes(pattern.replace(/^\*:\/\//, 'http://'));
}

export async function syncContentScripts() {
  const settings = await store.getSettings();
  const mode = settings.floating.mode;
  const granted = await grantedOrigins();
  let matches = [];
  if (mode === 'all') matches = granted.includes('<all_urls>') || granted.includes('*://*/*') ? ['*://*/*'] : granted.filter((p) => p.startsWith('*://') || p.startsWith('http'));
  else if (mode === 'selected') matches = (settings.floating.sites || []).filter((p) => patternGranted(p, granted));
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => []);
  if (mode === 'off' || !matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    return { registered: false, matches: [] };
  }
  const script = { id: CONTENT_SCRIPT_ID, js: ['src/content/tokens-content.js', 'src/content/toast.js', 'src/content/detector.js', 'src/content/floating.js'], matches, runAt: 'document_idle', persistAcrossSessions: true, allFrames: false };
  try {
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (e) {
    // A stale registration can reference a revoked origin; start over.
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    await chrome.scripting.registerContentScripts([script]).catch(() => {});
  }
  return { registered: true, matches };
}

async function broadcastFloatingRefresh() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) {
    if (!t.id) continue;
    chrome.tabs.sendMessage(t.id, { type: MSG.FLOATING_REFRESH }, () => void chrome.runtime.lastError);
  }
}

chrome.permissions.onRemoved.addListener(async () => {
  await syncContentScripts();
  await broadcastFloatingRefresh();
});
chrome.permissions.onAdded.addListener(async () => {
  await syncContentScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.keepsake_settings) {
    syncContentScripts().then(broadcastFloatingRefresh);
  }
});

async function floatingConfig(host) {
  const settings = await store.getSettings();
  const f = settings.floating;
  const hidden = (f.hiddenSites || []).map((h) => h.toLowerCase());
  const hostLc = String(host || '').toLowerCase().replace(/^www\./, '');
  const enabled = f.mode !== 'off' && !hidden.includes(hostLc) && !hidden.includes('www.' + hostLc);
  const collections = (await store.getCollections()).map((c) => ({ id: c.id, name: c.name }));
  const prefs = await store.getPrefs();
  const instantSave = !!settings.ai?.on && !!(await store.getSecret('aiApiKey'));
  return { ok: true, enabled, settings: f, collections, threshold: prefs.confidenceThreshold, instantSave, look: { style: settings.style || 'pantry', theme: settings.theme || 'system' } };
}

// --- Instagram scan state ------------------------------------------------------------------------------

// The scan's post list and thumbnails live in IndexedDB (src/instagram/scanStore.js). The session area
// holds a small summary the popup and dashboard watch ({ tabId, status, count, collectionName… }),
// rewritten only when it changes: Safari's session area fills up when a big entry is rewritten every
// second, and stays full until Safari quits.
let lastSummary = '';

async function getScan() {
  const raw = await chrome.storage.session.get(SESSION_KEYS.igScan);
  const summary = raw[SESSION_KEYS.igScan] || null;
  return summary ? { ...summary, posts: await loadPosts().catch(() => []) } : null;
}

const summaryOf = ({ posts, updatedAt, ...rest }) => ({ ...rest, count: Array.isArray(posts) ? posts.length : 0 });

async function setScan(scan) {
  const thumbs = new Map();
  const posts = (scan.posts || []).map((p) => {
    if (!String(p.thumbnail || '').startsWith('data:')) return p;
    thumbs.set(thumbKey(p), p.thumbnail);
    return { ...p, thumbnail: p.originalThumbnail || '' };
  });
  await putThumbs(thumbs);
  await savePosts(posts);
  const summary = summaryOf({ ...scan, posts });
  const key = JSON.stringify(summary);
  if (key === lastSummary) return;
  await writeScan({ ...summary, updatedAt: Date.now() });
  lastSummary = key;
}

// Safari can refuse to replace a big entry with a small one when the old one already fills its
// quota (an earlier scan's thumbnails): drop the old entry and write again.
async function writeScan(value) {
  try {
    await chrome.storage.session.set({ [SESSION_KEYS.igScan]: value });
  } catch (e) {
    if (!/quota/i.test(String((e && e.message) || e))) throw e;
    await chrome.storage.session.remove(SESSION_KEYS.igScan);
    await chrome.storage.session.set({ [SESSION_KEYS.igScan]: value });
  }
}

async function clearScan() {
  lastSummary = '';
  await chrome.storage.session.remove(SESSION_KEYS.igScan);
  await clearScanStore().catch(() => {});
}

async function startInstagramScan(tabId) {
  if (bulk && !bulk.finished) throw new Error('“Import all collections” is still running. Stop it first.');
  const settings = await store.getSettings();
  const ig = settings.instagram;
  await clearScan();
  await setScan({ tabId, status: 'starting', posts: [], collectionName: '', startedAt: Date.now() });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (o) => { globalThis.__keepsakeIgScanOptions = o; if (globalThis.__keepsakeIgScan) { globalThis.__keepsakeIgScan.running = false; } },
    args: [{ safetyLimit: ig.safetyLimit, idleTimeoutMs: ig.idleTimeoutMs, storeThumbnails: ig.storeThumbnails, autoScroll: true }],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/adapter.js', 'src/instagram/scan.js'] });
  return { ok: true };
}

// --- every Saved collection in turn ("Import all collections" on the Saved overview) ---------------------
// The overview's collection tiles are read, then the same tab opens each collection and the usual scan
// runs there, then "All posts" last for posts in no collection. Posts are merged into one scan, each
// remembering the collections it was in. Needs instagram.com access (the tab moves between pages).
// A pause between collections keeps the pace close to someone browsing.
export const BULK = { perCollection: 2000, maxPosts: 5000, pauseMs: 2500, loadTimeoutMs: 30000, scanTimeoutMs: 20 * 60 * 1000 };
let bulk = null; // { tabId, collections: [{ name, url, kind, count, status }], index, posts: Map, stopped, waiter }

const bulkSummary = (b) => ({
  index: b.index, total: b.collections.length, current: b.collections[b.index]?.name || '',
  collections: b.collections.map(({ name, kind, count, status }) => ({ name, kind, count, status })),
});

async function startInstagramBulk(tabId) {
  if (bulk && !bulk.finished) throw new Error('An import is already running. Stop it first.');
  const tab = await chrome.tabs.get(tabId);
  const overview = String(tab?.url || '').match(/^https:\/\/www\.instagram\.com\/([^/?#]+)\/saved\/?(?:[?#].*)?$/);
  if (!overview) throw new Error('Open your Saved page on Instagram (instagram.com/<you>/saved/) first.');
  await clearScan();
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/adapter.js'] });
  // The overview lists collections lazily: scroll until no new tiles appear.
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const ig = globalThis.KeepsakeInstagram;
      let list = [];
      for (let round = 0, stable = 0; round < 30 && stable < 3; round++) {
        const next = ig.collectCollections(document, location.href);
        stable = next.length === list.length ? stable + 1 : 0;
        list = next;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
        await new Promise((r) => setTimeout(r, 700));
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
      return list;
    },
  });
  const found = (results && Array.isArray(results[0]?.result) ? results[0].result : [])
    .filter((c) => c && /^https:\/\/www\.instagram\.com\/[^/]+\/saved\//.test(String(c.url)))
    .slice(0, 200)
    .map((c) => ({ name: sanitizeText(c.name, 80) || 'Collection', url: sanitizeText(c.url, 300), kind: c.kind === 'all' ? 'all' : 'collection', count: 0, status: 'waiting' }));
  // Named collections first; "All posts" last, for the posts in none of them.
  const collections = [...found.filter((c) => c.kind !== 'all'), ...found.filter((c) => c.kind === 'all').slice(0, 1)];
  if (!collections.length) throw new Error('No collections were found on this page. Wait for your Saved page to load, then try again.');
  bulk = { tabId, username: decodeURIComponent(overview[1]), collections, index: 0, posts: new Map(), stopped: false, finished: false, waiter: null };
  await setScan({ tabId, status: 'scanning', bulk: bulkSummary(bulk), posts: [], collectionName: 'All collections', username: bulk.username, startedAt: Date.now() });
  const job = bulk;
  runBulk(job).catch(async (e) => {
    job.finished = true;
    if (job.cleared) return;
    // Whatever was found is kept for review; the error says where it stopped.
    await saveBulk(job, 'done', 'error').catch(() => {});
    lastSummary = '';
    await writeScan({ ...summaryOf({ posts: [...job.posts.values()] }), tabId, status: 'done', reason: 'error', error: friendlyError(e), bulk: bulkSummary(job), collectionName: 'All collections', username: job.username, updatedAt: Date.now() }).catch(() => {});
  });
  return { ok: true, collections: collections.map((c) => c.name) };
}

// Closing the Instagram tab ends the run; what was found so far is kept.
chrome.tabs.onRemoved?.addListener((tabId) => {
  if (!bulk || bulk.finished || bulk.tabId !== tabId) return;
  bulk.stopped = true;
  if (bulk.waiter) bulk.waiter('error');
});

async function runBulk(job) {
  const settings = await store.getSettings();
  const ig = settings.instagram;
  for (job.index = 0; job.index < job.collections.length && !job.stopped; job.index++) {
    const col = job.collections[job.index];
    col.status = 'scanning';
    await saveBulk(job, 'scanning');
    await navigateTab(job.tabId, col.url);
    await new Promise((r) => setTimeout(r, BULK.pauseMs));
    if (job.stopped) {
      col.status = 'skipped';
      break;
    }
    let guard;
    const done = new Promise((resolve) => {
      job.waiter = resolve;
      guard = setTimeout(() => resolve('timeout'), BULK.scanTimeoutMs);
    });
    const room = Math.max(0, BULK.maxPosts - job.posts.size);
    await chrome.scripting.executeScript({
      target: { tabId: job.tabId },
      func: (o) => { globalThis.__keepsakeIgScanOptions = o; if (globalThis.__keepsakeIgScan) { globalThis.__keepsakeIgScan.running = false; } },
      args: [{ safetyLimit: Math.min(BULK.perCollection, room || 1), idleTimeoutMs: ig.idleTimeoutMs, storeThumbnails: ig.storeThumbnails, autoScroll: true }],
    });
    await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: ['src/instagram/adapter.js', 'src/instagram/scan.js'] });
    const how = await done;
    clearTimeout(guard);
    job.waiter = null;
    if (how === 'timeout') chrome.tabs.sendMessage(job.tabId, { type: MSG.IG_STOP_SCAN }, () => void chrome.runtime.lastError);
    col.status = how === 'error' ? 'error' : 'done';
    if (job.posts.size >= BULK.maxPosts) {
      job.limited = true;
      break;
    }
  }
  for (const c of job.collections) if (c.status === 'waiting') c.status = 'skipped';
  job.finished = true;
  await saveBulk(job, 'done', job.stopped ? 'stopped' : job.limited ? 'limit' : 'end');
}

async function saveBulk(job, status, reason = '') {
  if (job.cleared) return;
  await setScan({
    tabId: job.tabId, status, reason, bulk: bulkSummary(job), collectionName: 'All collections', username: job.username,
    collectionUrl: `https://www.instagram.com/${job.username}/saved/`, posts: [...job.posts.values()], error: '',
  });
}

// One collection's report: its posts join the merged list, each noting the collection it was in.
function mergeBulkPosts(job, posts) {
  const col = job.collections[job.index];
  if (!col) return;
  const named = col.kind !== 'all';
  for (const p of posts) {
    const had = job.posts.get(p.shortcode);
    if (had) {
      if (named && !had.collections.includes(col.name)) had.collections.push(col.name);
      for (const k of ['caption', 'creator', 'alt', 'originalThumbnail']) if (!had[k] && p[k]) had[k] = p[k];
      had.captured = had.captured || p.captured;
    } else if (job.posts.size < BULK.maxPosts) job.posts.set(p.shortcode, { ...p, collections: named ? [col.name] : [] });
  }
  col.count = posts.length;
}

// Opens a page in the tab and waits for it to finish loading (or for the timeout: the scan copes with a
// page still settling).
function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    let started = false;
    const finish = (fn, v) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      fn(v);
    };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') started = true;
      else if (info.status === 'complete' && started) finish(resolve);
    };
    const timer = setTimeout(() => finish(resolve), BULK.loadTimeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch((e) => finish(reject, new Error(`The Instagram tab was closed (${friendlyError(e)}).`)));
  });
}

function sanitizePost(p) {
  const str = (v, n) => (typeof v === 'string' ? sanitizeText(v, n) : '');
  const list = (v, n, f) => (Array.isArray(v) ? v.slice(0, n).map(f).filter(Boolean) : []);
  return {
    url: str(p.url, 300), shortcode: str(p.shortcode, 40), type: p.type === 'reel' ? 'reel' : 'post',
    thumbnail: typeof p.thumbnail === 'string' && (p.thumbnail.startsWith('data:image/') || /^https:\/\//.test(p.thumbnail)) ? p.thumbnail.slice(0, 600000) : '',
    originalThumbnail: str(p.originalThumbnail, 2000), originalImage: str(p.originalImage, 2000),
    caption: str(p.caption, 2200), creator: str(p.creator, 80), alt: str(p.alt, 300), captured: !!p.captured,
    title: str(p.title, 200), postedAt: str(p.postedAt, 40), location: str(p.location, 120), likes: Number.isFinite(p.likes) ? p.likes : null,
    hashtags: list(p.hashtags, 30, (h) => str(h, 60)), mentions: list(p.mentions, 20, (h) => str(h, 40)),
    links: list(p.links, 10, (l) => (l && typeof l === 'object' && l.url ? { url: str(l.url, 2000), label: str(l.label, 80) } : null)),
    products: list(p.products, 10, (x) => (x && typeof x === 'object' && x.name ? { name: str(x.name, 160), price: Number.isFinite(x.price) ? x.price : null, currency: str(x.currency, 8), url: str(x.url, 2000), retailer: str(x.retailer, 80) } : null)),
    linkInBio: !!p.linkInBio, details: !!p.details, detailsVia: str(p.detailsVia, 10), detailsError: str(p.detailsError, 200),
    ...(Array.isArray(p.collections) ? { collections: list(p.collections, 20, (c) => str(c, 80)) } : {}),
  };
}

// A scan's reports come only from an Instagram tab. Safari leaves the tab's address out of the
// sender when Patchwork has no instagram.com access (the scan then runs on activeTab alone), so a
// report from the very tab the scan was started in counts too.
async function fromScanTab(sender) {
  if (!sender.tab) return false;
  const url = sender.tab.url || sender.url || '';
  if (url) {
    try {
      return /(^|\.)instagram\.com$/.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }
  if (bulk && !bulk.finished && bulk.tabId === sender.tab.id) return true;
  const raw = await chrome.storage.session.get(SESSION_KEYS.igScan);
  return raw[SESSION_KEYS.igScan]?.tabId === sender.tab.id;
}

// --- reading one post in a background tab (fallback when a fetch hits a login wall) ---------------------
let readQueue = Promise.resolve();
function readPostInTab(url) {
  const u = sanitizeText(url, 300);
  if (!/^https:\/\/www\.instagram\.com\/(p|reel|reels)\/[A-Za-z0-9_-]+\/?/.test(u)) throw new Error('Not an Instagram post URL.');
  const job = readQueue.then(() => readPostInTabNow(u));
  readQueue = job.catch(() => {});
  return job;
}

async function readPostInTabNow(url) {
  // /p/ form: a logged-in /reel/ tab gets rerouted into the reels feed and would read the wrong post.
  const tab = await chrome.tabs.create({ url: openableUrl(url), active: false });
  const tabId = tab.id;
  try {
    await waitForTabLoad(tabId, 20000);
    await new Promise((r) => setTimeout(r, 1500));
    const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/post-page.js'] });
    const bundle = results && results[0] ? results[0].result : null;
    if (!bundle || typeof bundle !== 'object') throw new Error('The post page could not be read.');
    return { ok: true, bundle };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      fn(v);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(resolve);
    };
    const timer = setTimeout(() => finish(reject, new Error('The post page took too long to load.')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finish(resolve); }).catch(() => {});
  });
}

// --- message hub -----------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  handleMessage(msg, sender)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
  return true; // async
});

async function handleMessage(msg, sender) {
  const fromExtensionPage = !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
  switch (msg.type) {
    case MSG.EXTRACT_TAB: {
      const tabId = msg.tabId || (sender.tab && sender.tab.id);
      if (!tabId) throw new Error('No tab to read.');
      const product = await extractFromTab(tabId, msg.hints || {});
      if (!product) throw new Error('Patchwork could not read this page.');
      return { ok: true, product };
    }
    case MSG.CLASSIFY: {
      const [collections, prefs, settings] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings()]);
      const product = normalizeProduct(msg.product);
      const { kind, details } = captureFacts(product);
      return { ok: true, classification: classifyCapture(product, kind, details, { collections, prefs, settings }) };
    }
    case MSG.SAVE_ITEM: {
      if (!msg.product || typeof msg.product !== 'object') throw new Error('Nothing to save.');
      return saveProduct(msg.product, { collectionId: msg.collectionId || null, force: !!msg.force, source: msg.source || (sender.tab ? 'floating' : 'toolbar'), classification: msg.classification || null, note: msg.note || '', learn: msg.learn === 'strong' ? 'strong' : 'light', instant: !!msg.instant, deferAi: !!msg.deferAi });
    }
    case MSG.UPDATE_ITEM: {
      const item = await store.getItem(msg.itemId);
      if (!item) throw new Error('That item no longer exists.');
      const patch = { ...(msg.patch || {}) };
      // Into a Lifestyle view ("kind:place" from a picker, or { kind }): becomes that kind, details worked out.
      if (typeof patch.collectionId === 'string' && patch.collectionId.startsWith('kind:')) patch.kind = patch.collectionId.slice(5);
      if (typeof patch.kind === 'string' && isKind(patch.kind) && hasOwnView(patch.kind)) {
        delete patch.collectionId;
        await store.updateItem(item.id, kindChangePatch(item, patch.kind, { yours: true }), { by: 'kind' });
        queueFill(item.id);
        delete patch.kind;
      }
      // A Lifestyle save going into a collection becomes something to buy.
      if (typeof patch.collectionId === 'string' && patch.collectionId && hasOwnView(kindOf(item))) {
        await store.updateItem(item.id, { kind: shoppingKindFor(item), details: {} }, { by: 'kind' });
      }
      delete patch.kind;
      if (typeof patch.collectionId === 'string' && patch.collectionId.startsWith('new:')) {
        const col = await store.ensureCollectionForTaxonomy(patch.collectionId.slice(4));
        if (!col) throw new Error('That collection no longer exists.');
        patch.collectionId = col.id;
      }
      if (patch.collectionId && patch.collectionId !== item.collectionId) {
        await store.moveItems([item.id], patch.collectionId, { learn: msg.learn === false ? false : msg.learn === 'strong' ? 'strong' : 'light' });
        delete patch.collectionId;
      }
      if (Object.keys(patch).length) {
        const normalized = normalizeProduct({ ...item, ...patch, priceText: patch.priceText || '' });
        // Only carry over fields we allow the page to update.
        const allowed = ['title', 'price', 'currency', 'image', 'images', 'description', 'note', 'favorite', 'purchased', 'imageAspect'];
        const safePatch = {};
        for (const k of allowed) if (k in patch || (k === 'price' && 'priceText' in patch)) safePatch[k] = normalized[k];
        if (safePatch.price === undefined || safePatch.price === null) delete safePatch.price;
        if (!safePatch.image) delete safePatch.image;
        await store.updateItem(item.id, safePatch);
      }
      return { ok: true, item: await store.getItem(item.id) };
    }
    case MSG.FILL_ITEM: {
      queueFill(msg.itemId, { review: !!msg.review, understand: !!msg.understand });
      return { ok: true };
    }
    case MSG.FILL_BATCH: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      const ids = (Array.isArray(msg.itemIds) ? msg.itemIds : []).filter((x) => typeof x === 'string').slice(0, 5000);
      return startFillBatch([...new Set(ids)], { review: !!msg.review, verify: !!msg.verify, understand: !!msg.understand, force: !!msg.force, label: msg.label, kind: msg.kind });
    }
    case MSG.FILL_STOP: {
      if (fillJob?.running) fillJob.stopped = true;
      return { ok: true };
    }
    case MSG.AI_BACKLOG_RUN: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      const ids = Array.isArray(msg.itemIds) ? [...new Set(msg.itemIds.filter((x) => typeof x === 'string'))].slice(0, 20000) : null;
      return startAiBacklog(ids, { label: msg.label });
    }
    case MSG.AI_BACKLOG_PAUSE: {
      // Pause and Cancel both stop after the saves in flight; a paused run offers Resume.
      if (fillJob?.running && fillJob.backlog) Object.assign(fillJob, { stopped: true, paused: !msg.cancel });
      else if (msg.cancel) {
        try {
          await chrome.storage.session.remove(SESSION_KEYS.fillJob);
        } catch {
          /* nothing to clear */
        }
      }
      return { ok: true };
    }
    case MSG.FILL_KIND: {
      const ids = (await store.getItems()).filter((i) => kindOf(i) === msg.kind && !i.deletedAt).map((i) => i.id);
      for (const id of ids) queueFill(id);
      return { ok: true, count: ids.length };
    }
    case MSG.UNDO_SAVE: {
      // Undoing a save that just happened removes it outright (it never reaches the Trash).
      await store.deleteForever([msg.itemId]);
      return { ok: true };
    }
    case MSG.OPEN_DASHBOARD: {
      const hash = typeof msg.hash === 'string' && /^#[\w/.-]*$/.test(msg.hash) ? msg.hash : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + hash });
      return { ok: true };
    }
    case MSG.FLOATING_CONFIG:
      return floatingConfig(msg.host || (sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : ''));
    case MSG.FLOATING_REFRESH: {
      await syncContentScripts();
      await broadcastFloatingRefresh();
      return { ok: true };
    }
    case MSG.IG_START_SCAN: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return startInstagramScan(msg.tabId);
    }
    case MSG.IG_START_ALL: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return startInstagramBulk(msg.tabId);
    }
    case MSG.IG_STOP_SCAN: {
      if (bulk && !bulk.finished) bulk.stopped = true;
      const scan = await getScan();
      const tabId = msg.tabId || (scan && scan.tabId);
      if (tabId) chrome.tabs.sendMessage(tabId, { type: MSG.IG_STOP_SCAN }, () => void chrome.runtime.lastError);
      return { ok: true };
    }
    case MSG.IG_SCAN_UPDATE: {
      if (!(await fromScanTab(sender))) return { ok: false };
      const posts = (Array.isArray(msg.posts) ? msg.posts : []).slice(0, 2000).map(sanitizePost);
      const scan = {
        tabId: sender.tab.id, status: msg.status === 'done' ? 'done' : msg.status === 'error' ? 'error' : 'scanning',
        error: msg.error ? sanitizeText(msg.error, 300) : '', reason: sanitizeText(msg.reason, 40), collectionName: sanitizeText(msg.collectionName, 80),
        collectionUrl: sanitizeText(msg.collectionUrl, 300), username: sanitizeText(msg.username, 80), posts, updatedAt: Date.now(),
      };
      try {
        if (bulk && !bulk.finished && bulk.tabId === sender.tab.id) {
          // One collection of "Import all collections": merged into the whole, then on to the next.
          mergeBulkPosts(bulk, posts);
          await saveBulk(bulk, 'scanning');
          if (scan.status !== 'scanning' && bulk.waiter) bulk.waiter(scan.status);
          return { ok: true };
        }
        await setScan(scan);
      } catch (e) {
        // Say so instead of leaving the last good update ("Scanning…") showing for ever.
        lastSummary = '';
        await writeScan({ ...summaryOf(scan), status: 'error', error: `Patchwork couldn’t keep this scan (${friendlyError(e)}). Stop the scan, then try a smaller collection.`, updatedAt: Date.now() }).catch(() => {});
        return { ok: false, error: friendlyError(e) };
      }
      return { ok: true };
    }
    case MSG.ENRICH_PENDING: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      await enrichPending();
      return { ok: true };
    }
    case MSG.IG_SCAN_THUMB: {
      if (!(await fromScanTab(sender))) return { ok: false };
      const key = typeof msg.shortcode === 'string' && /^[\w-]{5,40}$/.test(msg.shortcode) ? msg.shortcode : '';
      const data = typeof msg.data === 'string' && msg.data.startsWith('data:image/') && msg.data.length <= 600000 ? msg.data : '';
      if (!key || !data) return { ok: false };
      await putThumbs(new Map([[key, data]]));
      return { ok: true };
    }
    case MSG.IG_SCAN_STATE: {
      const scan = await getScan();
      // The worker was restarted mid-way through "Import all collections": what it found is kept.
      if (scan && scan.bulk && scan.status === 'scanning' && !(bulk && !bulk.finished)) {
        const done = { ...scan, status: 'done', reason: 'interrupted' };
        await setScan(done);
        return { ok: true, scan: done };
      }
      return { ok: true, scan };
    }
    case MSG.IG_SCAN_SET_POSTS: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      const scan = await getScan();
      if (!scan) throw new Error('There is no scan to update.');
      const posts = (Array.isArray(msg.posts) ? msg.posts : []).slice(0, BULK.maxPosts).map(sanitizePost);
      await setScan({ ...scan, posts, updatedAt: Date.now() });
      return { ok: true };
    }
    case MSG.IG_READ_POST: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return readPostInTab(msg.url);
    }
    case MSG.IG_SCAN_CLEAR:
      if (bulk && !bulk.finished) {
        Object.assign(bulk, { stopped: true, finished: true, cleared: true });
        if (bulk.waiter) bulk.waiter('stopped');
        chrome.tabs.sendMessage(bulk.tabId, { type: MSG.IG_STOP_SCAN }, () => void chrome.runtime.lastError);
      }
      await clearScan();
      return { ok: true };
    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}
