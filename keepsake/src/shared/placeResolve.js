// Fix with AI on a place: which real place a save is about, in steps that can each be checked.
//
//   1. clues      what the save itself says: the place's name (title, 📍 line, location tag, tagged
//                 account), a street address, the city or state. Nothing is sent anywhere.
//   2. candidates OpenStreetMap results for those clues (Lookups → Places on), and, when you ask with your
//                 key and web lookups on, the places your provider finds with web search.
//   3. identity   each candidate is checked against the clues with fixed rules (same name, same area or
//                 street, a source that isn't the model), never the model's own confidence.
//   4. outcome    verified: one candidate passes, nothing close competes, and its address and pin come
//                 from the post, OpenStreetMap or a page the search cited. Only then are they written.
//                 review: up to three candidates are kept on the save for you to choose (placeChoices).
//                 insufficient: the save doesn't say enough (no name, or nowhere to look), so nothing is
//                 looked up or guessed.
//
// Every fact written says where it came from (details.lookup: source, url, verifiedBy), and the change is
// logged with Undo. Shared by Chrome and the iPhone and Mac apps (through JavaScriptCore).

import { uid, nowIso } from './util.js';
import { kindOf, placeFromText, placeFromPost, looksLikeAddress, sanitizeDetails } from './kinds.js';
import { placeNamed } from './places.js';
import { sameName, searchPlaces, inArea, sameStreet, apart } from './lookups.js';
import { findPlaceWithAI, keyFor, supportsWebLookup } from '../ai/provider.js';

export const PLACE_RESOLVE_VERSION = 'place-resolve-1';
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nameFromHandle = (h) => String(h || '').replace(/[._]+/g, ' ').replace(/\b(?:nyc|la|sf|official|hq)\b/gi, ' ').replace(/\s+/g, ' ').trim();

// 1. What the save says about where it is.
export function placeClues(item = {}) {
  const ig = item.instagram && typeof item.instagram === 'object' ? item.instagram : {};
  const d = item.details || {};
  const text = String(ig.caption || item.description || '').slice(0, 2200);
  const pins = (text.match(/📍|📌/gu) || []).length;
  const fromText = placeFromText(text);
  const fromPost = placeFromPost({ caption: text, location: ig.location || '', place: ig.place || null });
  const names = [];
  const add = (n) => { const v = String(n || '').trim(); if (v.length >= 2 && !names.some((x) => sameName(x, v))) names.push(v); };
  if (placeNamed(item)) add(item.title);
  add(fromText?.name);
  add(fromPost?.name);
  if (ig.place?.name) add(ig.place.name);
  const handles = [...new Set([fromText?.handle, ...[...text.matchAll(/(?<![\w@])@([A-Za-z0-9._]{3,30})/g)].map((m) => m[1])].filter(Boolean))].slice(0, 6);
  const address = d.address || fromText?.address || fromPost?.details?.address || '';
  const areas = [...new Set([d.locality, d.region, fromText?.locality, fromText?.region, fromPost?.details?.locality, fromPost?.details?.region, ig.place?.city].filter(Boolean))];
  return {
    names, handles, address: looksLikeAddress(address) ? address : '', areas,
    locality: d.locality || fromText?.locality || fromPost?.details?.locality || ig.place?.city || '',
    region: d.region || fromText?.region || fromPost?.details?.region || '',
    location: ig.location || ig.place?.name || '',
    // The only city is the location tag's, and the tag is a city, not the venue: where it was posted from.
    tagOnly: !d.locality && !d.region && !fromText?.locality && !fromText?.region && !!(fromPost?.details?.locality || fromPost?.details?.region)
      && !names.some((n) => sameName(n, String(ig.location || '').split(',')[0])),
    // Three or more pins: a round-up of places, not one place.
    roundup: pins >= 3,
    text,
  };
}

// Whether the clues are enough to look anything up: a name (or address) and somewhere to look.
export function cluesEnough(clues) {
  if (clues.roundup) return 'it lists several places';
  if (!clues.names.length && !clues.address) return 'the post doesn’t name a place';
  if (!clues.address && !clues.locality && !clues.region) return 'the post doesn’t say which city or area';
  return '';
}

// "237 St James Pl" is "237 St James Place": street words compared in one spelling.
const STREET_WORDS = { street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', lane: 'ln', drive: 'dr', place: 'pl', square: 'sq', court: 'ct', parkway: 'pkwy', highway: 'hwy', east: 'e', west: 'w', north: 'n', south: 's' };
const streetForm = (s) => norm(s).split(' ').map((w) => STREET_WORDS[w] || w).join(' ');
const statedIn = (fact, texts) => {
  const f = streetForm(fact);
  return f.length >= 6 && texts.some((t) => ` ${streetForm(t)} `.includes(` ${f} `));
};

// 3. One candidate checked against the clues. Pure.
export function checkCandidate(c, clues, { osm = [] } = {}) {
  const nameOk = clues.names.some((n) => sameName(n, c.name)) || clues.handles.some((h) => sameName(nameFromHandle(h), c.name));
  const area = { city: c.locality, town: c.locality, state: c.region, 'ISO3166-2-lvl4': /^[A-Z]{2}$/.test(c.region || '') ? `US-${c.region}` : '' };
  const areaOk = !!(clues.locality || clues.region) && inArea(clues.locality, clues.region, area) && !!(c.locality || c.region);
  const streetOk = !!(clues.address && c.address) && sameStreet(clues.address, { road: String(c.address).replace(/^\d+[a-z]?\s+/i, ''), house_number: (String(c.address).match(/^(\d+[a-z]?)\s/i) || [])[1] || '' });
  // Where its address and pin come from. The model alone is never enough.
  const confirmedBy = [];
  if (c.source === 'openstreetmap') confirmedBy.push('openstreetmap');
  let pin = c.source === 'openstreetmap' && c.lat != null ? { lat: c.lat, lng: c.lng, url: c.url } : null;
  if (c.source === 'web') {
    const match = osm.find((o) => sameName(o.name, c.name) && (inArea(c.locality, c.region, o.raw) || (c.address && sameStreet(c.address, o.raw))));
    if (match) { confirmedBy.push('openstreetmap'); pin = { lat: match.lat, lng: match.lng, url: match.url }; }
    if (c.address && statedIn(c.address, c.quotes || [])) confirmedBy.push('cited-page');
  }
  if (c.address && clues.address && streetOk) confirmedBy.push('post');
  const exact = clues.names.some((n) => norm(n) === norm(c.name)) || clues.handles.some((h) => norm(nameFromHandle(h)) === norm(c.name));
  return { nameOk, exact, areaOk, streetOk, confirmedBy: [...new Set(confirmedBy)], pin, sourced: c.source === 'openstreetmap' || !!c.url };
}

// 2–4. Candidates from both sources, checked and decided. Pure: tested with captured answers.
export function resolvePlace(clues, { osm = [], web = null } = {}) {
  const short = cluesEnough(clues);
  if (short && !(web?.candidates?.length && !clues.roundup && clues.names.length)) return { outcome: 'insufficient', reason: short, candidates: [] };
  const all = [
    ...osm.map((o) => ({ ...o, source: 'openstreetmap' })),
    ...(web?.candidates || []).map((w) => ({ ...w, source: 'web' })),
  ].map((c) => ({ ...c, check: checkCandidate(c, clues, { osm }) }));
  // The same place from both sources is one candidate (the confirmed one kept).
  const merged = [];
  for (const c of all) {
    // Two branches on different streets are two places. With both pins, the pins decide ("200 Calle Durango"
    // and "Durango 200, Roma Norte" are one door); the street's words only when a pin is missing.
    const otherStreet = (m) => !(m.check.pin && c.check.pin) && m.address && c.address && !sameStreet(m.address, { road: String(c.address).replace(/^\d+[a-z]?\s+/i, ''), house_number: (String(c.address).match(/^(\d+[a-z]?)\s/i) || [])[1] || '' });
    const twin = merged.find((m) => sameName(m.name, c.name) && !otherStreet(m) && (m.check.pin && c.check.pin ? !apart({ lat: m.check.pin.lat, lon: m.check.pin.lng }, { lat: c.check.pin.lat, lon: c.check.pin.lng }) : sameName(m.locality, c.locality)));
    if (!twin) { merged.push(c); continue; }
    twin.check.confirmedBy = [...new Set([...twin.check.confirmedBy, ...c.check.confirmedBy])];
    twin.check.areaOk ||= c.check.areaOk;
    twin.check.streetOk ||= c.check.streetOk;
    twin.check.pin ||= c.check.pin;
    if (!twin.url && c.url) twin.url = c.url;
    if (!twin.address && c.address && c.check.confirmedBy.length) twin.address = c.address;
  }
  // A name that only contains the post's ("Kismet Rotisserie" for "Kismet") needs a map or the street to agree.
  // A city that only the location tag gives isn't enough without the street either.
  const passes = (c) => c.check.nameOk && (c.check.exact || c.check.streetOk || c.check.confirmedBy.includes('openstreetmap'))
    && (c.check.streetOk || (c.check.areaOk && !clues.tagOnly)) && c.check.confirmedBy.length > 0;
  const ranked = merged
    .map((c) => ({ ...c, score: (c.check.nameOk ? 4 : 0) + (c.check.streetOk ? 3 : 0) + (c.check.areaOk ? 2 : 0) + c.check.confirmedBy.length + (c.check.sourced ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
  let good = ranked.filter(passes);
  // The post gives the street: the branch on it is the one, the chain's others aren't rivals.
  const onStreet = clues.address ? good.filter((c) => c.check.streetOk) : [];
  if (onStreet.length === 1) good = onStreet;
  const rival = (c) => c !== good[0] && c.check.nameOk && c.check.areaOk && !(onStreet.length === 1 && !c.check.streetOk);
  const choices = ranked.filter((c) => c.check.nameOk || c.check.streetOk || (c.source === 'web' && c.url)).slice(0, 3);
  if (good.length === 1 && !ranked.some(rival)) {
    return { outcome: 'verified', chosen: good[0], candidates: ranked.slice(0, 3), reason: `${good[0].name}: ${describe(good[0].check)}` };
  }
  if (!choices.length) return { outcome: 'insufficient', reason: short || 'nothing found matches the post', candidates: [] };
  const why = good.length > 1 ? 'several places match' : ranked.some((c) => c.check.nameOk && c.check.areaOk && !c.check.confirmedBy.length) ? 'no source but the AI confirms it' : 'no candidate matches the post’s name and area';
  return { outcome: 'review', reason: why, candidates: choices };
}

function describe(check) {
  return [check.nameOk && 'same name', check.streetOk ? 'same street' : check.areaOk && 'same area', check.confirmedBy.length && `confirmed by ${check.confirmedBy.join(' and ')}`].filter(Boolean).join(', ');
}

// What a decision changes on the save (pure). Only empty fields are filled, never what you typed.
export function planPlaceResolution(item, result, { at = nowIso() } = {}) {
  const d = item.details || {};
  const mine = new Set(item.userFields || []);
  const resolution = { version: PLACE_RESOLVE_VERSION, at, outcome: result.outcome, reason: String(result.reason || '').slice(0, 200) };
  const patch = { placeResolution: resolution };
  const changes = [];
  // Details you wrote (an empty card is "yours" only by default) are left as they are.
  const yours = mine.has('details') || (d.source === 'you' && ['address', 'locality', 'region', 'phone', 'cuisine'].some((k) => d[k]) && !d.lookup);
  if (result.outcome === 'verified' && !yours) {
    const c = result.chosen;
    const confirmed = c.check.confirmedBy;
    const next = { ...d };
    const fill = (k, v) => { if (v && !next[k]) next[k] = v; };
    // An address only from the post, OpenStreetMap or a page the search cited; a pin only from OpenStreetMap.
    if (confirmed.length) fill('address', c.address);
    fill('locality', c.locality);
    fill('region', c.region);
    fill('postalCode', c.postalCode);
    if (next.lat == null && c.check.pin) Object.assign(next, { lat: c.check.pin.lat, lng: c.check.pin.lng });
    next.lookup = { source: c.check.pin ? 'OpenStreetMap' : 'Web', url: c.check.pin?.url || c.url || '', verifiedBy: confirmed, at };
    if (next.source === 'you' && !yours) next.source = 'page';
    const clean = sanitizeDetails('place', next);
    if (JSON.stringify(clean) !== JSON.stringify(sanitizeDetails('place', d))) {
      patch.details = clean;
      changes.push({ field: 'place details', from: d.address || '—', to: [clean.address, clean.locality, clean.region].filter(Boolean).join(', ') });
    }
    if (!placeNamed(item) && !mine.has('title') && c.name && c.name !== item.title) {
      patch.title = c.name;
      changes.push({ field: 'title', from: item.title, to: c.name });
    }
    patch.placeChoices = [];
  } else if (result.outcome === 'verified' && d.lat == null && result.chosen.check.pin) {
    // Details you wrote stay as they are; a confirmed pin is only added beside them.
    const pin = result.chosen.check.pin;
    patch.details = sanitizeDetails('place', { ...d, lat: pin.lat, lng: pin.lng, lookup: { source: 'OpenStreetMap', url: pin.url || '', verifiedBy: result.chosen.check.confirmedBy, at } });
    changes.push({ field: 'place details', from: '—', to: 'pin on the map' });
    patch.placeChoices = [];
  } else if (result.outcome === 'review') {
    patch.placeChoices = result.candidates.map((c) => ({
      name: c.name, address: c.check.confirmedBy.length ? c.address || '' : '', locality: c.locality || '', region: c.region || '',
      url: c.check.pin?.url || c.url || '', lat: c.check.pin?.lat ?? null, lng: c.check.pin?.lng ?? null,
      source: c.source, confirmedBy: c.check.confirmedBy, why: describe(c.check) || 'named like the post',
    }));
  }
  return { patch, changes };
}

// Runs the place check on one save. lookups: allowed(settings, 'places') as fillSave's; the web search only
// with your key (never on the device's own runs) and web lookups on.
export async function resolvePlaceSave(store, id, { fetchFn, allowed = async () => false, waitTurn = async () => {}, deviceOnly = false, runId = '' } = {}) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt || kindOf(item) !== 'place') return null;
  const settings = await store.getSettings();
  const clues = placeClues(item);
  const osmOn = await allowed(settings, 'places');
  const key = deviceOnly ? '' : keyFor(settings, await store.getSecret('aiApiKey'), {});
  const webOn = !!key && !!settings.ai?.webLookup && supportsWebLookup(settings) && !clues.roundup && (clues.names.length || clues.address);
  const osm = [];
  if (osmOn && !cluesEnough(clues)) {
    for (const name of clues.names.slice(0, 2)) osm.push(...await searchPlaces({ name, locality: clues.locality, region: clues.region, address: clues.address }, fetchFn, waitTurn));
  }
  const web = webOn ? await findPlaceWithAI(clues, settings, key) : null;
  // The web's candidates looked up on OpenStreetMap too, so their pins have a source.
  if (osmOn && web) {
    for (const c of web.candidates.slice(0, 2)) if (c.locality || c.region || c.address) osm.push(...await searchPlaces({ name: c.name, locality: c.locality, region: c.region, address: c.address }, fetchFn, waitTurn));
  }
  const result = resolvePlace(clues, { osm, web });
  const current = await store.getItem(id);
  if (!current || current.deletedAt) return null;
  const { patch, changes } = planPlaceResolution(current, result);
  patch.placeResolution = { ...patch.placeResolution, sources: [osmOn && 'openstreetmap', web && `${web.provider} web search`].filter(Boolean) };
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k] === undefined ? null : current[k]]));
  await store.updateItem(id, patch, { by: 'ai' });
  if (changes.length) {
    await store.appendAiLog([{ id: uid(), runId: runId || `place-${id}`, at: nowIso(), itemId: id, itemTitle: patch.title || current.title, changes, before, after: patch, reason: result.reason, undone: false }]);
  }
  return { outcome: result.outcome, reason: result.reason, changed: changes.length > 0, choices: patch.placeChoices || [] };
}

// You picked one of the choices: it's applied as you chose it (yours now), and the choices are cleared.
export async function choosePlace(store, id, index) {
  const item = await store.getItem(id);
  const c = item?.placeChoices?.[index];
  if (!c) return null;
  const d = item.details || {};
  const details = sanitizeDetails('place', {
    ...d, address: c.address || d.address, locality: c.locality || d.locality, region: c.region || d.region,
    lat: c.lat ?? d.lat ?? null, lng: c.lng ?? d.lng ?? null,
    lookup: { source: c.lat != null ? 'OpenStreetMap' : 'Web', url: c.url || '', verifiedBy: [...(c.confirmedBy || []), 'you'], at: nowIso() },
  });
  const patch = { details, placeChoices: [], placeResolution: { ...(item.placeResolution || {}), outcome: 'chosen', at: nowIso() } };
  if (!(item.userFields || []).includes('title')) patch.title = c.name;
  return store.updateItem(id, patch, { by: 'user' });
}

// None of the choices is the place: they're cleared and nothing on the save changes. Fix with AI can
// look again later.
export async function dismissPlaceChoices(store, id) {
  const item = await store.getItem(id);
  if (!item?.placeChoices?.length) return item || null;
  return store.updateItem(id, { placeChoices: [], placeResolution: { ...(item.placeResolution || {}), outcome: 'dismissed', at: nowIso() } }, { by: 'user' });
}

// What choosePlace and dismissPlaceChoices change, kept before they run, so Undo can put it back.
export const placeSnapshot = (item) => ({ id: item.id, title: item.title, details: item.details || {}, placeChoices: item.placeChoices || [], placeResolution: item.placeResolution || null, userFields: item.userFields || [] });
export async function restorePlace(store, snapshot) {
  if (!snapshot?.id || !(await store.getItem(snapshot.id))) return null;
  const { id, ...before } = snapshot;
  return store.updateItem(id, before, { by: 'undo' });
}
