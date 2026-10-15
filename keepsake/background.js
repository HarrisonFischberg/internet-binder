// Keepsake background service worker (MV3, ES module).
// It only wakes up for: install/startup, context-menu clicks, messages from
// the popup/dashboard/content scripts, permission changes and settings changes.
// It has no timers and no alarms. Its only network access is the optional AI
// provider call after a save (never before it), when the user has turned Optional AI on.

import { createStore, chromeBackend, idbBackend } from './src/shared/storage.js';
import { classify, learnFromCorrection, AUTO_FILE_CONFIDENCE } from './src/shared/categorizer.js';
import { parsePrice, sanitizeText, uid, nowIso } from './src/shared/util.js';
import { isRestrictedUrl, openableUrl } from './src/shared/url.js';
import { MSG, SESSION_KEYS } from './src/shared/messages.js';
import { cleanupWithAI, identifyForKind, draftRecipe } from './src/ai/provider.js';
import { parsePostBundle } from './src/instagram/post.js';
import { LOOKUP_SOURCES, lookupPlace, lookupAddressAt, lookupFilm, lookupBook, fillMissing } from './src/shared/lookups.js';
import { isKind, kindOf, kindInfo, hasOwnView, kindChangePatch, shoppingKindFor, detailsForKind, placeFromText, genericTitle, LIFESTYLE, kindFromSchemaTypes, recipeFromSchema, recipeFromText, workoutFromText, looksLikeWorkout, placeFromSchema, placeFromMapsUrl, placeFromProfile, placeFromHome, videoPlatform, videoFromCapture, articleFromCapture, isYouTube, titleSite, mediaFromSchema, bookFromSchema } from './src/shared/kinds.js';
import { guessTopics } from './src/shared/topics.js';

const store = createStore(chromeBackend(), idbBackend());
const CONTENT_SCRIPT_ID = 'keepsake-floating';
const CONTEXT_MENU_ID = 'keepsake-save';

// --- lifecycle -----------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  const { fresh } = await store.init();
  await createContextMenu();
  await syncContentScripts();
  if (details.reason === 'install' && fresh) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html#welcome') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await store.init();
  await createContextMenu();
  await syncContentScripts();
  enrichPending();
});

async function createContextMenu() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  chrome.contextMenus.create({ id: CONTEXT_MENU_ID, title: 'Save to Keepsake', contexts: ['page', 'image', 'link', 'selection'] }, () => void chrome.runtime.lastError);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab || !tab.id) return;
  const pageUrl = info.pageUrl || tab.url || '';
  if (isRestrictedUrl(pageUrl)) return;
  try {
    const hints = { imageUrl: info.srcUrl || '', linkUrl: info.linkUrl || '', selectionText: info.selectionText || '' };
    // Right-clicked an image or link inside a product card (listing pages):
    // read just that card, the same way the on-page buttons do.
    const card = (info.srcUrl || info.linkUrl) ? await extractCardFromTab(tab.id, info.srcUrl || '', info.linkUrl || '') : null;
    if (card && card.url && card.title) {
      if (info.srcUrl && !card.images.includes(info.srcUrl)) card.images.unshift(info.srcUrl);
      if (info.srcUrl) card.image = info.srcUrl;
      const res = await saveProduct(card, { source: 'context-menu', instant: true });
      await showPageToast(tab.id, res, card);
      return;
    }
    const product = await extractFromTab(tab.id, hints);
    if (!product) throw new Error('Keepsake could not read this page.');
    if (info.linkUrl && !info.srcUrl && info.linkText && info.linkUrl !== pageUrl) {
      // Right-clicked a product link: save the link target, titled by the link text.
      product.url = info.linkUrl;
      product.canonicalUrl = info.linkUrl;
      product.title = sanitizeText(info.linkText, 200) || product.title;
      product.image = '';
      product.images = [];
      product.price = null;
      product.priceText = '';
    }
    const res = await saveProduct(product, { source: 'context-menu', instant: true });
    await showPageToast(tab.id, res, product);
  } catch (e) {
    await showPageToast(tab.id, { ok: false, error: friendlyError(e) });
  }
});

// --- extraction ----------------------------------------------------------------------------

async function extractFromTab(tabId, hints = {}) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (h) => { globalThis.__keepsakeHints = h; }, args: [hints] });
  const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['src/extract/extract.js'] });
  let product = results && results[0] ? results[0].result : null;
  if (!product || typeof product !== 'object') {
    const again = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis.__keepsakeExtract ? globalThis.__keepsakeExtract() : null) });
    product = again && again[0] ? again[0].result : null;
  }
  return product && typeof product === 'object' ? product : null;
}

// Find the card around a right-clicked image/link and extract only that card.
async function extractCardFromTab(tabId, srcUrl, linkUrl) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/detector.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [srcUrl, linkUrl],
      func: (src, link) => {
        const det = globalThis.__keepsakeDetector;
        if (!det) return null;
        let node = null;
        if (src) node = Array.from(document.images).find((i) => i.currentSrc === src || i.src === src) || null;
        if (!node && link) node = Array.from(document.querySelectorAll('a[href]')).find((a) => a.href === link) || null;
        if (!node) return null;
        det.resetCache();
        const card = det.resolveCard(node);
        if (!card || card.kind !== 'card') return null;
        return det.extractCard(card);
      },
    });
    const card = results && results[0] ? results[0].result : null;
    return card && typeof card === 'object' ? card : null;
  } catch {
    return null;
  }
}

function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/cannot access|cannot be scripted|extensions gallery|chrome:\/\/|Missing host permission|The extensions gallery/i.test(m)) {
    return 'Chrome does not let extensions read this page (browser pages, the Web Store and some protected sites). Try a regular website.';
  }
  if (/No tab with id|Receiving end does not exist|message port closed/i.test(m)) return 'The page changed before Keepsake could finish. Try again.';
  return m || 'Something went wrong.';
}

// --- saving --------------------------------------------------------------------------------------

function normalizeProduct(raw) {
  const p = { ...(raw || {}) };
  // An Instagram post: read its own caption, creator and location (src/instagram/post.js) and keep them,
  // so the save knows what the post says even when the page's title is just "Instagram".
  if (p.isInstagram && p.igBundle && !p.instagram) {
    const post = parsePostBundle(p.igBundle, p.canonicalUrl || p.url);
    if (post.caption || post.creator || post.location) {
      p.instagram = { caption: post.caption, creator: post.creator, location: post.location || p.igLocation?.name || '', hashtags: post.hashtags, postedAt: post.postedAt, links: post.links, products: post.products };
      if (post.caption && (!p.description || p.description.length < post.caption.length)) p.description = post.caption;
      if (post.location && !p.igLocation?.name) p.igLocation = { name: post.location };
    }
  }
  delete p.igBundle;
  if (p.price === null || p.price === undefined || p.price === '' || Number.isNaN(Number(p.price))) {
    const parsed = parsePrice(p.priceText || p.price, p.currency);
    if (parsed) {
      p.price = parsed.amount;
      p.currency = p.currency || parsed.currency;
    } else {
      p.price = null;
    }
  } else if (typeof p.price === 'string') {
    const parsed = parsePrice(p.price, p.currency);
    p.price = parsed ? parsed.amount : null;
    p.currency = p.currency || (parsed ? parsed.currency : '');
  }
  p.currency = sanitizeText(p.currency, 8).toUpperCase();
  return p;
}

// What a video, article or link is about, guessed locally from its title, channel or site and description.
function topicsFor(kind, product, details) {
  if (!['video', 'article', 'link'].includes(kind)) return {};
  const topics = guessTopics({ title: product.title, channel: details.channel || details.siteName || product.siteName || '', description: product.description, hashtags: product.hashtags });
  return topics.length ? { topics, topicsBy: 'guess' } : {};
}

// Why a save of this kind went where it did (shown as the categorization reason).
const KIND_REASON = {
  recipe: (d) => (d.ingredients?.length ? `Recipe: ${d.ingredients.length} ingredients found` : 'Recipe page'),
  media: (d) => (d.format === 'series' ? 'TV series' : 'Film'),
  book: (d) => (d.author ? `Book by ${d.author}` : 'Book'),
  video: (d) => (d.platform ? `Video on ${d.platform}` : 'Video page'),
  article: (d) => (d.readingMinutes ? `Article, ${d.readingMinutes} min read` : 'Article'),
  place: (d) => (d.locality ? `Place in ${d.locality}` : 'Place page'),
  workout: (d) => (d.exercises?.length ? `Workout: ${d.exercises.length} exercises found` : 'Workout page'),
};

// Exercises from a caption, or from a workout page's list lines. Only when the text talks about
// training too, so a recipe's "2 x 400 g tins" never turns into a workout.
function workoutOf(product) {
  const about = `${product.title || ''} ${product.description || ''}`;
  if (!looksLikeWorkout(about)) return null;
  const source = product.isInstagram ? 'caption' : 'page';
  // Instagram puts the caption in the page title as well as the description, and either may be cut
  // short: read the longer one first.
  const texts = product.isInstagram ? [product.title, product.description].filter(Boolean).sort((a, b) => b.length - a.length) : [product.description];
  const fromCaption = texts.map((t) => workoutFromText(t, { source })).find(Boolean) || null;
  if (fromCaption) return fromCaption;
  return Array.isArray(product.workoutLines) && product.workoutLines.length ? workoutFromText(product.workoutLines.slice(0, 150).join('\n'), { source: 'page' }) : null;
}

// The place's address, pin, hours… from the page's structured data, or from a maps link.
function placeOf(product) {
  const fromPage = placeFromSchema(product.place);
  const fromLink = placeFromMapsUrl(product.url);
  if (fromPage) return fromPage;
  if (fromLink) return fromLink;
  // A business's Instagram profile or Facebook page: what its bio and intro say.
  const fromProfile = placeFromProfile(product.profile);
  if (fromProfile) return fromProfile;
  // The page's own address block; its name is the site's ("Saigon Sandwich", not "Home | Saigon Sandwich").
  const pp = product.pagePlace;
  if (pp?.address) {
    // On a site's home page the site's name; elsewhere (a review of one venue) the page title's first part.
    let home = false;
    try { home = new URL(product.url).pathname.replace(/\/+$/, '') === ''; } catch { /* not a URL */ }
    const site = String(product.siteName || '').trim();
    const parts = String(product.title || '').split(/\s+[|–—-]\s+/).map((x) => x.trim()).filter((x) => x && !/^(?:home|welcome|index)$/i.test(x));
    const name = (home && site) || parts[0] || site;
    return { address: pp.address, locality: pp.locality, region: pp.region, postalCode: pp.postalCode, phone: pp.phone, hours: pp.hours, source: 'page', ...(name ? { name } : {}) };
  }
  // A business's home page with no address: its name and area; a lookup finds the rest.
  const fromHome = placeFromHome(product.home);
  if (fromHome) return fromHome;
  // A post or page that names the place in its caption or location tag.
  const { details, title } = detailsForKind('place', { title: product.title, description: product.description, url: product.url, instagram: { caption: product.description, location: product.igLocation?.name || '' } });
  return title ? { ...details, name: title } : details;
}

// What a capture is: what the page says about itself first (structured data), then what we can tell.
function kindOfCapture(product) {
  if (isKind(product.kind)) return product.kind;
  // Anything on YouTube is a video (your choice: one place for everything you save from there).
  if (isYouTube(product.url)) return 'video';
  // A title's page on a film or book site (Letterboxd, IMDb, Goodreads…): a film/show or a book.
  const site = titleSite(product.url);
  if (site) return site.kind;
  if (placeFromMapsUrl(product.url)) return 'place';
  const fromTypes = kindFromSchemaTypes(product.schemaTypes);
  // A video or article that lists exercises is a workout; other structured kinds are what they say.
  if ((fromTypes === 'video' || fromTypes === 'article') && workoutOf(product)) return 'workout';
  if (fromTypes && fromTypes !== 'product') return fromTypes;
  if (product.recipe) return 'recipe';
  // An Instagram post: a recipe or workout in the caption, a place when it's tagged with a location or
  // names one with 📍; otherwise a link.
  if (product.isInstagram) {
    if (recipeFromText(product.description)) return 'recipe';
    if (workoutOf(product)) return 'workout';
    if (product.igLocation?.name || placeFromText(product.description) || placeFromText(product.title)) return 'place';
    // A business's profile (an address, or "Donuts · Open 24/7" in its bio).
    if (placeFromProfile(product.profile)) return 'place';
    return 'link';
  }
  if (!fromTypes && product.price === null && !product.priceText && workoutOf(product)) return 'workout';
  if (!fromTypes && product.screen) return 'media';
  if (!fromTypes && product.book) return 'book';
  // A page with a visitable address block: a business's own site, or a review of one venue (Time Out,
  // The Infatuation). It has the address, and opening hours or a phone and "menu", "visit us"…
  // (Prices on the page are its menu, not a product's price.)
  const pp = product.pagePlace;
  // A listing's own "Address" block with its city counts too (a venue review's details).
  if (!fromTypes && pp?.address && (pp.hours?.length || (pp.phone && pp.visit) || (pp.labeled && pp.locality))) return 'place';
  // A Facebook page for a business (its intro has an address, area, category or opening status).
  if (placeFromProfile(product.profile)) return 'place';
  // A business's home page that says what it is (a bakery, a skate shop) and where to find it.
  if (!fromTypes && placeFromHome(product.home)) return 'place';
  // A video site's watch page, or a page that calls itself a video or an article (og:type). Facebook and
  // Instagram call every page a video; only their video addresses are videos.
  const og = String(product.media?.ogType || '').toLowerCase();
  let host = '';
  try { host = new URL(product.url).hostname; } catch { /* not a URL */ }
  if (/(^|\.)(?:facebook|instagram)\.com$/i.test(host) && !/\/(?:watch|videos?|reels?)\b/i.test(product.url)) return 'link';
  if (!fromTypes && (videoPlatform(product.url) || /^video\./.test(og))) return 'video';
  if (!fromTypes && og === 'article') return 'article';
  if (fromTypes === 'product' || product.price !== null || product.priceText) return 'product';
  return product.sparse ? 'link' : 'product';
}

// What a capture is and its kind's details. Also tidies the product for that kind (a film's year out of
// its title, a maps link's name, no price on anything but a product). Used by the save and by the
// popup's "where would this go?" question, so both agree.
function captureFacts(product) {
  const kind = kindOfCapture(product);
  const details = kind === 'recipe' ? recipeFromSchema(product.recipe) || recipeFromText(product.description) || {}
    : kind === 'workout' ? workoutOf(product) || {}
      : kind === 'place' ? placeOf(product)
        : kind === 'video' ? videoFromCapture(product.media || {}, product.url)
          : kind === 'media' ? mediaFromSchema(product.screen) || { format: titleSite(product.url)?.format || 'film' }
            : kind === 'book' ? bookFromSchema(product.book) || {}
              : kind === 'article' ? articleFromCapture({ ...(product.media || {}), siteName: product.media?.siteName || product.siteName }) : {};
  // The site's own path knows film from series (Rotten Tomatoes /tv/, TMDB /tv/…) when the data doesn't.
  if (kind === 'media' && titleSite(product.url)?.format && !product.screen) details.format = titleSite(product.url).format;
  // "The Matrix (1999)": the year belongs in the details, not the title.
  if (kind === 'media') {
    const y = String(product.title || '').match(/^(.*\S)\s*\((\d{4})(?:[–-]\s*(?:\d{4})?)?\)\s*$/);
    if (y) {
      product.title = y[1];
      if (!details.year) details.year = Number(y[2]);
    }
  }
  // A maps link's page title is the app's ("Google Maps"); the place's name is in the link.
  if (kind === 'place' && details.name) {
    if (!product.title || /\bmaps\b/i.test(product.title) || genericTitle(product.title) || /^(?:home|welcome)\b|\|\s*home$/i.test(product.title) || product.pagePlace || product.profile || product.home) product.title = details.name;
    delete details.name;
  }
  // A video's site by its own name ("YouTube", not "Youtube" from the address).
  if (kind === 'video' && details.platform) product.retailer = details.platform;
  if (kind !== 'product') {
    // A price on a recipe or article page is an ad or a cookbook, not this save's price.
    product.price = null;
    product.priceText = '';
  }
  return { kind, details };
}

// Where a capture goes. Collections are for shopping: the local categorizer files products and links.
// Everything else (recipes, places, videos…) lives in its Lifestyle view and never gets a collection.
function classifyCapture(product, kind, details, ctx) {
  const classification = classify(product, ctx);
  if (hasOwnView(kind)) {
    return { collectionId: null, collectionName: kindInfo(kind).plural, isNew: false, isInbox: false, shelf: kind, confidence: 0.9, alternatives: classification.alternatives || [],
      reason: (KIND_REASON[kind] || (() => kindInfo(kind).label))(details), kind };
  }
  return { ...classification, kind };
}

// instant: saved with no preview (on-page button, right-click). Then a local pick below
// AUTO_FILE_CONFIDENCE goes to Review with that pick as the suggestion, like the toolbar.
async function saveProduct(rawProduct, { collectionId = null, force = false, source = 'toolbar', classification: given = null, note = '', learn = 'light', instant = false } = {}) {
  const product = normalizeProduct(rawProduct);
  if (!force) {
    const existing = await store.findByUrl(product.canonicalUrl || product.url);
    if (existing) {
      const col = existing.collectionId ? await store.getCollection(existing.collectionId) : null;
      return { ok: true, duplicate: true, existing: { id: existing.id, title: existing.title, collectionId: existing.collectionId, collectionName: col ? col.name : '' } };
    }
  }
  const [collections, prefs, settings] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings()]);
  const { kind, details } = captureFacts(product);
  let classification = given || classifyCapture(product, kind, details, { collections, prefs, settings });

  // With AI on, the save is stored first with the local result and marked "finishing details";
  // the AI tidies the title and may re-file it afterwards (enrichItem). Nothing waits on the network.
  // The tidy is written for products, so other kinds are left as captured.
  const aiWanted = kind === 'product' && !collectionId && !!settings.ai?.on && !!(await store.getSecret('aiApiKey'));

  if (instant && !collectionId && !classification.isInbox && classification.confidence < AUTO_FILE_CONFIDENCE) {
    const pick = { collectionId: classification.collectionId, collectionName: classification.collectionName, taxonomyKey: classification.taxonomyKey, isNew: classification.isNew };
    classification = { ...classification, collectionId: null, collectionName: 'Review', taxonomyKey: null, isNew: false, isInbox: true, suggested: pick, reason: `Not sure (${Math.round(classification.confidence * 100)}%) — maybe ${pick.collectionName}: ${classification.reason}` };
  }

  let targetId = collectionId;
  if (typeof targetId === 'string' && targetId.startsWith('new:')) {
    const col = await store.ensureCollectionForTaxonomy(targetId.slice(4));
    targetId = col ? col.id : null;
  }
  const userChose = !!targetId && targetId !== classification.collectionId;
  if (!targetId) {
    if (classification.isNew) {
      const col = await store.ensureCollectionForTaxonomy(classification.taxonomyKey);
      targetId = col ? col.id : null;
      if (col) classification = { ...classification, collectionId: col.id, collectionName: col.name };
    } else {
      targetId = classification.collectionId;
    }
  }
  const item = await store.addItem({
    ...product,
    note,
    collectionId: targetId,
    originalTitle: product.originalTitle || product.title,
    kind,
    details,
    ...topicsFor(kind, product, details),
    captureState: aiWanted ? 'pending' : 'complete',
    confidence: userChose ? 1 : classification.confidence,
    categorizationSource: userChose ? 'manual' : 'local',
    categorizationReason: userChose ? 'Chosen by you' : classification.reason,
    needsReview: !userChose && classification.isInbox,
  });
  const collection = targetId ? await store.getCollection(targetId) : null;
  if (userChose && learn && product.title) {
    // Overriding the suggestion is a correction worth learning from.
    const prefs2 = await store.getPrefs();
    await store.setPrefs(learnFromCorrection(item, classification.isInbox ? null : classification.collectionId, targetId, prefs2, { strong: learn === 'strong' }));
  }
  if (collection && !collection.coverImage && item.image) {
    await store.updateCollection(collection.id, { coverImage: item.image });
  }
  if (aiWanted) queueEnrich(item.id);
  if (FILLED_KINDS.includes(kind)) queueFill(item.id);
  return { ok: true, item, collection, classification: { ...classification, collectionId: targetId, collectionName: collection ? collection.name : classification.collectionName } };
}

// --- after the save: fill in a Lifestyle save ---------------------------------------------------------
// A save you put into a Lifestyle view (or that Keepsake recognised as one) gets what's missing filled in:
//   1. Optional AI, only if you turned it on: names the place, film or book the post is about, lists a
//      workout's exercises, or drafts a recipe. Logged in the AI change log with Undo.
//   2. Lookups you turned on (Settings → Lookups, each site granted): OpenStreetMap for a place's address
//      and pin, Wikidata for a film or show, Open Library for a book. Only missing fields are filled.
// One save at a time; OpenStreetMap gets at most one request a second.
let fillQueue = Promise.resolve();
let lastNominatim = 0;
const FILLED_KINDS = ['place', 'media', 'book', 'recipe', 'workout'];
function queueFill(id) {
  fillQueue = fillQueue.then(() => fillKind(id)).catch(() => {});
  return fillQueue;
}

async function lookupAllowed(settings, which) {
  if (!settings.lookups?.[which]) return false;
  try {
    return await chrome.permissions.contains({ origins: LOOKUP_SOURCES[which].origins });
  } catch {
    return false;
  }
}

async function fillKind(id) {
  let item = await store.getItem(id);
  if (!item || item.deletedAt) return;
  const kind = kindOf(item);
  if (!FILLED_KINDS.includes(kind)) return;
  const settings = await store.getSettings();
  const key = settings.ai?.on ? await store.getSecret('aiApiKey') : '';
  let d = item.details || {};
  // A post with no name for its place (its title is the caption's), or an imported post that says nothing
  // about where it is: your provider names it and its city, so the lookup can find it.
  const unknownPlace = kind === 'place' && item.type === 'instagram' && !d.address && d.lat == null && !d.locality;
  const unnamed = (genericTitle(item.title) || unknownPlace) && !(item.userFields || []).includes('title');
  if (key && ((['place', 'media', 'book'].includes(kind) && unnamed) || (kind === 'workout' && !d.exercises?.length) || (kind === 'recipe' && !d.ingredients?.length))) {
    try {
      let patch = null;
      if (kind === 'recipe') {
        const r = await draftRecipe(item, settings, key);
        patch = { details: { ...d, ...r } };
      } else {
        const r = await identifyForKind(kind, item, settings, key);
        if (r && kind === 'place') patch = { title: r.name, details: { ...d, locality: d.locality || r.locality } };
        else if (r && kind === 'media') patch = { title: r.title, details: { ...d, year: d.year || r.year, format: r.format || d.format } };
        else if (r && kind === 'book') patch = { title: r.title, details: { ...d, author: d.author || r.author } };
        else if (r && kind === 'workout') patch = { details: { ...d, exercises: r.exercises, durationMinutes: d.durationMinutes || r.durationMinutes, source: 'ai' } };
      }
      if (patch) {
        const before = Object.fromEntries(Object.keys(patch).map((k) => [k, item[k] ?? null]));
        await store.updateItem(id, patch, { by: 'ai' });
        await store.appendAiLog([{ id: uid(), runId: `fill-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || item.title,
          changes: Object.keys(patch).map((f) => (f === 'details' ? { field: `${kindInfo(kind).label.toLowerCase()} details`, from: '—', to: 'filled in' } : { field: f, from: String(before[f] ?? ''), to: String(patch[f]) })),
          before, after: patch, reason: `Filled in for ${kindInfo(kind).plural}`, undone: false }]);
        item = await store.getItem(id);
        d = item.details || {};
      }
    } catch {
      /* the provider didn't answer: the save stays as it was */
    }
  }
  if (genericTitle(item.title)) return; // nothing to look up by
  try {
    let found = null;
    if (kind === 'place' && d.lat == null && await lookupAllowed(settings, 'places')) {
      const waitTurn = async () => {
        const wait = 1100 - (Date.now() - lastNominatim);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastNominatim = Date.now();
      };
      found = await lookupPlace({ name: item.title, locality: d.locality, address: d.address, region: d.region }, fetch, waitTurn);
    } else if (kind === 'place' && d.lat != null && !d.address && await lookupAllowed(settings, 'places')) {
      // A pin but no street address (a shared maps link): the address at the pin.
      const wait = 1100 - (Date.now() - lastNominatim);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastNominatim = Date.now();
      found = await lookupAddressAt({ lat: d.lat, lng: d.lng }, fetch);
    } else if (kind === 'media' && (!d.year || !d.director) && await lookupAllowed(settings, 'media')) {
      found = await lookupFilm({ title: item.title, year: d.year, format: d.format === 'series' ? 'series' : '' }, fetch);
    } else if (kind === 'book' && (!d.author || !d.year) && await lookupAllowed(settings, 'books')) {
      found = await lookupBook({ title: item.title, author: d.author }, fetch);
    }
    if (found) {
      const patch = { details: fillMissing(d, found) };
      if (found.image && !item.image) {
        patch.image = found.image;
        patch.images = [found.image];
      }
      await store.updateItem(id, patch, { by: 'lookup' });
    }
  } catch {
    /* offline or the service didn't answer: try again from Settings → Lookups */
  }
}

// --- after the save: optional AI tidy ---------------------------------------------------------------
// Runs once per pending item. Re-reads the item first, so anything the person did in the meantime
// wins: a hand-edited title is kept, and a save they filed or moved is never re-filed. Every change
// goes to the AI change log with Undo. If the provider fails, the save simply stays as it was.
let enrichQueue = Promise.resolve();
function queueEnrich(id) {
  const job = enrichQueue.then(() => enrichItem(id));
  enrichQueue = job.catch(() => {});
  return job;
}

async function enrichPending() {
  try {
    for (const it of await store.getPendingItems()) queueEnrich(it.id);
  } catch {
    /* try again on the next wake */
  }
  return enrichQueue;
}

async function enrichItem(id) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || item.captureState !== 'pending') return;
  const [collections, prefs, settings, key] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings(), store.getSecret('aiApiKey')]);
  if (!settings.ai?.on || !key) {
    await store.updateItem(id, { captureState: 'complete' }, { by: 'machine' });
    return;
  }
  let ai = null;
  try {
    ai = (await cleanupWithAI([{ ref: 'new', item, live: null }], collections, settings, key)).get('new') || null;
  } catch (e) {
    await store.updateItem(id, { captureState: 'complete', captureError: sanitizeText(`AI tidy skipped: ${(e && e.message) || e}`, 200) }, { by: 'machine' }).catch(() => {});
    return;
  }
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return;
  const threshold = prefs.confidenceThreshold || 0.6;
  const userFields = new Set(current.userFields || []);
  const patch = { captureState: 'complete', captureError: '' };
  const before = {};
  const changes = [];
  if (ai && ai.title && current.type !== 'instagram' && !userFields.has('title') && ai.title !== current.title) {
    before.title = current.title;
    patch.title = ai.title;
    changes.push({ field: 'title', from: current.title, to: ai.title });
  }
  const filedByUser = userFields.has('collectionId') || current.categorizationSource === 'manual';
  if (ai && ai.collectionId && ai.collectionId !== current.collectionId && ai.confidence >= threshold && !filedByUser) {
    for (const f of ['collectionId', 'needsReview', 'categorizationSource', 'categorizationReason', 'confidence', 'previousCollections']) before[f] = current[f] === undefined ? null : current[f];
    Object.assign(patch, {
      collectionId: ai.collectionId, needsReview: false, categorizationSource: 'ai', confidence: ai.confidence,
      categorizationReason: `AI: ${ai.reason || 'best match'}`,
      previousCollections: [...(current.previousCollections || []), current.collectionId].filter(Boolean).slice(-20),
    });
    changes.push({ field: 'collection', fromId: current.collectionId || null, toId: ai.collectionId, to: ai.collectionName });
  }
  await store.updateItem(id, patch, { by: 'machine' });
  if (changes.length) {
    const { captureState, captureError, ...after } = patch;
    await store.appendAiLog([{ id: uid(), runId: `save-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after, reason: (ai && ai.reason) || '', undone: false }]);
  }
}

// What the capture card on the page needs to look like the person's chosen style and theme.
async function pageLook() {
  const st = await store.getSettings().catch(() => ({}));
  return { style: st.style || 'modern', theme: st.theme || 'system' };
}

// Up to three likely collections for a save that went to Review. A default collection that doesn't
// exist yet is offered as "new:<key>"; UPDATE_ITEM creates it when picked.
function suggestionsOf(classification) {
  const seen = new Set();
  return (classification?.alternatives || []).filter((a) => a.collectionName && !seen.has(a.collectionName) && seen.add(a.collectionName))
    .slice(0, 3).map((a) => ({ id: a.isNew && a.taxonomyKey ? `new:${a.taxonomyKey}` : a.collectionId, name: a.collectionName }));
}

async function showPageToast(tabId, res, product) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/tokens-content.js', 'src/content/toast.js'] });
    const collections = res.ok && !res.duplicate ? (await store.getCollections()).map((c) => ({ id: c.id, name: c.name })) : [];
    const look = await pageLook();
    const fmt = (n, c) => (Number.isFinite(n) ? new Intl.NumberFormat(undefined, { style: c ? 'currency' : 'decimal', currency: c || undefined }).format(n) : '');
    const payload = res.ok
      ? res.duplicate
        ? { kind: 'duplicate', existing: res.existing, title: (product && product.title) || '', look }
        : {
          kind: 'saved', itemId: res.item.id, title: res.item.title, collectionId: res.item.collectionId || '',
          // Where it went, changeable to any Lifestyle view (it becomes that kind) or collection (shopping).
          collectionName: res.collection ? res.collection.name : '', isInbox: !!res.classification?.isInbox, look,
          lifestyle: hasOwnView(res.item.kind) && !res.collection ? `kind:${res.item.kind}` : '',
          collections: [...LIFESTYLE().map((k) => ({ id: `kind:${k.value}`, name: k.plural, group: 'Lifestyle' })), ...collections.map((c) => ({ ...c, group: 'Collections' }))],
          thumb: /^https:\/\//.test(res.item.image || '') ? res.item.image : '',
          meta: [(() => { try { return fmt(res.item.price, res.item.currency); } catch { return ''; } })(), res.item.retailer || res.item.host].filter(Boolean).join(' · '),
          pending: res.item.captureState === 'pending',
          suggestions: res.classification?.isInbox ? suggestionsOf(res.classification) : [],
        }
      : { kind: 'error', error: res.error || 'Something went wrong.', look };
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [payload, MSG],
      func: (p, M) => {
        const t = globalThis.__keepsakeToast;
        if (!t) return;
        const send = (m) => chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError);
        const cut = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
        if (p.kind === 'error') t.show({ tone: 'error', look: p.look, title: 'Not saved', message: p.error });
        else if (p.kind === 'duplicate') {
          t.show({
            tone: 'info', look: p.look, title: 'Already in Keepsake',
            message: `“${cut(p.existing.title || p.title, 70)}” is ${p.existing.collectionName ? 'in ' + p.existing.collectionName : 'already saved'}.`,
            actions: [{ label: 'Open', primary: true, onClick: () => send({ type: M.OPEN_DASHBOARD, hash: `#item/${p.existing.id}` }) }],
          });
        } else {
          // Say where it went, with a one-step change in case that's the wrong collection.
          const nameOf = (id) => (p.collections.find((c) => c.id === id) || p.suggestions.find((c) => c.id === id) || {}).name || 'collection';
          const move = (id) => {
            if (!id || id === p.collectionId) return;
            chrome.runtime.sendMessage({ type: M.UPDATE_ITEM, itemId: p.itemId, patch: { collectionId: id }, learn: 'light' }, (up) => {
              void chrome.runtime.lastError;
              t.show(up && up.ok
                ? { tone: 'ok', look: p.look, title: `Moved to ${nameOf(id)}`, message: id.startsWith('kind:') ? 'Its details were worked out from the page.' : 'Keepsake will remember this for similar items.', duration: 4000 }
                : { tone: 'error', look: p.look, title: 'Couldn’t move', message: (up && up.error) || '' });
            });
          };
          const status = [p.pending ? 'Finishing details…' : '', 'Saved on this device'].filter(Boolean).join(' · ');
          t.show({
            tone: p.isInbox ? 'review' : 'ok', look: p.look,
            title: p.isInbox ? 'Saved. Pick a collection now or later' : 'Saved to',
            picker: !p.isInbox && p.collections.length ? { options: p.collections, selectedId: p.collectionId || p.lifestyle, label: 'Move to', onChange: (id) => move(id) } : null,
            thumb: p.thumb, message: cut(p.title, 90), meta: p.meta, status,
            suggestions: p.isInbox && p.suggestions.length ? { items: p.suggestions, onPick: (id) => move(id) } : null,
            duration: p.isInbox ? 14000 : 10000,
            actions: [
              { label: 'Undo', quiet: true, onClick: () => send({ type: M.UNDO_SAVE, itemId: p.itemId }) },
              { label: 'Edit', quiet: true, onClick: () => send({ type: M.OPEN_DASHBOARD, hash: `#item/${p.itemId}` }) },
            ],
          });
        }
      },
    });
  } catch {
    /* page may not be scriptable; the save still happened */
  }
}

// --- floating-button content scripts --------------------------------------------------------------

async function grantedOrigins() {
  const perms = await chrome.permissions.getAll();
  return perms.origins || [];
}

function patternGranted(pattern, granted) {
  return granted.includes('<all_urls>') || granted.includes('*://*/*') || granted.includes(pattern) || granted.includes(pattern.replace(/^\*:\/\//, 'https://')) || granted.includes(pattern.replace(/^\*:\/\//, 'http://'));
}

export async function syncContentScripts() {
  const settings = await store.getSettings();
  const mode = settings.floating.mode;
  const granted = await grantedOrigins();
  let matches = [];
  if (mode === 'all') matches = granted.includes('<all_urls>') || granted.includes('*://*/*') ? ['*://*/*'] : granted.filter((p) => p.startsWith('*://') || p.startsWith('http'));
  else if (mode === 'selected') matches = (settings.floating.sites || []).filter((p) => patternGranted(p, granted));
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => []);
  if (mode === 'off' || !matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    return { registered: false, matches: [] };
  }
  const script = { id: CONTENT_SCRIPT_ID, js: ['src/content/tokens-content.js', 'src/content/toast.js', 'src/content/detector.js', 'src/content/floating.js'], matches, runAt: 'document_idle', persistAcrossSessions: true, allFrames: false };
  try {
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  } catch (e) {
    // A stale registration can reference a revoked origin; start over.
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    await chrome.scripting.registerContentScripts([script]).catch(() => {});
  }
  return { registered: true, matches };
}

async function broadcastFloatingRefresh() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) {
    if (!t.id) continue;
    chrome.tabs.sendMessage(t.id, { type: MSG.FLOATING_REFRESH }, () => void chrome.runtime.lastError);
  }
}

chrome.permissions.onRemoved.addListener(async () => {
  await syncContentScripts();
  await broadcastFloatingRefresh();
});
chrome.permissions.onAdded.addListener(async () => {
  await syncContentScripts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.keepsake_settings) {
    syncContentScripts().then(broadcastFloatingRefresh);
  }
});

async function floatingConfig(host) {
  const settings = await store.getSettings();
  const f = settings.floating;
  const hidden = (f.hiddenSites || []).map((h) => h.toLowerCase());
  const hostLc = String(host || '').toLowerCase().replace(/^www\./, '');
  const enabled = f.mode !== 'off' && !hidden.includes(hostLc) && !hidden.includes('www.' + hostLc);
  const collections = (await store.getCollections()).map((c) => ({ id: c.id, name: c.name }));
  const prefs = await store.getPrefs();
  const instantSave = !!settings.ai?.on && !!(await store.getSecret('aiApiKey'));
  return { ok: true, enabled, settings: f, collections, threshold: prefs.confidenceThreshold, instantSave, look: { style: settings.style || 'modern', theme: settings.theme || 'system' } };
}

// --- Instagram scan state ------------------------------------------------------------------------------

async function getScan() {
  const raw = await chrome.storage.session.get(SESSION_KEYS.igScan);
  return raw[SESSION_KEYS.igScan] || null;
}

async function setScan(scan) {
  await chrome.storage.session.set({ [SESSION_KEYS.igScan]: scan });
}

async function startInstagramScan(tabId) {
  const settings = await store.getSettings();
  const ig = settings.instagram;
  await setScan({ tabId, status: 'starting', posts: [], collectionName: '', startedAt: Date.now() });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (o) => { globalThis.__keepsakeIgScanOptions = o; if (globalThis.__keepsakeIgScan) { globalThis.__keepsakeIgScan.running = false; } },
    args: [{ safetyLimit: ig.safetyLimit, idleTimeoutMs: ig.idleTimeoutMs, storeThumbnails: ig.storeThumbnails, autoScroll: true }],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/adapter.js', 'src/instagram/scan.js'] });
  return { ok: true };
}

function sanitizePost(p) {
  const str = (v, n) => (typeof v === 'string' ? sanitizeText(v, n) : '');
  const list = (v, n, f) => (Array.isArray(v) ? v.slice(0, n).map(f).filter(Boolean) : []);
  return {
    url: str(p.url, 300), shortcode: str(p.shortcode, 40), type: p.type === 'reel' ? 'reel' : 'post',
    thumbnail: typeof p.thumbnail === 'string' && (p.thumbnail.startsWith('data:image/') || /^https:\/\//.test(p.thumbnail)) ? p.thumbnail.slice(0, 600000) : '',
    originalThumbnail: str(p.originalThumbnail, 2000), originalImage: str(p.originalImage, 2000),
    caption: str(p.caption, 2200), creator: str(p.creator, 80), alt: str(p.alt, 300), captured: !!p.captured,
    title: str(p.title, 200), postedAt: str(p.postedAt, 40), location: str(p.location, 120), likes: Number.isFinite(p.likes) ? p.likes : null,
    hashtags: list(p.hashtags, 30, (h) => str(h, 60)), mentions: list(p.mentions, 20, (h) => str(h, 40)),
    links: list(p.links, 10, (l) => (l && typeof l === 'object' && l.url ? { url: str(l.url, 2000), label: str(l.label, 80) } : null)),
    products: list(p.products, 10, (x) => (x && typeof x === 'object' && x.name ? { name: str(x.name, 160), price: Number.isFinite(x.price) ? x.price : null, currency: str(x.currency, 8), url: str(x.url, 2000), retailer: str(x.retailer, 80) } : null)),
    linkInBio: !!p.linkInBio, details: !!p.details, detailsVia: str(p.detailsVia, 10), detailsError: str(p.detailsError, 200),
  };
}

// --- reading one post in a background tab (fallback when a fetch hits a login wall) ---------------------
let readQueue = Promise.resolve();
function readPostInTab(url) {
  const u = sanitizeText(url, 300);
  if (!/^https:\/\/www\.instagram\.com\/(p|reel|reels)\/[A-Za-z0-9_-]+\/?/.test(u)) throw new Error('Not an Instagram post URL.');
  const job = readQueue.then(() => readPostInTabNow(u));
  readQueue = job.catch(() => {});
  return job;
}

async function readPostInTabNow(url) {
  // /p/ form: a logged-in /reel/ tab gets rerouted into the reels feed and would read the wrong post.
  const tab = await chrome.tabs.create({ url: openableUrl(url), active: false });
  const tabId = tab.id;
  try {
    await waitForTabLoad(tabId, 20000);
    await new Promise((r) => setTimeout(r, 1500));
    const results = await chrome.scripting.executeScript({ target: { tabId }, files: ['src/instagram/post-page.js'] });
    const bundle = results && results[0] ? results[0].result : null;
    if (!bundle || typeof bundle !== 'object') throw new Error('The post page could not be read.');
    return { ok: true, bundle };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      fn(v);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(resolve);
    };
    const timer = setTimeout(() => finish(reject, new Error('The post page took too long to load.')), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finish(resolve); }).catch(() => {});
  });
}

// --- message hub -----------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  handleMessage(msg, sender)
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse({ ok: false, error: friendlyError(e) }));
  return true; // async
});

async function handleMessage(msg, sender) {
  const fromExtensionPage = !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
  switch (msg.type) {
    case MSG.EXTRACT_TAB: {
      const tabId = msg.tabId || (sender.tab && sender.tab.id);
      if (!tabId) throw new Error('No tab to read.');
      const product = await extractFromTab(tabId, msg.hints || {});
      if (!product) throw new Error('Keepsake could not read this page.');
      return { ok: true, product };
    }
    case MSG.CLASSIFY: {
      const [collections, prefs, settings] = await Promise.all([store.getCollections(), store.getPrefs(), store.getSettings()]);
      const product = normalizeProduct(msg.product);
      const { kind, details } = captureFacts(product);
      return { ok: true, classification: classifyCapture(product, kind, details, { collections, prefs, settings }) };
    }
    case MSG.SAVE_ITEM: {
      if (!msg.product || typeof msg.product !== 'object') throw new Error('Nothing to save.');
      return saveProduct(msg.product, { collectionId: msg.collectionId || null, force: !!msg.force, source: msg.source || (sender.tab ? 'floating' : 'toolbar'), classification: msg.classification || null, note: msg.note || '', learn: msg.learn === 'strong' ? 'strong' : 'light', instant: !!msg.instant });
    }
    case MSG.UPDATE_ITEM: {
      const item = await store.getItem(msg.itemId);
      if (!item) throw new Error('That item no longer exists.');
      const patch = { ...(msg.patch || {}) };
      // Into a Lifestyle view ("kind:place" from a picker, or { kind }): becomes that kind, details worked out.
      if (typeof patch.collectionId === 'string' && patch.collectionId.startsWith('kind:')) patch.kind = patch.collectionId.slice(5);
      if (typeof patch.kind === 'string' && isKind(patch.kind) && hasOwnView(patch.kind)) {
        delete patch.collectionId;
        await store.updateItem(item.id, kindChangePatch(item, patch.kind), { by: 'kind' });
        queueFill(item.id);
        delete patch.kind;
      }
      // A Lifestyle save going into a collection becomes something to buy.
      if (typeof patch.collectionId === 'string' && patch.collectionId && hasOwnView(kindOf(item))) {
        await store.updateItem(item.id, { kind: shoppingKindFor(item), details: {} }, { by: 'kind' });
      }
      delete patch.kind;
      if (typeof patch.collectionId === 'string' && patch.collectionId.startsWith('new:')) {
        const col = await store.ensureCollectionForTaxonomy(patch.collectionId.slice(4));
        if (!col) throw new Error('That collection no longer exists.');
        patch.collectionId = col.id;
      }
      if (patch.collectionId && patch.collectionId !== item.collectionId) {
        await store.moveItems([item.id], patch.collectionId, { learn: msg.learn === false ? false : msg.learn === 'strong' ? 'strong' : 'light' });
        delete patch.collectionId;
      }
      if (Object.keys(patch).length) {
        const normalized = normalizeProduct({ ...item, ...patch, priceText: patch.priceText || '' });
        // Only carry over fields we allow the page to update.
        const allowed = ['title', 'price', 'currency', 'image', 'images', 'description', 'note', 'favorite', 'purchased', 'imageAspect'];
        const safePatch = {};
        for (const k of allowed) if (k in patch || (k === 'price' && 'priceText' in patch)) safePatch[k] = normalized[k];
        if (safePatch.price === undefined || safePatch.price === null) delete safePatch.price;
        if (!safePatch.image) delete safePatch.image;
        await store.updateItem(item.id, safePatch);
      }
      return { ok: true, item: await store.getItem(item.id) };
    }
    case MSG.FILL_ITEM: {
      queueFill(msg.itemId);
      return { ok: true };
    }
    case MSG.FILL_KIND: {
      const ids = (await store.getItems()).filter((i) => kindOf(i) === msg.kind && !i.deletedAt).map((i) => i.id);
      for (const id of ids) queueFill(id);
      return { ok: true, count: ids.length };
    }
    case MSG.UNDO_SAVE: {
      // Undoing a save that just happened removes it outright (it never reaches the Trash).
      await store.deleteForever([msg.itemId]);
      return { ok: true };
    }
    case MSG.OPEN_DASHBOARD: {
      const hash = typeof msg.hash === 'string' && /^#[\w/.-]*$/.test(msg.hash) ? msg.hash : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + hash });
      return { ok: true };
    }
    case MSG.FLOATING_CONFIG:
      return floatingConfig(msg.host || (sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : ''));
    case MSG.FLOATING_REFRESH: {
      await syncContentScripts();
      await broadcastFloatingRefresh();
      return { ok: true };
    }
    case MSG.IG_START_SCAN: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return startInstagramScan(msg.tabId);
    }
    case MSG.IG_STOP_SCAN: {
      const scan = await getScan();
      const tabId = msg.tabId || (scan && scan.tabId);
      if (tabId) chrome.tabs.sendMessage(tabId, { type: MSG.IG_STOP_SCAN }, () => void chrome.runtime.lastError);
      return { ok: true };
    }
    case MSG.IG_SCAN_UPDATE: {
      if (!sender.tab || !/(^|\.)instagram\.com$/.test(new URL(sender.tab.url || sender.url || 'https://invalid/').hostname)) return { ok: false };
      const posts = (Array.isArray(msg.posts) ? msg.posts : []).slice(0, 2000).map(sanitizePost);
      await setScan({
        tabId: sender.tab.id, status: msg.status === 'done' ? 'done' : msg.status === 'error' ? 'error' : 'scanning',
        error: msg.error ? sanitizeText(msg.error, 300) : '', reason: sanitizeText(msg.reason, 40), collectionName: sanitizeText(msg.collectionName, 80),
        collectionUrl: sanitizeText(msg.collectionUrl, 300), username: sanitizeText(msg.username, 80), posts, updatedAt: Date.now(),
      });
      return { ok: true };
    }
    case MSG.ENRICH_PENDING: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      await enrichPending();
      return { ok: true };
    }
    case MSG.IG_SCAN_STATE:
      return { ok: true, scan: await getScan() };
    case MSG.IG_SCAN_SET_POSTS: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      const scan = await getScan();
      if (!scan) throw new Error('There is no scan to update.');
      const posts = (Array.isArray(msg.posts) ? msg.posts : []).slice(0, 2000).map(sanitizePost);
      await setScan({ ...scan, posts, updatedAt: Date.now() });
      return { ok: true };
    }
    case MSG.IG_READ_POST: {
      if (!fromExtensionPage) throw new Error('Not allowed.');
      return readPostInTab(msg.url);
    }
    case MSG.IG_SCAN_CLEAR:
      await chrome.storage.session.remove(SESSION_KEYS.igScan);
      return { ok: true };
    default:
      return { ok: false, error: `Unknown message ${msg.type}` };
  }
}
