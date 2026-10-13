// Lookups: filling in a save's missing details from free public sources, only when you've turned them on
// (Settings → Lookups) and Chrome has granted that one site. Nothing here guesses: a result is used only
// when its name matches what you saved, and only its own fields are copied (never invented).
//
//   Places        OpenStreetMap Nominatim   address, pin, area for a place's name (+ city)
//   Films & shows Wikidata                  year, director/creator, runtime, seasons, genres, poster
//   Books         Open Library              author, year, pages, ISBN, cover
//
// Each function takes the fetch to use, so tests run them without a network.

export const LOOKUP_SOURCES = {
  places: { label: 'Places', service: 'OpenStreetMap', origins: ['https://nominatim.openstreetmap.org/*', 'https://tiles.openfreemap.org/*'],
    sends: 'the name and city of places you save, and the map area you look at' },
  media: { label: 'Films & shows', service: 'Wikidata', origins: ['https://www.wikidata.org/*'], sends: 'the titles of films and shows you save' },
  books: { label: 'Books', service: 'Open Library', origins: ['https://openlibrary.org/*'], sends: 'the titles (and authors) of books you save' },
};

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !['the', 'and', 'of', 'a', 'an', 'nyc', 'shop', 'cafe'].includes(w)));
// Same name: equal once tidied, one contains the other, or most of the words shared.
export function sameName(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size) >= 0.75;
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!res || !res.ok) throw new Error(`Lookup failed (${res ? res.status : 'no response'})`);
  return res.json();
}

// --- places (Nominatim) ----------------------------------------------------------------------------

const search = (q) => `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=5&q=${encodeURIComponent(q)}`;

// The street address you gave ("186 Bleecker St") matches a result's: the same street, and the same house
// number when one is given.
function sameStreet(address, a = {}) {
  const m = String(address).match(/^(\d+[a-z]?)\s+(.+)$/i);
  const num = m ? m[1].toLowerCase() : '';
  const street = norm((m ? m[2] : address).replace(/\b(st|ave|rd|blvd|ln|dr|pl|sq|ct|pkwy)\b\.?/gi, ''));
  const road = norm(String(a.road || '').replace(/\b(street|avenue|road|boulevard|lane|drive|place|square|court|parkway)\b/gi, ''));
  if (!street || !road || !(road.includes(street) || street.includes(road))) return false;
  return !num || !a.house_number || String(a.house_number).toLowerCase() === num;
}

// waitTurn: called before each request, so the caller can keep to OpenStreetMap's one request a second.
export async function lookupPlace({ name, locality = '', address = '', region = '' }, fetchFn, waitTurn = async () => {}) {
  if (!name && !address) return null;
  // A name alone matches shops of that name anywhere ("Saigon Sandwich" in Paris for one in San Francisco):
  // without a street, city or area, nothing is looked up. A wrong pin is worse than none.
  if (!address && !locality && !region) return null;
  let hit = null;
  let byAddress = false;
  if (name) {
    await waitTurn();
    const list = await getJson(fetchFn, search([name, address, locality, region].filter(Boolean).join(', ')));
    hit = (Array.isArray(list) ? list : []).find((r) => sameName(name, r.name || r.namedetails?.name || String(r.display_name || '').split(',')[0]));
  }
  // Not found by name (a new place OpenStreetMap doesn't know yet): the address the post gave.
  if (!hit && address) {
    await waitTurn();
    const list = await getJson(fetchFn, search([address, locality, region].filter(Boolean).join(', ')));
    hit = (Array.isArray(list) ? list : []).find((r) => sameStreet(address, r.address));
    byAddress = !!hit;
  }
  if (!hit) return null;
  const a = hit.address || {};
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  return {
    address: [a.house_number, a.road].filter(Boolean).join(' '),
    locality: a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || '',
    region: a.city && (a.suburb || a.neighbourhood) ? a.city : a.state || '',
    postalCode: a.postcode || '',
    country: a.country || '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    category: byAddress ? '' : String(hit.type || '').replace(/_/g, ' '),
    lookup: { source: 'OpenStreetMap', url: hit.osm_type && hit.osm_id ? `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}` : '' },
  };
}

// A place with a pin but no street address (a shared maps link): the address at that pin.
export async function lookupAddressAt({ lat, lng }, fetchFn, waitTurn = async () => {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  await waitTurn();
  const r = await getJson(fetchFn, `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`);
  const a = r?.address || {};
  if (!a.road) return null;
  return {
    address: [a.house_number, a.road].filter(Boolean).join(' '),
    locality: a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || '',
    region: a.city && (a.suburb || a.neighbourhood) ? a.city : a.state || '',
    postalCode: a.postcode || '',
    country: a.country || '',
    lookup: { source: 'OpenStreetMap', url: r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : '' },
  };
}

// --- films and shows (Wikidata) ----------------------------------------------------------------------

const FILM = new Set(['Q11424', 'Q202866', 'Q93204', 'Q24869', 'Q506240', 'Q229390']); // film, animated, documentary, feature, TV film, 3D
const SERIES = new Set(['Q5398426', 'Q1259759', 'Q581714', 'Q117467246', 'Q63952888']); // TV series, miniseries, animated series, …
const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*';
const claimIds = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const claimVal = (e, p) => (e.claims?.[p] || [])[0]?.mainsnak?.datavalue?.value;
const yearOfTime = (v) => (v && typeof v.time === 'string' ? Number(v.time.slice(1, 5)) || null : null);

export async function lookupFilm({ title, year = null, format = '' }, fetchFn) {
  if (!title) return null;
  const found = await getJson(fetchFn, `${WD}&action=wbsearchentities&type=item&language=en&limit=8&search=${encodeURIComponent(title)}`);
  const ids = (found.search || []).map((s) => s.id).slice(0, 8);
  if (!ids.length) return null;
  const got = await getJson(fetchFn, `${WD}&action=wbgetentities&props=claims|labels&languages=en&ids=${ids.join('|')}`);
  const entities = ids.map((id) => got.entities?.[id]).filter(Boolean);
  const pick = entities.find((e) => {
    const kinds = claimIds(e, 'P31');
    const isFilm = kinds.some((k) => FILM.has(k));
    const isSeries = kinds.some((k) => SERIES.has(k));
    if (!isFilm && !isSeries) return false;
    if (format === 'film' && !isFilm) return false;
    if (format === 'series' && !isSeries) return false;
    if (!sameName(title, e.labels?.en?.value)) return false;
    const y = yearOfTime(claimVal(e, 'P577')) || yearOfTime(claimVal(e, 'P580'));
    return !year || !y || Math.abs(y - year) <= 1;
  });
  if (!pick) return null;
  const series = claimIds(pick, 'P31').some((k) => SERIES.has(k));
  const people = series ? claimIds(pick, 'P170').concat(claimIds(pick, 'P57')) : claimIds(pick, 'P57');
  const genres = claimIds(pick, 'P136').slice(0, 3);
  const labelIds = [...people.slice(0, 2), ...genres];
  let labels = {};
  if (labelIds.length) {
    const l = await getJson(fetchFn, `${WD}&action=wbgetentities&props=labels&languages=en&ids=${labelIds.join('|')}`);
    labels = Object.fromEntries(Object.entries(l.entities || {}).map(([id, e]) => [id, e.labels?.en?.value || '']));
  }
  const minutes = Number(claimVal(pick, 'P2047')?.amount);
  const seasons = Number(claimVal(pick, 'P2437')?.amount);
  // Only the "film poster" property: the general image is often a still or a filming location.
  const poster = claimVal(pick, 'P3383');
  return {
    format: series ? 'series' : 'film',
    year: yearOfTime(claimVal(pick, 'P577')) || yearOfTime(claimVal(pick, 'P580')),
    director: people.slice(0, 2).map((id) => labels[id]).filter(Boolean).join(', '),
    runtimeMinutes: !series && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
    seasons: series && Number.isFinite(seasons) && seasons > 0 ? Math.round(seasons) : null,
    genres: [...new Set(genres.map((id) => labels[id]).filter(Boolean).map((g) => g.replace(/\s+(?:film|television series|TV series|series|fiction)$/i, '')))],
    image: typeof poster === 'string' ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(poster)}?width=500` : '',
    lookup: { source: 'Wikidata', url: `https://www.wikidata.org/wiki/${pick.id}` },
  };
}

// --- books (Open Library) --------------------------------------------------------------------------

export async function lookupBook({ title, author = '' }, fetchFn) {
  if (!title) return null;
  const url = `https://openlibrary.org/search.json?limit=5&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,subject&title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`;
  const res = await getJson(fetchFn, url);
  const doc = (res.docs || []).find((d) => sameName(title, d.title));
  if (!doc) return null;
  const isbn = (doc.isbn || []).find((i) => /^\d{13}$/.test(i)) || (doc.isbn || []).find((i) => /^\d{9}[\dX]$/i.test(i)) || '';
  return {
    author: (doc.author_name || []).slice(0, 3).join(', '),
    year: Number(doc.first_publish_year) || null,
    pages: Number(doc.number_of_pages_median) || null,
    isbn,
    genres: (doc.subject || []).filter((s) => s.length < 30).slice(0, 3),
    image: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '',
    lookup: { source: 'Open Library', url: doc.key ? `https://openlibrary.org${doc.key}` : '' },
  };
}

// Copies only what's missing: a field you (or the page) already filled is never replaced.
export function fillMissing(details = {}, found = {}) {
  const out = { ...details };
  for (const [k, v] of Object.entries(found)) {
    if (k === 'image' || v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    const cur = out[k];
    if (cur === null || cur === undefined || cur === '' || (Array.isArray(cur) && !cur.length)) out[k] = v;
  }
  return out;
}
