#!/usr/bin/env node
// Internet Binder first-pass evaluation. Runs cases through the shipped capture engine and scores them.
//
//   node tools/qa/eval.mjs                                    challenge cases, no AI (deterministic; CI)
//   node tools/qa/eval.mjs --source wide                      the wider synthetic set (fixtures/firstpass-wide.json)
//   node tools/qa/eval.mjs --source real --export <file>      the person's own export (labels: their collections)
//   node tools/qa/eval.mjs --capture url-only                 as if Instagram's page were a login wall
//   node tools/qa/eval.mjs --provider anthropic --env <file>  LIVE: your provider reads each save after it is saved
//
// Live runs are bounded: --limit (default 20 cases), --concurrency (default 2), --max-requests (default
// 120) and --max-usd (default 1.00) stop the run before it goes further. Keys come only from --env.
// Output: tools/qa/out/<name>.json (git-ignored), one shared format for every provider and platform.

import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadChallenge, loadExport, loadLibrary } from './lib/cases.mjs';
import { runFirstPass, sharedProduct } from './lib/firstpass.mjs';
import { learnFromSaves, emptyPrefs } from '../../keepsake/src/shared/categorizer.js';
import { judge, summarize, pct } from './lib/metrics.mjs';
import { loadQaEnv, redact } from './lib/env.mjs';
import { recordNetwork } from './lib/network.mjs';
import { setLocalModel } from '../../keepsake/src/ai/provider.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const provider = args.provider || 'none';
const live = provider === 'anthropic' || provider === 'openai';
const limit = Number(args.limit || (live ? 20 : Infinity));
const split = args.split || 'all';
const capture = args.capture || 'page';
const repeat = Number(args.repeat || 1);

let cases = [];
if (args.source === 'real' || args.source === 'all') {
  if (!args.export) throw new Error('--export <library export .json> is needed for real cases');
  cases.push(...loadExport(args.export));
}
if (args.library) cases.push(...loadLibrary(args.library));
if ((!args.source && !args.library) || args.source === 'challenge' || args.source === 'all') cases.push(...loadChallenge('firstpass-challenge.json'));
// --source wide: the 174 wider synthetic cases (platforms, languages, places, products…); see fixtures/LABELING.md.
if (args.source === 'wide' || args.source === 'all') cases.push(...loadChallenge('firstpass-wide.json'));
// --warm: the library already holds the dev split's saves, filed where the person filed them, and the
// sorter has learned from them (store.learnFromLibrary does this once per library). Scored on held-out.
// --warm cv: the same, inside the dev split only (learn from four fifths, score the other fifth), for
// tuning learning without looking at a held-out fold.
if (args.warm === 'cv') {
  const cv = (c) => parseInt(createHash('sha256').update(`cv:${c.id}`).digest('hex').slice(0, 8), 16) % 5 === Number(args['cv-fold'] || 0);
  cases = cases.filter((c) => c.split === 'dev').map((c) => ({ ...c, split: cv(c) ? 'heldout' : 'dev' }));
}
if (args.warm) {
  // Lifestyle collections (Workout, Restaurants, Movies) are saves of that kind with no collection.
  const dev = cases.filter((c) => c.split === 'dev' && (c.expected.accept[0]?.collection || c.expected.accept.length === 1));
  const saves = dev.map((c) => {
    const a = c.expected.accept[0];
    const collectionId = a.collection ? c.library.collections.find((x) => x.name === a.collection)?.id : null;
    return { ...sharedProduct(c.evidence, 'page'), host: 'www.instagram.com', collectionId, kind: a.kind || 'link' };
  }).filter((s) => s.collectionId || s.kind !== 'link');
  const prefs = learnFromSaves(saves, emptyPrefs());
  cases = cases.map((c) => (c.split === 'heldout' ? { ...c, library: { ...c.library, prefs } } : c));
  console.log(`warm library: learned from ${saves.length} filed dev saves`);
}
if (split !== 'all') cases = cases.filter((c) => (c.split || 'dev') === split);
if (args.fold) cases = cases.filter((c) => String(args.fold).includes(c.fold));
if (args.category) cases = cases.filter((c) => c.category === args.category);
if (args.tag) cases = cases.filter((c) => (c.tags || []).includes(args.tag));
if (args.sample && Number.isFinite(limit)) {
  // A spread across categories rather than the first N.
  const by = new Map();
  for (const c of cases) by.set(c.category, [...(by.get(c.category) || []), c]);
  const out = [];
  for (let i = 0; out.length < limit && i < 1000; i++) for (const list of by.values()) if (list[i] && out.length < limit) out.push(list[i]);
  cases = out;
} else cases = cases.slice(0, limit);

let ai = null;
let keys = {};
if (live) {
  const env = loadQaEnv(args.env);
  keys = env.keys;
  const name = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  console.log(`credentials: file ${env.status.found ? 'found' : 'missing'}, private ${env.status.private}, names [${env.status.names.join(', ')}]`);
  if (!keys[name]) { console.log(`BLOCKED: no ${name} in the credentials file`); process.exit(2); }
  ai = { key: keys[name], settings: { ai: { on: true, provider, model: args.model || '', effort: args.effort || 'medium' } } };
}
if (args.mock) {
  // A scripted device model, to prove the plumbing only. Its results are labelled mock and never scored as Apple.
  setLocalModel({ ready: () => true, respond: async () => args.mock });
}

const net = recordNetwork({ maxRequests: Number(args['max-requests'] || 120), maxUsd: Number(args['max-usd'] || 1), keys });
const results = [];
const queue = [];
for (let r = 0; r < repeat; r++) for (const c of cases) queue.push({ c, r });
const workers = Math.max(1, Math.min(Number(args.concurrency || (live ? 2 : 8)), 4));
let stopped = '';
await Promise.all(Array.from({ length: workers }, async () => {
  while (queue.length && !stopped) {
    const { c, r } = queue.shift();
    let run;
    try {
      run = await runFirstPass(c, { capture, ai });
    } catch (e) {
      run = { error: redact(e?.message || e, keys), immediate: { lost: true }, settled: { lost: true } };
      if (/budget/.test(run.error)) stopped = run.error;
    }
    if (net.stopped) stopped = net.stopped;
    results.push({ case: c, repeat: r, ...run, error: redact(run.error || '', keys), verdict: { immediate: judge(c, run.immediate), settled: judge(c, run.settled) } });
  }
}));

let commit = '';
try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
const meta = {
  at: new Date().toISOString(), commit, provider, model: ai ? ai.settings.ai.model || '(adapter default)' : '', effort: ai ? ai.settings.ai.effort : '',
  platform: args.platform || `node ${process.version} (shared engine, as on iPhone via JavaScriptCore)`, capture, split, fold: args.fold || '', cases: cases.length, repeat,
  sources: [...new Set(cases.map((c) => c.origin))], label: args.label || '', stopped, network: net.summary(),
};
const summary = { immediate: summarize(results, 'immediate'), settled: summarize(results, 'settled') };
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const name = args.name || `firstpass-${provider}-${capture}-${Date.now()}`;
const file = new URL(`./out/${name}.json`, import.meta.url);
mkdirSync(new URL('.', file), { recursive: true });
writeFileSync(file, JSON.stringify({ meta, summary, results: results.map(({ case: c, ...r }) => ({ case: { id: c.id, origin: c.origin, category: c.category, tags: c.tags, split: c.split, fold: c.fold, expected: c.expected, evidence: c.evidence, labelBy: c.labelBy, uncertain: c.uncertain, note: c.note }, ...r })) }, null, 1));

const s = summary.settled;
console.log(`${name}: ${cases.length} cases × ${repeat}, provider ${provider}${meta.model ? ` ${meta.model}` : ''}, capture ${capture}`);
console.log(`  correct (type + collection) ${pct(s.accuracy)}`);
console.log(`  content type               ${pct(s.kind)}`);
console.log(`  post read as a product     ${pct(s.postAsProduct)}`);
console.log(`  Review                     ${pct(s.review)}  (unnecessary ${pct(s.unnecessaryReview)})`);
console.log(`  confidently wrong          ${pct(s.confidentWrong)}`);
console.log(`  AI post → Review/Interesting ${pct(s.aiMisroute)}`);
console.log(`  workout → recipe           ${pct(s.workoutAsRecipe)}`);
console.log(`  lost or still pending      ${pct(s.lostOrPending)}`);
if (args.verbose) for (const r of results.filter((x) => !x.verdict.settled.ok)) console.log(`  ✗ ${r.case.id} [${r.case.category}] → ${r.settled.review ? 'Review' : r.settled.collection || `kind:${r.settled.kind}`} (${r.settled.reason || ''})${r.error ? ` error: ${r.error}` : ''}`);
console.log(`  network: ${JSON.stringify(meta.network)}`);
if (stopped) console.log(`  STOPPED: ${stopped}`);
console.log(`  → ${file.pathname}`);
