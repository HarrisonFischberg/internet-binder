// Which ingredients each step of a recipe uses, worked out from the words: "Whisk the yolks, egg and
// pecorino" takes "3 egg yolks", "1 whole egg" and "50 g pecorino romano, grated". An ingredient belongs
// to the first step that names it; a later step that names it again gets it as "from step N" (the egg
// mix, the cooked pasta). A few cooking words stand for a group ("pasta", "spices", "herbs").
// Ingredients no step names are kept aside so the recipe view can still show them.
// Pure, no browser APIs. The iPhone app has the same rules in StepIngredients.swift; keep them in step.

const PINCHES = new Set(['pinch', 'dash', 'handful', 'splash', 'knob']);
const UNITS = new Set(`g kg mg ml l cl dl tsp tbsp teaspoon tablespoon cup oz lb pound pinch dash handful can tin slice portion
  bunch sprig piece stick pack package jar clove knob splash`.split(/\s+/));
const DROP = new Set(`of and or a an the to for fresh dried ground whole large small medium big red green yellow white black extra virgin
  finely roughly thinly sliced chopped diced minced grated peeled crushed softened melted beaten divided taste plus more
  about optional cold warm hot room temperature canned soft-boiled boiled cooked raw ripe juiced zested halved quartered
  torn leave leaf`.split(/\s+/));
const GROUPS = {
  pasta: ['spaghetti', 'penne', 'rigatoni', 'linguine', 'fettuccine', 'tagliatelle', 'macaroni', 'orzo', 'noodle'],
  noodle: ['ramen', 'udon', 'soba'],
  spice: ['cumin', 'paprika', 'cinnamon', 'coriander', 'turmeric', 'chili', 'chilli', 'nutmeg', 'cardamom', 'allspice', 'cayenne'],
  herb: ['parsley', 'basil', 'cilantro', 'mint', 'dill', 'thyme', 'rosemary', 'chive', 'oregano', 'sage', 'tarragon'],
  cheese: ['pecorino', 'parmesan', 'parmigiano', 'feta', 'mozzarella', 'cheddar', 'ricotta', 'gruyere'],
};

const isNumber = (t) => t !== '' && /^[0-9.,/\-–¼½¾⅓⅔⅛]+$/.test(t) && /[0-9¼½¾⅓⅔⅛]/.test(t);

/** Lowercased, with a plural made singular: "tomatoes" → "tomato", "yolks" → "yolk". */
export function stem(word) {
  const w = word.toLowerCase();
  if (w.endsWith('oes') || w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2);
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Words of a text with where they are: [{ word, start, end }]. */
function tokens(text) {
  return [...String(text).matchAll(/[\p{L}'-]+/gu)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}
const words = (text) => tokens(text).map((t) => stem(t.word));

/** "200 g spaghetti" → { amount: "200 g", name: "spaghetti" }; "Pinch of salt" → { amount: "Pinch", name: "salt" };
 *  "1 cup (150 g) fine cornmeal" → { amount: "1 cup (150 g)", name: "fine cornmeal" }. */
export function splitIngredient(line) {
  const parts = String(line).trim().split(/\s+/).filter(Boolean);
  if (parts.length > 2 && PINCHES.has(parts[0].toLowerCase()) && parts[1].toLowerCase() === 'of') {
    return { amount: parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase(), name: parts.slice(2).join(' ') };
  }
  let taken = 0;
  let number = false;
  while (taken < parts.length) {
    const t = parts[taken].toLowerCase().replace(/^[.,]+|[.,]+$/g, '');
    // A second measure in brackets: "1 cup (150 g) cornmeal", "(395 g) condensed milk".
    const close = t.startsWith('(') && /\d/.test(t) ? parts.findIndex((x, k) => k >= taken && x.includes(')')) : -1;
    if (close >= 0) { number = true; taken = close + 1; continue; }
    if (isNumber(t)) { number = true; taken++; continue; }
    if (number && ['-', '–', 'to'].includes(t)) { taken++; continue; }
    const glued = t.match(/^([^a-z]+)([a-z]+)$/);   // "250g"
    if (glued && isNumber(glued[1]) && UNITS.has(glued[2])) { number = true; taken++; continue; }
    if (number && (UNITS.has(t) || UNITS.has(stem(t)))) { taken++; continue; }
    break;
  }
  if (!number || taken >= parts.length) return { amount: '', name: String(line).trim() };
  const rest = parts.slice(taken);
  if (rest[0]?.toLowerCase() === 'of' && rest.length > 1) rest.shift();
  return { amount: parts.slice(0, taken).join(' '), name: rest.join(' ') };
}

function said(text) {
  const s = new Set(words(text));
  for (const [word, members] of Object.entries(GROUPS)) if (s.has(word)) members.forEach((m) => s.add(m));
  return s;
}

/**
 * @returns {{ items: {index, amount, name}[], steps: { items: number[], carried: { fromStep: number, items: number[] }[] }[],
 *   unmatched: number[], highlights: (text: string, step: number) => { start: number, end: number }[] }}
 */
export function stepIngredients(steps = [], ingredients = []) {
  const items = ingredients.map((line, index) => ({ index, ...splitIngredient(line) }));
  const keys = items.map((it) => new Set(words(it.name).filter((w) => !DROP.has(w) && !UNITS.has(w) && w.length > 1)));
  const first = new Map();
  const perStep = steps.map((text, s) => {
    const heard = said(text);
    const step = { items: [], carried: [] };
    keys.forEach((k, i) => {
      if (![...k].some((w) => heard.has(w))) return;
      if (first.has(i)) {
        const from = first.get(i);
        const group = step.carried.find((c) => c.fromStep === from);
        if (group) group.items.push(i); else step.carried.push({ fromStep: from, items: [i] });
      } else {
        first.set(i, s);
        step.items.push(i);
      }
    });
    return step;
  });
  const unmatched = items.map((it) => it.index).filter((i) => !first.has(i));
  function highlights(text, s) {
    const step = perStep[s];
    if (!step) return [];
    const used = new Set([...step.items, ...step.carried.flatMap((c) => c.items)].flatMap((i) => [...keys[i]]));
    if (!used.size) return [];
    return tokens(text).filter((t) => {
      const w = stem(t.word);
      return used.has(w) || (GROUPS[w] || []).some((m) => used.has(m));
    }).map(({ start, end }) => ({ start, end }));
  }
  return { items, steps: perStep, unmatched, highlights };
}
