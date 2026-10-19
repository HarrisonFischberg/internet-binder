// Where a place is (shared/places.js) and the caption reading behind it (kinds.js placeFromText), with
// captions shaped like real saved Instagram posts (names and handles changed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateCode, stateFromZip, stateFromCity, placeState, placeNamed, placeReviewReasons } from '../keepsake/src/shared/places.js';
import { placeFromText } from '../keepsake/src/shared/kinds.js';

test('stateCode, ZIP and city: the forms a state is written in', () => {
  assert.deepEqual(['NY', 'ny', 'NY 10012', 'New York', 'texas 78717', 'US-CA', 'Washington, D.C.', 'Gotham', ''].map(stateCode), ['NY', 'NY', 'NY', 'NY', 'TX', 'CA', 'DC', null, null]);
  assert.deepEqual(['10012', '78717', '19147', '07008', '94063', '1001', ''].map(stateFromZip), ['NY', 'TX', 'PA', 'NJ', 'CA', null, null]);
  assert.deepEqual(['Brooklyn', 'Los Angeles', 'St Pete', 'Portland', 'Gotham'].map(stateFromCity), ['NY', 'CA', 'FL', null, null]);
});

test('placeState: from the state field, the ZIP, the end of the street, the city, then what the post says', () => {
  const st = (details, extra = {}) => placeState({ details, ...extra });
  assert.deepEqual(st({ region: 'NY 10012' }), { code: 'NY', name: 'New York', from: 'region' });
  assert.equal(st({ postalCode: '78717' }).code, 'TX');
  assert.deepEqual(st({ address: '84 East 10th St. 2nd floor NY' }), { code: 'NY', name: 'New York', from: 'address' });
  assert.equal(st({ address: '1009 South 8th Street Philadelphia PA 19147' }).code, 'PA');
  assert.deepEqual(st({ locality: 'Brooklyn' }), { code: 'NY', name: 'New York', from: 'city' });
  assert.deepEqual(st({}, { instagram: { caption: 'This NJ bagel shop … 📍Example Bagels in Carteret, NJ' } }), { code: 'NJ', name: 'New Jersey', from: 'post' });
  assert.equal(st({}, { instagram: { caption: 'If you’re ever in St Pete, FL, make the trip' } }).code, 'FL');
  assert.equal(st({}, { instagram: { caption: 'Top 12 cinnamon rolls #nycfood' } }).code, 'NY');
  assert.equal(st({}, { instagram: { caption: 'America’s Best Tacos? #lafoodie #losangeles' } }).code, 'CA');
  assert.deepEqual(st({ country: 'United Kingdom', locality: 'Bristol' }), { code: '', name: 'United Kingdom', from: 'country' });
  assert.equal(st({}, { instagram: { caption: 'there’s always room for dessert' } }), null);
});

test('placeNamed: a title of its own; not the start of its caption, an address, a city, or a phrase', () => {
  const ig = (title, caption, details = {}) => ({ type: 'instagram', title, details, instagram: { caption } });
  assert.equal(placeNamed(ig('Example Pizza', 'Best slice in the city 📍Example Pizza')), true);
  assert.equal(placeNamed(ig('Top 12 best new NYC restaurants to open in 2025!', 'Top 12 best new NYC restaurants to open in 2025!')), false);
  assert.equal(placeNamed(ig('84 East 10th St. 2nd floor', '📍84 East 10th St. 2nd floor NY', { address: '84 East 10th St. 2nd floor' })), false, 'an address is not a name');
  assert.equal(placeNamed(ig('New York, New York', 'Best pancakes', { lat: 40.71, lng: -74 })), false, 'a city pinned is not a place');
  assert.equal(placeNamed(ig('This spot is closed', '📍 This spot is closed')), false);
  assert.equal(placeNamed({ title: 'Example Café', details: {} }), true, 'a page’s own title');
  assert.deepEqual(placeReviewReasons(ig('MEET ANNA.', 'MEET ANNA. THE 93 YEAR OLD RESTAURANT OWNER')), ['no place name', 'no state']);
  assert.deepEqual(placeReviewReasons(ig('Example Pizza', '📍Example Pizza', { address: '7 Carmine St', region: 'NY' })), []);
  const kept = { ...ig('Example Pizza', 'Example Pizza is the best slice in the city', { region: 'NY' }), userFields: ['title'] };
  assert.deepEqual(placeReviewReasons(kept), [], 'a name you typed or kept in Fix counts, even when the caption starts with it');
});

test('placeFromText: captions as they come from a saved post’s grid (one line, emoji, handles, labels)', () => {
  const p = (t) => placeFromText(t);
  assert.deepEqual(p('Trying British food at @example_nyc 📍506 LaGuardia Pl, New York, NY 10012 #britishfood'),
    { name: 'Example NYC', address: '506 LaGuardia Pl', locality: 'New York', region: 'NY', postalCode: '10012', handle: 'example_nyc' }, 'the ZIP is not part of the state; the handle before it names it');
  assert.deepEqual(p('best tres leches 📍Example Bagel Factory (@examplebagels) in Carteret, NJ . . . . #njeats'),
    { name: 'Example Bagel Factory', address: '', locality: 'Carteret', region: 'NJ', handle: 'examplebagels' });
  const austin = p('only this week 🫶🏽 📍Cedar Park/North Austin Location : 10900 lakeline mall drive suite 300 Austin,TX,78717 📲: 512-555-0100 Pre order');
  assert.deepEqual([austin.name, austin.address, austin.locality, austin.region, austin.postalCode], ['', '10900 lakeline mall drive suite 300', 'Austin', 'TX', '78717'], 'a label is not the name');
  const noPin = p('Our famous stuffed rolls just need you 🍠 16051 dessau rd suite f Pflugerville, TX,78660 📍🏬');
  assert.deepEqual([noPin.address, noPin.locality, noPin.region], ['16051 dessau rd suite f', 'Pflugerville', 'TX'], 'an address with no 📍 before it');
  const promo = p('Cafe Example has 20 combos. Follow @someblogger for more recs! 📍84 East 10th St. 2nd floor NY #tiramisu');
  assert.deepEqual([promo.name, promo.address, promo.region, promo.handle], ['', '84 East 10th St. 2nd floor', 'NY', undefined], '“Follow @…” is the poster, not the place');
  assert.equal(p('tried the viral mochi 📍 This spot is closed🥲 —— GUY. THIS IS SO GOOD'), null);
  assert.deepEqual(p('An amazing cheesesteak 📍 Example’s (Hollywood, Los Angeles) @examples__la . . . #cheesesteak'), { name: 'Example’s', address: '', locality: 'Los Angeles', region: '' });
  assert.deepEqual(p('Japanese Jewish fusion 📍 @examplejapan, Brooklyn #nycfood'), { name: 'Examplejapan', address: '', locality: 'Brooklyn', region: '', handle: 'examplejapan' });
  const sando = p('The Best Sando Spot 🍓 @example_sando 📍 #Greenpoint 29 Greenpoint Ave, Brooklyn #sando');
  assert.deepEqual([sando.name, sando.address, sando.locality], ['Example Sando', '29 Greenpoint Ave', 'Brooklyn'], 'a leading hashtag is the area; the handle names it');
  assert.deepEqual(p('jaw on the floor 🤤 @example_nyc 📍228 DeKalb Ave, Fort Greene 🎥: @photographer #newyorklocals').locality, 'Fort Greene', 'a photo credit ends it');
  assert.equal(p('Top 12 of 2025 📍 Example One (West Village) 📍 Example Two 📍 Example Three'), null, 'a list of places');
  assert.equal(p('📍3 Locations •Le Cafe Example ⏰7am-4pm'), null);
});
