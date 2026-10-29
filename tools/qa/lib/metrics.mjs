// Scores for a run. Every rate comes with its count and a 95% Wilson interval, so a small sample reads
// as small. Truth is decided by the case's human or reviewed label, never by a model.

import { accepted, expectedKinds } from './cases.mjs';

export function wilson(k, n, z = 1.96) {
  if (!n) return { rate: null, lo: null, hi: null, k, n };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), k, n };
}

const LIFESTYLE = new Set(['recipe', 'workout', 'place', 'media', 'book', 'video', 'article']);

// One case's verdicts on one outcome.
export function judge(c, o) {
  const kinds = expectedKinds(c);
  const kindOk = !o || o.lost ? false : kinds.length ? kinds.includes(o.kind) || (kinds.includes('link') && !LIFESTYLE.has(o.kind)) : true;
  const ok = accepted(c, o);
  return {
    lost: !o || !!o.lost,
    pending: !!o?.pending,
    kindOk,
    // A post about a topic (expected: a link in a collection) read as one thing to buy.
    postAsProduct: !!o && !o.lost && o.kind === 'product' && kinds.includes('link') && !kinds.includes('product') && /instagram\.com/.test(c.evidence?.url || ''),
    ok,
    review: !!o?.review,
    unnecessaryReview: !!o?.review && !c.expected.reviewOk,
    confidentWrong: !!o && !o.lost && !o.review && !ok,
    aiMisroute: (c.tags || []).includes('ai') && !ok && (o?.review || o?.collection === 'Interesting'),
    workoutAsRecipe: kinds.includes('workout') && !kinds.includes('recipe') && o?.kind === 'recipe',
    recipeAsWorkout: kinds.includes('recipe') && !kinds.includes('workout') && o?.kind === 'workout',
  };
}

export function summarize(results, phase = 'settled') {
  const rows = results.filter((r) => r[phase]);
  const n = rows.length;
  const count = (f) => rows.filter((r) => r.verdict[phase][f]).length;
  const ai = rows.filter((r) => (r.case.tags || []).includes('ai'));
  const wk = rows.filter((r) => expectedKinds(r.case).includes('workout') && !expectedKinds(r.case).includes('recipe'));
  const out = {
    n,
    accuracy: wilson(count('ok'), n),
    kind: wilson(count('kindOk'), n),
    postAsProduct: wilson(count('postAsProduct'), n),
    review: wilson(count('review'), n),
    unnecessaryReview: wilson(count('unnecessaryReview'), n),
    confidentWrong: wilson(count('confidentWrong'), n),
    lostOrPending: wilson(rows.filter((r) => r.verdict[phase].lost || r.verdict[phase].pending).length, n),
    aiMisroute: wilson(ai.filter((r) => r.verdict[phase].aiMisroute).length, ai.length),
    workoutAsRecipe: wilson(wk.filter((r) => r.verdict[phase].workoutAsRecipe).length, wk.length),
  };
  // Per expected category: how many were placed right, and where the rest went.
  const byCat = {};
  for (const r of rows) {
    const k = r.case.category || '—';
    const b = (byCat[k] ||= { n: 0, ok: 0, review: 0, wrong: {} });
    b.n++;
    const o = r[phase];
    if (r.verdict[phase].ok) b.ok++;
    else if (o.review) b.review++;
    else { const w = o.collection || `kind:${o.kind}`; b.wrong[w] = (b.wrong[w] || 0) + 1; }
  }
  out.byCategory = byCat;
  // Content type confusion: expected kind → actual kind.
  const confusion = {};
  for (const r of rows) {
    const exp = expectedKinds(r.case).join('|') || '?';
    const got = r[phase].lost ? 'lost' : r[phase].kind;
    (confusion[exp] ||= {})[got] = (confusion[exp][got] || 0) + 1;
  }
  out.confusion = confusion;
  return out;
}

export const pct = (w) => (w.rate === null ? '—' : `${(w.rate * 100).toFixed(1)}% (${w.k}/${w.n}, 95% CI ${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}%)`);
