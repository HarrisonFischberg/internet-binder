// Places in the dashboard: the list by state and city, Places review, and the map (MapLibre, OpenFreeMap
// tiles, only once Places lookups are on). Moved out of dashboard.js as it was.

import { addressLine, kindOf, mapsLinks } from '../shared/kinds.js';
import { el, pluralize } from '../shared/util.js';
import * as UI from './ui.js';
import { kindIcon } from '../shared/kindIcon.js';
import { openableUrl } from '../shared/url.js';
import { placeReviewReasons, placeState } from '../shared/places.js';
import { LOOKUP_SOURCES } from '../shared/lookups.js';
import { MSG } from '../shared/messages.js';

// dashboard.js's own state and helpers, handed over once at boot.
let D;
export function usePlaces(deps) { D = deps; }

// "Open in Maps": Apple Maps or Google Maps, in a new tab. The links are built from what's saved; Internet Binder
// looks nothing up itself, and the maps site only hears about the place when you click.
function mapsMenuButton(item, { small = false, primary = false } = {}) {
  const links = mapsLinks(item.title, item.details || {});
  if (!links) return null;
  const btn = el('button', { type: 'button', class: `btn ${small ? 'btn-sm' : ''} ${primary ? 'btn-primary' : ''}`, 'aria-haspopup': 'menu', onClick: (e) => {
    e.stopPropagation();
    D.openMenu(btn, [
      { label: 'Apple Maps', icon: UI.externalIcon(), onClick: () => window.open(links.apple, '_blank', 'noopener') },
      { label: 'Google Maps', icon: UI.externalIcon(), onClick: () => window.open(links.google, '_blank', 'noopener') },
    ]);
  } }, [kindIcon('place'), 'Open in Maps']);
  return btn;
}

// The place view: where it is, when it's open, and a way there.
export async function openPlace(id) {
  const item = await D.store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const d = item.details || {};
  const where = addressLine(d);
  const from = item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : item.retailer || item.host || '';
  const sourceLabel = d.lookup?.source && d.lookup.source !== 'AI' ? '' : { page: 'Details from the page', 'maps-link': 'From a maps link', you: 'Added by you', ai: 'Details found by AI' }[d.source] || '';
  const copyAddress = el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => {
    try {
      await navigator.clipboard.writeText(where);
      UI.toast('Address copied.', { duration: 1500 });
    } catch {
      UI.toast('Select the address and press Ctrl/Cmd+C to copy.', { duration: 2500 });
    }
  } }, ['Copy']);
  const facts = [
    d.cuisine ? ['Cuisine', d.cuisine] : d.category ? ['Kind of place', d.category] : null,
    d.priceRange ? ['Price', d.priceRange] : null,
    d.phone ? ['Phone', el('a', { href: `tel:${d.phone.replace(/[^\d+]/g, '')}` }, [d.phone])] : null,
  ].filter(Boolean);
  const body = el('div', { class: 'recipe-view place-view' }, [
    el('div', { class: `recipe-hero ${item.image ? '' : 'no-pic'}` }, [
      item.image ? UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'recipe-hero-pic' }) : null,
      el('div', { class: 'recipe-hero-text' }, [
        el('span', { class: 'badge kind-badge kind-place' }, [kindIcon('place'), 'Place']),
        el('h2', { class: 'recipe-title' }, [item.title]),
        el('p', { class: 'recipe-from' }, [[from, sourceLabel].filter(Boolean).join(' · '), D.lookupLink(d)]),
        where ? el('div', { class: 'place-address' }, [el('address', {}, [where]), copyAddress]) : el('p', { class: 'help' }, ['No address on the page. Add one in Edit details so Open in Maps finds it.']),
        facts.length ? el('dl', { class: 'recipe-facts-grid' }, facts.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
        d.hours?.length ? el('div', { class: 'place-hours' }, [el('h3', { class: 'recipe-sub' }, ['Opening hours']), el('ul', {}, d.hours.map((h) => el('li', {}, [h]))), el('p', { class: 'help' }, ['As published on the page when you saved it. Check before you go.'])]) : null,
        item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
        item.status === 'done' ? el('span', { class: 'badge' }, ['Been']) : null,
      ]),
    ]),
  ]);
  const been = item.status === 'done';
  const maps = mapsLinks(item.title, d);
  await UI.openModal({
    title: item.title,
    body,
    wide: true,
    className: 'modal-recipe modal-place',
    actions: [
      { label: 'Edit details', quiet: true, autofocus: true, closes: false, onClick: async (close) => { close(false); await D.openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      maps ? { label: 'Apple Maps', href: maps.apple, icon: UI.externalIcon() } : null,
      maps ? { label: 'Google Maps', href: maps.google, icon: UI.externalIcon() } : null,
      { label: been ? 'Been ✓' : 'Mark been', primary: !been, onClick: async () => {
        await D.store.updateItem(item.id, { status: been ? 'saved' : 'done' });
        UI.toast(been ? 'Marked as not been yet.' : 'Marked as been.', { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}

// Places as a list grouped by city, each with Open in Maps (Chrome has no map: no third-party map tiles).
// Places: a list grouped by city, or a map of the ones with a pin. The map is OpenStreetMap data drawn
// by MapLibre (bundled in Internet Binder), with tiles from OpenFreeMap; it loads only once Places lookups are on.
const PLACES_VIEW_KEY = 'keepsake.places.view';
let placesViewChoice = null;
// Select on the map: the list for now (the map has nothing to tick), without changing the remembered view.
export function showPlacesListForNow() { placesViewChoice = 'list'; }
export function placesView() {
  if (placesViewChoice) return placesViewChoice;
  try { const v = localStorage.getItem(PLACES_VIEW_KEY); return v === 'map' || v === 'review' ? v : 'list'; } catch { return 'list'; }
}

export function setPlacesView(value) {
  placesViewChoice = value;
  // The map has nothing to tick, and switching views changes what Select all means.
  if (D.state.selecting) D.exitSelection(false);
  try { localStorage.setItem(PLACES_VIEW_KEY, value); } catch { /* this page only */ }
  D.renderView({ keepScroll: true });
  D.renderToolbar();
}

// Places: the list (by state, then city) and the map show places that are ready: named, with a state.
// The rest wait in Places review, where your AI provider (or you) can name them and say where they are.
export function renderPlaces(view, items) {
  const review = items.filter((i) => placeReviewReasons(i).length);
  const ready = items.filter((i) => !placeReviewReasons(i).length);
  const current = placesView();
  const seg = (value, label) => el('button', { type: 'button', class: `library-tab ${current === value ? 'on' : ''}`, role: 'tab', 'aria-selected': current === value ? 'true' : 'false', onClick: () => setPlacesView(value) }, [label]);
  view.append(el('div', { class: 'library-tabs', role: 'tablist', 'aria-label': 'Places view' }, [seg('list', 'List'), seg('map', 'Map'), seg('review', review.length ? `Places review · ${review.length}` : 'Places review')]));
  findPlacesOnMap();
  if (current === 'map') renderPlacesMap(view, ready);
  else if (current === 'review') renderPlacesReview(view, review, items);
  else {
    if (ready.length) view.append(D.sortBar());
    renderPlaceList(view, ready, review.length);
  }
}

// One row of a place list: its picture, name, what it is and where, and Open in Maps.
function placeRow(item, meta) {
  const d = item.details || {};
  const li = el('li', { class: `place-row ${item.status === 'done' ? 'is-done' : ''} ${D.state.selected.has(item.id) ? 'selected' : ''}` });
  if (D.state.selecting) li.append(D.selectBox(item.id, item.title, li));
  D.bindContextMenu(li, () => D.itemMenu(item));
  li.append(...[
    el('button', { type: 'button', class: 'place-row-hit', onClick: () => (D.state.selecting ? D.toggleBox(li) : D.openSave(item.id)) }, [
      UI.pictureNode({ src: item.image, aspect: 1, title: item.title, className: 'place-thumb' }),
      el('span', { class: 'place-row-text' }, [
        el('span', { class: 'place-row-title' }, [item.title]),
        el('span', { class: 'place-row-meta' }, [meta ?? ([d.cuisine || d.category, d.priceRange, d.address].filter(Boolean).join(' · ') || item.retailer || item.host || '')]),
      ]),
    ]),
    item.status === 'done' ? el('span', { class: 'badge' }, ['Been']) : null,
    D.state.selecting ? null : mapsMenuButton(item, { small: true }),
  ].filter(Boolean));
  return li;
}

function renderPlacesReview(view, items, all = items) {
  const box = el('div', { class: 'place-list' });
  if (!items.length) {
    box.append(UI.emptyState({ title: 'Nothing to review', message: 'Every place has a name and a state, so they’re all on your list.' }));
    view.append(box);
    return;
  }
  const aiOn = !!D.state.settings?.ai?.on;
  const fixAll = () => D.fixPlaces(all);
  const running = !!D.state.fillJob?.running;
  box.append(el('div', { class: 'place-review-bar' }, [
    el('div', { class: 'grow' }, [
      el('p', {}, [`${pluralize(items.length, 'place needs', 'places need')} a name or a state before ${items.length === 1 ? 'it goes' : 'they go'} on your list.`]),
      el('p', { class: 'help' }, [aiOn
        ? 'Fix with AI sends each one’s title, caption and location tag to your AI provider, which names the place and says where it is; Lookups then add the address and pin. A post about several places (a top-10 list) stays here: open it to move it or delete it.'
        : 'Read again checks each of these posts’ captions with Internet Binder’s latest rules, on your device. To have places named from their posts, turn on Optional AI in Settings. Or open one and fill in its name and address.']),
    ]),
    el('button', { type: 'button', class: 'btn btn-primary', disabled: running, onClick: () => fixAll() }, [running ? 'Working…' : aiOn ? `Fix ${items.length} with AI` : 'Read again']),
  ]));
  const why = { 'no place name': 'No place name', 'no state': 'No state' };
  const sorted = [...items].sort((a, b) => placeReviewReasons(a).length - placeReviewReasons(b).length || a.title.localeCompare(b.title));
  box.append(el('ul', { class: 'place-rows', role: 'list' }, sorted.map((item) => {
    const reasons = placeReviewReasons(item).map((r) => why[r] || r).join(' · ');
    const st = placeState(item);
    return placeRow(item, [reasons, st ? `in ${st.name}` : '', item.details?.address || item.details?.locality || ''].filter(Boolean).join(' · '));
  })));
  view.append(box);
}

// MapLibre GL 6 ships as ES modules only. Its worker can't find itself from an extension URL (it only
// auto-detects http(s)), so it's pointed at the vendored worker file: same origin, so no blob: worker.
let maplibregl = null;
let maplibreLoading = null;
function loadMapLibre() {
  if (maplibregl) return Promise.resolve(maplibregl);
  if (!maplibreLoading) {
    document.head.append(el('link', { rel: 'stylesheet', href: '../../vendor/maplibre/maplibre-gl.css' }));
    maplibreLoading = import('../../vendor/maplibre/maplibre-gl.js').then((m) => {
      m.setWorkerUrl(chrome.runtime.getURL('vendor/maplibre/maplibre-gl-worker.js'));
      return (maplibregl = m);
    }, () => { maplibreLoading = null; throw new Error('The map didn’t load.'); });
  }
  return maplibreLoading;
}

async function mapAllowed() {
  if (!D.state.settings?.lookups?.places) return false;
  try { return await chrome.permissions.contains({ origins: LOOKUP_SOURCES.places.origins }); } catch { return false; }
}

// Places with no pin are looked up on their own (the background worker, Lookups only, at OpenStreetMap's
// pace) whenever Places is open: no button. Asked at most every half minute; the worker skips any it has
// already searched for with the same name and address.
const PLACE_LOOKUP_EVERY_MS = 30000;
let placeLookupAskedAt = 0;
async function findPlacesOnMap() {
  if (Date.now() - placeLookupAskedAt < PLACE_LOOKUP_EVERY_MS || D.state.placeLookup?.running) return;
  placeLookupAskedAt = Date.now();
  if (!(await mapAllowed())) return;
  const res = await D.send({ type: MSG.LOOKUP_PLACES }).catch(() => null);
  if (res?.job) D.state.placeLookup = res.job;
}

// The map is drawn once and kept: pins come and go as places are found, without redrawing it (and
// losing where you'd panned to) every time a save changes.
export let placesMap = null; // { box, mapEl, note, map, style, markers: Map(id -> { marker, sig }), moved }

// Under the map: places being found right now, or the ones that couldn't be, by name, each opening its
// save so you can give it a street address.
export function placesMapNote(missing) {
  const job = D.state.placeLookup;
  if (job?.running) {
    return el('p', { class: 'help map-note', role: 'status' }, [el('span', { class: 'map-note-dot', 'aria-hidden': 'true' }),
      `Finding places on the map… ${Math.min(job.done, job.total)} of ${job.total}`]);
  }
  if (!missing.length) return el('p', { class: 'help map-note', role: 'status' });
  const one = missing.length === 1;
  const shown = missing.slice(0, 3);
  const names = [];
  shown.forEach((item, n) => {
    if (n) names.push(n === shown.length - 1 && missing.length <= 3 ? ' and ' : ', ');
    names.push(el('button', { type: 'button', class: 'link-btn', onClick: () => D.openSave(item.id) }, [item.title]));
  });
  if (missing.length > 3) names.push(` and ${missing.length - 3} more`);
  const why = job?.offline ? `OpenStreetMap didn’t answer, so ${one ? 'it’s' : 'they’re'} looked up again next time.`
    : `OpenStreetMap couldn’t find ${one ? 'it' : 'them'} from the name and city. Open ${one ? 'it' : 'one'} to add a street address.`;
  return el('p', { class: 'help map-note', role: 'status' }, [...names, ` ${one ? 'isn’t' : 'aren’t'} on the map. ${why}`]);
}

export const hasPin = (i) => Number.isFinite(i.details?.lat) && Number.isFinite(i.details?.lng);
// The places the map shows: the ones on your list (named, with a state).
export const mapPlaces = () => D.state.items.filter((i) => !i.deletedAt && kindOf(i) === 'place' && !placeReviewReasons(i).length);

function renderPlacesMap(view, items) {
  const pinned = items.filter(hasPin);
  const unpinned = items.filter((i) => !hasPin(i));
  // Lookups turned off in Settings: the map goes with them.
  if (placesMap && !D.state.settings?.lookups?.places) {
    placesMap.map?.remove();
    placesMap = null;
  }
  if (placesMap) {
    view.append(placesMap.box);
    const note = placesMapNote(unpinned);
    placesMap.note.replaceWith(note);
    placesMap.note = note;
    if (placesMap.map) {
      placesMap.map.resize();
      syncPlacePins(pinned);
    }
    return;
  }
  const box = el('div', { class: 'places-map-wrap' });
  view.append(box);
  mapAllowed().then(async (ok) => {
    if (!ok) {
      box.append(el('div', { class: 'recipe-empty map-off' }, [
        el('p', {}, ['The map shows your places on OpenStreetMap. It needs Places lookups, which also find each place’s address and pin.']),
        el('p', { class: 'help' }, [`Sends ${LOOKUP_SOURCES.places.sends} to OpenStreetMap and OpenFreeMap. No account, nothing else.`]),
        el('div', { class: 'review-actions' }, [el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          let granted = false;
          try { granted = await chrome.permissions.request({ origins: LOOKUP_SOURCES.places.origins }); } catch { granted = false; }
          if (!granted) { UI.toast('Chrome didn’t grant access, so the map stays off.', { kind: 'danger' }); return; }
          await D.store.updateSettings({ lookups: { ...(D.state.settings.lookups || {}), places: true } });
          placeLookupAskedAt = 0;
          findPlacesOnMap();
        } }, ['Turn on the map and place lookups'])]),
      ]));
      return;
    }
    const mapEl = el('div', { class: 'places-map', role: 'region', 'aria-label': 'Map of your places' });
    const note = placesMapNote(unpinned);
    box.append(mapEl, note);
    placesMap = { box, mapEl, note, map: null, style: '', markers: new Map(), moved: false };
    try { await loadMapLibre(); } catch (e) { mapEl.replaceWith(el('p', { class: 'help help-error' }, [e.message])); placesMap = null; return; }
    const map = new maplibregl.Map({ container: mapEl, style: placesMapStyle(), center: [0, 20], zoom: 1.4, attributionControl: { compact: true }, cooperativeGestures: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Once you pan or zoom, newly found pins don't move the map out from under you.
    map.on('dragstart', () => { placesMap && (placesMap.moved = true); });
    map.on('zoomstart', (e) => { if (e.originalEvent && placesMap) placesMap.moved = true; });
    placesMap.map = map;
    placesMap.style = placesMapStyle();
    // The pins as they are now, not as they were when the map started loading.
    syncPlacePins(mapPlaces().filter(hasPin));
  });
}

function placesMapStyle() {
  // Nocturne and Chromatic are dark, Paper & Ink light (tokens.css sets color-scheme per appearance).
  const dark = getComputedStyle(document.documentElement).colorScheme !== 'light';
  return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
}

// Adds the pins for newly found places, moves or drops changed ones, and fits the map to them until
// you've moved it yourself.
function syncPlacePins(pinned) {
  const pm = placesMap;
  if (!pm?.map || !maplibregl) return;
  const { map, markers } = pm;
  pm.mapEl.setAttribute('aria-label', `Map of ${pluralize(pinned.length, 'place', 'places')}`);
  const style = placesMapStyle();
  if (style !== pm.style) { pm.style = style; map.setStyle(style); }
  const keep = new Set();
  let added = false;
  for (const item of pinned) {
    const d = item.details;
    const sig = JSON.stringify([item.title, item.status, d.lat, d.lng, d.lookup?.approximate, d.cuisine, d.category, d.priceRange, addressLine(d)]);
    keep.add(item.id);
    const had = markers.get(item.id);
    if (had?.sig === sig) continue;
    had?.marker.remove();
    markers.set(item.id, { marker: placeMarker(item).addTo(map), sig });
    if (!had) added = true;
  }
  for (const [id, m] of markers) if (!keep.has(id)) { m.marker.remove(); markers.delete(id); }
  if (!added || pm.moved) return;
  if (pinned.length === 1) map.jumpTo({ center: [pinned[0].details.lng, pinned[0].details.lat], zoom: 14 });
  else if (pinned.length > 1) {
    const bounds = new maplibregl.LngLatBounds();
    for (const i of pinned) bounds.extend([i.details.lng, i.details.lat]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: markers.size > pinned.length / 2 ? 400 : 0 });
  }
}

function placeMarker(item) {
  const d = item.details;
  const approx = !!d.lookup?.approximate;
  const dot = el('button', { type: 'button', class: `map-pin ${item.status === 'done' ? 'is-done' : ''} ${approx ? 'is-approx' : ''}`, 'aria-label': approx ? `${item.title} (approximate)` : item.title, title: approx ? 'Approximate: on the right street, not at the door' : '' });
  const links = mapsLinks(item.title, d);
  const pop = el('div', { class: 'map-pop' }, [
    el('strong', {}, [item.title]),
    el('span', { class: 'help' }, [[d.cuisine || d.category, d.priceRange, addressLine(d)].filter(Boolean).join(' · ')]),
    el('div', { class: 'review-actions' }, [
      el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => D.openSave(item.id) }, ['Open']),
      links ? el('a', { class: 'btn btn-sm', href: links.google, target: '_blank', rel: 'noopener noreferrer' }, ['Google Maps']) : null,
      links ? el('a', { class: 'btn btn-sm', href: links.apple, target: '_blank', rel: 'noopener noreferrer' }, ['Apple Maps']) : null,
    ]),
  ]);
  return new maplibregl.Marker({ element: dot }).setLngLat([d.lng, d.lat]).setPopup(new maplibregl.Popup({ offset: 14, closeButton: true }).setDOMContent(pop));
}

function renderPlaceList(view, items, waiting = 0) {
  const states = new Map(); // state name -> Map(city -> places)
  for (const item of items) {
    const st = placeState(item)?.name || 'Somewhere';
    const city = String(item.details?.locality || '').trim();
    if (!states.has(st)) states.set(st, new Map());
    const cities = states.get(st);
    if (!cities.has(city)) cities.set(city, []);
    cities.get(city).push(item);
  }
  const box = el('div', { class: 'place-list' });
  if (!items.length) box.append(UI.emptyState({ title: 'No places on your list yet', message: waiting ? `${pluralize(waiting, 'place is', 'places are')} waiting in Places review for a name or a state.` : 'Save a restaurant, café or anywhere you want to go and it shows up here, by state and city.' }));
  // Within a city: still to go first, each part in the chosen sort (the order items come in).
  const toGoFirst = (a, b) => (a.status === 'done') - (b.status === 'done');
  for (const st of [...states.keys()].sort((a, b) => a.localeCompare(b))) {
    const cities = states.get(st);
    const total = [...cities.values()].reduce((n, l) => n + l.length, 0);
    const section = el('section', { class: 'place-group', 'aria-label': st }, [el('h2', { class: 'place-city' }, [st, el('span', { class: 'count' }, [String(total)])])]);
    // Cities A to Z; places with no city last, under the state itself.
    for (const city of [...cities.keys()].sort((a, b) => (!a) - (!b) || a.localeCompare(b))) {
      const list = cities.get(city).sort(toGoFirst);
      if (cities.size > 1 || city) section.append(el('h3', { class: 'place-subcity' }, [city || `Elsewhere in ${st}`, el('span', { class: 'count' }, [String(list.length)])]));
      section.append(el('ul', { class: 'place-rows', role: 'list' }, list.map((item) => placeRow(item))));
    }
    box.append(section);
  }
  view.append(box);
}
