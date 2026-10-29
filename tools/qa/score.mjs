#!/usr/bin/env node
// Scores outcomes a native harness wrote (AppleEvalTests.swift) with the same rules as eval.mjs, and saves
// them in the shared format under tools/qa/out/. Ground truth is the case's label, never a model.
//
//   node tools/qa/score.mjs --native /tmp/apple-results.json --name apple-mac

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { judge, summarize, pct } from './lib/metrics.mjs';

const arg = (name, d = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const raw = JSON.parse(readFileSync(arg('native'), 'utf8'));
const results = raw.results.map((r) => ({ ...r, verdict: { immediate: judge(r.case, r.immediate), settled: judge(r.case, r.settled) } }));
const summary = { immediate: summarize(results, 'immediate'), settled: summarize(results, 'settled') };
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const name = arg('name', `native-${Date.now()}`);
writeFileSync(new URL(`./out/${name}.json`, import.meta.url), JSON.stringify({ meta: raw.meta, summary, results }, null, 1));
const s = summary.settled;
console.log(`${name}: ${results.length} cases, ${raw.meta.provider} on ${raw.meta.platform} (Apple Intelligence: ${raw.meta.appleStatus})`);
for (const [label, w] of [['correct', s.accuracy], ['content type', s.kind], ['Review', s.review], ['confidently wrong', s.confidentWrong], ['AI → Review/Interesting', s.aiMisroute], ['workout → recipe', s.workoutAsRecipe], ['lost or pending', s.lostOrPending]]) console.log(`  ${label.padEnd(24)} ${pct(w)}`);
console.log(`  network attempts: ${JSON.stringify(raw.meta.network || {})}`);
