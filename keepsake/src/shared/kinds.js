// What a save is (its "kind") and the details that only make sense for that kind.
// Pure functions, no browser APIs: the same rules are meant to run on iOS/macOS later.
//
// kind: product | place | recipe | video | article | workout | media | book | link
// details (by kind):
//   recipe  { ingredients: [string], steps: [string], yield, totalMinutes, prepMinutes, cookMinutes,
//             cuisine, category, author, source: 'page' | 'caption' | 'you' | 'ai-draft' }

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

// --- details ------------------------------------------------------------------------------------

const RECIPE_SOURCES = ['page', 'caption', 'you', 'ai-draft'];

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
  if (t.some((x) => ['article', 'newsarticle', 'blogposting', 'reportagenewsarticle', 'techarticle'].includes(x))) return 'article';
  return null;
}
