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
//
// When even that misses, you can point it to the right page yourself: Import recipe from a link
// (importRecipeFromLink) reads the page you paste, takes its own recipe card, or has AI read the recipe
// from its text, and fills in the same save, labelled "Recipe from <site>" with the link.

import { uid, nowIso, decodeEntities, parsePrice, prettyRetailer, hostnameOf, formatPrice } from './util.js';
import { isSocialHost, classify, AUTO_FILE_CONFIDENCE, learnFromCorrection } from './categorizer.js';
import { REFILE_CONFIDENCE } from './aiFix.js';
import { guessTopics } from './topics.js';
import { mentionsFood, isWorkoutPost, kindOf, kindInfo, hasOwnView, kindChangePatch, sanitizeDetails, genericTitle, isPostSave, recipeFromSchema, placeFromSchema, titleSite } from './kinds.js';
import { fillMissing } from './lookups.js';
import { understandWithAI, understandProductWithAI, understandTitleWithAI, findRecipeWithAI, readRecipePageWithAI, supportsWebLookup, keyFor, aiAvailable } from '../ai/provider.js';

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
  for (const m of src.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
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
  if (title && title !== item.title && !mine.has('title') && (isPostSave(item) || genericTitle(item.title) || base.title)) {
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
  for (const m of src.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
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
export const regionNow = () => { try { return (new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize().region || 'US').toUpperCase(); } catch { return 'US'; } };

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
  if (ai.title && ai.title.length >= 2 && ai.title !== item.title && !mine.has('title') && (isPostSave(item) || genericTitle(item.title))) {
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
  for (const m of src.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
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

// --- A recipe from a link you paste ---------------------------------------------------------------------

// The link as typed: "www.site.com/x" works too, and http becomes https. Only a web page.
export function recipeLink(text) {
  let v = String(text || '').trim();
  const inText = v.match(/https?:\/\/\S+/i);
  if (inText) v = inText[0];
  if (!v || /\s/.test(v)) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return '';
    // Pages are read over https only (the iPhone app reads nothing else, and the card's link must open).
    u.protocol = 'https:';
    return u.href;
  } catch {
    return '';
  }
}

// A page's words for AI, from where its recipe starts: a food blog's story comes first, the recipe last.
export function recipePageText(html) {
  const src = String(html || '').slice(0, 3_000_000);
  const text = decodeEntities(src
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const LIMIT = 12000;
  if (text.length <= LIMIT) return text;
  // The last "Ingredients" heading on its own line is usually the recipe card (earlier ones sit in the story).
  const heads = [...text.matchAll(/(^|\n)ingredients?\b[^\n]{0,30}(\n|$)/gi)].map((m) => m.index);
  const at = heads.length ? heads[heads.length - 1] : text.search(/ingredients?/i);
  const start = at > 0 ? Math.max(0, at - 600) : 0;
  return text.slice(start, start + LIMIT);
}

const metaOf = (html, name) => {
  const m = String(html || '').match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeEntities((m && (m[1] ?? m[2])) || '').trim();
};

// The change a recipe from your link makes to the save (pure): the page's recipe, where it's from, and
// the page's dish name when the save's title says nothing (a post's first line, a site's name).
export function planLinkedRecipe(item, url, recipe, how) {
  const old = item.details || {};
  const site = recipe.siteName || prettyRetailer(hostnameOf(url)) || hostnameOf(url);
  const kindPatch = kindOf(item) === 'recipe' ? {} : kindChangePatch(item, 'recipe');
  const details = sanitizeDetails('recipe', {
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    yield: recipe.yield || '',
    totalMinutes: recipe.totalMinutes || null,
    prepMinutes: recipe.prepMinutes || null,
    cookMinutes: recipe.cookMinutes || null,
    cuisine: recipe.cuisine || old.cuisine || '',
    category: recipe.category || old.category || '',
    author: recipe.author || '',
    source: how === 'page' ? 'page' : 'ai',
    drafted: [],
    basedOn: { url, site, title: recipe.title || '' },
  });
  const patch = { ...kindPatch, details, understoodAt: nowIso(), needsAi: false };
  const changes = [{ field: 'recipe details', from: `${(old.ingredients || []).length} ingredient${(old.ingredients || []).length === 1 ? '' : 's'}`, to: `recipe from ${site}` }];
  const title = String(recipe.title || '').trim();
  if (title.length >= 3 && title !== item.title && !(item.userFields || []).includes('title') && (isPostSave(item) || genericTitle(item.title) || !item.title)) {
    patch.title = title.slice(0, 200);
    changes.push({ field: 'title', from: item.title, to: patch.title });
  }
  return { patch, changes, site };
}

// Import recipe from a link: you paste the page with the real recipe, and this save gets it (the same save,
// not a new one). The page's own recipe card (schema.org Recipe) when it has one, with no AI at all; else
// AI reads the recipe from the page's text (Apple Intelligence on the device, or your key). Logged with Undo.
// fetchPage(url) returns the page's HTML or null. Returns { ok, site, ingredients, steps, how, logId } or
// { ok: false, error } with words to show.
export async function importRecipeFromLink(store, id, link, { fetchPage = async () => null } = {}) {
  const url = recipeLink(link);
  if (!url) return { ok: false, error: 'That doesn’t look like a web address. Paste the link to the recipe page.' };
  if (SOCIAL.test(hostOf(url))) return { ok: false, error: 'That’s a social post, which can’t be read without signing in. Paste the link to the recipe page itself.' };
  const item = await store.getItem(id);
  if (!item || item.deletedAt) return { ok: false, error: 'That save no longer exists.' };
  let html = null;
  try { html = await fetchPage(url); } catch { html = null; }
  if (!html) return { ok: false, error: 'Couldn’t read that page. Some recipe sites don’t let apps read them. Check the link, or try another page with this recipe.' };
  let recipe = recipeFromHtml(html);
  let how = 'page';
  let reason = '';
  if (!recipe || (recipe.ingredients || []).length < 1) {
    const settings = await store.getSettings();
    // You asked: your key may be used (not only the device model).
    const key = keyFor(settings, await store.getSecret('aiApiKey'));
    if (!aiAvailable(settings, key)) return { ok: false, error: 'That page has no recipe card to read. Turn on Apple Intelligence or add your AI key, and AI can read the recipe from the page.' };
    const ai = await readRecipePageWithAI({ dish: item.title, url, text: recipePageText(html) }, settings, key);
    if (!ai.ingredients.length) return { ok: false, error: 'No recipe found on that page. Try the page with the full recipe on it.' };
    recipe = { ...ai, title: ai.title || recipe?.title || '', siteName: recipe?.siteName || '' };
    how = 'ai';
    reason = ai.reason;
  }
  if (!recipe.siteName) recipe.siteName = metaOf(html, 'og:site_name');
  if (!recipe.title) recipe.title = metaOf(html, 'og:title');
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return { ok: false, error: 'That save no longer exists.' };
  const { patch, changes, site } = planLinkedRecipe(current, url, recipe, how);
  const before = Object.fromEntries([...LOGGED, 'understoodAt', 'needsAi'].filter((f) => f in patch).map((f) => [f, current[f] === undefined ? null : current[f]]));
  await store.updateItem(id, patch, { by: 'ai' });
  const logId = uid();
  await store.appendAiLog([{ id: logId, runId: `link-recipe-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after: patch, reason: reason || `Recipe from the link you added (${site}).`, undone: false }]);
  return { ok: true, site, how, ingredients: patch.details.ingredients.length, steps: patch.details.steps.length, logId };
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
  for (const m of src.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
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
    // Nothing there is nothing: an empty value would otherwise resolve to the page's own address.
    if (!s.trim()) return '';
    try { const u = new URL(s.trim(), baseUrl || undefined); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
  };
  let price = null;
  let currency = '';
  let availability = '';
  const offers = product ? [].concat(product.offers || []).flatMap((o) => (o && o.offers ? [o, ...[].concat(o.offers)] : [o])) : [];
  // Every price the page's offers state: more than one (a variant each, or a "from" price) means the page
  // alone can't say what this exact item costs (priceVaries; Wish List then doesn't call a price confirmed).
  const stated = new Set();
  let ranged = false;
  for (const o of offers.slice(0, 20)) {
    if (!o || typeof o !== 'object') continue;
    const cur = String(o.priceCurrency || o.priceSpecification?.priceCurrency || '').toUpperCase();
    if (o.lowPrice !== undefined && o.lowPrice !== null && o.lowPrice !== '' && String(o.lowPrice) !== String(o.highPrice ?? o.lowPrice)) ranged = true;
    for (const v of [o.price, o.lowPrice, o.priceSpecification?.price]) {
      const p = parsePrice(v, cur);
      if (p && p.amount > 0) stated.add(p.amount);
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
    priceVaries: ranged || stated.size > 1,
    availability,
    image: abs(product ? [].concat(product.image || [])[0] : null) || abs(meta('og:image')),
    siteName: meta('og:site_name').slice(0, 80),
    specs: specs.slice(0, 16),
    url: baseUrl,
    structured: !!product,
  };
}

// "Add product link": the store page you paste becomes this save's shop page, read once without cookies.
// Its own name, price (only when the save has none), picture (the same), brand, specs and stock go on the
// save, and Find deals then knows exactly which product it is. A page the store won't let apps read is
// still linked, with nothing else changed. { ok, error, site, read, price, logId } for Undo.
// rewrite (the link typed where you say which product it is): you are saying "this page IS the product",
// so the card is rebuilt from it: the page's name, price and picture replace the save's, and your AI
// (Apple Intelligence, or your key: you asked) reads the page for the summary, features and specs. Without
// AI, or when it fails, the page's own facts still go on (aiError says why); with neither a readable page
// nor a sure answer, only the link is kept, as without rewrite. Your own words for the
// product (wishName) are dropped: the page says it better.
export async function linkProductPage(store, id, link, { fetchPage = async () => null, loadImage = async () => null, rewrite = false } = {}) {
  const url = recipeLink(link);
  if (!url) return { ok: false, error: 'That doesn’t look like a web address. Paste the link to the product’s page in a store.' };
  if (SOCIAL.test(hostOf(url))) return { ok: false, error: 'That’s a social post, not a store page. Paste the link to the product’s page in a store.' };
  const item = await store.getItem(id);
  if (!item || item.deletedAt) return { ok: false, error: 'That save no longer exists.' };
  if (hasOwnView(kindOf(item))) return { ok: false, error: 'This save isn’t something to buy.' };
  let html = null;
  try { html = await fetchPage(url); } catch { html = null; }
  const read = html ? productFromHtml(html, url) : null;
  let page = read && (read.structured || read.price !== null) ? read : null;
  // The card shows a small copy kept on the device, not an address: fetch the page's picture now.
  if (page?.image) {
    const picture = await pictureOf({ image: page.image }, loadImage);
    if (picture) page = { ...page, image: picture };
  }
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return { ok: false, error: 'That save no longer exists.' };
  let ai = null;
  let aiError = '';
  if (rewrite) {
    const settings = await store.getSettings();
    const key = keyFor(settings, await store.getSecret('aiApiKey'));
    if (aiAvailable(settings, key) && (html || supportsWebLookup(settings))) {
      try {
        // The saved post and the page side by side: the page says what the product is, the post (its
        // caption and picture) says which colour or size was meant and what was said about it.
        const ig = current.instagram || {};
        ai = await understandProductWithAI({
          title: page?.name || read?.title || current.title || '', description: read?.description || '', site: read?.siteName || prettyRetailer(hostnameOf(url)),
          url, price: page && page.price !== null ? formatPrice(page.price, page.currency) || String(page.price) : '',
          pages: html ? [{ url, text: pageText(html) }] : [],
          post: { title: current.title || '', caption: ig.caption || (current.description && current.description !== read?.description ? current.description : ''), creator: ig.creator || '', hashtags: ig.hashtags || [], from: current.retailer || current.host || '' },
          image: await pictureOf(current, loadImage),
          // The page's text is in hand: nothing is searched, so the answer can't wander to another product.
          linked: true, noSearch: !!html,
        }, settings, key);
        // The page couldn't be read, so the provider searched: its answer counts only when the page it
        // found is on the site you linked.
        if (!html && siteKey(ai.listing?.url) !== siteKey(url)) ai = { ...ai, confidence: 0 };
      } catch (e) {
        aiError = String((e && e.message) || e);
      }
    }
  }
  // Nothing to rebuild the card from (the page wouldn't be read and no AI was sure): only the link is kept.
  const rebuild = rewrite && (!!page || (!!ai && ai.confidence >= PRODUCT_CONFIDENCE));
  const latest = rewrite ? await store.getItem(id) : current;
  if (!latest || latest.deletedAt) return { ok: false, error: 'That save no longer exists.' };
  const { patch, changes, site } = planLinkedProduct(latest, url, page, { ai, rewrite: rebuild });
  // The card now says what the product really is: it is filed by that, not by what the post's caption
  // happened to say (planRefile). Part of the same change, so Undo puts the collection back too.
  if (rebuild) {
    const refile = planRefile({ ...latest, ...patch }, { collections: await store.getCollections(), prefs: await store.getPrefs(), settings: await store.getSettings() });
    Object.assign(patch, refile.patch);
    changes.push(...refile.changes);
  }
  // What this teaches: posts from this account come from this shop. Later reads of its other posts look
  // there first (shopHintsFor), and the saves of its that no shop page has confirmed yet are offered for
  // another read now (related).
  // Only a link the card was really rebuilt from teaches: one whose page couldn't be read proves nothing.
  const lesson = rebuild ? productLesson(latest, url, site, patch.details?.brand || latest.details?.brand || '') : null;
  let related = [];
  if (lesson) {
    await store.updatePrefs({ productShops: addProductLesson((await store.getPrefs()).productShops, lesson) });
    related = relatedToLesson(await store.getItems(), latest, lesson);
  }
  const learned = lesson ? { creator: lesson.creator, lessonSite: lesson.site, lessonBrand: lesson.brand, related } : { creator: '', lessonSite: '', lessonBrand: '', related: [] };
  if (!changes.length) return { ok: true, site, read: !!page, ai: rebuild && !!ai && ai.confidence >= PRODUCT_CONFIDENCE, aiError, title: latest.title, price: '', logId: null, same: true, ...learned };
  const before = Object.fromEntries([...LOGGED, 'deals', 'dealSkip', 'wishName'].filter((f) => f in patch).map((f) => [f, latest[f] === undefined ? null : latest[f]]));
  await store.updateItem(id, patch, { by: 'ai' });
  // A save you filed yourself, now with its real name and shop: the sorter learns that this product and
  // this shop go in that collection (as much as moving a save teaches), so the next product read from the
  // same shop is filed with it. Once per page: the same page linked again changes nothing and teaches
  // nothing. Undo takes the lesson back (the log entry's `taught`, aiFix.js undoFixes).
  const after = { ...latest, ...patch };
  let taught = null;
  if (rebuild && after.collectionId && !after.needsReview && filedByYou(latest) && (latest.details?.shopUrl || '') !== url) {
    const facts = productFacts(after);
    taught = { title: facts.title, host: facts.host, collectionId: after.collectionId };
    await store.updatePrefs(sorterLesson(await store.getPrefs(), taught, after.collectionId));
  }
  const logId = uid();
  await store.appendAiLog([{ id: logId, runId: `link-product-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after: patch, reason: ai?.reason || `From the store page you added (${site}).`, undone: false, ...(taught ? { taught } : {}) }]);
  return { ok: true, site, read: !!page, ai: rebuild && !!ai && ai.confidence >= PRODUCT_CONFIDENCE, aiError, title: patch.title || latest.title, price: 'price' in patch ? formatPrice(patch.price, patch.currency) || String(patch.price) : '', logId, ...learned };
}

// --- What a product link teaches -------------------------------------------------------------------

// A collection you chose (or kept when shown) is yours: nothing here moves the save out of it.
const filedByYou = (item) => item.categorizationSource === 'manual' || (item.userFields || []).includes('collectionId');

// A product as the sorter should see it once a shop page has said what it is: its real name, the shop's
// category, the brand and the shop, in place of the post's caption (pure). "The tech in this foam is
// unreal" once filed a running shoe under Technology. A save no shop page has matched is returned as it is.
export function productFacts(item) {
  const d = kindOf(item) === 'product' ? item.details || {} : {};
  if (!d.shopUrl) return item;
  const album = item.instagram?.collectionName;
  return {
    id: item.id, title: item.title || d.shopTitle || '', category: d.category || '', productType: d.category || '', brand: d.brand || '',
    description: [d.summary, d.shopDescription].filter(Boolean).join(' ').slice(0, 1500), retailer: d.shopName || '', host: siteKey(d.shopUrl), url: d.shopUrl,
    price: item.price ?? null, currency: item.currency || '',
    ...(album ? { instagram: { collectionName: album } } : {}),
  };
}

// The same, for Fix with AI's filing check (provider.js cleanupWithAI): the shop, its category and what
// the product is come first; the post's caption follows as what was said about it.
export function cleanupView(item) {
  const d = kindOf(item) === 'product' ? item.details || {} : {};
  const caption = item.instagram?.caption || '';
  if (!d.shopUrl) return caption ? { ...item, description: caption } : item;
  const about = [d.brand ? `Brand: ${d.brand}.` : '', d.category ? `Category: ${d.category}.` : '', d.summary || d.shopDescription || '', caption ? `The post said: ${caption}` : ''].filter(Boolean).join(' ');
  return { ...item, retailer: d.shopName || item.retailer || '', productType: d.category || item.productType || '', description: about || item.description || '' };
}

// Where a product a shop page has matched belongs, by what it is (pure). The local sorter reads the
// product's facts; it moves the save only when it is sure (surer still to move one out of a collection
// than to file one from Review), to a collection you already have, and never one you filed yourself.
export function planRefile(item, { collections = [], prefs = {}, settings = {} } = {}) {
  const none = { patch: {}, changes: [] };
  if (kindOf(item) !== 'product' || !item.details?.shopUrl || filedByYou(item) || item.filingConfirmed || !collections.length) return none;
  const found = classify(productFacts(item), { collections, prefs: { ...prefs, autoCreateCollections: false }, settings: { ...settings, autoCreateCollections: false } });
  const filed = !!item.collectionId && !item.needsReview;
  if (!found.collectionId || found.isNew || found.isInbox || found.collectionId === item.collectionId) return none;
  if (!collections.some((c) => c.id === found.collectionId)) return none;
  if (found.confidence < (filed ? Math.max(REFILE_CONFIDENCE, AUTO_FILE_CONFIDENCE) : AUTO_FILE_CONFIDENCE)) return none;
  const patch = {
    collectionId: found.collectionId, needsReview: false, categorizationSource: 'local', confidence: found.confidence,
    categorizationReason: `From the product’s page: ${found.reason || 'best match'}`.slice(0, 300),
  };
  if (item.collectionId) patch.previousCollections = [...(item.previousCollections || []), item.collectionId].slice(-20);
  return { patch, changes: [{ field: 'collection', fromId: item.collectionId || null, toId: found.collectionId, to: found.collectionName || '' }] };
}

// What the sorter learns from a product you filed yourself (pure): only the parts of prefs it changes.
function sorterLesson(prefs, facts, collectionId) {
  // As much as a move teaches: you chose the collection and then said exactly which product it is. (Not
  // logged as a correction: the list of those is of saves you moved.)
  const next = learnFromCorrection(facts, null, collectionId, prefs);
  return { learnedKeywords: next.learnedKeywords, retailerPrefs: next.retailerPrefs };
}

// Brands that are also everyday words: "giving away this lamp" isn't about Away. These count only as a
// hashtag or as the brand already on the card.
const WORD_BRANDS = new Set('away coach target apple everyday guess shell dove tide always express united stance keen fossil orange white black blue green gold silver rose pink mango champion diesel supreme ordinary cotton linen nature fresh simple modern classic basic original outdoor columbia casper parachute caterpillar'.split(' '));
// Letters and digits only, lower case, single spaces ("Nike's" and "Nike." are both "nike").
const brandWords = (t) => String(t || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Does the save name this brand? Its hashtags or the brand on its card, or (four letters or more, and not
// an everyday word) whole words of its own text.
function mentionsBrand(item, brand) {
  const b = brandWords(brand);
  if (b.length < 4) return false;
  const ig = item?.instagram || {};
  const tag = b.replace(/ /g, '');
  if (brandWords(item?.details?.brand) === b) return true;
  if ((Array.isArray(ig.hashtags) ? ig.hashtags : []).some((h) => brandWords(h).replace(/ /g, '') === tag)) return true;
  if (WORD_BRANDS.has(b)) return false;
  return ` ${brandWords([item?.title, ig.caption, item?.description].filter(Boolean).join(' \n '))} `.includes(` ${b} `);
}

// Who posted a save (an Instagram or X account), lower case, or ''.
const creatorOf = (item) => String(item?.instagram?.creator || '').replace(/^@/, '').trim().toLowerCase();

// The lesson in a link you gave for a post (pure), or null when the save has no account to learn about:
// { creator, site, shop, brand, at }.
export function productLesson(item, url, shop = '', brand = '', at = nowIso()) {
  const creator = creatorOf(item);
  const site = siteKey(url);
  if (!creator || !site) return null;
  return { creator, site, shop: String(shop || '').slice(0, 80), brand: String(brand || '').slice(0, 60), at };
}

// The lessons with one more (pure): one per account and site, newest last, at most 200.
export function addProductLesson(lessons, lesson) {
  const kept = (Array.isArray(lessons) ? lessons : []).filter((l) => l && !(l.creator === lesson.creator && l.site === lesson.site));
  return [...kept, lesson].slice(-200);
}

// Undo of a link: what it taught goes too (pure).
export function dropProductLesson(lessons, creator, site) {
  return (Array.isArray(lessons) ? lessons : []).filter((l) => l && !(l.creator === creator && l.site === site));
}

// The shops learned for this save, newest first, at most 3 (pure): the shops of the account that posted
// it (by: 'account'), and the shops of brands its own words name, whoever posted it (by: 'brand').
export function shopHintsFor(item, prefs) {
  const creator = creatorOf(item);
  const seen = new Set();
  return (Array.isArray(prefs?.productShops) ? prefs.productShops : []).filter((l) => l && l.site).reverse()
    .map((l) => ({ l, by: creator && l.creator === creator ? 'account' : mentionsBrand(item, l.brand) ? 'brand' : '' }))
    .filter(({ l, by }) => by && !seen.has(l.site) && seen.add(l.site))
    .slice(0, 3).map(({ l, by }) => ({ creator: l.creator, site: l.site, shop: l.shop || '', brand: l.brand || '', by }));
}

// Other saves the lesson may fix (pure): things to buy from the same account, or that name the same brand, that no shop page has
// matched to a shop page yet. Ids, at most 25. (One your AI already matched to some page isn't offered
// again with every link; Fix with AI on it still gets the hint.)
export function relatedToLesson(items, item, lesson) {
  return (items || []).filter((o) => o && o.id !== item.id && !o.deletedAt && !o.purchased && (creatorOf(o) === lesson.creator || mentionsBrand(o, lesson.brand))
    && !hasOwnView(kindOf(o)) && (kindOf(o) === 'product' || isShopping(o))
    && !(kindOf(o) === 'product' && (o.details?.shopUrl || o.details?.source === 'you')))
    .slice(0, 25).map((o) => o.id);
}

// A link's site, for telling whether two addresses are the same shop ("www." aside).
const siteKey = (u) => hostnameOf(u || '').toLowerCase().replace(/^www\./, '');

// A linked page's specs with the AI's added (the page's own win), or what was there.
function linkedSpecs(page, sure, old) {
  const specs = [...(page?.specs || [])];
  for (const sp of sure?.specs || []) if (!specs.some((x) => x.label.toLowerCase() === sp.label.toLowerCase())) specs.push(sp);
  return specs.length ? specs : old;
}

// The change a store page you linked makes to a save (pure). page: productFromHtml's answer, or null when
// the page couldn't be read (the link alone is kept).
export function planLinkedProduct(item, url, page = null, { ai = null, rewrite = false } = {}) {
  const mine = new Set(item.userFields || []);
  const current = kindOf(item);
  const old = current === 'product' ? item.details || {} : {};
  const site = page?.siteName || prettyRetailer(hostnameOf(url));
  // Your AI's read of the page, when it is sure what the product is.
  const sure = ai && ai.confidence >= PRODUCT_CONFIDENCE ? ai : null;
  const patch = {};
  const changes = [];
  if (current !== 'product') {
    patch.kind = 'product';
    changes.push({ field: 'kind', from: kindInfo(current).label, to: kindInfo('product').label });
  }
  // What you typed yourself stays; the page only fills what you left empty.
  const yours = old.source === 'you';
  const pick = (mineFirst, theirs) => (yours ? mineFirst || theirs : theirs || mineFirst) || '';
  const details = sanitizeDetails('product', {
    ...old,
    brand: pick(old.brand, page?.brand || sure?.brand),
    model: pick(old.model, page?.sku || sure?.model),
    category: pick(old.category, page?.category || sure?.category),
    specs: yours && old.specs?.length ? old.specs : linkedSpecs(page, sure, rewrite ? [] : old.specs || []),
    // The summary and features were about whatever the save was taken to be: on a rewrite they are the
    // AI's read of this page, or nothing.
    ...(rewrite && !yours ? { summary: sure?.summary || '', features: sure?.features || [] } : {}),
    shopUrl: url,
    shopName: site,
    shopTitle: page?.title || '',
    shopDescription: page?.description || '',
    availability: page?.availability || '',
    source: old.source === 'you' ? 'you' : page ? 'page' : sure ? 'ai' : old.source || '',
  });
  if (JSON.stringify(details) !== JSON.stringify(old)) {
    patch.details = details;
    changes.push({ field: 'shop page', from: old.shopName || '—', to: site });
    // Another shop page is (or may be) another product: prices found for the old one, and the stores
    // you skipped for it, go with it. Undo brings them back.
    if (details.shopUrl !== (old.shopUrl || '')) {
      if (item.deals) patch.deals = null;
      if ((item.dealSkip || []).length) patch.dealSkip = [];
    }
  }
  const name = page?.name || (rewrite && sure ? sure.name : '');
  const renames = rewrite || isPostSave(item) || item.type === 'inspiration' || genericTitle(item.title) || current !== 'product';
  // A rewrite replaces even what you typed by hand: you gave the page to correct the card (Undo puts it back).
  if (name.length >= 3 && name !== item.title && (rewrite || !mine.has('title')) && renames) {
    patch.title = name;
    changes.push({ field: 'title', from: item.title, to: name });
  }
  const unpriced = item.price === null || item.price === undefined;
  const newPrice = page && page.price !== null && !page.priceVaries && (rewrite || !mine.has('price')) && (unpriced || (rewrite && (page.price !== item.price || (page.currency || '') !== (item.currency || ''))));
  const listed = rewrite && !page && sure?.listing?.price != null && sure.listing.price !== item.price ? sure.listing : null;
  if (listed) {
    patch.price = listed.price;
    patch.currency = listed.currency || item.currency || '';
    changes.push({ field: 'price', from: unpriced ? 'none' : formatPrice(item.price, item.currency) || String(item.price), to: formatPrice(patch.price, patch.currency) || String(patch.price) });
  }
  if (newPrice) {
    patch.price = page.price;
    patch.currency = page.currency || item.currency || '';
    changes.push({ field: 'price', from: unpriced ? 'none' : formatPrice(item.price, item.currency) || String(item.price), to: formatPrice(patch.price, patch.currency) || String(patch.price) });
  }
  if (page?.image && (!item.image || (rewrite && page.image !== item.image))) {
    patch.image = page.image;
    changes.push({ field: 'picture', from: item.image ? 'the old picture' : 'none', to: site });
  }
  if (rewrite && item.wishName && changes.length) patch.wishName = '';
  return { patch, changes, site };
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
  const renames = isPostSave(item) || item.type === 'inspiration' || genericTitle(item.title) || current !== 'product' || /facebook\.com$/i.test(item.host || '');
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
function productInput(item, pages, image, hints = []) {
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
    hints,
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
async function readProduct(item, settings, key, pages, image, { fetchShopPage, hints = [] }) {
  const ai = await understandProductWithAI(productInput(item, pages, image, hints), settings, key);
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
    // Shops you linked this account's other posts to: the search looks there first.
    const hints = shopHintsFor(current, await store.getPrefs());
    const { ai: found, page } = await readProduct(current, settings, key, pages, image, { fetchShopPage, hints });
    current = (await store.getItem(id)) || current;
    const product = planProduct({ ...current, ...patch }, found, page);
    patch = { ...patch, ...product.patch };
    changes = [...changes, ...product.changes];
    // Newly matched to a shop page: filed by what the product is, not by what the post said (planRefile).
    const matched = product.patch.details?.shopUrl || '';
    if (matched && matched !== (current.details?.shopUrl || '')) {
      const refile = planRefile({ ...current, ...patch }, { collections: await store.getCollections(), prefs: await store.getPrefs(), settings });
      patch = { ...patch, ...refile.patch };
      changes = [...changes, ...refile.changes];
    }
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
