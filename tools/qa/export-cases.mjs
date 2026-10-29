#!/usr/bin/env node
// Writes evaluation cases for the native Apple harness (ios/KeepsakeKit/Tests/KeepsakeKitTests/AppleEvalTests.swift):
// each case's collections and the exact product the Share Extension would hand to capture. The native run
// writes its outcomes back in the shared format, and tools/qa/score.mjs scores them like any other run.
//
//   node tools/qa/export-cases.mjs --out /tmp/cases.json [--source challenge|real|all] [--export <library export>] [--limit 60]

import { writeFileSync } from 'node:fs';
import { loadChallenge, loadExport, loadLibrary } from './lib/cases.mjs';
import { sharedProduct } from './lib/firstpass.mjs';

const arg = (name, d = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const source = arg('source', 'challenge');
const limit = Number(arg('limit', '1000000'));
let cases = [];
if (source === 'challenge' || source === 'all') cases.push(...loadChallenge('firstpass-challenge.json'));
if (source === 'library') cases.push(...loadLibrary(arg('library')));
else if (source !== 'challenge') {
  // A spread across the person's collections, not the first N.
  const real = loadExport(arg('export'));
  const by = new Map();
  for (const c of real) by.set(c.category, [...(by.get(c.category) || []), c]);
  const picked = [];
  for (let i = 0; picked.length < limit && i < 1000; i++) for (const list of by.values()) if (list[i] && picked.length < limit) picked.push(list[i]);
  cases.push(...picked);
}
cases = cases.slice(0, limit);
const out = cases.map((c) => ({ id: c.id, origin: c.origin, category: c.category, tags: c.tags || [], split: c.split || 'dev', expected: c.expected, labelBy: c.labelBy, uncertain: !!c.uncertain, evidence: c.evidence,
  collections: c.library.collections.map(({ id, name, keywords = [], aliases = [] }) => ({ id, name, keywords, aliases })), product: sharedProduct(c.evidence, arg('capture', 'page')) }));
writeFileSync(arg('out', 'cases.json'), JSON.stringify({ format: 'internet-binder-eval-cases', version: 1, capture: arg('capture', 'page'), cases: out }));
console.log(`${out.length} cases → ${arg('out', 'cases.json')}`);
