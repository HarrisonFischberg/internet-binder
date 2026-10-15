// Keepsake's after-save work, shared by the Chrome extension's background worker and the iOS app
// (through JavaScriptCore): filling in a Lifestyle save (Optional AI, then the Lookups you turned on)
// and the optional AI tidy of a new save. The caller supplies the network (`fetchFn`), which Lookups are
// allowed (`allowed`), and the pace for OpenStreetMap (`waitTurn`, at most one request a second).
// AI calls go through src/ai/provider.js with the person's own key; nothing runs unless it is on.

import { uid, nowIso, sanitizeText } from './util.js';
import { kindOf, kindInfo, detailsForKind, genericTitle } from './kinds.js';
import { placeNamed, placeReviewReasons, stateCode } from './places.js';
import { lookupPlace, lookupAddressAt, lookupFilm, lookupBook, fillMissing } from './lookups.js';
import { FILLED_KINDS } from './capture.js';
import { cleanupWithAI, identifyForKind, draftRecipe } from '../ai/provider.js';

// review: from Places review: a place that isn't named or has no state goes to your AI provider even
// when it has a title.
// verify: Check with AI on the Places list: a place missing its street, city or state goes to your provider
// too; only the missing fields are filled, and a name it already has stays.
export async function fillSave(store, id, { review = false, verify = false } = {}, { fetchFn, allowed, waitTurn = async () => {} }) {
  let item = await store.getItem(id);
  if (!item || item.deletedAt) return;
  const kind = kindOf(item);
  if (!FILLED_KINDS.includes(kind)) return;
  const settings = await store.getSettings();
  const key = settings.ai?.on ? await store.getSecret('aiApiKey') : '';
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
  if (key && ((['place', 'media', 'book'].includes(kind) && unnamed) || (kind === 'workout' && !d.exercises?.length) || (kind === 'recipe' && !d.ingredients?.length))) {
    try {
      let patch = null;
      if (kind === 'recipe') {
        const r = await draftRecipe(item, settings, key);
        patch = { details: { ...d, ...r } };
      } else {
        const r = await identifyForKind(kind, item, settings, key);
        if (r && kind === 'place') patch = { title: placeNamed(item) && !genericTitle(item.title) ? item.title : r.name, details: { ...d, locality: d.locality || r.locality, address: d.address || r.address || '', region: d.region || stateCode(r.state) || r.state || '' } };
        else if (r && kind === 'media') patch = { title: r.title, details: { ...d, year: d.year || r.year, format: r.format || d.format } };
        else if (r && kind === 'book') patch = { title: r.title, details: { ...d, author: d.author || r.author } };
        else if (r && kind === 'workout') patch = { details: { ...d, exercises: r.exercises, durationMinutes: d.durationMinutes || r.durationMinutes, source: 'ai' } };
      }
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

// Runs once per pending item. Re-reads the item first, so anything the person did in the meantime
// wins: a hand-edited title is kept, and a save they filed or moved is never re-filed. Every change
// goes to the AI change log with Undo. If the provider fails, the save simply stays as it was.
export async function tidySave(store, id) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || item.captureState !== 'pending') return;
  const [collections, prefs, settings, key] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings(), store.getSecret('aiApiKey')]);
  if (!settings.ai?.on || !key) {
    await store.updateItem(id, { captureState: 'complete' }, { by: 'machine' });
    return;
  }
  let ai = null;
  try {
    ai = (await cleanupWithAI([{ ref: 'new', item, live: null }], collections, settings, key)).get('new') || null;
  } catch (e) {
    await store.updateItem(id, { captureState: 'complete', captureError: sanitizeText(`AI tidy skipped: ${(e && e.message) || e}`, 200) }, { by: 'machine' }).catch(() => {});
    return;
  }
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return;
  const threshold = prefs.confidenceThreshold || 0.6;
  const userFields = new Set(current.userFields || []);
  const patch = { captureState: 'complete', captureError: '' };
  const before = {};
  const changes = [];
  if (ai && ai.title && current.type !== 'instagram' && !userFields.has('title') && ai.title !== current.title) {
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
  }
}
