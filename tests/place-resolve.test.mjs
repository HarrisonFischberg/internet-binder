// Fix with AI's place check (src/shared/placeResolve.js) on the place cases in tools/qa: OpenStreetMap's
// and the web search's answers are captured, so the real parsing, checks and storage run offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaces, runPlaceCase, judgePlace } from '../tools/qa/lib/places.mjs';
import { createStore, memoryBackend, memoryRecordBackend } from '../keepsake/src/shared/storage.js';
import { choosePlace } from '../keepsake/src/shared/placeResolve.js';

for (const c of loadPlaces()) {
  // A case marked known is a limitation still counted as a failure in tools/qa; here it is a todo.
  test(`place check: ${c.note}`, { todo: c.known || false }, async () => {
    const o = await runPlaceCase(c);
    const v = judgePlace(c, o);
    assert.ok(v.ok, v.fails.join('; '));
    // Whatever was written says where it came from.
    if (o.address && o.lookup) assert.ok(o.lookup.verifiedBy?.length, 'an address has a source');
  });
}

test('choosing one of the places applies it as yours and clears the choices', async () => {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  const item = await store.addItem({ kind: 'place', type: 'instagram', title: "Joe's Pizza", details: { source: 'page' },
    placeChoices: [{ name: "Joe's Pizza", address: '7 Carmine Street', locality: 'New York', region: 'NY', lat: 40.73, lng: -74.0, url: 'https://www.openstreetmap.org/node/103', source: 'openstreetmap', confirmedBy: ['openstreetmap'] }] });
  const saved = await choosePlace(store, item.id, 0);
  assert.equal(saved.details.address, '7 Carmine Street');
  assert.deepEqual(saved.details.lookup.verifiedBy, ['openstreetmap', 'you']);
  assert.equal((saved.placeChoices || []).length, 0);
  assert.equal(saved.placeResolution.outcome, 'chosen');
});

test('Find on the map: only a confirmed place gets a pin; one tried with the same clues waits', async () => {
  const { mapPlace, placesToMap } = await import('../keepsake/src/shared/fill.js');
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.updateSettings({ lookups: { places: true } });
  const joe = await store.addItem({ kind: 'place', type: 'link', url: 'https://example.com/joes', title: "Joe's Pizza", details: { locality: 'New York', region: 'NY' } });
  const vague = await store.addItem({ kind: 'place', type: 'link', url: 'https://example.com/somewhere', title: 'Best tacos ever', details: {} });
  const pinned = await store.addItem({ kind: 'place', type: 'link', url: 'https://example.com/pinned', title: 'Katz', details: { locality: 'New York', region: 'NY', lat: 40.72, lng: -73.98 } });
  const fetchFn = async (url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/search/);
    return { ok: true, status: 200, json: async () => (/Joe/.test(decodeURIComponent(url)) ? [{ name: "Joe's Pizza", lat: '40.7306', lon: '-74.0021', osm_type: 'node', osm_id: 103,
      address: { house_number: '7', road: 'Carmine Street', city: 'New York', state: 'New York', 'ISO3166-2-lvl4': 'US-NY' } }] : []) };
  };
  const deps = { fetchFn, allowed: async (s, which) => !!s.lookups?.[which], deviceOnly: true };
  const todo = placesToMap(await store.getItems());
  assert.deepEqual(todo.map((i) => i.id).sort(), [joe.id, vague.id].sort(), 'a place with a pin is left alone');
  const a = await mapPlace(store, joe.id, deps);
  assert.equal(a.outcome, 'pinned');
  const saved = await store.getItem(joe.id);
  assert.equal(saved.details.lat, 40.7306);
  assert.ok(saved.details.lookup?.source, 'the pin says where it came from');
  assert.deepEqual([saved.details.source, saved.details.locality, saved.details.address], ['you', 'New York', ''], 'what you wrote stays; only the pin is added');
  const rays = await store.addItem({ kind: 'place', type: 'link', url: 'https://example.com/rays', title: "Ray's Pizza", details: { locality: 'New York', region: 'NY' } });
  const two = (id, lat) => ({ name: "Ray's Pizza", lat: String(lat), lon: '-73.99', osm_type: 'node', osm_id: id, address: { city: 'New York', state: 'New York', 'ISO3166-2-lvl4': 'US-NY' } });
  const r = await mapPlace(store, rays.id, { ...deps, fetchFn: async () => ({ ok: true, status: 200, json: async () => [two(1, 40.70), two(2, 40.80)] }) });
  assert.equal(r.outcome, 'choose', 'two places it could be: you pick');
  assert.equal((await store.getItem(rays.id)).placeChoices.length, 2);
  assert.equal((await store.getItem(rays.id)).details.lat, null);
  const b = await mapPlace(store, vague.id, deps);
  assert.equal(b.outcome, 'unclear', 'a post that says nowhere is not guessed');
  assert.equal((await store.getItem(vague.id)).details?.lat ?? null, null);
  const tried = { [vague.id]: b.key, [rays.id]: r.key };
  assert.deepEqual(placesToMap(await store.getItems(), tried).map((i) => i.id), [], 'tried with the same clues: not again');
  assert.equal((await mapPlace(store, pinned.id, deps)).outcome, 'pinned');
});
