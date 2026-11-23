#!/usr/bin/env node
// How fast the sorter learns, measured the way it is used: one library, saves arriving one after another.
// Each save goes through the shipped capture (saveCapture, as the Share sheet runs it, no AI); where it
// lands is scored against where the person filed it; then the person does what they would: keeps it
// (Done: a quiet lesson), or moves it to the right place (a clear one). The next save meets a sorter that
// has learned from every one before it. eval.mjs scores a frozen sorter; this scores the learning.
//
//   node tools/qa/replay.mjs --export <library export .json> [--order saved] [--limit N] [--json]
//
// Only saves the person filed in one of their collections are replayed (Lifestyle kinds are decided by
// what a post is, not by what was learned about collections). Order: mixed (a fixed shuffle by id, the way
// saves of every sort arrive in turn), or --order saved (createdAt: an Instagram import arrives one
// collection after another, which is the hardest order to learn in).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadExport } from './lib/cases.mjs';
import { sharedProduct, libraryFor } from './lib/firstpass.mjs';
import { saveCapture } from '../../keepsake/src/shared/capture.js';
import { kindOf, hasOwnView } from '../../keepsake/src/shared/kinds.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
if (!args.export) throw new Error('--export <library export .json> is needed');

export async function replay(cases, collections) {
  const { store } = await libraryFor({ collections });
  const byName = new Map((await store.getCollections()).map((c) => [c.name, c.id]));
  const rows = [];
  for (const c of cases) {
    const want = c.expected.accept.find((a) => a.collection && byName.has(a.collection));
    if (!want) continue;
    const r = await saveCapture(store, sharedProduct(c.evidence, 'page'), { source: 'share-sheet', instant: true });
    if (!r.ok || !r.item) continue;
    const item = r.item;
    // A post the rules read as a recipe, workout or place went to its Lifestyle view: not a collection question.
    if (hasOwnView(kindOf(item))) { await store.deleteForever([item.id]); continue; }
    const landed = item.needsReview || !item.collectionId ? 'review' : item.collectionId === byName.get(want.collection) ? 'right' : 'wrong';
    rows.push({ id: c.id, category: c.category, landed, uncertain: !!c.uncertain });
    if (landed === 'right') await store.confirmFiling(item.id);
    else await store.moveItems([item.id], byName.get(want.collection), { learn: landed === 'review' ? 'strong' : 'light' });
  }
  return rows;
}

const share = (rows, what) => (rows.length ? rows.filter((r) => r.landed === what).length / rows.length : 0);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

const raw = JSON.parse(readFileSync(args.export, 'utf8'));
const when = new Map(Object.values(raw.items || {}).map((i) => [`real-${i.id.slice(0, 8)}`, i.createdAt || i.instagram?.importedAt || '']));
const mixed = (id) => createHash('sha256').update(`replay:${id}`).digest('hex');
const orderKey = args.order === 'saved' ? (c) => String(when.get(c.id)) : (c) => mixed(c.id);
const cases = loadExport(args.export).sort((a, b) => orderKey(a).localeCompare(orderKey(b))).slice(0, Number(args.limit || Infinity));
const collections = cases[0]?.library.collections || [];
const rows = await replay(cases, collections);
const quarters = [0, 1, 2, 3].map((q) => rows.slice(Math.floor((rows.length * q) / 4), Math.floor((rows.length * (q + 1)) / 4)));
const out = {
  saves: rows.length,
  right: share(rows, 'right'), review: share(rows, 'review'), wrong: share(rows, 'wrong'),
  byQuarter: quarters.map((q) => ({ saves: q.length, right: share(q, 'right'), review: share(q, 'review'), wrong: share(q, 'wrong') })),
};
if (args.json) console.log(JSON.stringify(out));
else {
  console.log(`replayed ${rows.length} saves filed into collections (${args.order === 'saved' ? 'as saved' : 'mixed order'}), learning from each`);
  console.log(`  landed right ${pct(out.right)}   waited in Review ${pct(out.review)}   landed wrong ${pct(out.wrong)}`);
  out.byQuarter.forEach((q, i) => console.log(`  quarter ${i + 1} (${q.saves}): right ${pct(q.right)}  Review ${pct(q.review)}  wrong ${pct(q.wrong)}`));
}
