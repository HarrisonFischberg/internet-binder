// Workout goals and check-ins. Pure functions, no browser APIs: the same records map one-to-one
// onto the Apple `goal` and `goal_checkin` tables (replica/schema.sql), so CloudKit can sync them later.
//
// goal     { id, itemId, kind: 'frequency' | 'target', spec, startsOn: 'YYYY-MM-DD', endsOn: 'YYYY-MM-DD' | null,
//            plan: [{ week, perWeek?, sets?, reps?, durationSeconds?, note }], planSource: '' | 'you' | 'ai-suggested',
//            source: 'user' | 'ai-suggested', createdAt, updatedAt, deletedAt }
//   frequency spec { perWeek, weeks }                              "3× a week for 4 weeks"
//   target    spec { exercise, sets, reps | durationSeconds }       "Reach 3×12 push-ups"
// checkin  { id, goalId, at (ISO time), result: { sets, reps, durationSeconds, note } }
//   Check-ins are add-only (two devices never conflict); removing one is only offered as an undo.
//
// Weeks run from the goal's start day, not the calendar week: week 1 is startsOn and the six days after it.

import { uid, nowIso, sanitizeText } from './util.js';

export const GOAL_KINDS = ['frequency', 'target'];
export const LIMITS = { perWeek: 14, weeks: 52, sets: 20, reps: 500, durationSeconds: 36000 };

const int = (v, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- days -----------------------------------------------------------------------------------------

// The person's local calendar day, as 'YYYY-MM-DD'.
export function localDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayDate = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export function addDays(day, n) {
  const d = dayDate(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}
// Whole days from a to b (b later is positive). Rounded, so a daylight-saving change doesn't skew it.
export function daysBetween(a, b) {
  return Math.round((dayDate(b) - dayDate(a)) / 864e5);
}

// --- records --------------------------------------------------------------------------------------

function sanitizeSpec(kind, spec = {}) {
  if (kind === 'frequency') return { perWeek: int(spec.perWeek, LIMITS.perWeek) || 3, weeks: int(spec.weeks, LIMITS.weeks) || 4 };
  const durationSeconds = int(spec.durationSeconds, LIMITS.durationSeconds);
  const reps = durationSeconds ? null : int(spec.reps, LIMITS.reps) || 10;
  return { exercise: sanitizeText(spec.exercise, 80) || 'the workout', sets: int(spec.sets, LIMITS.sets) || 1, reps, durationSeconds };
}

function sanitizePlan(plan, max) {
  if (!Array.isArray(plan)) return [];
  const out = [];
  for (const p of plan.slice(0, LIMITS.weeks)) {
    if (!p || typeof p !== 'object') continue;
    const week = int(p.week, max);
    if (!week || out.some((x) => x.week === week)) continue;
    const step = { week, perWeek: int(p.perWeek, LIMITS.perWeek), sets: int(p.sets, LIMITS.sets), reps: int(p.reps, LIMITS.reps), durationSeconds: int(p.durationSeconds, LIMITS.durationSeconds), note: sanitizeText(p.note, 160) };
    if (step.perWeek || step.sets || step.reps || step.durationSeconds) out.push(step);
  }
  return out.sort((a, b) => a.week - b.week);
}

export function makeGoal(input = {}, now = new Date()) {
  const kind = GOAL_KINDS.includes(input.kind) ? input.kind : 'frequency';
  const spec = sanitizeSpec(kind, input.spec);
  const startsOn = typeof input.startsOn === 'string' && DAY_RE.test(input.startsOn) ? input.startsOn : localDay(now);
  const iso = nowIso();
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid(),
    itemId: typeof input.itemId === 'string' ? input.itemId : '',
    kind,
    spec,
    startsOn,
    // A frequency goal ends after its last week; a target has no end date.
    endsOn: kind === 'frequency' ? addDays(startsOn, spec.weeks * 7 - 1) : null,
    plan: sanitizePlan(input.plan, kind === 'frequency' ? spec.weeks : LIMITS.weeks),
    planSource: ['you', 'ai-suggested'].includes(input.planSource) ? input.planSource : '',
    source: input.source === 'ai-suggested' ? 'ai-suggested' : 'user',
    createdAt: input.createdAt || iso,
    updatedAt: input.updatedAt || iso,
    deletedAt: input.deletedAt || null,
  };
}

export function makeCheckin(input = {}) {
  const r = input.result && typeof input.result === 'object' ? input.result : {};
  const at = typeof input.at === 'string' && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : nowIso();
  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid(),
    goalId: typeof input.goalId === 'string' ? input.goalId : '',
    at,
    result: { sets: int(r.sets, LIMITS.sets), reps: int(r.reps, LIMITS.reps), durationSeconds: int(r.durationSeconds, LIMITS.durationSeconds), note: sanitizeText(r.note, 300) },
  };
}

// --- words ----------------------------------------------------------------------------------------

export function formatSeconds(s) {
  if (!s) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m} min`;
}
const setsTimes = (sets, reps, durationSeconds) => (durationSeconds ? `${sets ? `${sets}×` : ''}${formatSeconds(durationSeconds)}` : `${sets ? `${sets}×` : ''}${reps || ''}`);

export function goalTitle(goal) {
  const s = goal.spec || {};
  if (goal.kind === 'frequency') return `${s.perWeek}× a week for ${s.weeks} week${s.weeks === 1 ? '' : 's'}`;
  return `Reach ${setsTimes(s.sets, s.reps, s.durationSeconds)} ${s.exercise}`;
}

export const resultText = (r = {}) => (r.sets || r.reps || r.durationSeconds ? setsTimes(r.sets, r.reps, r.durationSeconds) : '');

// --- progress -------------------------------------------------------------------------------------

// Where a goal stands today. `checkins` may include other goals' (they're ignored).
export function goalProgress(goal, checkins = [], now = new Date()) {
  const today = localDay(now);
  const mine = checkins.filter((c) => c.goalId === goal.id).sort((a, b) => (a.at < b.at ? -1 : 1));
  const elapsed = daysBetween(goal.startsOn, today);
  const weekIndex = Math.max(0, Math.floor(elapsed / 7)); // 0-based
  const planFor = (week) => (goal.plan || []).find((p) => p.week === week) || null;
  const base = { goal, checkins: mine, today, started: elapsed >= 0, weekNumber: weekIndex + 1, lastCheckin: mine[mine.length - 1] || null };

  if (goal.kind === 'frequency') {
    const { perWeek, weeks } = goal.spec;
    // Check-ins count once per day: two on the same day are one session.
    const days = new Set(mine.map((c) => localDay(new Date(c.at))));
    const strip = [];
    for (let i = 0; i < weeks; i++) {
      const start = addDays(goal.startsOn, i * 7);
      const end = addDays(start, 6);
      let count = 0;
      for (const d of days) if (d >= start && d <= end) count++;
      const target = planFor(i + 1)?.perWeek || perWeek;
      strip.push({ week: i + 1, start, end, count, target, met: count >= target, current: i === weekIndex && elapsed >= 0, past: end < today });
    }
    const weeksMet = strip.filter((w) => w.met).length;
    const over = today > goal.endsOn;
    const finished = over || weeksMet === weeks;
    const thisWeek = !finished && elapsed >= 0 ? strip[weekIndex] || null : null;
    const lastWeek = weekIndex > 0 ? strip[Math.min(weekIndex, weeks) - 1] : null;
    let summary;
    if (!base.started) summary = `Starts ${goal.startsOn}`;
    else if (finished) summary = `Finished: ${weeksMet} of ${weeks} week${weeks === 1 ? '' : 's'} at ${perWeek}× or more`;
    else summary = `${thisWeek.count} of ${thisWeek.target} this week · week ${thisWeek.week} of ${weeks}`;
    return {
      ...base, status: finished ? 'finished' : 'active', summary, strip, weeksMet, thisWeek,
      // Neutral wording for a week that fell short, shown only while the goal is running.
      lastWeekNote: !finished && lastWeek && !lastWeek.met ? `${lastWeek.count} of ${lastWeek.target} last week` : '',
      next: thisWeek ? planFor(thisWeek.week) : null,
      ring: thisWeek ? Math.min(1, thisWeek.count / thisWeek.target) : finished ? weeksMet / weeks : 0,
    };
  }

  // target: the best result so far against sets × reps (or sets × time).
  const { sets, reps, durationSeconds } = goal.spec;
  const score = (r) => (durationSeconds ? (r.sets || 1) * (r.durationSeconds || 0) : (r.sets || 1) * (r.reps || 0));
  const hits = (r) => (r.sets || 1) >= sets && (durationSeconds ? (r.durationSeconds || 0) >= durationSeconds : (r.reps || 0) >= reps);
  let best = null;
  for (const c of mine) if ((c.result.reps || c.result.durationSeconds) && (!best || score(c.result) > score(best.result))) best = c;
  const reachedBy = mine.find((c) => hits(c.result)) || null;
  const goalScore = durationSeconds ? sets * durationSeconds : sets * reps;
  const next = planFor(weekIndex + 1);
  let summary;
  if (reachedBy) summary = `Reached on ${reachedBy.at.slice(0, 10)}`;
  else if (best) summary = `Best so far ${resultText(best.result)} · aiming for ${setsTimes(sets, reps, durationSeconds)}`;
  else summary = mine.length ? `${mine.length} check-in${mine.length === 1 ? '' : 's'} so far` : 'No check-ins yet';
  return {
    ...base, status: reachedBy ? 'finished' : 'active', summary, best, reachedBy, next,
    ring: reachedBy ? 1 : best ? Math.min(1, score(best.result) / goalScore) : 0,
  };
}
