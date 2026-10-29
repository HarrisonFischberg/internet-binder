// "Clean up with AI": first works out what each save is (src/shared/understand.js): a recipe, workout,
// place, film, book, video or article goes to its Lifestyle view with its details. What's left is
// checked against its live product page: tidied titles, confirmed prices, replaced broken images and
// filed into collections. Confident fixes are applied straight away and every change is written to an
// undo log (store.getAiLog), shown on the #ailog page.
//
// Runs only when the user starts it from the dashboard. Live pages are fetched
// from this browser without cookies (credentials: 'omit') and parsed with
// DOMParser, which never runs the page's scripts.

import { el, clear, parsePrice, pluralize, uid } from '../shared/util.js';
import { providerConfig, originFor, cleanupWithAI, CLEANUP_BATCH, MODELS } from '../ai/provider.js';
import * as UI from './ui.js';
import { MSG } from '../shared/messages.js';
import { needsCollection, hasOwnView, kindOf, kindInfo } from '../shared/kinds.js';
import { planFixes, applyFix, undoFixes, REFILE_CONFIDENCE } from '../shared/aiFix.js';
import { fileSave } from '../shared/filing.js';
import { understandItem } from '../shared/understand.js';
import { fetchPage, loadImage } from '../ai/pages.js';

// Saves read with your provider at once: one request each.
const UNDERSTAND_AT_ONCE = 4;

const ALL_SITES = '*://*/*';

async function hasOrigins(origins) {
  try {
    return await chrome.permissions.contains({ origins });
  } catch {
    return false;
  }
}

async function requestOrigins(origins) {
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

function scopeItems(ctx, scope) {
  // Shopping saves only: Lifestyle saves (places, recipes…) are checked from their own view.
  const live = ctx.state.items.filter((i) => !i.purchased && !hasOwnView(kindOf(i)));
  if (scope === 'review') return live.filter(needsCollection);
  if (scope === 'favorites') return live.filter((i) => i.favorite);
  if (scope === 'all') return live;
  return live.filter((i) => i.collectionId === scope);
}

function scopeLabel(ctx, scope) {
  if (scope === 'review') return 'Review';
  if (scope === 'favorites') return 'your favorites';
  if (scope === 'all') return 'all saved items';
  return `“${ctx.collectionById(scope)?.name || 'this collection'}”`;
}

// --- entry point -----------------------------------------------------------------------------

export async function runAiCleanup(ctx, { scope = 'all' } = {}) {
  const settings = ctx.state.settings;
  const key = await ctx.store.getSecret('aiApiKey');
  if (!key) {
    UI.toast('Add your API key under Optional AI first.', { kind: 'danger' });
    ctx.navigate('#ai');
    return;
  }
  const providerOrigin = originFor(settings);
  if (!providerOrigin) {
    UI.toast('Set a valid https provider address under Optional AI first.', { kind: 'danger' });
    ctx.navigate('#ai');
    return;
  }
  const items = scopeItems(ctx, scope);
  if (!items.length) {
    UI.toast(`Nothing to check in ${scopeLabel(ctx, scope)}.`);
    return;
  }

  const cfg = providerConfig(settings);
  const products = items.filter((i) => i.type === 'product').length;
  const requests = items.length + Math.ceil(items.length / CLEANUP_BATCH);
  const liveCheck = el('input', { type: 'checkbox' });
  liveCheck.checked = true;
  const go = await UI.openModal({
    title: `Fix ${pluralize(items.length, 'item', 'items')} with AI?`,
    body: [
      el('p', { class: 'modal-text' }, [`Internet Binder will check ${scopeLabel(ctx, scope)} and apply confident fixes straight away. Every change is logged and can be undone.`]),
      el('ul', { class: 'modal-list' }, [
        el('li', {}, ['Work out what each save is. Recipes, workouts, places, films, books, videos and articles move to their Lifestyle view with everything their card shows: ingredients and steps, exercises with sets and reps, a place’s street, city and cuisine. What the post doesn’t say (a recipe that’s only in the video) is drafted and marked AI draft.']),
        el('li', {}, ['Tidy titles (store names, SEO filler and promo text removed).']),
        el('li', {}, ['Confirm prices against the live page. The AI can only pick a price that appears on the page or in your saved data.']),
        el('li', {}, ['Replace missing or broken images with the page’s current one.']),
        el('li', {}, [scope === 'review'
          ? 'File each item into the best-fitting collection. Items it isn’t sure about stay in Review.'
          : `File uncategorized items, and move an item only when the AI is at least ${Math.round(REFILE_CONFIDENCE * 100)}% sure it’s in the wrong collection. Items you filed yourself are never moved.`]),
      ]),
      el('label', { class: 'check' }, [liveCheck, el('span', {}, [`Read each item’s live product page (${pluralize(products, 'page', 'pages')}, fetched from this browser without your cookies). Needs access to all sites. Without it, prices can’t be confirmed.`])]),
      el('div', { class: 'payload-preview' }, [
        el('div', {}, [el('strong', {}, ['Destination: ']), cfg.baseUrl, ` (model ${cfg.model})`]),
        el('div', {}, [el('strong', {}, ['Sent per item: ']), 'title, caption or description, hashtags, Instagram location tag, price, retailer, its current collection, its stored thumbnail (never a link to an image), and what its own page and the pages its caption links to show (only with access to all sites). Plus your collection names.']),
        el('div', {}, [el('strong', {}, ['Requests: ']), `about ${requests} (one per item, then ${CLEANUP_BATCH} items each for the shopping check), billed to your API key.`]),
      ]),
    ],
    actions: [{ label: 'Cancel', quiet: true, value: false }, { label: 'Start', primary: true, value: true }],
  });
  if (go !== true) return;

  // Ask for permissions right away, while the click still counts as a user gesture.
  let useLive = liveCheck.checked && products > 0;
  const wanted = useLive ? [ALL_SITES] : [providerOrigin];
  if (!(await hasOrigins(wanted)) && !(await requestOrigins(wanted))) {
    if (!useLive) {
      UI.toast('Permission to contact the provider was not granted.', { kind: 'danger' });
      return;
    }
    useLive = false;
    if (!(await hasOrigins([providerOrigin])) && !(await requestOrigins([providerOrigin]))) {
      UI.toast('Permission to contact the provider was not granted.', { kind: 'danger' });
      return;
    }
    UI.toast('No access to all sites, so live pages won’t be read. Titles and collections are still checked.', { duration: 6000 });
  }

  const report = await runWithProgress(ctx, items, { scope, key, useLive });
  await showSummary(ctx, report);
}

// --- the run --------------------------------------------------------------------------------------

async function runWithProgress(ctx, items, { scope, key, useLive }) {
  const runId = uid();
  const report = { runId, total: items.length, checked: 0, changed: 0, titles: 0, prices: 0, images: 0, moved: 0, lifestyle: {}, details: 0, stillReview: 0, failed: 0, notes: [], stopped: false, error: '' };
  let stopped = false;
  const status = el('p', { class: 'modal-text' }, ['Starting…']);
  const fill = el('div', { class: 'progress-fill', style: { width: '0%' } });
  const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(items.length), 'aria-valuenow': '0' }, [fill]);
  const counts = el('p', { class: 'help' }, ['']);
  const body = el('div', {}, [status, bar, counts]);
  UI.openModal({
    title: 'Fixing with AI…',
    body,
    closeOnScrim: false,
    actions: [{ label: 'Stop', quiet: true, onClick: () => { stopped = true; status.textContent = 'Stopping after this batch…'; return false; } }],
    onClose: () => { stopped = true; },
  });
  const update = () => {
    const done = report.checked + report.failed;
    fill.style.width = `${Math.round((done / items.length) * 100)}%`;
    bar.setAttribute('aria-valuenow', String(done));
    counts.textContent = `${done} of ${items.length} checked · ${pluralize(report.changed, 'item', 'items')} fixed${report.failed ? ` · ${report.failed} failed` : ''}`;
  };

  const threshold = Number(ctx.state.prefs?.confidenceThreshold) || 0.6;
  const fatal = (msg) => /\((401|403|429)\)|API key|base URL|Failed to fetch|NetworkError/i.test(msg);
  for (let i = 0; i < items.length && !stopped; i += CLEANUP_BATCH) {
    const all = items.slice(i, i + CLEANUP_BATCH);
    status.textContent = `Working out what items ${i + 1}–${i + all.length} are…`;
    // What each save is, first: a recipe, workout or place leaves for its Lifestyle view with its details.
    const read = new Map();
    for (let at = 0; at < all.length && !stopped; at += UNDERSTAND_AT_ONCE) {
      await Promise.all(all.slice(at, at + UNDERSTAND_AT_ONCE).map(async (item) => {
        try {
          read.set(item.id, await understandItem(ctx.store, item.id, { force: true, runId }, { fetchPage: useLive ? fetchPage : async () => null, loadImage }));
        } catch (e) {
          read.set(item.id, { error: String((e && e.message) || e) });
        }
      }));
    }
    const firstError = [...read.values()].find((r) => r?.error);
    if (firstError && fatal(firstError.error)) {
      report.error = firstError.error;
      report.failed += all.length;
      update();
      break;
    }
    const batch = [];
    const posts = [];
    for (const item of all) {
      const r = read.get(item.id);
      if (r && !r.error && hasOwnView(r.kind)) {
        report.checked++;
        if (r.changed) {
          report.changed++;
          if (kindOf(item) !== r.kind) report.lifestyle[r.kind] = (report.lifestyle[r.kind] || 0) + 1;
          else report.details++;
        }
      } else {
        const now = (await ctx.store.getItem(item.id)) || item;
        if (kindOf(now) === 'product') batch.push(now);
        else posts.push(now);
      }
    }
    // A post or link: which of your collections it's about, with the words of the save that show it,
    // checked before it moves (shared/filing.js). Not sure: it waits in Review with the reason.
    for (const post of posts) {
      if (stopped) break;
      try {
        const f = await fileSave(ctx.store, post.id, { runId, scope, items: async () => ctx.state.items });
        report.checked++;
        if (f?.moved) { report.changed++; report.moved++; }
      } catch (e) {
        report.failed++;
        const msg = String((e && e.message) || e);
        if (fatal(msg)) { report.error = msg; stopped = true; }
      }
    }
    update();
    if (!batch.length || stopped) continue;
    status.textContent = useLive ? `Reading pages and checking items ${i + 1}–${i + all.length}…` : `Checking items ${i + 1}–${i + all.length}…`;
    const collections = ctx.state.collections;
    const prepared = await Promise.all(batch.map(async (item, n) => {
      const isProduct = item.type === 'product';
      const [live, imageOk] = await Promise.all([
        useLive && isProduct ? readLivePage(item.url) : null,
        item.image ? imageLoads(item.image) : false,
      ]);
      const col = item.collectionId ? collections.find((c) => c.id === item.collectionId) : null;
      return { ref: `i${n}`, item, live: live && !live.error ? live : null, liveError: live && live.error ? live : null, imageOk, currentCollection: col ? col.name : '' };
    }));
    let results;
    try {
      // Instagram posts are described by their caption; only their collection is decided.
      const entries = prepared.map((p) => ({ ref: p.ref, item: p.item.instagram?.caption ? { ...p.item, description: p.item.instagram.caption } : p.item, live: p.live, currentCollection: p.currentCollection }));
      results = await cleanupWithAI(entries, collections, ctx.state.settings, key);
    } catch (e) {
      const msg = String((e && e.message) || e);
      report.failed += batch.length;
      update();
      // A bad key, quota or unreachable provider fails every batch the same way: stop now.
      if (fatal(msg) || !report.checked) {
        report.error = msg;
        break;
      }
      continue;
    }

    const logEntries = [];
    for (const p of prepared) {
      const ai = results.get(p.ref);
      if (!ai) {
        report.failed++;
        continue;
      }
      report.checked++;
      const current = (await ctx.store.getItem(p.item.id)) || p.item;
      const plan = planFixes(current, ai, { live: p.live, imageOk: p.imageOk, scope, threshold });
      noteIssues(report, current, p, ai, plan.patch);
      if (!plan.changes.length) continue;
      try {
        logEntries.push(await applyFix(ctx.store, current, plan, { runId, reason: ai.reason || '' }));
      } catch {
        report.failed++;
        continue;
      }
      report.changed++;
      for (const c of plan.changes) report[c.kind]++;
    }
    if (logEntries.length) await ctx.store.appendAiLog(logEntries);
    update();
  }
  report.stopped = stopped;
  report.stillReview = scopeItems(ctx, 'review').length;
  const dialog = body.closest('.modal');
  if (dialog && dialog.close) dialog.close(true);
  return report;
}

function noteIssues(report, item, prepared, ai, patch) {
  const add = (text) => { if (report.notes.length < 200) report.notes.push({ itemId: item.id, title: patch.title || item.title, text }); };
  const err = prepared.liveError;
  if (err && err.gone) add('The product page no longer exists (link is dead).');
  else if (err && item.type === 'product') add(`Couldn’t read the live page (${err.error}), so the price wasn’t checked.`);
  if (prepared.live && prepared.live.availability === 'out_of_stock') add('The live page says it’s out of stock.');
  if (item.image && !prepared.imageOk && !patch.image) add('The image is broken and the page had no replacement.');
  if (!item.collectionId && !patch.collectionId && ai) add('AI wasn’t sure which collection fits, so it stays in Review.');
}

// --- summary --------------------------------------------------------------------------------------

async function showSummary(ctx, report) {
  const lines = [
    ...Object.entries(report.lifestyle).map(([kind, n]) => `${n} moved to ${kindInfo(kind).plural}`),
    report.details ? `${pluralize(report.details, 'Lifestyle save', 'Lifestyle saves')} filled in` : '',
    report.titles ? `${pluralize(report.titles, 'title', 'titles')} tidied` : '',
    report.prices ? `${pluralize(report.prices, 'price', 'prices')} updated` : '',
    report.images ? `${pluralize(report.images, 'image', 'images')} replaced` : '',
    report.moved ? `${pluralize(report.moved, 'item', 'items')} filed into collections` : '',
  ].filter(Boolean);
  const notes = report.notes.slice(0, 30);
  const body = [
    report.error ? el('div', { class: 'notice notice-danger' }, [`The provider returned an error, so the run stopped: ${report.error}`]) : null,
    el('p', { class: 'modal-text' }, [
      `Checked ${report.checked} of ${report.total}${report.stopped ? ' (stopped early)' : ''}. `,
      report.changed ? `Fixed ${pluralize(report.changed, 'item', 'items')}: ${lines.join(', ')}.` : 'Nothing needed fixing.',
      report.failed ? ` ${report.failed} couldn’t be checked.` : '',
    ]),
    report.stillReview ? el('p', { class: 'help' }, [`${pluralize(report.stillReview, 'item', 'items')} still in Review.`]) : null,
    notes.length ? el('details', { class: 'ai-notes' }, [
      el('summary', {}, [`${pluralize(report.notes.length, 'thing', 'things')} to look at`]),
      el('ul', { class: 'modal-list' }, notes.map((n) => el('li', {}, [el('strong', {}, [cut(n.title, 60)]), ` — ${n.text}`]))),
    ]) : null,
  ];
  const choice = await UI.openModal({
    title: report.changed ? 'AI fixes applied' : 'AI check finished',
    body,
    actions: [
      report.changed ? { label: 'Undo all', quiet: true, value: 'undo' } : null,
      report.changed ? { label: 'See changes', value: 'log' } : null,
      { label: 'Done', primary: true, value: 'done' },
    ].filter(Boolean),
  });
  if (choice === 'undo') {
    const log = await ctx.store.getAiLog();
    const n = await undoEntries(ctx, log.filter((e) => e.runId === report.runId && !e.undone));
    UI.toast(`Undid changes to ${pluralize(n, 'item', 'items')}.`);
  } else if (choice === 'log') {
    ctx.navigate('#ailog');
  }
}

// --- undo -----------------------------------------------------------------------------------------

// Puts each save back to what it was before the AI change (shared/aiFix.js); returns how many saves.
export async function undoEntries(ctx, entries) {
  return (await undoFixes(ctx.store, entries)).items;
}

// --- change log page (#ailog) --------------------------------------------------------------------

export function renderAiLog(ctx, view) {
  const page = el('div', { class: 'page page-wide' });
  const box = el('div', {});
  page.append(el('p', { class: 'page-intro' }, ['Everything “Fix with AI” changed, newest first. Undo a single item or a whole run; the item goes back to exactly what it was before.']));
  page.append(box);
  view.append(page);
  ctx.store.getAiLog().then((log) => {
    UI.holdHeight(box);
    clear(box);
    if (!log.length) {
      box.append(UI.emptyState({ title: 'No AI changes yet', message: 'When you run “Fix with AI” from Review or the AI settings, every change shows up here.', icon: UI.checkIcon() }));
      return;
    }
    const runs = new Map();
    for (const e of [...log].reverse()) {
      if (!runs.has(e.runId)) runs.set(e.runId, []);
      runs.get(e.runId).push(e);
    }
    for (const entries of runs.values()) {
      const open = entries.filter((e) => !e.undone);
      const when = new Date(entries[entries.length - 1].at);
      const rows = entries.map((e) => logRow(ctx, e));
      box.append(UI.section(`${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`, `${pluralize(entries.length, 'item', 'items')} changed${open.length < entries.length ? ` · ${entries.length - open.length} undone` : ''}`, [
        el('div', { class: 'ai-log-list' }, rows),
        open.length ? el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn btn-sm', onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          const n = await undoEntries(ctx, open);
          UI.toast(`Undid changes to ${pluralize(n, 'item', 'items')}.`);
          ctx.render();
        } }, [`Undo this run (${open.length})`])]) : null,
      ]));
    }
    box.append(el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn btn-quiet btn-sm', onClick: async () => {
      const ok = await UI.confirmDialog({ title: 'Clear the change log?', message: 'The items keep their current details; you just won’t be able to undo these AI changes any more.', confirmLabel: 'Clear log' });
      if (!ok) return;
      await ctx.store.clearAiLog();
      ctx.render();
    } }, ['Clear log'])]));
  });
}

function logRow(ctx, e) {
  const exists = ctx.state.items.some((i) => i.id === e.itemId);
  const chips = (e.changes || []).map((c) => {
    if (c.field === 'collection') {
      const from = c.fromId ? ctx.collectionById(c.fromId)?.name || 'a deleted collection' : 'Review';
      return el('span', { class: 'ai-change' }, [el('strong', {}, ['Moved: ']), `${from} → ${c.to}`]);
    }
    const label = { title: 'Title', price: 'Price', image: 'Image', recipe: 'Recipe' }[c.field] || c.field;
    return el('span', { class: 'ai-change' }, [el('strong', {}, [`${label}: `]), c.field === 'title' ? el('span', { class: 'ai-change-from' }, [cut(c.from, 80)]) : c.from, ' → ', c.field === 'title' ? cut(c.to, 80) : c.to]);
  });
  const action = e.undone
    ? el('span', { class: 'pill' }, ['Undone'])
    : exists
      ? el('button', { type: 'button', class: 'btn btn-sm btn-quiet', onClick: async (ev) => {
        ev.currentTarget.disabled = true;
        await undoEntries(ctx, [e]);
        UI.toast('Change undone.');
        ctx.render();
      } }, ['Undo'])
      : el('span', { class: 'pill' }, ['Item deleted']);
  return el('div', { class: `ai-log-row ${e.undone ? 'is-undone' : ''}` }, [
    el('div', { class: 'ai-log-main' }, [
      exists ? el('button', { type: 'button', class: 'btn-link ai-log-title', onClick: () => ctx.openItem(e.itemId) }, [cut(e.itemTitle, 90)]) : el('span', { class: 'ai-log-title' }, [cut(e.itemTitle, 90)]),
      el('div', { class: 'ai-log-changes' }, chips),
      e.reason ? el('div', { class: 'help' }, [e.reason]) : null,
    ]),
    action,
  ]);
}

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// --- live page reading ------------------------------------------------------------------------------

export async function readLivePage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(u.href, { credentials: 'omit', redirect: 'follow', signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml' } });
    if (!res.ok) return { error: `HTTP ${res.status}`, gone: res.status === 404 || res.status === 410 };
    if (!/html/i.test(res.headers.get('content-type') || '')) return { error: 'not a web page' };
    const html = (await res.text()).slice(0, 3000000);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return parseProductDocument(doc, res.url || u.href);
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'timed out' : 'could not load' };
  } finally {
    clearTimeout(timer);
  }
}

// JSON-LD Product first, then Open Graph / product meta tags. Only the
// structured data a page publishes for shops and search engines is used.
export function parseProductDocument(doc, baseUrl) {
  const abs = (v) => {
    const s = typeof v === 'string' ? v : v && typeof v === 'object' ? v.url || v.contentUrl || '' : '';
    if (!s) return '';
    try {
      const x = new URL(s.trim(), baseUrl);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch {
      return '';
    }
  };
  const meta = (sel) => (doc.querySelector(sel)?.getAttribute('content') || '').trim();
  const nodes = [];
  const collect = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 6 || nodes.length > 200) return;
    if (Array.isArray(n)) return n.forEach((x) => collect(x, depth + 1));
    nodes.push(n);
    if (n['@graph']) collect(n['@graph'], depth + 1);
  };
  for (const s of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, 25)) {
    try {
      collect(JSON.parse(s.textContent || ''), 0);
    } catch {
      /* skip malformed blocks */
    }
  }
  const isProduct = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).some((t) => /^(product|productgroup|individualproduct|productmodel)$/i.test(String(t || '')));
  const product = nodes.find((n) => isProduct(n) && n.offers) || nodes.find(isProduct) || null;

  const prices = [];
  let currency = '';
  let availability = '';
  const offerList = product ? [].concat(product.offers || []).flatMap((o) => (o && o.offers ? [o, ...[].concat(o.offers)] : [o])) : [];
  if (product && product.hasVariant) for (const v of [].concat(product.hasVariant).slice(0, 10)) if (v && v.offers) offerList.push(...[].concat(v.offers));
  for (const o of offerList.slice(0, 20)) {
    if (!o || typeof o !== 'object') continue;
    const cur = String(o.priceCurrency || o.priceSpecification?.priceCurrency || '').toUpperCase();
    if (!currency && cur) currency = cur;
    for (const v of [o.price, o.lowPrice, o.highPrice, o.priceSpecification?.price]) {
      const p = parsePrice(v, cur);
      if (p && p.amount > 0) prices.push(p.amount);
    }
    if (!availability && o.availability) availability = /outofstock|soldout|discontinued/i.test(String(o.availability)) ? 'out_of_stock' : /instock|limitedavailability|preorder/i.test(String(o.availability)) ? 'in_stock' : '';
  }
  const metaPrice = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') || meta('meta[itemprop="price"]') || (doc.querySelector('[itemprop="price"]')?.getAttribute('content') || '');
  const metaCurrency = (meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') || meta('meta[itemprop="priceCurrency"]')).toUpperCase();
  const mp = parsePrice(metaPrice, metaCurrency);
  if (mp && mp.amount > 0) prices.push(mp.amount);
  if (!currency) currency = metaCurrency;
  if (!availability) {
    const a = meta('meta[property="product:availability"]') || meta('meta[property="og:availability"]');
    if (a) availability = /out|sold/i.test(a) ? 'out_of_stock' : 'in_stock';
  }
  const unique = [...new Set(prices)];
  const img = product ? [].concat(product.image || [])[0] : null;
  return {
    title: String((product && product.name) || meta('meta[property="og:title"]') || doc.title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    price: unique.length ? unique[0] : null,
    priceCandidates: unique.slice(0, 6),
    currency,
    availability,
    image: abs(img) || abs(meta('meta[property="og:image"]')) || abs(meta('meta[name="twitter:image"]')),
  };
}

// True if the image URL still loads. data: URLs are stored copies, so they always count.
function imageLoads(src) {
  if (!src || src.startsWith('data:')) return Promise.resolve(!!src);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, 10000);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 1); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.referrerPolicy = 'no-referrer';
    img.src = src;
  });
}

// --- Settings section -------------------------------------------------------------------------------

export function cleanupSection(ctx) {
  const scopeSel = UI.selectInput({
    value: 'all',
    options: [
      { value: 'all', label: `All saved items (${scopeItems(ctx, 'all').length})` },
      { value: 'review', label: `Review (${scopeItems(ctx, 'review').length})` },
      ...ctx.regularCollections().map((c) => ({ value: c.id, label: `${c.name} (${scopeItems(ctx, c.id).length})` })),
    ],
    onChange: () => {},
    label: 'What to check',
  });
  const logLink = el('button', { type: 'button', class: 'btn btn-quiet', onClick: () => ctx.navigate('#ailog') }, ['Change log']);
  ctx.store.getAiLog().then((log) => {
    const open = log.filter((e) => !e.undone).length;
    if (open) logLink.textContent = `Change log (${open})`;
  });
  return UI.section('Fix with AI', 'Checks saved items against their live product pages: tidies titles, confirms prices, replaces broken images and files items into the right collection. Confident fixes are applied right away; every change is logged and can be undone.', [
    UI.settingRow('What to check', scopeSel),
    el('div', { class: 'actions-row' }, [
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => runAiCleanup(ctx, { scope: scopeSel.value }) }, ['Check & fix…']),
      logLink,
    ]),
  ]);
}

// --- Run AI on imported saves -------------------------------------------------------------------------
// Bulk imports save without AI and flag each save (needsAi). Before anything goes to your provider, this
// says how many saves, about how long, and lets you start with the newest few. The run itself is in the
// background worker (background.js startAiBacklog): two at a time, with Pause and Cancel in the bar.
export const AI_RUN_FIRST = 100;
const SECONDS_PER_SAVE = 4; // two at a time, a picture and a page each: roughly what a run takes

export function aiBacklogOf(items) {
  return items.filter((i) => i.needsAi && !i.deletedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function confirmAiRun(ctx, ids, { label = '' } = {}) {
  const want = ids ? new Set(ids) : null;
  const todo = aiBacklogOf(ctx.state.items).filter((i) => !want || want.has(i.id)).map((i) => i.id);
  if (!todo.length) {
    UI.toast('Nothing here is waiting for AI.');
    return;
  }
  if (!ctx.state.settings?.ai?.on) {
    UI.toast('Turn on Optional AI in Settings first.', { kind: 'danger' });
    return;
  }
  const minutes = (n) => {
    const m = Math.max(1, Math.round((n * SECONDS_PER_SAVE) / 60));
    return m < 90 ? pluralize(m, 'minute', 'minutes') : `${Math.round(m / 6) / 10} hours`;
  };
  const cfg = providerConfig(ctx.state.settings);
  const modelName = (MODELS[cfg.provider] || []).find((m) => m.id === cfg.model)?.label || cfg.model || cfg.provider;
  const few = todo.length > AI_RUN_FIRST;
  const choice = await UI.openModal({
    title: `Run AI on ${pluralize(todo.length, 'imported save', 'imported saves')}?`,
    body: [
      el('p', {}, [`Your AI provider (${modelName}) reads each one: what it is from its picture, caption and page, then its details or collection. That’s one to three requests a save, two at a time, so about ${minutes(todo.length)} for all of them${few ? `, or ${minutes(AI_RUN_FIRST)} for the newest ${AI_RUN_FIRST}` : ''}.`]),
      el('p', { class: 'help' }, ['It runs in the background with progress under the header. Pause or cancel any time; whatever isn’t done yet stays waiting, so you can resume later. If your provider asks Internet Binder to slow down, it waits and tries again. Every change can be undone from the AI change log.']),
    ],
    actions: [
      { label: 'Not now', quiet: true, onClick: (c) => c('') },
      ...(few ? [{ label: `Newest ${AI_RUN_FIRST}`, onClick: (c) => c('first') }] : []),
      { label: few ? `All ${todo.length}` : 'Run AI', primary: true, onClick: (c) => c('all') },
    ],
  });
  if (!choice) return;
  const res = await ctx.send({ type: MSG.AI_BACKLOG_RUN, itemIds: choice === 'first' ? todo.slice(0, AI_RUN_FIRST) : ids ? todo : null, label });
  if (!res?.ok) UI.toast(res?.error || 'Run AI couldn’t start.', { kind: 'danger', duration: 6000 });
  else ctx.state.fillJob = res.job;
}
