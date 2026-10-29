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
//
// Something to buy (often an Instagram or Facebook post whose picture is right but whose caption is vague or
// wrong) gets a second read, understandProduct: the provider looks at the picture, works out what the product
// really is, and searches the web for its own page. That page, read here, is the card's main source (its
// name, price, description and specs); the provider's summary sits alongside it.
//
// A book, film or show gets a read of its own too, readTitle: the provider searches for it and writes what
// it's about, fills in the facts the card is missing (a show's seasons, a book's pages), names a page about
// it whose cover or poster becomes the card's picture when it has none, and for a film or show says where it
// streams in your country, as found on the day it looked (watchCheckedOn).
//
// A recipe that is still thin after that (a Reel that only shows the dish: no ingredients or steps in the
// caption, so the first read had little to go on) gets a web read with your key, readRecipe: the provider
// searches for a published recipe as close to the dish as it can find, and that page's recipe goes on the
// card, labelled "Based on a recipe from <site>" with its link, so it is never taken for the creator's own.

import { uid, nowIso, decodeEntities, parsePrice, prettyRetailer, hostnameOf, formatPrice } from './util.js';
import { isSocialHost } from './categorizer.js';
import { guessTopics } from './topics.js';
import { mentionsFood, isWorkoutPost, kindOf, kindInfo, hasOwnView, kindChangePatch, sanitizeDetails, genericTitle, recipeFromSchema, placeFromSchema, titleSite } from './kinds.js';
import { fillMissing } from './lookups.js';
import { understandWithAI, understandProductWithAI, understandTitleWithAI, findRecipeWithAI, supportsWebLookup, keyFor, aiAvailable } from '../ai/provider.js';

// How sure the provider must be to make a save a Lifestyle kind, or to change a Lifestyle kind Internet Binder picked.
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
  // Every reel is a video and every carousel reads like an article: on a social post that's its format,
  // not what it's about, so it stays where its topic puts it (AI tips stay with AI).
  const formatOnly = (ai.kind === 'video' || ai.kind === 'article') && (item.type === 'instagram' || isSocialHost(item.host || hostOf(item.url)));
  // A recipe needs something to eat and a workout something to do, in the save's own words: "a recipe for
  // an AI agent" and "training a model" stay what they are whatever the model says.
  const said = textOf(item);
  const unsupported = ['recipe', 'workout', 'product'].includes(ai.kind) && techTopic(said) && !(ai.kind === 'recipe' && mentionsFood(said)) && !(ai.kind === 'workout' && isWorkoutPost(said));
  if (ai.kind !== current && hasOwnView(ai.kind) && !handFiled && !formatOnly && !unsupported) {
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

const LOGGED = ['kind', 'details', 'title', 'image', 'images', 'price', 'currency', 'collectionId', 'needsReview', 'categorizationSource', 'categorizationReason', 'confidence', 'previousCollections'];

// --- A book, film or show ---------------------------------------------------------------------------

// How sure the provider must be which title it is before its facts, picture and streaming go on the card.
export const TITLE_CONFIDENCE = 0.6;
export const TITLE_KINDS = ['book', 'media'];

// The cover or poster on a page about a title (its Open Graph or schema.org image), without a DOM.
export function titlePicture(html, baseUrl = '') {
  const src = String(html || '').slice(0, 2_000_000);
  const meta = (name) => decodeEntities((src.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))
    || src.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i')) || [])[1] || '').trim();
  let schema = '';
  for (const m of src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const nodes = [].concat(JSON.parse(m[1].trim())).flatMap((n) => (n && n['@graph'] ? [n, ...[].concat(n['@graph'])] : [n]));
      const hit = nodes.find((n) => n && /^(book|movie|tvseries|tvseason|creativework)$/i.test(String([].concat(n['@type'])[0] || '')) && n.image);
      if (hit) { const img = [].concat(hit.image)[0]; schema = typeof img === 'string' ? img : img?.url || img?.contentUrl || ''; break; }
    } catch { /* not JSON */ }
  }
  for (const raw of [schema, meta('og:image'), meta('twitter:image')].filter((v) => typeof v === 'string' && v.trim())) {
    try {
      const u = new URL(String(raw || '').trim(), baseUrl || undefined);
      // A site's own logo or placeholder isn't the cover.
      if (u.protocol === 'https:' && !/logo|placeholder|default[-_]?(?:image|cover)|favicon|\.svg$/i.test(u.pathname)) return u.href;
    } catch { /* not a URL */ }
  }
  return '';
}

const today = () => nowIso().slice(0, 10);
const regionNow = () => { try { return (new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize().region || 'US').toUpperCase(); } catch { return 'US'; } };

// The change the provider's title answer (and the picture found on a page about it) makes to a save (pure).
export function planTitle(item, ai, picture = '', { on = today() } = {}) {
  const kind = kindOf(item);
  const mine = new Set(item.userFields || []);
  const patch = {};
  const changes = [];
  if (!TITLE_KINDS.includes(kind) || ai.kind !== kind || ai.confidence < TITLE_CONFIDENCE) return { patch, changes };
  const old = item.details || {};
  const found = { ...ai.details };
  if (kind === 'book') for (const k of ['format', 'endYear', 'director', 'cast', 'seasons', 'episodes', 'runtimeMinutes', 'watch']) delete found[k];
  else for (const k of ['author', 'pages']) delete found[k];
  const watch = found.watch || [];
  delete found.watch;
  let merged = fillMissing(old, found);
  // A save that only guessed "film" (a title site that doesn't say) takes the provider's show.
  if (kind === 'media' && found.format && found.format !== old.format && old.source !== 'you' && !mine.has('details')) merged.format = found.format;
  if (watch.length) Object.assign(merged, { watch, watchRegion: ai.region || '', watchCheckedOn: on });
  merged.source = ['page', 'you'].includes(old.source) ? old.source : 'ai';
  merged = sanitizeDetails(kind, merged);
  if (JSON.stringify(merged) !== JSON.stringify(sanitizeDetails(kind, old))) {
    patch.details = merged;
    const what = [!old.summary && merged.summary ? 'summary' : '', watch.length ? 'where to watch' : ''].filter(Boolean);
    changes.push({ field: `${kindInfo(kind).label.toLowerCase()} details`, from: '—', to: what.length ? `filled in (${what.join(', ')})` : 'filled in' });
  }
  if (picture && !item.image && !mine.has('image')) {
    Object.assign(patch, { image: picture, images: [picture] });
    changes.push({ field: 'picture', from: 'none', to: kind === 'book' ? 'the cover' : 'the poster' });
  }
  if (ai.title && ai.title.length >= 2 && ai.title !== item.title && !mine.has('title') && (item.type === 'instagram' || genericTitle(item.title))) {
    patch.title = ai.title;
    changes.push({ field: 'title', from: item.title, to: ai.title });
  }
  return { patch, changes };
}

// The title read: the provider's search, then the cover or poster from the save's own page (a book or film
// site) or the page the provider found.
async function readTitle(item, settings, key, pages, image, { fetchShopPage, region }) {
  const d = item.details || {};
  const known = Object.fromEntries(Object.entries(d).filter(([k, v]) => !['source', 'lookup', 'watch', 'watchRegion', 'watchCheckedOn'].includes(k) && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
  const ig = item.instagram || {};
  const ai = await understandTitleWithAI({
    kind: kindOf(item), title: item.title || '', caption: ig.caption || '', description: item.description && item.description !== ig.caption ? item.description : '',
    site: item.retailer || item.host || '', url: item.url || '', known: Object.keys(known).length ? known : null, region, pages, image,
  }, settings, key);
  ai.region = ai.details.watch?.length ? region : '';
  let picture = '';
  if (!item.image && ai.confidence >= TITLE_CONFIDENCE) {
    for (const url of [...new Set([titleSite(item.url || '') ? item.url : '', ai.page].filter(Boolean))]) {
      try {
        const html = await fetchShopPage(url);
        picture = html ? titlePicture(html, url) : '';
      } catch {
        /* unreadable: try the next */
      }
      if (picture) break;
    }
  }
  return { ai, picture };
}

// --- A recipe the post never wrote down -------------------------------------------------------------

// How close the provider must say a recipe it found is before it goes on the card.
export const RECIPE_CONFIDENCE = 0.5;

// Too little to cook from: fewer than three ingredients, or no more than one step.
export function thinRecipe(details = {}) {
  return (details.ingredients || []).length < 3 || (details.steps || []).length < 2;
}

// Whether a recipe save may get a close recipe from the web: it is thin, and what's on it isn't the save's own
// page recipe or yours.
export function wantsWebRecipe(item) {
  const d = item.details || {};
  if (kindOf(item) !== 'recipe' || (item.userFields || []).includes('details')) return false;
  // An empty card is "yours" only by default.
  const said = (d.ingredients || []).length || (d.steps || []).length;
  if (d.source === 'page' || (d.source === 'you' && said)) return false;
  return thinRecipe(d);
}

// The recipe on a page it found, from the page's schema.org Recipe (what the site itself publishes).
export function recipeFromHtml(html) {
  const src = String(html || '').slice(0, 2_000_000);
  const nodes = [];
  const walk = (n, depth = 0) => {
    if (!n || depth > 5 || nodes.length > 200) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph'], depth + 1);
  };
  for (const m of src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* not JSON */ }
  }
  const node = nodes.find((n) => [].concat(n['@type']).map(String).includes('Recipe'));
  const r = node ? recipeFromSchema(node) : null;
  const m = src.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=(?:"([^"]*)"|'([^']*)')/i);
  const siteName = decodeEntities((m && (m[1] ?? m[2])) || '').trim();
  return r ? { ...r, title: node.name ? decodeEntities(String(node.name)).trim() : '', siteName } : null;
}

// The change a recipe found online makes to a save (pure): the page's own recipe when it could be read,
// else what the provider read from it; always with where it came from.
export function planRecipe(item, found, page = null) {
  const patch = {};
  const changes = [];
  if (!found?.url || found.confidence < RECIPE_CONFIDENCE || !wantsWebRecipe(item)) return { patch, changes };
  const from = page && page.ingredients?.length >= 3 ? page : found;
  if (thinRecipe(from)) return { patch, changes };
  const old = item.details || {};
  const site = page?.siteName || found.site || prettyRetailer(hostnameOf(found.url));
  const details = sanitizeDetails('recipe', {
    ...old,
    ingredients: from.ingredients,
    steps: from.steps,
    yield: from.yield || old.yield,
    totalMinutes: from.totalMinutes || old.totalMinutes,
    prepMinutes: page?.prepMinutes || old.prepMinutes,
    cookMinutes: page?.cookMinutes || old.cookMinutes,
    cuisine: old.cuisine || page?.cuisine || '',
    category: old.category || page?.category || '',
    source: 'web',
    drafted: [],
    basedOn: { url: found.url, site, title: page?.title || found.title },
  });
  patch.details = details;
  changes.push({ field: 'recipe details', from: `${(old.ingredients || []).length} ingredient${(old.ingredients || []).length === 1 ? '' : 's'}`, to: `based on a recipe from ${details.basedOn?.site || site}` });
  return { patch, changes };
}

// The web read: the provider's search, then the page itself for its own recipe.
async function readRecipe(item, settings, key, { fetchShopPage }) {
  const ig = item.instagram || {};
  const found = await findRecipeWithAI({
    title: item.title || '', caption: ig.caption || '', creator: ig.creator || '', hashtags: ig.hashtags || [],
    description: item.description && item.description !== ig.caption ? item.description : '', site: item.retailer || item.host || '',
  }, settings, key);
  let page = null;
  if (found?.url && found.confidence >= RECIPE_CONFIDENCE) {
    try {
      const html = await fetchShopPage(found.url);
      page = html ? recipeFromHtml(html) : null;
    } catch {
      /* unreadable: what the provider read from it still goes */
    }
  }
  return { found, page };
}

// --- Something to buy -----------------------------------------------------------------------------

// How sure the provider must be of what a product is before its name, shop page and price are used.
export const PRODUCT_CONFIDENCE = 0.6;

// A shop page's own facts, from the structured data shops publish for search engines (schema.org Product,
// then Open Graph and product meta tags). Plain string parsing: it runs in Chrome's worker and in
// JavaScriptCore on iOS, neither of which has a DOM.
export function productFromHtml(html, baseUrl = '') {
  const src = String(html || '').slice(0, 3_000_000);
  const nodes = [];
  const walk = (n, depth = 0) => {
    if (!n || depth > 6 || nodes.length > 200) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph'], depth + 1);
  };
  for (const m of src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* not JSON */ }
  }
  const types = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).map((t) => String(t || ''));
  const isProduct = (n) => types(n).some((t) => /^(product|productgroup|individualproduct|productmodel)$/i.test(t));
  const product = nodes.find((n) => isProduct(n) && n.offers) || nodes.find(isProduct) || null;
  const meta = (name) => decodeEntities((src.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))
    || src.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${name}["']`, 'i')) || [])[1] || '').trim();
  const text = (v) => decodeEntities(String(v ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const nameOf = (v) => text(v && typeof v === 'object' ? v.name : v);
  const abs = (v) => {
    const s = typeof v === 'string' ? v : v && typeof v === 'object' ? v.url || v.contentUrl || '' : '';
    try { const u = new URL(s.trim(), baseUrl || undefined); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
  };
  let price = null;
  let currency = '';
  let availability = '';
  const offers = product ? [].concat(product.offers || []).flatMap((o) => (o && o.offers ? [o, ...[].concat(o.offers)] : [o])) : [];
  for (const o of offers.slice(0, 20)) {
    if (!o || typeof o !== 'object') continue;
    const cur = String(o.priceCurrency || o.priceSpecification?.priceCurrency || '').toUpperCase();
    for (const v of [o.price, o.lowPrice, o.priceSpecification?.price]) {
      const p = parsePrice(v, cur);
      if (price === null && p && p.amount > 0) { price = p.amount; currency = cur || p.currency || ''; }
    }
    if (!availability && o.availability) availability = /outofstock|soldout|discontinued/i.test(String(o.availability)) ? 'out_of_stock' : /instock|limitedavailability|preorder/i.test(String(o.availability)) ? 'in_stock' : '';
  }
  if (price === null) {
    const cur = (meta('product:price:currency') || meta('og:price:currency') || meta('priceCurrency')).toUpperCase();
    const p = parsePrice(meta('product:price:amount') || meta('og:price:amount') || meta('price'), cur);
    if (p && p.amount > 0) { price = p.amount; currency = cur || p.currency || ''; }
  }
  if (!availability) {
    const a = meta('product:availability') || meta('og:availability');
    if (a) availability = /out|sold/i.test(a) ? 'out_of_stock' : 'in_stock';
  }
  const specs = [];
  const spec = (label, v) => { const value = Array.isArray(v) ? v.map(nameOf).filter(Boolean).join(', ') : nameOf(v); if (value && value.length <= 160) specs.push({ label, value }); };
  if (product) {
    spec('Colour', product.color);
    spec('Material', product.material);
    spec('Size', product.size);
    if (product.width || product.height || product.depth) spec('Dimensions', [product.width, product.height, product.depth].map((d) => (d && typeof d === 'object' ? [d.value, d.unitText || d.unitCode].filter(Boolean).join(' ') : d)).filter(Boolean).join(' × '));
    if (product.weight) spec('Weight', typeof product.weight === 'object' ? [product.weight.value, product.weight.unitText || product.weight.unitCode].filter(Boolean).join(' ') : product.weight);
    for (const pv of [].concat(product.additionalProperty || []).slice(0, 10)) if (pv && pv.name) spec(text(pv.name).slice(0, 40), pv.value);
  }
  const name = product ? nameOf(product.name) : '';
  return {
    name: name.slice(0, 200),
    title: (name || meta('og:title') || text((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')).slice(0, 200),
    brand: product ? nameOf(product.brand || product.manufacturer).slice(0, 60) : '',
    description: text(product?.description || meta('og:description') || meta('description')).slice(0, 1200),
    category: product ? nameOf(product.category).slice(0, 60) : '',
    sku: product ? text(product.sku || product.mpn || product.model?.name || product.model || '').slice(0, 60) : '',
    price,
    currency,
    availability,
    image: abs(product ? [].concat(product.image || [])[0] : null) || abs(meta('og:image')),
    siteName: meta('og:site_name').slice(0, 80),
    specs: specs.slice(0, 16),
    url: baseUrl,
    structured: !!product,
  };
}

// Shopping saves the provider reads as a product: anything already a product, a post or link saved into
// a collection (collections are for shopping), or a post the first read says is one thing to buy.
// A post about AI or code (by its own words) is about a topic: not one thing to buy, a dish or a workout,
// whatever the model says ("a recipe for an AI agent", "training a model", "10 Claude plugins").
const techTopic = (text) => guessTopics({ description: text }).some((t) => t === 'AI' || t === 'Programming');
const textOf = (item) => `${item.title || ''}\n${item.instagram?.caption || ''}\n${item.description || ''}`;
export function isShopping(item, ai = null) {
  const kind = kindOf(item);
  if (kind === 'product') return true;
  if (hasOwnView(kind)) return false;
  const social = item.type === 'instagram' || isSocialHost(item.host || hostOf(item.url));
  if (social && techTopic(textOf(item))) return false;
  if (item.collectionId && !social) return true;
  return !!ai && ai.kind === 'product' && ai.confidence >= UNDERSTAND_CONFIDENCE;
}

// The change the provider's product answer (and the shop page it found) makes to a save (pure).
export function planProduct(item, ai, page = null) {
  const mine = new Set(item.userFields || []);
  const current = kindOf(item);
  const patch = {};
  const changes = [];
  if (current !== 'product' && !mine.has('kind') && !hasOwnView(current)) {
    patch.kind = 'product';
    changes.push({ field: 'kind', from: kindInfo(current).label, to: kindInfo('product').label });
  }
  const sure = ai.confidence >= PRODUCT_CONFIDENCE;
  const listing = sure ? ai.listing : null;
  const shop = sure && page && (page.structured || page.title) ? page : null;
  const old = current === 'product' ? item.details || {} : {};
  const yours = old.source === 'you' && Object.entries(old).some(([k, v]) => k !== 'source' && v !== '' && !(Array.isArray(v) && !v.length));
  if (!yours) {
    const specs = [...(shop?.specs || [])];
    for (const s of ai.specs || []) if (!specs.some((x) => x.label.toLowerCase() === s.label.toLowerCase())) specs.push(s);
    const shopUrl = shop?.url || listing?.url || '';
    const details = sanitizeDetails('product', {
      brand: shop?.brand || (sure ? ai.brand : ''),
      model: shop?.sku || (sure ? ai.model : ''),
      category: shop?.category || ai.category,
      summary: ai.summary,
      features: sure ? ai.features : [],
      specs: sure ? specs : [],
      shopUrl,
      shopName: shopUrl ? listing?.retailer || shop?.siteName || prettyRetailer(hostnameOf(shopUrl)) : '',
      shopTitle: shop?.title || listing?.title || '',
      shopDescription: shop?.description || '',
      availability: shop?.availability || listing?.availability || '',
      source: shop ? 'page' : 'ai',
    });
    if (JSON.stringify(details) !== JSON.stringify(old)) {
      patch.details = details;
      changes.push({ field: 'product details', from: '—', to: shop ? `from ${details.shopName || 'its shop page'}` : 'AI summary' });
    }
  }
  // Its real name: the shop page's, else the provider's. A post's title is its caption's first line, so
  // it's replaced; a shop page's own title stays unless it's a site's name.
  const name = shop?.name || (sure ? ai.name : '');
  const renames = item.type === 'instagram' || item.type === 'inspiration' || genericTitle(item.title) || current !== 'product' || /facebook\.com$/i.test(item.host || '');
  if (name && name.length >= 3 && name !== item.title && !mine.has('title') && renames) {
    patch.title = name;
    changes.push({ field: 'title', from: item.title, to: name });
  }
  const price = shop?.price ?? listing?.price ?? null;
  if (price !== null && (item.price === null || item.price === undefined) && !mine.has('price')) {
    patch.price = price;
    patch.currency = (shop?.price != null ? shop.currency : listing?.currency) || item.currency || '';
    changes.push({ field: 'price', from: 'none', to: formatPrice(price, patch.currency) || String(price) });
  }
  return { patch, changes };
}

// What the provider is told about a product.
function productInput(item, pages, image) {
  const ig = item.instagram || {};
  return {
    title: item.title || '',
    caption: ig.caption || '',
    creator: ig.creator || '',
    hashtags: ig.hashtags || [],
    description: item.description && item.description !== ig.caption ? item.description : '',
    site: item.retailer || item.host || '',
    url: item.url || '',
    price: item.price != null ? formatPrice(item.price, item.currency) || String(item.price) : '',
    products: ig.products || [],
    pages,
    image,
  };
}

// The save's picture for the provider: a stored thumbnail as it is, else (when the caller can) a small copy
// of the picture the card already shows, made on this device.
async function pictureOf(item, loadImage) {
  if (typeof item.image === 'string' && item.image.startsWith('data:image/')) return item.image;
  if (!/^https:\/\//.test(item.image || '')) return '';
  try {
    const data = await loadImage(item.image);
    return typeof data === 'string' && data.startsWith('data:image/') ? data : '';
  } catch {
    return '';
  }
}

// The product read: the picture, what it is, its own page. Returns the plan, or null when nothing changes.
async function readProduct(item, settings, key, pages, image, { fetchShopPage }) {
  const ai = await understandProductWithAI(productInput(item, pages, image), settings, key);
  let page = null;
  if (ai.listing?.url && ai.confidence >= PRODUCT_CONFIDENCE) {
    try {
      const html = await fetchShopPage(ai.listing.url);
      const read = html ? productFromHtml(html, ai.listing.url) : null;
      if (read && (read.structured || read.price !== null)) page = read;
    } catch {
      /* unreadable: the search's own facts still go on the card */
    }
  }
  return { ai, page };
}

// Reads one save with your provider and applies the answer. Once per save unless force (Fix with AI,
// Check with AI). fetchPage(url) returns a page's HTML, or null when it can't or mayn't be read (the save's own
// page and pages its caption links to); fetchShopPage(url) the same for the shop page your provider's search
// found for a product (fetchPage unless the caller says otherwise); loadImage(url) returns a small data: copy
// of a picture, or null.
// Throws when the provider fails, so a batch can stop on a bad key.
export async function understandItem(store, id, { force = false, runId = '' } = {}, { fetchPage = async () => null, fetchShopPage = fetchPage, loadImage = async () => null, region = '', deviceOnly = false } = {}) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || (item.understoodAt && !force)) return null;
  const settings = await store.getSettings();
  // Apple Intelligence on this device reads it first; your key (while Optional AI is on) is the backup, except
  // in work that runs by itself (deviceOnly).
  const key = keyFor(settings, await store.getSecret('aiApiKey'), { deviceOnly });
  if (!aiAvailable(settings, key)) return null;
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
  // A product saved from its own shop page needs no first read: it is a product.
  const shopPage = item.type === 'product' && kindOf(item) === 'product' && !/facebook\.com$/i.test(item.host || '');
  // Nor does a book, film or show saved from its own page on a book or film site.
  const titlePage = TITLE_KINDS.includes(kindOf(item)) && titleSite(item.url || '')?.kind === kindOf(item);
  const image = await pictureOf(item, loadImage);
  let input = null;
  let ai = null;
  if (!shopPage && !titlePage) {
    input = { ...contextFor(item, pages), image };
    ai = await understandWithAI(input, settings, key);
  }
  // Anything you changed in the meantime wins.
  let current = await store.getItem(id);
  if (!current || current.deletedAt) return null;
  let { patch, changes, kind } = ai ? planUnderstanding(current, ai, sourceTextOf(input)) : { patch: {}, changes: [], kind: kindOf(current) };
  let reason = ai?.reason || '';
  let confidence = ai?.confidence ?? null;
  if (!hasOwnView(kind) && isShopping(current, ai)) {
    const { ai: found, page } = await readProduct(current, settings, key, pages, image, { fetchShopPage });
    current = (await store.getItem(id)) || current;
    const product = planProduct({ ...current, ...patch }, found, page);
    patch = { ...patch, ...product.patch };
    changes = [...changes, ...product.changes];
    if (product.patch.kind) kind = 'product';
    else kind = kindOf({ ...current, ...patch });
    reason = found.reason || reason;
    confidence = found.confidence;
  }
  if (TITLE_KINDS.includes(kind)) {
    const { ai: found, picture } = await readTitle({ ...current, ...patch }, settings, key, pages, image, { fetchShopPage, region: region || regionNow() });
    current = (await store.getItem(id)) || current;
    const title = planTitle({ ...current, ...patch }, found, picture);
    patch = { ...patch, ...title.patch };
    changes = [...changes, ...title.changes];
    reason = found.reason || reason;
    confidence = found.confidence;
  }
  // Still too thin to cook from: a close recipe from the web, with your key (the device model can't search).
  if (kind === 'recipe' && key && supportsWebLookup(settings) && wantsWebRecipe({ ...current, ...patch })) {
    const { found, page } = await readRecipe({ ...current, ...patch }, settings, key, { fetchShopPage });
    current = (await store.getItem(id)) || current;
    const recipe = planRecipe({ ...current, ...patch }, found, page);
    if (recipe.changes.length) {
      patch = { ...patch, ...recipe.patch };
      changes = [...changes.filter((c) => c.field !== 'recipe details'), ...recipe.changes];
      reason = found.reason || reason;
    }
  }
  const before = Object.fromEntries(LOGGED.filter((f) => f in patch).map((f) => [f, current[f] === undefined ? null : current[f]]));
  await store.updateItem(id, { ...patch, understoodAt: nowIso(), needsAi: false }, { by: 'ai' });
  if (changes.length) {
    await store.appendAiLog([{ id: uid(), runId: runId || `understand-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after: patch, reason, undone: false }]);
  }
  return { kind, changed: changes.length > 0, moved: 'kind' in patch, aiKind: ai?.kind || kind, confidence };
}
