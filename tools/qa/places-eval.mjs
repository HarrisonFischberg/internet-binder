#!/usr/bin/env node
// Fix with AI's place check, scored on the place cases (fixtures/places-challenge.json) with captured
// OpenStreetMap and web-search answers. No network: every request is served from the case.
//
//   node tools/qa/places-eval.mjs                 the place check (placeResolve.js)
//   node tools/qa/places-eval.mjs --path old      the fill-in it replaces (fill.js fillSave, review on)
//
// Output: tools/qa/out/<name>.json (git-ignored).
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadPlaces, runPlaceCase, judgePlace } from './lib/places.mjs';
import { wilson, pct } from './lib/metrics.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const path = args.path || 'resolve';
const results = [];
for (const c of loadPlaces()) {
  const o = await runPlaceCase(c, { path });
  results.push({ case: c, outcome: o, verdict: judgePlace(c, o) });
}
const n = results.length;
const count = (f) => results.filter(f).length;
const rate = (k) => ({ k, n, ...wilson(k, n) });
const summary = {
  correct: rate(count((r) => r.verdict.ok)),
  wrongFact: rate(count((r) => r.verdict.wrongFact)),
  wrongApplied: rate(count((r) => r.verdict.wrongApplied)),
  outcomes: results.reduce((m, r) => ({ ...m, [r.outcome.outcome]: (m[r.outcome.outcome] || 0) + 1 }), {}),
  hosts: results.flatMap((r) => r.outcome.requests.map((q) => q.host)).reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {}),
};
let commit = '';
try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const name = args.name || `places-${path}`;
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const file = new URL(`./out/${name}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ meta: { at: new Date().toISOString(), commit, path, cases: n, labelBy: 'Claude (synthetic, unreviewed)', split: 'dev (written with the code)' }, summary, results: results.map((r) => ({ id: r.case.id, note: r.case.note, expect: r.case.expect, ...r.outcome, verdict: r.verdict })) }, null, 1));
console.log(`${name}: ${n} place cases, path ${path}`);
console.log(`  correct outcome        ${pct(summary.correct)}`);
console.log(`  unverified fact written ${pct(summary.wrongFact)}`);
console.log(`  unverifiable applied   ${pct(summary.wrongApplied)}`);
console.log(`  outcomes ${JSON.stringify(summary.outcomes)}  requests ${JSON.stringify(summary.hosts)}`);
for (const r of results.filter((x) => !x.verdict.ok)) console.log(`  ✗ ${r.case.id} ${r.case.note}: ${r.verdict.fails.join('; ')}`);
console.log(`  → ${file.pathname}`);
