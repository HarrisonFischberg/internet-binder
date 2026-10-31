// What a save is (its "kind") and the details that only make sense for that kind.
// Pure functions, no browser APIs: the same rules are meant to run on iOS/macOS later.
//
// kind: product | place | recipe | video | article | workout | media | book | link
// details (by kind):
//   recipe  { ingredients: [string], steps: [string], yield, totalMinutes, prepMinutes, cookMinutes,
//             cuisine, category, author, source: 'page' | 'caption' | 'you' | 'ai' | 'ai-draft' | 'web', drafted?: [field],
//             basedOn?: { url, site, title } }   ('web': a close recipe your AI provider found online, from basedOn)
//   workout { exercises: [{ name, sets, reps, durationSeconds, restSeconds }], durationMinutes, focus,
//             source: 'page' | 'caption' | 'you' | 'ai' | 'ai-draft', drafted?: [field] }   (goals and check-ins: goals.js)
//   place   { address, locality, region, postalCode, country, lat, lng, phone, cuisine, priceRange, hours: [string],
//             category, source: 'page' | 'maps-link' | 'you' | 'ai' }
//   drafted: the fields your AI provider wrote because the save didn't say (shown as "AI draft").
//   video   { durationSeconds, channel, platform, publishedOn: 'YYYY-MM-DD', source: 'page' | 'you' }
//   article { author, siteName, publishedOn: 'YYYY-MM-DD', wordCount, readingMinutes, source: 'page' | 'you' }
//   media   { format: 'film' | 'series', year, director, runtimeMinutes, seasons, genres: [string], source: 'page' | 'you' }
//   book    { author, year, pages, isbn, genres: [string], source: 'page' | 'you' }

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

// Kinds with their own view (Recipes, Videos, Places…) are found there; they never need a collection.
// Products and plain links are sorted into collections, and wait in Review until they are.
export const hasOwnView = (kind) => kind !== 'product' && kind !== 'link';
export const needsCollection = (item) => !item.collectionId && !hasOwnView(kindOf(item));

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

const INGREDIENT_HEAD = /^\s*(?:[#*•\-–\s]*)(?:ingredients?|what you(?:'|’)ll need|you(?:'|’)ll need|shopping list|ingredientes|ingrédients|zutaten|ingredienti|材料|재료|सामग्री)\s*[:：]?\s*$/iu;
const STEP_HEAD = /^\s*(?:[#*•\-–\s]*)(?:method|steps?|instructions?|directions?|how to make(?: it)?|preparation|to make|preparación|elaboración|préparation|zubereitung|modo de preparo|preparazione|作り方|만드는 법|विधि)\s*[:：]?\s*$/iu;
// "鶏もも肉 150g", "卵 2個", "めんつゆ 大さじ3": Japanese and Korean put the amount after the food.
const TRAILING_QUANTITY = /\S\s+(?:\d+[\d/.]*\s*(?:g|kg|ml|個|本|枚|片|cc|개|g)|(?:大さじ|小さじ|큰술|작은술|カップ|컵)\s*\d+[\d/.]*)\s*$/u;
const QUANTITY = /^(?:\d+[\d\s/.,½¼¾⅓⅔-]*|a |an |one |two |three |half |pinch|handful|splash|dash)\s*(?:g|kg|ml|l|oz|lb|lbs|T|t|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|cans?|tins?|slices?|sticks?|bunch|pinch|handful|large|small|medium|x)?\b/i;

// A cooking measure, or a word for something people eat or drink (singular stems; plurals match too).
const FOOD = /(?:^|[^\p{L}])(?:\d+\s*(?:g|kg|mg|ml|l|oz|lb|lbs)\b|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|pinch|handful|dash|splash|sprigs?|slices?|\d+\s*(?:cans?|tins?)|bunch|scoops?|sticks? of|grams?|ounces?|pounds?|litres?|liters?|egg|flour|sugar|butter|oil|salt|pepper|garlic|onion|milk|cream|cheese|parmesan|rice|pasta|spaghetti|noodle|bread|chicken|beef|pork|fish|salmon|tuna|shrimp|prawn|tofu|bean|lentil|chickpea|tomato|potato|carrot|spinach|broccoli|kale|lettuce|pepper|chili|chilli|lemon|lime|apple|banana|berry|berries|strawberry|strawberries|blueberry|blueberries|avocado|mushroom|corn|oat|honey|syrup|vinegar|soy sauce|sauce|broth|yogurt|yoghurt|vanilla|cinnamon|cumin|paprika|ginger|basil|parsley|cilantro|coriander|thyme|rosemary|oregano|nut|almond|peanut|walnut|chocolate|cocoa|coffee|tea|water|wine|juice|protein powder|powder|seed|herb|spice|meat|sausage|bacon|ham|zucchini|courgette|cucumber|pumpkin|squash|coconut|mango|pineapple|orange|grape|peach|pear|cabbage|celery|leek|shallot|scallion|olive|caper|anchovy|anchovies|mayo|mustard|ketchup|dough|yeast|baking (?:soda|powder)|cornstarch|gelatin|tortilla|bun|quinoa|couscous|feta|mozzarella|cheddar|ricotta|mascarpone|matcha|ice)(?:e?s)?(?![\p{L}])/iu;

// The same in other languages people save recipes in (es, fr, de, pt, it), and Japanese, Korean and
// Hindi measures and staples, which have no spaces around them so they match anywhere in a line.
const FOOD_INTL = /(?:^|[^\p{L}])(?:cucharadas?|cucharaditas?|tazas?|cuillères?|c\. à (?:soupe|café)|esslöffel|teelöffel|el|tl|xícaras?|colher(?:es)?|cucchia(?:i|io|ini)|huevos?|patatas?|papas|cebollas?|ajos?|aceite|harina|azúcar|leche|queso|pollo|arroz|tomates?|œufs?|oeufs?|beurre|sucre|farine|lait|fromage|poulet|eier|mehl|zucker|milch|käse|hähnchen|kartoffeln|zwiebeln?|ovos?|leite|queijo|polvilho|frango|feijão|cebola|uova|tuorli|farina|zucchero|latte|formaggio|guanciale|pecorino|pomodori)(?![\p{L}])|大さじ|小さじ|卵|鶏|豚|玉ねぎ|醤油|味噌|めんつゆ|큰술|작은술|두부|돼지고기|김치|고춧가루|간장|कप|दाल|प्याज|टमाटर|घी|जीरा/iu;

const NOT_FOOD = /\b(?:reps?|rounds?|sets?|seconds?|secs?|minutes?|mins?|kettlebells?|dumbbells?|barbells?|times|days?|weeks?)\b/i;

// An "Ingredients" heading: the caption really is a recipe, whatever else it lists.
export const hasIngredientHeading = (text) => String(text || '').split(/\n+/).some((l) => INGREDIENT_HEAD.test(l.trim()));

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
    // Instagram spacer lines (".", "…", "⬇️") hold no words or numbers.
    if (!line || /^#\w/.test(line) || !/[\p{L}\p{N}]/u.test(line)) continue;
    if (mode === 'ing') ingredients.push(clean(line, 200));
    else if (mode === 'step') steps.push(clean(line.replace(/^\d+[.)]\s*/, ''), 600));
  }
  // No headings: a run of quantity-led lines is an ingredient list.
  if (!ingredients.length) {
    // "60 seconds non-stop", "1 kettlebell", "10 reps" are a workout's numbers, not ingredients; "1. Rewrite
    // emails" is a numbered list, not one of something.
    const run = lines.filter((l) => (QUANTITY.test(l.replace(/^[•\-–*·]+\s*/, '')) || TRAILING_QUANTITY.test(l)) && !/^\d{1,2}[.)]\s/.test(l) && l.length < 90 && !NOT_FOOD.test(l));
    if (run.length >= 3) ingredients.push(...run.map((l) => clean(l.replace(/^[•\-–*·]+\s*/, ''), 200)));
  }
  if (ingredients.length < 2) return null;
  // Something to eat: at least one line with a cooking measure or a food. "Ingredients: an LLM API key,
  // a vector database, 3 tools" is a recipe for software.
  if (!ingredients.some((l) => FOOD.test(l) || FOOD_INTL.test(l))) return null;
  return { ingredients: ingredients.slice(0, 80), steps: steps.slice(0, 60), yield: '', totalMinutes: null, prepMinutes: null, cookMinutes: null, cuisine: '', category: '', author: '', source: 'caption' };
}

// Something to eat is named (a food or a cooking measure), anywhere in the text.
export const mentionsFood = (text) => (FOOD.test(String(text || '')) || FOOD_INTL.test(String(text || ''))) && !/\b(?:ai|llm|gpt|claude|chatgpt|agent|prompt|api|code|coding|software|app)\b[^.\n]{0,40}\brecipe\b|\brecipe\b[^.\n]{0,40}\b(?:ai|llm|agent|prompt|api|code|coding|software|app|success|disaster)\b/i.test(String(text || '')) || recipeFromText(text) !== null;

// A recipe post whose recipe isn't in the caption ("Comment RECIPE and I'll send it", "full recipe on my
// blog"): it says recipe, or two cooking words, and names something to eat. A Recipe with no ingredients
// (nothing made up), like a workout whose routine is only in the video.
const RECIPE_WORD = /(?:^|[^\p{L}])#?(?:recipes?|full recipe|recetas?|recettes?|rezept(?:e)?|receitas?|ricett[ae])(?![\p{L}])|レシピ|레시피|रेसिपी/iu;
const COOKING = /(?:^|[^\p{L}])(bake[ds]?|baking|oven|preheat|air ?fryer|homemade|from scratch|cook(?:ed|ing)?|simmer|whisk|saut[eé]|roast(?:ed|ing)?|fry|fried|frying|grill(?:ed)?|dessert|ingredients|horno|hornear|fr[ií]e|fre[ií]r|cocinar|four|cuire|cuisson|ofen|backen|kochen|forno|assar|cozinhar|cuocere|ingredientes|ingrédients|zutaten)(?![\p{L}])/giu;
export function isRecipePost(text) {
  const t = String(text || '');
  if (!(FOOD.test(t) || FOOD_INTL.test(t)) || isWorkoutPost(t)) return false;
  const cooking = new Set([...t.matchAll(COOKING)].map((m) => m[1].toLowerCase()));
  return RECIPE_WORD.test(t) || cooking.size >= 2;
}

// --- workouts ----------------------------------------------------------------------------------

// Words that say a caption or page is about training. Exercise lines alone aren't enough
// ("2 x 400 g tins" is a recipe), so a workout needs one of these as well.
const WORKOUT_WORDS = /\b(?:work[- ]?outs?|exercises?|exercices?|routine|hiit|wod|amrap|emom|tabata|circuit|reps|sets|leg day|arm day|push day|pull day|full[- ]body|upper body|lower body|core|abs|glutes|strength|training|warm[- ]?up|cool[- ]?down|calisthenics|mobility|stretch(?:es|ing)?|cardio|squats?|deadlifts?|lunges?|push[- ]?ups?|pull[- ]?ups?|planks?|burpees?|kettlebells?|dumbbells?|barbells?|bench press|rows?)\b|(?:^|[^\p{L}])(?:rutina|entrenamiento|ejercicios?|series|repeticiones|sentadillas?|zancadas?|plancha|entra[iî]nement|exercices|musculation|pompes|gainage|übungen|runden|liegestütze|kniebeugen|ganzkörper|treino|exercícios|agachamentos?|allenamento|esercizi)(?![\p{L}])/iu;
// "Training a model", "core features", "sets of experiments": training words about software and AI.
const NOT_EXERCISE_TOPIC = /\b(?:(?:train(?:ing|ed)?|fine[- ]tun(?:e|ing))\s+(?:a|an|the|your|my|our)?\s*(?:own\s+)?(?:ai|ml|llm|language|neural|machine|deep|custom|base)?\s*(?:models?|networks?|llms?|agents?|classifiers?|datasets?)|machine learning|neural net|dataset|gpu|python|notebook|epochs?|benchmark)\b/i;
export const looksLikeWorkout = (text) => WORKOUT_WORDS.test(String(text || '')) && !(NOT_EXERCISE_TOPIC.test(String(text || '')) && !isWorkoutPost(text));

// Clear signs a post is a workout even when its caption names no exercises (the routine is in the
// video): "routine", "#homeworkout", "kettlebell", "reps", "yoga"… Two different ones are needed, so a
// recipe that "sets" overnight or a "morning routine" stays what it is.
const WORKOUT_SIGNALS = /(?:^|[^\p{L}\p{N}])#?((?:at ?)?home ?work ?outs?|work ?outs?|routines?|exercises?|hiit|yoga|pilates|mobility|stretch(?:es|ing)|calisthenics|kettlebells?|dumbbells?|reps|rounds|leg day|arm day|upper[- ]body|lower[- ]body|full[- ]body|home ?gym|home ?training|warm[- ]?up|cool[- ]?down|circuits?|amrap|emom|tabata|abs|finisher|burner|couch to 5k|[0-9]+ ?k run|intervals?|long run|easy run|tempo run|rutina|entrenamiento|series|sentadillas|zancadas|entraînement|übungen|runden|liegestütze|kniebeugen|ganzkörper|treino|allenamento)(?![\p{L}\p{N}])/giu;
// "post-workout smoothie", "pre-workout snack": the workout is somewhere else.
const AROUND_WORKOUT = /\b(?:post|pre|after|before)[- ]?(?:work ?out|training|gym)\b/gi;
export function workoutSignals(text) {
  const seen = new Set();
  for (const m of String(text || '').replace(AROUND_WORKOUT, ' ').matchAll(WORKOUT_SIGNALS)) seen.add(m[1].toLowerCase().replace(/[\s-]/g, '').replace(/^at/, '').replace(/(?:es|s)$/, ''));
  return seen.size;
}
// A first line that names a workout ("Simple Beginner's Abs Workout", "Leg day finisher") counts double.
const WORKOUT_TITLE = /\b(?:work ?outs?|routine|hiit|pilates|yoga flow|leg day|arm day|push day|pull day|abs burner|mobility flow|stretch(?:es|ing)? routine|full[- ]body)\b/i;
export const isWorkoutPost = (text) => {
  const t = String(text || '');
  const first = t.split('\n')[0].replace(AROUND_WORKOUT, ' ');
  return workoutSignals(t) + (WORKOUT_TITLE.test(first) ? 1 : 0) >= 2;
};

// Recipe or workout, by one rule for every path (a save, an Instagram import, an old backup). A routine
// listed with no "Ingredients" heading ("10 Upright Rows", "10 Horn Curls"…) is a workout, not a recipe.
// `workout` is what the caller already read (capture.js reads the title too); left out, it's read here.
export function recipeOrWorkout(text, workout) {
  const t = String(text || '');
  const routine = workout !== undefined ? workout : looksLikeWorkout(t) || isWorkoutPost(t) ? workoutFromText(t, { source: 'caption' }) : null;
  const recipe = recipeFromText(t);
  if (recipe && !(routine && routine.exercises.length >= 3 && !hasIngredientHeading(t))) return { kind: 'recipe', details: recipe };
  if (routine) return { kind: 'workout', details: routine };
  return null;
}

const SECONDS = /^(\d{1,4})\s*(s|sec|secs|seconds?|m|min|mins|minutes?)$/i;
const toSeconds = (n, unit) => (/^m/i.test(unit) ? Number(n) * 60 : Number(n));
const X = '\\s*[x×*]\\s*';
const TIME = '(\\d{1,4})\\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\\b';
const NAME = "([A-Za-z][A-Za-z0-9'’()/&+ .\\-–—]{1,60}?)";
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
// Captions often reach Internet Binder as one long line (page metadata drops the line breaks). Put them back
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
    const r = raw.match(/^(?:[^\w]*)(?:repeat\s+(?:for\s+|it\s+|this\s+)?)?(?:x\s*)?(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s*(?:total\s+)?(?:rounds?|sets?|times|circuits?)\b(?:\s*(?:total|in total|of|:))?[.!]*\s*$/i) || raw.match(/^(?:[^\w]*)(?:rounds?|sets?)\s*[:x×]?\s*(\d{1,2})[.!]*\s*$/i);
    if (r) { rounds = Number(r[1]); inList = false; continue; }
    // "8–12 reps per exercise", "30 sec each": the same numbers for every exercise (lower end of a range).
    const each = raw.match(/^[^\w]*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(reps?|repetitions?|s|sec|secs|seconds?)\b(?:\s*(?:per|each|for each|on each|of each)\s*(?:exercise|move(?:ment)?|side|round)?)?[.!]*\s*$/i);
    if (each) { if (/^r/i.test(each[3])) repsAll = { reps: Number(each[1]), repsMax: Number(each[2]) || null }; else secondsAll = Number(each[1]); inList = false; continue; }
    // "Rest 60s", "Rest: 40–90 sec", "40–90 sec rest"
    const rest = raw.match(/^(?:[^\w]*)rest\s*(?:for\s+)?[:\-–]?\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b/i)
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

// --- places ------------------------------------------------------------------------------------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_CODES = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const hhmm = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

// schema.org opening hours -> readable lines ("Mon–Fri 12:00–22:00", "Sat 10:00–23:00").
// Takes openingHoursSpecification objects or the short "Mo-Fr 11:00-22:00" strings.
export function hoursFrom(spec, short) {
  const byDay = Array.from({ length: 7 }, () => []);
  const add = (day, range) => { if (day >= 0 && day < 7 && range && !byDay[day].includes(range)) byDay[day].push(range); };
  for (const s of (Array.isArray(spec) ? spec : spec ? [spec] : []).slice(0, 40)) {
    if (!s || typeof s !== 'object') continue;
    const opens = hhmm(s.opens);
    const closes = hhmm(s.closes);
    if (!opens || !closes) continue;
    const range = opens === '00:00' && (closes === '23:59' || closes === '00:00') ? 'Open 24 hours' : `${opens}–${closes}`;
    for (const d of (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek])) {
      const key = String(d || '').replace(/^https?:\/\/schema\.org\//i, '').toLowerCase();
      add(DAY_CODES[key] ?? -1, range);
    }
  }
  for (const line of (Array.isArray(short) ? short : short ? String(short).split(/\s*[,;]\s*(?=[A-Za-z]{2})/) : []).slice(0, 14)) {
    const m = String(line).match(/^\s*([A-Za-z]{2})(?:\s*-\s*([A-Za-z]{2}))?(?:\s*,\s*[A-Za-z]{2})*\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!m) continue;
    const from = DAY_CODES[m[1].toLowerCase()];
    const to = m[2] ? DAY_CODES[m[2].toLowerCase()] : from;
    if (from === undefined || to === undefined) continue;
    for (let d = from; d <= (to >= from ? to : to + 7); d++) add(d % 7, `${hhmm(m[3])}–${hhmm(m[4])}`);
  }
  // Runs of days with the same hours become one line.
  const out = [];
  let i = 0;
  while (i < 7) {
    const v = byDay[i].join(', ');
    let j = i;
    while (j + 1 < 7 && byDay[j + 1].join(', ') === v) j++;
    if (v) out.push(`${j > i ? `${DAY_NAMES[i]}–${DAY_NAMES[j]}` : DAY_NAMES[i]} ${v}`);
    i = j + 1;
  }
  return out;
}

const coord = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max && v !== '' && v !== null ? Math.round(n * 1e6) / 1e6 : null;
};

// schema.org Restaurant, LocalBusiness, TouristAttraction… -> place details.
// A street as some listings write it: "Rogers Ave, 570" is "570 Rogers Ave"; "108/ San Pedro St." is
// "108 San Pedro St.". Anything else is left as written.
export function tidyStreet(s) {
  const t = String(s || '').trim();
  const flipped = t.match(/^([\p{L}][\p{L}\p{N} .'-]{2,60}),\s*(\d{1,6}[a-z]?)$/u);
  if (flipped && STREET.test(flipped[1])) return `${flipped[2]} ${flipped[1]}`;
  return t.replace(/^(\d{1,6}[a-z]?)\/\s+(?=\p{L})/u, '$1 ');
}

export function placeFromSchema(node) {
  if (!node || typeof node !== 'object') return null;
  const a = Array.isArray(node.address) ? node.address[0] : node.address;
  const addr = typeof a === 'string' ? { streetAddress: a } : a && typeof a === 'object' ? a : {};
  const geo = Array.isArray(node.geo) ? node.geo[0] : node.geo || {};
  const types = (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).map((t) => String(t || ''));
  const out = {
    address: tidyStreet(clean(addr.streetAddress, 200)),
    locality: clean(addr.addressLocality, 80),
    region: clean(addr.addressRegion, 80),
    postalCode: clean(addr.postalCode, 20),
    country: clean(nameOf(addr.addressCountry), 60),
    lat: coord(geo.latitude, 90),
    lng: coord(geo.longitude, 180),
    phone: clean(node.telephone, 40),
    cuisine: list(node.servesCuisine, 3, 40).join(', '),
    priceRange: clean(node.priceRange, 20),
    hours: hoursFrom(node.openingHoursSpecification, node.openingHours),
    category: clean(types.find((t) => !/^(?:LocalBusiness|Place|Organization|Thing)$/i.test(t)) || types[0] || '', 40).replace(/([a-z])([A-Z])/g, '$1 $2'),
    source: 'page',
  };
  return out.address || out.locality || (out.lat !== null && out.lng !== null) ? out : null;
}

// A Google Maps or Apple Maps link -> the place's name and pin, read from the link itself (nothing fetched).
//   google.com/maps/place/Name+Here/@51.5,-0.12,17z/…   maps.apple.com/?q=Name&ll=51.5,-0.12   maps.apple.com/place?…&coordinate=…
export function placeFromMapsUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  let name = '';
  let lat = null;
  let lng = null;
  let address = '';
  let locality = '';
  let region = '';
  if (/^(?:google\.[a-z.]+|maps\.google\.[a-z.]+)$/.test(host) && /^\/maps\b/.test(u.pathname)) {
    const place = u.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (place) name = decodeURIComponent(place[1].replace(/\+/g, ' '));
    const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const pin = u.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/); // the place itself, not the map's centre
    const q = u.searchParams.get('query') || u.searchParams.get('q') || '';
    if (pin) [lat, lng] = [pin[1], pin[2]];
    else if (at) [lat, lng] = [at[1], at[2]];
    else if (/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(q)) [lat, lng] = q.split(',');
    else if (!name && q) name = q;
    // A search link with the address in it ("Top Pot Doughnuts 2124 5th Ave Seattle WA"): name, street, city.
    if (q && !place) {
      const split = splitNameAddress(q);
      if (split) { name = split.name; address = split.address; locality = split.locality; region = split.region; }
    }
  } else if (host === 'maps.apple.com') {
    name = u.searchParams.get('q') || u.searchParams.get('name') || '';
    address = u.searchParams.get('address') || '';
    const ll = u.searchParams.get('ll') || u.searchParams.get('coordinate') || u.searchParams.get('sll') || '';
    if (/^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(ll)) [lat, lng] = ll.split(',');
  } else return null;
  const out = { name: clean(name, 120), address: clean(address, 200), ...(locality ? { locality: clean(locality, 80) } : {}), ...(region ? { region: clean(region, 60) } : {}), lat: coord(lat, 90), lng: coord(lng, 180), source: 'maps-link' };
  return out.name || out.address || (out.lat !== null && out.lng !== null) ? out : null;
}

// A place named in a caption, with its address when the caption gives one:
//   "📍 Peter Pan Donut & Pastry Shop, Greenpoint"           -> name, area
//   "📍 Randy’s Donuts\n186 Bleecker St, New York, NY"        -> name, street, city, state
//   "📍 Randy’s Donuts 186 Bleecker St, New York, NY"          (the same, line breaks lost)
//   "Location: Joe's Pizza, NYC. Best slice in town"         -> name, area (the next sentence dropped)
const STREET = /\b(?:st|street|ave|avenue|av|rd|road|blvd|boulevard|ln|lane|dr|drive|way|pl|place|sq|square|ct|court|pkwy|parkway|hwy|highway|broadway|bowery)\b\.?/i;
export const looksLikeAddress = (s) => /^\d{1,6}[a-z]?(?:-\d+)?\s+\S/i.test(s) && STREET.test(s);
export function placeFromText(text) {
  const src = String(text || '').replace(/\r/g, '');
  // Three or more 📍 is a post about several places (a list, a round-up), not one place.
  if ((src.match(/📍|📌/gu) || []).length >= 3) return null;
  const lines = src.split(/\n+|(?=📍)/u);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = raw.match(/(?:📍|📌|🗺️?|\b(?:location|address|where|find (?:it|them|us) at|spot)\s*[:：-])\s*([^\n]{2,220})/iu);
    if (!m) continue;
    let s = m[1];
    // The place's own @handle, written with it ("📍 @shalomjapan, Brooklyn", "Roosevelt Bagel Factory (@rooseveltbagelfactory)").
    const leading = (s.match(/^\s*@([A-Za-z0-9._]{2,30})/) || [])[1] || '';
    const own = leading || (s.match(/\(\s*@([A-Za-z0-9._]{2,30})\s*\)/) || [])[1] || '';
    s = s.replace(/\(\s*@[A-Za-z0-9._]+\s*\)/g, ' ').replace(/^\s*@[A-Za-z0-9._]+\s*,?\s*/, '');
    // A later @handle is a mention or a photo credit ("📍228 DeKalb Ave, Fort Greene 🎥: @…"): it ends the place.
    s = s.split(/\s(?:🎥|📸)?:?\s*@[A-Za-z0-9._]/u)[0];
    // A leading hashtag is the area ("📍 #Greenpoint 29 Greenpoint Ave, Brooklyn").
    s = s.replace(/^\s*#[\p{L}\p{N}_]{2,30}\s+/u, '');
    // It ends at a later hashtag, a phone, a divider or an ordering note.
    s = s.split(/\s#[\p{L}\p{N}_]|📲|☎️?|📞|—{2,}|-{3,}|\s\.\s\.|\s•|\bpre[- ]?order\b|\bwebsite\b|\bphone\b/iu)[0];
    s = s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}️‍]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;:!]+$/, '');
    // Stop at the next sentence ("📍 Joe's Pizza, NYC. Best slice in town").
    s = s.split(/(?<=\b[\p{L}\p{N}']{3,})[.!]\s+(?=\p{Lu})|\s+[-–—]\s+(?=[a-z])/u)[0].trim();
    // "Name in Carteret, NJ" and "Sonny's (Hollywood, Los Angeles)": the place, then where it is.
    s = s.replace(/\s+in\s+(?=\p{Lu})/u, ', ').replace(/\s*\(([^()]{2,60})\)?\s*$/, (_, area) => `, ${area.split(/\s*,\s*/).pop()}`).replace(/\s*\(([^()]{2,60})\)/, ', $1');
    // A label before the address ("Cedar Park/North Austin Location : 10900 …") isn't the name.
    s = s.replace(/^[^:\d]{0,50}\blocations?\s*:\s*/i, '');
    // The address on the next line ("📍 Randy's Donuts" / "186 Bleecker St, New York, NY").
    const next = (lines[i + 1] || '').trim();
    if (!/,/.test(s) && !/\d/.test(s) && looksLikeAddress(next)) s = `${s}, ${next.replace(/[.;!]+$/, '')}`;
    if (!s || s.length < 2 || /^https?:/i.test(s)) continue;
    let parts = s.split(/\s*(?:,|\||·|–|—)\s*/).map((x) => x.replace(/(?:\s*\.)+$/, '').trim()).filter(Boolean);
    // "📍 @shalomjapan, Brooklyn": the handle is the name, what follows is where.
    if (leading && !looksLikeAddress(parts[0] || '')) parts = [nameFromHandle(leading), ...parts];
    // A name glued to its street number ("Randy's Donuts 186 Bleecker St").
    const glued = parts[0].match(/^(.+?\D)\s+(\d{1,6}[a-z]?\s+.+)$/i);
    if (glued && looksLikeAddress(glued[2])) parts = [glued[1], glued[2], ...parts.slice(1)];
    // Only an address ("Address: 23 Cleveland Place, New York, NY"): the place's @handle names it, written
    // with it or just before (not "Follow @…" or a photo credit).
    const addressOnly = looksLikeAddress(parts[0]);
    const near = `${(lines[i - 1] || '').slice(-120)} ${raw.slice(Math.max(0, m.index - 120), m.index)}`;
    const handles = [...near.matchAll(/(?<!(?:follow|by|via|credit|cc|📸|🎥)[:\s]{1,3})@([A-Za-z0-9._]{2,30})/giu)].map((x) => x[1]);
    const handle = own || (addressOnly ? handles.pop() || '' : '');
    let name = addressOnly ? nameFromHandle(handle) : clean(parts[0], 120);
    // Phrases that aren't a place's name ("This spot is closed", "3 Locations").
    if (/^(?:this|that|the)\s+(?:spot|place|restaurant|shop|cafe|location)\b|^\d+\s+locations?\b|^(?:closed|permanently closed|new location)\b/i.test(name)) name = '';
    // A call to action after a 📌 ("📌 Save this for your next back workout", "📌 Comment PLAN") is no place.
    if (/^(?:save|saved|comment|follow|share|send|tag|try|tap|click|dm|like|repost|bookmark|pin)\b/i.test(name)) continue;
    if (!name && !addressOnly && !own) continue;
    if (!name && own) name = nameFromHandle(own);
    const rest = addressOnly ? parts : parts.slice(1);
    const at = rest.findIndex(looksLikeAddress);
    const where = at >= 0 ? addressFromLine(rest.slice(at).join(', ')) : null;
    const after = at >= 0 ? [] : rest;
    const locality = where ? where.locality : clean(after[0] || '', 80);
    const regionRaw = where ? where.region : clean(after[1] || '', 60);
    let region = /^[\p{L} .'-]{2,40}$/u.test(regionRaw) ? regionRaw : '';
    let city = locality !== name && /^[\p{L} .'-]{2,40}$/u.test(locality) ? locality : '';
    // "Sonny's, Hollywood, Los Angeles": a second area that isn't a state is the city.
    if (region && !STATE_POSTAL.test(region) && !COUNTRY.test(region) && !new RegExp(`^(?:${US_STATE})$`, 'i').test(region)) [city, region] = [region, ''];
    return { name, address: where ? where.address : '', locality: city, region, ...(where?.postalCode ? { postalCode: where.postalCode } : {}), ...(handle ? { handle } : {}) };
  }
  // No marker: an address written anywhere ("…cinnamon rolls 16051 dessau rd suite f Pflugerville, TX,78660").
  const any = src.match(new RegExp(`\\b\\d{2,6}[a-z]?\\s+(?:[\\p{L}\\p{N}.'-]+\\s){0,5}?(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|pl|place|pkwy|parkway|hwy|highway)\\b\\.?(?:\\s+(?:suite|ste|apt|unit|#)\\.?\\s*[\\w-]{1,6})?[\\s,]+[\\p{L} .'-]{2,30},\\s*(?:${US_STATE})\\b(?:,?\\s*\\d{5})?`, 'iu'));
  const where = any ? addressFromLine(any[0]) : null;
  return where?.address ? { name: '', address: where.address, locality: where.locality, region: where.region, postalCode: where.postalCode } : null;
}

// "homies_nyc" -> "Homies NYC", "joes.pizza" -> "Joes Pizza": an account name read as words (short words
// such as nyc, la, bk in capitals). Only used for a place's own @handle, never the poster's.
export function nameFromHandle(handle) {
  const words = String(handle || '').replace(/^@/, '').split(/[._]+/).filter(Boolean);
  if (!words.length) return '';
  return clean(words.map((w) => (/^(?:nyc|la|sf|bk|uk|us|dc|ny|atl|chi|phx)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' '), 80);
}

// --- a business's own profile or home page -----------------------------------------------------------
// Words that name somewhere you go (a bakery, a salon, a gym…), and words that say a profile is a person
// talking about places rather than the place itself.
const VISIT_WORDS = /\b(?:bak(?:ery|eries|eshop)|donuts?|doughnuts?|caf[eé]s?|coffee (?:shop|bar|house)|espresso bar|restaurants?|pizz(?:a|eria)|bagels?|deli|diner|bistro|brasserie|tavern|pub|brewery|taproom|winery|wine bar|cocktail bar|ice cream|gelato|creamery|scoop shops?|dessert shop|p[aâ]tisserie|taqueria|tacos|ramen|sushi|noodle (?:bar|shop)|bbq|burgers?|eatery|food truck|tea ?house|bubble tea|boba|cinnamon rolls?|salon|barber(?:shop)?|day spa|spa|massage|nail (?:salon|bar|studio)|lash (?:bar|studio)|tattoo|gym|fitness (?:studio|center|club)|yoga (?:studio|shala)|pilates|crossfit|climbing (?:gym|wall)|bouldering|skate(?:board)? ?shop|record (?:store|shop)|book(?:store|shop)|florist|flower shop)\b/i;
const NOT_A_PLACE = /\b(?:blogger|influencer|creator|foodie|food (?:reviews?|critic|guide|lover)|reviews?|recipes|collabs?|ugc|podcast|magazine|newsletter)\b/i;
const OPEN_WORDS = /\b(?:open(?:ing)?\b|closed (?:on )?(?:mon|tue|wed|thu|fri|sat|sun)|hours|daily|24\/7|walk-?ins?|book (?:now|online|an appointment)|reservations?|dine[- ]in|take-?out|pick-?up|curbside|since \d{4})|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;
// Facebook page categories that aren't somewhere you go.
const NOT_A_PLACE_PAGE = /\b(?:musician|band|artist|public figure|creator|blogger|personal blog|media|news|magazine|community|author|athlete|politician|tv show|movie|book|website|app|software|organi[sz]ation|non-?profit|cause|fan page|meme)\b/i;
const COUNTRY = /^(?:united states|usa|canada|united kingdom|uk|ireland|australia|new zealand|mexico|france|germany|spain|italy|japan)$/i;
const US_STATE = 'A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';
const STATE_POSTAL = new RegExp(`^(?:${US_STATE})(?:\\s+\\d{5}(?:-\\d{4})?)?$`);
const CITY_STATE = new RegExp(`\\b((?:[A-Z][a-z]+\\.?\\s){0,2}[A-Z][a-z]+),\\s*(${US_STATE})\\b(?:\\s+(\\d{5}))?`);
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

// One line of address: "2309 2nd avenue New York, NY 10035", "19 East Main Street, Rexburg, ID, United
// States, Idaho", or just the area ("Oklahoma City, OK, United States"). Null when it's neither.
export function addressFromLine(line) {
  const s = String(line || '').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  if (!s || s.length > 160 || /[·|]/.test(s)) return null;
  const parts = s.split(/\s*,\s*/).filter(Boolean);
  let address = '';
  if (looksLikeAddress(parts[0])) {
    // The street ends at its last street word before any city ("2309 2nd avenue New York"), plus a suite
    // or floor after it ("…lakeline mall drive suite 300", "…10th St. 2nd floor").
    const words = parts[0].split(' ');
    let at = -1;
    words.forEach((w, i) => { if (i > 0 && i < 7 && STREET.test(w)) at = i; });
    for (;;) {
      const rest = words.slice(at + 1).join(' ');
      const unit = rest.match(/^(?:(?:suite|ste|apt|unit|fl|floor|#)\.?\s*[\w-]{1,6}|\d+(?:st|nd|rd|th)\s+(?:floor|fl)\.?)(?=\s|$)/i);
      if (!unit) break;
      at += unit[0].split(' ').length;
    }
    address = words.slice(0, at + 1).join(' ');
    const city = words.slice(at + 1).join(' ');
    parts.splice(0, 1, ...(city ? [city] : []));
  } else if (!(parts.length >= 2 && (parts.some((p) => COUNTRY.test(p)) || STATE_POSTAL.test(parts[1])))) return null;
  // "Philadelphia PA 19147" (no commas): the city, then its state and ZIP.
  if (parts.length === 1) {
    const m = parts[0].match(new RegExp(`^(.*?)\\s*\\b(${US_STATE})(?:\\s+(\\d{5}(?:-\\d{4})?))?$`));
    if (m && STATE_POSTAL.test(m[2])) parts.splice(0, 1, ...[m[1], [m[2], m[3]].filter(Boolean).join(' ')].filter(Boolean));
  }
  // "Austin, TX, 78717": a ZIP on its own goes with the state.
  if (parts.length >= 3 && /^\d{5}(?:-\d{4})?$/.test(parts[parts.length - 1]) && STATE_POSTAL.test(parts[parts.length - 2])) parts.splice(-2, 2, `${parts[parts.length - 2]} ${parts[parts.length - 1]}`);
  if (parts.some((p) => !/^[\p{L}\p{N} .'-]{2,40}$/u.test(p))) return address ? { address: clean(address, 200), locality: '', region: '', postalCode: '', country: '' } : null;
  // "…, ID, United States, Idaho": the country, and the state's name after it, are dropped.
  const c = parts.findIndex((p) => COUNTRY.test(p));
  const country = c >= 0 ? parts.splice(c)[0] : '';
  // Only a state after the street ("…2nd floor NY"): no city.
  if (parts.length === 1 && STATE_POSTAL.test(parts[0]) && address) parts.unshift('');
  const [locality = '', regionPostal = ''] = parts;
  const rp = regionPostal.match(/^(.*?)(?:\s+(\d{5}(?:-\d{4})?))?$/);
  return { address: clean(address, 200), locality: clean(locality, 80), region: clean(rp[1] || '', 60), postalCode: rp[2] || '', country: clean(country, 60) };
}

// A business's Instagram profile or Facebook page (what extract.js read: its name, bio, and Facebook's
// Intro lines) as a place, when it is one: an address or area, or words for somewhere you go along with
// opening times, prices or ratings. A person's or a blogger's profile is not a place. Nothing is guessed:
// what the profile doesn't say stays empty.
export function placeFromProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const bio = String(p.bio || '');
  const intro = Array.isArray(p.intro) ? p.intro.map((l) => String(l || '').trim()).filter(Boolean).slice(0, 30) : [];
  const lines = [...bio.split(/\n+/), ...String(p.header || '').split(/\n+/), ...intro]
    .map((l) => l.replace(/[\p{Extended_Pictographic}️‍]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let where = null;
  for (const l of lines) {
    const a = addressFromLine(l);
    if (a && (a.address || a.locality) && (!where || (a.address && !where.address))) where = a;
    if (where?.address) break;
  }
  const fromText = where?.address ? null : placeFromText(bio);
  if (fromText?.address) where = { address: fromText.address, locality: fromText.locality, region: fromText.region, postalCode: '', country: '' };
  const phone = (lines.find((l) => PHONE.test(l) && l.length < 40) || '').match(PHONE)?.[0] || '';
  let category = '';
  let isPlace;
  if (p.platform === 'facebook') {
    const cats = (intro.find((l) => /^Page\s*·/i.test(l)) || '').split(/\s*·\s*/).slice(1);
    if (cats.length && cats.every((c) => NOT_A_PLACE_PAGE.test(c)) && !where?.address) return null;
    category = cats.find((c) => VISIT_WORDS.test(c)) || '';
    const local = intro.some((l) => /^(?:price range\b|open now$|closed now$|always open$|temporarily closed$)|\brecommend \(|\b(?:curbside|dine-in|takeout|delivery)\b/i.test(l)) || /\bwere here\b/i.test(p.about || '');
    // The area from the page's summary: "Rise Bakery, Oklahoma City. 294 followers".
    if (!where) {
      const m = String(p.about || '').match(/^(.+?),\s*([\p{L} .'-]{2,40})\.\s*[\d,.]+K?\s+followers/u);
      if (m) where = { address: '', locality: clean(m[2], 80), region: '', postalCode: '', country: '' };
    }
    isPlace = !!(where?.address || where?.locality || category || (local && VISIT_WORDS.test(`${cats.join(' ')} ${bio} ${intro.join(' ')}`)));
  } else {
    isPlace = !!where?.address || (VISIT_WORDS.test(bio) && OPEN_WORDS.test(bio) && !NOT_A_PLACE.test(bio));
  }
  if (!isPlace) return null;
  // Its name: the profile's, less an address or area glued to it ("Mrs. Powell's Cinnamon Rolls Rexburg 19 E Main").
  let name = clean(String(p.name || '').split(/\s+\|\s+/)[0], 120).replace(/\s+\d{1,6}\s+\S.*$/, '').trim();
  if (where?.locality && name.toLowerCase().endsWith(` ${where.locality.toLowerCase()}`)) name = name.slice(0, -where.locality.length - 1).trim();
  if (!name) name = nameFromHandle(p.handle);
  if (!name) return null;
  return { name, address: where?.address || '', locality: where?.locality || '', region: where?.region || '', postalCode: where?.postalCode || '', country: where?.country || '', phone, category: clean(category, 60), source: 'page' };
}

// A business's own home page with no address on it (extract.js homeFacts: its name, what it says about
// itself, a phone, a link to its locations): a place when it says what kind of place it is and where to
// find it. A brand or a shop that only sells online is not.
export function placeFromHome(h) {
  if (!h || typeof h !== 'object') return null;
  const strip = (s) => tidyImportedText(String(s || '').replace(/<[^>]*>/g, ' '), 1000);
  const about = [h.name, h.siteName, h.title, h.about].map(strip).filter(Boolean).join(' · ');
  if (!VISIT_WORDS.test(about)) return null;
  const area = about.match(CITY_STATE);
  if (!h.visitLink && !h.phone && !area) return null;
  const first = (s) => strip(s).split(/\s+[|–—-]\s+|\s+:\s+/)[0].trim();
  const name = clean(strip(h.name) || first(h.siteName) || first(h.title), 120);
  if (!name) return null;
  return { name, address: '', locality: area ? clean(area[1], 80) : '', region: area ? clean(area[2], 60) : '', postalCode: area?.[3] || '', phone: clean(h.phone || '', 40), source: 'page' };
}

// --- Instagram imports ------------------------------------------------------------------------------
// An Instagram Saved collection whose name says what's in it ("Restaurants", "NYC eats", "Recipes",
// "Workouts"): that Lifestyle view. Recipes and workouts are checked first ("Brunch recipes" is recipes). Null when the name doesn't say (a shopping collection, "Ideas").
const COLLECTION_KINDS = [
  ['recipe', /\b(?:recipes?|cooking|to cook|meals?|dinners?|baking|desserts?|meal ?prep)\b/i],
  ['workout', /\b(?:workouts?|exercises?|fitness|training|routines?|abs|yoga|pilates|stretch(?:es|ing)?)\b/i],
  ['place', /\b(?:restaurants?|eats?|food ?spots?|spots|places?|caf[eé]s?|coffee(?: shops?)?|bars?|brunch|bakery|bakeries|donuts?|pizza|date ?nights?|hangouts?|dining|foodie|salons?|barbers?|gyms?)\b/i],
  ['video', /\b(?:videos?|watch later)\b/i],
  ['media', /\b(?:movies?|films?|shows?|tv|to watch)\b/i],
  ['book', /\b(?:books?|reading|to read)\b/i],
];
export function kindForCollectionName(name) {
  const s = String(name || '').trim();
  if (!s || /^all posts$/i.test(s)) return null;
  for (const [kind, re] of COLLECTION_KINDS) if (re.test(s)) return kind;
  return null;
}

// A place from an imported post: the caption's 📍 line (with any address) names it, the post's location
// tag gives its street, city and pin, and a tag that is only a city ("Brooklyn, New York") is its area,
// not its name. The tag's street and pin are used only when it is the same place the caption names.
export function placeFromPost({ caption = '', location = '', place = null } = {}) {
  const tag = place && typeof place === 'object' ? place : {};
  const fromCaption = placeFromText(caption);
  const tagName = clean(String(tag.name || location || ''), 120);
  const cityOnly = /^[\p{L} .'-]{2,40},\s*[\p{L} .'-]{2,40}(?:,\s*[\p{L} .'-]{2,40})?$/u.test(tagName) && !looksLikeAddress(tagName) && !tag.address;
  const name = fromCaption?.name || (cityOnly ? '' : tagName);
  const sameTag = !!tagName && !cityOnly && (!fromCaption?.name || tagMatches(fromCaption.name, tagName));
  const area = String(tag.city || (cityOnly ? tagName : '')).split(/\s*,\s*/).filter(Boolean);
  const details = {
    address: fromCaption?.address || (sameTag ? tag.address : '') || '',
    locality: fromCaption?.locality || (sameTag || cityOnly ? area[0] : '') || '',
    region: fromCaption?.region || (sameTag ? tag.region : '') || (sameTag || cityOnly ? area[1] : '') || '',
    postalCode: sameTag ? tag.postalCode || '' : '',
    lat: sameTag && Number.isFinite(tag.lat) ? tag.lat : null,
    lng: sameTag && Number.isFinite(tag.lng) ? tag.lng : null,
    source: 'page',
  };
  if (!name && !details.address && !details.locality) return null;
  return { name, details: sanitizeDetails('place', details) };
}
const tagMatches = (a, b) => {
  const n = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const x = n(a);
  const y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

// What a page title says when it isn't the thing's name ("Instagram", "Name on Instagram: …", "Google Maps").
export const genericTitle = (t) => !t || /^(?:instagram(?: (?:post|reel|photo|video))?|tiktok|youtube|google maps|facebook|untitled( item)?)$/i.test(String(t).trim())
  || /\son instagram:/i.test(String(t));

// Turning a save into another kind (you picked a Lifestyle for it): that kind's details, worked out from
// what the save already holds (its link, caption, description, title). Returns { details, title } where
// title is a better name when the current one is a site's ("Instagram"), else ''. Nothing is looked up.
export function detailsForKind(kind, item = {}) {
  const ig = item.instagram && typeof item.instagram === 'object' ? item.instagram : {};
  const texts = [ig.caption, item.description, item.title].filter((t) => typeof t === 'string' && t.trim()).sort((a, b) => b.length - a.length);
  const firstOf = (fn) => { for (const t of texts) { const r = fn(t); if (r) return r; } return null; };
  const keep = item.kind === kind && item.details && Object.keys(item.details).length ? item.details : null;
  let details = {};
  let title = '';
  if (kind === 'recipe') details = keep || firstOf((t) => recipeFromText(t)) || {};
  else if (kind === 'workout') details = keep || firstOf((t) => workoutFromText(t)) || {};
  else if (kind === 'place') {
    const fromLink = placeFromMapsUrl(item.url);
    // The caption's 📍 line (with any address) first; the post's location tag names the place when there's
    // none, and gives its street, city and pin (placeFromPost: a tag that is only a city is the area).
    const caption = firstOf(placeFromText);
    const post = ig.location || ig.place ? placeFromPost({ caption: ig.caption || '', location: ig.location || '', place: ig.place || null }) : null;
    const fromText = caption && !post ? caption : post ? { ...post.details, name: post.name } : null;
    details = { ...(keep || {}), ...(fromLink ? { lat: fromLink.lat, lng: fromLink.lng, address: fromLink.address || keep?.address || '' } : {}) };
    for (const k of ['address', 'locality', 'region', 'postalCode']) if (fromText?.[k] && !details[k]) details[k] = fromText[k];
    if (!fromLink && Number.isFinite(fromText?.lat) && Number.isFinite(fromText?.lng) && details.lat == null) [details.lat, details.lng] = [fromText.lat, fromText.lng];
    if (!details.source) details.source = fromLink ? 'maps-link' : 'page';
    // No name anywhere: the street address stands in until a lookup or your AI provider names it.
    const name = fromLink?.name || fromText?.name || fromText?.address || '';
    // An Instagram post's title is its caption's first line: the place's name replaces it, unless you wrote it.
    if (name && (genericTitle(item.title) || (item.type === 'instagram' && !(item.userFields || []).includes('title')))) title = name;
    // A site's home page title ("Home | Saigon Sandwich"): the site's name.
    else if (!name && /^(?:home|welcome|index)\s*[|–—-]\s*\S/i.test(String(item.title || ''))) title = clean(String(item.title).replace(/^(?:home|welcome|index)\s*[|–—-]\s*/i, ''), 120);
  } else if (kind === 'video') details = keep || videoFromCapture({}, item.url || '');
  else if (kind === 'media') details = keep || { format: titleSite(item.url || '')?.format || 'film', source: 'page' };
  else details = keep || {};
  return { details: sanitizeDetails(kind, details), title };
}

// The Lifestyle views, in menu order (everything except products and plain links).
export const LIFESTYLE = () => KINDS.filter((k) => hasOwnView(k.value));

// You put a save into a Lifestyle view: it becomes that kind, with that kind's details worked out
// from what it holds, and leaves any collection (collections are for shopping). yours: you chose it,
// so the kind is kept as yours and your AI provider reads the save again for that kind's details.
export function kindChangePatch(item, kind, { yours = false } = {}) {
  const { details, title } = detailsForKind(kind, item);
  return { kind, details, ...(title ? { title } : {}), collectionId: null, needsReview: false, ...(yours ? { userFields: ['kind'], understoodAt: null } : {}) };
}

// You put a Lifestyle save into a collection: it becomes something to buy (a product when it has a
// price, else a link), so the shopping rules apply.
export const shoppingKindFor = (item) => (item.price !== null && item.price !== undefined ? 'product' : 'link');

// "Top Pot Doughnuts 2124 5th Ave Seattle WA" / "…, 2124 5th Ave, Seattle, WA": the name before the house
// number, the street up to its type (Ave, St…), then the city and a two-letter state if there is one.
function splitNameAddress(q) {
  const s = String(q).replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?\D)[,\s]+(\d{1,6}[a-z]?\s+.+)$/i);
  if (!m) return null;
  const rest = m[2].replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const words = rest.split(' ');
  const at = words.findIndex((w, i) => i > 0 && STREET.test(w));
  if (at < 0) return null;
  const address = words.slice(0, at + 1).join(' ');
  const tail = words.slice(at + 1).filter((w) => !/^\d{5}(?:-\d{4})?$/.test(w));
  const region = tail.length > 1 && /^[A-Z]{2}$/.test(tail[tail.length - 1]) ? tail.pop() : '';
  return { name: m[1].replace(/[,\s]+$/, ''), address, locality: tail.join(' '), region };
}

// One line for the address ("12 High St, London E1 6AN").
export function addressLine(d = {}) {
  const tail = [d.locality, [d.region, d.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [d.address, tail, d.country].filter(Boolean).join(', ');
}

// Links that open the place in Apple Maps or Google Maps. Built from what's saved; nothing is looked up.
// Name plus address finds the place's own page; a pin alone drops a pin.
export function mapsLinks(name, d = {}) {
  const where = addressLine(d);
  const hasPin = Number.isFinite(d.lat) && Number.isFinite(d.lng);
  if (!where && !hasPin && !name) return null;
  const q = [name, where].filter(Boolean).join(', ');
  const google = new URL('https://www.google.com/maps/search/');
  google.searchParams.set('api', '1');
  google.searchParams.set('query', where || !hasPin ? q : `${d.lat},${d.lng}`);
  const apple = new URL('https://maps.apple.com/');
  if (name) apple.searchParams.set('q', name);
  if (where) apple.searchParams.set('address', where);
  if (hasPin) apple.searchParams.set('ll', `${d.lat},${d.lng}`);
  return { google: google.href, apple: apple.href };
}

// --- videos and articles -------------------------------------------------------------------------

const VIDEO_HOSTS = [
  [/(^|\.)youtube\.com$/, /^\/(?:watch|shorts\/|live\/)/, 'YouTube'],
  [/^youtu\.be$/, /^\/[\w-]{6,}/, 'YouTube'],
  [/(^|\.)vimeo\.com$/, /^\/\d+/, 'Vimeo'],
  [/(^|\.)tiktok\.com$/, /\/video\/\d+/, 'TikTok'],
  [/(^|\.)dailymotion\.com$/, /^\/video\//, 'Dailymotion'],
  [/(^|\.)twitch\.tv$/, /^\/videos\/\d+/, 'Twitch'],
];

// Any YouTube link (a video, a channel, a playlist): saved as a video.
export function isYouTube(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\.|^m\.|^music\./, '');
    return h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com';
  } catch {
    return false;
  }
}

// The video site a link is a video on ("YouTube"), or '' when it isn't one of them.
export function videoPlatform(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const hit = VIDEO_HOSTS.find(([h, path]) => h.test(host) && path.test(u.pathname));
  return hit ? hit[2] : '';
}

// "PT1H2M3S", 3723 (seconds), "1:02:03" or "12:03" -> seconds.
export function secondsFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value < 864000 ? Math.round(value) : null;
  const s = String(value).trim();
  const iso = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
    const n = Number(iso[1] || 0) * 86400 + Number(iso[2] || 0) * 3600 + Number(iso[3] || 0) * 60 + Number(iso[4] || 0);
    return n > 0 && n < 864000 ? Math.round(n) : null;
  }
  const clock = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) || null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return secondsFrom(Number(s));
  return null;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

const dayOf = (v) => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
};

// What the page says about a video (extract.js `media`) -> video details.
export function videoFromCapture(media = {}, url = '') {
  return {
    durationSeconds: secondsFrom(media.duration),
    channel: clean(media.channel, 80),
    platform: videoPlatform(url) || clean(media.siteName, 40),
    publishedOn: dayOf(media.published),
    source: 'page',
  };
}

// Words a minute for reading time; a common middle-of-the-road figure.
export const READING_WPM = 230;

export function articleFromCapture(media = {}) {
  const words = Number(media.wordCount);
  const wordCount = Number.isFinite(words) && words > 0 && words < 500000 ? Math.round(words) : null;
  return {
    author: clean(media.author, 80),
    siteName: clean(media.siteName, 80),
    publishedOn: dayOf(media.published),
    wordCount,
    readingMinutes: wordCount ? Math.max(1, Math.round(wordCount / READING_WPM)) : null,
    source: 'page',
  };
}

// --- films, shows and books ---------------------------------------------------------------------

// A single title's page on a film or book site: saved as a film/show or a book whatever the page's own
// data says (like the YouTube rule). Home pages, lists, reviews and search are not matched.
const TITLE_SITES = [
  // [host, path, kind, format]
  [/(^|\.)letterboxd\.com$/, /^\/film\/[^/]+\/?$/, 'media', ''],
  [/(^|\.)imdb\.com$/, /^\/(?:[a-z]{2}\/)?title\/tt\d+\/?$/, 'media', ''],
  [/(^|\.)rottentomatoes\.com$/, /^\/m\/[^/]+\/?$/, 'media', 'film'],
  [/(^|\.)rottentomatoes\.com$/, /^\/tv\/[^/]+(?:\/s\d+)?\/?$/, 'media', 'series'],
  [/(^|\.)themoviedb\.org$/, /^\/movie\/\d+[^/]*\/?$/, 'media', 'film'],
  [/(^|\.)themoviedb\.org$/, /^\/tv\/\d+[^/]*\/?$/, 'media', 'series'],
  [/(^|\.)justwatch\.com$/, /^\/[a-z]{2}\/(?:movie|film|filme|pelicula|elokuva)\/[^/]+\/?$/, 'media', 'film'],
  [/(^|\.)justwatch\.com$/, /^\/[a-z]{2}\/(?:tv-show|tv-series|serie|series|tv-serie|tv-sarja)\/[^/]+\/?$/, 'media', 'series'],
  [/(^|\.)trakt\.tv$/, /^\/movies\/[^/]+\/?$/, 'media', 'film'],
  [/(^|\.)trakt\.tv$/, /^\/shows\/[^/]+\/?$/, 'media', 'series'],
  [/(^|\.)goodreads\.com$/, /^\/(?:[a-z]{2}\/)?book\/show\/[^/]+\/?$/, 'book', ''],
  [/(^|\.)thestorygraph\.com$/, /^\/books\/[^/]+\/?$/, 'book', ''],
  [/(^|\.)openlibrary\.org$/, /^\/(?:works\/OL\d+W|books\/OL\d+M)(?:\/[^/]*)?\/?$/, 'book', ''],
  [/(^|\.)hardcover\.app$/, /^\/books\/[^/]+\/?$/, 'book', ''],
];

// { kind: 'media' | 'book', format: 'film' | 'series' | '' } for a title page on those sites, else null.
export function titleSite(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const hit = TITLE_SITES.find(([h, path]) => h.test(host) && path.test(u.pathname));
  return hit ? { kind: hit[2], format: hit[3] } : null;
}

const yearOf = (v) => {
  const m = String(v || '').match(/\b(1[89]\d{2}|20\d{2}|21\d{2})\b/);
  return m ? Number(m[1]) : null;
};
const names = (v, n) => list((Array.isArray(v) ? v : v ? [v] : []).map(nameOf), n, 80);

// schema.org Movie / TVSeries (IMDb, Letterboxd, Rotten Tomatoes…) -> film or show details.
export function mediaFromSchema(node) {
  if (!node || typeof node !== 'object') return null;
  const types = (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).map((t) => String(t || '').toLowerCase());
  const series = types.some((t) => t === 'tvseries' || t === 'tvseason');
  const seasons = Number(node.numberOfSeasons);
  return {
    format: series ? 'series' : 'film',
    year: yearOf(node.datePublished || node.startDate || node.dateCreated),
    director: names(node.director, 2).join(', ') || (series ? names(node.creator, 2).join(', ') : ''),
    runtimeMinutes: series ? null : minutesFrom(node.duration),
    seasons: series && Number.isFinite(seasons) && seasons > 0 && seasons < 200 ? seasons : null,
    genres: list(node.genre, 4, 30),
    source: 'page',
  };
}

// schema.org Book (Goodreads, Open Library, publishers' pages…) -> book details.
export function bookFromSchema(node) {
  if (!node || typeof node !== 'object') return null;
  const ed = Array.isArray(node.workExample) ? node.workExample[0] : node.workExample;
  const pages = Number(node.numberOfPages || ed?.numberOfPages);
  const isbn = String(node.isbn || ed?.isbn || '').replace(/[^\dXx]/g, '');
  return {
    author: names(node.author, 3).join(', '),
    year: yearOf(node.datePublished || ed?.datePublished || node.copyrightYear),
    pages: Number.isFinite(pages) && pages > 0 && pages < 20000 ? Math.round(pages) : null,
    isbn: /^(?:\d{9}[\dXx]|\d{13})$/.test(isbn) ? isbn.toUpperCase() : '',
    genres: list(node.genre, 4, 30),
    source: 'page',
  };
}

// --- details ------------------------------------------------------------------------------------

// 'ai': read by your AI provider from the post, page or links; 'ai-draft': mostly written by it.
// 'web': the post never wrote its recipe down, so your provider found a close one online (basedOn says where).
const RECIPE_SOURCES = ['page', 'caption', 'you', 'ai', 'ai-draft', 'web'];
// The page a 'web' recipe came from: https only, so the card's link is always one that opens.
function basedOnOf(v) {
  if (!v || typeof v !== 'object') return {};
  try {
    const u = new URL(String(v.url || ''));
    if (u.protocol !== 'https:') return {};
    return { basedOn: { url: u.href.slice(0, 1000), site: clean(v.site, 80) || u.hostname.replace(/^www\./, ''), title: clean(v.title, 200) } };
  } catch {
    return {};
  }
}
const WORKOUT_SOURCES = ['page', 'caption', 'you', 'ai', 'ai-draft'];
const PLACE_SOURCES = ['page', 'maps-link', 'you', 'ai'];
// Fields your AI provider drafted because the save didn't say (the recipe or routine is in the video).
const DRAFTABLE = { recipe: ['ingredients', 'steps', 'yield', 'totalMinutes', 'prepMinutes', 'cookMinutes'], workout: ['exercises', 'durationMinutes'] };
const draftedOf = (kind, details) => {
  const list = Array.isArray(details.drafted) ? details.drafted.filter((f) => DRAFTABLE[kind].includes(f)) : [];
  return list.length ? { drafted: [...new Set(list)] } : {};
};
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// Where looked-up details came from (OpenStreetMap, Wikidata, Open Library, or your AI provider), with a link.
const LOOKUP_SOURCES = ['OpenStreetMap', 'Wikidata', 'Open Library', 'AI', 'Web'];
// What confirmed a place's address and pin (Fix with AI's place check, placeResolve.js).
const CONFIRMED_BY = ['post', 'openstreetmap', 'cited-page', 'you'];
// Where a film or show streams: [{ service, how: 'subscription' | 'free' | 'rent' | 'buy' | '', url }].
const WATCH_HOW = ['subscription', 'free', 'rent', 'buy'];
function watchOf(v) {
  const out = [];
  for (const w of Array.isArray(v) ? v.slice(0, 12) : []) {
    if (!w || typeof w !== 'object') continue;
    const service = clean(w.service, 40);
    if (!service || out.some((x) => x.service.toLowerCase() === service.toLowerCase())) continue;
    const url = (() => { try { const u = new URL(String(w.url || '')); return u.protocol === 'https:' ? u.href.slice(0, 1000) : ''; } catch { return ''; } })();
    out.push({ service, how: WATCH_HOW.includes(w.how) ? w.how : '', url });
  }
  return out.slice(0, 8);
}

function cleanLookup(v) {
  if (!v || typeof v !== 'object' || !LOOKUP_SOURCES.includes(v.source)) return undefined;
  const url = typeof v.url === 'string' && /^https:\/\//.test(v.url) ? v.url.slice(0, 300) : '';
  // approximate: the pin is the street's, not the door's (the lookup knew the street but not the number).
  const by = Array.isArray(v.verifiedBy) ? [...new Set(v.verifiedBy.filter((x) => CONFIRMED_BY.includes(x)))] : [];
  const at = typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at)) ? v.at : '';
  return { source: v.source, url, ...(v.approximate === true ? { approximate: true } : {}), ...(by.length ? { verifiedBy: by } : {}), ...(at ? { at } : {}) };
}

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
      ...draftedOf('recipe', details),
      ...basedOnOf(details.basedOn),
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
      ...draftedOf('workout', details),
    };
  }
  if (kind === 'place') {
    return {
      address: clean(details.address, 200),
      locality: clean(details.locality, 80),
      region: clean(details.region, 80),
      postalCode: clean(details.postalCode, 20),
      country: clean(details.country, 60),
      lat: coord(details.lat, 90),
      lng: coord(details.lng, 180),
      phone: clean(details.phone, 40),
      cuisine: clean(details.cuisine, 120),
      priceRange: clean(details.priceRange, 20),
      hours: list(details.hours, 14, 80),
      category: clean(details.category, 40),
      source: PLACE_SOURCES.includes(details.source) ? details.source : 'you',
      ...(cleanLookup(details.lookup) ? { lookup: cleanLookup(details.lookup) } : {}),
    };
  }
  if (kind === 'video') {
    return {
      durationSeconds: secondsFrom(details.durationSeconds),
      channel: clean(details.channel, 80),
      platform: clean(details.platform, 40),
      publishedOn: DAY_ONLY.test(details.publishedOn || '') ? details.publishedOn : '',
      source: details.source === 'page' ? 'page' : 'you',
    };
  }
  if (kind === 'article') {
    const words = Number(details.wordCount);
    const mins = Number(details.readingMinutes);
    return {
      author: clean(details.author, 80),
      siteName: clean(details.siteName, 80),
      publishedOn: DAY_ONLY.test(details.publishedOn || '') ? details.publishedOn : '',
      wordCount: Number.isFinite(words) && words > 0 && words < 500000 ? Math.round(words) : null,
      readingMinutes: Number.isFinite(mins) && mins > 0 && mins < 2000 ? Math.round(mins) : null,
      source: details.source === 'page' ? 'page' : 'you',
    };
  }
  if (kind === 'media' || kind === 'book') {
    const num = (v, max) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= max && v !== '' && v !== null ? Math.round(Number(v)) : null);
    const year = num(details.year, 2200);
    const base = { year: year && year >= 1800 ? year : null, genres: list(details.genres, 4, 30), source: ['page', 'ai'].includes(details.source) ? details.source : 'you',
      ...(cleanLookup(details.lookup) ? { lookup: cleanLookup(details.lookup) } : {}),
      // What it's about, in your AI provider's words (understand.js readTitle).
      ...(clean(details.summary, 800) ? { summary: clean(details.summary, 800) } : {}) };
    if (kind === 'media') {
      const series = details.format === 'series';
      const endYear = num(details.endYear, 2200);
      const watch = watchOf(details.watch);
      return { format: series ? 'series' : 'film', ...base, director: clean(details.director, 160), runtimeMinutes: num(details.runtimeMinutes, 2000), seasons: num(details.seasons, 200),
        ...(series && num(details.episodes, 20000) ? { episodes: num(details.episodes, 20000) } : {}),
        ...(series && endYear && endYear >= (year || 1800) ? { endYear } : {}),
        ...(list(details.cast, 4, 60).length ? { cast: list(details.cast, 4, 60) } : {}),
        // Where to watch it, as your provider's web search found it on watchCheckedOn, for watchRegion.
        ...(watch.length ? { watch, watchRegion: /^[A-Z]{2}$/.test(String(details.watchRegion || '')) ? details.watchRegion : '', watchCheckedOn: DAY_ONLY.test(details.watchCheckedOn || '') ? details.watchCheckedOn : '' } : {}) };
    }
    const isbn = String(details.isbn || '').replace(/[^\dXx]/g, '');
    return { author: clean(details.author, 240), ...base, pages: num(details.pages, 20000), isbn: /^(?:\d{9}[\dXx]|\d{13})$/.test(isbn) ? isbn.toUpperCase() : '' };
  }
  if (kind === 'product') {
    // What your AI provider worked out the thing is (src/shared/understand.js understandProduct): the shop
    // page it found is the main source (shop*), its own summary sits alongside. Empty for a plain save.
    const url = (() => { try { const u = new URL(String(details.shopUrl || '')); return /^https?:$/.test(u.protocol) ? u.href.slice(0, 2000) : ''; } catch { return ''; } })();
    const specs = (Array.isArray(details.specs) ? details.specs : []).slice(0, 16)
      .map((s) => (s && typeof s === 'object' ? { label: clean(s.label, 40), value: clean(s.value, 160) } : null)).filter((s) => s && s.label && s.value);
    const out = {
      brand: clean(details.brand, 60),
      model: clean(details.model, 80),
      category: clean(details.category, 60),
      summary: clean(details.summary, 600),
      features: list(details.features, 10, 160),
      specs,
      shopUrl: url,
      shopName: clean(details.shopName, 80),
      shopTitle: clean(details.shopTitle, 200),
      shopDescription: clean(details.shopDescription, 1200),
      availability: ['in_stock', 'out_of_stock'].includes(details.availability) ? details.availability : '',
      source: ['page', 'ai', 'you'].includes(details.source) ? details.source : 'you',
    };
    const blank = (v) => v === '' || (Array.isArray(v) && !v.length);
    return Object.entries(out).some(([k, v]) => k !== 'source' && !blank(v)) ? out : {};
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
  if (kind === 'media') return [d.year, d.format === 'series' ? (d.seasons ? `Series · ${d.seasons} season${d.seasons === 1 ? '' : 's'}` : 'Series') : 'Film'].filter(Boolean).join(' · ');
  if (kind === 'book') return [d.author, d.year].filter(Boolean).join(' · ');
  if (kind === 'video') return [d.channel || d.platform, formatDuration(d.durationSeconds)].filter(Boolean).join(' · ');
  if (kind === 'article') return [d.siteName || d.author, d.readingMinutes ? `${d.readingMinutes} min read` : ''].filter(Boolean).join(' · ');
  if (kind === 'place') return [d.locality, d.cuisine || d.category, d.priceRange].filter(Boolean).join(' · ');
  if (kind === 'product' && formatPrice) return formatPrice(item.price, item.currency) || '';
  return '';
}

// What the page says this is, from the structured-data types the extractor found.
export function kindFromSchemaTypes(types) {
  const t = (types || []).map((x) => String(x).toLowerCase());
  if (t.some((x) => x === 'recipe')) return 'recipe';
  if (t.some((x) => ['product', 'productgroup', 'individualproduct', 'productmodel'].includes(x))) return 'product';
  if (t.some((x) => ['restaurant', 'foodestablishment', 'cafeorcoffeeshop', 'bakery', 'barorpub', 'icecreamshop', 'fastfoodrestaurant', 'winery', 'brewery', 'localbusiness', 'touristattraction', 'touristdestination',
    'museum', 'park', 'lodgingbusiness', 'hotel', 'hairsalon', 'beautysalon', 'nailsalon', 'dayspa', 'healthandbeautybusiness', 'healthclub', 'exercisegym', 'sportsactivitylocation', 'store', 'clothingstore',
    'sportinggoodsstore', 'bikestore', 'bookstore', 'shoestore', 'shoppingcenter', 'movietheater', 'nightclub', 'entertainmentbusiness', 'zoo', 'aquarium', 'amusementpark', 'artgallery'].includes(x))) return 'place';
  if (t.some((x) => ['movie', 'tvseries'].includes(x))) return 'media';
  if (t.some((x) => x === 'book')) return 'book';
  if (t.some((x) => ['exerciseplan', 'physicalactivity', 'exerciseaction'].includes(x))) return 'workout';
  // An article with a video in it is still an article.
  if (t.some((x) => ['article', 'newsarticle', 'blogposting', 'reportagenewsarticle', 'techarticle', 'analysisnewsarticle', 'opinionnewsarticle', 'reviewnewsarticle'].includes(x))) return 'article';
  if (t.some((x) => ['videoobject', 'tvepisode'].includes(x))) return 'video';
  return null;
}
