// Evaluation cases. Two sources, kept apart in every report:
//   real      built from a library export the person made (their own Instagram saves, each filed by
//             them into an Instagram collection: that choice is the human label). Read from a path at
//             run time and never copied into git.
//   challenge tools/qa/fixtures/*.json: hand-written cases for known collisions ("recipe for an AI
//             agent"), marked synthetic. They test rules; they say nothing about how often a case occurs.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('../fixtures/', import.meta.url);

export function loadChallenge(name) {
  const data = JSON.parse(readFileSync(new URL(name, here), 'utf8'));
  const library = data.library;
  return data.cases.map((c) => ({ ...c, origin: 'synthetic', suite: data.suite, library: c.library || library, labelBy: c.labelBy || data.labelBy }));
}

// Held out by creator (a stable hash), so posts by the same account never sit on both sides.
export const splitOf = (key) => (parseInt(createHash('sha256').update(String(key || '')).digest('hex').slice(0, 8), 16) % 5 === 0 ? 'heldout' : 'dev');

// What the person's Instagram collection says a save should become. Lifestyle collections (Workout,
// Restaurants, Movies) say the kind; the rest name the binder collection they made from it. Some
// collections take more than one honest answer (a Health post may be a workout).
const KIND_COLLECTIONS = {
  Workout: [{ kind: 'workout' }],
  Restaurants: [{ kind: 'place' }],
  Movies: [{ kind: 'media' }],
};
const ALSO = {
  Food: [{ kind: 'recipe' }, { kind: 'place' }],
  Health: [{ kind: 'workout' }],
  Roadtrip: [{ kind: 'place' }],
  'Photography and Video ideas': [{ kind: 'video' }, { kind: 'link' }],
};

export function loadExport(path, { limit = Infinity } = {}) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const cols = Object.values(d.collections || {});
  const library = { collections: cols.map((c) => ({ id: c.id, name: c.name, keywords: c.keywords || [], aliases: c.aliases || [], taxonomyKey: c.taxonomyKey || null })) };
  const out = [];
  for (const i of Object.values(d.items || {})) {
    const ig = i.instagram;
    if (!ig?.collectionName || !ig.caption || i.deletedAt) continue;
    const name = ig.collectionName;
    const col = cols.find((c) => c.name === name);
    const accept = KIND_COLLECTIONS[name] || [...(col ? [{ collection: col.name }] : []), ...(ALSO[name] || [])];
    if (!accept.length) continue;
    out.push({
      id: `real-${i.id.slice(0, 8)}`,
      origin: 'real',
      suite: 'firstpass',
      split: splitOf(ig.creator || i.id),
      source: 'instagram',
      category: name,
      evidence: { url: i.url, caption: ig.caption, creator: ig.creator || '', hashtags: ig.hashtags || [], location: ig.location || '' },
      expected: { accept, reviewOk: false },
      labelBy: 'Harold (his Instagram collection)',
      // A catch-all collection ("Interesting", "Funny") is the person's call more than the post's content:
      // the label is real but another reader could fairly disagree.
      uncertain: ['Interesting', 'Funny', 'Nice products'].includes(name),
      library,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Whether an outcome is one the case accepts.
export function accepted(c, o) {
  if (!o || o.lost) return false;
  if (o.review) return !!c.expected.reviewOk;
  return c.expected.accept.some((a) => (!a.kind || a.kind === o.kind) && (!a.collection || a.collection === o.collection));
}

// The type the case expects, when it names one (for the confusion matrix).
export const expectedKinds = (c) => [...new Set(c.expected.accept.map((a) => a.kind || (a.collection ? 'link' : '')).filter(Boolean))];
