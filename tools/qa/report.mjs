#!/usr/bin/env node
// One self-contained HTML page from the eval runs: each data set before vs after, the Mac's Claude and
// Apple runs, the place check, and every case with filters (data set, category, what changed, search).
//
//   node tools/qa/report.mjs [--base tools/qa/out/base] [--final tools/qa/out/final] [--mac mac.json] [--out report.html]
//
// Pairs runs by name: base-<set>.json with final-<set>.json. --mac: the Mac runs' summaries (Claude and
// Apple: they run there, where the key and Apple Intelligence are), as written into the report by hand
// from tools/qa/score.mjs output. Captions are cut to 220 characters; notes are never in the runs.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { judge } from './lib/metrics.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const here = new URL('.', import.meta.url).pathname;
const baseDir = args.base || join(here, 'out/base');
const finalDir = args.final || join(here, 'out/final');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const SETS = {
  challenge: { label: 'Challenge set', about: '34 synthetic posts (AI tools, workouts, food, mixed, sparse). Labels by Claude, unreviewed. Rules were tuned on it.' },
  library: { label: 'Your fixes (Oct 29 export)', about: '58 saves you moved or retyped yourself. Your choice is the answer. Rules were tuned on it.' },
  'real-heldout': { label: 'Your Instagram collections, held out', about: '214 posts from creators not used for tuning (Oct 21 export). Answer: the Instagram collection you saved it to. New library, nothing learned yet.' },
  'real-heldout-warm': { label: 'Held out, after learning', about: 'The same 214 posts, with the sorter first taught by 533 other posts filed where you filed them.' },
  'real-dev': { label: 'Your Instagram collections, dev', about: '782 posts from the other creators (Oct 21 export). Looked at while tuning.' },
  'real-urlonly': { label: 'Held out, link only', about: 'The same 214 posts when Instagram shows a login wall, so only the link is shared.' },
};

const sets = [];
for (const [key, meta] of Object.entries(SETS)) {
  const b = join(baseDir, `base-${key}.json`);
  const f = join(finalDir, `final-${key}.json`);
  if (!existsSync(b) || !existsSync(f)) continue;
  const base = read(b);
  const fin = read(f);
  const byId = new Map(base.results.map((r) => [r.case.id, r]));
  const rows = fin.results.map((r) => {
    const was = byId.get(r.case.id);
    const v = judge(r.case, r.settled);
    const wv = was ? judge(r.case, was.settled) : null;
    return {
      set: key, id: r.case.id, category: r.case.category || '', split: r.case.split || '',
      caption: String(r.case.evidence?.caption || r.case.evidence?.title || '').replace(/\s+/g, ' ').slice(0, 220),
      expected: (r.case.expected.accept || []).map((a) => [a.kind, a.collection].filter(Boolean).join(' · ')).join(' or ') || (r.case.expected.reviewOk ? 'Review' : '—'),
      before: was ? outcome(was.settled) : '', beforeOk: !!wv?.ok, beforeWhy: was?.settled?.reason || '',
      after: outcome(r.settled), afterOk: v.ok, afterWhy: r.settled.reason || '', confidentWrong: v.confidentWrong,
    };
  });
  sets.push({ key, ...meta, base: base.summary.settled, final: fin.summary.settled, baseCommit: base.meta.commit, finalCommit: fin.meta.commit, rows });
}
function outcome(o) {
  if (!o || o.lost) return 'lost';
  if (o.review) return `${o.kind} · Review`;
  return [o.kind, o.collection].filter(Boolean).join(' · ');
}

const places = ['base', 'final'].map((w) => {
  const p = join(w === 'base' ? baseDir : finalDir, `${w}-places.json`);
  return existsSync(p) ? read(p) : null;
});
const mac = args.mac && existsSync(args.mac) ? read(args.mac) : null;
const data = { generated: new Date().toISOString(), sets, places: places[1] ? { base: places[0]?.summary, final: places[1].summary, rows: places[1].results.map((r) => ({ id: r.id, note: r.note, outcome: r.outcome, ok: r.verdict.ok, fails: r.verdict.fails, beforeOk: places[0]?.results.find((x) => x.id === r.id)?.verdict.ok ?? null, address: r.address, choices: r.choices.length })) } : null, mac };

const html = readFileSync(join(here, 'report-template.html'), 'utf8').replace('/*DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c').replace(/\uFFFD/g, ''));
const out = args.out || join(here, 'out/report.html');
writeFileSync(out, html);
console.log(`report: ${sets.length} data sets, ${sets.reduce((n, s) => n + s.rows.length, 0)} cases → ${out}`);
