#!/usr/bin/env node
// One self-contained HTML page from the eval runs: every data set and provider before vs after (repeated runs
// pooled, with their spread), the place check, cost, latency, network hosts, the held-out sets and the known
// gaps, and every case with filters (data set, provider, category, outcome, what changed, search).
//
//   node tools/qa/report.mjs --config report-config.json [--out report.html]
//
// The config lists the runs (paths to eval.mjs / score.mjs / places-eval.mjs outputs) and the page's words:
//   { title, lede, verdict: { title, lines }, notes: [..], gaps: [..], heldout: { about, folds: { A: [ids] } },
//     sets: [{ key, label, about, provider, base: [run.json…], final: [run.json…] }], places: { base, final },
//     network: [{ mode, hosts, note }] }
// A run file with --repeat holds every repeat; each is scored on its own and pooled. Captions are cut to 220
// characters. Keys never reach a run file (tools/qa/lib/env.mjs redacts), so none can reach the page.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { judge, summarize, wilson } from './lib/metrics.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const here = new URL('.', import.meta.url).pathname;
const cfgPath = resolve(args.config);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const at = (p) => resolve(dirname(cfgPath), p);
const read = (p) => JSON.parse(readFileSync(at(p), 'utf8'));

const METRICS = ['accuracy', 'kind', 'review', 'confidentWrong', 'aiMisroute', 'workoutAsRecipe', 'postAsProduct', 'lostOrPending'];

// Runs of one side (base or final): each file split into its repeats, each repeat scored.
function side(paths) {
  const runs = [];
  let usd = 0;
  let calls = 0;
  const hosts = {};
  const ms = [];
  let meta = null;
  for (const p of paths || []) {
    if (!existsSync(at(p))) continue;
    const f = read(p);
    meta ||= f.meta;
    const net = f.meta?.network || {};
    usd += Number(net.usd || 0);
    calls += Number(net.requests || 0);
    for (const [h, n] of Object.entries(net.hosts || (net.requests === undefined ? net : {}))) if (typeof n === 'number') hosts[h] = (hosts[h] || 0) + n;
    const byRep = new Map();
    for (const r of f.results) {
      const k = r.repeat || 0;
      if (!byRep.has(k)) byRep.set(k, []);
      const v = r.verdict || { settled: judge(r.case, r.settled) };
      byRep.get(k).push({ ...r, verdict: { ...v, settled: v.settled || judge(r.case, r.settled) } });
      if (r.ms) ms.push((r.ms.save || 0) + (r.ms.settle || 0));
    }
    for (const rs of byRep.values()) runs.push(rs);
  }
  if (!runs.length) return null;
  const sums = runs.map((rs) => summarize(rs, 'settled'));
  const agg = {};
  for (const m of METRICS) {
    const ks = sums.map((s) => s[m]).filter((w) => w && w.n);
    if (!ks.length) continue;
    const k = ks.reduce((a, w) => a + w.k, 0);
    const n = ks.reduce((a, w) => a + w.n, 0);
    const rates = ks.map((w) => w.rate);
    agg[m] = { ...wilson(k, n), mean: rates.reduce((a, b) => a + b, 0) / rates.length, min: Math.min(...rates), max: Math.max(...rates), runs: rates.length, perRun: ks[0].n };
  }
  ms.sort((a, b) => a - b);
  const cases = runs.reduce((a, rs) => a + rs.length, 0);
  return { runs, agg, usd, calls, hosts, cases, per100: cases ? (usd / cases) * 100 : 0, p50: ms[Math.floor(ms.length * 0.5)] ?? null, p90: ms[Math.floor(ms.length * 0.9)] ?? null, commit: meta?.commit || '', model: meta?.model || meta?.provider || '' };
}

function outcome(o) {
  if (!o || o.lost) return 'lost';
  if (o.review) return `${o.kind} · Review`;
  return [o.kind, o.collection].filter(Boolean).join(' · ');
}

const sets = [];
for (const s of cfg.sets) {
  const base = side(s.base);
  const fin = side(s.final);
  if (!fin) continue;
  const was = new Map((base?.runs[0] || []).map((r) => [r.case.id, r]));
  const okCount = (runs, id) => runs.reduce((a, rs) => a + (rs.find((r) => r.case.id === id)?.verdict.settled.ok ? 1 : 0), 0);
  const rows = fin.runs[0].map((r) => {
    const b = was.get(r.case.id);
    const v = r.verdict.settled;
    return {
      set: s.key, provider: s.provider, id: r.case.id, category: r.case.category || '',
      caption: String(r.case.evidence?.caption || r.case.evidence?.title || '').replace(/\s+/g, ' ').slice(0, 220),
      expected: (r.case.expected.accept || []).map((a) => [a.kind, a.collection].filter(Boolean).join(' · ')).join(' or ') + (r.case.expected.reviewOk ? `${r.case.expected.accept.length ? ' or ' : ''}Review` : '') || '—',
      before: b ? outcome(b.settled) : '', beforeOk: !!b?.verdict.settled.ok, beforeWhy: b?.settled?.reason || '',
      after: outcome(r.settled), afterOk: v.ok, afterWhy: r.settled.reason || '', confidentWrong: v.confidentWrong,
      repeats: fin.runs.length > 1 ? `${okCount(fin.runs, r.case.id)}/${fin.runs.length} runs right` : '',
    };
  });
  const strip = (x) => (x ? { agg: x.agg, usd: x.usd, calls: x.calls, hosts: x.hosts, cases: x.cases, per100: x.per100, p50: x.p50, p90: x.p90, commit: x.commit, runs: x.runs.length } : null);
  sets.push({ key: s.key, label: s.label, about: s.about, provider: s.provider, base: strip(base), final: strip(fin), rows });
}

let places = null;
if (cfg.places && existsSync(at(cfg.places.final))) {
  const fin = read(cfg.places.final);
  const base = cfg.places.base && existsSync(at(cfg.places.base)) ? read(cfg.places.base) : null;
  places = {
    base: base?.summary, final: fin.summary,
    rows: fin.results.map((r) => ({ id: r.id, note: r.note, outcome: r.outcome, ok: r.verdict.ok, fails: r.verdict.fails, beforeOk: base?.results.find((x) => x.id === r.id)?.verdict.ok ?? null, address: r.address, choices: (r.choices || []).length, verifiedBy: r.lookup?.verifiedBy || [] })),
  };
}

const data = { generated: new Date().toISOString(), title: cfg.title, lede: cfg.lede, verdict: cfg.verdict, notes: cfg.notes || [], gaps: cfg.gaps || [], heldout: cfg.heldout || null, network: cfg.network || [], labels: cfg.labels || null, sets, places };
const html = readFileSync(join(here, 'report-template.html'), 'utf8').replace('/*DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c').replace(/�/g, ''));
const out = args.out || join(here, 'out/report.html');
writeFileSync(out, html);
console.log(`report: ${sets.length} data sets, ${sets.reduce((n, s) => n + s.rows.length, 0)} cases → ${out}`);
