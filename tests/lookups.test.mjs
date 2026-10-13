// Lookups (shared/lookups.js) against canned responses shaped like the real services' JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupPlace, lookupFilm, lookupBook, fillMissing, sameName } from '../keepsake/src/shared/lookups.js';

const fake = (routes) => async (url) => {
  const hit = routes.find(([re]) => re.test(url));
  if (!hit) throw new Error(`unexpected ${url}`);
  return { ok: true, status: 200, json: async () => hit[1](url) };
};

test('sameName: tidied, contained or mostly the same words; not just one shared word', () => {
  assert.ok(sameName('Peter Pan Donut & Pastry Shop', 'Peter Pan Donut and Pastry Shop'));
  assert.ok(sameName('The Matrix', 'Matrix'));
  assert.ok(!sameName('Peter Pan Donut & Pastry Shop', 'Peter Luger Steak House'));
});

test('places: only a result with the same name is used, and only its own fields', async () => {
  const nominatim = [{ name: 'Peter Pan Donut & Pastry Shop', lat: '40.7260665', lon: '-73.9522298', type: 'bakery', osm_type: 'node', osm_id: 2842886515,
    address: { house_number: '727', road: 'Manhattan Avenue', suburb: 'Greenpoint', city: 'New York', postcode: '11222', country: 'United States' } }];
  const p = await lookupPlace({ name: 'Peter Pan Donut & Pastry Shop', locality: 'Greenpoint' }, fake([[/nominatim\.openstreetmap\.org\/search/, () => nominatim]]));
  assert.deepEqual([p.address, p.locality, p.region, p.lat, p.lng, p.category, p.lookup.source], ['727 Manhattan Avenue', 'Greenpoint', 'New York', 40.7260665, -73.9522298, 'bakery', 'OpenStreetMap']);
  const none = await lookupPlace({ name: 'Peter Pan Donut & Pastry Shop' }, fake([[/nominatim/, () => [{ name: 'Peter Luger Steak House', lat: '1', lon: '2', address: {} }]]]));
  assert.equal(none, null, 'a different place is never used');
});

test('films: the entity that is a film with the same title (and year), with labels for director and genre', async () => {
  const fetchFn = fake([
    [/wbsearchentities/, () => ({ search: [{ id: 'Q1' }, { id: 'Q83495' }] })],
    [/wbgetentities.*ids=Q1\|Q83495/, () => ({ entities: {
      Q1: { id: 'Q1', labels: { en: { value: 'The Matrix' } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q7725634' } } } }] } }, // a novel: not a film
      Q83495: { id: 'Q83495', labels: { en: { value: 'The Matrix' } }, claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }],
        P577: [{ mainsnak: { datavalue: { value: { time: '+1999-03-31T00:00:00Z' } } } }],
        P57: [{ mainsnak: { datavalue: { value: { id: 'Q9545711' } } } }],
        P136: [{ mainsnak: { datavalue: { value: { id: 'Q2484376' } } } }],
        P2047: [{ mainsnak: { datavalue: { value: { amount: '+136' } } } }],
        P3383: [{ mainsnak: { datavalue: { value: 'The Matrix Poster.jpg' } } }],
      } } } })],
    [/wbgetentities.*props=labels/, () => ({ entities: { Q9545711: { labels: { en: { value: 'Lana Wachowski' } } }, Q2484376: { labels: { en: { value: 'thriller film' } } } } })],
  ]);
  const f = await lookupFilm({ title: 'The Matrix', year: 1999 }, fetchFn);
  assert.deepEqual([f.format, f.year, f.director, f.runtimeMinutes, f.genres, f.lookup.url], ['film', 1999, 'Lana Wachowski', 136, ['thriller'], 'https://www.wikidata.org/wiki/Q83495']);
  assert.match(f.image, /Special:FilePath\/The%20Matrix%20Poster\.jpg/);
  assert.equal(await lookupFilm({ title: 'The Matrix', year: 2021 }, fetchFn), null, 'a different year is a different film');
});

test('books: Open Library result with the same title; cover and ISBN from it', async () => {
  const b = await lookupBook({ title: 'A Wizard of Earthsea' }, fake([[/openlibrary\.org\/search\.json/, () => ({ docs: [
    { key: '/works/OL1W', title: 'Earthsea Revisioned' },
    { key: '/works/OL59798W', title: 'A Wizard of Earthsea', author_name: ['Ursula K. Le Guin'], first_publish_year: 1968, number_of_pages_median: 205, cover_i: 13617691, isbn: ['0553383043', '9780547773742'], subject: ['Fiction', 'Magic'] },
  ] })]]));
  assert.deepEqual([b.author, b.year, b.pages, b.isbn, b.image, b.lookup.url], ['Ursula K. Le Guin', 1968, 205, '9780547773742', 'https://covers.openlibrary.org/b/id/13617691-L.jpg', 'https://openlibrary.org/works/OL59798W']);
});

test('fillMissing never replaces what you or the page filled in', () => {
  assert.deepEqual(fillMissing({ year: 2001, director: '', genres: [] }, { year: 1999, director: 'A', genres: ['x'], image: 'i' }), { year: 2001, director: 'A', genres: ['x'] });
});

test('places: a new place OpenStreetMap doesn’t know by name is found by the address the post gave (same street and number only)', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(decodeURIComponent(url));
    const byName = /Example%20Donuts|Example Donuts/.test(decodeURIComponent(url));
    const body = byName ? [] : [
      { lat: '40.7289', lon: '-74.0011', type: 'house', osm_type: 'way', osm_id: 1, address: { house_number: '188', road: 'Bleecker Street', city: 'New York' } },
      { lat: '40.72899', lon: '-74.00118', type: 'house', osm_type: 'way', osm_id: 248156603, address: { house_number: '186', road: 'Bleecker Street', suburb: 'Manhattan', city: 'New York', postcode: '10012' } },
    ];
    return { ok: true, status: 200, json: async () => body };
  };
  let turns = 0;
  const p = await lookupPlace({ name: 'Example Donuts', address: '186 Bleecker St', locality: 'New York', region: 'NY' }, fetchFn, async () => { turns++; });
  assert.equal(turns, 2, 'one wait before each request');
  assert.deepEqual([p.lat, p.address, p.postalCode, p.category, p.lookup.url], [40.72899, '186 Bleecker Street', '10012', '', 'https://www.openstreetmap.org/way/248156603']);
  const none = await lookupPlace({ name: 'Example Donuts', address: '186 Elm St' }, fetchFn);
  assert.equal(none, null, 'a different street is never used');
});

test('places: a name with no street, city or area is never looked up (it could be a shop of that name anywhere)', async () => {
  let called = false;
  const r = await lookupPlace({ name: 'Example Sandwich' }, async () => { called = true; return { ok: true, json: async () => [] }; });
  assert.equal(r, null);
  assert.equal(called, false);
});

test('places: a pin with no street address gets the address at that pin', async () => {
  const { lookupAddressAt } = await import('../keepsake/src/shared/lookups.js');
  const a = await lookupAddressAt({ lat: 47.6152, lng: -122.3411 }, async (url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/reverse\?.*lat=47\.6152&lon=-122\.3411/);
    return { ok: true, json: async () => ({ osm_type: 'way', osm_id: 7, address: { house_number: '2124', road: '5th Avenue', neighbourhood: 'Belltown', city: 'Seattle', postcode: '98121', country: 'United States' } }) };
  });
  assert.deepEqual([a.address, a.locality, a.region, a.postalCode], ['2124 5th Avenue', 'Belltown', 'Seattle', '98121']);
  assert.equal(await lookupAddressAt({ lat: NaN, lng: 1 }, async () => { throw new Error('no'); }), null);
});
