import { genericTitle, looksLikeAddress } from './kinds.js';

// Where a place is: its US state (or its country, outside the US), worked out from everything the save
// holds, and whether it's ready for the Places list or needs a look in Places review. Pure functions, no
// browser APIs: the same rules are meant to run on iOS/macOS later. Nothing is looked up here.
//
// The state comes from, in order: the state field ("NY", "New York", "NY 10012"), the ZIP code, the end
// of the street address ("…2nd floor NY", "Austin,TX,78717"), the city ("Brooklyn", "Los Angeles"),
// then what the post says ("in Carteret, NJ", "#nycfood", "St Pete, FL").

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'Washington, D.C.'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'],
  ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];
const BY_CODE = new Map(US_STATES);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const BY_NAME = new Map(US_STATES.map(([c, n]) => [norm(n), c]));
BY_NAME.set('washington dc', 'DC');
BY_NAME.set('district of columbia', 'DC');

// A state written as its code or its name ("NY", "ny 10012", "New York", "Texas 78717"). Null otherwise.
export function stateCode(s) {
  const t = String(s ?? '').trim().replace(/\s+\d{5}(?:-\d{4})?$/, '').replace(/^US-/i, '').trim();
  if (/^[A-Za-z]{2}$/.test(t) && BY_CODE.has(t.toUpperCase())) return t.toUpperCase();
  return BY_NAME.get(norm(t)) || null;
}
export const stateName = (code) => BY_CODE.get(code) || '';

// The first three digits of a ZIP code, by state (USPS ranges).
const ZIP3 = [
  [5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
  [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'],
  [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'],
  [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'],
  [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'],
  [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];
export function stateFromZip(zip) {
  const m = String(zip ?? '').match(/^(\d{3})\d{2}(?:-\d{4})?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return ZIP3.find(([a, b]) => n >= a && n <= b)?.[2] || null;
}

// Cities and boroughs common enough to name their state on their own. Only places with one well-known
// US match ("Portland" is left out: Oregon or Maine).
const CITY_STATE = {
  'new york': 'NY', 'new york city': 'NY', nyc: 'NY', manhattan: 'NY', brooklyn: 'NY', queens: 'NY', bronx: 'NY', 'the bronx': 'NY', 'staten island': 'NY',
  harlem: 'NY', soho: 'NY', williamsburg: 'NY', greenpoint: 'NY', bushwick: 'NY', 'long island city': 'NY', astoria: 'NY', flushing: 'NY',
  'west village': 'NY', 'east village': 'NY', 'lower east side': 'NY', chinatown: '', 'times square': 'NY', 'upper west side': 'NY', 'upper east side': 'NY',
  'fort greene': 'NY', 'park slope': 'NY', dumbo: 'NY', tribeca: 'NY', nolita: 'NY', 'bryant park': 'NY', 'greenwich village': 'NY',
  'los angeles': 'CA', la: 'CA', hollywood: 'CA', 'san francisco': 'CA', sf: 'CA', oakland: 'CA', 'san diego': 'CA', 'san jose': 'CA', 'redwood city': 'CA',
  'santa monica': 'CA', 'silver lake': 'CA', berkeley: 'CA', 'long beach': 'CA', pasadena: 'CA', sacramento: 'CA',
  chicago: 'IL', houston: 'TX', austin: 'TX', dallas: 'TX', 'san antonio': 'TX', 'fort worth': 'TX', 'el paso': 'TX', 'cedar park': 'TX', pflugerville: 'TX', 'new braunfels': 'TX',
  philadelphia: 'PA', philly: 'PA', pittsburgh: 'PA', phoenix: 'AZ', scottsdale: 'AZ', tucson: 'AZ', seattle: 'WA', boston: 'MA', cambridge: '',
  miami: 'FL', orlando: 'FL', tampa: 'FL', 'st pete': 'FL', 'st petersburg': 'FL', 'saint petersburg': 'FL', jacksonville: 'FL',
  atlanta: 'GA', nashville: 'TN', memphis: 'TN', denver: 'CO', boulder: 'CO', 'las vegas': 'NV', vegas: 'NV', 'salt lake city': 'UT',
  'new orleans': 'LA', nola: 'LA', detroit: 'MI', minneapolis: 'MN', 'st paul': 'MN', 'kansas city': '', 'st louis': 'MO', baltimore: 'MD',
  'washington dc': 'DC', dc: 'DC', honolulu: 'HI', charlotte: 'NC', raleigh: 'NC', columbus: '', cleveland: 'OH', cincinnati: 'OH',
  indianapolis: 'IN', milwaukee: 'WI', louisville: 'KY', 'oklahoma city': 'OK', okc: 'OK', albuquerque: 'NM', omaha: 'NE', hoboken: 'NJ',
  'jersey city': 'NJ', newark: 'NJ', carteret: 'NJ', rexburg: 'ID', boise: 'ID', anchorage: 'AK', providence: 'RI', burlington: '',
};
export const stateFromCity = (city) => CITY_STATE[norm(String(city ?? '').replace(/^(?:the|downtown|north|south|east|west)\s+/i, '').replace(/\s+(?:city|area|neighbou?rhood)$/i, ''))] || null;

// Hashtags and words in a caption that name a city or state ("#nycfood", "#njeats", "#houstonfoodie",
// "#losangeleseats", "in New York City"). Each one names its place on purpose; anything vaguer is skipped.
const HINTS = [
  [/(?:^|[^a-z])(?:nyc|newyorkcity|new york city|manhattan|brooklyn|queens|thebronx|statenisland)/i, 'NY'],
  [/#(?:newyork|ny)(?:food|eats|foodie|city|cityeats|restaurants?|brunch)\b/i, 'NY'],
  [/#(?:nj|newjersey)(?:food|eats|foodie|restaurants?)?\b/i, 'NJ'],
  [/#(?:la|losangeles)(?:food|eats|foodie|restaurants?)\b|#losangeles\b|\blos angeles\b/i, 'CA'],
  [/#(?:sf|sanfrancisco|bayarea)(?:food|eats|foodie|restaurants?)?\b|\bsan francisco\b|\bbay area\b/i, 'CA'],
  [/#(?:houston|austin|dallas|sanantonio|texas|tx)(?:food|eats|foodie|coffee|bakery|restaurants?)?\b|#newbraunfels\w*/i, 'TX'],
  [/#(?:chicago|chi)(?:food|eats|foodie|restaurants?)\b|#chicago\b/i, 'IL'],
  [/#(?:philly|philadelphia)(?:food|eats|foodie|restaurants?)?\b/i, 'PA'],
  [/#(?:miami|orlando|tampa|florida)(?:food|eats|foodie|restaurants?)?\b/i, 'FL'],
  [/#(?:seattle)(?:food|eats|foodie|restaurants?)?\b/i, 'WA'],
  [/#(?:boston)(?:food|eats|foodie|restaurants?)?\b/i, 'MA'],
];

// "Carteret, NJ", "St Pete, FL", "Austin,TX,78717", "Redwood City, California": a city with its state.
const CITY_COMMA_STATE = new RegExp(`\\b([A-Z][\\p{L}.'-]+(?:\\s[A-Z][\\p{L}.'-]+){0,2}),\\s*(${US_STATES.filter(([c]) => c !== 'DC').map(([c, n]) => `${c}|${n}`).join('|')}|D\\.?C\\.?)\\b(?:,?\\s*(\\d{5}))?`, 'u');

// The state of a place: { code: 'NY', name: 'New York', from: 'region' | 'zip' | 'address' | 'city' | 'post' }
// or, for a place outside the US, { code: '', name: country, from: 'country' }. Null when nothing says.
export function placeState(item = {}) {
  const d = item.details || {};
  const country = String(d.country || '').trim();
  const usCountry = !country || /^(?:us|usa|united states(?: of america)?)$/i.test(country);
  const out = (code, from) => ({ code, name: stateName(code), from });
  if (usCountry) {
    let c = stateCode(d.region);
    if (c) return out(c, 'region');
    c = stateFromZip(d.postalCode) || stateFromZip((String(d.region || '').match(/\b(\d{5})\b/) || [])[1]);
    if (c) return out(c, 'zip');
    const addr = String(d.address || '');
    const tail = addr.match(/(?:[\s,]|^)([A-Za-z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)[\s,]*(\d{5})?\.?\s*$/);
    c = tail && (stateCode(tail[1]) || stateFromZip(tail[2]));
    if (c && !(tail[1].length === 2 && tail[1] !== tail[1].toUpperCase())) return out(c, 'address');
    c = stateFromZip((addr.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1]);
    if (c) return out(c, 'address');
    c = stateFromCity(d.locality) || stateFromCity(d.region);
    if (c) return out(c, 'city');
  } else {
    return { code: '', name: country, from: 'country' };
  }
  // What the post or page says.
  const ig = item.instagram && typeof item.instagram === 'object' ? item.instagram : {};
  const text = [ig.place?.city, ig.location, ig.caption, item.description, item.title].filter((t) => typeof t === 'string' && t).join('\n');
  const m = text.match(CITY_COMMA_STATE);
  if (m) {
    const c = stateCode(m[2]);
    if (c) return out(c, 'post');
  }
  const loc = String(ig.place?.city || ig.location || '');
  const fromLoc = stateCode(loc.split(/\s*,\s*/).pop()) || stateFromCity(loc.split(/\s*,\s*/)[0]);
  if (fromLoc) return out(fromLoc, 'post');
  for (const [re, code] of HINTS) if (re.test(text)) return out(code, 'post');
  return null;
}

// The place's own name is known: it has a street, or its title isn't just the start of the
// post's caption ("Top 12 best new NYC restaurants…" is a post about places, not a place).
// A title that is a site's, an address, a city ("New York, New York") or a phrase ("This spot is closed")
// isn't a name, even when a street or pin came with it.
export function placeNamed(item = {}) {
  const d = item.details || {};
  const raw = String(item.title || '').trim();
  const title = norm(raw);
  if (!title || genericTitle(raw) || /^(?:instagram|instagram post|reel by|post by)\b/.test(title) || looksLikeAddress(raw)) return false;
  const parts = raw.split(/\s*,\s*/);
  if (parts.length >= 2 && parts.length <= 3 && (stateCode(parts[parts.length - 1]) || stateFromCity(parts[0])) && !/\d/.test(raw)) return false;
  if (/^(?:this|that|the) (?:spot|place|restaurant|shop|cafe)\b|:$/.test(raw.toLowerCase())) return false;
  // A street makes it one place; a pin alone doesn't (a lookup can pin a whole city).
  if (d.address) return true;
  const caption = norm(item.instagram?.caption || (item.type === 'instagram' ? item.description : ''));
  if (caption && caption.startsWith(title.slice(0, 40))) return false;
  return true;
}

// Why a place is in Places review instead of the list (empty when it isn't): no state, or no name of its own.
export function placeReviewReasons(item = {}) {
  const reasons = [];
  if (!placeNamed(item)) reasons.push('no place name');
  if (!placeState(item)) reasons.push('no state');
  return reasons;
}
