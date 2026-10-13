// Library search: local, ranked, forgiving of one typo. Pure (no DOM), so iOS/macOS can share it.
//
// Every word you type has to appear somewhere in the save (word starts count, so "lam" finds "lamp").
// Where it appears sets the rank: title > tags > note > collection > source (shop, site, channel,
// creator) > the rest (description, caption, ingredients, exercises, address, author…).

const FIELD_WEIGHTS = { title: 50, topics: 35, note: 30, collection: 20, source: 15, text: 5 };

export const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
const words = (s) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The text of a save, by field. `collectionName` comes from the caller (records only hold the id).
export function searchFields(item, collectionName = '') {
  const d = item.details || {};
  const flat = (v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name || '' : x)).join(' ') : v ?? '');
  return {
    title: normalize(item.title),
    topics: normalize((item.topics || []).join(' ')),
    note: normalize(item.note),
    collection: normalize(collectionName),
    source: normalize([item.retailer, item.host, item.instagram?.creator, d.channel, d.siteName, d.platform].filter(Boolean).join(' ')),
    text: normalize([item.price !== null && item.price !== undefined ? String(item.price) : '', item.description, item.instagram?.caption, item.instagram?.collectionName, flat(d.ingredients), flat(d.exercises), d.address, d.locality, d.cuisine,
      d.author, d.director, flat(d.genres), d.category].filter(Boolean).join(' ')),
  };
}

// How well a save matches a query: 0 when any word is missing.
export function scoreFields(fields, query) {
  const terms = words(query);
  if (!terms.length) return 0;
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const text = fields[field];
      if (!text) continue;
      const at = text.indexOf(t);
      if (at < 0) continue;
      const wordStart = at === 0 || /[^\p{L}\p{N}]/u.test(text[at - 1]);
      // A whole word or a word start beats the middle of a word ("art" in "tart").
      const s = weight * (wordStart ? 1 : 0.4) + (field === 'title' && at === 0 ? 10 : 0);
      if (s > best) best = s;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

// Damerau–Levenshtein distance, stopping early past `max`.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// When nothing matches: the same query with each unknown word swapped for the closest word in the
// library (one edit for short words, two from 7 letters), or null when there's nothing close.
export function correctQuery(query, allFields) {
  const vocab = new Set();
  for (const f of allFields) for (const v of Object.values(f)) for (const w of words(v)) if (w.length >= 3) vocab.add(w);
  let changed = false;
  const out = words(query).map((t) => {
    if (vocab.has(t) || [...vocab].some((w) => w.startsWith(t))) return t;
    const max = t.length >= 7 ? 2 : 1;
    if (t.length < 4) return t;
    let best = null;
    let bestD = max + 1;
    for (const w of vocab) {
      const dist = editDistance(t, w, max);
      if (dist < bestD || (dist === bestD && best && w.length < best.length)) {
        best = w;
        bestD = dist;
      }
    }
    if (best && bestD <= max) {
      changed = true;
      return best;
    }
    return t;
  });
  return changed ? out.join(' ') : null;
}

// Rank a list: [{ item, score }] best first (newest first among equals). `nameOf(item)` gives the
// collection name. Returns { results, query } where query is the one used (corrected or not).
export function searchItems(items, query, nameOf = () => '') {
  const fields = items.map((i) => searchFields(i, nameOf(i)));
  const run = (q) => items.map((item, n) => ({ item, score: scoreFields(fields[n], q) })).filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.createdAt < b.item.createdAt ? 1 : -1));
  let results = run(query);
  if (results.length) return { results, query, corrected: false };
  const fixed = correctQuery(query, fields);
  if (fixed) {
    results = run(fixed);
    if (results.length) return { results, query: fixed, corrected: true };
  }
  return { results: [], query, corrected: false };
}
