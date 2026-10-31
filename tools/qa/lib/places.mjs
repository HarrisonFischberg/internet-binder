// Place-resolution cases (fixtures/places-challenge.json) run through the shipped code with captured
// answers: OpenStreetMap's JSON and the provider's web-search reply are served by a fake fetch, so the
// real parsing, checks and storage run. `path` 'resolve' is Fix with AI's place check (placeResolve.js);
// 'old' is the fill-in it replaces (fill.js fillSave with review on: the provider names the place, then
// OpenStreetMap), given the same answers, with the model echoing the web answer's first candidate.

import { readFileSync } from 'node:fs';
import { createStore, memoryBackend, memoryRecordBackend } from '../../../keepsake/src/shared/storage.js';
import { resolvePlaceSave } from '../../../keepsake/src/shared/placeResolve.js';
import { fillSave } from '../../../keepsake/src/shared/fill.js';

export function loadPlaces(name = 'places-challenge.json') {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')).cases;
}

const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

function fakeFetch(c, log) {
  return async (url, init = {}) => {
    const u = String(url);
    if (u.includes('nominatim.openstreetmap.org')) {
      const q = decodeURIComponent(new URL(u).searchParams.get('q') || '');
      log.push({ host: 'nominatim.openstreetmap.org', q });
      const key = Object.keys(c.osm || {}).find((k) => q.toLowerCase().includes(k.toLowerCase()));
      return json(key ? c.osm[key] : []);
    }
    if (u.includes('/v1/messages')) {
      const body = JSON.parse(init.body || '{}');
      log.push({ host: 'api.anthropic.com', tools: (body.tools || []).map((t) => t.type) });
      const w = c.web || { results: [], answer: { candidates: [] }, citations: [] };
      if (body.tools?.length) {
        return json({ content: [
          { type: 'web_search_tool_result', content: w.results.map((url) => ({ type: 'web_search_result', url, title: url })) },
          { type: 'text', text: JSON.stringify(w.answer), citations: (w.citations || []).map((x) => ({ type: 'web_search_result_location', url: x.url, cited_text: x.cited_text })) },
        ], usage: { input_tokens: 0, output_tokens: 0 } });
      }
      // The old path's identify call (no tools): the model answers with the web answer's first candidate.
      const first = w.answer.candidates[0];
      return json({ content: [{ type: 'text', text: JSON.stringify(first ? { name: first.name, address: first.address, city: first.city, state: first.region } : { name: null }) }], usage: { input_tokens: 0, output_tokens: 0 } });
    }
    log.push({ host: new URL(u).hostname, refused: true });
    throw new Error('no network in eval');
  };
}

export async function runPlaceCase(c, { path = 'resolve' } = {}) {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.updateSettings({ lookups: { places: !c.lookupsOff }, ai: { on: true, provider: 'anthropic', webLookup: !!c.web, model: '' } });
  if (c.web) await store.setSecret('aiApiKey', 'sk-ant-eval-not-a-real-key');
  const item = await store.addItem({
    kind: 'place', type: 'instagram', url: `https://www.instagram.com/p/${c.id}/`, host: 'www.instagram.com', title: c.item.title,
    description: c.item.caption, instagram: { caption: c.item.caption, location: c.item.location || '' }, details: { ...(c.itemDetails || {}) }, understoodAt: new Date().toISOString(),
  });
  const log = [];
  const deps = { fetchFn: fakeFetch(c, log), allowed: async (s, which) => !!s.lookups?.[which] };
  let r = null;
  const before = globalThis.fetch;
  globalThis.fetch = deps.fetchFn; // the provider calls fetch directly
  try {
    if (path === 'resolve') r = await resolvePlaceSave(store, item.id, deps);
    else await fillSave(store, item.id, { review: true }, deps);
  } finally {
    globalThis.fetch = before;
  }
  const saved = await store.getItem(item.id);
  const d = saved.details || {};
  return {
    outcome: r ? r.outcome : d.lat != null || (d.address && d.address !== (c.itemDetails || {}).address) ? 'applied' : 'unchanged',
    title: saved.title, address: d.address || '', locality: d.locality || '', region: d.region || '', pin: d.lat != null, phone: d.phone || '', hours: d.hours || [], lookup: d.lookup || null,
    choices: saved.placeChoices || [], requests: log,
  };
}

// Pass or fail against the case's expectations, with the reason. A wrong fact written is the worst
// failure, so it's counted on its own.
// "66 East Ohio Street" is "66 E Ohio St".
const SW = { street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', place: 'pl', east: 'e', west: 'w', north: 'n', south: 's' };
const streetForm = (a) => String(a || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').map((w) => SW[w] || w).join(' ');

export function judgePlace(c, o) {
  const e = c.expect || {};
  const fails = [];
  const verified = o.outcome === 'verified' || o.outcome === 'applied';
  // The old path has no outcome of its own: applied counts as verified, unchanged as insufficient.
  if (e.outcome && e.outcome !== o.outcome && !(e.outcome === 'verified' && o.outcome === 'applied') && !(e.outcome === 'insufficient' && o.outcome === 'unchanged')) fails.push(`outcome ${o.outcome}, expected ${e.outcome}`);
  if (e.address && !streetForm(o.address).startsWith(streetForm(e.address))) fails.push(`address “${o.address}”, expected “${e.address}”`);
  if (e.pin === true && !o.pin) fails.push('no pin');
  if (e.pin === false && o.pin) fails.push('a pin with no map source');
  if (e.choices && o.choices.length !== e.choices) fails.push(`${o.choices.length} choices, expected ${e.choices}`);
  if (e.requests === 0 && o.requests.length) fails.push(`${o.requests.length} lookups for a save that says too little`);
  if (e.notVerified && verified) fails.push('applied a place it couldn’t verify');
  // Every fact the check wrote (an address that wasn't there, a pin, a phone) must say what confirmed it.
  const before = c.itemDetails || {};
  const wrote = (o.address && o.address !== before.address) || o.pin || (o.phone && o.phone !== before.phone);
  const unsourced = !!wrote && !(o.lookup?.verifiedBy?.length);
  if (unsourced) fails.push('wrote a fact with no source in details.lookup.verifiedBy');
  const wrongFact = unsourced || (e.noAddress && o.address && o.address !== before.address) || (e.keepAddress && o.address !== e.keepAddress) || (e.noUrl && JSON.stringify(o).includes(e.noUrl)) || (e.noPhone && !!o.phone) || (e.pin === false && o.pin);
  if (wrongFact) fails.push(`wrote an unverified fact (${o.address || 'url'})`);
  return { ok: !fails.length, fails, wrongFact: !!wrongFact, wrongApplied: !!(e.notVerified && verified) };
}
