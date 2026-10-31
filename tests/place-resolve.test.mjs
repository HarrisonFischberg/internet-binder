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
