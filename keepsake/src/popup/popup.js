// Keepsake toolbar popup.
// Reads the active tab on demand (activeTab + scripting). Opening it never saves: it offers the
// dashboard, then asks where the page lives (Collections, Lifestyle or Review, as the iPhone share
// sheet does), then lets you tidy the title before Save. Saves go through the background worker.
// Nothing here touches the network.

import { createStore, chromeBackend, idbBackend, applyLook } from '../shared/storage.js';
import { MSG, SESSION_KEYS } from '../shared/messages.js';
import { el, clear, parsePrice, sanitizeText, pluralize, formatPrice } from '../shared/util.js';
import { isRestrictedUrl } from '../shared/url.js';
import { kindOf, kindInfo, hasOwnView, LIFESTYLE } from '../shared/kinds.js';
import { learnFromCorrection, nearMatchCollection } from '../shared/categorizer.js';
import { followColorScheme, setActionIcon } from '../toolbar/icon.js';
import { kindIcon } from '../shared/kindIcon.js';
import { hasInstagramAccess, requestInstagramAccess, instagramAccessHelp } from '../instagram/enrich.js';

const store = createStore(chromeBackend(), idbBackend());
followColorScheme();
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false, error: 'No response.' });
    });
  } catch (e) {
    resolve({ ok: false, error: String(e && e.message) });
  }
});

const state = {
  tab: null,
  product: null,
  classification: null,
  collections: [],
  threshold: 0.6,
  duplicate: null,
  chosenImage: '',
  userOverride: false,
  savedItem: null,
  savedMode: 'saved', // saved | updated | existing (a video, recipe… already saved: shown, not saved again)
  initialChoice: '', // the picker value for Keepsake's own guess
  choice: null, // where you've said it lives on the home: a picker value ('' is Review), null until you pick
  shelfOpen: null, // collections | lifestyle, while looking through a library's groups
  items: [],
  ig: null,
  igScanListener: null,
};

const STATES = ['state-loading', 'state-restricted', 'state-instagram', 'state-home', 'state-product', 'state-saved'];
function show(id) {
  for (const s of STATES) $(s).classList.toggle('hidden', s !== id);
  $('state-loading').setAttribute('aria-busy', id === 'state-loading' ? 'true' : 'false');
  document.body.dataset.state = id;
  // The title box can only be measured once its section is visible; sized while
  // hidden it collapsed to 2px.
  if (id === 'state-product') autosize($('titleInput'));
}

function openDashboard(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + hash });
  window.close();
}

async function applyTheme() {
  try {
    const settings = await store.getSettings();
    applyLook(document.documentElement, settings);
    setActionIcon(settings.icon);
  } catch {
    /* defaults */
  }
}

// --- boot --------------------------------------------------------------------------------------

async function boot() {
  $('openDashboard').addEventListener('click', () => openDashboard('#home'));
  $('homeDashboard').addEventListener('click', () => openDashboard('#home'));
  $('importTabsBtn').addEventListener('click', () => openDashboard('#tabsimport'));
  $('openDashboardBrand').addEventListener('click', (e) => {
    e.preventDefault();
    openDashboard('#home');
  });
  $('restrictedDashboard').addEventListener('click', () => openDashboard('#home'));
  $('floatingLink').addEventListener('click', () => openDashboard('#settings'));
  await applyTheme();

  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  state.tab = tab;
  if (!tab || !tab.id || isRestrictedUrl(tab.url || '')) {
    restricted(tab && tab.url && /^file:/i.test(tab.url)
      ? 'Keepsake can’t read local files. Open a product page on a website and try again.'
      : 'Chrome doesn’t let extensions read this kind of page (browser pages, the Web Store and some protected sites). Open a product page on a regular website and try again.');
    return;
  }

  const ig = globalThis.KeepsakeInstagram ? globalThis.KeepsakeInstagram.parseSavedUrl(tab.url) : null;
  if (ig && ig.isSaved) {
    state.ig = ig;
    await instagramPanel(ig);
    return;
  }
  await loadProduct();
}

function restricted(message) {
  $('restrictedMessage').textContent = message;
  show('state-restricted');
}

// --- product flow --------------------------------------------------------------------------------

async function loadProduct() {
  show('state-loading');
  const [extracted, collections, prefs] = await Promise.all([
    send({ type: MSG.EXTRACT_TAB, tabId: state.tab.id }),
    store.getCollections().catch(() => []),
    store.getPrefs().catch(() => ({})),
  ]);
  state.collections = collections;
  state.threshold = Number(prefs?.confidenceThreshold) || 0.6;
  if (!extracted.ok || !extracted.product) {
    restricted(extracted.error || 'Keepsake could not read this page.');
    return;
  }
  state.product = extracted.product;
  state.chosenImage = state.product.image || '';
  // A video, recipe, place… already saved just shows that save: it's in its view, there's nothing to
  // choose. Products already saved get the preview, with its "update existing" option.
  const existing = await store.findByUrl(state.product.canonicalUrl || state.product.url).catch(() => null);
  if (existing && hasOwnView(kindOf(existing))) {
    state.savedItem = existing;
    state.savedMode = 'existing';
    showSaved(existing, existing.collectionId ? state.collections.find((c) => c.id === existing.collectionId) || null : null);
    return;
  }
  const [cls, items] = await Promise.all([
    send({ type: MSG.CLASSIFY, product: state.product }),
    store.getItems().catch(() => []),
  ]);
  state.classification = cls.ok ? cls.classification : { collectionId: null, collectionName: 'Review', confidence: 0, reason: '', isInbox: true, isNew: false };
  state.duplicate = existing;
  state.items = items;
  renderProduct();
  showHome();
}

// --- home: drawn like the iPhone share sheet -------------------------------------------------------
// Opening Keepsake never saves. Open dashboard sits in the header. Under it the page is drawn as its object
// with "Where does it live?": Collections or Lifestyle (tap one to see its groups, tap a group to put it
// there, or start a collection), or "Not sure? Put it in Review". Once there's a place, the page shrinks to a
// small card whose title you can tidy, and Save (with Add a note beside it) appears.

const tintOf = (kind) => `var(--c-kind-${kind === 'media' ? 'film' : kind}-fill, var(--c-surface-2))`;
const hasPhoto = (it) => /^https:\/\//.test(it.image || '');

// The library a picker value belongs to: a Lifestyle view, a collection, or neither (Review).
function shelfOf(value) {
  if (value === null || value === undefined || value === '') return null;
  return value.startsWith('kind:') ? 'lifestyle' : 'collections';
}

function choiceLabel(value) {
  if (!value) return 'Review';
  if (value.startsWith('kind:')) return kindInfo(value.slice(5)).plural;
  if (value.startsWith('new:')) return state.classification.collectionName;
  if (value === '__new') return sanitizeText($('homeNewName').value, 80) || 'A new collection';
  return state.collections.find((c) => c.id === value)?.name || 'Review';
}

function choiceKind(value) {
  return value && value.startsWith('kind:') ? value.slice(5) : 'product';
}

function pageKind() {
  const cls = state.classification;
  if (cls.shelf) return cls.shelf;
  return state.product.price !== null && state.product.price !== undefined && state.product.price !== '' ? 'product' : 'link';
}

function picture(src, kind, onFail) {
  if (!src) return kindIcon(kind);
  return el('img', { src, alt: '', onError: (e) => e.target.replaceWith(onFail ? onFail() : kindIcon(kind)) });
}

const inShelf = (it, shelf) => (shelf === 'collections' ? !!it.collectionId : !it.collectionId && hasOwnView(kindOf(it)));

// Opens the home fresh (reset) or as you left it (coming back from the editor).
function showHome({ reset = true, shelf } = {}) {
  if (reset) {
    state.choice = null;
    state.shelfOpen = null;
    $('homeTitleInput').value = state.product.title || '';
    $('homeNewName').value = '';
    $('homeNote').value = '';
    $('homeNote').classList.add('hidden');
  }
  if (shelf !== undefined) state.shelfOpen = shelf;
  const p = state.product;
  const kind = pageKind();

  // The page as its object.
  const photo = $('homeObjectPhoto');
  clear(photo);
  photo.style.setProperty('--tint', tintOf(kind));
  photo.hidden = !state.chosenImage;
  if (state.chosenImage) photo.append(el('img', { src: state.chosenImage, alt: '', onError: () => { photo.hidden = true; } }));
  const pill = $('homeObjectPill');
  clear(pill);
  pill.style.setProperty('--tint', tintOf(kind));
  pill.append(kindIcon(kind), state.classification.isInbox ? 'Needs a place' : kindInfo(kind).label);
  $('homeObjectTitle').textContent = p.title || p.host || '';
  const thumb = $('homeThumb');
  clear(thumb);
  thumb.style.setProperty('--tint', tintOf(kind));
  thumb.append(picture(state.chosenImage, kind));

  const dup = state.duplicate;
  const dupCol = dup && dup.collectionId ? state.collections.find((c) => c.id === dup.collectionId) : null;
  $('homeAlready').textContent = dup ? `Already saved${dupCol ? ` in ${dupCol.name}` : ''}. Pick a place to update it or save a copy.` : '';
  $('homeAlready').classList.toggle('hidden', !dup);

  // Keepsake's guess, said once.
  const initial = state.initialChoice;
  const cls = state.classification;
  const guess = $('homeGuess');
  clear(guess);
  if (initial) guess.append('Keepsake thinks ', el('strong', {}, [choiceLabel(initial)]), '.');
  else if (cls.suggested?.collectionName) guess.append('Keepsake isn’t sure. Maybe ', el('strong', {}, [cls.suggested.collectionName]), '?');
  else guess.append('Keepsake isn’t sure yet.');

  // Each library with a fan of what's already in it.
  for (const [id, which] of [['libCollections', 'collections'], ['libLifestyle', 'lifestyle']]) {
    const card = $(id);
    const fan = card.querySelector('.fan');
    clear(fan);
    const members = state.items.filter((it) => inShelf(it, which));
    const shown = [...members.filter(hasPhoto), ...members.filter((it) => !hasPhoto(it))].slice(0, 3).reverse();
    const fallback = which === 'collections' ? ['product', 'product', 'product'] : ['place', 'recipe', 'video'];
    for (let i = 0; i < 3; i++) {
      const it = shown[i];
      const k = it ? kindOf(it) : fallback[i];
      const tile = el('span', {}, [picture(it && hasPhoto(it) ? it.image : '', k)]);
      tile.style.setProperty('--tint', tintOf(k));
      fan.append(tile);
    }
    card.querySelector('.library-count').textContent = which === 'collections'
      ? pluralize(state.collections.length, 'collection', 'collections')
      : pluralize(LIFESTYLE().length, 'kind', 'kinds');
    card.onclick = () => openShelf(which);
  }
  $('pickReview').onclick = () => choose('');
  $('groupsBack').onclick = () => { state.shelfOpen = null; renderHome(); };
  $('homeAddNote').onclick = () => {
    $('homeNote').classList.remove('hidden');
    $('homeAddNote').classList.add('hidden');
    $('homeNote').focus();
  };
  $('homeSave').onclick = () => saveFromHome();
  $('homeNewName').oninput = () => renderHome();
  for (const id of ['homeTitleInput', 'homeNewName']) {
    $(id).onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && state.choice !== null) {
        e.preventDefault();
        saveFromHome();
      }
    };
  }
  $('homeTitleInput').oninput = () => autosize($('homeTitleInput'), 60);

  show('state-home');
  if (state.shelfOpen) openShelf(state.shelfOpen);
  else renderHome();
  if (reset) setTimeout(() => $('homeDashboard').focus(), 30);
}

// Draws what changes as you pick: the object or the small card, libraries or groups, ticks, Save.
function renderHome() {
  const choice = state.choice;
  const picked = choice !== null && choice !== undefined;
  const shelf = state.shelfOpen;
  $('homeObject').classList.toggle('hidden', picked || !!shelf);
  $('homeCompact').classList.toggle('hidden', !picked && !shelf);
  $('homeLibraries').classList.toggle('hidden', !!shelf);
  $('homeGroups').classList.toggle('hidden', !shelf);
  $('homeActions').classList.toggle('hidden', !picked);
  $('homeAddNote').classList.toggle('hidden', !$('homeNote').classList.contains('hidden'));
  $('homeNewRow').classList.toggle('hidden', choice !== '__new');
  $('homeError').classList.add('hidden');

  const review = $('pickReview');
  review.classList.toggle('is-here', choice === '');
  review.setAttribute('aria-pressed', choice === '' ? 'true' : 'false');
  $('reviewTitle').textContent = choice === '' ? 'Going to Review' : 'Not sure? Put it in Review';

  const guess = state.initialChoice;
  for (const [id, which, plain] of [['libCollections', 'collections', 'Things to buy'], ['libLifestyle', 'lifestyle', 'Recipes, places & more']]) {
    const card = $(id);
    const here = picked && shelfOf(choice) === which;
    const guessed = !here && shelfOf(guess) === which;
    card.classList.toggle('is-here', here);
    card.classList.toggle('has-guess', guessed);
    card.querySelector('.library-caption').textContent = here ? choiceLabel(choice) : guessed ? `Maybe ${choiceLabel(guess)}` : plain;
    card.setAttribute('aria-label', `${which === 'collections' ? 'Collections' : 'Lifestyle'}, ${here ? `going to ${choiceLabel(choice)}` : plain}`);
  }
  for (const tile of $('groupGrid').querySelectorAll('.group')) {
    tile.classList.toggle('is-here', tile.dataset.value === choice);
    tile.setAttribute('aria-pressed', tile.dataset.value === choice ? 'true' : 'false');
  }

  const dest = $('homeDest');
  clear(dest);
  dest.classList.toggle('is-set', picked);
  if (picked) {
    const icon = choice === '' ? reviewIcon() : kindIcon(choiceKind(choice));
    dest.style.setProperty('--dest-tint', choice === '' ? 'var(--c-highlight)' : tintOf(choiceKind(choice)));
    dest.append(icon, `In ${choiceLabel(choice)}`);
  } else dest.append('Pick where it goes');
  $('homeSaveLabel').textContent = state.duplicate ? 'Continue' : 'Save';
  autosize($('homeTitleInput'), 60);
}

// One library's groups, as cover tiles: Lifestyle's views, or your collections (plus a new one).
function openShelf(shelf) {
  const lifestyle = shelf === 'lifestyle';
  const cls = state.classification;
  state.shelfOpen = shelf;
  $('groupsTitle').textContent = lifestyle ? 'Lifestyle' : 'Collections';
  $('groupsSub').textContent = lifestyle ? 'Pick the view it belongs in' : 'Pick a collection, or start one';
  const grid = $('groupGrid');
  clear(grid);
  const saves = (n) => (n ? pluralize(n, 'save', 'saves') : 'Empty');
  const tile = (value, title, members, kind, stamp) => {
    const cover = members.find(hasPhoto);
    const box = el('span', { class: `group-cover ${members.length ? '' : 'is-empty'}`.trim() }, [cover ? picture(cover.image, kind) : kindIcon(kind)]);
    box.style.setProperty('--tint', tintOf(kind));
    if (stamp && cover) {
      const st = el('span', { class: 'group-stamp', 'aria-hidden': 'true' }, [kindIcon(kind)]);
      st.style.setProperty('--tint', tintOf(kind));
      box.append(st);
    }
    const node = el('button', {
      type: 'button', class: `group ${value === state.initialChoice ? 'is-guess' : ''}`.trim(), dataset: { value },
      'aria-label': `${title}, ${saves(members.length)}`, onClick: () => choose(value),
    }, [box, el('span', { class: 'group-title' }, [title]), el('span', { class: 'group-sub' }, [saves(members.length)])]);
    return node;
  };
  if (lifestyle) {
    for (const k of LIFESTYLE()) grid.append(tile(`kind:${k.value}`, k.plural, state.items.filter((it) => kindOf(it) === k.value && !it.collectionId), k.value, true));
  } else {
    grid.append(el('button', { type: 'button', class: 'group group-new', dataset: { value: '__new' }, onClick: () => choose('__new') }, [plusIcon(), el('span', { class: 'group-title' }, ['New collection'])]));
    if (cls.isNew && cls.taxonomyKey) grid.append(tile(`new:${cls.taxonomyKey}`, cls.collectionName, [], 'product', false));
    for (const c of state.collections) grid.append(tile(c.id, c.name, state.items.filter((it) => it.collectionId === c.id), 'product', false));
  }
  renderHome();
  setTimeout(() => {
    const target = grid.querySelector('.is-here');
    target?.scrollIntoView?.({ block: 'nearest' });
  }, 0);
}

// A place picked: it's ticked, the page becomes a small card with its title ready to tidy, Save appears.
function choose(value) {
  state.choice = value;
  renderHome();
  setTimeout(() => (value === '__new' ? $('homeNewName') : $('homeTitleInput')).focus(), 30);
}

// Save from the sheet: hand the choice, title and note to the editor's save (which also handles a name
// close to an existing collection and a page that's already saved, by showing the editor).
function saveFromHome() {
  if (state.choice === null || state.choice === undefined) return;
  const sel = $('collectionSelect');
  if (!state.choice && !sel.querySelector('option[value=""]')) sel.prepend(el('option', { value: '', text: 'Not sure yet (leave it in Review)' }));
  sel.value = state.choice;
  sel.onchange();
  if (state.choice === '__new') {
    const name = sanitizeText($('homeNewName').value, 80);
    if (!name) {
      $('homeNewName').focus();
      return;
    }
    $('newCollectionInput').value = name;
  }
  $('titleInput').value = $('homeTitleInput').value;
  $('noteInput').value = $('homeNote').value;
  $('quickDest').textContent = choiceLabel(state.choice);
  save({ force: false });
}

function svgIcon(d, width = '2.4') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

const plusIcon = () => svgIcon('M12 5v14M5 12h14');
const reviewIcon = () => svgIcon('M4 13h4l1.5 3h5L16 13h4M5.5 6h13L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z', '2');

function renderProduct() {
  const p = state.product;
  $('sparseNotice').classList.toggle('hidden', !p.sparse);

  // Retailer + host
  $('retailer').textContent = p.retailer || p.host || '';
  $('host').textContent = p.host || '';
  $('host').title = p.canonicalUrl || p.url || '';

  // Title
  const title = $('titleInput');
  title.value = p.title || '';
  autosize(title);
  title.addEventListener('input', () => autosize(title));
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && $('state-product').classList.contains('quick')) {
      e.preventDefault();
      if (state.duplicate) return;
      save({ force: false });
    }
  });
  $('heroInitial').textContent = (p.title || p.host || 'K').trim().charAt(0).toUpperCase() || 'K';

  // Price: only for products (a number on a video or recipe page is never its price).
  document.querySelector('.price-row')?.classList.toggle('hidden', !!state.classification?.kind && state.classification.kind !== 'product');
  const priceInput = $('priceInput');
  const curInput = $('currencyInput');
  if (p.price !== null && p.price !== undefined && p.price !== '' && Number.isFinite(Number(p.price))) {
    priceInput.value = String(p.price);
    curInput.value = p.currency || '';
  } else if (p.priceText) {
    const parsed = parsePrice(p.priceText, p.currency);
    priceInput.value = parsed ? String(parsed.amount) : '';
    curInput.value = parsed ? parsed.currency || p.currency || '' : p.currency || '';
  } else {
    priceInput.value = '';
    curInput.value = p.currency || '';
  }
  priceInput.addEventListener('input', () => {
    const parsed = parsePrice(priceInput.value, curInput.value);
    if (parsed && parsed.currency && !curInput.value) curInput.value = parsed.currency;
  });

  // Images
  setHeroImage(state.chosenImage);
  const cands = (p.images || []).filter(Boolean).slice(0, 6);
  const candBox = $('candidates');
  clear(candBox);
  if (cands.length > 1) {
    cands.forEach((src, i) => {
      const b = el('button', {
        type: 'button', class: 'candidate', role: 'radio', 'aria-checked': src === state.chosenImage ? 'true' : 'false', 'aria-label': `Image ${i + 1}`,
        onClick: () => {
          state.chosenImage = src;
          setHeroImage(src);
          candBox.querySelectorAll('.candidate').forEach((c) => c.setAttribute('aria-checked', c === b ? 'true' : 'false'));
        },
      }, [el('img', { src, alt: '', loading: 'lazy', onError: () => b.remove() })]);
      candBox.append(b);
    });
    candBox.classList.remove('hidden');
  } else {
    candBox.classList.add('hidden');
  }

  renderCollectionPicker();
  renderDuplicate();

  $('saveBtn').addEventListener('click', () => save({ force: false }));
  $('dupCopy').addEventListener('click', () => save({ force: true }));
  $('dupUpdate').addEventListener('click', () => updateExisting());
  $('newCollectionCancel').addEventListener('click', () => {
    $('newCollectionRow').classList.add('hidden');
    $('nearMatchRow').classList.add('hidden');
    $('collectionSelect').value = state.classification.isNew ? `new:${state.classification.taxonomyKey}` : state.classification.collectionId || '';
    state.userOverride = false;
    updateConfidencePill();
  });
  $('quickChange').addEventListener('click', () => showHome({ reset: false }));
  $('moreDetails').addEventListener('click', () => {
    $('state-product').classList.remove('quick');
    autosize($('titleInput'));
  });
  $('newCollectionInput').addEventListener('input', () => $('nearMatchRow').classList.add('hidden'));
  $('newCollectionInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save({ force: !!state.duplicate });
    }
  });
}

function setHeroImage(src) {
  const img = $('heroImg');
  const ph = $('heroPlaceholder');
  if (!src) {
    img.hidden = true;
    img.removeAttribute('src');
    ph.hidden = false;
    return;
  }
  img.onload = () => {
    img.hidden = false;
    ph.hidden = true;
  };
  img.onerror = () => {
    img.hidden = true;
    ph.hidden = false;
  };
  img.src = src;
}

function autosize(ta, max = 96) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(max, ta.scrollHeight + 2) + 'px';
}

function renderCollectionPicker() {
  const sel = $('collectionSelect');
  clear(sel);
  const cls = state.classification;
  // Anywhere you like: a Lifestyle view (the save becomes that kind) or a collection (shopping).
  if (cls.isInbox) sel.append(el('option', { value: '', text: 'Not sure yet (leave it in Review)' }));
  sel.append(el('optgroup', { label: 'Lifestyle' }, LIFESTYLE().map((k) => el('option', { value: `kind:${k.value}`, text: k.plural }))));
  const cols = el('optgroup', { label: 'Collections' }, state.collections.map((c) => el('option', { value: c.id, text: c.name })));
  if (cls.isNew && cls.taxonomyKey) cols.append(el('option', { value: `new:${cls.taxonomyKey}`, text: `${cls.collectionName} (new collection)` }));
  cols.append(el('option', { value: '__new', text: '＋ New collection…' }));
  sel.append(cols);
  const initial = cls.shelf ? `kind:${cls.shelf}` : cls.isNew ? `new:${cls.taxonomyKey}` : cls.collectionId || '';
  state.initialChoice = initial;
  sel.value = initial;
  if (sel.value !== initial) sel.value = sel.options[0]?.value || '';
  sel.onchange = () => {
    // A price only means something for shopping.
    document.querySelector('.price-row')?.classList.toggle('hidden', sel.value.startsWith('kind:'));
    if (sel.value === '__new') {
      $('newCollectionRow').classList.remove('hidden');
      $('newCollectionInput').focus();
      state.userOverride = true;
    } else {
      $('newCollectionRow').classList.add('hidden');
      state.userOverride = sel.value !== initial;
    }
    updateConfidencePill();
  };
  updateConfidencePill();
}

function updateConfidencePill() {
  const pill = $('confidencePill');
  const cls = state.classification;
  const reason = $('reason');
  pill.className = 'pill';
  if (state.userOverride) {
    pill.textContent = 'Your choice';
    pill.classList.add('pill-ok');
    pill.title = 'Keepsake will learn from this';
    reason.textContent = 'Keepsake will remember choices like this for similar items.';
    return;
  }
  const pct = Math.round((cls.confidence || 0) * 100);
  if (cls.isInbox) {
    pill.textContent = 'Needs sorting';
    pill.classList.add('pill-warn');
    pill.title = cls.reason || '';
    reason.textContent = cls.suggested ? `Maybe ${cls.suggested.collectionName}? You can pick a collection above or sort it later.` : 'Keepsake couldn’t tell where this goes. Pick a collection above or sort it later from Review.';
  } else {
    const level = cls.confidence >= 0.75 ? 'High' : cls.confidence >= state.threshold ? 'Good' : 'Low';
    pill.textContent = `${level} · ${pct}%`;
    pill.classList.add(level === 'Low' ? 'pill-warn' : 'pill-ok');
    pill.title = cls.reason || '';
    reason.textContent = cls.reason ? capitalize(cls.reason) : '';
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function renderDuplicate() {
  const row = $('dupRow');
  const dup = state.duplicate;
  if (!dup) {
    row.classList.add('hidden');
    $('saveActions').classList.remove('hidden');
    return;
  }
  const col = state.collections.find((c) => c.id === dup.collectionId);
  $('dupText').textContent = `“${cut(dup.title, 60)}” is already in ${col ? col.name : 'Keepsake'}.`;
  row.classList.remove('hidden');
  $('saveActions').classList.add('hidden');
}

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function collectEdits() {
  const p = { ...state.product };
  p.title = sanitizeText($('titleInput').value, 200) || p.title;
  p.price = null;
  p.priceText = $('priceInput').value.trim();
  p.currency = sanitizeText($('currencyInput').value, 4).toUpperCase();
  if (state.chosenImage) {
    p.image = state.chosenImage;
    p.images = [state.chosenImage, ...(p.images || []).filter((u) => u !== state.chosenImage)];
  }
  return p;
}

async function resolveCollectionChoice() {
  const sel = $('collectionSelect');
  if (sel.value === '__new') {
    const name = sanitizeText($('newCollectionInput').value, 80);
    if (!name) {
      $('newCollectionInput').focus();
      throw new Error('Give the new collection a name.');
    }
    // A name close to an existing collection ("Food" vs Kitchen, which covers food):
    // ask which one was meant instead of quietly using the existing one.
    const near = state.confirmedNewName === name ? null : nearMatchCollection(name, state.collections);
    if (near) {
      askNearMatch(name, near);
      throw ASKED;
    }
    const { collection, existed } = await store.createCollection({ name });
    if (existed) {
      state.collections = await store.getCollections();
      renderCollectionPicker();
      sel.value = collection.id;
      state.userOverride = collection.id !== state.classification.collectionId;
    }
    return collection.id;
  }
  return sel.value;
}

// Thrown to stop a save while the near-match question is showing; not an error.
const ASKED = new Error('asked');

function askNearMatch(name, near) {
  const other = near.collection.name;
  $('nearMatchText').textContent = near.matched
    ? `You already have “${other}”, which also covers “${near.matched}”.`
    : `You already have a collection with a similar name, “${other}”.`;
  const create = $('nearMatchCreate');
  const use = $('nearMatchUse');
  create.textContent = `Create “${cut(name, 24)}”`;
  use.textContent = `Use “${cut(other, 24)}”`;
  const retry = state.retry;
  create.onclick = () => {
    state.confirmedNewName = name;
    $('nearMatchRow').classList.add('hidden');
    if (retry) retry();
  };
  use.onclick = () => {
    $('collectionSelect').value = near.collection.id;
    $('newCollectionRow').classList.add('hidden');
    $('nearMatchRow').classList.add('hidden');
    state.userOverride = near.collection.id !== state.classification.collectionId;
    updateConfidencePill();
    if (retry) retry();
  };
  $('nearMatchRow').classList.remove('hidden');
  create.focus();
}

function setBusy(busy) {
  for (const id of ['saveBtn', 'dupUpdate', 'dupCopy', 'homeSave']) {
    const b = $(id);
    b.disabled = busy;
  }
  $('saveBtn').textContent = busy ? 'Saving…' : 'Save';
  $('homeSaveLabel').textContent = busy ? 'Saving…' : state.duplicate ? 'Continue' : 'Save';
}

async function save({ force }) {
  // From the home sheet, anything that needs the editor (a near-match question, an error) shows it.
  const fromHome = document.body.dataset.state === 'state-home';
  const toEditor = () => {
    if (!fromHome) return;
    $('state-product').classList.add('quick');
    show('state-product');
  };
  const err = $('saveError');
  err.classList.add('hidden');
  setBusy(true);
  state.retry = () => save({ force });
  try {
    let chosen = await resolveCollectionChoice();
    const product = collectEdits();
    // A Lifestyle view picked: save it as that kind (its details are worked out from the page).
    if (chosen.startsWith('kind:')) {
      product.kind = chosen.slice(5);
      chosen = null;
    }
    const note = sanitizeText($('noteInput').value, 1000);
    // Not sure: it waits in Review, where Keepsake suggests a home later.
    const review = chosen === '';
    const res = await send({
      type: MSG.SAVE_ITEM, product, force, note, source: 'toolbar',
      collectionId: state.userOverride && !review ? chosen : null,
      classification: review ? { ...state.classification, collectionId: null, collectionName: 'Review', taxonomyKey: null, isNew: false, isInbox: true, shelf: null } : state.userOverride ? null : state.classification,
      learn: 'light',
    });
    if (!res.ok) throw new Error(res.error || 'Could not save.');
    if (res.duplicate) {
      state.duplicate = res.existing;
      renderDuplicate();
      toEditor();
      return;
    }
    state.savedItem = res.item;
    state.savedMode = 'saved';
    // The save may have created a collection (typed in, or a default one on demand);
    // reload so the "Move to" menu lists it and shows it selected.
    if (res.collection && !state.collections.some((c) => c.id === res.collection.id)) state.collections = await store.getCollections();
    showSaved(res.item, res.collection, res.classification);
  } catch (e) {
    if (e !== ASKED) {
      err.textContent = String((e && e.message) || e);
      err.classList.remove('hidden');
    }
    toEditor();
  } finally {
    setBusy(false);
  }
}

async function updateExisting() {
  const err = $('saveError');
  err.classList.add('hidden');
  setBusy(true);
  state.retry = () => updateExisting();
  try {
    const chosen = await resolveCollectionChoice();
    const product = collectEdits();
    const patch = { title: product.title, priceText: product.priceText, currency: product.currency, image: product.image, images: product.images };
    const note = sanitizeText($('noteInput').value, 1000);
    if (note) patch.note = note;
    if (state.userOverride && chosen && chosen !== state.duplicate.collectionId) patch.collectionId = chosen;
    const res = await send({ type: MSG.UPDATE_ITEM, itemId: state.duplicate.id, patch, learn: 'light' });
    if (!res.ok) throw new Error(res.error || 'Could not update.');
    state.savedItem = res.item;
    state.savedMode = 'updated';
    const col = state.collections.find((c) => c.id === res.item.collectionId);
    showSaved(res.item, col);
  } catch (e) {
    if (e === ASKED) return;
    err.textContent = String((e && e.message) || e);
    err.classList.remove('hidden');
  } finally {
    setBusy(false);
  }
}

function showSaved(item, collection, classification = null) {
  // A recipe, video, place… with no collection is saved to its own view ("Saved to Videos").
  const view = !collection && hasOwnView(kindOf(item)) ? kindInfo(kindOf(item)).plural : '';
  const isInbox = !collection && !view;
  const updated = state.savedMode === 'updated';
  const already = state.savedMode === 'existing';
  // Lifestyle saves (recipes, videos, places…) name their view; collections are for shopping.
  $('savedTitle').textContent = updated ? 'Updated' : already ? 'Already in' : isInbox ? 'Saved. Pick a collection now or later' : 'Saved to';
  document.querySelector('.capture').classList.toggle('is-review', isInbox && !updated);
  $('savedSubtitle').textContent = cut(item.title, 90);
  $('savedMeta').textContent = [formatPrice(item.price, item.currency), item.retailer || item.host].filter(Boolean).join(' · ');
  const thumb = $('savedThumb');
  clear(thumb);
  if (item.image) thumb.append(el('img', { src: item.image, alt: '', onError: () => clear(thumb) }));
  $('savedInboxHint').textContent = [
    item.captureState === 'pending' ? 'Finishing details: your AI provider is tidying the title. You can close this.' : '',
    already ? `Saved ${new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, on this device.` : 'Saved on this device.',
  ].filter(Boolean).join(' ');
  renderSuggestions(item, isInbox && !updated ? classification : null);
  $('savedUndo').classList.toggle('hidden', updated || already);
  const learnRow = $('learnRow');
  const learnCheck = $('learnCheck');
  learnCheck.checked = false;
  learnRow.classList.toggle('hidden', !(state.userOverride && state.savedMode === 'saved' && !isInbox));
  learnCheck.onchange = async () => {
    if (!learnCheck.checked) return;
    try {
      const prefs = await store.getPrefs();
      await store.setPrefs(learnFromCorrection(item, state.classification?.collectionId || null, item.collectionId, prefs, { strong: true }));
    } catch {
      /* best effort */
    }
  };
  renderSavedMove(item);
  $('savedUndo').onclick = async () => {
    $('savedUndo').disabled = true;
    await send({ type: MSG.UNDO_SAVE, itemId: item.id });
    state.duplicate = null;
    renderDuplicate();
    state.items = state.items.filter((it) => it.id !== item.id);
    showHome();
    $('savedUndo').disabled = false;
  };
  // Show the item where it landed: its collection, or Review if it wasn't filed.
  // Where the save lives: its collection, else its kind's view (Videos, Recipes…), else Review.
  $('savedOpen').onclick = () => {
    const it = state.savedItem;
    openDashboard(it?.collectionId ? `#c/${it.collectionId}` : it && hasOwnView(kindOf(it)) ? `#kind/${kindOf(it)}` : '#review');
  };
  show('state-saved');
  setTimeout(() => $('savedOpen').focus(), 30);
}

// After every save: a one-step "Move to", so a wrong collection is easy to spot and fix.
function renderSavedMove(item) {
  const row = $('savedMoveRow');
  const movable = state.savedMode === 'saved' || state.savedMode === 'existing';
  row.classList.toggle('hidden', !movable);
  if (!movable) return;
  const sel = $('savedMove');
  clear(sel);
  // Move it anywhere: a Lifestyle view (it becomes that kind) or a collection (shopping).
  const ownView = hasOwnView(kindOf(item)) && !item.collectionId;
  if (!item.collectionId && !ownView) sel.append(el('option', { value: '', text: 'Review (not sorted)' }));
  sel.append(el('optgroup', { label: 'Lifestyle' }, LIFESTYLE().map((k) => el('option', { value: `kind:${k.value}`, text: k.plural }))));
  sel.append(el('optgroup', { label: 'Collections' }, state.collections.map((c) => el('option', { value: c.id, text: c.name }))));
  sel.value = item.collectionId || (ownView ? `kind:${kindOf(item)}` : '');
  row.classList.toggle('is-user', item.categorizationSource === 'manual');
  sel.onchange = async () => {
    if (!sel.value) return;
    sel.disabled = true;
    const res = await send({ type: MSG.UPDATE_ITEM, itemId: item.id, patch: { collectionId: sel.value }, learn: 'light' });
    sel.disabled = false;
    if (!res.ok) return;
    state.savedItem = res.item;
    if (sel.value.startsWith('kind:')) {
      // Now that kind: show it as saved there (with the name or details it picked up).
      showSaved(res.item, null);
      $('savedTitle').textContent = 'Moved to';
      return;
    }
    filedTo(sel.value, 'Moved to');
  };
}

// Reflects a collection the person chose: heading, chip (filled = their choice), no more suggestions.
function filedTo(collectionId, heading) {
  const sel = $('savedMove');
  if (![...sel.options].some((o) => o.value === collectionId)) {
    const col = state.collections.find((c) => c.id === collectionId);
    if (col) sel.append(el('option', { value: col.id, text: col.name }));
  }
  sel.value = collectionId;
  const placeholder = sel.querySelector('option[value=""]');
  if (placeholder) placeholder.remove();
  $('savedTitle').textContent = heading;
  $('savedMoveRow').classList.add('is-user');
  document.querySelector('.capture').classList.remove('is-review');
  renderSuggestions(null, null);
}

// Review: up to three likely collections, one tap (or 1/2/3) to file and teach the sorter.
function renderSuggestions(item, classification) {
  const box = $('savedSuggest');
  clear(box);
  document.onkeydown = null;
  const alts = (classification?.alternatives || []).filter((a, i, all) => a.collectionName && all.findIndex((b) => b.collectionName === a.collectionName) === i).slice(0, 3);
  box.classList.toggle('hidden', !item || !alts.length);
  if (!item || !alts.length) return;
  const file = async (alt) => {
    let id = alt.collectionId;
    if (alt.isNew && alt.taxonomyKey) {
      const col = await store.ensureCollectionForTaxonomy(alt.taxonomyKey).catch(() => null);
      if (!col) return;
      id = col.id;
      state.collections = await store.getCollections().catch(() => state.collections);
    }
    const res = await send({ type: MSG.UPDATE_ITEM, itemId: item.id, patch: { collectionId: id }, learn: 'light' });
    if (!res.ok) return;
    state.savedItem = res.item;
    filedTo(id, 'Filed to');
  };
  alts.forEach((alt, i) => {
    box.append(el('button', { type: 'button', class: 'suggest-chip', onClick: () => file(alt), 'aria-keyshortcuts': String(i + 1) }, [el('kbd', {}, [String(i + 1)]), alt.collectionName]));
  });
  document.onkeydown = (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= alts.length) {
      e.preventDefault();
      file(alts[n - 1]);
    }
  };
}

// --- Instagram import ------------------------------------------------------------------------------

async function instagramPanel(ig) {
  show('state-instagram');
  const nameGuess = ig.isCollection ? ig.collectionName || 'this collection' : '';
  const start = ig.isCollection ? startScan : startAll;
  if (ig.isCollection) {
    $('igTitle').textContent = `“${nameGuess}”`;
    $('igSubtitle').textContent = ig.username ? `Saved collection · @${ig.username}` : 'Saved collection';
    $('igName').textContent = nameGuess;
  } else {
    // The Saved overview: every collection in turn, then "All posts" for the rest.
    $('igTitle').textContent = 'All your Saved collections';
    $('igSubtitle').textContent = ig.username ? `Saved · @${ig.username}` : 'Saved';
    $('igExplain').textContent = 'Keepsake will open each of your collections in this tab, one after another, scroll each to the end, then “All posts” for anything in no collection. You review everything before it is saved, and each collection becomes a group with the same name. Nothing is sent anywhere.';
    $('igStart').textContent = 'Import all collections';
    $('igHelp').textContent = 'Keep this tab open while it runs; it moves at a browsing pace and you can stop at any time. Needs access to instagram.com. Your login, cookies and messages are never read.';
    if (!(await hasInstagramAccess())) igAccessHint();
  }

  $('igStart').addEventListener('click', start);
  $('igRetry').addEventListener('click', start);
  $('igAgain').addEventListener('click', async () => {
    await send({ type: MSG.IG_SCAN_CLEAR });
    start();
  });
  $('igStop').addEventListener('click', async () => {
    $('igStop').disabled = true;
    $('igStatus').textContent = 'Stopping…';
    await send({ type: MSG.IG_STOP_SCAN, tabId: state.tab.id });
  });
  $('igReview').addEventListener('click', () => openDashboard('#import'));

  const res = await send({ type: MSG.IG_SCAN_STATE });
  const scan = res.ok ? res.scan : null;
  if (scan && scan.tabId === state.tab.id && scan.status !== 'error') renderScan(scan);
  else if (scan && scan.posts && scan.posts.length && scan.status === 'done') {
    // A finished scan from another tab is waiting for review.
    igView('idle');
    $('igIdle').append(el('p', { class: 'help' }, [
      `A previous scan (${pluralize(scan.posts.length, 'post', 'posts')}) is waiting. `,
      el('button', { type: 'button', class: 'btn-link small', onClick: () => openDashboard('#import') }, ['Review it']),
    ]));
  } else igView('idle');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[SESSION_KEYS.igScan]) return;
    const next = changes[SESSION_KEYS.igScan].newValue;
    if (next && next.tabId === state.tab.id) renderScan(next);
  });
}

// Shown on the Saved overview until instagram.com access is granted.
function igAccessHint() {
  const text = el('span', {}, ['Keepsake doesn’t have access to instagram.com yet. ']);
  const hint = el('div', { class: 'notice notice-warn', id: 'igAccess' }, [text, el('button', { type: 'button', class: 'btn-link small', onClick: async () => {
    if ((await requestInstagramAccess()) || (await hasInstagramAccess())) return hint.remove();
    text.textContent = `Access wasn’t granted. ${instagramAccessHelp()} `;
  } }, ['Grant access'])]);
  $('igIdle').prepend(hint);
}

function igView(which) {
  for (const v of ['idle', 'running', 'done', 'error']) {
    $('ig' + v.charAt(0).toUpperCase() + v.slice(1)).classList.toggle('hidden', v !== which);
  }
}

async function startScan() {
  igView('running');
  $('igStop').disabled = false;
  $('igCount').textContent = '0';
  $('igStatus').textContent = 'Starting…';
  const res = await send({ type: MSG.IG_START_SCAN, tabId: state.tab.id });
  if (!res.ok) {
    $('igErrorNotice').textContent = res.error || 'Could not start the scan. Reload the Instagram tab and try again.';
    igView('error');
    return;
  }
  watchStart();
}

// The page's first report arrives within a second or two. If none has after a while, the scan never
// reached Keepsake: say so instead of spinning on "Looking for posts…" for ever.
function watchStart(ms = 15000) {
  setTimeout(async () => {
    const res = await send({ type: MSG.IG_SCAN_STATE });
    if (!res.ok || res.scan?.status !== 'starting' || res.scan.tabId !== state.tab.id) return;
    const safari = location.protocol === 'safari-web-extension:';
    $('igErrorNotice').textContent = `The scan didn’t start in this tab. Reload the Instagram page and try again. If it still doesn’t start, let Keepsake use instagram.com: ${safari ? 'Safari → Settings → Extensions → Keepsake → Edit Websites…, set instagram.com to Allow' : 'right-click the Keepsake icon → Manage extension → Site access, and add https://www.instagram.com'}.`;
    igView('error');
  }, ms);
}

// "Import all collections": needs instagram.com access, since the tab moves from collection to collection.
async function startAll() {
  const granted = (await hasInstagramAccess()) || (await requestInstagramAccess());
  if (!granted) {
    $('igErrorNotice').textContent = 'Importing every collection needs access to instagram.com, so Keepsake can open each one in this tab. You can still import one collection at a time: open it, then click Keepsake.';
    igView('error');
    return;
  }
  igView('running');
  $('igStop').disabled = false;
  $('igCount').textContent = '0';
  $('igStatus').textContent = 'Finding your collections…';
  const res = await send({ type: MSG.IG_START_ALL, tabId: state.tab.id });
  if (!res.ok) {
    $('igErrorNotice').textContent = res.error || 'Could not start. Reload your Saved page and try again.';
    igView('error');
  }
}

function renderScan(scan) {
  // From the worker the scan has its posts; the session copy it watches has only their count.
  const n = scan.posts ? scan.posts.length : scan.count || 0;
  if (scan.bulk) {
    $('igTitle').textContent = 'All your Saved collections';
    if (scan.status === 'scanning' || scan.status === 'starting') {
      igView('running');
      $('igCount').textContent = String(n);
      $('igStatus').textContent = scan.bulk.current ? `Collection ${Math.min(scan.bulk.index + 1, scan.bulk.total)} of ${scan.bulk.total}: “${scan.bulk.current}”` : 'Finding your collections…';
      return;
    }
    if (scan.status === 'done') {
      igView('done');
      const read = scan.bulk.collections.filter((c) => c.status === 'done').length;
      const why = { stopped: 'stopped by you', limit: `reached the limit of ${n} posts`, interrupted: 'interrupted', error: scan.error || 'stopped by a problem' }[scan.reason] || 'all done';
      $('igDoneNotice').textContent = n ? `Found ${pluralize(n, 'post', 'posts')} in ${pluralize(read, 'collection', 'collections')} (${why}).` : `No posts were found (${why}).`;
      $('igReview').textContent = n ? `Review ${pluralize(n, 'post', 'posts')}` : 'Open import';
      return;
    }
  }
  if (scan.collectionName) {
    $('igTitle').textContent = `“${scan.collectionName}”`;
    if ($('igName')) $('igName').textContent = scan.collectionName;
  }
  if (scan.status === 'scanning' || scan.status === 'starting') {
    igView('running');
    $('igCount').textContent = String(n);
    $('igStatus').textContent = n ? 'Scrolling to load more…' : 'Looking for posts…';
  } else if (scan.status === 'done') {
    igView('done');
    const why = { end: 'reached the end of the collection', limit: 'reached the safety limit', idle: 'no new posts appeared', stopped: 'stopped by you' }[scan.reason] || 'finished';
    $('igDoneNotice').textContent = n ? `Found ${pluralize(n, 'post', 'posts')} — ${why}.` : `No posts were found (${why}). Make sure the collection has loaded, then try again.`;
    $('igReview').textContent = n ? `Review ${pluralize(n, 'post', 'posts')}` : 'Open import';
  } else if (scan.status === 'error') {
    igView('error');
    $('igErrorNotice').textContent = scan.error || 'The scan failed.';
  }
}

boot().catch((e) => restricted(String((e && e.message) || e)));
