// Workout goals: records and progress (shared/goals.js). Pure; the same rules go to iOS/macOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGoal, makeCheckin, goalProgress, goalTitle, localDay, addDays, daysBetween, resultText } from '../keepsake/src/shared/goals.js';

const at = (day, hour = 18) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hour).toISOString(); };
const now = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };

test('days: local calendar days, across month ends and daylight saving', () => {
  assert.equal(addDays('2026-10-29', 5), '2026-11-03');
  assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(daysBetween('2026-10-20', '2026-11-03'), 14);
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('makeGoal: sane numbers, end date from weeks, plans bounded and sorted', () => {
  const g = makeGoal({ kind: 'frequency', spec: { perWeek: 99, weeks: '4' }, startsOn: '2026-10-05', plan: [{ week: 2, perWeek: 3 }, { week: 1, perWeek: 2 }, { week: 9, perWeek: 3 }, { week: 1, perWeek: 5 }, 'x'] });
  assert.deepEqual(g.spec, { perWeek: 3, weeks: 4 }, 'out of range falls back to the default');
  assert.equal(g.endsOn, '2026-11-01');
  assert.deepEqual(g.plan.map((p) => p.week), [1, 2], 'one entry per week, within the goal, sorted');
  const t = makeGoal({ kind: 'target', spec: { exercise: '  Push-ups ', sets: 3, reps: 12 } });
  assert.equal(t.endsOn, null);
  assert.equal(goalTitle(t), 'Reach 3×12 Push-ups');
  assert.equal(goalTitle(g), '3× a week for 4 weeks');
  assert.equal(goalTitle(makeGoal({ kind: 'target', spec: { exercise: 'Plank', sets: 3, durationSeconds: 60 } })), 'Reach 3×1 min Plank');
  const c = makeCheckin({ goalId: g.id, at: 'nonsense', result: { sets: 3, reps: -1, note: 'x'.repeat(500) } });
  assert.equal(c.result.reps, null);
  assert.equal(c.result.note.length, 300);
  assert.ok(!Number.isNaN(Date.parse(c.at)));
});

test('frequency progress: this week, the week strip, one count per day, neutral missed-week note', () => {
  const g = makeGoal({ id: 'g1', kind: 'frequency', spec: { perWeek: 3, weeks: 4 }, startsOn: '2026-10-05' });
  const cs = [
    makeCheckin({ goalId: 'g1', at: at('2026-10-05') }), makeCheckin({ goalId: 'g1', at: at('2026-10-05', 20) }), // same day: one session
    makeCheckin({ goalId: 'g1', at: at('2026-10-14') }),
    makeCheckin({ goalId: 'g1', at: at('2026-10-19') }), makeCheckin({ goalId: 'g1', at: at('2026-10-20') }),
    makeCheckin({ goalId: 'other', at: at('2026-10-20') }),
  ];
  const p = goalProgress(g, cs, now('2026-10-20'));
  assert.equal(p.status, 'active');
  assert.equal(p.weekNumber, 3);
  assert.deepEqual(p.strip.map((w) => w.count), [1, 1, 2, 0]);
  assert.equal(p.summary, '2 of 3 this week · week 3 of 4');
  assert.equal(p.lastWeekNote, '1 of 3 last week');
  assert.ok(Math.abs(p.ring - 2 / 3) < 1e-9);
  assert.equal(p.checkins.length, 5, 'only this goal’s check-ins');

  const done = goalProgress(g, cs, now('2026-11-02'));
  assert.equal(done.status, 'finished');
  assert.match(done.summary, /^Finished: 0 of 4 weeks/);
  assert.equal(done.lastWeekNote, '');

  const early = goalProgress(makeGoal({ id: 'g2', kind: 'frequency', spec: { perWeek: 2, weeks: 2 }, startsOn: '2026-10-25' }), [], now('2026-10-20'));
  assert.equal(early.started, false);
  assert.match(early.summary, /^Starts/);
});

test('a plan changes a week’s target and is shown as the next step', () => {
  const g = makeGoal({ id: 'g1', kind: 'frequency', spec: { perWeek: 3, weeks: 3 }, startsOn: '2026-10-05', plan: [{ week: 1, perWeek: 2, note: 'Ease in' }, { week: 2, perWeek: 3 }] });
  const p = goalProgress(g, [makeCheckin({ goalId: 'g1', at: at('2026-10-06') }), makeCheckin({ goalId: 'g1', at: at('2026-10-08') })], now('2026-10-09'));
  assert.equal(p.strip[0].target, 2);
  assert.equal(p.strip[0].met, true);
  assert.equal(p.next.note, 'Ease in');
});

test('target progress: best so far, reached on the first check-in that hits it', () => {
  const g = makeGoal({ id: 't', kind: 'target', spec: { exercise: 'Push-ups', sets: 3, reps: 12 }, startsOn: '2026-10-01' });
  const a = makeCheckin({ goalId: 't', at: at('2026-10-02'), result: { sets: 3, reps: 8 } });
  const b = makeCheckin({ goalId: 't', at: at('2026-10-06'), result: { sets: 3, reps: 10 } });
  let p = goalProgress(g, [a, b], now('2026-10-07'));
  assert.equal(p.status, 'active');
  assert.equal(p.best.id, b.id);
  assert.equal(p.summary, 'Best so far 3×10 · aiming for 3×12');
  assert.ok(Math.abs(p.ring - 30 / 36) < 1e-9);
  const c = makeCheckin({ goalId: 't', at: at('2026-10-09'), result: { sets: 3, reps: 12 } });
  p = goalProgress(g, [a, b, c], now('2026-10-10'));
  assert.equal(p.status, 'finished');
  assert.equal(p.reachedBy.id, c.id);
  assert.equal(p.ring, 1);
  assert.equal(resultText({ sets: 3, durationSeconds: 45 }), '3×45s');
  assert.equal(goalProgress(g, [], now('2026-10-10')).summary, 'No check-ins yet');
});
