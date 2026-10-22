// Internet Binder's after-save work, shared by the Chrome extension's background worker and the iOS app
// (through JavaScriptCore): filling in a Lifestyle save (Optional AI, then the Lookups you turned on)
// and the optional AI tidy of a new save. The caller supplies the network (`fetchFn`), which Lookups are
// allowed (`allowed`), and the pace for OpenStreetMap (`waitTurn`, at most one request a second).
// AI calls go through src/ai/provider.js with the person's own key; nothing runs unless it is on.

import { uid, nowIso, sanitizeText } from './util.js';
import { kindOf, kindInfo, detailsForKind, genericTitle, hasOwnView } from './kinds.js';
import { placeNamed, placeReviewReasons, stateCode } from './places.js';
import { lookupPlace, lookupAddressAt, lookupFilm, lookupBook, fillMissing } from './lookups.js';
import { FILLED_KINDS } from './capture.js';
import { cleanupWithAI, identifyForKind } from '../ai/provider.js';
import { understandItem } from './understand.js';

// What a Lifestyle save is still missing, for Check with AI to read it again.
function incompleteDetails(kind, d = {}) {
  if (kind === 'recipe') return !d.ingredients?.length || !d.steps?.length;
  if (kind === 'workout') return !d.exercises?.length;
  if (kind === 'place') return !d.address || !d.locality || !d.region;
  if (kind === 'media') return !d.year || !d.summary || !d.watchCheckedOn;
  if (kind === 'book') return !d.author || !d.summary;
  return false;
}

// With AI on, your provider reads the save once (src/shared/understand.js): what it is and that kind's
// details. force: Check with AI, which reads it again when something is still missing.
// review: from Places review: a place that isn't named or has no state goes to your AI provider even
// when it has a title.
// verify: Check with AI on the Places list: a place missing its street, city or state goes to your provider
// too; only the missing fields are filled, and a name it already has stays.
export async function fillSave(store, id, { review = false, verify = false, force = false } = {}, { fetchFn, allowed, waitTurn = async () => {}, fetchPage = async () => null, fetchShopPage = fetchPage, loadImage = async () => null }) {
  let item = await store.getItem(id);
  if (!item || item.deletedAt) return;
  let kind = kindOf(item);
  if (!FILLED_KINDS.includes(kind)) return;
  const settings = await store.getSettings();
  // A save from a bulk import waits for Run AI (needsAi): only a check you asked for sends it now.
  const aiAllowed = settings.ai?.on && (!item.needsAi || review || verify || force);
  const key = aiAllowed ? await store.getSecret('aiApiKey') : '';
  // An Instagram place: its caption read again with today's rules first (nothing sent anywhere). Normally
  // that only fills what's missing. From Places review (you asked), what an older reading wrote is replaced:
  // its name, street, city and state, never what you typed yourself; a new street drops the old pin.
  if (kind === 'place' && item.type === 'instagram') {
    const fresh = detailsForKind('place', { ...item, kind: 'link', details: {} });
    const yours = new Set(item.userFields || []);
    const old = item.details || {};
    let details = fillMissing(old, fresh.details);
    if (review && !yours.has('details') && old.source !== 'you') {
      details = { ...old };
      for (const k of ['address', 'locality', 'region', 'postalCode']) if (fresh.details[k]) details[k] = fresh.details[k];
      if (fresh.details.address && fresh.details.address !== old.address) Object.assign(details, { lat: null, lng: null, lookup: null });
    }
    const patch = {};
    if (JSON.stringify(details) !== JSON.stringify(old)) patch.details = details;
    const rename = review ? fresh.title && fresh.title !== item.title : fresh.title && fresh.title !== item.title && !placeNamed(item);
    if (rename && !yours.has('title')) patch.title = fresh.title;
    if (Object.keys(patch).length) item = await store.updateItem(id, patch, { by: 'kind' });
  }
  let d = item.details || {};
  // A post with no name for its place (its title is the caption's), or an imported post that says nothing
  // about where it is: your provider names it and its city, so the lookup can find it.
  const unknownPlace = kind === 'place' && item.type === 'instagram' && !d.address && d.lat == null && !d.locality;
  const inReview = review && kind === 'place' && placeReviewReasons(item).length > 0;
  const incomplete = verify && kind === 'place' && (!d.address || !d.locality || !d.region);
  const unnamed = (genericTitle(item.title) || unknownPlace || inReview || incomplete) && !(item.userFields || []).includes('title');
  if (key && !review && !verify) {
    // Your provider reads the save: what it is and everything that kind's card shows.
    if (!item.understoodAt || (force && incompleteDetails(kind, d))) {
      try {
        await understandItem(store, id, { force: true }, { fetchPage, fetchShopPage, loadImage });
        item = await store.getItem(id);
        d = item.details || {};
        kind = kindOf(item);
      } catch {
        /* the provider didn't answer: the save stays as it was */
      }
      if (!FILLED_KINDS.includes(kind)) return; // it turned out to be something else
    }
  } else if (key && ((['place', 'media', 'book'].includes(kind) && unnamed) || (kind === 'workout' && !d.exercises?.length))) {
    // Places review and the Places list's Check with AI: your provider names the place and its city.
    try {
      let patch = null;
      const r = await identifyForKind(kind, item, settings, key);
      if (r && kind === 'place') patch = { title: placeNamed(item) && !genericTitle(item.title) ? item.title : r.name, details: { ...d, locality: d.locality || r.locality, address: d.address || r.address || '', region: d.region || stateCode(r.state) || r.state || '' } };
      else if (r && kind === 'media') patch = { title: r.title, details: { ...d, year: d.year || r.year, format: r.format || d.format } };
      else if (r && kind === 'book') patch = { title: r.title, details: { ...d, author: d.author || r.author } };
      else if (r && kind === 'workout') patch = { details: { ...d, exercises: r.exercises, durationMinutes: d.durationMinutes || r.durationMinutes, source: 'ai' } };
      // Only what the answer actually changes is applied and logged.
      if (patch) for (const k of Object.keys(patch)) if (JSON.stringify(patch[k]) === JSON.stringify(item[k])) delete patch[k];
      if (patch && Object.keys(patch).length) {
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, item[k] ?? null]));
        await store.updateItem(id, patch, { by: 'ai' });
        await store.appendAiLog([{ id: uid(), runId: `fill-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || item.title,
          changes: Object.keys(patch).map((f) => (f === 'details' ? { field: `${kindInfo(kind).label.toLowerCase()} details`, from: '—', to: 'filled in' } : { field: f, from: String(before[f] ?? ''), to: String(patch[f]) })),
          before, after: patch, reason: `Filled in for ${kindInfo(kind).plural}`, undone: false }]);
        item = await store.getItem(id);
        d = item.details || {};
      }
    } catch {
      /* the provider didn't answer: the save stays as it was */
    }
  }
  if (genericTitle(item.title)) return; // nothing to look up by
  try {
    let found = null;
    if (kind === 'place' && d.lat == null && await allowed(settings, 'places')) {
      found = await lookupPlace({ name: item.title, locality: d.locality, address: d.address, region: d.region }, fetchFn, waitTurn);
    } else if (kind === 'place' && d.lat != null && !d.address && await allowed(settings, 'places')) {
      // A pin but no street address (a shared maps link): the address at the pin.
      await waitTurn();
      found = await lookupAddressAt({ lat: d.lat, lng: d.lng }, fetchFn);
    } else if (kind === 'media' && (!d.year || !d.director) && await allowed(settings, 'media')) {
      found = await lookupFilm({ title: item.title, year: d.year, format: d.format === 'series' ? 'series' : '' }, fetchFn);
    } else if (kind === 'book' && (!d.author || !d.year) && await allowed(settings, 'books')) {
      found = await lookupBook({ title: item.title, author: d.author }, fetchFn);
    }
    if (found) {
      const patch = { details: fillMissing(d, found) };
      if (found.image && !item.image) {
        patch.image = found.image;
        patch.images = [found.image];
      }
      await store.updateItem(id, patch, { by: 'lookup' });
    }
  } catch {
    /* offline or the service didn't answer: try again from Settings → Lookups */
  }
}

// Runs once per pending item. Your provider first works out what the save is (src/shared/understand.js):
// a recipe, workout or place leaves for its Lifestyle view with its details. Anything else gets the
// shopping tidy: a cleaner title and a collection. Re-reads the item first, so anything the person did
// in the meantime wins: a hand-edited title is kept, and a save they filed or moved is never re-filed.
// Every change goes to the AI change log with Undo. If the provider fails, the save simply stays as it
// was. Returns the save's kind afterwards, so the caller can fill in a Lifestyle save.
export async function tidySave(store, id, deps = {}) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || item.captureState !== 'pending') return null;
  const [collections, prefs, settings, key] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings(), store.getSecret('aiApiKey')]);
  if (!settings.ai?.on || !key) {
    await store.updateItem(id, { captureState: 'complete' }, { by: 'machine' });
    return { kind: kindOf(item) };
  }
  try {
    await understandItem(store, id, {}, deps);
  } catch {
    /* the provider didn't answer: the tidy below tries once more and records why if it fails */
  }
  const read = await store.getItem(id);
  if (!read || read.deletedAt) return null;
  if (hasOwnView(kindOf(read))) {
    await store.updateItem(id, { captureState: 'complete', captureError: '' }, { by: 'machine' });
    return { kind: kindOf(read) };
  }
  let ai = null;
  try {
    ai = (await cleanupWithAI([{ ref: 'new', item: read, live: null }], collections, settings, key)).get('new') || null;
  } catch (e) {
    await store.updateItem(id, { captureState: 'complete', captureError: sanitizeText(`AI tidy skipped: ${(e && e.message) || e}`, 200) }, { by: 'machine' }).catch(() => {});
    return { kind: kindOf(read) };
  }
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return null;
  const threshold = prefs.confidenceThreshold || 0.6;
  const userFields = new Set(current.userFields || []);
  const patch = { captureState: 'complete', captureError: '' };
  const before = {};
  const changes = [];
  // A title your provider took from the product's own page (understandProduct) stays.
  if (ai && ai.title && current.type !== 'instagram' && !userFields.has('title') && ai.title !== current.title && current.title === item.title) {
    before.title = current.title;
    patch.title = ai.title;
    changes.push({ field: 'title', from: current.title, to: ai.title });
  }
  const filedByUser = userFields.has('collectionId') || current.categorizationSource === 'manual';
  if (ai && ai.collectionId && ai.collectionId !== current.collectionId && ai.confidence >= threshold && !filedByUser) {
    for (const f of ['collectionId', 'needsReview', 'categorizationSource', 'categorizationReason', 'confidence', 'previousCollections']) before[f] = current[f] === undefined ? null : current[f];
    Object.assign(patch, {
      collectionId: ai.collectionId, needsReview: false, categorizationSource: 'ai', confidence: ai.confidence,
      categorizationReason: `AI: ${ai.reason || 'best match'}`,
      previousCollections: [...(current.previousCollections || []), current.collectionId].filter(Boolean).slice(-20),
    });
    changes.push({ field: 'collection', fromId: current.collectionId || null, toId: ai.collectionId, to: ai.collectionName });
  }
  await store.updateItem(id, patch, { by: 'machine' });
  if (changes.length) {
    const { captureState, captureError, ...after } = patch;
    await store.appendAiLog([{ id: uid(), runId: `save-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after, reason: (ai && ai.reason) || '', undone: false }]);
  }  return { kind: kindOf(current) };
}

// Run AI on imported saves, for one save a bulk import flagged (needsAi): your provider reads it
// (understand.js), then a Lifestyle save gets its fill-in (Lookups) and anything else the AI tidy a new
// save gets (tidySave: title and collection). The provider's errors are thrown, so the caller can slow
// down and try again (src/shared/aiQueue.js); the save stays flagged until it has been read.
export async function readImported(store, id, deps = {}) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || !item.needsAi) return null;
  const settings = await store.getSettings();
  const key = settings.ai?.on ? await store.getSecret('aiApiKey') : '';
  if (!key) throw new Error('Turn on Optional AI and add your API key first.');
  const before = JSON.stringify([item.title, item.kind, item.collectionId, item.details]);
  await understandItem(store, id, { force: true, runId: deps.runId || '' }, deps);
  let current = await store.getItem(id);
  if (!current || current.deletedAt) return null;
  if (current.needsAi) current = await store.updateItem(id, { needsAi: false }, { by: 'machine' });
  if (FILLED_KINDS.includes(kindOf(current))) {
    if (deps.fetchFn) await fillSave(store, id, {}, deps).catch(() => {});
  } else if (!hasOwnView(kindOf(current))) {
    // The shopping tidy: already read above, so this is the one request that files it.
    await store.updateItem(id, { captureState: 'pending' }, { by: 'machine' });
    await tidySave(store, id, deps).catch(() => {});
  }
  const after = await store.getItem(id);
  return { kind: kindOf(after || current), changed: !!after && JSON.stringify([after.title, after.kind, after.collectionId, after.details]) !== before };
}

// Saves still waiting for the AI tidy when the extension (or the iOS app) wakes: the newest few are
// tidied as usual; the rest join the imported-saves queue instead of all going to your provider at once.
export const PENDING_AT_ONCE = 10;
export async function pendingToTidy(store) {
  const pending = (await store.getPendingItems()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (pending.length > PENDING_AT_ONCE) await store.parkPending(pending.slice(PENDING_AT_ONCE).map((i) => i.id));
  return pending.slice(0, PENDING_AT_ONCE);
}
