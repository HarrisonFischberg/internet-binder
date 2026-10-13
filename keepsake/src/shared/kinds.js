// What a save is (its "kind") and the details that only make sense for that kind.
// Pure functions, no browser APIs: the same rules are meant to run on iOS/macOS later.
//
// kind: product | place | recipe | video | article | workout | media | book | link
// details (by kind):
//   recipe  { ingredients: [string], steps: [string], yield, totalMinutes, prepMinutes, cookMinutes,
//             cuisine, category, author, source: 'page' | 'caption' | 'you' | 'ai-draft' }
//   workout { exercises: [{ name, sets, reps, durationSeconds, restSeconds }], durationMinutes, focus,
//             source: 'page' | 'caption' | 'you' }   (goals and check-ins are their own records: goals.js)

import { sanitizeText, tidyImportedText } from './util.js';

export const KINDS = [
  { value: 'product', label: 'Product', plural: 'Products', done: 'Bought' },
  { value: 'place', label: 'Place', plural: 'Places', done: 'Been' },
  { value: 'recipe', label: 'Recipe', plural: 'Recipes', done: 'Cooked' },
  { value: 'video', label: 'Video', plural: 'Videos', done: 'Watched' },
  { value: 'article', label: 'Article', plural: 'Articles', done: 'Read' },
  { value: 'workout', label: 'Workout', plural: 'Workouts', done: 'Finished' },
  { value: 'media', label: 'Film or show', plural: 'Films & shows', done: 'Watched' },
  { value: 'book', label: 'Book', plural: 'Books', done: 'Read' },
  { value: 'link', label: 'Link', plural: 'Links', done: 'Done' },
];
const KIND_SET = new Set(KINDS.map((k) => k.value));
export const STATUSES = ['saved', 'todo', 'done'];

export const kindInfo = (kind) => KINDS.find((k) => k.value === kind) || KINDS[KINDS.length - 1];
export const isKind = (k) => KIND_SET.has(k);

// The kind of a save, for records written before kinds existed too.
export function kindOf(item) {
  if (item && isKind(item.kind)) return item.kind;
  if (item && (item.type === 'instagram' || item.instagram)) return 'link';
  if (item && item.type === 'inspiration') return 'link';
  return 'product';
}

// --- durations and numbers -------------------------------------------------------------------

// ISO 8601 durations ("PT1H30M", "P0DT45M") and plain text ("25 min", "1 hr 10 mins") -> minutes.
export function minutesFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 && value < 10000 ? Math.round(value) : null;
  const s = String(value).trim();
  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
    const m = (Number(iso[1] || 0) * 1440) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0) + Number(iso[4] || 0) / 60;
    return m > 0 && m < 10000 ? Math.round(m) : null;
  }
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const mi = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (h || mi) {
    const m = (h ? Number(h[1]) * 60 : 0) + (mi ? Number(mi[1]) : 0);
    return m > 0 && m < 10000 ? Math.round(m) : null;
  }
  return null;
}

export function formatMinutes(m) {
  if (!Number.isFinite(m) || m <= 0) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

const clean = (v, n = 300) => (typeof v === 'string' ? tidyImportedText(v, n) : sanitizeText(v == null ? '' : String(v), n));
const list = (v, n, each = 300) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => clean(x, each)).filter(Boolean).slice(0, n);
const nameOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.name || '' : '');

// --- recipes -----------------------------------------------------------------------------------

// schema.org Recipe JSON-LD (or the same fields from microdata) -> recipe details.
export function recipeFromSchema(r) {
  if (!r || typeof r !== 'object') return null;
  const steps = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 4 || steps.length >= 60) return;
    if (typeof node === 'string') {
      for (const part of node.split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/)) if (clean(part)) steps.push(clean(part, 600).replace(/^\d+[.)]\s*/, ''));
      return;
    }
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node === 'object') {
      if (node.itemListElement) return walk(node.itemListElement, depth + 1); // HowToSection
      const t = clean(node.text || node.name || '', 600);
      if (t) steps.push(t);
    }
  };
  walk(r.recipeInstructions);
  const ingredients = list(r.recipeIngredient || r.ingredients, 80, 200);
  const yieldValue = Array.isArray(r.recipeYield) ? r.recipeYield.find((y) => /\D/.test(String(y))) || r.recipeYield[0] : r.recipeYield;
  const out = {
    ingredients,
    steps: steps.slice(0, 60),
    yield: clean(yieldValue, 60),
    totalMinutes: minutesFrom(r.totalTime) ?? ((minutesFrom(r.prepTime) || 0) + (minutesFrom(r.cookTime) || 0) || null),
    prepMinutes: minutesFrom(r.prepTime),
    cookMinutes: minutesFrom(r.cookTime),
    cuisine: list(r.recipeCuisine, 3, 40).join(', '),
    category: list(r.recipeCategory, 3, 40).join(', '),
    author: clean(nameOf(Array.isArray(r.author) ? r.author[0] : r.author), 80),
    source: 'page',
  };
  return out.ingredients.length || out.steps.length ? out : null;
}

const INGREDIENT_HEAD = /^\s*(?:[#*•\-–\s]*)(?:ingredients?|what you(?:'|’)ll need|you(?:'|’)ll need|shopping list)\s*[:：]?\s*$/i;
const STEP_HEAD = /^\s*(?:[#*•\-–\s]*)(?:method|steps?|instructions?|directions?|how to make(?: it)?|preparation|to make)\s*[:：]?\s*$/i;
const QUANTITY = /^(?:\d+[\d\s/.,½¼¾⅓⅔-]*|a |an |one |two |three |half |pinch|handful|splash|dash)\s*(?:g|kg|ml|l|oz|lb|lbs|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|cans?|tins?|slices?|sticks?|bunch|pinch|handful|large|small|medium|x)?\b/i;

// Ingredients and steps written into a caption or description ("Ingredients:" … "Method:" …).
// Returns null unless it finds at least two ingredient lines, so ordinary captions are left alone.
export function recipeFromText(text) {
  const lines = String(text || '').replace(/\r/g, '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const ingredients = [];
  const steps = [];
  let mode = null;
  for (const raw of lines) {
    if (INGREDIENT_HEAD.test(raw)) { mode = 'ing'; continue; }
    if (STEP_HEAD.test(raw)) { mode = 'step'; continue; }
    const line = raw.replace(/^[•\-–*·▪︎◦✔️✅]+\s*/u, '').replace(/^\d+[.)]\s+/, (m) => (mode === 'step' ? '' : m)).trim();
    if (!line || /^#\w/.test(line)) continue;
    if (mode === 'ing') ingredients.push(clean(line, 200));
    else if (mode === 'step') steps.push(clean(line.replace(/^\d+[.)]\s*/, ''), 600));
  }
  // No headings: a run of quantity-led lines is an ingredient list.
  if (!ingredients.length) {
    const run = lines.filter((l) => QUANTITY.test(l.replace(/^[•\-–*·]+\s*/, '')) && l.length < 90);
    if (run.length >= 3) ingredients.push(...run.map((l) => clean(l.replace(/^[•\-–*·]+\s*/, ''), 200)));
  }
  if (ingredients.length < 2) return null;
  return { ingredients: ingredients.slice(0, 80), steps: steps.slice(0, 60), yield: '', totalMinutes: null, prepMinutes: null, cookMinutes: null, cuisine: '', category: '', author: '', source: 'caption' };
}

// --- workouts ----------------------------------------------------------------------------------

// Words that say a caption or page is about training. Exercise lines alone aren't enough
// ("2 x 400 g tins" is a recipe), so a workout needs one of these as well.
const WORKOUT_WORDS = /\b(?:work[- ]?outs?|exercises?|routine|hiit|wod|amrap|emom|tabata|circuit|reps|sets|leg day|arm day|push day|pull day|full[- ]body|upper body|lower body|core|abs|glutes|strength|training|warm[- ]?up|cool[- ]?down|calisthenics|mobility|stretch(?:es|ing)?|cardio)\b/i;
export const looksLikeWorkout = (text) => WORKOUT_WORDS.test(String(text || ''));

const SECONDS = /^(\d{1,4})\s*(s|sec|secs|seconds?|m|min|mins|minutes?)$/i;
const toSeconds = (n, unit) => (/^m/i.test(unit) ? Number(n) * 60 : Number(n));
const X = '\\s*[x×*]\\s*';
const TIME = '(\\d{1,4})\\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\\b';
const NAME = "([A-Za-z][A-Za-z0-9'’()/&+ .-]{1,60}?)";
// Ordered: the first pattern that matches a line wins.
const EXERCISE_PATTERNS = [
  // Squats 3x12 · Squats: 3 x 12 reps · Plank 3 x 45s · Push-ups — 4 sets of 10
  [new RegExp(`^${NAME}\\s*[:\\-–—]?\\s*(\\d{1,2})${X}${TIME}`, 'i'), (m) => ({ name: m[1], sets: m[2], durationSeconds: toSeconds(m[3], m[4]) })],
  [new RegExp(`^${NAME}\\s*[:\\-–—]?\\s*(\\d{1,2})${X}(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?(?:\\s*(?:reps?|repetitions?))?\\b`, 'i'), (m) => ({ name: m[1], sets: m[2], reps: m[3], repsMax: m[4] })],
  [new RegExp(`^${NAME}\\s*[:\\-–—]?\\s*(\\d{1,2})\\s*sets?\\s*(?:of|x|×)?\\s*${TIME}`, 'i'), (m) => ({ name: m[1], sets: m[2], durationSeconds: toSeconds(m[3], m[4]) })],
  [new RegExp(`^${NAME}\\s*[:\\-–—]?\\s*(\\d{1,2})\\s*sets?\\s*(?:of|x|×)?\\s*(\\d{1,3})(?:\\s*(?:reps?|repetitions?))?\\b`, 'i'), (m) => ({ name: m[1], sets: m[2], reps: m[3] })],
  // 3x12 squats · 3 x 45s plank · 4 sets of 10 push-ups · 3 sets x 12 reps lunges
  [new RegExp(`^(\\d{1,2})${X}${TIME}\\s+(?:of\\s+)?${NAME}$`, 'i'), (m) => ({ name: m[4], sets: m[1], durationSeconds: toSeconds(m[2], m[3]) })],
  [new RegExp(`^(\\d{1,2})${X}(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?(?:\\s*(?:reps?|repetitions?))?\\s+(?:of\\s+)?${NAME}$`, 'i'), (m) => ({ name: m[4], sets: m[1], reps: m[2], repsMax: m[3] })],
  [new RegExp(`^(\\d{1,2})\\s*sets?\\s*(?:of|x|×)?\\s*(\\d{1,3})(?:\\s*(?:reps?|repetitions?))?\\s+(?:of\\s+)?${NAME}$`, 'i'), (m) => ({ name: m[3], sets: m[1], reps: m[2] })],
  // Plank - 60 sec · Wall sit: 1 min · 45s jumping jacks
  [new RegExp(`^${NAME}\\s*[:\\-–—]?\\s*${TIME}$`, 'i'), (m) => ({ name: m[1], durationSeconds: toSeconds(m[2], m[3]) })],
  [new RegExp(`^${TIME}\\s+(?:of\\s+)?${NAME}$`, 'i'), (m) => ({ name: m[3], durationSeconds: toSeconds(m[1], m[2]) })],
  // 10 burpees · 20 jumping jacks · Lunges x 12 · Lunges: 12 reps
  [new RegExp(`^(\\d{1,3})\\s+(?:reps?\\s+(?:of\\s+)?)?${NAME}$`, 'i'), (m) => ({ name: m[2], reps: m[1] })],
  [new RegExp(`^${NAME}\\s*(?:[:\\-–—]|[x×])\\s*(\\d{1,3})(?:\\s*(?:reps?|repetitions?))?$`, 'i'), (m) => ({ name: m[1], reps: m[2] })],
];
const INSTRUCTION = /^(?:attempt|try|do|don['’]?t|repeat|perform|complete|aim|hold|start|begin|keep|then|now|you|your|this|that|it|we|i|raise|lower|lift|go|make|take|add|rest|work|build|control|focus|squeeze|brace|breathe|use|stay|maintain|engage|remember|avoid|follow|save|comment|tag|share|link|check)\b/i;
// The workout itself, not one of its exercises ("20 min full body HIIT workout").
const WHOLE_WORKOUT = /\b(?:work[- ]?outs?|routine|session|program(?:me)?|plan|challenge|class|training|circuit|day)\b/i;
const NOT_EXERCISE = /^(?:rest|round|rounds|sets?|reps?|total|repeat|minutes?|mins?|seconds?|week|day|calories|kcal|g|kg|ml|cups?|tbsp|tsp)\b/i;

function cleanExercise(e, { bare = false } = {}) {
  const name = clean(String(e.name || '').replace(/\s*[:\-–—]\s*$/, ''), 60);
  if (!name || name.length < 3 || NOT_EXERCISE.test(name) || !/[a-z]{3}/i.test(name)) return null;
  // A sentence or an instruction ("Attempt 3 sets…", "This can also be done sitting. Repeat 5 times"), not a name.
  if (name.split(/\s+/).length > 6 || /[.!?;]/.test(name) || INSTRUCTION.test(name) || WHOLE_WORKOUT.test(name)) return null;
  // Part of a sentence ("Warm up for 5 minutes", "Hold it in 30s"), not an exercise name.
  if (/\b(?:for|of|to|with|in|on|at|about|and|or|the|a|an|every|each|per|than|then|until|from|is|are|be|it)$/i.test(name)) return null;
  const n = (v, max) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= max ? Math.round(Number(v)) : null);
  const out = { name: name.replace(/^./, (c) => c.toUpperCase()), sets: n(e.sets, 20), reps: n(e.reps, 500), durationSeconds: n(e.durationSeconds, 36000), restSeconds: n(e.restSeconds, 3600) };
  if (out.durationSeconds) out.reps = null;
  // Ranges stay as written ("8–12 reps", "40–90 sec rest"); the lower number is the one goals use.
  const repsMax = out.reps ? n(e.repsMax, 500) : null;
  if (repsMax && repsMax > out.reps) out.repsMax = repsMax;
  const restMax = out.restSeconds ? n(e.restMaxSeconds, 3600) : null;
  if (restMax && restMax > out.restSeconds) out.restMaxSeconds = restMax;
  // What the creator put in brackets after the name: muscles worked, or a variation.
  const note = clean(e.note, 60);
  if (note) out.note = note;
  // A name with no numbers is only kept where the numbers are given elsewhere ("3 sets, 8–12 reps
  // per exercise") or by the person.
  return bare || out.sets || out.reps || out.durationSeconds ? out : null;
}

// "Upright rows (shoulders, traps)" -> the line without the brackets, and what was in them.
function splitNote(line) {
  const m = line.match(/\s*\(([^()]{2,60})\)/);
  return m ? { text: `${line.slice(0, m.index)} ${line.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(), note: m[1].trim() } : { text: line, note: '' };
}

// Just an exercise's name ("KB Gravedigger", "1. Pull-ups"), for lists that give the numbers once for all.
export function exerciseName(line) {
  const { text: l, note } = splitNote(String(line || '').replace(/^[\s•\-–*·▪︎◦✔️✅👉🔥💪➡️🔹🔸]+/u, '').replace(/^\d{1,2}[.)]\s+/, '').replace(/\s+/g, ' ').trim());
  if (!l || l.length > 50 || /\d/.test(l) || /[:#@]|https?:/i.test(l)) return null;
  return cleanExercise({ name: l, note }, { bare: true });
}

// One line as written by a person ("Squats 3×12", "Plank 3 x 45s", "10 burpees") -> an exercise, or null.
export function parseExerciseLine(line) {
  const l = String(line || '').replace(/^[\s•\-–*·▪︎◦✔️✅👉🔥💪]+/u, '').replace(/^\d{1,2}[.)]\s+/, '').replace(/\s+/g, ' ').trim()
    // "each leg", "per side", "/side": kept out of the name and the numbers.
    .replace(/\s*(?:\(?\s*(?:each|per)\s+(?:side|leg|arm)s?\s*\)?|\/\s*(?:side|leg|arm))\s*$/i, '');
  if (!l || l.length > 120) return null;
  const { text, note } = splitNote(l);
  for (const [re, build] of EXERCISE_PATTERNS) {
    const m = text.match(re);
    if (m) return cleanExercise({ ...build(m), note });
  }
  return null;
}

export function formatExercise(e) {
  const t = e.durationSeconds ? (e.durationSeconds % 60 === 0 && e.durationSeconds >= 60 ? `${e.durationSeconds / 60} min` : `${e.durationSeconds}s`) : e.reps ? `${e.reps}${e.repsMax ? `–${e.repsMax}` : ''}` : '';
  return [e.note ? `${e.name} (${e.note})` : e.name, e.sets && t ? `${e.sets}×${t}` : t, e.restSeconds ? `rest ${e.restSeconds}${e.restMaxSeconds ? `–${e.restMaxSeconds}` : ''}s` : ''].filter(Boolean).join(' ');
}

// How much, from a sentence: "3 sets of 5 to 10 repetitions", "Repeat 5 times", "hold for up to 5 seconds".
// The lower number of a range is the starting point.
function amountIn(line) {
  const l = String(line);
  let m = l.match(/\b(\d{1,2})\s*sets?\s*(?:of\s*)?(\d{1,3})(?:\s*(?:to|-|–)\s*\d{1,3})?\s*(?:reps?|repetitions?|times|curls|\b)/i);
  if (m) return { sets: m[1], reps: m[2] };
  m = l.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,3})\b/i);
  if (m) return { sets: m[1], reps: m[2] };
  m = l.match(/\b(?:hold|for)\b[^.]{0,30}?\b(?:up to\s*)?(\d{1,4})\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b/i);
  if (m) return { durationSeconds: toSeconds(m[1], m[2]) };
  m = l.match(/\b(?:repeat|do)\b[^.]{0,20}?\b(\d{1,3})\s*times\b/i) || l.match(/\b(\d{1,3})(?:\s*(?:to|-|–)\s*\d{1,3})?\s*(?:reps?|repetitions?)\b/i) || l.match(/\b(\d{1,3})\s*times\b/i);
  if (m) return { reps: m[1] };
  return null;
}

// Exercises written in a caption or a page's lists. Needs two or more exercise lines; "4 rounds"
// sets the sets for exercises that don't give their own, and "Rest 60s" applies to the line above
// (or to all of them when it comes first).
// Captions often reach Keepsake as one long line (page metadata drops the line breaks). Put them back
// before numbered items ("… Exercises: 1. Row 2. Press"), check-mark bullets and "Exercises:"-style headings.
function unflatten(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (t.split('\n').filter((l) => l.trim()).length >= 3) return t;
  return t
    .replace(/\s+(?=\d{1,2}[.)]\s+\p{L})/gu, '\n')
    .replace(/\s*(?=[✅✔️☑️•👉➡️🔹🔸▪️]\s*)/gu, '\n')
    // Sentences, and a bracket closing a bullet before the next sentence starts ("(shoulders) Try these…").
    .replace(/(?<=[.!?)])\s+(?=[\p{Lu}\d])/gu, '\n')
    .replace(/\s*\b((?:exercises?|the moves|movements?|workout|(?:try|do|perform|run|train)\s+(?:it|this|them)\s+like\s+this|how to(?: do it)?|format|programming|instructions?|sets?\s*(?:&|and)\s*reps?)\s*:)\s*/gi, '\n$1\n');
}

export function workoutFromText(text, { source = 'caption' } = {}) {
  const lines = unflatten(text).split(/\n+|\s+[|•]\s+/).map((l) => l.trim()).filter(Boolean);
  const exercises = [];
  let rounds = null;
  let restAll = null;
  let repsAll = null;
  let secondsAll = null;
  let heading = null;
  // Names with no numbers: numbered items, or anything listed under an "Exercises:" heading.
  const names = [];
  let inList = false;
  let listed = false;
  // Under a heading like "Try it like this:", bullets are tips, not exercises.
  let otherSection = false;
  for (const original of lines.slice(0, 200)) {
    // A list item: numbered, or a check mark / bullet in front.
    const bullet = /^\s*(?:\d{1,2}[.)]\s|[✅✔☑•👉➡🔹🔸▪◦])/u.test(original);
    // Hashtags and emoji say nothing about the exercise ("4 total rounds 💪🏼 #legday").
    const raw = original.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu, ' ')
      .replace(/^["“”]+|["“”]+[.!]*$/g, '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    if (/^[^\w]*(?:exercises?|the moves|movements?|workout)\s*:?\s*$/i.test(raw)) { inList = true; listed = true; otherSection = false; continue; }
    // Prose under a page heading that names the exercise: "Repeat 10 times." is that exercise's reps, not rounds.
    if (heading && !heading.used && !parseExerciseLine(raw)) {
      const a = amountIn(raw);
      const he = a ? cleanExercise({ name: heading.name, ...a }) : null;
      if (he) {
        heading.used = true;
        if (!exercises.some((x) => x.name.toLowerCase() === he.name.toLowerCase())) exercises.push(he);
        continue;
      }
    }
    // "4 rounds", "4 total rounds", "Repeat for 3 rounds.", "Rounds: 4"
    const r = raw.match(/^(?:[^\w]*)(?:repeat\s+(?:for\s+|it\s+|this\s+)?)?(?:x\s*)?(\d{1,2})\s*(?:total\s+)?(?:rounds?|sets?|times|circuits?)\b(?:\s*(?:total|in total|of|:))?[.!]*\s*$/i) || raw.match(/^(?:[^\w]*)(?:rounds?|sets?)\s*[:x×]?\s*(\d{1,2})[.!]*\s*$/i);
    if (r) { rounds = Number(r[1]); inList = false; continue; }
    // "8–12 reps per exercise", "30 sec each": the same numbers for every exercise (lower end of a range).
    const each = raw.match(/^[^\w]*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(reps?|repetitions?|s|sec|secs|seconds?)\b(?:\s*(?:per|each|for each|on each|of each)\s*(?:exercise|move(?:ment)?|side|round)?)?[.!]*\s*$/i);
    if (each) { if (/^r/i.test(each[3])) repsAll = { reps: Number(each[1]), repsMax: Number(each[2]) || null }; else secondsAll = Number(each[1]); inList = false; continue; }
    // "Rest 60s", "Rest: 40–90 sec", "40–90 sec rest"
    const rest = raw.match(/^(?:[^\w]*)rest\s*[:\-–]?\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b/i)
      || raw.match(/^[^\w]*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\s*(?:of\s*)?rest\b/i);
    if (rest) {
      inList = false;
      const r2 = { restSeconds: toSeconds(rest[1], rest[3]), restMaxSeconds: rest[2] ? toSeconds(rest[2], rest[3]) : null };
      if (exercises.length) Object.assign(exercises[exercises.length - 1], r2);
      else restAll = r2;
      continue;
    }
    if (raw.startsWith('## ')) { heading = { name: raw.slice(3), used: false }; continue; }
    // Any other heading ("Try it like this:") ends a list of names.
    if (/:\s*$/.test(raw) && !parseExerciseLine(raw)) {
      inList = false;
      if (/^[^\w]*(?:(?:try|do|perform|run|train)\s+(?:it|this|them)\s+like\s+this|how to(?: do it)?|format|programming|instructions?|tips?|notes?|cues?|sets?\s*(?:&|and)\s*reps?)\s*:\s*$/i.test(raw)) otherSection = true;
      continue;
    }
    let e = parseExerciseLine(raw);
    if (!e && heading && !heading.used) {
      // Prose under a heading that names the exercise: "Attempt 3 sets of 5 to 10 repetitions."
      const a = amountIn(raw);
      if (a) e = cleanExercise({ name: heading.name, ...a });
    }
    if (e && heading && e.name.toLowerCase() === heading.name.toLowerCase()) heading.used = true;
    if (e && !exercises.some((x) => x.name.toLowerCase() === e.name.toLowerCase())) exercises.push(e);
    else if (!e && (inList || (bullet && !otherSection))) {
      const n = exerciseName(raw);
      if (n && !names.some((x) => x.name.toLowerCase() === n.name.toLowerCase())) names.push(n);
    }
    if (exercises.length >= 40) break;
  }
  // A named list with the numbers given once for all ("3 sets · 8–12 reps per exercise"), or under an
  // "Exercises:" heading, is the workout when the lines themselves had no numbers.
  if (exercises.length < 2 && names.length >= 2 && (listed || rounds || repsAll || secondsAll)) exercises.splice(0, exercises.length, ...names.slice(0, 40));
  if (exercises.length < 2) return null;
  for (const e of exercises) {
    if (!e.sets && rounds) e.sets = rounds;
    if (!e.reps && !e.durationSeconds) {
      if (repsAll) Object.assign(e, repsAll);
      else if (secondsAll) e.durationSeconds = secondsAll;
    }
    if (!e.restSeconds && restAll) Object.assign(e, restAll);
  }
  // Ranges are checked once more (a range only makes sense above its lower number).
  for (let i = 0; i < exercises.length; i++) exercises[i] = cleanExercise(exercises[i], { bare: true });
  const mins = String(text).match(/\b(\d{1,3})[- ]?(?:min(?:ute)?s?)\b(?=[^\n]{0,20}\b(?:work[- ]?out|hiit|session|routine|circuit|class)\b)/i);
  return { exercises, durationMinutes: mins ? Number(mins[1]) : null, focus: '', source };
}

// --- details ------------------------------------------------------------------------------------

const RECIPE_SOURCES = ['page', 'caption', 'you', 'ai-draft'];
const WORKOUT_SOURCES = ['page', 'caption', 'you'];

export function sanitizeDetails(kind, details) {
  if (!details || typeof details !== 'object') return {};
  if (kind === 'recipe') {
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < 10000 ? Math.round(Number(v)) : null);
    return {
      ingredients: list(details.ingredients, 80, 200),
      steps: list(details.steps, 60, 600),
      yield: clean(details.yield, 60),
      totalMinutes: num(details.totalMinutes),
      prepMinutes: num(details.prepMinutes),
      cookMinutes: num(details.cookMinutes),
      cuisine: clean(details.cuisine, 80),
      category: clean(details.category, 80),
      author: clean(details.author, 80),
      source: RECIPE_SOURCES.includes(details.source) ? details.source : 'you',
    };
  }
  if (kind === 'workout') {
    const exercises = (Array.isArray(details.exercises) ? details.exercises : []).slice(0, 40).map((e) => (e && typeof e === 'object' ? cleanExercise(e, { bare: true }) : null)).filter(Boolean);
    const mins = Number(details.durationMinutes);
    return {
      exercises,
      durationMinutes: Number.isFinite(mins) && mins > 0 && mins < 1440 ? Math.round(mins) : null,
      focus: clean(details.focus, 60),
      source: WORKOUT_SOURCES.includes(details.source) ? details.source : 'you',
    };
  }
  // Other kinds keep a small, flat set of strings and numbers until their own fields land.
  const out = {};
  for (const [k, v] of Object.entries(details).slice(0, 20)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = clean(v, 300);
  }
  return out;
}

// The one fact that matters most for a save of this kind, for cards and the capture card.
export function keyFact(item, { formatPrice } = {}) {
  const kind = kindOf(item);
  const d = item?.details || {};
  if (kind === 'recipe') {
    const parts = [];
    if (d.ingredients?.length) parts.push(`${d.ingredients.length} ingredient${d.ingredients.length === 1 ? '' : 's'}`);
    if (d.totalMinutes) parts.push(formatMinutes(d.totalMinutes));
    return parts.join(' · ');
  }
  if (kind === 'workout') {
    const parts = [];
    if (d.exercises?.length) parts.push(`${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}`);
    if (d.durationMinutes) parts.push(formatMinutes(d.durationMinutes));
    if (d.focus) parts.push(d.focus);
    return parts.join(' · ');
  }
  if (kind === 'product' && formatPrice) return formatPrice(item.price, item.currency) || '';
  return '';
}

// What the page says this is, from the structured-data types the extractor found.
export function kindFromSchemaTypes(types) {
  const t = (types || []).map((x) => String(x).toLowerCase());
  if (t.some((x) => x === 'recipe')) return 'recipe';
  if (t.some((x) => ['product', 'productgroup', 'individualproduct', 'productmodel'].includes(x))) return 'product';
  if (t.some((x) => ['restaurant', 'foodestablishment', 'cafeorcoffeeshop', 'bakery', 'barorpub', 'localbusiness', 'touristattraction', 'museum', 'park', 'lodgingbusiness', 'hotel'].includes(x))) return 'place';
  if (t.some((x) => ['videoobject', 'movie', 'tvseries', 'tvepisode'].includes(x))) return t.some((x) => ['movie', 'tvseries'].includes(x)) ? 'media' : 'video';
  if (t.some((x) => x === 'book')) return 'book';
  if (t.some((x) => ['exerciseplan', 'physicalactivity', 'exerciseaction'].includes(x))) return 'workout';
  if (t.some((x) => ['article', 'newsarticle', 'blogposting', 'reportagenewsarticle', 'techarticle'].includes(x))) return 'article';
  return null;
}
