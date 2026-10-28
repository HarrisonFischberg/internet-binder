// Fix with AI's rules, shared by Chrome's dashboard (dashboard/aiCleanup.js) and the iPhone and Mac apps
// (ios-bridge.js views.fixWithAI): which of your provider's answers change a save, what the undo log
// keeps, and how Undo puts a save back. The runs themselves (progress, live pages, batching) stay with
// each app.

import { formatPrice, uid, nowIso } from './util.js';
import { needsCollection } from './kinds.js';

// Moving a save that is already in a collection needs more certainty than filing one from Review; saves
// you filed yourself are never moved.
export const REFILE_CONFIDENCE = 0.85;

// The fields a fix may change; the undo log keeps what each was before.
export const FIX_FIELDS = ['title', 'price', 'currency', 'image', 'images', 'collectionId', 'needsReview', 'categorizationSource', 'categorizationReason', 'confidence', 'previousCollections'];

// What one save's fix is, from your provider's answer (provider.js cleanupWithAI) and, in Chrome, its live
// page. Fields you edited by hand stay as they are. `scope` 'review' only files saves waiting in Review.
// `keepTitle`: the save was just read again (understand.js), which already chose its title.
// Each change carries `kind` (titles, prices, images, moved) for the run's summary.
export function planFixes(item, ai, { live = null, imageOk = true, scope = 'all', threshold = 0.6, keepTitle = false } = {}) {
  const patch = {};
  const changes = [];
  const mine = new Set(item.userFields || []);
  if (item.type === 'product') {
    if (ai.title && ai.title !== item.title && !mine.has('title') && !keepTitle) {
      patch.title = ai.title;
      changes.push({ kind: 'titles', field: 'title', from: item.title, to: ai.title });
    }
    const currency = ai.currency || item.currency || '';
    if (ai.price != null && !mine.has('price') && (ai.price !== item.price || (ai.currency && ai.currency !== item.currency))) {
      patch.price = ai.price;
      patch.currency = currency;
      changes.push({ kind: 'prices', field: 'price', from: formatPrice(item.price, item.currency) || 'none', to: formatPrice(ai.price, currency) });
    }
    const liveImage = live && live.image;
    if (liveImage && liveImage !== item.image && !mine.has('image') && (!item.image || !imageOk)) {
      patch.image = liveImage;
      patch.images = [liveImage, ...(item.images || []).filter((u) => u !== liveImage && u !== item.image)].slice(0, 8);
      changes.push({ kind: 'images', field: 'image', from: item.image ? 'broken image' : 'no image', to: 'image from the live page' });
    }
  }
  if (ai.collectionId && ai.collectionId !== item.collectionId) {
    const filedByUser = item.collectionId && (item.categorizationSource === 'manual' || mine.has('collectionId'));
    const needed = item.collectionId ? Math.max(threshold, REFILE_CONFIDENCE) : threshold;
    const allowed = scope === 'review' ? needsCollection(item) : !filedByUser;
    if (allowed && ai.confidence >= needed) {
      patch.collectionId = ai.collectionId;
      patch.needsReview = false;
      patch.categorizationSource = 'ai';
      patch.confidence = ai.confidence;
      patch.categorizationReason = `AI: ${ai.reason || 'best match'}`;
      if (item.collectionId) patch.previousCollections = [...(item.previousCollections || []), item.collectionId].slice(-20);
      changes.push({ kind: 'moved', field: 'collection', fromId: item.collectionId || null, toId: ai.collectionId, to: ai.collectionName });
    }
  }
  return { patch, changes };
}

// Applies a planned fix and returns its undo log entry (append a run's entries with store.appendAiLog).
export async function applyFix(store, item, { patch, changes }, { runId, reason = '' }) {
  const before = {};
  for (const f of FIX_FIELDS) if (f in patch) before[f] = item[f] === undefined ? null : item[f];
  await store.updateItem(item.id, patch, { by: 'ai' });
  return { id: uid(), runId, at: nowIso(), itemId: item.id, itemTitle: patch.title || item.title, changes: changes.map(({ kind, ...rest }) => rest), before, after: patch, reason, undone: false };
}

// Undo for log entries: each save goes back to what it was before. Newest first, so undoing a run that
// changed a save twice ends at the oldest "before". A collection deleted since sends the save to Review.
// Returns how many entries were undone and how many saves they touched.
export async function undoFixes(store, entries) {
  const sorted = [...entries].filter((e) => !e.undone).sort((a, b) => (a.at < b.at ? 1 : -1));
  const collections = new Set((await store.getCollections()).map((c) => c.id));
  const done = [];
  for (const e of sorted) {
    if (e.goalId) {
      // A workout goal's plan, suggested on request.
      if (await store.getGoal(e.goalId)) await store.updateGoal(e.goalId, e.before);
      done.push(e.id);
      continue;
    }
    const item = await store.getItem(e.itemId);
    if (item) {
      const restore = { ...e.before };
      if ('collectionId' in restore && restore.collectionId && !collections.has(restore.collectionId)) {
        restore.collectionId = null;
        restore.needsReview = true;
      }
      await store.updateItem(item.id, restore, { by: 'ai' });
    }
    done.push(e.id);
  }
  if (done.length) await store.markAiLogUndone(done);
  return { entries: done.length, items: new Set(sorted.map((e) => e.itemId)).size };
}
