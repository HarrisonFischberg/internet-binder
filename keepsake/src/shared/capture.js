// Keepsake capture rules: what a page (or a share) becomes when you save it. Its kind and that kind's
// details, where it's filed, and the save itself. Shared by the Chrome extension's background worker
// and the iOS Share Extension (through JavaScriptCore), so a page saved on either is the same save.
// Pure apart from the store passed in; the after-save work (AI tidy, Lifestyle fill-in) is the caller's,
// through the enrich/fill hooks.

import { classify, learnFromCorrection, AUTO_FILE_CONFIDENCE } from './categorizer.js';
import { parsePrice, sanitizeText } from './util.js';
import { parsePostBundle } from '../instagram/post.js';
import { isKind, kindInfo, hasOwnView, detailsForKind, placeFromText, genericTitle, kindFromSchemaTypes, recipeFromSchema, recipeFromText, workoutFromText, looksLikeWorkout, placeFromSchema, placeFromMapsUrl, placeFromProfile, placeFromHome, videoPlatform, videoFromCapture, articleFromCapture, isYouTube, titleSite, mediaFromSchema, bookFromSchema } from './kinds.js';
import { guessTopics } from './topics.js';

// Lifestyle kinds whose details are filled in after the save (AI or Lookups, when turned on).
export const FILLED_KINDS = ['place', 'media', 'book', 'recipe', 'workout'];

export function normalizeProduct(raw) {
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
export function topicsFor(kind, product, details) {
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
export function workoutOf(product) {
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
export function placeOf(product) {
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
export function kindOfCapture(product) {
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
export function captureFacts(product) {
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
export function classifyCapture(product, kind, details, ctx) {
  const classification = classify(product, ctx);
  if (hasOwnView(kind)) {
    return { collectionId: null, collectionName: kindInfo(kind).plural, isNew: false, isInbox: false, shelf: kind, confidence: 0.9, alternatives: classification.alternatives || [],
      reason: (KIND_REASON[kind] || (() => kindInfo(kind).label))(details), kind };
  }
  return { ...classification, kind };
}

// instant: saved with no preview (on-page button, right-click). Then a local pick below
// AUTO_FILE_CONFIDENCE goes to Review with that pick as the suggestion, like the toolbar.
export async function saveCapture(store, rawProduct, { collectionId = null, force = false, source = 'toolbar', classification: given = null, note = '', learn = 'light', instant = false } = {}, { enrich = () => {}, fill = () => {} } = {}) {
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
  if (aiWanted) enrich(item.id);
  if (FILLED_KINDS.includes(kind)) fill(item.id);
  return { ok: true, item, collection, classification: { ...classification, collectionId: targetId, collectionName: collection ? collection.name : classification.collectionName } };
}
