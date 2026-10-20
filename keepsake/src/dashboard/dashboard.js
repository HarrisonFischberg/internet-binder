// Keepsake dashboard (full-tab page). Talks to Keepsake's storage (IndexedDB + chrome.storage.local) directly
// through the shared store and to the background worker only for a couple of
// helpers (opening tabs, refreshing floating buttons). No network access.

import { createStore, chromeBackend, idbBackend, TRASH_DAYS, applyLook } from '../shared/storage.js';
import { MSG, SESSION_KEYS } from '../shared/messages.js';
import { el, clear, formatPrice, formatDate, sanitizeText, parsePrice, debounce, pluralize, hostnameOf, prettyRetailer } from '../shared/util.js';
import { classify, nearMatchCollection } from '../shared/categorizer.js';
import { openableUrl } from '../shared/url.js';
import { KINDS, kindOf, kindInfo, keyFact, formatMinutes, sanitizeDetails, parseExerciseLine, exerciseName, formatExercise, workoutFromText, addressLine, mapsLinks, formatDuration, secondsFrom, needsCollection, hasOwnView, LIFESTYLE, kindChangePatch, shoppingKindFor, detailsForKind } from '../shared/kinds.js';
import { cleanTopics, guessTopics } from '../shared/topics.js';
import { searchItems } from '../shared/search.js';
import { LOOKUP_SOURCES } from '../shared/lookups.js';
import { placeState, placeReviewReasons } from '../shared/places.js';
import { followColorScheme, setActionIcon } from '../toolbar/icon.js';
import { goalTitle, goalProgress, resultText, formatSeconds, localDay } from '../shared/goals.js';
import { draftRecipe, suggestProgression } from '../ai/provider.js';
import * as UI from './ui.js';
import { kindIcon } from '../shared/kindIcon.js';
import { stepIngredients } from '../shared/stepIngredients.js';
import { renderSettings, renderAI, renderPrivacy, analyzeItems } from './settings.js';
import { renderImport } from './importer.js';
import { renderTabsImport } from './tabsImport.js';
import { runAiCleanup, renderAiLog, undoEntries, confirmAiRun, aiBacklogOf } from './aiCleanup.js';

const store = createStore(chromeBackend(), idbBackend());
followColorScheme();
const $ = (id) => document.getElementById(id);

// Labels for the "import method" filter — keys match item.type in shared/storage.js.
const SOURCE_TYPE_LABELS = { instagram: 'Instagram', inspiration: 'Inspiration', product: 'Saved from a page' };

const state = {
  route: { name: 'home', id: '' },
  collections: [],
  items: [],
  prefs: null,
  settings: null,
  importHistory: null,
  search: '',
  sort: 'newest',
  retailer: '',
  sourceType: '',
  colSearch: '',
  colSort: 'recent',
  topic: '',
  kinds: new Set(),
  status: '',
  layout: (() => { try { return localStorage.getItem('keepsake.layout') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } })(),
  focusSearch: false,
  selecting: false,
  selected: new Set(),
  shown: 120,
  scan: null,
  fillJob: null, // the background check running now or last (session storage: keepsake_fillJob)
  localJob: null, // a job running in this page (an Instagram import), shown in the same bar
};

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

const ctx = {
  store, state, send,
  // A job running in this page (an Instagram import) shown in the bar under the header; null takes it away.
  setLocalJob: (job) => { state.localJob = job; renderJobBar(); },
  toast: UI.toast,
  reload: () => reload(),
  render: () => render(),
  navigate: (hash) => navigate(hash),
  openItem: (id) => openItem(id),
  regularCollections: () => state.collections,
  collectionById: (id) => state.collections.find((c) => c.id === id) || null,
  applyTheme: () => applyTheme(),
};

// --- boot ------------------------------------------------------------------------

async function boot() {
  await store.init();
  // No alarms: the Trash is emptied of anything older than 30 days whenever the dashboard opens,
  // and saves still "finishing details" (worker stopped mid-way) are picked up again.
  await store.purgeTrash().catch(() => 0);
  send({ type: MSG.ENRICH_PENDING });
  state.trash = await store.getTrash().catch(() => []);
  await reload();
  applyTheme();
  bindChrome();
  window.addEventListener('hashchange', () => {
    state.route = parseHash();
    state.shown = 120;
    if (!GRID_ROUTES.has(state.route.name)) exitSelection(false);
    render();
  });
  state.route = parseHash();
  render();
  store.onChanged(debounce(async (changes) => {
    const keys = Object.keys(changes);
    if (!keys.some((k) => k.startsWith('keepsake_'))) return;
    await reload();
    if (changes.keepsake_settings) applyTheme();
    render({ keepScroll: true });
  }, 150));
  try {
    state.fillJob = (await chrome.storage.session.get(SESSION_KEYS.fillJob))?.[SESSION_KEYS.fillJob] || null;
  } catch {
    state.fillJob = null;
  }
  renderJobBar();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[SESSION_KEYS.fillJob]) {
      const was = state.fillJob;
      state.fillJob = changes[SESSION_KEYS.fillJob].newValue || null;
      renderJobBar();
      // Finished: say so once, and take the bar away after a while.
      if (was?.running && state.fillJob && !state.fillJob.running) setTimeout(renderJobBar, JOB_SHOWN_MS + 200);
    }
    // The session copy is the scan's summary; its posts come with the scan from the worker.
    if (area === 'session' && changes.keepsake_igScan && state.route.name === 'import') {
      send({ type: MSG.IG_SCAN_STATE }).then((res) => {
        state.scan = res?.ok ? res.scan : null;
        if (state.route.name === 'import') render({ keepScroll: true });
      });
    }
  });
}

async function reload() {
  const data = await store.getAll();
  state.collections = sortCollections(Object.values(data.collections || {}));
  state.items = Object.values(data.items || {}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  state.prefs = data.prefs;
  state.settings = data.settings;
  state.importHistory = data.importHistory;
  state.trash = await store.getTrash().catch(() => state.trash || []);
  for (const id of [...state.selected]) if (!data.items[id]) state.selected.delete(id);
}

function sortCollections(list) {
  return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
}

function applyTheme() {
  const theme = state.settings?.theme || 'system';
  applyLook(document.documentElement, state.settings);
  setActionIcon(state.settings?.icon);
  const btn = $('themeToggle');
  if (btn) btn.title = `Theme: ${theme}`;
}

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return { name: 'home', id: '' };
  const [name, ...rest] = h.split('/');
  return { name: name || 'home', id: rest.join('/') };
}

function navigate(hash) {
  if (location.hash === hash) {
    state.route = parseHash();
    render();
  } else location.hash = hash;
}

function bindChrome() {
  $('menuToggle').addEventListener('click', () => toggleNav());
  $('scrim').addEventListener('click', () => toggleNav(false));
  $('newCollectionBtn').addEventListener('click', () => newCollection());
  $('collectionsToggle').addEventListener('click', () => {
    collectionsChoice = !collectionsOpen();
    try { localStorage.setItem(COLLECTIONS_NAV_KEY, collectionsChoice ? 'open' : 'closed'); } catch { /* this page only */ }
    renderSidebarCollections();
  });
  $('navKindsToggle').addEventListener('click', () => {
    const open = $('navKindsToggle').getAttribute('aria-expanded') !== 'true';
    kindsChoice = open;
    try { localStorage.setItem(KINDS_NAV_KEY, open ? 'open' : 'closed'); } catch { /* remembered for this page only */ }
    setKindsOpen(open);
  });
  $('searchInput').addEventListener('input', debounce(() => {
    state.search = $('searchInput').value.trim();
    state.shown = 120;
    renderView();
  }, 120));
  // Alt+Z (⌥Z): undo the newest toast's action, e.g. "Moved to Trash · Undo".
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== 'KeyZ') return;
    if (UI.undoLast()) e.preventDefault();
  });
  // "/" jumps to search from anywhere that isn't a text field.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    if (document.querySelector('.modal-overlay')) return;
    e.preventDefault();
    if (!isGridRoute()) navigate('#all');
    $('searchInput').focus();
  });
  $('selectToggle').addEventListener('click', () => (state.selecting ? exitSelection(true) : enterSelection()));
  $('aiCheck').addEventListener('click', () => checkWithAI());
  $('themeToggle').addEventListener('click', async () => {
    const order = ['system', 'light', 'dark'];
    const cur = state.settings?.theme || 'system';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await store.updateSettings({ theme: next });
    UI.toast(`Theme: ${next}`, { duration: 1800 });
  });
  $('bulkAll').addEventListener('click', () => {
    const visible = currentGridItems();
    const all = visible.every((i) => state.selected.has(i.id));
    for (const i of visible) all ? state.selected.delete(i.id) : state.selected.add(i.id);
    renderView();
    updateBulkbar();
  });
  $('bulkMove').addEventListener('click', () => bulkMove());
  $('bulkFav').addEventListener('click', () => bulkPatch((items) => ({ favorite: !items.every((i) => i.favorite) })));
  $('bulkDelete').addEventListener('click', () => bulkDelete());
  $('bulkAi').addEventListener('click', () => bulkAi());
  $('bulkCancel').addEventListener('click', () => exitSelection(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !document.body.classList.contains('modal-open')) {
      e.preventDefault();
      ($('homeSearch') || $('collectionSearch') || $('searchInput')).focus();
    }
    if (e.key === 'Escape' && state.selecting && !document.body.classList.contains('modal-open')) exitSelection(true);
  });
}

function toggleNav(force) {
  const app = $('app');
  const open = force === undefined ? !app.classList.contains('nav-open') : force;
  app.classList.toggle('nav-open', open);
  $('scrim').hidden = !open;
  $('menuToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
}

// --- rendering -------------------------------------------------------------------------

const GRID_ROUTES = new Set(['all', 'favorites', 'purchased', 'c', 'item', 'kind']);

// Purchased items leave the Library, Favorites, Review and their collection; they
// keep their collectionId, so un-marking puts them straight back where they were.
const isActive = (i) => !i.purchased;

// keepScroll: re-render the current view in place (data changed underneath it)
// instead of treating it as a navigation, so the page stays where the user was.
function render({ keepScroll = false } = {}) {
  renderNav();
  renderSidebarCollections();
  renderToolbar();
  renderView({ keepScroll });
  updateBulkbar();
  toggleNav(false);
}

// The Lifestyle group in the menu: open or closed as you left it, and always open while you're on one of its views.
const KINDS_NAV_KEY = 'keepsake.nav.kinds';
const KIND_ROUTES = new Set(['kind']);
function setKindsOpen(open) {
  $('navKindsToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('navKindsList').hidden = !open;
  $('navKindsGroup').classList.toggle('is-open', open);
}
let kindsChoice = null;
function kindsRemembered() {
  if (kindsChoice !== null) return kindsChoice;
  try { return localStorage.getItem(KINDS_NAV_KEY) === 'open'; } catch { return false; }
}

function renderNav() {
  const r = state.route;
  document.querySelectorAll('.nav-item').forEach((a) => {
    const route = a.dataset.route;
    // Library covers both of its tabs, Saves (#all) and Collections (#collections).
    a.classList.toggle('active', route === r.name || (route === 'all' && (r.name === 'item' || r.name === 'collections')));
  });
  const live = state.items.filter(isActive);
  setCount('countAll', live.length);
  setCount('countFav', live.filter((i) => i.favorite).length);
  setCount('countPurchased', state.items.filter((i) => i.purchased).length);
  const toReview = live.filter(needsCollection).length;
  setCount('countReview', toReview);
  // Review is only in the menu while something is waiting (or while it's open).
  $('navReview').classList.toggle('hidden', !toReview && state.route.name !== 'review');
  setCount('countTrash', (state.trash || []).length);
  renderKindNav(live);
  const inKinds = KIND_ROUTES.has(r.name);
  setKindsOpen(inKinds || kindsRemembered());
  // Closed, the group says it holds the view you're on.
  $('navKindsToggle').classList.toggle('has-active', inKinds);
  setCount('countCollections', state.collections.length);
  setCount('countImport', state.scan && state.scan.posts && state.scan.status === 'done' ? state.scan.posts.length : 0);
}

// One menu entry per kind you've saved (recipes, places…), so each has its own view. Products and
// plain links live in the Library.
function renderKindNav(live) {
  const box = $('navKinds');
  if (!box) return;
  clear(box);
  // Every Lifestyle view is listed, so you can see what Keepsake can hold; empty ones are dimmed.
  let shown = 0;
  for (const k of KINDS) {
    if (k.value === 'product' || k.value === 'link') continue;
    const n = live.filter((i) => kindOf(i) === k.value).length;
    shown++;
    const active = state.route.name === 'kind' && state.route.id === k.value;
    box.append(el('a', { class: `nav-item ${active ? 'active' : ''} ${n ? '' : 'is-empty'}`, href: `#kind/${k.value}`, 'aria-current': active ? 'page' : null }, [
      kindIcon(k.value), el('span', {}, [k.plural]), el('span', { class: 'count' }, [n ? String(n) : '']),
    ]));
  }
  const empty = $('navKindsEmpty');
  if (empty) empty.hidden = shown > 0;
}

function setCount(id, n) {
  const node = $(id);
  if (node) node.textContent = n ? String(n) : '';
}

function liveCounts() {
  const counts = new Map();
  for (const i of state.items) if (isActive(i)) counts.set(i.collectionId, (counts.get(i.collectionId) || 0) + 1);
  return counts;
}

// Per collection: live item count, when something was last saved into it, and up to
// four images for a cover collage. state.items is newest first, so the first item
// seen for a collection is its latest.
function collectionStats() {
  const stats = new Map();
  for (const i of state.items) {
    if (!isActive(i) || !i.collectionId) continue;
    let s = stats.get(i.collectionId);
    if (!s) stats.set(i.collectionId, (s = { count: 0, last: i.createdAt || '', images: [] }));
    s.count += 1;
    if (i.image && s.images.length < 4 && !s.images.includes(i.image)) s.images.push(i.image);
  }
  return stats;
}

// Unpinned collections, the ones saved into most recently first; collections with
// nothing in them go last, biggest then A–Z.
function byRecentActivity(list, stats) {
  return [...list].sort((a, b) => {
    const la = stats.get(a.id)?.last || '';
    const lb = stats.get(b.id)?.last || '';
    if (la !== lb) return la < lb ? 1 : -1;
    return (stats.get(b.id)?.count || 0) - (stats.get(a.id)?.count || 0) || a.name.localeCompare(b.name);
  });
}

// How many collections the sidebar lists before "All collections" takes over.
const SIDEBAR_COLLECTIONS = 8;
// How many collection tiles Home shows.
const HOME_TILES = 5;

// The sidebar can't list hundreds of collections, so it shows every pinned one, in
// the order the user dragged them into, then fills up to SIDEBAR_COLLECTIONS with the
// ones saved into most recently. The open collection is always listed.
function sidebarOrder(stats = collectionStats()) {
  const pinned = state.collections.filter((c) => c.pinned);
  const room = Math.max(0, SIDEBAR_COLLECTIONS - pinned.length);
  const recent = byRecentActivity(state.collections.filter((c) => !c.pinned), stats).slice(0, room);
  const shown = [...pinned, ...recent];
  const open = state.route.name === 'c' ? ctx.collectionById(state.route.id) : null;
  if (open && !shown.includes(open)) shown.push(open);
  return shown;
}

// Home's tiles: pinned collections first (up to HOME_TILES), then the ones saved
// into most recently. Empty unpinned collections are left out; fewer tiles is fine.
function homeCollections(stats) {
  const pinned = state.collections.filter((c) => c.pinned).slice(0, HOME_TILES);
  const recent = byRecentActivity(state.collections.filter((c) => !c.pinned && stats.get(c.id)?.count), stats);
  return [...pinned, ...recent].slice(0, HOME_TILES);
}

function pinnedIds() {
  return state.collections.filter((c) => c.pinned).map((c) => c.id);
}

// The Collections group: open or closed as you left it (open the first time). Closed, it still lists
// pinned collections and the one you're on, so the ones you use most stay one click away.
const COLLECTIONS_NAV_KEY = 'keepsake.nav.collections';
let collectionsChoice = null;
function collectionsOpen() {
  if (collectionsChoice !== null) return collectionsChoice;
  try { return localStorage.getItem(COLLECTIONS_NAV_KEY) !== 'closed'; } catch { return true; }
}

function renderSidebarCollections() {
  const list = $('collectionList');
  const scrollTop = list.scrollTop;
  clear(list);
  const stats = collectionStats();
  const open = collectionsOpen();
  const toggle = $('collectionsToggle');
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  list.closest('.sidebar-section')?.classList.toggle('is-collapsed', !open);
  list.closest('.sidebar-section')?.classList.toggle('is-open', open);
  const help = $('collectionHelp');
  if (help) {
    help.textContent = pinnedIds().length > 1 ? 'Drag pinned ones to reorder' : 'Pin one to keep it on top';
    help.hidden = !open;
  }
  for (const c of sidebarOrder(stats)) {
    const active = state.route.name === 'c' && state.route.id === c.id;
    if (!open && !c.pinned && !active) continue;
    const cover = c.coverImage || stats.get(c.id)?.images[0] || '';
    const coverNode = el('span', { class: 'collection-cover' }, cover ? [el('img', { src: cover, alt: '', loading: 'lazy', onError: (e) => { e.target.remove(); } })] : [UI.initialFor(c.name)]);
    if (!cover) coverNode.style.background = c.color || '#8A9A88';
    const li = el('li', {
      class: `collection-item ${active ? 'active' : ''} ${c.pinned ? 'pinned' : ''}`,
      draggable: !!c.pinned,
      tabindex: '0',
      role: 'link',
      dataset: { id: c.id },
      onClick: () => navigate(`#c/${c.id}`),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`#c/${c.id}`);
        } else if (c.pinned && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          moveCollectionBy(c.id, e.key === 'ArrowUp' ? -1 : 1).then(() => {
            const again = list.querySelector(`[data-id="${c.id}"]`);
            if (again) again.focus();
          });
        }
      },
    }, [
      coverNode,
      el('span', { class: 'collection-name' }, [c.name]),
      el('button', {
        type: 'button',
        class: `collection-pin ${c.pinned ? 'is-pinned' : ''}`,
        'aria-pressed': c.pinned ? 'true' : 'false',
        'aria-label': c.pinned ? `Unpin ${c.name}` : `Pin ${c.name} to the top`,
        title: c.pinned ? 'Unpin' : 'Pin to the top',
        draggable: false,
        onClick: (e) => {
          e.stopPropagation();
          togglePin(c);
        },
        onKeydown: (e) => e.stopPropagation(),
      }, [UI.pinIcon(c.pinned)]),
      el('span', { class: 'collection-count' }, [String(stats.get(c.id)?.count || '')]),
    ]);
    if (c.pinned) bindDrag(li, list);
    list.append(li);
  }
  // Rebuilding the list resets its scroll; put it back so clicking a collection
  // further down doesn't jump the list to the top.
  list.scrollTop = scrollTop;
  markListScrolled(list);
}

// Shows a hairline under the "Collections" heading while the list is scrolled,
// and keeps the active collection in view when the list is long.
function markListScrolled(list) {
  const section = list.closest('.sidebar-section');
  if (!section) return;
  const update = () => section.classList.toggle('scrolled', list.scrollTop > 2);
  if (!list.dataset.scrollBound) {
    list.dataset.scrollBound = '1';
    list.addEventListener('scroll', update, { passive: true });
  }
  update();
  const active = list.querySelector('.collection-item.active');
  if (active && typeof active.scrollIntoView === 'function') {
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) active.scrollIntoView({ block: 'nearest' });
  }
}

let dragId = null;
function bindDrag(li, list) {
  li.addEventListener('dragstart', (e) => {
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
  });
  li.addEventListener('dragend', () => {
    dragId = null;
    li.classList.remove('dragging');
    list.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  });
  li.addEventListener('dragover', (e) => {
    if (!dragId || dragId === li.dataset.id || !li.classList.contains('pinned')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('drop-before', before);
    li.classList.toggle('drop-after', !before);
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragId || dragId === li.dataset.id || !li.classList.contains('pinned')) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const ids = pinnedIds().filter((id) => id !== dragId);
    const idx = ids.indexOf(li.dataset.id);
    ids.splice(before ? idx : idx + 1, 0, dragId);
    await store.reorderCollections(ids);
  });
}

async function moveCollectionBy(id, delta) {
  const ids = pinnedIds();
  const idx = ids.indexOf(id);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= ids.length) return;
  ids.splice(idx, 1);
  ids.splice(to, 0, id);
  await store.reorderCollections(ids);
  await reload();
  render({ keepScroll: true });
}

function renderToolbar() {
  const r = state.route;
  const controls = $('toolbarControls');
  const isGrid = GRID_ROUTES.has(r.name);
  controls.classList.toggle('hidden-controls', !isGrid);
  $('bulkbar').classList.toggle('hidden', !(isGrid && state.selecting));
  let title = 'Library';
  if (r.name === 'home') title = 'Home';
  else if (r.name === 'collections') title = 'Library';
  else if (r.name === 'favorites') title = 'Favorites';
  else if (r.name === 'purchased') title = 'Purchased';
  else if (r.name === 'trash') title = 'Trash';
  else if (r.name === 'kind') title = kindInfo(r.id).plural;
  else if (r.name === 'review') title = 'Review';
  else if (r.name === 'import') title = 'Instagram import';
  else if (r.name === 'tabsimport') title = 'Import from tabs';
  else if (r.name === 'settings') title = 'Settings';
  else if (r.name === 'privacy') title = 'Privacy';
  else if (r.name === 'ai') title = 'Optional AI';
  else if (r.name === 'ailog') title = 'AI change log';
  else if (r.name === 'welcome') title = 'Welcome';
  else if (r.name === 'c') title = ctx.collectionById(r.id)?.name || 'Collection';
  $('viewTitle').textContent = title;
  document.title = `${title} · Keepsake`;
  if (isGrid) {
    $('searchInput').value = state.search;
    // Typing in Home's search box lands here; keep the caret in the toolbar's box.
    if (state.focusSearch) {
      state.focusSearch = false;
      const input = $('searchInput');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    $('selectToggle').setAttribute('aria-pressed', state.selecting ? 'true' : 'false');
    $('selectToggle').textContent = state.selecting ? 'Done' : 'Select';
    $('bulkAi').classList.toggle('hidden', !state.settings?.ai?.on);
  }
  // Check with AI, next to the title of every page that lists saves, whenever AI is on.
  const aiHere = !!state.settings?.ai?.on && ['all', 'c', 'kind', 'favorites', 'review'].includes(r.name);
  $('aiCheck').classList.toggle('hidden', !aiHere);
  if (aiHere) $('aiCheck').title = aiCheckHint(r);
}

function aiCheckHint(r) {
  if (r.name === 'kind' && r.id === 'place') {
    return placesView() === 'review' ? 'Have your AI provider name each place waiting in Places review and say where it is'
      : 'Have your AI provider check every place: fill in a missing street, city or state (nothing you have is replaced); Lookups add the pins';
  }
  if (r.name === 'kind') return `Have your AI provider fill in what’s missing in your ${kindInfo(r.id).plural.toLowerCase()}`;
  const what = r.name === 'c' ? 'this collection' : r.name === 'favorites' ? 'your favorites' : r.name === 'review' ? 'Review' : 'your shopping saves';
  return `Have your AI provider check ${what}: tidy titles, confirm prices and file them. Every change can be undone.`;
}

// --- background checks (fill-in batches) ----------------------------------------------------------
// A batch runs in the background worker, one save at a time; its progress shows in a bar under the header
// on every page, with Stop. When it's done the bar says what changed, then goes away.
const JOB_SHOWN_MS = 15000;
const jobDismissed = new Set();
function renderJobBar() {
  const bar = $('jobbar');
  if (!bar) return;
  const job = state.localJob || state.fillJob;
  const recent = job && job.finishedAt && Date.now() - Date.parse(job.finishedAt) < JOB_SHOWN_MS;
  // A paused Run AI stays until you resume or cancel it.
  const paused = !!job?.backlog && !job.running && job.paused;
  const show = !!job && (job.running || recent || paused) && !jobDismissed.has(job.id);
  bar.classList.toggle('hidden', !show);
  clear(bar);
  if (!show) return;
  const done = Math.min(job.done, job.total);
  const pct = job.total ? Math.round((done / job.total) * 100) : 100;
  const waitSecs = job.running && job.waitingUntil ? Math.max(1, Math.round((Date.parse(job.waitingUntil) - Date.now()) / 1000)) : 0;
  const head = paused ? `Paused: ${done} of ${job.total} read`
    : job.running ? `${job.label || 'Checking with AI'}… ${done} of ${job.total}`
      : `${job.stopped ? (job.backlog ? 'Cancelled' : 'Stopped') : 'Done'}: ${done} of ${job.total} ${job.backlog ? 'read' : 'checked'}`;
  const extra = [
    waitSecs ? `your provider asked to slow down, trying again in ${waitSecs}s` : '',
    job.changed ? `${pluralize(job.changed, 'save', 'saves')} updated` : (job.running || paused ? '' : 'nothing new found'),
    job.failed ? `${job.failed} couldn’t be read (they stay waiting)` : '',
    job.ready ? `${pluralize(job.ready, 'place', 'places')} moved to your list` : '',
    paused && job.error ? job.error : '',
  ].filter(Boolean).join(' · ');
  bar.append(
    el('div', { class: 'jobbar-text' }, [el('strong', {}, [head]), extra ? el('span', { class: 'muted' }, [` · ${extra}`]) : null]),
    el('div', { class: 'progress jobbar-progress', role: 'progressbar', 'aria-label': job.label || 'Progress', 'aria-valuemin': '0', 'aria-valuemax': String(job.total), 'aria-valuenow': String(done) }, [
      el('div', { class: `progress-fill ${job.running ? 'is-running' : ''}`, style: { width: `${Math.max(job.running ? 3 : 0, pct)}%` } }),
    ]),
    job.backlog && (job.running || paused)
      ? el('div', { class: 'jobbar-actions' }, [
        job.running
          ? el('button', { type: 'button', class: 'btn btn-sm', onClick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Pausing…'; send({ type: MSG.AI_BACKLOG_PAUSE }); } }, ['Pause'])
          : el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => resumeAiRun(job) }, ['Resume']),
        el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: (e) => { e.currentTarget.disabled = true; send({ type: MSG.AI_BACKLOG_PAUSE, cancel: true }); if (!job.running) { jobDismissed.add(job.id); renderJobBar(); } } }, ['Cancel']),
      ])
      : job.running
      ? el('div', { class: 'jobbar-actions' }, [
        job.onShow ? el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => job.onShow() }, ['Show']) : null,
        el('button', { type: 'button', class: 'btn btn-sm', onClick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Stopping…'; if (job.onStop) job.onStop(); else send({ type: MSG.FILL_STOP }); } }, ['Stop']),
      ])
      : el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => { jobDismissed.add(job.id); renderJobBar(); } }, ['Dismiss']),
  );
}

// Resume a paused Run AI: the same saves it started with (or every flagged save), less the ones read since.
async function resumeAiRun(job) {
  const res = await send({ type: MSG.AI_BACKLOG_RUN, itemIds: job.scope || null, label: job.label });
  if (!res?.ok) {
    UI.toast(res?.error || 'Run AI couldn’t start.', { kind: 'danger', duration: 6000 });
    if (/Nothing here/.test(res?.error || '')) { jobDismissed.add(job.id); renderJobBar(); }
    return;
  }
  state.fillJob = res.job;
  renderJobBar();
}

// "N saves haven't been read by AI": imported saves waiting for Run AI, shown only while Optional AI is on
// and nothing is running. scope: these saves only (a collection or Lifestyle view), else all of them.
function aiBacklogNote(items, { home = false } = {}) {
  if (!state.settings?.ai?.on || state.fillJob?.running || (state.fillJob?.backlog && state.fillJob.paused)) return null;
  const waiting = aiBacklogOf(items);
  if (!waiting.length) return null;
  const text = `${pluralize(waiting.length, home ? 'imported save hasn’t' : 'save here hasn’t', home ? 'imported saves haven’t' : 'saves here haven’t')} been read by AI`;
  const run = () => confirmAiRun(ctx, home ? null : waiting.map((i) => i.id), { label: home ? 'Running AI on imported saves' : 'Running AI on these saves' });
  return el('button', { type: 'button', class: `home-attention ai-backlog-note${home ? '' : ' is-inline'}`, onClick: run }, [
    el('span', { class: 'home-attention-dot', 'aria-hidden': 'true' }),
    el('span', {}, [text]),
    el('span', { class: 'home-attention-go' }, [home ? 'Run AI →' : 'Run AI on these →']),
  ]);
}

async function startFillJob(ids, opts) {
  if (!ids.length) {
    UI.toast('Nothing to check here.');
    return;
  }
  const res = await send({ type: MSG.FILL_BATCH, itemIds: ids, ...opts });
  if (!res?.ok) {
    UI.toast(res?.error || 'The check couldn’t start.', { kind: 'danger' });
    return;
  }
  state.fillJob = res.job;
  renderJobBar();
}

// The header's Check with AI: Lifestyle views fill in what's missing (Places: names and states for the
// places in review); collections and the Library get the shopping check (titles, prices, collections).
function checkWithAI() {
  const r = state.route;
  if (r.name === 'kind') {
    const items = state.items.filter((i) => kindOf(i) === r.id);
    if (r.id === 'place') {
      if (placesView() === 'review') return fixPlaces(items);
      // From the list or the map: every place, checked for what's missing.
      return startFillJob(items.map((i) => i.id), { review: true, verify: true, kind: 'place', label: 'Checking places with AI' });
    }
    // force: a save your provider already read is read again when its card still has gaps.
    return startFillJob(items.map((i) => i.id), { label: `Checking ${kindInfo(r.id).plural.toLowerCase()} with AI`, kind: r.id, force: true });
  }
  return runAiCleanup(ctx, { scope: r.name === 'c' ? r.id : r.name === 'favorites' || r.name === 'review' ? r.name : 'all' });
}

// Places review's fix: exactly the places waiting there (the count on the tab is the batch's total).
function fixPlaces(all) {
  const ids = all.filter((i) => placeReviewReasons(i).length).map((i) => i.id);
  return startFillJob(ids, { review: true, kind: 'place', label: state.settings?.ai?.on ? 'Fixing places with AI' : 'Reading posts again' });
}

function renderView({ keepScroll = false } = {}) {
  const view = $('view');
  const prevScroll = view.scrollTop;
  clear(view);
  view.scrollTop = 0;
  const r = state.route;
  switch (r.name) {
    case 'home':
      renderHome(view);
      break;
    case 'collections':
      renderCollections(view);
      break;
    case 'settings':
      renderSettings(ctx, view);
      break;
    case 'ai':
      renderAI(ctx, view);
      break;
    case 'ailog':
      renderAiLog(ctx, view);
      break;
    case 'privacy':
      renderPrivacy(ctx, view);
      break;
    case 'import':
      renderImport(ctx, view);
      break;
    case 'tabsimport':
      renderTabsImport(ctx, view);
      break;
    case 'review':
      renderReview(view);
      break;
    case 'trash':
      renderTrash(view);
      break;
    case 'welcome':
      renderWelcome(view);
      break;
    case 'item':
      renderGrid(view);
      if (r.id && !document.body.classList.contains('modal-open')) {
        openItem(r.id).then(() => {
          if (location.hash === `#item/${r.id}`) {
            history.replaceState(null, '', '#all');
            state.route = parseHash();
            renderNav();
            renderToolbar();
          }
        });
      }
      break;
    default:
      renderGrid(view);
  }
  if (isGridRoute()) $('viewCount').textContent = pluralize(currentGridItems().length, 'item', 'items');
  else if (r.name === 'collections') $('viewCount').textContent = pluralize(state.collections.length, 'collection', 'collections');
  else $('viewCount').textContent = '';
  if (keepScroll) UI.holdScroll(view, prevScroll);
}

function isGridRoute() {
  return GRID_ROUTES.has(state.route.name);
}

// --- grid --------------------------------------------------------------------------------

function baseItems() {
  const r = state.route;
  const live = state.items.filter(isActive);
  if (r.name === 'favorites') return live.filter((i) => i.favorite);
  // Everything marked bought: a record of what was purchased.
  if (r.name === 'purchased') return state.items.filter((i) => i.purchased);
  if (r.name === 'c') return live.filter((i) => i.collectionId === r.id);
  if (r.name === 'kind') return live.filter((i) => kindOf(i) === r.id);
  return live;
}

// Saves matching the search box, best first. Remembers whether the query was corrected, for the
// "Showing results for…" line.
function searched(list) {
  const r = searchItems(list, state.search, (i) => ctx.collectionById(i.collectionId)?.name || '');
  state.searchUsed = r.corrected ? r.query : '';
  return r.results.map((x) => x.item);
}

function currentGridItems() {
  let list = baseItems();
  if (state.kinds.size && state.route.name !== 'kind') list = list.filter((i) => state.kinds.has(kindOf(i)));
  if (state.status === 'todo') list = list.filter((i) => i.status !== 'done' && !i.purchased);
  else if (state.status === 'done') list = list.filter((i) => i.status === 'done');
  else if (state.status === 'purchased') list = list.filter((i) => i.purchased);
  if (state.retailer) list = list.filter((i) => i.retailer === state.retailer);
  if (state.topic) list = list.filter((i) => (i.topics || []).includes(state.topic));
  if (state.sourceType) list = list.filter((i) => i.type === state.sourceType);
  // Search ranks (title > tags > note > collection > source > text) and forgives one typo; the
  // ranking is the order unless you picked another sort.
  const ranked = state.search ? searched(list) : null;
  if (ranked) list = ranked;
  const byPrice = (dir) => (a, b) => {
    const ap = a.price === null || a.price === undefined ? null : a.price;
    const bp = b.price === null || b.price === undefined ? null : b.price;
    if (ap === null && bp === null) return 0;
    if (ap === null) return 1;
    if (bp === null) return -1;
    return dir * (ap - bp);
  };
  if (ranked && state.sort === 'newest') return list;
  if (state.sort === 'oldest') list = [...list].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  else if (state.sort === 'az') list = [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  else if (state.sort === 'price-asc') list = [...list].sort(byPrice(1));
  else if (state.sort === 'price-desc') list = [...list].sort(byPrice(-1));
  return list;
}

function renderGrid(view) {
  const r = state.route;
  if (r.name === 'c') {
    const col = ctx.collectionById(r.id);
    if (!col) {
      view.append(UI.emptyState({ title: 'Collection not found', message: 'It may have been deleted or merged.', actions: [el('button', { type: 'button', class: 'btn', onClick: () => navigate('#all') }, ['Back to the Library'])] }));
      return;
    }
    view.append(collectionHero(col));
  }
  // The places list sorts itself (by city, then name), so the sort and retailer filters don't apply.
  if (r.name === 'all') view.append(libraryTabs('saves'));
  const listView = r.name === 'kind' && ['place', 'media', 'book'].includes(r.id);
  if (baseItems().length && !listView) view.append(filterBar());
  const chips = topicChips();
  if (chips) view.append(chips);
  if (r.name === 'c' || r.name === 'kind') {
    const note = aiBacklogNote(baseItems());
    if (note) view.append(note);
  }
  const items = currentGridItems();
  if (state.search && state.searchUsed) {
    view.append(el('p', { class: 'search-corrected', role: 'status' }, [
      'Showing results for ', el('strong', {}, [`‘${state.searchUsed}’`]), '. ',
      el('button', { type: 'button', class: 'link-btn', onClick: () => { $('searchInput').value = state.searchUsed; state.search = state.searchUsed; renderView(); } }, ['Search for that']),
    ]));
  }
  if (!items.length) {
    view.append(gridEmptyState());
    return;
  }
  if (r.name === 'kind' && r.id === 'place') {
    renderPlaces(view, items);
    return;
  }
  if (r.name === 'kind' && (r.id === 'media' || r.id === 'book')) {
    renderShelfList(view, items, r.id);
    return;
  }
  const asList = state.layout === 'list';
  const grid = el('div', { class: asList ? 'save-list' : 'grid', role: 'list' });
  const slice = items.slice(0, state.shown);
  for (const item of slice) grid.append(cardNode(item, { list: asList }));
  view.append(grid);
  if (items.length > state.shown) {
    view.append(el('div', { class: 'load-more' }, [
      el('button', { type: 'button', class: 'btn', onClick: () => { state.shown += 120; renderView(); } }, [`Show more (${items.length - state.shown} left)`]),
    ]));
  }
}

function clearFilters() {
  state.search = '';
  state.retailer = '';
  state.sourceType = '';
  state.topic = '';
  state.kinds = new Set();
  state.status = '';
}

// The filter bar over a grid: Kind (several at once), Status, Source, Site, Sort, and Grid or List.
// Filters that would offer only one choice are left out. Active ones repeat below as removable chips.
function filterBar() {
  const r = state.route;
  // While searching, the kind chips count matches: they scope the search.
  const base = state.search ? searched(baseItems()) : baseItems();
  const bar = el('div', { class: 'filter-bar', role: 'toolbar', 'aria-label': 'Filter and sort' });
  const rerender = () => { state.shown = 120; renderView(); };
  const select = (label, value, options, onChange) => {
    const sel = el('select', { class: 'select select-sm', 'aria-label': label }, options.map(([v, t]) => el('option', { value: v, text: t })));
    sel.value = options.some(([v]) => v === value) ? value : options[0][0];
    sel.addEventListener('change', () => { onChange(sel.value); rerender(); });
    return sel;
  };

  // Kind: toggle chips, only on mixed views.
  if (r.name !== 'kind') {
    const present = KINDS.map((k) => [k, base.filter((i) => kindOf(i) === k.value).length]).filter(([, n]) => n);
    for (const k of [...state.kinds]) if (!present.some(([p]) => p.value === k)) state.kinds.delete(k);
    if (present.length > 1) {
      bar.append(el('div', { class: 'kind-filters', role: 'group', 'aria-label': 'Kind' }, present.map(([k, n]) => {
        const on = state.kinds.has(k.value);
        return el('button', { type: 'button', class: `kind-filter kind-${k.value} ${on ? 'on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onClick: () => {
          on ? state.kinds.delete(k.value) : state.kinds.add(k.value);
          rerender();
        } }, [kindIcon(k.value), k.plural, el('span', { class: 'count' }, [String(n)])]);
      })));
    }
  }
  const controls = el('div', { class: 'filter-controls' });
  // Status: to do, done (each kind's own word), purchased.
  const kindsHere = new Set(base.map(kindOf));
  const doneWord = kindsHere.size === 1 ? kindInfo([...kindsHere][0]).done : 'Done';
  const statusOptions = [['', 'Any status'], ['todo', 'To do'], ['done', doneWord]];
  if (base.some((i) => i.purchased) && r.name !== 'purchased') statusOptions.push(['purchased', 'Purchased']);
  if (r.name !== 'purchased') controls.append(select('Status', state.status, statusOptions, (v) => { state.status = v; }));
  const sources = [...new Set(base.map((i) => i.type).filter(Boolean))];
  if (!sources.includes(state.sourceType)) state.sourceType = '';
  if (sources.length > 1) controls.append(select('Source', state.sourceType, [['', 'Any source'], ...sources.map((t) => [t, SOURCE_TYPE_LABELS[t] || t])], (v) => { state.sourceType = v; }));
  const sites = [...new Set(base.map((i) => i.retailer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!sites.includes(state.retailer)) state.retailer = '';
  if (sites.length > 1) controls.append(select('Site or shop', state.retailer, [['', 'Any site or shop'], ...sites.map((x) => [x, x])], (v) => { state.retailer = v; }));
  const sorts = [['newest', 'Newest'], ['oldest', 'Oldest'], ['az', 'A–Z']];
  if (base.some((i) => i.price !== null && i.price !== undefined)) sorts.push(['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low']);
  if (!sorts.some(([v]) => v === state.sort)) state.sort = 'newest';
  controls.append(select('Sort', state.sort, sorts, (v) => { state.sort = v; }));
  const layoutBtn = (value, label, path) => el('button', { type: 'button', class: `seg ${state.layout === value ? 'on' : ''}`, 'aria-pressed': state.layout === value ? 'true' : 'false', 'aria-label': label, title: label, onClick: () => {
    state.layout = value;
    try { localStorage.setItem('keepsake.layout', value); } catch { /* this page only */ }
    renderView({ keepScroll: true });
  } }, [svgIcon(path)]);
  controls.append(el('div', { class: 'segmented', role: 'group', 'aria-label': 'Layout' }, [
    layoutBtn('grid', 'Grid', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
    layoutBtn('list', 'List', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'),
  ]));
  bar.append(controls);

  // What's on, as chips you can remove one by one.
  const active = [];
  for (const k of state.kinds) active.push([kindInfo(k).plural, () => state.kinds.delete(k)]);
  if (state.status) active.push([statusOptions.find(([v]) => v === state.status)?.[1] || state.status, () => { state.status = ''; }]);
  if (state.sourceType) active.push([SOURCE_TYPE_LABELS[state.sourceType] || state.sourceType, () => { state.sourceType = ''; }]);
  if (state.retailer) active.push([state.retailer, () => { state.retailer = ''; }]);
  if (state.topic) active.push([`Tag: ${state.topic}`, () => { state.topic = ''; }]);
  if (active.length) {
    bar.append(el('div', { class: 'active-filters', 'aria-label': 'Active filters' }, [
      ...active.map(([label, off]) => el('button', { type: 'button', class: 'active-filter', 'aria-label': `Remove filter: ${label}`, onClick: () => { off(); rerender(); } }, [label, el('span', { 'aria-hidden': 'true' }, ['×'])])),
      el('button', { type: 'button', class: 'btn btn-quiet btn-sm', onClick: () => { const q = state.search; clearFilters(); state.search = q; rerender(); } }, ['Clear all']),
    ]));
  }
  return bar;
}

function svgIcon(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

// Tags in this view, most used first, as filter chips ("All", "AI 4", "Video games 3"…).
function topicChips() {
  const counts = new Map();
  for (const i of state.search ? searched(baseItems()) : baseItems()) for (const t of i.topics || []) counts.set(t, (counts.get(t) || 0) + 1);
  if (!counts.size) {
    state.topic = '';
    return null;
  }
  if (state.topic && !counts.has(state.topic)) state.topic = '';
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16);
  const chip = (value, label, n) => el('button', { type: 'button', class: `topic-chip ${state.topic === value ? 'on' : ''}`, 'aria-pressed': state.topic === value ? 'true' : 'false', onClick: () => {
    state.topic = state.topic === value ? '' : value;
    renderView();
  } }, [label, n ? el('span', { class: 'count' }, [String(n)]) : null]);
  return el('div', { class: 'topic-chips', role: 'group', 'aria-label': 'Filter by tag' }, [chip('', 'All tags'), ...sorted.map(([t, n]) => chip(t, t, n))]);
}

function gridEmptyState() {
  const r = state.route;
  if (state.search || state.retailer || state.sourceType || state.topic || state.kinds.size || state.status) {
    const filtered = state.retailer || state.sourceType || state.topic || state.kinds.size || state.status;
    return UI.emptyState({
      title: 'No matches',
      message: state.search
        ? `No saves match ‘${state.search}’. ${filtered ? 'Some filters are on: clear them to search everything.' : 'Check the spelling or search all kinds.'}`
        : 'Nothing here matches these filters.',
      actions: [el('button', { type: 'button', class: 'btn', onClick: () => { clearFilters(); $('searchInput').value = ''; renderToolbar(); renderView(); } }, ['Clear search and filters'])],
      icon: UI.folderIcon(),
    });
  }
  if (r.name === 'kind') {
    const copy = {
      place: 'Save a restaurant or place and it shows up here with its address.',
      recipe: 'Save a recipe or a dish you’d like to cook. Keepsake pulls out the ingredients.',
      workout: 'Save a workout and turn it into a goal.',
      media: 'Save a film, show or book you want to get to.',
      book: 'Save a film, show or book you want to get to.',
      video: 'Save a video to watch later. Anything from YouTube lands here.',
      article: 'Save an article to read later, with its reading time.',
    }[r.id];
    if (copy) return UI.emptyState({ title: kindInfo(r.id).plural, message: copy, icon: kindIcon(r.id) });
  }
  if (r.name === 'favorites') return UI.emptyState({ title: 'No favorites yet', message: 'Tap the star on any card to keep it close.', icon: UI.starIcon(true) });
  if (r.name === 'purchased') return UI.emptyState({ title: 'Nothing purchased yet', message: 'Mark something as purchased from its ⋯ menu or its details, and it’s kept here.', icon: UI.bagIcon() });
  if (r.name === 'c') return UI.emptyState({ title: 'This collection is empty', message: 'Save something from a product page and Keepsake will file it here when it fits.', icon: UI.folderIcon() });
  return nothingSavedState();
}

function nothingSavedState() {
  return UI.emptyState({
    title: 'Nothing saved yet',
    message: 'Nothing saved yet. Save a page with the Keepsake button or Alt+Shift+K, or try the sample library. Everything you keep stays in this browser.',
    icon: UI.bagIcon(),
    actions: [
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => loadSample() }, ['Load sample data']),
      el('button', { type: 'button', class: 'btn', onClick: () => navigate('#settings') }, ['Turn on on-page buttons']),
    ],
  });
}

async function loadSample() {
  const n = await store.loadSampleData();
  UI.toast(`Added ${pluralize(n, 'sample item', 'sample items')}. Delete them any time.`);
}

// A save card: picture (or a tile tinted for its kind), then kind · source, title, the kind's key fact,
// note, tags and state. One button opens it; the star and the menu are separate buttons.
function cardNode(item, { list = false } = {}) {
  const col = ctx.collectionById(item.collectionId);
  const selected = state.selected.has(item.id);
  const kind = kindOf(item);
  const info = kindInfo(kind);
  const price = formatPrice(item.price, item.currency);
  const fact = kind === 'product' ? price || '' : keyFact(item);
  const creator = item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : '';
  const source = creator || item.retailer || item.host || '';
  const done = item.status === 'done';
  const muted = done || item.purchased;
  const card = el('article', { class: `card ${list ? 'card-row' : ''} ${selected ? 'selected' : ''} ${muted ? 'is-done' : ''} ${state.selecting ? 'selecting' : ''}`, role: 'listitem', 'aria-label': item.title });
  if (state.selecting) {
    const cb = el('input', { type: 'checkbox', class: 'card-check', 'aria-label': `Select ${item.title}` });
    cb.checked = selected;
    cb.addEventListener('change', () => {
      cb.checked ? state.selected.add(item.id) : state.selected.delete(item.id);
      card.classList.toggle('selected', cb.checked);
      updateBulkbar();
    });
    card.append(cb);
  }
  const states = [
    needsCollection(item) && isActive(item) ? el('span', { class: 'state-pill' }, ['Needs a collection']) : null,
    item.captureState === 'pending' ? el('span', { class: 'state-pill state-quiet' }, ['Finishing details…']) : null,
    item.captureState === 'failed' ? el('span', { class: 'state-pill state-warn' }, ['Couldn’t read details']) : null,
    done ? el('span', { class: 'state-pill state-done' }, [UI.checkIcon(), info.done]) : null,
    item.purchased && kind === 'product' ? el('span', { class: 'state-pill state-done' }, [UI.checkIcon(), 'Purchased']) : null,
  ].filter(Boolean);
  const hit = el('button', { type: 'button', class: 'card-hit', 'aria-label': [item.title, info.label, fact, source].filter(Boolean).join(', '), onClick: () => {
    if (state.selecting) {
      const cb = card.querySelector('.card-check');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
      return;
    }
    openSave(item.id);
  } }, [
    UI.pictureNode({ src: item.image, aspect: list ? 1 : item.imageAspect, title: item.title, tint: kind, icon: kindIcon(kind) }),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'card-kindrow' }, [
        kind !== 'product' ? el('span', { class: `kind-chip kind-${kind}` }, [kindIcon(kind), info.label]) : null,
        creator ? el('span', { class: 'card-source' }, [UI.instagramIcon(), creator]) : source ? el('span', { class: 'card-source', title: item.url || '' }, [source]) : null,
      ]),
      el('div', { class: 'card-title' }, [item.title]),
      fact ? el('div', { class: `card-fact ${kind === 'product' ? 'card-price' : ''}` }, [fact]) : null,
      item.note ? el('div', { class: 'card-note' }, [`“${item.note}”`]) : null,
      item.topics?.length ? el('div', { class: 'card-topics' }, item.topics.slice(0, 3).map((t) => el('span', { class: 'topic-pill' }, [t]))) : null,
      states.length || (state.route.name !== 'c' && col) ? el('div', { class: 'card-states' }, [
        ...states,
        state.route.name !== 'c' && col ? el('span', { class: 'card-col' }, [col.name]) : null,
      ]) : null,
    ]),
  ]);
  const favBtn = el('button', { type: 'button', class: `btn btn-icon ${item.favorite ? 'is-on' : ''}`, 'aria-label': item.favorite ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': item.favorite ? 'true' : 'false', onClick: async (e) => {
    e.stopPropagation();
    await store.updateItem(item.id, { favorite: !item.favorite });
  } }, [UI.starIcon(item.favorite)]);
  const moreBtn = el('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'More actions', 'aria-haspopup': 'menu', onClick: (e) => {
    e.stopPropagation();
    openMenu(moreBtn, itemMenu(item));
  } }, [UI.moreIcon()]);
  const actions = el('div', { class: 'card-actions' }, state.selecting ? [] : [favBtn, moreBtn]);
  card.append(hit, actions);
  return el('div', { class: 'grid-item' }, [card]);
}

function itemMenu(item) {
  const entries = [
    { label: 'Edit details', icon: UI.pencilIcon(), onClick: () => openItem(item.id) },
    { label: 'Move to…', icon: UI.folderIcon(), onClick: () => moveDialog([item]) },
    { label: item.favorite ? 'Remove favorite' : 'Favorite', icon: UI.starIcon(item.favorite), onClick: () => store.updateItem(item.id, { favorite: !item.favorite }) },
    { label: item.purchased ? 'Mark as not purchased' : 'Mark as purchased', icon: UI.checkIcon(), onClick: () => store.updateItem(item.id, { purchased: !item.purchased }) },
  ];
  if (item.url) entries.push({ label: item.type === 'instagram' ? 'Open on Instagram' : 'Visit page', icon: UI.externalIcon(), onClick: () => window.open(openableUrl(item.url), '_blank', 'noopener') });
  for (let n = entries.length - 1; n >= 0; n--) if (!entries[n]) entries.splice(n, 1);
  entries.push({ sep: true });
  entries.push({ label: 'Delete', icon: UI.trashIcon(), danger: true, onClick: () => deleteItems([item]) });
  return entries;
}

// A small floating menu anchored to a button.
let activeMenu = null;
function openMenu(anchor, entries) {
  closeMenu();
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const e of entries) {
    if (e.sep) {
      menu.append(el('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    menu.append(el('button', { type: 'button', role: 'menuitem', class: `menu-item ${e.danger ? 'danger' : ''}`, onClick: () => {
      closeMenu();
      e.onClick();
    } }, [e.icon || null, e.label]));
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 200;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  const onDoc = (ev) => {
    if (!menu.contains(ev.target)) closeMenu();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      closeMenu();
      anchor.focus();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const items = [...menu.querySelectorAll('.menu-item')];
      const idx = items.indexOf(document.activeElement);
      const next = ev.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next].focus();
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
  }, 0);
  activeMenu = { menu, cleanup: () => {
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onKey);
  } };
  const first = menu.querySelector('.menu-item');
  if (first) first.focus();
}

function closeMenu() {
  if (!activeMenu) return;
  activeMenu.cleanup();
  activeMenu.menu.remove();
  activeMenu = null;
}

// --- selection & bulk actions ----------------------------------------------------------------

function enterSelection() {
  state.selecting = true;
  state.selected.clear();
  renderToolbar();
  renderView();
  updateBulkbar();
}

function exitSelection(rerender) {
  state.selecting = false;
  state.selected.clear();
  if (rerender) {
    renderToolbar();
    renderView();
  }
  updateBulkbar();
}

function updateBulkbar() {
  const n = state.selected.size;
  $('bulkCount').textContent = `${n} selected`;
  for (const id of ['bulkMove', 'bulkFav', 'bulkDelete', 'bulkAi']) $(id).disabled = n === 0;
  const visible = currentGridItems();
  $('bulkAll').textContent = visible.length && visible.every((i) => state.selected.has(i.id)) ? 'Select none' : 'Select all';
  $('bulkbar').classList.toggle('hidden', !(isGridRoute() && state.selecting));
}

function selectedItems() {
  return state.items.filter((i) => state.selected.has(i.id));
}

async function bulkPatch(patchFor) {
  const items = selectedItems();
  if (!items.length) return;
  const patch = patchFor(items);
  for (const it of items) await store.updateItem(it.id, patch);
  UI.toast(`Updated ${pluralize(items.length, 'item', 'items')}.`);
  exitSelection(true);
}

async function bulkMove() {
  const items = selectedItems();
  if (!items.length) return;
  const moved = await moveDialog(items);
  if (moved) exitSelection(true);
}

async function bulkDelete() {
  const items = selectedItems();
  if (!items.length) return;
  const ok = await deleteItems(items);
  if (ok) exitSelection(true);
}

async function bulkAi() {
  const items = selectedItems();
  if (!items.length) return;
  await analyzeItems(ctx, items);
  exitSelection(true);
}

// Items created from a post (or the post an item came from) are shown together.
function relatedNode(item) {
  const related = item.relatedItemId ? state.items.find((i) => i.id === item.relatedItemId) : null;
  const children = state.items.filter((i) => i.relatedItemId === item.id);
  if (!related && !children.length) return null;
  return el('div', { class: 'category-box' }, [
    related ? el('div', {}, ['From the Instagram post ', el('button', { type: 'button', class: 'btn btn-link', onClick: () => openItem(related.id) }, [cut(related.title, 50)])]) : null,
    children.length ? el('div', {}, [`${pluralize(children.length, 'product', 'products')} saved from this post: `, ...children.map((c) => el('button', { type: 'button', class: 'btn btn-link', onClick: () => openItem(c.id) }, [cut(c.title, 40)]))]) : null,
  ]);
}

// Move one or more items with a collection picker. Resolves true when moved.
async function moveDialog(items) {
  const options = [...lifestyleOptions(), ...ctx.regularCollections().map((c) => ({ value: c.id, label: c.name, group: 'Collections' })), { value: '__new', label: '＋ New collection…', group: 'Collections' }];
  const one = items.length === 1 ? items[0] : null;
  const current = one ? one.collectionId || (hasOwnView(kindOf(one)) ? `kind:${kindOf(one)}` : '') : '';
  const select = UI.selectInput({ value: current || options[0].value, options, onChange: (v) => { newRow.classList.toggle('hidden', v !== '__new'); if (v === '__new') newInput.focus(); }, label: 'Collection' });
  const newInput = el('input', { class: 'input', placeholder: 'New collection name', maxlength: '80', 'aria-label': 'New collection name' });
  const newRow = el('div', { class: 'field hidden' }, [newInput]);
  const learnCheck = el('input', { type: 'checkbox' });
  learnCheck.checked = false;
  // From a collection page, the whole collection can go instead: a merge.
  const source = state.route.name === 'c' ? ctx.collectionById(state.route.id) : null;
  const mergeCheck = el('input', { type: 'checkbox' });
  const body = [
    el('p', { class: 'modal-text' }, [items.length === 1 ? `Move “${cut(items[0].title, 70)}” to:` : `Move ${pluralize(items.length, 'item', 'items')} to:`]),
    select,
    newRow,
    el('label', { class: 'check' }, [learnCheck, el('span', {}, ['Use this choice for similar items in the future'])]),
    el('p', { class: 'help' }, ['Keepsake always learns a little from moves. Ticking this makes the lesson stronger.']),
    source ? el('label', { class: 'check' }, [mergeCheck, el('span', {}, [`Merge: move everything in “${source.name}” and remove “${source.name}”. Its name becomes an alias of the new collection.`])]) : null,
  ];
  const result = await UI.openModal({
    title: 'Move to',
    body,
    actions: [
      { label: 'Cancel', quiet: true, value: false },
      { label: 'Move', primary: true, onClick: async (close) => {
        let target = select.value;
        if (target === '__new') {
          const name = sanitizeText(newInput.value, 80);
          if (!name) {
            newInput.focus();
            throw new Error('Give the new collection a name.');
          }
          const collection = await createNamedCollection(name);
          if (!collection) return false;
          target = collection.id;
        }
        if (source && mergeCheck.checked) {
          if (target === source.id) throw new Error(`Pick a collection other than “${source.name}” to merge into.`);
          const merged = await store.mergeCollections(source.id, target);
          UI.toast(`Merged into ${merged.name}.`);
          close(true);
          navigate(`#c/${merged.id}`);
          return false;
        }
        await putItems(items, target, { learn: learnCheck.checked ? 'strong' : 'light' });
        close(true);
        return false;
      } },
    ],
  });
  return result === true;
}

// Deleting moves saves to the Trash (kept 30 days), so it needs no confirmation: Undo is right there.
async function deleteItems(items) {
  const ids = items.map((i) => i.id);
  await store.deleteItems(ids);
  UI.toast(items.length === 1 ? 'Moved to Trash.' : `Moved ${pluralize(items.length, 'item', 'items')} to Trash.`, {
    duration: 8000,
    action: { label: 'Undo', onClick: () => store.restoreItems(ids) },
  });
  return true;
}

function renderTrash(view) {
  const trash = state.trash || [];
  const page = el('div', { class: 'page' });
  const intro = el('p', { class: 'help' }, [`Deleted saves stay here for ${TRASH_DAYS} days, then they're removed for good. Restoring puts a save back in its collection (or in Review if that collection is gone).`]);
  page.append(intro);
  if (!trash.length) {
    page.append(UI.emptyState({ title: 'Nothing in Trash', message: `Deleted saves stay here for ${TRASH_DAYS} days.`, icon: UI.trashIcon() }));
    view.append(page);
    return;
  }
  page.append(el('div', { class: 'review-actions' }, [
    el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => {
      await store.restoreItems(trash.map((i) => i.id));
      UI.toast(`Restored ${pluralize(trash.length, 'item', 'items')}.`);
    } }, ['Restore all']),
    el('button', { type: 'button', class: 'btn btn-sm btn-danger', onClick: async () => {
      const ok = await UI.confirmDialog({ title: 'Empty the Trash?', message: `${pluralize(trash.length, 'item', 'items')} will be deleted for good. This can’t be undone.`, confirmLabel: 'Delete forever', danger: true });
      if (!ok) return;
      await store.deleteForever(trash.map((i) => i.id));
      UI.toast('Trash emptied.');
    } }, ['Empty Trash']),
  ]));
  const list = el('div', { class: 'review-list', role: 'list' });
  for (const item of trash) {
    const days = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - Date.parse(item.deletedAt)) / 864e5));
    list.append(el('div', { class: 'review-row', role: 'listitem' }, [
      UI.pictureNode({ src: item.image, title: item.title, className: 'review-pic' }),
      el('div', {}, [
        el('div', { class: 'review-title' }, [item.title]),
        el('div', { class: 'review-reason' }, [[item.retailer || item.host, `deleted ${formatDate(item.deletedAt)}`, `removed for good in ${pluralize(days, 'day', 'days')}`].filter(Boolean).join(' · ')]),
        el('div', { class: 'review-actions' }, [
          el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: async () => {
            await store.restoreItems([item.id]);
            UI.toast('Restored.');
          } }, ['Restore']),
          el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: async () => {
            const ok = await UI.confirmDialog({ title: 'Delete forever?', message: `“${cut(item.title, 80)}” will be removed for good. This can’t be undone.`, confirmLabel: 'Delete forever', danger: true });
            if (ok) await store.deleteForever([item.id]);
          } }, ['Delete forever']),
        ]),
      ]),
    ]));
  }
  page.append(list);
  view.append(page);
}

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// --- item detail ---------------------------------------------------------------------------------

// A lightweight look at an item — image, title, price, and a link out. The
// full editor (title/price/note/collection/etc.) is one click away via
// "Edit details", both here and in each card's overflow menu.
// Opening a save shows it the way its kind is used: a recipe opens straight into the recipe.
async function openSave(id) {
  const item = state.items.find((i) => i.id === id) || (await store.getItem(id));
  if (item) store.markOpened(id).catch(() => {});
  if (item && kindOf(item) === 'recipe') return openRecipe(id);
  if (item && kindOf(item) === 'workout') return openWorkout(id);
  if (item && kindOf(item) === 'place') return openPlace(id);
  if (item && ['video', 'article'].includes(kindOf(item))) return openMedia(id);
  if (item && ['media', 'book'].includes(kindOf(item))) return openShelfItem(id);
  return openQuickView(id);
}

// A video or article to get to later: what it is, how long it takes, and a way to it. Nothing is embedded
// or played here, so nothing loads from the video site until you open it.
async function openMedia(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const kind = kindOf(item);
  const d = item.details || {};
  const isVideo = kind === 'video';
  const date = d.publishedOn ? new Date(`${d.publishedOn}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const facts = isVideo
    ? [d.channel ? ['Channel', d.channel] : null, d.platform ? ['On', d.platform] : null, d.durationSeconds ? ['Length', formatDuration(d.durationSeconds)] : null, date ? ['Published', date] : null]
    : [d.author ? ['By', d.author] : null, d.siteName || item.retailer ? ['Site', d.siteName || item.retailer] : null, d.readingMinutes ? ['Reading time', `${d.readingMinutes} min${d.wordCount ? ` · ${d.wordCount.toLocaleString()} words` : ''}`] : null, date ? ['Published', date] : null];
  const summary = item.description || (item.type === 'instagram' ? item.instagram?.caption : '') || '';
  const done = item.status === 'done';
  const verb = kindInfo(kind).done;
  const body = el('div', { class: 'recipe-view media-view' }, [
    el('div', { class: `recipe-hero ${item.image ? '' : 'no-pic'}` }, [
      item.image ? el('div', { class: 'media-pic-wrap' }, [
        UI.pictureNode({ src: item.image, aspect: item.imageAspect || (isVideo ? 16 / 9 : 1.5), title: item.title, className: 'recipe-hero-pic media-pic' }),
        isVideo && d.durationSeconds ? el('span', { class: 'media-duration' }, [formatDuration(d.durationSeconds)]) : null,
      ]) : null,
      el('div', { class: 'recipe-hero-text' }, [
        el('span', { class: `badge kind-badge kind-${kind}` }, [kindIcon(kind), kindInfo(kind).label]),
        el('h2', { class: 'recipe-title' }, [item.title]),
        facts.filter(Boolean).length ? el('dl', { class: 'recipe-facts-grid' }, facts.filter(Boolean).flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
        item.topics?.length ? el('div', { class: 'card-topics media-topics' }, [
          ...item.topics.map((t) => el('span', { class: 'topic-pill' }, [t])),
          item.topicsBy === 'guess' ? el('span', { class: 'help' }, ['Guessed from the title. Change them in Edit details.']) : null,
        ]) : null,
        summary ? el('p', { class: 'media-summary' }, [cut(summary, 600)]) : null,
        item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
        done ? el('span', { class: 'badge' }, [verb]) : null,
      ]),
    ]),
  ]);
  await UI.openModal({
    title: item.title,
    body,
    wide: true,
    className: 'modal-recipe modal-media',
    actions: [
      { label: 'Edit details', quiet: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      { label: done ? `${verb} ✓` : `Mark ${verb.toLowerCase()}`, onClick: async () => {
        await store.updateItem(item.id, { status: done ? 'saved' : 'done' });
        UI.toast(done ? `Marked as not ${verb.toLowerCase()} yet.` : `Marked as ${verb.toLowerCase()}.`, { duration: 2200 });
      } },
      item.url ? { label: isVideo ? `Watch${d.platform ? ` on ${d.platform}` : ''}` : item.type === 'instagram' ? 'Open post' : 'Read', href: openableUrl(item.url), primary: true, autofocus: true, icon: UI.externalIcon() } : null,
    ].filter(Boolean),
  });
}

// "Details from Wikidata ↗": where looked-up details came from, linked.
function lookupLink(d) {
  const l = d.lookup;
  if (!l || !l.source) return null;
  if (l.source === 'AI') return el('span', { class: 'lookup-src' }, [' · Named by your AI provider']);
  return el('span', { class: 'lookup-src' }, [' · Details from ', l.url ? el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, [l.source, ' ↗']) : l.source,
    l.approximate ? ' · the pin is on the street, not at the door' : '']);
}

// A film, show or book: the poster or cover, the few facts, and a way to it.
function shelfFacts(item) {
  const d = item.details || {};
  if (kindOf(item) === 'book') {
    return [d.author ? ['By', d.author] : null, d.year ? ['Published', String(d.year)] : null, d.pages ? ['Pages', String(d.pages)] : null, d.genres?.length ? ['Genre', d.genres.join(', ')] : null, d.isbn ? ['ISBN', d.isbn] : null];
  }
  const series = d.format === 'series';
  return [
    ['Format', series ? 'TV series' : 'Film'],
    d.year ? [series ? 'First aired' : 'Year', String(d.year)] : null,
    d.director ? [series ? 'Created by' : 'Directed by', d.director] : null,
    !series && d.runtimeMinutes ? ['Runtime', formatMinutes(d.runtimeMinutes)] : null,
    series && d.seasons ? ['Seasons', String(d.seasons)] : null,
    d.genres?.length ? ['Genre', d.genres.join(', ')] : null,
  ];
}

async function openShelfItem(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const kind = kindOf(item);
  const verb = kindInfo(kind).done;
  const done = item.status === 'done';
  const facts = shelfFacts(item).filter(Boolean);
  const site = item.retailer || item.host || '';
  const body = el('div', { class: `shelf-view ${item.image ? '' : 'no-pic'}` }, [
    item.image ? UI.pictureNode({ src: item.image, aspect: 2 / 3, title: item.title, className: 'shelf-cover' }) : null,
    el('div', { class: 'recipe-hero-text' }, [
      el('span', { class: `badge kind-badge kind-${kind}` }, [kindIcon(kind), kindInfo(kind).label]),
      el('h2', { class: 'recipe-title' }, [item.title]),
      facts.length ? el('dl', { class: 'recipe-facts-grid' }, facts.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
      lookupLink(item.details || {}),
      item.description ? el('p', { class: 'media-summary' }, [cut(item.description, 600)]) : null,
      item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
      done ? el('span', { class: 'badge' }, [verb]) : null,
    ]),
  ]);
  await UI.openModal({
    title: item.title,
    body,
    wide: true,
    className: 'modal-recipe modal-shelf',
    actions: [
      { label: 'Edit details', quiet: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      item.url ? { label: site ? `Open on ${site}` : 'Open', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      { label: done ? `${verb} ✓` : `Mark ${verb.toLowerCase()}`, primary: !done, autofocus: true, onClick: async () => {
        await store.updateItem(item.id, { status: done ? 'saved' : 'done' });
        UI.toast(done ? `Marked as not ${verb.toLowerCase()} yet.` : `Marked as ${verb.toLowerCase()}.`, { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}

// Films & shows and Books: a plain list to scroll. What's still to watch or read comes first; the
// rest sits under "Watched" or "Read". Ticking the box moves it.
function renderShelfList(view, items, kind) {
  const verb = kindInfo(kind).done;
  const row = (item) => {
    const d = item.details || {};
    const done = item.status === 'done';
    const box = el('input', { type: 'checkbox', 'aria-label': `${verb}: ${item.title}`, onChange: async () => { await store.updateItem(item.id, { status: box.checked ? 'done' : 'saved' }); } });
    box.checked = done;
    return el('li', { class: `shelf-row ${done ? 'is-done' : ''}` }, [
      el('button', { type: 'button', class: 'shelf-row-hit', onClick: () => openSave(item.id) }, [
        UI.pictureNode({ src: item.image, aspect: 2 / 3, title: item.title, className: 'shelf-thumb' }),
        el('span', { class: 'place-row-text' }, [
          el('span', { class: 'place-row-title' }, [item.title]),
          el('span', { class: 'place-row-meta' }, [keyFact(item) || item.retailer || item.host || '']),
          d.genres?.length ? el('span', { class: 'place-row-meta' }, [d.genres.join(', ')]) : null,
        ]),
      ]),
      el('label', { class: 'check shelf-check' }, [box, el('span', {}, [verb])]),
    ]);
  };
  const todo = items.filter((i) => i.status !== 'done');
  const finished = items.filter((i) => i.status === 'done');
  const box = el('div', { class: 'place-list shelf-list' });
  const section = (title, list) => el('section', { class: 'place-group', 'aria-label': title }, [
    el('h2', { class: 'place-city' }, [title, el('span', { class: 'count' }, [String(list.length)])]),
    el('ul', { class: 'place-rows', role: 'list' }, list.map(row)),
  ]);
  if (todo.length) box.append(section(kind === 'book' ? 'To read' : 'To watch', todo));
  if (finished.length) box.append(section(verb, finished));
  view.append(box);
}

// "Open in Maps": Apple Maps or Google Maps, in a new tab. The links are built from what's saved; Keepsake
// looks nothing up itself, and the maps site only hears about the place when you click.
function mapsMenuButton(item, { small = false, primary = false } = {}) {
  const links = mapsLinks(item.title, item.details || {});
  if (!links) return null;
  const btn = el('button', { type: 'button', class: `btn ${small ? 'btn-sm' : ''} ${primary ? 'btn-primary' : ''}`, 'aria-haspopup': 'menu', onClick: (e) => {
    e.stopPropagation();
    openMenu(btn, [
      { label: 'Apple Maps', icon: UI.externalIcon(), onClick: () => window.open(links.apple, '_blank', 'noopener') },
      { label: 'Google Maps', icon: UI.externalIcon(), onClick: () => window.open(links.google, '_blank', 'noopener') },
    ]);
  } }, [kindIcon('place'), 'Open in Maps']);
  return btn;
}

// The place view: where it is, when it's open, and a way there.
async function openPlace(id) {
  const item = await store.getItem(id);
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
        el('p', { class: 'recipe-from' }, [[from, sourceLabel].filter(Boolean).join(' · '), lookupLink(d)]),
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
      { label: 'Edit details', quiet: true, autofocus: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      maps ? { label: 'Apple Maps', href: maps.apple, icon: UI.externalIcon() } : null,
      maps ? { label: 'Google Maps', href: maps.google, icon: UI.externalIcon() } : null,
      { label: been ? 'Been ✓' : 'Mark been', primary: !been, onClick: async () => {
        await store.updateItem(item.id, { status: been ? 'saved' : 'done' });
        UI.toast(been ? 'Marked as not been yet.' : 'Marked as been.', { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}

// Places as a list grouped by city, each with Open in Maps (Chrome has no map: no third-party map tiles).
// Places: a list grouped by city, or a map of the ones with a pin. The map is OpenStreetMap data drawn
// by MapLibre (bundled in Keepsake), with tiles from OpenFreeMap; it loads only once Places lookups are on.
const PLACES_VIEW_KEY = 'keepsake.places.view';
let placesViewChoice = null;
function placesView() {
  if (placesViewChoice) return placesViewChoice;
  try { const v = localStorage.getItem(PLACES_VIEW_KEY); return v === 'map' || v === 'review' ? v : 'list'; } catch { return 'list'; }
}

// Places: the list (by state, then city) and the map show places that are ready: named, with a state.
// The rest wait in Places review, where your AI provider (or you) can name them and say where they are.
function renderPlaces(view, items) {
  const review = items.filter((i) => placeReviewReasons(i).length);
  const ready = items.filter((i) => !placeReviewReasons(i).length);
  const current = placesView();
  const seg = (value, label) => el('button', { type: 'button', class: `library-tab ${current === value ? 'on' : ''}`, role: 'tab', 'aria-selected': current === value ? 'true' : 'false', onClick: () => {
    placesViewChoice = value;
    try { localStorage.setItem(PLACES_VIEW_KEY, value); } catch { /* this page only */ }
    renderView({ keepScroll: true });
    renderToolbar();
  } }, [label]);
  view.append(el('div', { class: 'library-tabs', role: 'tablist', 'aria-label': 'Places view' }, [seg('list', 'List'), seg('map', 'Map'), seg('review', review.length ? `Places review · ${review.length}` : 'Places review')]));
  if (current === 'map') renderPlacesMap(view, ready);
  else if (current === 'review') renderPlacesReview(view, review, items);
  else renderPlaceList(view, ready, review.length);
}

// One row of a place list: its picture, name, what it is and where, and Open in Maps.
function placeRow(item, meta) {
  const d = item.details || {};
  return el('li', { class: `place-row ${item.status === 'done' ? 'is-done' : ''}` }, [
    el('button', { type: 'button', class: 'place-row-hit', onClick: () => openSave(item.id) }, [
      UI.pictureNode({ src: item.image, aspect: 1, title: item.title, className: 'place-thumb' }),
      el('span', { class: 'place-row-text' }, [
        el('span', { class: 'place-row-title' }, [item.title]),
        el('span', { class: 'place-row-meta' }, [meta ?? ([d.cuisine || d.category, d.priceRange, d.address].filter(Boolean).join(' · ') || item.retailer || item.host || '')]),
      ]),
    ]),
    item.status === 'done' ? el('span', { class: 'badge' }, ['Been']) : null,
    mapsMenuButton(item, { small: true }),
  ]);
}

function renderPlacesReview(view, items, all = items) {
  const box = el('div', { class: 'place-list' });
  if (!items.length) {
    box.append(UI.emptyState({ title: 'Nothing to review', message: 'Every place has a name and a state, so they’re all on your list.' }));
    view.append(box);
    return;
  }
  const aiOn = !!state.settings?.ai?.on;
  const fixAll = () => fixPlaces(all);
  const running = !!state.fillJob?.running;
  box.append(el('div', { class: 'place-review-bar' }, [
    el('div', { class: 'grow' }, [
      el('p', {}, [`${pluralize(items.length, 'place needs', 'places need')} a name or a state before ${items.length === 1 ? 'it goes' : 'they go'} on your list.`]),
      el('p', { class: 'help' }, [aiOn
        ? 'Fix with AI sends each one’s title, caption and location tag to your AI provider, which names the place and says where it is; Lookups then add the address and pin. A post about several places (a top-10 list) stays here: open it to move it or delete it.'
        : 'Read again checks each of these posts’ captions with Keepsake’s latest rules, on your device. To have places named from their posts, turn on Optional AI in Settings. Or open one and fill in its name and address.']),
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

let maplibreLoading = null;
function loadMapLibre() {
  if (globalThis.maplibregl) return Promise.resolve(globalThis.maplibregl);
  if (!maplibreLoading) {
    maplibreLoading = new Promise((resolve, reject) => {
      const css = el('link', { rel: 'stylesheet', href: '../../vendor/maplibre/maplibre-gl.css' });
      document.head.append(css);
      const s = el('script', { src: '../../vendor/maplibre/maplibre-gl-csp.js' });
      s.onload = () => {
        globalThis.maplibregl.setWorkerUrl(chrome.runtime.getURL('vendor/maplibre/maplibre-gl-csp-worker.js'));
        resolve(globalThis.maplibregl);
      };
      s.onerror = () => { maplibreLoading = null; reject(new Error('The map didn’t load.')); };
      document.head.append(s);
    });
  }
  return maplibreLoading;
}

async function mapAllowed() {
  if (!state.settings?.lookups?.places) return false;
  try { return await chrome.permissions.contains({ origins: LOOKUP_SOURCES.places.origins }); } catch { return false; }
}

function renderPlacesMap(view, items) {
  const box = el('div', { class: 'places-map-wrap' });
  view.append(box);
  const pinned = items.filter((i) => Number.isFinite(i.details?.lat) && Number.isFinite(i.details?.lng));
  const unpinned = items.length - pinned.length;
  mapAllowed().then(async (ok) => {
    if (!ok) {
      box.append(el('div', { class: 'recipe-empty map-off' }, [
        el('p', {}, ['The map shows your places on OpenStreetMap. It needs Places lookups, which also find each place’s address and pin.']),
        el('p', { class: 'help' }, [`Sends ${LOOKUP_SOURCES.places.sends} to OpenStreetMap and OpenFreeMap. No account, nothing else.`]),
        el('div', { class: 'review-actions' }, [el('button', { type: 'button', class: 'btn btn-primary', onClick: async () => {
          let granted = false;
          try { granted = await chrome.permissions.request({ origins: LOOKUP_SOURCES.places.origins }); } catch { granted = false; }
          if (!granted) { UI.toast('Chrome didn’t grant access, so the map stays off.', { kind: 'danger' }); return; }
          await store.updateSettings({ lookups: { ...(state.settings.lookups || {}), places: true } });
          const res = await send({ type: MSG.FILL_KIND, kind: 'place' });
          if (res?.count) UI.toast(`Finding ${pluralize(res.count, 'place', 'places')} on the map…`, { duration: 3000 });
        } }, ['Turn on the map and place lookups'])]),
      ]));
      return;
    }
    const mapEl = el('div', { class: 'places-map', role: 'region', 'aria-label': `Map of ${pluralize(pinned.length, 'place', 'places')}` });
    box.append(mapEl);
    if (unpinned) {
      box.append(el('p', { class: 'help map-note' }, [`${pluralize(unpinned, 'place has', 'places have')} no pin yet. `,
        el('button', { type: 'button', class: 'link-btn', onClick: async () => { await send({ type: MSG.FILL_KIND, kind: 'place' }); UI.toast('Looking them up…', { duration: 2500 }); } }, ['Look them up']),
        ' · or add an address in Edit details.']));
    }
    let maplibregl;
    try { maplibregl = await loadMapLibre(); } catch (e) { mapEl.replaceWith(el('p', { class: 'help help-error' }, [e.message])); return; }
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    const map = new maplibregl.Map({ container: mapEl, style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`, center: [0, 20], zoom: 1.4, attributionControl: { compact: true }, cooperativeGestures: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const bounds = new maplibregl.LngLatBounds();
    for (const item of pinned) {
      const d = item.details;
      const approx = !!d.lookup?.approximate;
      const dot = el('button', { type: 'button', class: `map-pin ${item.status === 'done' ? 'is-done' : ''} ${approx ? 'is-approx' : ''}`, 'aria-label': approx ? `${item.title} (approximate)` : item.title, title: approx ? 'Approximate: on the right street, not at the door' : '' });
      const links = mapsLinks(item.title, d);
      const pop = el('div', { class: 'map-pop' }, [
        el('strong', {}, [item.title]),
        el('span', { class: 'help' }, [[d.cuisine || d.category, d.priceRange, addressLine(d)].filter(Boolean).join(' · ')]),
        el('div', { class: 'review-actions' }, [
          el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => openSave(item.id) }, ['Open']),
          links ? el('a', { class: 'btn btn-sm', href: links.google, target: '_blank', rel: 'noopener noreferrer' }, ['Google Maps']) : null,
          links ? el('a', { class: 'btn btn-sm', href: links.apple, target: '_blank', rel: 'noopener noreferrer' }, ['Apple Maps']) : null,
        ]),
      ]);
      new maplibregl.Marker({ element: dot }).setLngLat([d.lng, d.lat]).setPopup(new maplibregl.Popup({ offset: 14, closeButton: true }).setDOMContent(pop)).addTo(map);
      bounds.extend([d.lng, d.lat]);
    }
    if (pinned.length === 1) map.jumpTo({ center: [pinned[0].details.lng, pinned[0].details.lat], zoom: 14 });
    else if (pinned.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
  });
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
  const byName = (a, b) => (a.status === 'done') - (b.status === 'done') || a.title.localeCompare(b.title);
  for (const st of [...states.keys()].sort((a, b) => a.localeCompare(b))) {
    const cities = states.get(st);
    const total = [...cities.values()].reduce((n, l) => n + l.length, 0);
    const section = el('section', { class: 'place-group', 'aria-label': st }, [el('h2', { class: 'place-city' }, [st, el('span', { class: 'count' }, [String(total)])])]);
    // Cities A to Z; places with no city last, under the state itself.
    for (const city of [...cities.keys()].sort((a, b) => (!a) - (!b) || a.localeCompare(b))) {
      const list = cities.get(city).sort(byName);
      if (cities.size > 1 || city) section.append(el('h3', { class: 'place-subcity' }, [city || `Elsewhere in ${st}`, el('span', { class: 'count' }, [String(list.length)])]));
      section.append(el('ul', { class: 'place-rows', role: 'list' }, list.map((item) => placeRow(item))));
    }
    box.append(section);
  }
  view.append(box);
}

// The workout view: what to do (exercises with sets, reps or time, and rest) and its goal. Goals and
// check-ins save as you go; ending a goal or a check-in can be undone from the toast.
async function openWorkout(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const d = item.details || {};
  const exercises = d.exercises || [];
  const aiReady = !!state.settings?.ai?.on && !!(await store.getSecret('aiApiKey').catch(() => ''));
  const sourceLabel = { page: 'Exercises from the page', caption: 'Exercises from the caption', you: 'Exercises added by you', ai: 'Exercises read by AI', 'ai-draft': 'Exercises drafted by AI: check them before you train' }[d.source] || '';
  const from = item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : item.retailer || item.host || '';
  const facts = [
    exercises.length ? ['Exercises', String(exercises.length)] : null,
    d.durationMinutes ? ['Time', formatMinutes(d.durationMinutes)] : null,
    d.focus ? ['Focus', d.focus] : null,
  ].filter(Boolean);
  const amount = (e) => (e.durationSeconds ? formatSeconds(e.durationSeconds) : e.reps ? `${e.reps}${e.repsMax ? `–${e.repsMax}` : ''} reps` : '—');
  const restText = (e) => (e.restSeconds ? (e.restMaxSeconds ? `${e.restSeconds}–${e.restMaxSeconds}s` : formatSeconds(e.restSeconds)) : '—');
  const table = el('table', { class: 'exercise-table' }, [
    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col' }, ['Exercise']), el('th', { scope: 'col' }, ['Sets']), el('th', { scope: 'col' }, ['Reps or time']), el('th', { scope: 'col' }, ['Rest'])])]),
    el('tbody', {}, exercises.map((e) => el('tr', {}, [
      el('th', { scope: 'row' }, [e.name, e.note ? el('span', { class: 'exercise-note' }, [e.note]) : null]), el('td', {}, [e.sets ? String(e.sets) : '—']), el('td', {}, [amount(e)]), el('td', {}, [restText(e)]),
    ]))),
  ]);
  const goalBox = el('div', { class: 'goal-stack' });
  const body = el('div', { class: 'recipe-view workout-view' }, [
    el('div', { class: `recipe-hero ${item.image ? '' : 'no-pic'}` }, [
      item.image ? UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'recipe-hero-pic' }) : null,
      el('div', { class: 'recipe-hero-text' }, [
        el('span', { class: 'badge kind-badge kind-workout' }, [kindIcon('workout'), 'Workout']),
        el('h2', { class: 'recipe-title' }, [item.title]),
        el('p', { class: 'recipe-from' }, [[from, sourceLabel].filter(Boolean).join(' · ')]),
        facts.length ? el('dl', { class: 'recipe-facts-grid' }, facts.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
        item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
        item.status === 'done' ? el('span', { class: 'badge' }, ['Finished']) : null,
      ]),
    ]),
    el('div', { class: 'recipe-columns workout-columns' }, [
      el('section', { class: 'recipe-col' }, [
        el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Exercises', isDrafted(d, 'exercises') ? draftTag() : null]), el('span', { class: 'recipe-count' }, [exercises.length ? pluralize(exercises.length, 'exercise', 'exercises') : ''])]),
        exercises.length ? el('div', { class: 'table-scroll' }, [table]) : el('div', { class: 'recipe-empty' }, [
          el('p', {}, ['Keepsake couldn’t find exercises on this page. Add them yourself.']),
          el('p', { class: 'help' }, ['In Edit details, write one exercise per line, like “Squats 3×12” or “Plank 45s”.']),
        ]),
      ]),
      el('section', { class: 'recipe-col' }, [el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Goal'])]), goalBox]),
    ]),
  ]);

  async function renderGoals() {
    const goals = await store.getGoals({ itemId: item.id });
    const withProgress = await Promise.all(goals.map(async (g) => goalProgress(g, await store.getCheckins(g.id))));
    clear(goalBox);
    const active = withProgress.filter((p) => p.status === 'active');
    for (const p of [...active, ...withProgress.filter((x) => x.status !== 'active').reverse()]) goalBox.append(goalCard(p));
    if (!active.length) goalBox.append(newGoalForm(!withProgress.length));
  }

  function newGoalForm(first) {
    const box = el('div', { class: 'goal-new' });
    const closed = el('div', { class: 'goal-empty' }, [
      first ? el('p', {}, ['Turn this workout into a goal and check in each time you do it.']) : null,
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => { clear(box); box.append(form()); box.querySelector('select, input')?.focus(); } }, [first ? 'Make it a goal' : 'Start a new goal']),
    ]);
    box.append(closed);
    function form() {
      const pick = (value, label, checked) => el('label', { class: 'check' }, [el('input', { type: 'radio', name: `goal-kind-${item.id}`, value, checked: checked ? 'checked' : null, onChange: sync }), el('span', {}, [label])]);
      const perWeek = el('select', { class: 'select select-sm', 'aria-label': 'Times a week' }, [1, 2, 3, 4, 5, 6, 7].map((n) => el('option', { value: String(n), text: `${n}×`, selected: n === 3 ? 'selected' : null })));
      const weeks = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '52', value: '4', 'aria-label': 'Weeks' });
      const first = exercises[0] || {};
      const exercise = el('input', { class: 'input input-sm', list: `goal-ex-${item.id}`, maxlength: '80', value: first.name || '', 'aria-label': 'Exercise', placeholder: 'Push-ups' });
      const datalist = el('datalist', { id: `goal-ex-${item.id}` }, exercises.map((e) => el('option', { value: e.name })));
      const sets = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '20', value: String(first.sets || 3), 'aria-label': 'Sets' });
      const reps = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '500', value: first.durationSeconds ? '' : String((first.reps || 10) + 2), 'aria-label': 'Reps' });
      const secs = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '36000', value: first.durationSeconds ? String(first.durationSeconds + 15) : '', 'aria-label': 'Seconds', placeholder: 'or seconds' });
      const freqRow = el('div', { class: 'goal-row' }, [el('span', {}, ['Do it']), perWeek, el('span', {}, ['a week for']), weeks, el('span', {}, ['weeks'])]);
      const targetRow = el('div', { class: 'goal-row hidden' }, [el('span', {}, ['Reach']), sets, el('span', {}, ['×']), reps, secs, exercise, datalist]);
      const err = el('p', { class: 'help help-error', role: 'alert' });
      function sync() {
        const kind = f.querySelector('input[type=radio]:checked')?.value;
        freqRow.classList.toggle('hidden', kind !== 'frequency');
        targetRow.classList.toggle('hidden', kind !== 'target');
      }
      const f = el('form', { class: 'goal-form', onSubmit: async (e) => {
        e.preventDefault();
        const kind = f.querySelector('input[type=radio]:checked')?.value;
        const spec = kind === 'frequency' ? { perWeek: Number(perWeek.value), weeks: Number(weeks.value) } : { exercise: exercise.value.trim(), sets: Number(sets.value), reps: secs.value ? null : Number(reps.value), durationSeconds: Number(secs.value) || null };
        if (kind === 'frequency' && !(spec.weeks >= 1 && spec.weeks <= 52)) { err.textContent = 'Pick between 1 and 52 weeks.'; return; }
        if (kind === 'target' && (!spec.exercise || !(spec.reps || spec.durationSeconds))) { err.textContent = 'Name the exercise and give reps or seconds.'; return; }
        try {
          await store.createGoal({ itemId: item.id, kind, spec });
          await renderGoals();
        } catch (ex) {
          err.textContent = (ex && ex.message) || String(ex);
        }
      } }, [
        el('fieldset', { class: 'goal-kinds' }, [el('legend', { class: 'sr-only' }, ['Kind of goal']), pick('frequency', 'Do it regularly', true), pick('target', 'Reach a target', false)]),
        freqRow, targetRow, err,
        el('div', { class: 'review-actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ['Create goal']),
          el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { clear(box); box.append(closed); } }, ['Cancel']),
        ]),
      ]);
      return f;
    }
    return box;
  }

  function ring(fraction, label) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 44 44');
    svg.setAttribute('class', 'goal-ring');
    svg.setAttribute('aria-hidden', 'true');
    const c = (cls, dash) => {
      const n = document.createElementNS(NS, 'circle');
      n.setAttribute('cx', '22'); n.setAttribute('cy', '22'); n.setAttribute('r', '18'); n.setAttribute('class', cls);
      if (dash !== undefined) { n.setAttribute('stroke-dasharray', `${dash} 200`); n.setAttribute('transform', 'rotate(-90 22 22)'); }
      return n;
    };
    svg.append(c('goal-ring-track'), c('goal-ring-fill', (Math.max(0, Math.min(1, fraction)) * 2 * Math.PI * 18).toFixed(1)));
    return el('div', { class: 'goal-ring-wrap' }, [svg, el('span', { class: 'goal-ring-label' }, [label])]);
  }

  function goalCard(p) {
    const g = p.goal;
    const finished = p.status === 'finished';
    const card = el('article', { class: `goal-card ${finished ? 'is-finished' : ''}`, 'aria-label': `Goal: ${goalTitle(g)}` });
    const ringLabel = g.kind === 'frequency' ? (p.thisWeek ? `${p.thisWeek.count}/${p.thisWeek.target}` : `${p.weeksMet}/${g.spec.weeks}`) : finished ? '✓' : `${Math.round(p.ring * 100)}%`;
    card.append(el('div', { class: 'goal-top' }, [
      ring(p.ring, ringLabel),
      el('div', { class: 'goal-top-text' }, [
        el('h4', { class: 'goal-title' }, [goalTitle(g)]),
        el('p', { class: 'goal-summary' }, [p.summary]),
        p.lastWeekNote ? el('p', { class: 'goal-note' }, [p.lastWeekNote]) : null,
      ]),
      finished ? el('span', { class: 'badge badge-success' }, [g.kind === 'target' ? 'Reached' : 'Finished']) : null,
    ]));
    if (g.kind === 'frequency') {
      card.append(el('ol', { class: 'goal-strip', 'aria-label': 'Weeks' }, p.strip.map((w) => el('li', {
        class: `goal-week ${w.met ? 'is-met' : ''} ${w.current ? 'is-current' : ''} ${!w.past && !w.current ? 'is-future' : ''}`,
        title: `Week ${w.week}: ${w.count} of ${w.target}`,
      }, [el('span', { class: 'sr-only' }, [`Week ${w.week}: ${w.count} of ${w.target}${w.met ? ', done' : ''}`]), el('span', { 'aria-hidden': 'true' }, [w.met ? '✓' : String(w.count)])]))));
    }
    if (p.next) {
      const n = p.next;
      const what = [n.perWeek ? `${n.perWeek}× this week` : '', n.sets || n.reps || n.durationSeconds ? resultText(n) : '', n.note].filter(Boolean).join(' · ');
      card.append(el('p', { class: 'goal-plan-line' }, [el('strong', {}, [`Week ${n.week} plan: `]), what, g.planSource === 'ai-suggested' ? el('span', { class: 'goal-plan-src' }, [' (suggested by AI)']) : null]));
    }
    if (!finished) card.append(checkinArea(p));
    const recent = p.checkins.slice(-5).reverse();
    if (recent.length) {
      card.append(el('details', { class: 'goal-history' }, [
        el('summary', {}, [`Check-ins (${p.checkins.length})`]),
        el('ul', {}, recent.map((c) => el('li', {}, [
          el('span', { class: 'goal-history-date' }, [new Date(c.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })]),
          el('span', {}, [[resultText(c.result), c.result.note].filter(Boolean).join(' · ') || 'Done']),
        ]))),
      ]));
    }
    const actions = [];
    if (aiReady && !finished) {
      const suggestBtn = el('button', { type: 'button', class: 'btn btn-sm', onClick: () => suggest(p, card, suggestBtn) }, ['Suggest a progression']);
      actions.push(suggestBtn);
    }
    actions.push(el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: async () => {
      await store.deleteGoal(g.id);
      await renderGoals();
      UI.toast('Goal removed.', { action: { label: 'Undo', onClick: async () => { await store.restoreGoal(g.id); await renderGoals(); } } });
    } }, ['Remove goal']));
    card.append(el('div', { class: 'review-actions goal-actions' }, actions));
    return card;
  }

  function checkinArea(p) {
    const g = p.goal;
    const box = el('div', { class: 'goal-checkin' });
    const today = localDay();
    const doneToday = p.checkins.some((c) => localDay(new Date(c.at)) === today);
    const save = async (result) => {
      const c = await store.addCheckin(g.id, result);
      await renderGoals();
      UI.toast('Checked in.', { action: { label: 'Undo', onClick: async () => { await store.removeCheckin(c.id); await renderGoals(); } } });
    };
    const quick = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => save({}) }, [doneToday ? 'Check in again' : 'Done today']);
    const more = el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { clear(box); box.append(form()); box.querySelector('input')?.focus(); } }, ['Add sets and reps']);
    // A target goal is measured by what you did, so its check-in asks for the numbers first.
    if (g.kind === 'target') { box.append(form()); return box; }
    box.append(el('div', { class: 'review-actions' }, [quick, more]));
    return box;
    function form() {
      const plan = p.next || {};
      const s = g.spec;
      const sets = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '20', 'aria-label': 'Sets', placeholder: 'Sets', value: g.kind === 'target' ? String(plan.sets || s.sets || '') : '' });
      const reps = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '500', 'aria-label': 'Reps', placeholder: 'Reps' });
      const secs = el('input', { class: 'input input-sm input-num', type: 'number', min: '1', max: '36000', 'aria-label': 'Seconds', placeholder: 'Seconds' });
      const note = el('input', { class: 'input input-sm', maxlength: '300', 'aria-label': 'Note', placeholder: 'Note (optional)' });
      const timed = g.kind === 'target' && !!s.durationSeconds;
      const f = el('form', { class: 'goal-form', onSubmit: async (e) => {
        e.preventDefault();
        await save({ sets: Number(sets.value) || null, reps: Number(reps.value) || null, durationSeconds: Number(secs.value) || null, note: note.value.trim() });
      } }, [
        el('div', { class: 'goal-row' }, [sets, el('span', {}, ['×']), timed ? secs : reps, timed ? null : secs, g.kind === 'target' ? el('span', {}, [s.exercise]) : null]),
        note,
        el('div', { class: 'review-actions' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, [doneToday ? 'Check in again' : 'Check in']),
          g.kind === 'target' ? null : el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { clear(box); box.append(el('div', { class: 'review-actions' }, [quick, more])); } }, ['Cancel']),
        ]),
      ]);
      return f;
    }
  }

  async function suggest(p, card, btn) {
    btn.disabled = true;
    btn.textContent = 'Suggesting…';
    let out;
    try {
      out = await suggestProgression(item, p.goal, p, state.settings, await store.getSecret('aiApiKey'));
    } catch {
      btn.disabled = false;
      btn.textContent = 'Suggest a progression';
      UI.toast('Your AI provider didn’t answer. Nothing changed.', { kind: 'danger' });
      return;
    }
    btn.remove();
    const preview = el('div', { class: 'goal-suggestion', role: 'group', 'aria-label': 'Suggested progression' }, [
      el('p', { class: 'goal-suggestion-head' }, ['Suggested by your AI provider. Check it suits you before you follow it.']),
      el('ol', {}, out.plan.map((w) => el('li', {}, [el('strong', {}, [`Week ${w.week}: `]), [w.perWeek ? `${w.perWeek}×` : '', resultText(w), w.note].filter(Boolean).join(' · ')]))),
      out.note ? el('p', { class: 'help' }, [out.note]) : null,
      el('div', { class: 'review-actions' }, [
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: async () => {
          const before = { plan: p.goal.plan || [], planSource: p.goal.planSource || '' };
          const updated = await store.updateGoal(p.goal.id, { plan: out.plan, planSource: 'ai-suggested' });
          // Logged like every AI change, so the AI change log can undo it.
          await store.appendAiLog([{ id: crypto.randomUUID(), runId: `plan-${p.goal.id}`, at: new Date().toISOString(), itemId: item.id, goalId: p.goal.id, itemTitle: item.title,
            changes: [{ field: 'plan', from: before.plan.length ? `${before.plan.length}-week plan` : 'no plan', to: `${updated.plan.length}-week plan` }],
            before, after: { plan: updated.plan, planSource: 'ai-suggested' }, reason: 'Progression suggested on request', undone: false }]);
          await renderGoals();
          UI.toast('Plan added to the goal.', { action: { label: 'Undo', onClick: async () => { await store.updateGoal(p.goal.id, before); await renderGoals(); } } });
        } }, ['Accept']),
        el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { preview.remove(); renderGoals(); } }, ['Dismiss']),
      ]),
    ]);
    card.append(preview);
  }

  await renderGoals();
  const finishedItem = item.status === 'done';
  await UI.openModal({
    title: item.title,
    body,
    full: true,
    className: 'modal-recipe modal-workout',
    actions: [
      { label: 'Edit details', quiet: true, autofocus: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      { label: finishedItem ? 'Finished ✓' : 'Mark finished', primary: !finishedItem, onClick: async () => {
        await store.updateItem(item.id, { status: finishedItem ? 'saved' : 'done' });
        UI.toast(finishedItem ? 'Marked as not finished.' : 'Marked as finished.', { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}

// "AI draft" next to what your AI provider wrote because the save didn't say it (details.drafted).
const isDrafted = (d, field) => Array.isArray(d?.drafted) && d.drafted.includes(field);
const draftTag = () => el('span', { class: 'badge badge-brass ai-draft-tag', title: 'Your AI provider wrote this because the post doesn’t say it. Check it before you use it.' }, ['AI draft']);

// The recipe view: a large dialog with the photo, what you need and what to do. Checking off
// ingredients and steps is just for cooking along (not saved). Editing lives in Edit details.
async function openRecipe(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const d = item.details || {};
  const ingredients = d.ingredients || [];
  const steps = d.steps || [];
  const sourceLabel = { page: 'Recipe from the page', caption: 'Recipe from the caption', you: 'Recipe added by you', ai: 'Recipe read by AI', 'ai-draft': 'Drafted by AI: check it before you cook' }[d.source] || '';
  const from = item.type === 'instagram' && item.instagram?.creator ? `@${item.instagram.creator}` : item.retailer || item.host || '';
  const facts = [
    d.totalMinutes ? ['Time', formatMinutes(d.totalMinutes)] : null,
    d.prepMinutes && d.cookMinutes ? ['Prep · cook', `${formatMinutes(d.prepMinutes)} · ${formatMinutes(d.cookMinutes)}`] : null,
    d.yield ? (/^(makes|serves)\s+/i.test(d.yield) ? [d.yield.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase()), d.yield.replace(/^(makes|serves)\s+/i, '')] : ['Makes', d.yield]) : null,
    d.cuisine ? ['Cuisine', d.cuisine] : null,
    ingredients.length ? ['Ingredients', String(ingredients.length)] : null,
  ].filter(Boolean);

  // Each step lists the ingredients it uses (stepIngredients); a box checked there is checked in the
  // Ingredients list too, and the other way round.
  const plan = stepIngredients(steps, ingredients);
  const counter = el('span', { class: 'recipe-count' }, [ingredients.length ? `0 of ${ingredients.length}` : '']);
  const boxes = () => [...body.querySelectorAll('input[data-ing]')];
  const setChecked = (i, on) => {
    boxes().filter((b) => b.dataset.ing === String(i)).forEach((b) => { b.checked = on; });
    counter.textContent = `${new Set(boxes().filter((b) => b.checked).map((b) => b.dataset.ing)).size} of ${ingredients.length}`;
  };
  const box = (i, id) => el('input', { type: 'checkbox', id, 'data-ing': String(i), onChange: (e) => setChecked(i, e.target.checked) });
  const ingList = el('ul', { class: 'recipe-ingredients' });
  ingredients.forEach((x, i) => ingList.append(el('li', {}, [el('label', { class: 'check' }, [box(i, `rv-ing-${i}`), el('span', {}, [x])])])));
  const names = (c) => { const n = c.items.map((i) => plan.items[i].name).join(', '); return n.charAt(0).toUpperCase() + n.slice(1); };
  const marked = (text, i) => {
    const out = [];
    let at = 0;
    for (const r of plan.highlights(text, i)) { out.push(text.slice(at, r.start), el('mark', { class: 'step-mark' }, [text.slice(r.start, r.end)])); at = r.end; }
    out.push(text.slice(at));
    return out;
  };
  const stepList = el('ol', { class: 'recipe-steps recipe-steps-big' }, steps.map((x, i) => {
    const uses = [...(plan.steps[i]?.items || []), ...(i === 0 ? plan.unmatched : [])];
    const carried = plan.steps[i]?.carried || [];
    const need = uses.length || carried.length
      ? el('div', { class: 'step-ings', onClick: (e) => e.stopPropagation(), onKeydown: (e) => e.stopPropagation() }, [
        ...uses.map((k) => el('label', { class: 'step-ing' }, [
          box(k, `rv-step-${i}-ing-${k}`),
          plan.items[k].amount ? el('b', {}, [plan.items[k].amount]) : null,
          el('span', {}, [plan.items[k].name]),
        ])),
        ...carried.map((c) => el('span', { class: 'step-carry' }, [
          el('span', {}, [names(c)]), el('small', {}, [`From step ${c.fromStep + 1}`]),
        ])),
      ])
      : null;
    const li = el('li', { tabindex: '0', 'aria-label': `Step ${i + 1}: ${x}`, onClick: () => li.classList.toggle('is-done'), onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.classList.toggle('is-done'); }
    } }, [el('span', { class: 'step-n', 'aria-hidden': 'true' }, [String(i + 1)]), el('div', { class: 'step-body' }, [el('span', { class: 'step-text' }, marked(x, i)), need])]);
    return li;
  }));
  const empty = !ingredients.length && !steps.length;
  const body = el('div', { class: 'recipe-view' }, [
    el('div', { class: `recipe-hero ${item.image ? '' : 'no-pic'}` }, [
      item.image ? UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'recipe-hero-pic' }) : null,
      el('div', { class: 'recipe-hero-text' }, [
        el('span', { class: 'badge kind-badge kind-recipe' }, [kindIcon('recipe'), 'Recipe']),
        el('h2', { class: 'recipe-title' }, [item.title]),
        el('p', { class: 'recipe-from' }, [[from, d.author && d.author !== from ? `by ${d.author}` : '', sourceLabel].filter(Boolean).join(' · ')]),
        facts.length ? el('dl', { class: 'recipe-facts-grid' }, facts.flatMap(([k, v]) => [el('dt', {}, [k]), el('dd', {}, [v])])) : null,
        item.note ? el('p', { class: 'recipe-note' }, [`“${item.note}”`]) : null,
        item.status === 'done' ? el('span', { class: 'badge' }, ['Cooked']) : null,
      ]),
    ]),
    empty
      ? el('div', { class: 'recipe-empty' }, [
        el('p', {}, ['No ingredients or steps were found on the page or in the caption.']),
        el('p', { class: 'help' }, ['Add them yourself in Edit details, or, with Optional AI on, ask for a draft there.']),
      ])
      : el('div', { class: 'recipe-columns' }, [
        el('section', { class: 'recipe-col' }, [el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Ingredients', isDrafted(d, 'ingredients') ? draftTag() : null]), counter]), ingList]),
        el('section', { class: 'recipe-col' }, [el('div', { class: 'recipe-col-head' }, [el('h3', {}, ['Method', isDrafted(d, 'steps') ? draftTag() : null]), el('span', { class: 'recipe-count' }, [steps.length ? `${steps.length} steps · check off what you add, tap a step when it’s done` : ''])]), stepList]),
      ]),
  ]);
  const cooked = item.status === 'done';
  await UI.openModal({
    title: item.title,
    body,
    full: true,
    className: 'modal-recipe',
    actions: [
      { label: 'Edit details', quiet: true, autofocus: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), icon: UI.externalIcon() } : null,
      { label: cooked ? 'Cooked ✓' : 'Mark cooked', primary: !cooked, onClick: async () => {
        await store.updateItem(item.id, { status: cooked ? 'saved' : 'done' });
        UI.toast(cooked ? 'Marked as not cooked yet.' : 'Marked as cooked.', { duration: 2200 });
      } },
    ].filter(Boolean),
  });
}

async function openQuickView(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const price = formatPrice(item.price, item.currency);
  const pic = UI.pictureNode({ src: item.image, aspect: item.imageAspect, title: item.title, className: 'quickview-pic' });
  if (item.image) {
    const hint = el('div', { class: 'quickview-pic-hint' }, [UI.expandIcon()]);
    pic.append(hint);
    pic.setAttribute('aria-pressed', 'false');
    pic.setAttribute('aria-label', 'Expand image');
    const toggleExpand = () => {
      // Object-fit stays "cover" throughout: swapping to "contain" once the box
      // finishes growing made the image jump and exposed a letterbox edge.
      const expanded = !pic.classList.contains('is-expanded');
      pic.classList.toggle('is-expanded', expanded);
      pic.setAttribute('aria-pressed', String(expanded));
      pic.setAttribute('aria-label', expanded ? 'Shrink image' : 'Expand image');
      hint.replaceChildren(expanded ? UI.collapseIcon() : UI.expandIcon());
    };
    // Only offer expansion when it reveals a meaningful amount more of the
    // image. Short/wide images already fit in the collapsed box, so expanding
    // would just add a sliver of height.
    const MIN_EXPAND_GAIN_PX = 48;
    const updateExpandable = () => {
      const width = pic.clientWidth;
      const img = pic.querySelector('img');
      const aspect = img && img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : item.imageAspect;
      if (!width || !aspect) return;
      const natural = width / Math.max(0.5, Math.min(2.2, aspect));
      const vh = window.innerHeight;
      const collapsed = Math.max(160, Math.min(natural, vh * 0.38));
      const expandedH = Math.max(160, Math.min(natural, vh * 0.7));
      const expandable = expandedH - collapsed >= MIN_EXPAND_GAIN_PX;
      if (expandable) {
        pic.setAttribute('role', 'button');
        pic.setAttribute('tabindex', '0');
      } else if (!pic.classList.contains('is-expanded')) {
        pic.removeAttribute('role');
        pic.removeAttribute('tabindex');
      }
    };
    pic.addEventListener('click', () => {
      if (pic.getAttribute('role') === 'button') toggleExpand();
    });
    pic.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && pic.getAttribute('role') === 'button') {
        e.preventDefault();
        toggleExpand();
      }
    });
    pic.querySelector('img')?.addEventListener('load', updateExpandable);
    // Fires once the modal attaches the pic (width becomes known) and on resize.
    new ResizeObserver(updateExpandable).observe(pic);
  }
  const body = el('div', { class: 'quickview' }, [
    pic,
    el('div', { class: 'quickview-title' }, [item.title]),
    price ? el('div', { class: 'quickview-price' }, [price]) : null,
    kindOf(item) === 'product' ? productFacts(item.details || {}) : null,
  ]);
  const shop = kindOf(item) === 'product' ? item.details?.shopUrl : '';
  await UI.openModal({
    title: 'Quick view',
    body,
    actions: [
      { label: 'Close', value: false },
      { label: 'Edit details', quiet: true, closes: false, onClick: async (close) => { close(false); await openItem(item.id); } },
      shop && item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), quiet: true, icon: UI.externalIcon() } : null,
      shop ? { label: `Visit ${item.details.shopName || 'shop'}`, href: openableUrl(shop), primary: true, icon: UI.externalIcon() } : null,
      !shop && item.url ? { label: item.type === 'instagram' ? 'Open post' : 'Visit page', href: openableUrl(item.url), primary: true, icon: UI.externalIcon() } : null,
    ].filter(Boolean),
  });
}

// What your AI provider found a product to be (src/shared/understand.js understandProduct): the shop page's
// own facts first, then the provider's summary, marked as its own words.
function productFacts(d) {
  const by = [d.brand, d.category].filter(Boolean).join(' · ');
  const nodes = [
    by ? el('div', { class: 'quickview-meta' }, [by]) : null,
    d.shopDescription ? el('p', { class: 'quickview-text' }, [d.shopDescription]) : null,
    d.specs?.length ? el('dl', { class: 'quickview-specs' }, d.specs.flatMap((x) => [el('dt', {}, [x.label]), el('dd', {}, [x.value])])) : null,
    d.features?.length ? el('ul', { class: 'quickview-features' }, d.features.map((f) => el('li', {}, [f]))) : null,
    d.availability ? el('div', { class: 'quickview-meta' }, [d.availability === 'in_stock' ? 'In stock' : 'Out of stock', d.shopName ? ` at ${d.shopName}` : '']) : null,
    d.summary ? el('div', { class: 'quickview-summary' }, [el('span', { class: 'pill' }, ['AI summary']), ' ', d.summary]) : null,
  ].filter(Boolean);
  return nodes.length ? el('div', { class: 'quickview-product' }, nodes) : null;
}

async function openItem(id) {
  const item = await store.getItem(id);
  if (!item) {
    UI.toast('That item no longer exists.', { kind: 'danger' });
    return;
  }
  const collections = ctx.regularCollections();
  let chosenImage = item.image || '';

  const titleInput = el('textarea', { class: 'textarea', rows: '2', maxlength: '200', 'aria-label': 'Title' });
  titleInput.value = item.title;
  const priceInput = el('input', { class: 'input', inputmode: 'decimal', placeholder: 'Price', 'aria-label': 'Price' });
  priceInput.value = item.price !== null && item.price !== undefined ? String(item.price) : '';
  const currencyInput = el('input', { class: 'input', maxlength: '4', placeholder: 'USD', 'aria-label': 'Currency' });
  currencyInput.value = item.currency || '';
  const noteInput = el('textarea', { class: 'textarea', rows: '3', maxlength: '1000', placeholder: 'Add a note', 'aria-label': 'Note' });
  noteInput.value = item.note || '';
  // An uncategorized item (still waiting in Review) gets a placeholder option so
  // saving other edits doesn't silently file it into whatever collection sorts first.
  // A Lifestyle save has no collection field (collections are for shopping); one still in a
  // collection from before can be taken out with "No collection".
  const lifestyleSave = hasOwnView(kindOf(item));
  const colOptions = [...(item.collectionId ? (lifestyleSave ? [{ value: '__none', label: 'No collection' }] : []) : [{ value: '', label: 'Not sorted yet' }]), ...collections.map((c) => ({ value: c.id, label: c.name }))];
  const colSelect = UI.selectInput({ value: item.collectionId || '', options: colOptions, onChange: () => learnRow.classList.toggle('hidden', colSelect.value === item.collectionId), label: 'Collection' });
  const learnCheck = el('input', { type: 'checkbox' });
  const learnRow = el('label', { class: 'check hidden' }, [learnCheck, el('span', {}, ['Use this choice for similar items in the future'])]);

  // Kind and its details (a recipe's ingredients and steps). Edits stay in this dialog until Save.
  const startKind = kindOf(item);
  let recipe = startKind === 'recipe' ? { ...(item.details || {}) } : {};
  const startWorkout = startKind === 'workout' ? item.details || {} : {};
  const workoutLines = el('textarea', { class: 'textarea', rows: '6', 'aria-label': 'Exercises, one per line', placeholder: 'Squats 3×12\nPush-ups 3×10\nPlank 3×45s rest 60s' });
  workoutLines.value = (startWorkout.exercises || []).map(formatExercise).join('\n');
  const workoutMinutes = el('input', { class: 'input', inputmode: 'numeric', placeholder: 'Minutes', 'aria-label': 'Workout minutes' });
  workoutMinutes.value = startWorkout.durationMinutes || '';
  const workoutFocus = el('input', { class: 'input', maxlength: '60', placeholder: 'Focus, e.g. legs', 'aria-label': 'Focus' });
  workoutFocus.value = startWorkout.focus || '';
  const workoutHelp = el('p', { class: 'help', 'aria-live': 'polite' });
  const startPlace = startKind === 'place' ? item.details || {} : {};
  const placeInput = (key, label, max, placeholder = '') => {
    const i = el('input', { class: 'input', maxlength: String(max), 'aria-label': label, placeholder });
    i.value = startPlace[key] || '';
    return i;
  };
  const placeFields = {
    address: placeInput('address', 'Street address', 200, 'Street address'),
    locality: placeInput('locality', 'City', 80, 'City'),
    region: placeInput('region', 'Region or state', 80, 'Region or state'),
    postalCode: placeInput('postalCode', 'Postcode', 20, 'Postcode'),
    country: placeInput('country', 'Country', 60, 'Country'),
    cuisine: placeInput('cuisine', 'Cuisine or kind of place', 120, 'Cuisine, e.g. Italian'),
    priceRange: placeInput('priceRange', 'Price range', 20, 'Price, e.g. ££'),
    phone: placeInput('phone', 'Phone', 40, 'Phone'),
  };
  const placeHours = el('textarea', { class: 'textarea', rows: '3', 'aria-label': 'Opening hours, one line per day or range', placeholder: 'Mon–Fri 12:00–22:00\nSat 10:00–23:00' });
  placeHours.value = (startPlace.hours || []).join('\n');
  // Videos and articles: the few facts that say how long it takes and who made it.
  const startMedia = ['video', 'article'].includes(startKind) ? item.details || {} : {};
  const mediaInput = (label, value, attrs = {}) => {
    const i = el('input', { class: 'input', 'aria-label': label, placeholder: label, ...attrs });
    i.value = value || '';
    return i;
  };
  // Films, shows and books.
  const startShelf = ['media', 'book'].includes(startKind) ? item.details || {} : {};
  const shelfInput = (label, value, attrs = {}) => {
    const i = el('input', { class: 'input', 'aria-label': label, placeholder: label, ...attrs });
    i.value = value ?? '';
    return i;
  };
  const shelfFields = {
    format: UI.selectInput({ value: startShelf.format === 'series' ? 'series' : 'film', options: [{ value: 'film', label: 'Film' }, { value: 'series', label: 'TV series' }], onChange: () => {}, label: 'Film or series' }),
    year: shelfInput('Year', startShelf.year, { inputmode: 'numeric', maxlength: '4' }),
    director: shelfInput('Director or creator', startShelf.director, { maxlength: '160' }),
    runtime: shelfInput('Runtime (minutes)', startShelf.runtimeMinutes, { inputmode: 'numeric' }),
    seasons: shelfInput('Seasons', startShelf.seasons, { inputmode: 'numeric' }),
    author: shelfInput('Author', startShelf.author, { maxlength: '240' }),
    pages: shelfInput('Pages', startShelf.pages, { inputmode: 'numeric' }),
  };
  const mediaFields = {
    channel: mediaInput('Channel', startMedia.channel, { maxlength: '80' }),
    length: mediaInput('Length, e.g. 12:30', startMedia.durationSeconds ? formatDuration(startMedia.durationSeconds) : ''),
    author: mediaInput('Author', startMedia.author, { maxlength: '80' }),
    minutes: mediaInput('Reading minutes', startMedia.readingMinutes, { inputmode: 'numeric' }),
    published: mediaInput('Published', startMedia.publishedOn, { type: 'date' }),
  };
  let prefilled = false;
  const prefilledKinds = new Set();
  let prefilledText = '';
  let recipeEditing = false;
  let drafted = false;
  const aiReady = !!state.settings?.ai?.on && !!(await store.getSecret('aiApiKey').catch(() => ''));
  const kindPanel = el('div', {});
  const kindSelect = UI.selectInput({ value: startKind, options: KINDS.map((k) => ({ value: k.value, label: k.label })), onChange: () => renderKindPanel(), label: 'Kind' });

  const flags = { favorite: !!item.favorite, purchased: !!item.purchased, done: item.status === 'done' };
  const toggle = (key, label, icon) => {
    const b = el('button', { type: 'button', class: `toggle-chip ${flags[key] ? 'on' : ''}`, 'aria-pressed': flags[key] ? 'true' : 'false', onClick: () => {
      flags[key] = !flags[key];
      b.classList.toggle('on', flags[key]);
      b.setAttribute('aria-pressed', flags[key] ? 'true' : 'false');
    } }, [icon, label]);
    return b;
  };

  const pic = UI.pictureNode({ src: chosenImage, title: item.title, className: 'detail-pic' });
  const picWrap = el('div', {}, [pic]);
  const thumbs = (item.images || []).filter(Boolean).slice(0, 6);
  const thumbRow = thumbs.length > 1 ? el('div', { class: 'thumb-row', role: 'radiogroup', 'aria-label': 'Choose the main image' }, thumbs.map((src, i) => {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': src === chosenImage ? 'true' : 'false', 'aria-label': `Image ${i + 1}`, onClick: () => {
      chosenImage = src;
      clear(picWrap);
      picWrap.append(UI.pictureNode({ src, title: item.title, className: 'detail-pic' }));
      thumbRow.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    } }, [el('img', { src, alt: '', loading: 'lazy', onError: () => b.remove() })]);
    return b;
  })) : null;

  const source = el('div', { class: 'item-source' }, [
    el('span', {}, [item.type === 'instagram' ? 'Instagram' : item.retailer || item.host || 'Saved page']),
    el('span', {}, [`Saved ${formatDate(item.createdAt)}`]),
  ]);

  // The exact page this item came from: always visible, selectable, copyable,
  // and editable in case the extractor grabbed a listing rather than the product.
  const urlInput = el('input', { class: 'input mono', type: 'url', spellcheck: 'false', 'aria-label': 'Item URL', placeholder: 'https://…' });
  const shownUrl = openableUrl(item.url || '');
  urlInput.value = shownUrl;
  const openLink = el('a', { class: 'btn btn-sm', href: shownUrl || '#', target: '_blank', rel: 'noopener noreferrer', title: shownUrl }, [UI.externalIcon(), item.type === 'instagram' ? 'Open post' : 'Visit page']);
  if (!item.url) openLink.classList.add('hidden');
  const copyBtn = el('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'Copy link', onClick: async () => {
    const value = urlInput.value.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      UI.toast('Link copied.', { duration: 1500 });
    } catch {
      urlInput.focus();
      urlInput.select();
      UI.toast('Press Ctrl/Cmd+C to copy.', { duration: 2500 });
    }
  } }, ['Copy']);
  urlInput.addEventListener('input', () => {
    const v = urlInput.value.trim();
    const valid = /^https?:\/\//i.test(v);
    openLink.href = valid ? v : '#';
    openLink.title = v;
    openLink.classList.toggle('hidden', !valid);
  });
  const urlField = el('div', { class: 'field' }, [
    el('label', { class: 'label' }, ['Link']),
    el('div', { class: 'url-row' }, [urlInput, copyBtn, openLink]),
    el('p', { class: 'help' }, [item.type === 'instagram' ? 'The original post. Editing this changes where “Open post” goes.' : 'The page this was saved from. Edit it if Keepsake grabbed the wrong page.']),
  ]);

  const col = ctx.collectionById(item.collectionId);
  const confidencePct = item.confidence !== null && item.confidence !== undefined ? `${Math.round(item.confidence * 100)}%` : '';
  const catText = item.categorizationSource === 'manual' ? 'Filed by you.' : item.categorizationSource === 'sample' ? 'Sample item.' : item.categorizationSource === 'ai' ? `Filed with AI assist${confidencePct ? ` (${confidencePct} confidence)` : ''}.` : `Filed automatically${confidencePct ? ` (${confidencePct} confidence)` : ''}${item.categorizationReason ? ` — ${item.categorizationReason}` : '.'}`;

  const ig = item.instagram;
  const igInfo = ig ? el('div', { class: 'category-box' }, [
    ig.creator ? el('div', {}, [el('strong', {}, ['Creator: ']), `@${ig.creator}`]) : null,
    ig.collectionName ? el('div', {}, [el('strong', {}, ['Saved collection: ']), ig.collectionName]) : null,
    ig.postedAt ? el('div', {}, [el('strong', {}, ['Posted: ']), formatDate(ig.postedAt)]) : null,
    ig.location ? el('div', {}, [el('strong', {}, ['Location: ']), ig.location]) : null,
    ig.caption ? el('div', {}, [el('strong', {}, ['Caption: ']), cut(ig.caption, 600)]) : null,
    ig.hashtags?.length ? el('div', { class: 'chips' }, ig.hashtags.slice(0, 12).map((h) => el('span', { class: 'pill' }, [`#${h}`]))) : null,
    ig.products?.length ? el('div', {}, [
      el('strong', {}, ['Tagged by the creator: ']),
      el('div', { class: 'found-list' }, ig.products.map((p) => foundRow(item, { name: p.name, retailer: p.retailer, price: p.price, currency: p.currency, url: p.url, verified: true, note: 'Product tag from the post itself.' }))),
    ]) : null,
    ig.links?.length ? el('div', {}, [
      el('strong', {}, ['Links in the caption: ']),
      el('div', { class: 'found-list' }, ig.links.map((l) => foundRow(item, { name: l.label || l.url, url: l.url, verified: true, note: 'Link the creator put in the caption.' }))),
    ]) : null,
    ig.linkInBio && !ig.links?.length ? el('div', { class: 'help' }, ['The caption says “link in bio” — Keepsake can’t follow that, but the creator’s profile may have it.']) : null,
    !ig.details ? el('div', { class: 'help' }, ['Only the grid thumbnail was read for this post. Re-run the import and use “Read post details” to fill in the caption, links and tagged products.']) : null,
  ]) : null;

  const aiBox = el('div', {});
  renderAiBox(aiBox, item);

  const priceField = el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Price']), el('div', { class: 'price-inline' }, [priceInput, currencyInput])]);
  const doneToggle = toggle('done', kindInfo(startKind).done, UI.checkIcon());

  function renderKindPanel() {
    const kind = kindSelect.value;
    priceField.classList.toggle('hidden', kind !== 'product');
    topicsField.classList.toggle('hidden', kind === 'product' && !(item.topics || []).length);
    doneToggle.lastChild.textContent = kindInfo(kind).done;
    clear(kindPanel);
    if (kind === 'recipe') kindPanel.append(recipePanel());
    colField.classList.toggle('hidden', hasOwnView(kind) && !item.collectionId);
    // Switching to Place or Recipe: fill in what the save already holds (caption, location, link).
    if (kind !== startKind && !prefilledKinds.has(kind) && (kind === 'place' || kind === 'recipe')) {
      prefilledKinds.add(kind);
      const found = detailsForKind(kind, item);
      if (kind === 'place') {
        for (const [k, input] of Object.entries(placeFields)) if (!input.value && found.details[k]) input.value = found.details[k];
        if (found.title && titleInput.value.trim() === item.title) titleInput.value = found.title;
      } else if (!recipe.ingredients?.length && found.details.ingredients?.length) recipe = { ...found.details };
    }
    if (kind === 'place') kindPanel.append(placePanel());
    if (kind === 'media' || kind === 'book') {
      const f = shelfFields;
      kindPanel.append(el('div', { class: 'recipe-panel' }, [
        el('div', { class: 'recipe-head' }, [el('h3', {}, [kindInfo(kind).label])]),
        ...(kind === 'media'
          ? [el('div', { class: 'price-inline' }, [f.format, f.year]), f.director, el('div', { class: 'price-inline' }, [f.runtime, f.seasons])]
          : [f.author, el('div', { class: 'price-inline' }, [f.year, f.pages])]),
      ]));
    }
    if (kind === 'video' || kind === 'article') {
      const f = mediaFields;
      kindPanel.append(el('div', { class: 'recipe-panel' }, [
        el('div', { class: 'recipe-head' }, [el('h3', {}, [kindInfo(kind).label])]),
        kind === 'video' ? el('div', { class: 'price-inline' }, [f.channel, f.length]) : el('div', { class: 'price-inline' }, [f.author, f.minutes]),
        el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Published']), f.published]),
      ]));
    }
    if (kind === 'workout') {
      // Switching a save to Workout: fill in what its caption or description lists, to check and keep.
      if (!workoutLines.value.trim() && !prefilled) {
        prefilled = true;
        // The longest text first: a description or title may be a cut-short copy of the caption.
        const found = [item.instagram?.caption, item.description, item.title].filter(Boolean).sort((a, b) => b.length - a.length).map((t) => workoutFromText(t)).find(Boolean);
        if (found) {
          workoutLines.value = found.exercises.map(formatExercise).join('\n');
          prefilledText = workoutLines.value;
          if (!workoutMinutes.value && found.durationMinutes) workoutMinutes.value = found.durationMinutes;
        }
      }
      kindPanel.append(workoutPanel());
    }
  }

  // Exercises are edited as text, one per line ("Squats 3×12", "Plank 45s rest 60s").
  function readWorkoutLines() {
    const lines = workoutLines.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const exercises = [];
    const unread = [];
    for (const l of lines) {
      const rest = l.match(/\s+rest\s+(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\s*(s|sec|secs|seconds?|m|min|mins|minutes?)\b\s*$/i);
      const e = parseExerciseLine(rest ? l.slice(0, rest.index) : l) || exerciseName(rest ? l.slice(0, rest.index) : l);
      const secs = (v) => (v ? (/^m/i.test(rest[3]) ? Number(v) * 60 : Number(v)) : null);
      if (e) exercises.push({ ...e, restSeconds: rest ? secs(rest[1]) : null, restMaxSeconds: rest ? secs(rest[2]) : null });
      else unread.push(l);
    }
    return { exercises, unread };
  }

  function placePanel() {
    const box = el('div', { class: 'recipe-panel' });
    const sourceLabel = { page: 'From the page', 'maps-link': 'From a maps link', you: 'Added by you', ai: 'Found by AI' }[startPlace.source] || '';
    const f = placeFields;
    box.append(...[
      el('div', { class: 'recipe-head' }, [el('h3', {}, ['Place']), sourceLabel ? el('span', { class: 'recipe-facts' }, [sourceLabel]) : null]),
      // An Instagram post's tagged location is usually the place's name.
      item.instagram?.location && titleInput.value.trim() !== item.instagram.location
        ? el('button', { type: 'button', class: 'btn btn-sm', onClick: (e) => { titleInput.value = item.instagram.location; e.currentTarget.remove(); } }, [`Use the tagged location “${item.instagram.location}” as the name`])
        : null,
      f.address,
      el('div', { class: 'price-inline' }, [f.locality, f.postalCode]),
      el('div', { class: 'price-inline' }, [f.region, f.country]),
      el('div', { class: 'price-inline' }, [f.cuisine, f.priceRange]),
      f.phone,
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Opening hours (one line each)']), placeHours]),
    ].filter(Boolean)); // native append() would print a null as "null"
    return box;
  }

  function workoutPanel() {
    const box = el('div', { class: 'recipe-panel' });
    const sourceLabel = { page: 'From the page', caption: 'From the caption', you: 'Added by you', ai: 'Read by AI', 'ai-draft': 'Drafted by AI' }[startWorkout.source] || '';
    box.append(el('div', { class: 'recipe-head' }, [el('h3', {}, ['Workout']), sourceLabel ? el('span', { class: 'recipe-facts' }, [sourceLabel]) : null]));
    const check = () => {
      const { exercises, unread } = readWorkoutLines();
      workoutHelp.textContent = unread.length ? `Keepsake can’t read ${unread.length === 1 ? 'this line' : 'these lines'} yet: ${unread.slice(0, 3).join('; ')}. Write them like “Squats 3×12” or “Plank 45s”.` : exercises.length ? pluralize(exercises.length, 'exercise', 'exercises') : 'One exercise per line, like “Squats 3×12” or “Plank 45s”.';
      workoutHelp.classList.toggle('help-error', unread.length > 0);
    };
    workoutLines.oninput = check;
    check();
    box.append(
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Exercises (one per line)']), workoutLines, workoutHelp]),
      el('div', { class: 'price-inline' }, [workoutMinutes, workoutFocus]),
    );
    return box;
  }

  function recipePanel() {
    const box = el('div', { class: 'recipe-panel' });
    const sourceLabel = { page: 'From the page', caption: 'From the caption', you: 'Added by you', ai: 'Read by AI', 'ai-draft': 'Drafted by AI: check it before you cook' }[recipe.source] || '';
    const facts = [recipe.yield, formatMinutes(recipe.totalMinutes), sourceLabel].filter(Boolean);
    box.append(el('div', { class: 'recipe-head' }, [el('h3', {}, ['Recipe']), facts.length ? el('span', { class: 'recipe-facts' }, [facts.join(' · ')]) : null]));
    if (drafted) box.append(el('p', { class: 'notice notice-warn' }, ['Your AI provider drafted this from the title and caption. It’s a suggestion, not the creator’s recipe. Edit it, then Save changes to keep it (you can undo it from the AI change log).']));
    if (recipeEditing) {
      const ing = el('textarea', { class: 'textarea', rows: '6', 'aria-label': 'Ingredients, one per line', placeholder: '200 g udon noodles\n2 tbsp white miso' });
      ing.value = (recipe.ingredients || []).join('\n');
      const steps = el('textarea', { class: 'textarea', rows: '6', 'aria-label': 'Steps, one per line', placeholder: 'Boil the noodles…' });
      steps.value = (recipe.steps || []).join('\n');
      const yieldInput = el('input', { class: 'input', placeholder: 'e.g. 2 servings', 'aria-label': 'Servings', maxlength: '60' });
      yieldInput.value = recipe.yield || '';
      const minutes = el('input', { class: 'input', inputmode: 'numeric', placeholder: 'Minutes', 'aria-label': 'Total minutes' });
      minutes.value = recipe.totalMinutes || '';
      box.append(
        el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Ingredients (one per line)']), ing]),
        el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Steps (one per line)']), steps]),
        el('div', { class: 'price-inline' }, [yieldInput, minutes]),
        el('div', { class: 'review-actions' }, [el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => {
          const lines = (t) => t.value.split('\n').map((x) => x.trim()).filter(Boolean);
          recipe = { ...recipe, ingredients: lines(ing), steps: lines(steps), yield: yieldInput.value.trim(), totalMinutes: Number(minutes.value) || null, source: drafted ? 'ai-draft' : (recipe.source === 'page' || recipe.source === 'caption' || recipe.source === 'ai') && !recipeChanged(ing, steps) ? recipe.source : 'you', drafted: recipeChanged(ing, steps) ? [] : recipe.drafted };
          recipeEditing = false;
          renderKindPanel();
        } }, ['Done editing'])]),
      );
      return box;
    }
    if (recipe.ingredients?.length) {
      box.append(el('h4', { class: 'recipe-sub' }, ['Ingredients']), el('ul', { class: 'recipe-ingredients' }, recipe.ingredients.map((x, i) => el('li', {}, [
        el('label', { class: 'check' }, [el('input', { type: 'checkbox', id: `ing-${item.id}-${i}` }), el('span', {}, [x])]),
      ]))));
    }
    if (recipe.steps?.length) box.append(el('h4', { class: 'recipe-sub' }, ['Steps']), el('ol', { class: 'recipe-steps' }, recipe.steps.map((x) => el('li', {}, [x]))));
    if (!recipe.ingredients?.length && !recipe.steps?.length) {
      box.append(el('p', { class: 'help' }, ['No ingredients or steps were found on the page or in the caption.']));
    }
    const actions = [el('button', { type: 'button', class: 'btn btn-sm', onClick: () => { recipeEditing = true; renderKindPanel(); } }, [recipe.ingredients?.length ? 'Edit recipe' : 'Add it yourself'])];
    if (!recipe.ingredients?.length && aiReady) {
      const draftBtn = el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => {
        draftBtn.disabled = true;
        draftBtn.textContent = 'Drafting…';
        try {
          const key = await store.getSecret('aiApiKey');
          const d = await draftRecipe(item, state.settings, key);
          recipe = { ...recipe, ...d };
          drafted = true;
          recipeEditing = true;
          renderKindPanel();
        } catch (e) {
          UI.toast(`No draft: ${(e && e.message) || e}`, { kind: 'danger' });
          draftBtn.disabled = false;
          draftBtn.textContent = 'Draft a recipe with AI';
        }
      } }, ['Draft a recipe with AI']);
      actions.push(draftBtn);
    }
    box.append(el('div', { class: 'review-actions' }, actions));
    return box;
  }

  function recipeChanged(ing, steps) {
    const was = item.details || {};
    return ing.value.trim() !== (was.ingredients || []).join('\n').trim() || steps.value.trim() !== (was.steps || []).join('\n').trim();
  }

  // Tags: what it's about. Shown for every kind except products (those have collections).
  const topicsInput = el('input', { class: 'input', maxlength: '240', 'aria-label': 'Tags, separated by commas', placeholder: 'e.g. AI, Video games' });
  topicsInput.value = (item.topics || []).join(', ');
  const topicsHint = el('p', { class: 'help' }, [item.topicsBy === 'guess' ? 'Guessed from the title and description. Edit them and they’re yours.' : 'Separate tags with commas.']);
  const suggest = guessTopics({ title: item.title, channel: item.details?.channel || item.details?.siteName || '', description: item.description }).filter((t) => !(item.topics || []).includes(t));
  const topicsField = el('div', { class: 'field' }, [
    el('label', { class: 'label' }, ['Tags']), topicsInput, topicsHint,
    suggest.length ? el('div', { class: 'card-topics' }, suggest.map((t) => el('button', { type: 'button', class: 'topic-chip', onClick: (e) => {
      topicsInput.value = cleanTopics([...cleanTopics(topicsInput.value), t]).join(', ');
      e.currentTarget.remove();
    } }, [`+ ${t}`]))) : null,
  ]);

  // Collections are for shopping: the field shows for products and links (and a Lifestyle save still in one).
  const colField = el('div', { class: `field ${lifestyleSave && !item.collectionId ? 'hidden' : ''}` }, [el('label', { class: 'label' }, ['Collection']), colSelect, learnRow]);
  const side = el('div', { class: 'item-detail-side' }, [
    source,
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Title']), titleInput]),
    urlField,
    priceField,
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Kind']), kindSelect]),
    colField,
    el('div', { class: 'category-box' }, [catText]),
    topicsField,
    kindPanel,
    el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Note']), noteInput]),
    el('div', { class: 'toggles' }, [toggle('favorite', 'Favorite', UI.starIcon(true)), doneToggle, toggle('purchased', 'Purchased', UI.checkIcon())]),
    igInfo,
    aiBox,
    relatedNode(item),
    historyNode(item),
  ]);

  const body = el('div', { class: 'item-detail' }, [el('div', {}, [picWrap, thumbRow]), side]);
  renderKindPanel();

  await UI.openModal({
    title: 'Edit save',
    body,
    wide: true,
    actions: [
      { label: 'Delete', danger: true, closes: false, onClick: async (close) => {
        const ok = await deleteItems([item]);
        if (ok) close(true);
        return false;
      } },
      { label: 'Cancel', quiet: true, value: false },
      { label: 'Save changes', primary: true, onClick: async (close) => {
        const patch = {
          title: sanitizeText(titleInput.value, 200) || item.title,
          note: sanitizeText(noteInput.value, 1000),
          favorite: flags.favorite,
          purchased: flags.purchased,
          kind: kindSelect.value,
          status: flags.done ? 'done' : item.status === 'done' ? 'saved' : item.status || 'saved',
        };
        const topics = cleanTopics(topicsInput.value);
        if (topics.join('\n') !== (item.topics || []).join('\n')) {
          patch.topics = topics;
          patch.topicsBy = topics.length ? 'you' : '';
        }
        if (kindSelect.value === 'recipe') patch.details = sanitizeDetails('recipe', recipe);
        else if (kindSelect.value === 'workout') {
          const { exercises, unread } = readWorkoutLines();
          if (unread.length) throw new Error('Some exercise lines can’t be read. Fix or remove them first.');
          const next = { exercises, durationMinutes: Number(workoutMinutes.value) || null, focus: workoutFocus.value.trim() };
          const was = sanitizeDetails('workout', startWorkout);
          const same = JSON.stringify(sanitizeDetails('workout', { ...next, source: was.source }).exercises) === JSON.stringify(was.exercises);
          const fromPrefill = prefilledText && workoutLines.value.trim() === prefilledText.trim();
          // An AI draft you leave as it is stays marked; one you change is yours.
          patch.details = sanitizeDetails('workout', { ...next, source: same && startKind === 'workout' ? was.source : fromPrefill ? (item.type === 'instagram' ? 'caption' : 'page') : 'you', drafted: same && startKind === 'workout' ? was.drafted : [] });
        } else if (kindSelect.value === 'place') {
          const next = Object.fromEntries(Object.entries(placeFields).map(([k, i]) => [k, i.value.trim()]));
          next.hours = placeHours.value.split('\n').map((x) => x.trim()).filter(Boolean);
          const was = sanitizeDetails('place', startPlace);
          const changed = Object.keys(placeFields).some((k) => next[k] !== (was[k] || '')) || next.hours.join('\n') !== (was.hours || []).join('\n');
          // A moved address makes the page's pin wrong, so the pin goes with it (maps then search by address).
          const moved = ['address', 'locality', 'postalCode', 'country'].some((k) => next[k] !== (was[k] || ''));
          patch.details = sanitizeDetails('place', { ...was, ...next, lat: moved ? null : was.lat, lng: moved ? null : was.lng, source: changed || startKind !== 'place' ? 'you' : was.source });
        } else if (kindSelect.value === 'media' || kindSelect.value === 'book') {
          const k = kindSelect.value;
          const f = shelfFields;
          const year = f.year.value.trim();
          if (year && !/^\d{4}$/.test(year)) throw new Error('Write the year as four digits, like 1999.');
          const was = k === startKind ? sanitizeDetails(k, startShelf) : sanitizeDetails(k, {});
          const next = k === 'media'
            ? { ...was, format: f.format.value, year: Number(year) || null, director: f.director.value.trim(), runtimeMinutes: Number(f.runtime.value) || null, seasons: Number(f.seasons.value) || null }
            : { ...was, author: f.author.value.trim(), year: Number(year) || null, pages: Number(f.pages.value) || null };
          const changed = JSON.stringify(sanitizeDetails(k, { ...next, source: was.source })) !== JSON.stringify(was);
          patch.details = sanitizeDetails(k, { ...next, source: changed || k !== startKind ? 'you' : was.source });
        } else if (kindSelect.value === 'video' || kindSelect.value === 'article') {
          const k = kindSelect.value;
          const f = mediaFields;
          const len = f.length.value.trim();
          if (k === 'video' && len && !secondsFrom(len)) throw new Error('Write the length like 12:30 or 1:05:00.');
          const was = k === startKind ? sanitizeDetails(k, startMedia) : sanitizeDetails(k, {});
          const next = k === 'video'
            ? { ...was, channel: f.channel.value.trim(), durationSeconds: secondsFrom(len), publishedOn: f.published.value }
            : { ...was, author: f.author.value.trim(), readingMinutes: Number(f.minutes.value) || null, publishedOn: f.published.value };
          const changed = JSON.stringify(sanitizeDetails(k, { ...next, source: was.source })) !== JSON.stringify(was);
          patch.details = sanitizeDetails(k, { ...next, source: changed || k !== startKind ? 'you' : was.source });
        } else if (kindSelect.value !== startKind) patch.details = {};
        const priceText = priceInput.value.trim();
        if (!priceText) {
          patch.price = null;
          patch.currency = sanitizeText(currencyInput.value, 4).toUpperCase();
        } else {
          const parsed = parsePrice(priceText, currencyInput.value);
          if (!parsed) throw new Error('That price doesn’t look like a number.');
          patch.price = parsed.amount;
          patch.currency = sanitizeText(currencyInput.value, 4).toUpperCase() || parsed.currency || '';
        }
        const nextUrl = urlInput.value.trim();
        if (nextUrl !== shownUrl) {
          if (nextUrl && !/^https?:\/\//i.test(nextUrl)) throw new Error('A link has to start with http:// or https://.');
          const clash = nextUrl ? await store.findByUrl(nextUrl) : null;
          if (clash && clash.id !== item.id) throw new Error(`Another item (“${cut(clash.title, 40)}”) already has that link.`);
          patch.url = nextUrl;
          patch.canonicalUrl = nextUrl;
          patch.sourceUrl = nextUrl;
          // Let an auto-derived retailer follow the new host; a name you set stays.
          if (!item.retailer || item.retailer === prettyRetailer(hostnameOf(item.url))) patch.retailer = prettyRetailer(hostnameOf(nextUrl));
        }
        if (chosenImage && chosenImage !== item.image) {
          patch.image = chosenImage;
          patch.images = [chosenImage, ...(item.images || []).filter((u) => u !== chosenImage)];
        }
        await store.updateItem(item.id, patch);
        // A new Lifestyle kind: fill in what's missing (AI if on, lookups if on).
        if (patch.kind !== startKind && hasOwnView(patch.kind)) send({ type: MSG.FILL_ITEM, itemId: item.id });
        if (drafted && patch.details?.source === 'ai-draft') {
          // A kept AI draft is logged like any AI change, so it can be undone later.
          await store.appendAiLog([{ id: crypto.randomUUID(), runId: `draft-${item.id}`, at: new Date().toISOString(), itemId: item.id, itemTitle: patch.title,
            changes: [{ field: 'recipe', from: 'no recipe', to: `${patch.details.ingredients.length} ingredients, ${patch.details.steps.length} steps` }],
            before: { details: item.details || {} }, after: { details: patch.details }, reason: 'Recipe drafted on request', undone: false }]);
        }
        // Into a Lifestyle kind from shopping: it leaves its collection (collections are for shopping).
        const intoLifestyle = hasOwnView(kindSelect.value) && !hasOwnView(startKind) && item.collectionId;
        if (intoLifestyle) {
          await store.updateItem(item.id, { collectionId: null, needsReview: false }, { by: 'kind' });
        } else if (colSelect.value === '__none') {
          await store.updateItem(item.id, { collectionId: null, needsReview: false });
        } else if (colSelect.value && colSelect.value !== item.collectionId) {
          await store.moveItems([item.id], colSelect.value, { learn: learnCheck.checked ? 'strong' : 'light' });
        }
        UI.toast('Saved.', { duration: 1800 });
        close(true);
        return false;
      } },
    ],
  });
}

// What happened to a save: when and where it was saved, its first title, the last edit and open, and
// every AI change still in the log, each with Undo.
function historyNode(item) {
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const from = item.type === 'instagram' ? 'Instagram' : item.retailer || item.host || 'a page';
  const list = el('ul', { class: 'history-list' }, [
    el('li', {}, [el('span', { class: 'history-when' }, [when(item.createdAt)]), `Saved from ${from}`]),
    item.originalTitle && item.originalTitle !== item.title ? el('li', {}, [el('span', { class: 'history-when' }, ['First title']), `“${item.originalTitle}”`]) : null,
    item.updatedAt && Date.parse(item.updatedAt) - Date.parse(item.createdAt) > 60000 ? el('li', {}, [el('span', { class: 'history-when' }, [when(item.updatedAt)]), item.userFields?.length ? `Edited (${item.userFields.filter((f) => f !== 'collectionId').join(', ') || 'collection'})` : 'Changed']) : null,
    item.openedAt ? el('li', {}, [el('span', { class: 'history-when' }, [when(item.openedAt)]), 'Last opened']) : null,
  ]);
  const box = el('details', { class: 'history' }, [el('summary', {}, ['History']), list]);
  // AI changes come from the change log (kept on this device, never exported).
  store.getAiLog().then((log) => {
    for (const e of log.filter((x) => x.itemId === item.id && !x.undone).slice(-10).reverse()) {
      const what = (e.changes || []).map((c) => `${c.field}: ${cut(String(c.from ?? ''), 40) || '—'} → ${cut(String(c.to ?? ''), 40) || '—'}`).join('; ');
      const undo = el('button', { type: 'button', class: 'link-btn', onClick: async () => {
        await undoEntries(ctx, [e]);
        undo.replaceWith(el('span', { class: 'muted' }, ['Undone']));
        UI.toast('AI change undone. Reopen the details to see it.', { duration: 2500 });
      } }, ['Undo']);
      list.append(el('li', {}, [el('span', { class: 'history-when' }, [when(e.at)]), `AI changed ${what}`, ' ', undo]));
    }
  }).catch(() => {});
  return box;
}

// One "where to buy" row: name, retailer, price, open link, and an action that
// turns it into a real product item linked back to the post.
function foundRow(item, c) {
  const price = c.price !== null && c.price !== undefined ? formatPrice(c.price, c.currency || 'USD') : '';
  return el('div', { class: 'found-row' }, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'found-name' }, [c.name || c.url || 'Unnamed']),
      el('div', { class: 'found-meta' }, [[c.brand, c.retailer || (c.url ? hostOf(c.url) : ''), price].filter(Boolean).join(' · ') || (c.url ? hostOf(c.url) : '')]),
      c.note ? el('div', { class: 'found-meta muted' }, [c.note]) : null,
    ]),
    c.url ? el('a', { class: 'btn btn-sm', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, [UI.externalIcon(), 'Open']) : null,
    c.url ? el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => saveCandidateAsItem(item, c) }, ['Save as product']) : null,
  ]);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Turn a found listing into its own product item, kept next to the post it came from.
async function saveCandidateAsItem(post, c) {
  const existing = await store.findByUrl(c.url);
  if (existing) {
    UI.toast('That link is already saved.', { action: { label: 'Open', onClick: () => openItem(existing.id) } });
    return;
  }
  const item = await store.addItem({
    title: c.name || hostOf(c.url),
    url: c.url,
    price: c.price ?? null,
    currency: c.currency || '',
    retailer: c.retailer || hostOf(c.url),
    description: post.instagram?.caption ? cut(post.instagram.caption, 300) : '',
    image: post.image || '',
    images: post.images || [],
    type: 'product',
    collectionId: post.collectionId,
    relatedItemId: post.id,
    confidence: 1,
    categorizationSource: 'manual',
    categorizationReason: `Found from the Instagram post “${cut(post.title, 40)}”`,
  });
  UI.toast(`Saved “${cut(item.title, 40)}” as a product.`, { action: { label: 'Open', onClick: () => openItem(item.id) } });
}

function renderAiBox(box, item) {
  UI.holdHeight(box);
  clear(box);
  const ai = state.settings?.ai;
  const eligible = item.type === 'instagram' || item.type === 'inspiration';
  if (!eligible) return;
  if (!ai?.on) {
    box.append(el('div', { class: 'help' }, ['Want Keepsake to work out what product this post shows and find where to buy it? Turn on Optional AI (it uses your own API key).']));
    return;
  }
  const s = item.ai;
  const runBtn = el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: async () => {
    const results = await analyzeItems(ctx, [item], { web: true });
    if (results && results[0]) renderAiBox(box, { ...item, ai: results[0] });
  } }, [s ? 'Search again' : 'Find this product online']);
  const idBtn = el('button', { type: 'button', class: 'btn btn-sm', onClick: async () => {
    const results = await analyzeItems(ctx, [item], { web: false });
    if (results && results[0]) renderAiBox(box, { ...item, ai: results[0] });
  } }, ['Identify only']);
  const children = [el('div', { class: 'row' }, [el('strong', { class: 'grow' }, ['Find the product']), idBtn, runBtn])];
  const who = s?.provider === 'anthropic' ? 'Anthropic' : s?.provider === 'openai' ? 'OpenAI' : 'your AI provider';
  if (s && s.candidates?.length) {
    children.push(el('p', { class: 'help' }, [`Found by ${who} via web search on ${formatDate(s.searchedAt || s.analyzedAt)}. These are the model’s best matches and may be the wrong item — check the listing before buying. Links come from its search results; any it invented were dropped.`]));
    children.push(el('div', { class: 'found-list' }, s.candidates.map((c) => foundRow(item, c))));
  }
  if (s && s.suggestions?.length) {
    children.push(el('p', { class: 'help' }, [s.candidates?.length ? 'What it thinks the item is:' : `Suggested by ${who} on ${formatDate(s.analyzedAt)}. Guesses, not verified listings.`]));
    for (const g of s.suggestions) {
      const phrases = g.searchPhrases && g.searchPhrases.length ? g.searchPhrases : [g.name].filter(Boolean);
      children.push(el('div', { class: 'suggestion' }, [
        el('div', { class: 'suggestion-name' }, [g.name || 'Unnamed suggestion']),
        el('div', { class: 'suggestion-meta' }, [[g.brand, g.category].filter(Boolean).join(' · ')]),
        g.note ? el('div', { class: 'suggestion-meta' }, [g.note]) : null,
        el('div', { class: 'suggestion-actions' }, phrases.slice(0, 3).map((p) => el('a', { class: 'btn btn-sm', href: `https://www.google.com/search?q=${encodeURIComponent(p)}`, target: '_blank', rel: 'noopener noreferrer' }, [UI.externalIcon(), `Search the web: ${cut(p, 32)}`]))),
      ]));
    }
  }
  if (!s || (!s.candidates?.length && !s.suggestions?.length)) {
    children.push(el('p', { class: 'help' }, ['Sends this post’s stored thumbnail and caption to your AI provider, asks it what the product is, and (with web search on) looks for real listings with names, prices and links. You’ll see exactly what leaves the browser before it’s sent.']));
  }
  box.append(el('div', { class: 'category-box' }, children));
}

// --- collections ---------------------------------------------------------------------------------

function collectionHero(col) {
  const count = state.items.filter((i) => i.collectionId === col.id && isActive(i)).length;
  const cover = col.coverImage || state.items.find((i) => i.collectionId === col.id && i.image && isActive(i))?.image || '';
  const coverNode = el('div', { class: 'cover' }, cover ? [el('img', { src: cover, alt: '', onError: (e) => e.target.remove() })] : [UI.initialFor(col.name)]);
  coverNode.style.background = col.color || '#8A9A88';
  const actions = [
    el('button', { type: 'button', class: 'btn btn-sm', 'aria-pressed': col.pinned ? 'true' : 'false', onClick: () => togglePin(col) }, [UI.pinIcon(col.pinned), col.pinned ? 'Pinned' : 'Pin']),
    el('button', { type: 'button', class: 'btn btn-sm', onClick: () => editCollection(col) }, ['Keywords']),
    el('button', { type: 'button', class: 'btn btn-sm btn-danger', onClick: () => deleteCollection(col) }, ['Delete']),
  ];
  const keywords = col.keywords || [];
  return el('div', { class: 'collection-hero' }, [
    coverNode,
    el('div', { class: 'collection-hero-text' }, [
      collectionNameField(col),
      el('p', {}, [col.description || 'No description yet.', ` · ${pluralize(count, 'item', 'items')}`]),
      keywords.length ? el('div', { class: 'chips' }, keywords.slice(0, 12).map((k) => el('span', { class: 'pill' }, [k]))) : null,
      el('div', { class: 'collection-hero-actions' }, actions),
    ]),
  ]);
}

async function newCollection() {
  const name = await UI.promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Garden', confirmLabel: 'Create' });
  if (!name) return;
  const collection = await createNamedCollection(name);
  if (collection) navigate(`#c/${collection.id}`);
}

// Creates the collection the user named. When an existing one is close but not the
// same name ("Food" vs Kitchen, which covers food), asks which they meant rather than
// quietly using the existing one. Resolves the collection, or null if cancelled.
async function createNamedCollection(name) {
  const near = nearMatchCollection(name, state.collections);
  if (near) {
    const other = near.collection.name;
    const choice = await UI.openModal({
      title: `Create “${name}” or use “${other}”?`,
      body: el('p', { class: 'modal-text' }, [near.matched
        ? `You already have “${other}”, which also covers “${near.matched}”.`
        : `You already have a collection with a similar name, “${other}”.`]),
      actions: [
        { label: 'Cancel', quiet: true, value: null },
        { label: `Use “${other}”`, value: 'use' },
        { label: `Create “${name}”`, primary: true, value: 'create', autofocus: true },
      ],
    });
    if (choice === 'use') return near.collection;
    if (choice !== 'create') return null;
  }
  const { collection, existed } = await store.createCollection({ name });
  if (existed) UI.toast(`“${collection.name}” already exists — using it.`);
  return collection;
}

// A newly pinned collection goes to the very top; pinned ones keep their dragged order.
async function togglePin(col) {
  const pinned = !col.pinned;
  await store.updateCollection(col.id, { pinned });
  if (pinned) await store.reorderCollections([col.id, ...pinnedIds().filter((id) => id !== col.id)]);
  UI.toast(pinned ? `Pinned “${col.name}” to the top.` : `Unpinned “${col.name}”.`, { duration: 2250 });
}

// The collection's name is itself the text field. Save (✓ or Enter) and cancel (✕ or
// Escape) appear only while the name differs from the saved one.
function collectionNameField(col) {
  const input = el('input', { class: 'collection-name-input', value: col.name, maxlength: '80', spellcheck: 'false', 'aria-label': 'Collection name' });
  const save = el('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Save name', title: 'Save', onClick: () => commit() }, [UI.checkIcon()]);
  const cancel = el('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Cancel', title: 'Cancel', onClick: () => revert() }, [UI.closeIcon()]);
  const buttons = el('span', { class: 'collection-name-actions', hidden: true }, [save, cancel]);
  const dirty = () => input.value.trim() !== col.name;
  const sync = () => { buttons.hidden = !dirty(); };
  const revert = () => {
    input.value = col.name;
    sync();
    input.blur();
  };
  const commit = async () => {
    const name = sanitizeText(input.value, 80);
    if (!name) return revert();
    if (name === col.name) return sync();
    col.name = name;
    input.value = name;
    sync();
    input.blur();
    await store.updateCollection(col.id, { name });
  };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      revert();
    }
  });
  return el('div', { class: 'collection-name-field' }, [input, buttons]);
}

async function editCollection(col) {
  const kw = el('textarea', { class: 'textarea', rows: '4', placeholder: 'One keyword or phrase per line — e.g. lamp, side table, throw pillow', 'aria-label': 'Keywords' });
  kw.value = (col.keywords || []).join('\n');
  const desc = el('textarea', { class: 'textarea', rows: '2', maxlength: '300', placeholder: 'Description (optional)', 'aria-label': 'Description' });
  desc.value = col.description || '';
  const coverInput = el('input', { class: 'input', type: 'url', placeholder: 'https://… (leave empty to use the newest item’s image)', 'aria-label': 'Cover image URL' });
  coverInput.value = col.coverImage || '';
  await UI.openModal({
    title: `Edit “${col.name}”`,
    body: [
      el('div', { class: 'field' }, [
        el('label', { class: 'label' }, ['Keywords']),
        kw,
        el('p', { class: 'help' }, ['Items whose title or page text contains one of these are filed here. The more specific phrase wins: “coffee cup” here beats “coffee” in another collection.']),
      ]),
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Description']), desc]),
      el('div', { class: 'field' }, [el('label', { class: 'label' }, ['Cover image']), coverInput]),
    ],
    actions: [
      { label: 'Cancel', quiet: true },
      { label: 'Save', primary: true, onClick: async () => {
        const keywords = [...new Set(kw.value.split(/\n|,/).map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 40);
        const moveFrom = await confirmSharedKeywords(col, keywords);
        if (!moveFrom) return false;
        for (const [otherId, words] of moveFrom) {
          const other = ctx.collectionById(otherId);
          if (other) await store.updateCollection(otherId, { keywords: (other.keywords || []).filter((k) => !words.includes(k)) });
        }
        await store.updateCollection(col.id, { description: desc.value, keywords, coverImage: coverInput.value.trim() });
        UI.toast('Collection updated.', { duration: 1500 });
      } },
    ],
  });
}

// The exact same keyword on two collections ties, and tied items go to Review. When
// newly added keywords already belong to another collection, offer to move them here.
// Resolves a Map of collectionId → keywords to take from it, or null to keep editing.
async function confirmSharedKeywords(col, keywords) {
  const added = keywords.filter((k) => !(col.keywords || []).includes(k));
  const shared = new Map();
  for (const other of state.collections) {
    if (other.id === col.id) continue;
    const words = added.filter((k) => (other.keywords || []).includes(k));
    if (words.length) shared.set(other.id, words);
  }
  if (!shared.size) return shared;
  const lines = [...shared].map(([id, words]) => `${words.map((w) => `“${w}”`).join(', ')} ${words.length === 1 ? 'is' : 'are'} already ${words.length === 1 ? 'a keyword' : 'keywords'} of “${ctx.collectionById(id)?.name || 'another collection'}”.`);
  const choice = await UI.openModal({
    title: 'Keyword already in use',
    body: [
      ...lines.map((t) => el('p', { class: 'modal-text' }, [t])),
      el('p', { class: 'help' }, ['A keyword can only send items to one collection. If both keep it, matching items wait in Review.']),
    ],
    actions: [
      { label: 'Go back', quiet: true, value: 'back' },
      { label: 'Keep in both', value: 'both' },
      { label: `Move to “${col.name}”`, primary: true, value: 'move', autofocus: true },
    ],
  });
  if (choice === 'move') return shared;
  if (choice === 'both') return new Map();
  return null;
}

async function deleteCollection(col) {
  const count = state.items.filter((i) => i.collectionId === col.id).length;
  const deleteItemsCheck = el('input', { type: 'checkbox' });
  const extra = count ? el('label', { class: 'check' }, [deleteItemsCheck, el('span', {}, [`Also delete the ${pluralize(count, 'item', 'items')} inside (otherwise they'll be uncategorized, waiting in Review)`])]) : null;
  const ok = await UI.confirmDialog({ title: `Delete “${col.name}”?`, message: count ? `This collection holds ${pluralize(count, 'item', 'items')}.` : 'This collection is empty.', confirmLabel: 'Delete collection', danger: true, extra });
  if (!ok) return;
  await store.deleteCollection(col.id, { deleteItems: !!deleteItemsCheck.checked });
  UI.toast('Collection deleted.');
  navigate('#all');
}

// --- home ------------------------------------------------------------------------------------------

// A calm starting point: search, anything waiting on the user, the latest saves, and
// a handful of collections. Everything else is one click away.
const COME_BACK_DAYS = 42;

function renderHome(view) {
  const live = state.items.filter(isActive);
  if (!live.length) {
    view.append(nothingSavedState());
    return;
  }
  const page = el('div', { class: 'home' });
  const search = el('input', { class: 'input', id: 'homeSearch', type: 'search', placeholder: 'Search your saves', 'aria-label': 'Search your saves', autocomplete: 'off' });
  // Typing starts a search of the whole Library.
  search.addEventListener('input', () => {
    const q = search.value.trim();
    if (!q) return;
    state.search = q;
    state.shown = 120;
    state.focusSearch = true;
    navigate('#all');
  });
  page.append(searchField(search, 'search home-search'));

  // Only shown when something is waiting, so a caught-up Home stays quiet.
  const toReview = live.filter(needsCollection).length;
  if (toReview) {
    page.append(el('a', { class: 'home-attention', href: '#review' }, [
      el('span', { class: 'home-attention-dot', 'aria-hidden': 'true' }),
      el('span', {}, [`${pluralize(toReview, 'save', 'saves')} waiting to be filed`]),
      el('span', { class: 'home-attention-go' }, ['Review →']),
    ]));
  }

  const backlogNote = aiBacklogNote(live, { home: true });
  if (backlogNote) page.append(backlogNote);

  const recent = live.slice(0, 8);
  page.append(homeSection('Recently saved', { href: '#all', label: 'Library →' },
    el('div', { class: 'home-recent', role: 'list' }, recent.map((item) => cardNode(item)))));

  // Come back to: saves you haven't finished and haven't opened for six weeks or more. Local, and it can
  // be turned off in Settings → Appearance.
  if (state.settings?.home?.comeBack !== false) {
    const cutoff = new Date(Date.now() - COME_BACK_DAYS * 864e5).toISOString();
    const back = live.filter((i) => i.status !== 'done' && !i.purchased && i.createdAt < cutoff && (!i.openedAt || i.openedAt < cutoff))
      .sort((a, b) => ((a.openedAt || a.createdAt) < (b.openedAt || b.createdAt) ? -1 : 1)).slice(0, 6);
    if (back.length) {
      page.append(homeSection('Come back to', null,
        el('div', { class: 'home-recent home-comeback', role: 'list' }, back.map((item) => cardNode(item)))));
    }
  }

  const stats = collectionStats();
  const tiles = homeCollections(stats);
  if (tiles.length) {
    page.append(homeSection('Collections', { href: '#collections', label: `All ${state.collections.length} →` },
      el('div', { class: 'tile-row' }, tiles.map((c) => collectionTile(c, stats)))));
  }
  view.append(page);
}

// The magnifier-and-input search box, same as the toolbar's.
function searchField(input, className) {
  const box = el('label', { class: className }, [input]);
  box.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>');
  return box;
}

function homeSection(title, link, body) {
  return el('section', { class: 'home-section' }, [
    el('div', { class: 'home-section-head' }, [
      el('h2', { class: 'home-section-title' }, [title]),
      link ? el('a', { class: 'home-section-link', href: link.href }, [link.label]) : null,
    ]),
    body,
  ]);
}

// A collection as a cover tile: a collage of its latest images, name and count.
function collectionTile(c, stats) {
  const s = stats.get(c.id);
  const images = [...new Set([c.coverImage, ...(s?.images || [])].filter(Boolean))].slice(0, 4);
  const art = el('div', { class: 'tile-art' });
  // Lays the collage out for however many images are left; none left shows the
  // collection's initial on its color.
  const layout = () => {
    const left = art.querySelectorAll('img').length;
    art.className = `tile-art tile-art-${left}`;
    if (!left) {
      art.style.background = c.color || '#8A9A88';
      art.append(el('span', { class: 'tile-initial' }, [UI.initialFor(c.name)]));
    }
  };
  for (const src of images) {
    art.append(el('img', { src, alt: '', loading: 'lazy', decoding: 'async', onError: (e) => { e.target.remove(); layout(); } }));
  }
  layout();
  return el('div', { class: `tile ${c.pinned ? 'pinned' : ''}` }, [
    el('a', { class: 'tile-hit', href: `#c/${c.id}` }, [
      art,
      el('div', { class: 'tile-body' }, [
        el('span', { class: 'tile-name' }, [c.name]),
        el('span', { class: 'tile-count' }, [s?.count ? String(s.count) : 'Empty']),
      ]),
    ]),
    el('button', {
      type: 'button',
      class: `tile-pin ${c.pinned ? 'is-pinned' : ''}`,
      'aria-pressed': c.pinned ? 'true' : 'false',
      'aria-label': c.pinned ? `Unpin ${c.name}` : `Pin ${c.name} to the top`,
      title: c.pinned ? 'Unpin' : 'Pin to the top',
      onClick: () => togglePin(c),
    }, [UI.pinIcon(c.pinned)]),
  ]);
}

// --- all collections ---------------------------------------------------------------------------------

const COLLECTION_SORTS = {
  recent: 'Recently saved to',
  name: 'A–Z',
  size: 'Most saves',
};

// Every collection, pinned first. Built for hundreds: a name search, three sorts, and
// images that load only as tiles scroll into view.
// The Library's two tabs: every save, or every collection.
function libraryTabs(current) {
  const tab = (value, label, href) => el('a', { class: `library-tab ${current === value ? 'on' : ''}`, href, role: 'tab', 'aria-selected': current === value ? 'true' : 'false' }, [label]);
  return el('div', { class: 'library-tabs', role: 'tablist', 'aria-label': 'Library' }, [tab('saves', 'Saves', '#all'), tab('collections', `Collections${state.collections.length ? ` · ${state.collections.length}` : ''}`, '#collections')]);
}

function renderCollections(view) {
  view.append(libraryTabs('collections'));
  const page = el('div', { class: 'collections-page' });
  const grid = el('div', { class: 'tile-grid' });
  const stats = collectionStats();
  const fill = () => {
    clear(grid);
    const q = state.colSearch.toLowerCase();
    let list = state.collections.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.keywords || []).some((k) => k.toLowerCase().includes(q)));
    const pinned = list.filter((c) => c.pinned);
    let rest = list.filter((c) => !c.pinned);
    if (state.colSort === 'name') rest.sort((a, b) => a.name.localeCompare(b.name));
    else if (state.colSort === 'size') rest.sort((a, b) => (stats.get(b.id)?.count || 0) - (stats.get(a.id)?.count || 0) || a.name.localeCompare(b.name));
    else rest = byRecentActivity(rest, stats);
    list = [...pinned, ...rest];
    if (!list.length) {
      grid.append(UI.emptyState({ title: 'No matching collections', message: `Nothing is called “${state.colSearch}”.`, icon: UI.folderIcon() }));
      return;
    }
    for (const c of list) grid.append(collectionTile(c, stats));
  };
  const search = el('input', { class: 'input', id: 'collectionSearch', type: 'search', placeholder: 'Find a collection', 'aria-label': 'Find a collection', value: state.colSearch, autocomplete: 'off' });
  search.addEventListener('input', debounce(() => {
    state.colSearch = search.value.trim();
    fill();
  }, 100));
  const sort = el('select', { class: 'select select-sm', 'aria-label': 'Sort collections' },
    Object.entries(COLLECTION_SORTS).map(([value, text]) => el('option', { value, text })));
  sort.value = state.colSort;
  sort.addEventListener('change', () => {
    state.colSort = sort.value;
    fill();
  });
  page.append(el('div', { class: 'collections-controls' }, [
    searchField(search, 'search'),
    sort,
    el('span', { class: 'grow' }),
    el('button', { type: 'button', class: 'btn btn-sm', onClick: () => newCollection() }, ['＋ New collection']),
  ]));
  page.append(grid);
  fill();
  view.append(page);
}

// --- review queue --------------------------------------------------------------------------------

function renderReview(view) {
  const items = state.items.filter((i) => needsCollection(i) && isActive(i));
  const page = el('div', { class: 'page page-wide' });
  page.append(el('p', { class: 'page-intro' }, ['Keepsake wasn’t sure where these belong. Pick one of the suggestions, or select a row and press 1, 2 or 3, and Keepsake learns from your choice.']));
  if (items.length && state.settings?.ai?.on) {
    page.append(el('div', { class: 'actions-row review-ai' }, [
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => runAiCleanup(ctx, { scope: 'review' }) }, [`Fix all ${items.length} with AI`]),
      el('span', { class: 'help' }, ['Tidies titles and prices, and files each item where the AI is confident. Every change can be undone.']),
    ]));
  }
  if (!items.length) {
    page.append(UI.emptyState({ title: 'Nothing to review', message: 'Uncategorized saves show up here. You’re all caught up.', icon: UI.checkIcon() }));
    view.append(page);
    return;
  }
  const list = el('div', { class: 'review-list', role: 'list' });
  const regular = ctx.regularCollections();
  const counts = new Map();
  for (const i of state.items) if (i.collectionId) counts.set(i.collectionId, (counts.get(i.collectionId) || 0) + 1);
  for (const item of items) {
    const cls = classify(item, { collections: state.collections, prefs: state.prefs, settings: state.settings });
    const suggestions = topSuggestions(cls, regular, counts);
    const select = UI.selectInput({
      value: '',
      options: [
        { value: '', label: 'Somewhere else…' },
        ...lifestyleOptions(),
        ...regular.map((c) => ({ value: c.id, label: c.name, group: 'Collections' })),
        { value: '__new', label: '+ New collection…', group: 'Collections' },
      ],
      onChange: async (v) => {
        if (!v) return;
        if (v === '__new') {
          select.value = '';
          const name = await UI.promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Garden', confirmLabel: 'Create' });
          if (!name) return;
          const collection = await createNamedCollection(name);
          if (collection) await fileItem(item, collection.id);
          return;
        }
        await fileItem(item, v);
      },
      label: `Collection for ${item.title}`,
    });
    const fileTo = (s) => {
      row.classList.add('is-filed');
      return fileItem(item, s.isNew ? `new:${s.taxonomyKey}` : s.collectionId);
    };
    const row = el('div', { class: 'review-row', tabindex: '0', role: 'listitem', 'aria-label': `${item.title}. Press 1 to ${suggestions.length} to file.`, onKeydown: (e) => {
      if (e.target !== row) return;
      const n = Number(e.key);
      if (n >= 1 && n <= suggestions.length) {
        e.preventDefault();
        const next = row.nextElementSibling;
        fileTo(suggestions[n - 1]).then(() => next && next.focus && next.focus());
      }
    } }, [
      UI.pictureNode({ src: item.image, title: item.title, className: 'review-pic' }),
      el('div', {}, [
        el('div', { class: 'review-title' }, [item.title]),
        el('div', { class: 'review-reason' }, [[item.retailer || item.host, item.categorizationReason || cls.reason].filter(Boolean).join(' · ')]),
        el('div', { class: 'review-actions' }, [
          ...suggestions.map((s, i) => el('button', { type: 'button', class: 'suggest-chip', 'aria-keyshortcuts': String(i + 1), onClick: () => fileTo(s) }, [el('kbd', {}, [String(i + 1)]), s.collectionName])),
          select,
          el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => openSave(item.id) }, ['Details']),
          el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: () => deleteItems([item]) }, ['Delete']),
        ]),
      ]),
    ]);
    list.append(row);
  }
  page.append(list);
  view.append(page);
}

// The three most likely collections for an item: best keyword matches first
// (including default categories not created yet), then padded with the
// collections the user files into most so there are always three to pick from.
function topSuggestions(cls, collections, counts) {
  const picks = [];
  const seen = new Set();
  const add = (s) => {
    const key = s.isNew ? `new:${s.taxonomyKey}` : s.collectionId;
    if (!key || seen.has(key) || picks.length >= 3) return;
    seen.add(key);
    picks.push(s);
  };
  for (const a of cls.alternatives || []) {
    if (a.isNew ? a.taxonomyKey : a.collectionId) add(a);
  }
  const byUse = [...collections].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
  for (const c of byUse) add({ collectionId: c.id, collectionName: c.name, isNew: false });
  return picks;
}

// Lifestyle views as picker options ("kind:place" → Places).
const lifestyleOptions = () => LIFESTYLE().map((k) => ({ value: `kind:${k.value}`, label: k.plural, group: 'Lifestyle' }));

// Puts saves where you chose: a Lifestyle view (each becomes that kind, its details worked out from
// what it holds) or a collection (a Lifestyle save going there becomes something to buy).
async function putItems(items, target, { learn = 'light' } = {}) {
  if (target.startsWith('kind:')) {
    const kind = target.slice(5);
    for (const it of items) {
      await store.updateItem(it.id, kindChangePatch(it, kind, { yours: true }), { by: 'kind' });
      send({ type: MSG.FILL_ITEM, itemId: it.id });
    }
    UI.toast(`Moved to ${kindInfo(kind).plural}.`);
    return;
  }
  for (const it of items) if (hasOwnView(kindOf(it))) await store.updateItem(it.id, { kind: shoppingKindFor(it), details: {} }, { by: 'kind' });
  await store.moveItems(items.map((i) => i.id), target, { learn });
  const col = await store.getCollection(target);
  UI.toast(`Moved to ${col ? col.name : 'collection'}.`);
}

async function fileItem(item, collectionId) {
  if (typeof collectionId === 'string' && collectionId.startsWith('kind:')) return putItems([item], collectionId);
  if (typeof collectionId === 'string' && collectionId.startsWith('new:')) {
    const created = await store.ensureCollectionForTaxonomy(collectionId.slice(4));
    if (!created) return;
    collectionId = created.id;
  }
  await store.moveItems([item.id], collectionId, { learn: 'light' });
  const col = await store.getCollection(collectionId);
  UI.toast(`Moved to ${col ? col.name : 'collection'}.`);
}

// --- welcome ---------------------------------------------------------------------------------------

function renderWelcome(view) {
  if (state.settings && !state.settings.onboardingDone) store.updateSettings({ onboardingDone: true });
  const w = el('div', { class: 'welcome' }, [
    el('div', { class: 'welcome-hero' }, [
      el('h2', {}, ['Keep what catches your eye.']),
      el('p', {}, ['Keepsake saves products from any site into collections that sort themselves. Everything stays in this browser — no account, no cloud, no tracking.']),
      el('div', { class: 'actions-row', style: { marginTop: '18px' } }, [
        el('button', { type: 'button', class: 'btn btn-primary', onClick: () => navigate('#home') }, ['Start saving']),
        el('button', { type: 'button', class: 'btn', onClick: async () => { await loadSample(); navigate('#home'); } }, ['Load sample data']),
        el('button', { type: 'button', class: 'btn btn-quiet', onClick: () => navigate('#privacy') }, ['Read the privacy promise']),
      ]),
    ]),
    el('div', { class: 'steps' }, [
      step(1, 'Pin the icon', 'Click the puzzle-piece in Chrome’s toolbar and pin Keepsake so it’s one click away. Alt+Shift+K opens it too.'),
      step(2, 'Save from any page', 'On a product page, click the icon. Keepsake reads the title, price and image and saves it straight to the right collection when it’s sure; otherwise it shows you first.'),
      step(3, 'Let it learn', 'Move an item and Keepsake remembers. Unsure saves wait in Review instead of guessing.'),
      step(4, 'Optional extras', 'On-page save buttons for product grids, and an Instagram Saved-collection importer — both off until you turn them on.'),
    ]),
  ]);
  view.append(w);
}

function step(n, title, text) {
  return el('div', { class: 'step' }, [el('div', { class: 'step-num' }, [String(n)]), el('h3', {}, [title]), el('p', {}, [text])]);
}

boot().catch((e) => {
  console.error(e);
  const view = $('view');
  if (view) view.append(UI.emptyState({ title: 'Keepsake couldn’t start', message: String((e && e.message) || e) }));
});
