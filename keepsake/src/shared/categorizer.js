// Internet Binder categorization engine.
//
// Public interface (stable — other modules only depend on these):
//   classify(product, context)              -> Classification
//   learnFromCorrection(product, fromId, toId, prefs, options) -> prefs
//   learnFromConfirmation(product, toId, prefs) -> prefs
//   learnFromSaves(saves, prefs) -> prefs
//   findSimilarCollection(name, collections) -> collection | null
//   salientTerms(product)                   -> string[]
//   nameSimilarity(a, b)                    -> 0..1
//   learnedSummary(prefs, collections)      -> { terms, retailers, termCount, moveCount }
//   collectionWords(collection, collections, prefs) -> { learned, builtIn, builtInName }
//
// Classification = {
//   collectionId: string | null,     // null when a new collection is recommended
//   collectionName: string,
//   taxonomyKey: string | null,      // set when recommending a default collection
//   confidence: 0..1,
//   reason: string,                  // short internal explanation
//   isNew: boolean,                  // true if we recommend creating a collection
//   isInbox: boolean,
//   alternatives: [{ collectionId, collectionName, score }]
// }
//
// The engine is deterministic, runs entirely locally and never touches the network.
// An optional AI provider (src/ai/provider.js) can be layered on top by callers.

import { DEFAULT_TAXONOMY, STOPWORDS } from './taxonomy.js';

const FIELD_WEIGHTS = {
  title: 3,
  productType: 3, // the store's own "type" for the product (Shopify product type, WooCommerce category)
  tags: 1.5, // the store's product tags
  instagramCollection: 4,
  schemaCategory: 2.5,
  breadcrumbs: 2.5,
  alt: 1.5,
  cardText: 1,
  description: 1,
  caption: 1.2,
  retailer: 1,
};
// Saves that skip any preview (toolbar icon, on-page buttons, right-click) only
// file an item straight into a collection at or above this confidence.
export const AUTO_FILE_CONFIDENCE = 0.75;

const IDENTITY_FIELDS = new Set(['title', 'productType', 'schemaCategory', 'breadcrumbs', 'instagramCollection']);
const IDENTITY_KINDS = new Set(['user', 'learned']);
const NAME_FIELDS = new Set(['title', 'productType', 'schemaCategory', 'breadcrumbs', 'instagramCollection', 'tags']);
// Site-navigation crumbs that say nothing about the product ("Home > Bedding > Sheets").
const ROOT_CRUMBS = /^(home|homepage|home page|shop|shop all|store|all|all products|products|catalog|catalogue|collections|new|sale|en|us|en-us)$/i;
const KW_WEIGHT = { strong: 3, regular: 1, user: 5, name: 3 };
const MAX_LEARNED_WEIGHT = 6;
const BUILT_IN_KINDS = new Set(['strong', 'regular', 'name']);

// --- text helpers ------------------------------------------------------------

export function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^\p{L}\p{N}'&+\-.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stem(word) {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('es') && /(sh|ch|x|z|o)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is|as|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  return normalizeText(text)
    .split(/[\s/,;:()[\]{}"!?]+/)
    .map((t) => t.replace(/^[-.&+']+|[-.&+']+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+([.,]\d+)?$/.test(t));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Plurals match without listing them: "hoodie" also matches "hoodies",
// "dress" → "dresses", "battery" → "batteries".
function pluralized(body) {
  if (/[^aeiou]y$/.test(body)) return `${body.slice(0, -1)}(?:y|ies)`;
  if (/[a-z]$/.test(body)) return `${body}(?:e?s)?`;
  return body;
}

const regexCache = new Map();
function keywordRegex(keyword) {
  let re = regexCache.get(keyword);
  if (re) return re;
  const prefix = keyword.endsWith('*');
  const body = escapeRegex(normalizeText(prefix ? keyword.slice(0, -1) : keyword)).replace(/\s+/g, '[\\s-]+');
  re = new RegExp(`(?<![\\p{L}\\p{N}])${prefix ? `${body}[\\p{L}]*` : pluralized(body)}(?![\\p{L}\\p{N}])`, 'iu');
  regexCache.set(keyword, re);
  return re;
}

// Matches a keyword (phrase, optional trailing * prefix wildcard) in text.
// Returns the matched text or null.
export function matchKeyword(keyword, text) {
  if (!keyword || !text) return null;
  const m = keywordRegex(keyword).exec(text);
  return m ? m[0] : null;
}

// --- collection name similarity ----------------------------------------------

export function normalizeName(name) {
  return normalizeText(name)
    .replace(/&/g, ' and ')
    .replace(/\band\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !['the', 'my', 'a', 'of', 'for', 'to', 'stuff', 'things', 'items', 'ideas', 'list', 'wishlist', 'collection'].includes(t))
    .map(stem)
    .join(' ')
    .trim();
}

export function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const containment = inter / Math.min(ta.size, tb.size);
  // "Home" vs "Home Decor" => containment 1, jaccard .5
  return Math.max(jaccard, containment * 0.85);
}

// Returns an existing collection that means the same thing as `name`, if any.
export function findSimilarCollection(name, collections, threshold = 0.8) {
  if (!name) return null;
  const target = normalizeName(name);
  let best = null;
  let bestScore = 0;
  for (const c of collections) {
    const candidates = [c.name, ...(c.aliases || [])];
    const tax = taxonomyFor(c, collections);
    if (tax) candidates.push(tax.name, ...(tax.aliases || []));
    for (const cand of candidates) {
      const score = normalizeName(cand) === target ? 1 : nameSimilarity(cand, name);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return bestScore >= threshold ? best : null;
}

// For a name the user typed for a new collection: an existing collection it would
// probably duplicate without being the same name ("Food" vs Kitchen, which covers
// food), and which of that collection's names matched. null when there's none, or
// when a collection already has exactly that name.
export function nearMatchCollection(name, collections) {
  const target = normalizeName(name);
  if (!target || collections.some((c) => normalizeName(c.name) === target)) return null;
  // The user's own keywords say most clearly what a collection covers.
  for (const c of collections) {
    const kw = (c.keywords || []).find((k) => normalizeName(k) === target);
    if (kw) return { collection: c, matched: kw };
  }
  const collection = findSimilarCollection(name, collections);
  if (!collection) return null;
  const tax = taxonomyFor(collection, collections);
  const names = [...(collection.aliases || []), ...(tax ? [tax.name, ...(tax.aliases || [])] : [])];
  const matched = names.find((n) => normalizeName(n) === target) || '';
  return { collection, matched };
}

// The default category a collection stands for, among `collections`. A collection only
// borrows one by name when no other collection is that category outright: with Kitchen
// present, a "Food" collection doesn't take on Kitchen's words (food is one of them).
export function taxonomyFor(collection, collections) {
  const tax = resolveTaxonomy(collection);
  if (!tax || collection.taxonomyKey) return tax;
  return collections.some((o) => o.id !== collection.id && o.taxonomyKey === tax.key) ? null : tax;
}

// Map a user collection onto a default taxonomy entry so it inherits keywords.
export function resolveTaxonomy(collection) {
  if (!collection) return null;
  if (collection.taxonomyKey) {
    const t = DEFAULT_TAXONOMY.find((x) => x.key === collection.taxonomyKey);
    if (t) return t;
  }
  let best = null;
  let bestScore = 0;
  for (const t of DEFAULT_TAXONOMY) {
    for (const cand of [t.name, ...t.aliases]) {
      const s = nameSimilarity(cand, collection.name);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
      for (const alias of collection.aliases || []) {
        const s2 = nameSimilarity(cand, alias);
        if (s2 > bestScore) {
          bestScore = s2;
          best = t;
        }
      }
    }
  }
  return bestScore >= 0.8 ? best : null;
}

// --- product text assembly ----------------------------------------------------

// Phrases that say where or how something is used, not what it is. In
// descriptions they caused false matches ("stay cozy at home" → Home Decor,
// "on the job site" → Tools), so they're removed from descriptive fields.
const USAGE_PHRASES = [
  'at home', 'from home', 'around the house', 'around the home', 'in the home', 'on the job', 'job site', 'jobsite', 'at work',
  'at the office', 'in the office', 'on the go', 'on the road', 'at the gym', 'to the gym', 'at the beach', 'at the campsite',
  'on the trail', 'in the garden', 'in the kitchen', 'in the car', 'in the garage', 'or the garage', 'for the garage',
];
const USAGE_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${USAGE_PHRASES.map((p) => p.replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
function withoutUsage(text) {
  return text.replace(USAGE_RE, ' ').replace(/\s+/g, ' ').trim();
}

function fieldsOf(product) {
  const p = product || {};
  const ig = p.instagram || {};
  const fields = {
    title: normalizeText(p.title),
    productType: normalizeText(p.productType),
    tags: normalizeText(Array.isArray(p.tags) ? p.tags.join(' , ') : p.tags).slice(0, 400),
    description: withoutUsage(normalizeText(p.description)).slice(0, 1500),
    schemaCategory: normalizeText(p.schemaCategory || p.category),
    breadcrumbs: normalizeText((Array.isArray(p.breadcrumbs) ? p.breadcrumbs : [p.breadcrumbs]).filter((c) => c && !ROOT_CRUMBS.test(String(c).trim())).join(' , ')),
    alt: normalizeText(p.imageAlt || p.alt),
    cardText: withoutUsage(normalizeText(p.cardText)).slice(0, 600),
    caption: withoutUsage(normalizeText(ig.caption)).slice(0, 1000),
    instagramCollection: normalizeText(ig.collectionName),
    retailer: normalizeText([p.retailer, p.host, p.brand].filter(Boolean).join(' ')),
  };
  return fields;
}

export function salientTerms(product, max = 12) {
  const title = product?.title || '';
  const toks = tokenize(title).map(stem).filter((t) => t.length >= 3);
  const terms = [];
  const seen = new Set();
  for (let i = 0; i < toks.length; i++) {
    if (i < toks.length - 1) {
      const bi = `${toks[i]} ${toks[i + 1]}`;
      if (!seen.has(bi)) {
        seen.add(bi);
        terms.push(bi);
      }
    }
    if (!seen.has(toks[i])) {
      seen.add(toks[i]);
      terms.push(toks[i]);
    }
  }
  const alt = tokenize(product?.imageAlt || '').map(stem).filter((t) => t.length >= 4 && !seen.has(t));
  for (const t of alt.slice(0, 3)) {
    seen.add(t);
    terms.push(t);
  }
  return terms.slice(0, max);
}

// --- scoring ---------------------------------------------------------------------

function buildCandidates(collections, prefs, settings) {
  const candidates = [];
  const covered = new Set();
  // An alias gives way to a collection with that name: "food" means Food, not Kitchen.
  const ownNames = new Map(collections.map((c) => [normalizeName(c.name), c.id]));
  for (const c of collections) {
    const tax = taxonomyFor(c, collections);
    if (tax) covered.add(tax.key);
    candidates.push({
      id: c.id,
      name: c.name,
      taxonomyKey: tax ? tax.key : null,
      virtual: false,
      strong: tax ? tax.strong : [],
      regular: tax ? tax.keywords : [],
      user: c.keywords || [],
      nameTokens: [c.name, ...(c.aliases || [])].map(normalizeName).filter((t) => t && (!ownNames.has(t) || ownNames.get(t) === c.id)),
    });
  }
  const autoCreate = settings?.autoCreateCollections !== false && prefs?.autoCreateCollections !== false;
  if (autoCreate) {
    for (const t of DEFAULT_TAXONOMY) {
      if (covered.has(t.key)) continue;
      candidates.push({
        id: null,
        name: t.name,
        taxonomyKey: t.key,
        virtual: true,
        strong: t.strong,
        regular: t.keywords,
        user: [],
        nameTokens: [t.name, ...t.aliases].map(normalizeName).filter(Boolean),
      });
    }
  }
  return candidates;
}

// Whether your choices have taught it that these words belong to another collection: once you've
// filed a "kettle" in Coffee setup, the built-in idea that kettles are Kitchen stops competing.
function taughtElsewhere(matched, candidateId, learned) {
  const stems = tokenize(matched).map(stem);
  const claimed = (key) => {
    const e = learned[key];
    if (!e) return false;
    const mine = (candidateId && e[candidateId]) || 0;
    return Object.entries(e).some(([id, w]) => id !== candidateId && w >= LESSON.light && w > mine);
  };
  return claimed(stems.join(' ')) || (stems.length > 1 && stems.every(claimed));
}

function collectMatches(candidate, candidateIndex, fields, prefs) {
  const matches = [];
  const learnedWords = prefs?.learnedKeywords || {};
  const hasLearned = Object.keys(learnedWords).length > 0;
  const add = (field, keyword, matched, weight, kind) => {
    // Built-in words give way to what you've taught it; your own keywords never do.
    if (hasLearned && BUILT_IN_KINDS.has(kind) && taughtElsewhere(matched, candidate.id, learnedWords)) return;
    matches.push({ candidateIndex, field, keyword, matched, weight, kind });
  };
  for (const [field, text] of Object.entries(fields)) {
    if (!text) continue;
    if (field === 'retailer') continue; // handled by retailer preferences
    for (const kw of candidate.strong) {
      const m = matchKeyword(kw, text);
      if (m) add(field, kw, m, KW_WEIGHT.strong, 'strong');
    }
    for (const kw of candidate.regular) {
      const m = matchKeyword(kw, text);
      if (m) add(field, kw, m, KW_WEIGHT.regular, 'regular');
    }
    for (const kw of candidate.user) {
      const m = matchKeyword(kw, text);
      if (m) add(field, kw, m, KW_WEIGHT.user, 'user');
    }
    // Collection name / alias tokens appearing in the text ("Lamps" vs "table lamp").
    // Only in fields that say what the product is: names like "Home", "Body" or
    // "Gear" are everyday words in descriptions ("home office", "full body").
    if (!candidate.virtual && NAME_FIELDS.has(field)) {
      const textStems = new Set(tokenize(text).map(stem));
      for (const nt of candidate.nameTokens) {
        const parts = nt.split(' ');
        if (parts.every((p) => textStems.has(p))) add(field, nt, nt, KW_WEIGHT.name * Math.min(2, parts.length), 'name');
      }
    }
    // Learned keyword → collection weights (from the user's corrections)
    const learned = prefs?.learnedKeywords || {};
    if (candidate.id && Object.keys(learned).length) {
      const stems = tokenize(text).map(stem);
      const grams = new Set(stems);
      for (let i = 0; i < stems.length - 1; i++) grams.add(`${stems[i]} ${stems[i + 1]}`);
      for (const g of grams) {
        const entry = learned[g];
        const w = learnedWeight(entry, candidate.id);
        if (w > 0) add(field, g, g, w, 'learned');
      }
    }
  }
  return matches;
}

// Longer phrase matches dominate shorter ones in the same field ("camp chair" beats "chair").
function applyDominance(matches) {
  const dominable = new Set(['strong', 'regular', 'name']);
  return matches.filter((m) => {
    if (m.kind === 'learned') return true;
    for (const n of matches) {
      if (n === m || n.field !== m.field) continue;
      if (n.matched.length <= m.matched.length) continue;
      if (n.candidateIndex === m.candidateIndex && n.kind === m.kind) continue;
      // Built-in words give way to any longer match. The user's own keywords only give
      // way to a longer keyword of theirs: "coffee cup" (Kitchen) beats "coffee" (Food).
      if (!dominable.has(m.kind) && n.kind !== 'user') continue;
      if (matchKeyword(m.matched, n.matched)) return false;
    }
    return true;
  });
}

export function classify(product, context = {}) {
  const collections = context.collections || [];
  const prefs = context.prefs || {};
  const settings = context.settings || {};
  const threshold = Number.isFinite(Number(prefs.confidenceThreshold)) ? Number(prefs.confidenceThreshold) : 0.6;

  const fields = fieldsOf(product);
  const candidates = buildCandidates(collections, prefs, settings);

  // 1. Instagram collection name that matches an existing collection => direct hit.
  const igName = product?.instagram?.collectionName;
  if (igName) {
    const direct = findSimilarCollection(igName, collections, 0.85);
    if (direct) {
      return finish({
        collectionId: direct.id, collectionName: direct.name, taxonomyKey: direct.taxonomyKey || null,
        confidence: 0.92, reason: `Instagram collection “${igName}” matches “${direct.name}”`, isNew: false, isInbox: false, alternatives: [],
      });
    }
  }

  // 2. Keyword scoring.
  let all = [];
  candidates.forEach((cand, i) => {
    all = all.concat(collectMatches(cand, i, fields, prefs));
  });
  all = applyDominance(all);

  const scores = candidates.map(() => 0);
  const explain = candidates.map(() => []);
  // Whether a candidate has evidence about what the product *is*: a match in the
  // title, the store's type/category/breadcrumbs, or the user's own words and history.
  const identified = candidates.map(() => false);
  // Points from the user's own keywords, kept apart to spot a tie between two of them.
  const userScores = candidates.map(() => 0);
  const seen = new Set();
  const tally = (m) => {
    const key = `${m.candidateIndex}|${m.field}|${m.keyword}`;
    if (seen.has(key)) return;
    seen.add(key);
    const fw = FIELD_WEIGHTS[m.field] || 1;
    scores[m.candidateIndex] += fw * m.weight;
    if (m.kind === 'user') userScores[m.candidateIndex] += fw * m.weight;
    if (IDENTITY_FIELDS.has(m.field) || IDENTITY_KINDS.has(m.kind)) identified[m.candidateIndex] = true;
    if (explain[m.candidateIndex].length < 4) explain[m.candidateIndex].push(m);
  };
  // The user's keyword goes first, so it's the one counted when a built-in word is the
  // same ("coffee" is both Kitchen's and the user's): tally() counts a word once.
  all.sort((a, b) => (b.kind === 'user') - (a.kind === 'user'));
  for (const m of all) if (m.field !== 'tags') tally(m);
  // Store tags are often merchandising ("Holiday Gift Guide", "Bundle"), so they
  // only back up a category the product is already identified with.
  for (const m of all) if (m.field === 'tags' && identified[m.candidateIndex]) tally(m);

  // 3. Retailer preferences learned from past behaviour.
  const host = product?.host || product?.retailerHost || '';
  const retailerPrefs = (prefs.retailerPrefs || {})[host] || null;
  if (retailerPrefs) {
    const total = Object.values(retailerPrefs).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
    candidates.forEach((cand, i) => {
      const count = cand.id ? retailerPrefs[cand.id] : 0;
      // A shop you file everywhere (a big department store) says little; one where most of what you
      // file goes to one collection says a lot.
      if (count >= 2 && count / total >= 0.5) {
        scores[i] += Math.min(8, count * 2) * (count / total);
        identified[i] = true;
        explain[i].push({ field: 'retailer', keyword: host, matched: host, weight: count, kind: 'retailer' });
      }
    });
  }

  const ranked = candidates
    .map((cand, i) => ({ cand, score: scores[i], why: explain[i], identified: identified[i], userScore: userScores[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.cand.virtual === b.cand.virtual ? 0 : a.cand.virtual ? 1 : -1));

  // A collection you gave a keyword to beats one you don't have yet ("stagg" on Coffee setup
  // wins over a new Kitchen for a "Stagg gooseneck kettle").
  const keyedReal = ranked.findIndex((r) => r.userScore > 0 && !r.cand.virtual);
  if (keyedReal > 0 && ranked[0].cand.virtual) ranked.unshift(...ranked.splice(keyedReal, 1));

  const alternatives = ranked.slice(0, 4).map((r) => ({
    collectionId: r.cand.id, collectionName: r.cand.name, taxonomyKey: r.cand.taxonomyKey, score: Math.round(r.score * 10) / 10, isNew: r.cand.virtual,
  }));

  if (!ranked.length) {
    return finish({
      collectionId: null, collectionName: 'Review', taxonomyKey: null,
      confidence: 0, reason: 'No category signals found in the product text', isNew: false, isInbox: true, alternatives,
    });
  }

  const top = ranked[0];
  const userWords = (r) => [...new Set(r.why.filter((w) => w.kind === 'user').map((w) => `“${w.keyword}”`))].join(', ');
  // Two of the user's keywords, for different collections, matched equally well (the
  // same keyword on both, say). Their words don't settle it, so ask rather than guess.
  const keyed = ranked.filter((r) => r.userScore > 0).sort((a, b) => b.userScore - a.userScore);
  if (keyed.length > 1 && keyed[0].userScore === keyed[1].userScore) {
    const [a, b] = keyed;
    const suggest = (r) => alternatives.find((x) => x.collectionId === r.cand.id) || { collectionId: r.cand.id, collectionName: r.cand.name, taxonomyKey: r.cand.taxonomyKey, score: r.score, isNew: false };
    return finish({
      collectionId: null, collectionName: 'Review', taxonomyKey: null, confidence: 0.5,
      reason: `Your keywords match both “${a.cand.name}” (${userWords(a)}) and “${b.cand.name}” (${userWords(b)})`,
      isNew: false, isInbox: true, alternatives: [suggest(a), suggest(b), ...alternatives.filter((x) => x.collectionId !== a.cand.id && x.collectionId !== b.cand.id)].slice(0, 4), suggested: suggest(a),
    });
  }
  // A runner-up only drags confidence down fully when it also has identity
  // evidence. Words that merely show up in a description ("wrench", "print")
  // count for much less when the winner is clearly named in the title or type.
  const rivalry = ranked.slice(1).reduce((max, r) => Math.max(max, r.score * (r.identified || !top.identified ? 0.5 : 0.15)), 0);
  let confidence = (top.score - rivalry) / (top.score + 3);
  confidence = Math.max(0, Math.min(0.98, confidence));
  // A single low-weight regular keyword should never look confident.
  if (top.score < 3) confidence = Math.min(confidence, 0.35);
  // A collection's keywords are the user's own words: when one matched the winner, trust it.
  if (top.userScore > 0) confidence = Math.max(confidence, 0.85);

  const reason = describeWhy(top.why);
  if (confidence < threshold) {
    return finish({
      collectionId: null, collectionName: 'Review', taxonomyKey: null,
      confidence, reason: `Low confidence (${Math.round(confidence * 100)}%) for “${top.cand.name}”: ${reason}`,
      isNew: false, isInbox: true, alternatives, suggested: alternatives[0] || null,
    });
  }

  return finish({
    collectionId: top.cand.id, collectionName: top.cand.name, taxonomyKey: top.cand.taxonomyKey,
    confidence, reason, isNew: top.cand.virtual, isInbox: false, alternatives,
  });

  function finish(result) {
    result.confidence = Math.round(result.confidence * 100) / 100;
    return result;
  }
}

function describeWhy(why) {
  if (!why || !why.length) return 'no matching signals';
  const parts = [];
  const byField = new Map();
  for (const w of why) {
    if (w.kind === 'retailer') {
      parts.push(`you usually file items from ${w.matched} here`);
      continue;
    }
    const label = { title: 'title', description: 'description', schemaCategory: 'category', productType: 'the store’s product type', tags: 'tags', breadcrumbs: 'breadcrumbs', alt: 'image text', cardText: 'card text', caption: 'caption', instagramCollection: 'Instagram collection' }[w.field] || w.field;
    if (!byField.has(label)) byField.set(label, []);
    const tag = w.kind === 'learned' ? ' (learned)' : w.kind === 'user' ? ' (your keyword)' : '';
    byField.get(label).push(`“${w.matched}”${tag}`);
  }
  for (const [label, kws] of byField) parts.push(`${kws.join(', ')} in ${label}`);
  return parts.join('; ');
}

// --- learning -------------------------------------------------------------------

// How hard a learned word pulls toward a collection: its weight there, scaled by the share of the
// word's weight that collection holds. A word you file in one place ("espresso" → Coffee) pulls at
// full strength; one that turns up everywhere ("set", "pack", "black") pulls each place only a little,
// so lots of everyday choices don't drown out the words that mean something.
function learnedWeight(entry, collectionId) {
  const w = entry && entry[collectionId];
  if (!(w > 0)) return 0;
  const total = Object.values(entry).reduce((sum, v) => sum + (v > 0 ? v : 0), 0);
  return Math.min(MAX_LEARNED_WEIGHT, w) * (w / total);
}

// How much one choice teaches. A move or a pick at save time is a clear lesson; keeping the suggestion
// you were shown is a quiet one (half a move, so moving the save later takes it back exactly); "use this
// for similar items" and filing from Review count three times.
const LESSON = { confirm: 0.5, light: 1, strong: 3 };

export function emptyPrefs() {
  return {
    learnedKeywords: {},
    retailerPrefs: {},
    corrections: [],
    confidenceThreshold: 0.6,
    autoCreateCollections: true,
  };
}

// Record a manual move so future similar items land in `toId`.
// options.strong => the user explicitly asked to use this choice for similar items.
// options.confirm => the user saw where it went and kept it (learnFromConfirmation).
export function learnFromCorrection(product, fromId, toId, prefs, options = {}) {
  const next = copyForLearning(prefs);
  if (toId) teach(next, product, fromId, toId, options);
  return next;
}

function copyForLearning(prefs) {
  const next = { ...emptyPrefs(), ...(prefs || {}) };
  next.learnedKeywords = { ...(next.learnedKeywords || {}) };
  next.retailerPrefs = { ...(next.retailerPrefs || {}) };
  next.corrections = [...(next.corrections || [])];
  return next;
}

// One lesson, written into `next` (a copy learnFromCorrection or learnFromSaves made).
function teach(next, product, fromId, toId, options) {
  const terms = salientTerms(product);
  const inc = LESSON[options.confirm ? 'confirm' : options.strong ? 'strong' : 'light'];
  for (const term of terms) {
    const entry = { ...(next.learnedKeywords[term] || {}) };
    entry[toId] = Math.min(MAX_LEARNED_WEIGHT, (entry[toId] || 0) + inc);
    if (fromId && fromId !== toId && entry[fromId]) entry[fromId] = Math.max(0, entry[fromId] - 0.5 * inc);
    for (const k of Object.keys(entry)) if (!entry[k]) delete entry[k];
    next.learnedKeywords[term] = entry;
  }
  const host = product?.host || '';
  if (host) {
    const hp = { ...(next.retailerPrefs[host] || {}) };
    // One save from a shop is one save from it, however sure you were about its words.
    const shop = options.confirm ? LESSON.confirm : LESSON.light;
    hp[toId] = (hp[toId] || 0) + shop;
    if (fromId && fromId !== toId && hp[fromId]) hp[fromId] = Math.max(0, hp[fromId] - 0.5 * shop);
    for (const k of Object.keys(hp)) if (!hp[k]) delete hp[k];
    next.retailerPrefs[host] = hp;
  }
  // The log is of changes you made; keeping a suggestion isn't one.
  if (options.confirm) return;
  next.corrections.push({ at: new Date().toISOString(), itemId: product?.id || null, title: String(product?.title || '').slice(0, 120), from: fromId || null, to: toId, terms, strong: !!options.strong });
  if (next.corrections.length > 200) next.corrections = next.corrections.slice(-200);
}

// Saves already sitting in collections, each a kept suggestion: how the sorter catches up on a
// library filed before it learned this way. One copy for the lot, so a big library stays quick.
export function learnFromSaves(saves, prefs) {
  const next = copyForLearning(prefs);
  for (const s of saves || []) if (s?.collectionId && s.title) teach(next, s, null, s.collectionId, { confirm: true });
  return next;
}

// You saw the collection a save was going to and kept it: a quiet lesson toward that collection.
export function learnFromConfirmation(product, toId, prefs) {
  return learnFromCorrection(product, null, toId, prefs, { confirm: true });
}

// Drop every learned reference to a collection that no longer exists (or was merged).
export function forgetCollection(prefs, collectionId, replacementId = null) {
  const next = { ...emptyPrefs(), ...(prefs || {}) };
  const lk = {};
  for (const [term, entry] of Object.entries(next.learnedKeywords || {})) {
    const e = { ...entry };
    if (e[collectionId]) {
      if (replacementId) e[replacementId] = Math.min(MAX_LEARNED_WEIGHT, (e[replacementId] || 0) + e[collectionId]);
      delete e[collectionId];
    }
    if (Object.keys(e).length) lk[term] = e;
  }
  next.learnedKeywords = lk;
  const rp = {};
  for (const [host, entry] of Object.entries(next.retailerPrefs || {})) {
    const e = { ...entry };
    if (e[collectionId]) {
      if (replacementId) e[replacementId] = (e[replacementId] || 0) + e[collectionId];
      delete e[collectionId];
    }
    if (Object.keys(e).length) rp[host] = e;
  }
  next.retailerPrefs = rp;
  next.corrections = (next.corrections || [])
    .map((c) => {
      if (c.to === collectionId) return replacementId ? { ...c, to: replacementId } : null;
      if (c.from === collectionId) return { ...c, from: replacementId || null };
      return c;
    })
    .filter(Boolean);
  return next;
}

// --- what it learned, shown to the user ---------------------------------------------

// A keyword as people read it: a trailing * (any ending) shows as "…", so "hik*" reads "hik…".
export function keywordLabel(keyword) {
  const k = String(keyword || '');
  return k.endsWith('*') ? `${k.slice(0, -1)}…` : k;
}

// Each learned word and shop, with the collection it pulls hardest toward, strongest first
// (Settings → What it learned).
export function learnedSummary(prefs, collections, { maxTerms = 25, maxRetailers = 15 } = {}) {
  const names = new Map((collections || []).map((c) => [c.id, c.name]));
  const top = (entry) => Object.entries(entry || {}).filter(([id, w]) => names.has(id) && Number(w) > 0).sort((a, b) => b[1] - a[1])[0];
  const lk = Object.entries(prefs?.learnedKeywords || {});
  const terms = lk.map(([term, entry]) => {
    const [collectionId, w] = top(entry) || [];
    return collectionId ? { term, collectionId, collectionName: names.get(collectionId), weight: Number(w) } : null;
  }).filter(Boolean)
    // Strongest first; on a tie the longer phrase, which says more ("side table" before "side").
    .sort((a, b) => b.weight - a.weight || b.term.split(' ').length - a.term.split(' ').length || a.term.localeCompare(b.term));
  const retailers = Object.entries(prefs?.retailerPrefs || {}).map(([host, entry]) => {
    const [collectionId, n] = top(entry) || [];
    return collectionId ? { host, collectionId, collectionName: names.get(collectionId), count: Number(n) } : null;
  }).filter(Boolean).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
  return {
    terms: terms.slice(0, maxTerms),
    retailers: retailers.slice(0, maxRetailers),
    termCount: terms.length,
    moveCount: (prefs?.corrections || []).length,
  };
}

// The words that file saves into a collection besides the ones you typed: what it learned
// from your moves (words whose strongest pull is this collection) and, for a built-in kind
// of collection (Kitchen, Outdoors…), its built-in words. Your own keywords are left out.
export function collectionWords(collection, collections, prefs, { maxLearned = 24 } = {}) {
  if (!collection) return { learned: [], builtIn: [], builtInName: null };
  const mine = new Set((collection.keywords || []).map((k) => String(k).toLowerCase()));
  const learned = learnedSummary(prefs, collections, { maxTerms: Infinity }).terms
    .filter((t) => t.collectionId === collection.id && t.weight >= 1 && !mine.has(t.term))
    .slice(0, maxLearned)
    .map(({ term, weight }) => ({ term, weight }));
  const tax = taxonomyFor(collection, collections || []);
  const shown = new Set(learned.map((t) => t.term));
  const builtIn = tax ? [...new Set([...(tax.strong || []), ...tax.keywords])].filter((k) => !mine.has(k) && !shown.has(k)) : [];
  return { learned, builtIn, builtInName: tax ? tax.name : null };
}
