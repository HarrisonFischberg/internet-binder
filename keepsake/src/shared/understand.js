// What a save is, worked out by your AI provider, and that kind's details filled in: a recipe's ingredients
// and steps, a workout's exercises, a place's street, city and state, a film's year… Shared by the Chrome
// and Safari extensions and the iOS app (through JavaScriptCore). Runs only with Optional AI on and your
// own key: after each save and Instagram import, and from Fix with AI.
//
// The provider gets the save's text, the text of pages it links to (when the caller could read them) and
// its locally stored thumbnail (src/ai/provider.js understandWithAI). Its answer is checked here:
//   - a save becomes a Lifestyle kind only when the provider is sure (UNDERSTAND_CONFIDENCE), and never
//     when you filed it yourself;
//   - what the save already says (the page's recipe, the caption's ingredients) stays; the answer fills
//     the gaps;
//   - a list the save doesn't state (a recipe that is only in the video) is kept, marked as drafted
//     ("AI draft" on the card);
//   - a place's street address, phone and hours are kept only when the save states them.
// Every change goes to the AI change log with Undo.

import { uid, nowIso, decodeEntities } from './util.js';
import { kindOf, kindInfo, hasOwnView, kindChangePatch, sanitizeDetails, genericTitle, recipeFromSchema, placeFromSchema } from './kinds.js';
import { fillMissing } from './lookups.js';
import { understandWithAI } from '../ai/provider.js';

// How sure the provider must be to make a save a Lifestyle kind, or to change a Lifestyle kind Keepsake picked.
export const UNDERSTAND_CONFIDENCE = 0.7;
export const REKIND_CONFIDENCE = 0.85;

const SOCIAL = /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|x\.com|twitter\.com|threads\.net|pinterest\.[a-z.]+|linktr\.ee|beacons\.ai)$/i;
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

// Pages worth reading for a save: links in an Instagram caption (a "full recipe" link), and a web save's
// own page unless it is a product (captured already) or a social site (its pages need a login or a script).
export function pagesToRead(item) {
  const urls = [];
  for (const l of item.instagram?.links || []) if (/^https?:\/\//.test(l.url) && !SOCIAL.test(hostOf(l.url))) urls.push(l.url);
  if (item.type !== 'instagram' && kindOf(item) !== 'product' && /^https?:\/\//.test(item.url || '') && !SOCIAL.test(hostOf(item.url))) urls.unshift(item.url);
  return [...new Set(urls)].slice(0, 2);
}

// A page's text for the provider: its schema.org recipe or place written out, then what it says.
export function pageText(html) {
  const src = String(html || '').slice(0, 2_000_000);
  const parts = [];
  const nodes = [];
  const walk = (n, depth = 0) => {
    if (!n || depth > 5) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph'], depth + 1);
  };
  for (const m of src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* not JSON */ }
  }
  const types = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).map((t) => String(t || ''));
  const recipe = nodes.find((n) => types(n).includes('Recipe'));
  const r = recipe ? recipeFromSchema(recipe) : null;
  if (r && (r.ingredients?.length || r.steps?.length)) {
    parts.push(`The page's recipe: ${recipe.name ? `${decodeEntities(String(recipe.name))}. ` : ''}Ingredients: ${(r.ingredients || []).join('; ')}. Steps: ${(r.steps || []).join(' ')}${r.yield ? `. Makes ${r.yield}` : ''}${r.totalMinutes ? `. ${r.totalMinutes} minutes` : ''}.`);
  }
  const place = nodes.find((n) => types(n).some((t) => /Restaurant|LocalBusiness|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|Store|Hotel|TouristAttraction/.test(t)));
  const p = place ? placeFromSchema(place) : null;
  if (p) parts.push(`The page's place: ${[place.name ? decodeEntities(String(place.name)) : '', p.address, p.locality, p.region, p.postalCode, p.phone, p.cuisine, p.priceRange, ...(p.hours || [])].filter(Boolean).join(', ')}.`);
  const meta = (name) => decodeEntities((src.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)`, 'i')) || [])[1] || '');
  const desc = meta('og:description') || meta('description');
  if (desc) parts.push(desc);
  const body = decodeEntities(src
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (body) parts.push(body);
  return parts.join('\n').slice(0, 6000);
}

// What the provider is told about a save.
export function contextFor(item, pages = []) {
  const ig = item.instagram || {};
  const tag = ig.place ? [ig.place.name, ig.place.address, ig.place.city, ig.place.region].filter(Boolean).join(', ') : '';
  const d = item.details || {};
  const known = Object.fromEntries(Object.entries(d).filter(([k, v]) => !['source', 'drafted', 'lookup', 'lat', 'lng'].includes(k) && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
  return {
    title: item.title || '',
    kind: kindOf(item),
    // You put it in this Lifestyle view yourself: the answer is that kind's details.
    fixedKind: (item.userFields || []).includes('kind') && hasOwnView(kindOf(item)) ? kindOf(item) : '',
    caption: ig.caption || '',
    creator: ig.creator || '',
    hashtags: ig.hashtags || [],
    location: [ig.location, tag].filter(Boolean).join(' · '),
    description: item.description && item.description !== ig.caption ? item.description : '',
    site: item.retailer || item.host || '',
    url: item.url || '',
    known: Object.keys(known).length ? known : null,
    pages,
    image: typeof item.image === 'string' && item.image.startsWith('data:image/') ? item.image : '',
  };
}

const sourceTextOf = (input) => [input.title, input.caption, input.description, input.location, ...(input.hashtags || []), ...(input.pages || []).map((p) => p.text)]
  .filter(Boolean).join('\n').toLowerCase();

const FILLER = new Set(['cups', 'tbsp', 'tsp', 'grams', 'gram', 'ounces', 'pound', 'pounds', 'with', 'into', 'until', 'then', 'each', 'side', 'sides', 'reps', 'sets', 'minutes', 'minute', 'seconds', 'about', 'large', 'small', 'medium', 'fresh', 'chopped', 'sliced', 'diced', 'taste', 'plus', 'more', 'over', 'from', 'your', 'the', 'and', 'add', 'mix', 'stir', 'cook', 'heat']);

// How much of a list the save states: entries whose words mostly appear in its text.
export function statedShare(list, sourceText) {
  const entries = (list || []).map((e) => (typeof e === 'string' ? e : e?.name || '')).filter(Boolean);
  if (!entries.length) return 1;
  let stated = 0;
  for (const e of entries) {
    const words = (e.toLowerCase().match(/\p{L}{4,}/gu) || []).filter((w) => !FILLER.has(w));
    if (!words.length || words.filter((w) => sourceText.includes(w)).length / words.length >= 0.5) stated++;
  }
  return stated / entries.length;
}

const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
const MAIN = { recipe: ['ingredients', 'steps'], workout: ['exercises'] };

// The change the provider's answer makes to a save (pure: tested on its own).
export function planUnderstanding(item, ai, sourceText = '') {
  const current = kindOf(item);
  const mine = new Set(item.userFields || []);
  const handFiled = item.categorizationSource === 'manual' || mine.has('collectionId') || mine.has('kind');
  let kind = current;
  if (ai.kind !== current && hasOwnView(ai.kind) && !handFiled) {
    if (ai.confidence >= (hasOwnView(current) ? REKIND_CONFIDENCE : UNDERSTAND_CONFIDENCE)) kind = ai.kind;
  }
  if (!hasOwnView(kind)) return { patch: {}, changes: [], kind };
  const base = kind !== current ? kindChangePatch(item, kind) : { details: item.details || {} };
  const old = base.details || {};
  // Details you wrote (an empty card is "yours" only by default) are left as they are.
  const yours = old.source === 'you' && Object.entries(old).some(([k, v]) => !['source', 'drafted'].includes(k) && !empty(v));
  let details = old;
  if (ai.kind === kind && !yours) {
    const found = sanitizeDetails(kind, { ...ai.details, source: 'ai' });
    delete found.source;
    if (kind === 'place') {
      // Only what the save says: an address, phone or hours the text doesn't contain are left out.
      const said = (v) => { const digits = String(v || '').match(/\d+/g) || []; return digits.length > 0 && digits.every((x) => sourceText.includes(x)); };
      if (found.address && !said(found.address)) found.address = '';
      if (found.phone && !said(found.phone)) found.phone = '';
      if (found.hours?.length && !found.hours.every(said)) found.hours = [];
      if (found.postalCode && !sourceText.includes(found.postalCode)) found.postalCode = '';
      for (const k of ['lat', 'lng']) delete found[k];
    }
    const merged = fillMissing(old, found);
    const filled = Object.keys(found).filter((k) => empty(old[k]) && !empty(merged[k]));
    const drafted = new Set((ai.drafted || []).filter((f) => filled.includes(f)));
    for (const f of MAIN[kind] || []) if (filled.includes(f) && statedShare(merged[f], sourceText) < 0.5) drafted.add(f);
    if (filled.length) {
      // The card's source: what the save said when it had the main part (a page's or caption's recipe),
      // else your provider (a draft when it wrote the main part).
      const fromSave = (MAIN[kind] || []).some((f) => !empty(old[f])) || (kind === 'place' && !empty(old.address));
      merged.source = fromSave && old.source !== 'you' ? old.source : (MAIN[kind] || []).some((f) => drafted.has(f)) ? 'ai-draft' : 'ai';
      merged.drafted = [...new Set([...(old.drafted || []), ...drafted])];
      details = sanitizeDetails(kind, merged);
    }
  }
  const patch = {};
  const changes = [];
  if (kind !== current) {
    Object.assign(patch, { kind, collectionId: null, needsReview: false, categorizationSource: 'ai', confidence: ai.confidence, categorizationReason: `AI: ${ai.reason || `a ${kindInfo(kind).label.toLowerCase()}`}`.slice(0, 300) });
    if (item.collectionId) patch.previousCollections = [...(item.previousCollections || []), item.collectionId].slice(-20);
    changes.push({ field: 'kind', from: kindInfo(current).label, to: kindInfo(kind).plural });
  }
  if (JSON.stringify(details) !== JSON.stringify(item.details || {})) {
    patch.details = details;
    changes.push({ field: `${kindInfo(kind).label.toLowerCase()} details`, from: '—', to: details.drafted?.length ? 'filled in (some drafted)' : 'filled in' });
  }
  // The thing's own name, for a post (its title is the caption's first line) or a page titled after its site.
  const title = ai.kind === kind && ai.title.length >= 3 ? ai.title : base.title || '';
  if (title && title !== item.title && !mine.has('title') && (item.type === 'instagram' || genericTitle(item.title) || base.title)) {
    patch.title = title;
    changes.push({ field: 'title', from: item.title, to: title });
  }
  return { patch, changes, kind };
}

const LOGGED = ['kind', 'details', 'title', 'collectionId', 'needsReview', 'categorizationSource', 'categorizationReason', 'confidence', 'previousCollections'];

// Reads one save with your provider and applies the answer. Once per save unless force (Fix with AI,
// Check with AI). fetchPage(url) returns a page's HTML, or null when it can't or mayn't be read.
// Throws when the provider fails, so a batch can stop on a bad key.
export async function understandItem(store, id, { force = false, runId = '' } = {}, { fetchPage = async () => null } = {}) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || (item.understoodAt && !force)) return null;
  const settings = await store.getSettings();
  const key = settings.ai?.on ? await store.getSecret('aiApiKey') : '';
  if (!key) return null;
  const pages = [];
  for (const url of pagesToRead(item)) {
    try {
      const html = await fetchPage(url);
      const text = html ? pageText(html) : '';
      if (text) pages.push({ url, text });
    } catch {
      /* unreadable: the save's own text still goes */
    }
  }
  const input = contextFor(item, pages);
  const ai = await understandWithAI(input, settings, key);
  // Anything you changed in the meantime wins.
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return null;
  const { patch, changes, kind } = planUnderstanding(current, ai, sourceTextOf(input));
  const before = Object.fromEntries(LOGGED.filter((f) => f in patch).map((f) => [f, current[f] === undefined ? null : current[f]]));
  await store.updateItem(id, { ...patch, understoodAt: nowIso() }, { by: 'ai' });
  if (changes.length) {
    await store.appendAiLog([{ id: uid(), runId: runId || `understand-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after: patch, reason: ai.reason || '', undone: false }]);
  }
  return { kind, changed: changes.length > 0, aiKind: ai.kind, confidence: ai.confidence };
}
