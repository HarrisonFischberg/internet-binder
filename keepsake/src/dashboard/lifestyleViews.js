// The workout and recipe views: a workout's exercises and its goal with check-ins, and a recipe to cook
// along with. Moved out of dashboard.js as they were.

import * as UI from './ui.js';
import { formatMinutes } from '../shared/kinds.js';
import { formatSeconds, goalProgress, goalTitle, localDay, resultText } from '../shared/goals.js';
import { clear, el, hostnameOf, pluralize } from '../shared/util.js';
import { kindIcon } from '../shared/kindIcon.js';
import { suggestProgression } from '../ai/provider.js';
import { openableUrl } from '../shared/url.js';
import { stepIngredients } from '../shared/stepIngredients.js';

// dashboard.js's own state and helpers, handed over once at boot.
let D;
export function useLifestyleViews(deps) { D = deps; }

// The workout view: what to do (exercises with sets, reps or time, and rest) and its goal. Goals and
// check-ins save as you go; ending a goal or a check-in can be undone from the toast.
export async function openWorkout(id) {
  const item = await D.store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const d = item.details || {};
  const exercises = d.exercises || [];
  const aiReady = !!D.state.settings?.ai?.on && !!(await D.store.getSecret('aiApiKey').catch(() => ''));
  const sourceLabel = { page: 'Exercises from the page', caption: 'Exercises from the caption', you: 'Exercises added by you', ai: 'Exercises read by AI', 'ai-draft': 'Exercises drafted by AI: check them before you train' }[d.source] || '';
  const from = item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : item.retailer || item.host || '';
  const facts = [
    exercises.length ? ['Exercises', String(exercises.length)] : null,
    d.durationMinutes ? ['Time', formatMinutes(d.durationMinutes)] : null,
    d.focus ? ['Focus', d.focus] : null,
  ].filter(Boolean);
  const amount = (e) => (e.durationSeconds ? formatSeconds(e.durationSeconds) : e.reps ? `${e.reps}${e.repsMax ? `–${e.repsMax}` : ''} reps` : '—');
  const restText = (e) => (e.restSeconds ? (e.restMaxSeconds ? `${e.restSeconds}–${e.restMaxSeconds}s` : formatSeconds(e.restSeconds)) : '—');
  const table = el('table', { class: 'exercise-table' }, [
    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Exercise']), el('th', { scope: 'col' }, ['Sets']), el('th', { scope: 'col' }, ['Reps or time']), el('th', { scope: 'col' }, ['Rest'])])]),
    el('tbody', {}, exercises.map((e) => el('tr', {}, [
      el('th', { scope: 'row' }, [e.name, e.note ? el('span', { class: 'exercise-note' }, [e.note]) : null]), el('td', {}, [e.sets ? String(e.sets) : '—']), el('td', {}, [amount(e)]), el('td', {}, [restText(e)]),
    ]))),
  ]);
  const goalBox = el('div', { class: 'goal-stack' });
  const body = el('div', { class: 'recipe-view workout-view' }, [
    el('div', { class: `recipe-hero ${item.image ? '' : 'no-pic'}` }, [
      item.image ? UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'recipe-hero-pic' }) : null,
      el('div', { class: 'recipe-hero-text' }, [
        el('span', { class: 'badge kind-badge kind-workout' }, [kindIcon('workout'), 'Workout']),
        el('h2', { class: 'recipe-title' }, [item.title]),
        el('p', { class: 'recipe-from' }, [[from, sourceLabel].filter(Boolean).join(' · ')]),
        facts.length ? el('dl', { class: 'recipe-facts-grid' }, facts.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
        item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
        item.status === 'done' ? el('span', { class: 'badge' }, ['Finished']) : null,
      ]),
    ]),
    el('div', { class: 'recipe-columns workout-columns' }, [
      el('section', { class: 'recipe-col' }, [
        el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Exercises', isDrafted(d, 'exercises') ? draftTag() : null]), el('span', { class: 'recipe-count' }, [exercises.length ? pluralize(exercises.length, 'exercise', 'exercises') : ''])]),
        exercises.length ? el('div', { class: 'table-scroll' }, [table]) : el('div', { class: 'recipe-empty' }, [
          el('p', {}, ['Internet Binder couldn’t find exercises on this page. Add them yourself.']),
          el('p', { class: 'help' }, ['In Edit details, write one exercise per line, like “Squats 3×12” or “Plank 45s”.']),
        ]),
      ]),
      el('section', { class: 'recipe-col' }, [el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Goal'])]), goalBox]),
    ]),
  ]);

  async function renderGoals() {
    const goals = await D.store.getGoals({ itemId: item.id });
    const withProgress = await Promise.all(goals.map(async (g) => goalProgress(g, await D.store.getCheckins(g.id))));
    clear(goalBox);
    const active = withProgress.filter((p) => p.status === 'active');
    for (const p of [...active, ...withProgress.filter((x) => x.status !== 'active').reverse()]) goalBox.append(goalCard(p));
    if (!active.length) goalBox.append(newGoalForm(!withProgress.length));
  }

  function newGoalForm(first) {
    const box = el('div', { class: 'goal-new' });
    const closed = el('div', { class: 'goal-empty' }, [
      first ? el('p', {}, ['Turn this workout into a goal and check in each time you do it.']) : null,
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => { clear(box); box.append(form()); box.querySelector('select, input')?.focus(); } }, [first ? 'Make it a goal' : 'Start a new goal']),
    ]);
    box.append(closed);
    function form() {
      const pick = (value, label, checked) => el('label', { class: 'check' }, [el('input', { type: 'radio', name: `goal-kind-${item.id}`, value, checked: checked ? 'checked' : null, onChange: sync }), el('span', {}, [label])]);
      const perWeek = el('select', { class: 'select select-sm', 'aria-label': 'Times a week' }, [1, 2, 3, 4, 5, 6, 7].map((n) => el('option', { value: String(n), text: `${n}×`, selected: n === 3 ? 'selected' : null })));
      const weeks = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '52', value: '4', 'aria-label': 'Weeks' });
      const first = exercises[0] || {};
      const exercise = el('input', { class: 'input input-sm', list: `goal-ex-${item.id}`, maxlength: '80', value: first.name || '', 'aria-label': 'Exercise', placeholder: 'Push-ups' });
      const datalist = el('datalist', { id: `goal-ex-${item.id}` }, exercises.map((e) => el('option', { value: e.name })));
      const sets = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '20', value: String(first.sets || 3), 'aria-label': 'Sets' });
      const reps = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '500', value: first.durationSeconds ? '' : String((first.reps || 10) + 2), 'aria-label': 'Reps' });
      const secs = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '36000', value: first.durationSeconds ? String(first.durationSeconds + 15) : '', 'aria-label': 'Seconds', placeholder: 'or seconds' });
      const freqRow = el('div', { class: 'goal-row' }, [el('span', {}, ['Do it']), perWeek, el('span', {}, ['a week for']), weeks, el('span', {}, ['weeks'])]);
      const targetRow = el('div', { class: 'goal-row hidden' }, [el('span', {}, ['Reach']), sets, el('span', {}, ['×']), reps, secs, exercise, datalist]);
      const err = el('p', { class: 'help help-error', role: 'alert' });
      function sync() {
        const kind = f.querySelector('input[type=radio]:checked')?.value;
        freqRow.classList.toggle('hidden', kind !== 'frequency');
        targetRow.classList.toggle('hidden', kind !== 'target');
      }
      const f = el('form', { class: 'goal-form', onSubmit: async (e) => {
        e.preventDefault();
        const kind = f.querySelector('input[type=radio]:checked')?.value;
        const spec = kind === 'frequency' ? { perWeek: Number(perWeek.value), weeks: Number(weeks.value) } : { exercise: exercise.value.trim(), sets: Number(sets.value), reps: secs.value ? null : Number(reps.value), durationSeconds: Number(secs.value) || null };
        if (kind === 'frequency' && !(spec.weeks >= 1 && spec.weeks <= 52)) { err.textContent = 'Pick between 1 and 52 weeks.'; return; }
        if (kind === 'target' && (!spec.exercise || !(spec.reps || spec.durationSeconds))) { err.textContent = 'Name the exercise and give reps or seconds.'; return; }
        try {
          await D.store.createGoal({ itemId: item.id, kind, spec });
          await renderGoals();
        } catch (ex) {
          err.textContent = (ex && ex.message) || String(ex);
        }
      } }, [
        el('fieldset', { class: 'goal-kinds' }, [el('legend', { class: 'sr-only' }, ['Kind of goal']), pick('frequency', 'Do it regularly', true), pick('target', 'Reach a target', false)]),
        freqRow, targetRow, err,
        el('div', { class: 'review-actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ['Create goal']),
          el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { clear(box); box.append(closed); } }, ['Cancel']),
        ]),
      ]);
      return f;
    }
    return box;
  }

  function ring(fraction, label) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 44 44');
    svg.setAttribute('class', 'goal-ring');
    svg.setAttribute('aria-hidden', 'true');
    const c = (cls, dash) => {
      const n = document.createElementNS(NS, 'circle');
      n.setAttribute('cx', '22'); n.setAttribute('cy', '22'); n.setAttribute('r', '18'); n.setAttribute('class', cls);
      if (dash !== undefined) { n.setAttribute('stroke-dasharray', `${dash} 200`); n.setAttribute('transform', 'rotate(-90 22 22)'); }
      return n;
    };
    svg.append(c('goal-ring-track'), c('goal-ring-fill', (Math.max(0, Math.min(1, fraction)) * 2 * Math.PI * 18).toFixed(1)));
    return el('div', { class: 'goal-ring-wrap' }, [svg, el('span', { class: 'goal-ring-label' }, [label])]);
  }

  function goalCard(p) {
    const g = p.goal;
    const finished = p.status === 'finished';
    const card = el('article', { class: `goal-card ${finished ? 'is-finished' : ''}`, 'aria-label': `Goal: ${goalTitle(g)}` });
    const ringLabel = g.kind === 'frequency' ? (p.thisWeek ? `${p.thisWeek.count}/${p.thisWeek.target}` : `${p.weeksMet}/${g.spec.weeks}`) : finished ? '✓' : `${Math.round(p.ring * 100)}%`;
    card.append(el('div', { class: 'goal-top' }, [
      ring(p.ring, ringLabel),
      el('div', { class: 'goal-top-text' }, [
        el('h4', { class: 'goal-title' }, [goalTitle(g)]),
        el('p', { class: 'goal-summary' }, [p.summary]),
        p.lastWeekNote ? el('p', { class: 'goal-note' }, [p.lastWeekNote]) : null,
      ]),
      finished ? el('span', { class: 'badge badge-success' }, [g.kind === 'target' ? 'Reached' : 'Finished']) : null,
    ]));
    if (g.kind === 'frequency') {
      card.append(el('ol', { class: 'goal-strip', 'aria-label': 'Weeks' }, p.strip.map((w) => el('li', {
        class: `goal-week ${w.met ? 'is-met' : ''} ${w.current ? 'is-current' : ''} ${!w.past && !w.current ? 'is-future' : ''}`,
        title: `Week ${w.week}: ${w.count} of ${w.target}`,
      }, [el('span', { class: 'sr-only' }, [`Week ${w.week}: ${w.count} of ${w.target}${w.met ? ', done' : ''}`]), el('span', { 'aria-hidden': 'true' }, [w.met ? '✓' : String(w.count)])]))));
    }
    if (p.next) {
      const n = p.next;
      const what = [n.perWeek ? `${n.perWeek}× this week` : '', n.sets || n.reps || n.durationSeconds ? resultText(n) : '', n.note].filter(Boolean).join(' · ');
      card.append(el('p', { class: 'goal-plan-line' }, [el('strong', {}, [`Week ${n.week} plan: `]), what, g.planSource === 'ai-suggested' ? el('span', { class: 'goal-plan-src' }, [' (suggested by AI)']) : null]));
    }
    if (!finished) card.append(checkinArea(p));
    const recent = p.checkins.slice(-5).reverse();
    if (recent.length) {
      card.append(el('details', { class: 'goal-history' }, [
        el('summary', {}, [`Check-ins (${p.checkins.length})`]),
        el('ul', {}, recent.map((c) => el('li', {}, [
          el('span', { class: 'goal-history-date' }, [new Date(c.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })]),
          el('span', {}, [[resultText(c.result), c.result.note].filter(Boolean).join(' · ') || 'Done']),
        ]))),
      ]));
    }
    const actions = [];
    if (aiReady && !finished) {
      const suggestBtn = el('button', { type: 'button', class: 'btn btn-sm', onClick: () => suggest(p, card, suggestBtn) }, ['Suggest a progression']);
      actions.push(suggestBtn);
    }
    actions.push(el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: async () => {
      await D.store.deleteGoal(g.id);
      await renderGoals();
      UI.toast('Goal removed.', { action: { label: 'Undo', onClick: async () => { await D.store.restoreGoal(g.id); await renderGoals(); } } });
    } }, ['Remove goal']));
    card.append(el('div', { class: 'review-actions goal-actions' }, actions));
    return card;
  }

  function checkinArea(p) {
    const g = p.goal;
    const box = el('div', { class: 'goal-checkin' });
    const today = localDay();
    const doneToday = p.checkins.some((c) => localDay(new Date(c.at)) === today);
    const save = async (result) => {
      const c = await D.store.addCheckin(g.id, result);
      await renderGoals();
      UI.toast('Checked in.', { action: { label: 'Undo', onClick: async () => { await D.store.removeCheckin(c.id); await renderGoals(); } } });
    };
    const quick = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => save({}) }, [doneToday ? 'Check in again' : 'Done today']);
    const more = el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { clear(box); box.append(form()); box.querySelector('input')?.focus(); } }, ['Add sets and reps']);
    // A target goal is measured by what you did, so its check-in asks for the numbers first.
    if (g.kind === 'target') { box.append(form()); return box; }
    box.append(el('div', { class: 'review-actions' }, [quick, more]));
    return box;
    function form() {
      const plan = p.next || {};
      const s = g.spec;
      const sets = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '20', 'aria-label': 'Sets', placeholder: 'Sets', value: g.kind === 'target' ? String(plan.sets || s.sets || '') : '' });
      const reps = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '500', 'aria-label': 'Reps', placeholder: 'Reps' });
      const secs = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '36000', 'aria-label': 'Seconds', placeholder: 'Seconds' });
      const note = el('input', { class: 'input input-sm', maxlength: '300', 'aria-label': 'Note', placeholder: 'Note (optional)' });
      const timed = g.kind === 'target' && !!s.durationSeconds;
      const f = el('form', { class: 'goal-form', onSubmit: async (e) => {
        e.preventDefault();
        await save({ sets: Number(sets.value) || null, reps: Number(reps.value) || null, durationSeconds: Number(secs.value) || null, note: note.value.trim() });
      } }, [
        el('div', { class: 'goal-row' }, [sets, el('span', {}, ['×']), timed ? secs : reps, timed ? null : secs, g.kind === 'target' ? el('span', {}, [s.exercise]) : null]),
        note,
        el('div', { class: 'review-actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, [doneToday ? 'Check in again' : 'Check in']),
          g.kind === 'target' ? null : el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { clear(box); box.append(el('div', { class: 'review-actions' }, [quick, more])); } }, ['Cancel']),
        ]),
      ]);
      return f;
    }
  }

  async function suggest(p, card, btn) {
    btn.disabled = true;
    btn.textContent = 'Suggesting…';
    let out;
    try {
      out = await suggestProgression(item, p.goal, p, D.state.settings, await D.store.getSecret('aiApiKey'));
    } catch {
      btn.disabled = false;
      btn.textContent = 'Suggest a progression';
      UI.toast('Your AI provider didn’t answer. Nothing changed.', { kind: 'danger' });
      return;
    }
    btn.remove();
    const preview = el('div', { class: 'goal-suggestion', role: 'group', 'aria-label': 'Suggested progression' }, [
      el('p', { class: 'goal-suggestion-head' }, ['Suggested by your AI provider. Check it suits you before you follow it.']),
      el('ol', {}, out.plan.map((w) => el('li', {}, [el('strong', {}, [`Week ${w.week}: `]), [w.perWeek ? `${w.perWeek}×` : '', resultText(w), w.note].filter(Boolean).join(' · ')]))),
      out.note ? el('p', { class: 'help' }, [out.note]) : null,
      el('div', { class: 'review-actions' }, [
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: async () => {
          const before = { plan: p.goal.plan || [], planSource: p.goal.planSource || '' };
          const updated = await D.store.updateGoal(p.goal.id, { plan: out.plan, planSource: 'ai-suggested' });
          // Logged like every AI change, so the AI change log can undo it.
          await D.store.appendAiLog([{ id: crypto.randomUUID(), runId: `plan-${p.goal.id}`, at: new Date().toISOString(), itemId: item.id, goalId: p.goal.id, itemTitle: item.title,
            changes: [{ field: 'plan', from: before.plan.length ? `${before.plan.length}-week plan` : 'no plan', to: `${updated.plan.length}-week plan` }],
            before, after: { plan: updated.plan, planSource: 'ai-suggested' }, reason: 'Progression suggested on request', undone: false }]);
          await renderGoals();
          UI.toast('Plan added to the goal.', { action: { label: 'Undo', onClick: async () => { await D.store.updateGoal(p.goal.id, before); await renderGoals(); } } });
        } }, ['Accept']),
        el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { preview.remove(); renderGoals(); } }, ['Dismiss']),
      ]),
    ]);
    card.append(preview);
  }

  await renderGoals();
  const finishedItem = item.status === 'done';
  await UI.openModal({
    title: item.title,
    body,
    full: true,
    className: 'modal-recipe modal-workout',
    actions: [
      { label: 'Edit details', quiet: true, autofocus: true, closes: false, onClick: async (close) => { close(false); await D.openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      { label: finishedItem ? 'Finished ✓' : 'Mark finished', primary: !finishedItem, onClick: async () => {
        await D.store.updateItem(item.id, { status: finishedItem ? 'saved' : 'done' });
        UI.toast(finishedItem ? 'Marked as not finished.' : 'Marked as finished.', { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}

// "AI draft" next to what your AI provider wrote because the save didn't say it (details.drafted).
const isDrafted = (d, field) => Array.isArray(d?.drafted) && d.drafted.includes(field);
const draftTag = () => el('span', { class: 'badge badge-brass ai-draft-tag', title: 'Your AI provider wrote this because the post doesn’t say it. Check it before you use it.' }, ['AI draft']);

// The recipe view: a large dialog with the photo, what you need and what to do. Checking off
// ingredients and steps is just for cooking along (not saved). Editing lives in Edit details.
export async function openRecipe(id) {
  const item = await D.store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const d = item.details || {};
  const ingredients = d.ingredients || [];
  const steps = d.steps || [];
  const sourceLabel = { page: 'Recipe from the page', caption: 'Recipe from the caption', you: 'Recipe added by you', ai: 'Recipe read by AI', 'ai-draft': 'Drafted by AI: check it before you cook' }[d.source] || '';
  // A close recipe your AI provider found online because the post never wrote one down (understand.js readRecipe).
  const basedOn = d.basedOn?.url ? el('p', { class: 'recipe-based-on' }, [
    'Based on a recipe from ',
    el('a', { href: d.basedOn.url, target: '_blank', rel: 'noopener noreferrer' }, [d.basedOn.site || hostnameOf(d.basedOn.url)]),
    '. The post didn’t share its recipe, so AI found a close one; it may differ from the video.',
  ]) : null;
  const from = item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : item.retailer || item.host || '';
  const facts = [
    d.totalMinutes ? ['Time', formatMinutes(d.totalMinutes)] : null,
    d.prepMinutes && d.cookMinutes ? ['Prep · cook', `${formatMinutes(d.prepMinutes)} · ${formatMinutes(d.cookMinutes)}`] : null,
    d.yield ? (/^(makes|serves)\s+/i.test(d.yield) ? [d.yield.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase()), d.yield.replace(/^(makes|serves)\s+/i, '')] : ['Makes', d.yield]) : null,
    d.cuisine ? ['Cuisine', d.cuisine] : null,
    ingredients.length ? ['Ingredients', String(ingredients.length)] : null,
  ].filter(Boolean);

  // Each step lists the ingredients it uses (stepIngredients); a box checked there is checked in the
  // Ingredients list too, and the other way round.
  const plan = stepIngredients(steps, ingredients);
  const counter = el('span', { class: 'recipe-count' }, [ingredients.length ? `0 of ${ingredients.length}` : '']);
  const boxes = () => [...body.querySelectorAll('input[data-ing]')];
  const setChecked = (i, on) => {
    boxes().filter((b) => b.dataset.ing === String(i)).forEach((b) => { b.checked = on; });
    counter.textContent = `${new Set(boxes().filter((b) => b.checked).map((b) => b.dataset.ing)).size} of ${ingredients.length}`;
  };
  const box = (i, id) => el('input', { type: 'checkbox', id, 'data-ing': String(i), onChange: (e) => setChecked(i, e.target.checked) });
  const ingList = el('ul', { class: 'recipe-ingredients' });
  ingredients.forEach((x, i) => ingList.append(el('li', {}, [el('label', { class: 'check' }, [box(i, `rv-ing-${i}`), el('span', {}, [x])])])));
  const names = (c) => { const n = c.items.map((i) => plan.items[i].name).join(', '); return n.charAt(0).toUpperCase() + n.slice(1); };
  const marked = (text, i) => {
    const out = [];
    let at = 0;
    for (const r of plan.highlights(text, i)) { out.push(text.slice(at, r.start), el('mark', { class: 'step-mark' }, [text.slice(r.start, r.end)])); at = r.end; }
    out.push(text.slice(at));
    return out;
  };
  const stepList = el('ol', { class: 'recipe-steps recipe-steps-big' }, steps.map((x, i) => {
    const uses = [...(plan.steps[i]?.items || []), ...(i === 0 ? plan.unmatched : [])];
    const carried = plan.steps[i]?.carried || [];
    const need = uses.length || carried.length
      ? el('div', { class: 'step-ings', onClick: (e) => e.stopPropagation(), onKeydown: (e) => e.stopPropagation() }, [
        ...uses.map((k) => el('label', { class: 'step-ing' }, [
          box(k, `rv-step-${i}-ing-${k}`),
          plan.items[k].amount ? el('b', {}, [plan.items[k].amount]) : null,
          el('span', {}, [plan.items[k].name]),
        ])),
        ...carried.map((c) => el('span', { class: 'step-carry' }, [
          el('span', {}, [names(c)]), el('small', {}, [`From step ${c.fromStep + 1}`]),
        ])),
      ])
      : null;
    const li = el('li', { tabindex: '0', 'aria-label': `Step ${i + 1}: ${x}`, onClick: () => li.classList.toggle('is-done'), onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.classList.toggle('is-done'); }
    } }, [el('span', { class: 'step-n', 'aria-hidden': 'true' }, [String(i + 1)]), el('div', { class: 'step-body' }, [el('span', { class: 'step-text' }, marked(x, i)), need])]);
    return li;
  }));
  const empty = !ingredients.length && !steps.length;
  const body = el('div', { class: 'recipe-view' }, [
    el('div', { class: `recipe-hero ${item.image ? '' : 'no-pic'}` }, [
      item.image ? UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'recipe-hero-pic' }) : null,
      el('div', { class: 'recipe-hero-text' }, [
        el('span', { class: 'badge kind-badge kind-recipe' }, [kindIcon('recipe'), 'Recipe']),
        el('h2', { class: 'recipe-title' }, [item.title]),
        el('p', { class: 'recipe-from' }, [[from, d.author && d.author !== from ? `by ${d.author}` : '', sourceLabel].filter(Boolean).join(' · ')]),
        basedOn,
        facts.length ? el('dl', { class: 'recipe-facts-grid' }, facts.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
        item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
        item.status === 'done' ? el('span', { class: 'badge' }, ['Cooked']) : null,
      ]),
    ]),
    empty
      ? el('div', { class: 'recipe-empty' }, [
        el('p', {}, ['No ingredients or steps were found on the page or in the caption.']),
        el('p', { class: 'help' }, ['Add them yourself in Edit details, or, with Optional AI on, ask for a draft there.']),
      ])
      : el('div', { class: 'recipe-columns' }, [
        el('section', { class: 'recipe-col' }, [el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Ingredients', isDrafted(d, 'ingredients') ? draftTag() : null]), counter]), ingList]),
        el('section', { class: 'recipe-col' }, [el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Method', isDrafted(d, 'steps') ? draftTag() : null]), el('span', { class: 'recipe-count' }, [steps.length ? `${steps.length} steps · check off what you add, tap a step when it’s done` : ''])]), stepList]),
      ]),
  ]);
  const cooked = item.status === 'done';
  await UI.openModal({
    title: item.title,
    body,
    full: true,
    className: 'modal-recipe',
    actions: [
      { label: 'Edit details', quiet: true, autofocus: true, closes: false, onClick: async (close) => { close(false); await D.openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      { label: cooked ? 'Cooked ✓' : 'Mark cooked', primary: !cooked, onClick: async () => {
        await D.store.updateItem(item.id, { status: cooked ? 'saved' : 'done' });
        UI.toast(cooked ? 'Marked as not cooked yet.' : 'Marked as cooked.', { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}
