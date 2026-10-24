// Instagram Saved-collection import: review screen for a scan captured by the
// popup. Each post goes into a Lifestyle view (a restaurants collection into Places, with the
// place's name, address and pin from the caption and location tag) or a collection, where it is an
// inspiration card. Internet Binder makes no claim about which product a post shows unless the optional AI
// feature is used explicitly.

import { MSG } from '../shared/messages.js';
import { LIFESTYLE, kindInfo, kindForCollectionName, detailsForKind, recipeOrWorkout, isWorkoutPost, placeFromText } from '../shared/kinds.js';
import { el, clear, sanitizeText, pluralize } from '../shared/util.js';
import { classify } from '../shared/categorizer.js';
import { getThumbs, thumbKey } from '../instagram/scanStore.js';
import { normalizeUrl } from '../shared/url.js';
import { titleFromCaption } from '../instagram/post.js';
import { enrichPosts, hasInstagramAccess, requestInstagramAccess } from '../instagram/enrich.js';
import * as UI from './ui.js';
import { confirmAiRun } from './aiCleanup.js';


function postTitle(post) {
  return titleFromCaption(post.caption, post.creator, post.type);
}

// "Import all collections" keeps the Instagram collections each post was in; the first one names it.
const bulkName = (post) => (Array.isArray(post.collections) && post.collections[0]) || '';
const collectionNameFor = (post, scan) => (scan.bulk ? bulkName(post) : scan.collectionName || '');
const scanTitle = (scan) => (scan.bulk ? 'your Saved collections' : `“${scan.collectionName || 'collection'}”`);

export function productFor(post, scan) {
  const caption = sanitizeText(post.caption, 2200);
  return {
    title: post.title && post.details ? sanitizeText(post.title, 200) : postTitle(post),
    description: caption.slice(0, 1000),
    alt: sanitizeText(post.alt, 300),
    host: 'instagram.com',
    retailer: 'Instagram',
    instagram: {
      collectionName: collectionNameFor(post, scan), caption, creator: post.creator || '', postType: post.type || 'post',
      hashtags: post.hashtags || [], links: post.links || [], products: post.products || [], postedAt: post.postedAt || '',
      location: post.location || '', place: post.place || null, originalImage: post.originalImage || '', linkInBio: !!post.linkInBio, details: !!post.details,
    },
  };
}

export function renderImport(ctx, view) {
  const page = el('div', { class: 'page page-wide' });
  view.append(page);
  page.append(el('p', { class: 'help' }, ['Loading…']));
  ctx.send({ type: MSG.IG_SCAN_STATE }).then((res) => {
    ctx.state.scan = res.ok ? res.scan : null;
    clear(page);
    draw(ctx, page);
  });
}

function draw(ctx, page) {
  const scan = ctx.state.scan;
  if (!scan || !scan.posts) {
    page.append(instructions(ctx));
    return;
  }
  if (scan.bulk && (scan.status === 'scanning' || scan.status === 'starting')) {
    const b = scan.bulk;
    page.append(UI.section('Scanning all your Saved collections…', 'Keep the Instagram tab open: Internet Binder opens each collection there in turn. Posts appear here when it finishes.', [
      el('div', { class: 'stat-grid' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [String(scan.posts.length)]), el('div', { class: 'stat-label' }, ['posts found so far'])]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [`${Math.min(b.index + 1, b.total)} of ${b.total}`]), el('div', { class: 'stat-label' }, [b.current ? `now: ${b.current}` : 'collections'])]),
      ]),
      el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn', onClick: () => ctx.send({ type: MSG.IG_STOP_SCAN, tabId: scan.tabId }) }, ['Stop and keep what’s found'])]),
    ]));
    return;
  }
  if (scan.status === 'scanning' || scan.status === 'starting') {
    page.append(UI.section(`Scanning “${scan.collectionName || 'collection'}”…`, 'Keep the Instagram tab open. Posts appear here when the scan finishes.', [
      el('div', { class: 'stat-grid' }, [el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, [String(scan.posts.length)]), el('div', { class: 'stat-label' }, ['posts found so far'])])]),
      el('div', { class: 'actions-row' }, [el('button', { type: 'button', class: 'btn', onClick: () => ctx.send({ type: MSG.IG_STOP_SCAN, tabId: scan.tabId }) }, ['Stop scan'])]),
    ]));
    return;
  }
  if (scan.status === 'error') {
    page.append(UI.section('The scan hit a problem', '', [el('div', { class: 'notice notice-danger' }, [scan.error || 'Unknown error']), el('div', { class: 'actions-row' }, [clearBtn(ctx)])]));
    page.append(instructions(ctx));
    return;
  }
  if (!scan.posts.length) {
    page.append(UI.section('No posts were found', 'The collection may still have been loading, or Instagram changed its layout. Reload the Instagram tab, wait for the grid to appear, then start the import again from the popup.', [el('div', { class: 'actions-row' }, [clearBtn(ctx)])]));
    page.append(instructions(ctx));
    return;
  }
  reviewScreen(ctx, page, scan);
}

function instructions(ctx) {
  return UI.section('Import a Saved collection', 'Bring the posts you saved on Instagram into Internet Binder: each one filed where it belongs.', [
    el('div', { class: 'steps' }, [
      stepNode(1, 'Open Instagram', 'Go to your profile → Saved, and open one collection (or “All posts”).'),
      stepNode(2, 'Click Internet Binder', 'The popup recognizes the Saved collection and offers “Import this collection”.'),
      stepNode(3, 'Let it scroll', 'Internet Binder scrolls the collection to load posts, then stops at the end, when nothing new appears, or at the safety limit. You can stop any time.'),
      stepNode(4, 'Import', 'One click: Internet Binder reads the posts, files each one, and tells you where everything went.'),
    ]),
    el('div', { class: 'prose' }, [
      el('p', {}, [el('strong', {}, ['What Internet Binder reads: ']), 'post links, thumbnails, captions and creator names visible in the collection you opened. ', el('strong', {}, ['What it never reads: ']), 'your login, cookies, messages, or any other page.']),
      el('p', {}, ['Instagram changes its layout often. If a scan finds nothing, reload the page and try again — and know that the importer may need an update when Instagram changes.']),
    ]),
    el('div', { class: 'actions-row' }, [el('a', { class: 'btn', href: 'https://www.instagram.com/', target: '_blank', rel: 'noopener noreferrer' }, ['Open Instagram'])]),
  ]);
}

function stepNode(n, title, text) {
  return el('div', { class: 'step' }, [el('div', { class: 'step-num' }, [String(n)]), el('h3', {}, [title]), el('p', {}, [text])]);
}

function clearBtn(ctx) {
  return el('button', { type: 'button', class: 'btn btn-quiet', onClick: async () => {
    await ctx.send({ type: MSG.IG_SCAN_CLEAR });
    ctx.state.scan = null;
    ctx.render();
  } }, ['Discard scan']);
}

// --- the import: one button, then a progress dialog, then where everything went ----------------------
// Already-saved posts are skipped (importing one twice is never useful). Posts are read (caption, creator,
// location, links) when instagram.com access is granted, then filed: a Lifestyle view when the collection's
// name or the caption says so, else the best collection, else Review.

const run = { running: false, stop: false, dialog: null };

function isImported(ctx, post, history, itemsById) {
  const remembered = history[normalizeUrl(post.url)];
  return (!!remembered && itemsById.has(remembered)) || ctx.state.items.some((i) => i.type === 'instagram' && i.sourceUrl === post.url);
}

async function reviewScreen(ctx, page, scan) {
  if (scan.bulk) return bulkReviewScreen(ctx, page, scan);
  const history = (ctx.state.importHistory && ctx.state.importHistory.instagram) || {};
  const itemsById = new Map(ctx.state.items.map((i) => [i.id, i]));
  const igName = scan.collectionName || 'collection';
  const nameKind = kindForCollectionName(igName);
  const already = scan.posts.filter((p) => isImported(ctx, p, history, itemsById)).length;
  const todo = scan.posts.length - already;
  const importBtn = el('button', { type: 'button', class: 'btn btn-primary', disabled: !todo || run.running, onClick: () => runImport(ctx, scan) }, [run.running ? 'Importing…' : `Import ${pluralize(todo, 'post', 'posts')}`]);
  page.append(UI.section(`“${igName}”`, scan.username ? `@${scan.username} · ${pluralize(scan.posts.length, 'post', 'posts')} found` : `${pluralize(scan.posts.length, 'post', 'posts')} found`, [
    el('p', {}, [
      nameKind ? `“${igName}” sounds like ${kindInfo(nameKind).plural}, so the posts go there. ` : 'Internet Binder reads each post (caption, creator, location, links) and files it: products into your collections; places, recipes and workouts into their Lifestyle views. Anything it isn’t sure about waits in Review. ',
      already ? `${pluralize(already, 'post is', 'posts are')} already in Internet Binder and will be skipped.` : '',
    ]),
    scan.reason === 'limit' ? el('p', { class: 'help' }, [`The scan stopped at the safety limit (${scan.posts.length}); scroll further on Instagram and scan again to get more.`]) : null,
    el('p', { class: 'help' }, ['Reading the posts uses your own Instagram session, one post at a time with a short pause (about ', el('strong', {}, [`${Math.max(1, Math.ceil((todo * 2.3) / 60))} min`]), ' for these). Keep this tab open; you can keep using Internet Binder meanwhile.']),
    el('div', { class: 'actions-row' }, [importBtn, clearBtn(ctx)]),
  ]));
}

// Every collection at once: how many posts each had, and one choice: keep the collections as groups
// (the default) or let Internet Binder sort everything. Either way recipes, workouts and places go to their
// Lifestyle views, where their cards get ingredients, exercises and map pins.
function bulkReviewScreen(ctx, page, scan) {
  const history = (ctx.state.importHistory && ctx.state.importHistory.instagram) || {};
  const itemsById = new Map(ctx.state.items.map((i) => [i.id, i]));
  const already = scan.posts.filter((p) => isImported(ctx, p, history, itemsById)).length;
  const todo = scan.posts.length - already;
  const loose = scan.posts.filter((p) => !bulkName(p)).length;
  const keep = el('input', { type: 'checkbox', checked: ctx.state.igKeepGroups !== false, onChange: (e) => { ctx.state.igKeepGroups = e.target.checked; } });
  const rows = scan.bulk.collections.filter((c) => c.kind !== 'all' && c.status !== 'skipped').map((c) => el('li', { class: 'import-dest' }, [
    el('span', { class: 'import-dest-name' }, [c.name, kindForCollectionName(c.name) ? ` → ${kindInfo(kindForCollectionName(c.name)).plural}` : '']),
    el('span', { class: 'import-dest-count' }, [String(c.count)]),
  ]));
  if (loose) rows.push(el('li', { class: 'import-dest' }, [el('span', { class: 'import-dest-name' }, ['In no collection (from All posts)']), el('span', { class: 'import-dest-count' }, [String(loose)])]));
  const skipped = scan.bulk.collections.filter((c) => c.status === 'skipped').map((c) => c.name);
  const importBtn = el('button', { type: 'button', class: 'btn btn-primary', disabled: !todo || run.running, onClick: () => runImport(ctx, scan) }, [run.running ? 'Importing…' : `Import ${pluralize(todo, 'post', 'posts')}`]);
  page.append(UI.section('All your Saved collections', `${scan.username ? `@${scan.username} · ` : ''}${pluralize(scan.posts.length, 'post', 'posts')} in ${pluralize(rows.length - (loose ? 1 : 0), 'collection', 'collections')}`, [
    el('ul', { class: 'import-dests', role: 'list' }, rows),
    el('label', { class: 'check' }, [keep, el('span', {}, ['Keep my Instagram collections as groups (posts in no collection are sorted by Internet Binder)'])]),
    el('p', { class: 'help' }, ['Recipes, workouts and places go to their Lifestyle views either way. A post saved in two collections goes to the first. ', already ? `${pluralize(already, 'post is', 'posts are')} already in Internet Binder and will be skipped.` : '']),
    skipped.length ? el('p', { class: 'help' }, [`Not scanned: ${skipped.join(', ')}.`]) : null,
    scan.reason === 'limit' ? el('p', { class: 'help' }, [`The scan stopped at its limit of ${scan.posts.length} posts.`]) : null,
    scan.reason === 'error' && scan.error ? el('div', { class: 'notice notice-danger' }, [`The scan stopped early: ${scan.error}`]) : null,
    el('p', { class: 'help' }, ['Reading the posts uses your own Instagram session, one post at a time with a short pause (about ', el('strong', {}, [`${Math.max(1, Math.ceil((todo * 2.3) / 60))} min`]), ' for these). Keep this tab open; you can stop at any point and keep what’s read. When it’s done, Settings → Export JSON makes a file you can AirDrop to Internet Binder on your iPhone.']),
    el('div', { class: 'actions-row' }, [importBtn, clearBtn(ctx)]),
  ]));
}

// The progress dialog: a bar and what's happening; "Keep working in the background" hides it (the bar under
// the header carries on), "Stop and import" files what's been read so far.
function progressDialog(ctx, { title, total }) {
  const status = el('p', { class: 'modal-text' }, ['Starting…']);
  const fill = el('div', { class: 'progress-fill is-running', style: { width: '3%' } });
  const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Import progress', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0' }, [fill]);
  const note = el('p', { class: 'help' }, ['']);
  let close = null;
  let hidden = false;
  const job = { id: `import-${Date.now()}`, label: title, total, done: 0, running: true, onStop: () => { run.stop = true; }, onShow: () => show() };
  const show = () => {
    hidden = false;
    ctx.setLocalJob(null);
    UI.openModal({
      title, body: [status, bar, note], closeOnScrim: false, className: 'import-progress',
      onOpen: (m) => { close = m.close; },
      onClose: (v) => { if (v !== 'done') { hidden = true; ctx.setLocalJob(job); } },
      actions: [
        { label: 'Keep working in the background', quiet: true, onClick: (c) => c('hide') },
        { label: 'Stop and import', onClick: () => { run.stop = true; status.textContent = 'Stopping after this post…'; return false; } },
      ],
    });
  };
  show();
  return {
    update(text, done, n = total, extra = '') {
      status.textContent = text;
      fill.style.width = `${Math.max(3, Math.round((done / Math.max(1, n)) * 100))}%`;
      bar.setAttribute('aria-valuenow', String(done));
      note.textContent = extra;
      Object.assign(job, { label: text.replace(/…?\s*\d+ of \d+$/, '').replace(/…$/, ''), done, total: n });
      if (hidden) ctx.setLocalJob(job);
    },
    finish() {
      if (close) close('done');
      ctx.setLocalJob(null);
    },
  };
}

async function runImport(ctx, scan) {
  if (run.running) return;
  const history = (ctx.state.importHistory && ctx.state.importHistory.instagram) || {};
  const itemsById = new Map(ctx.state.items.map((i) => [i.id, i]));
  const todo = scan.posts.filter((p) => !isImported(ctx, p, history, itemsById));
  const skipped = scan.posts.length - todo.length;
  if (!todo.length) return;
  // Ask for instagram.com right away, while the click still counts as a user gesture.
  const wantDetails = ctx.state.settings?.instagram?.readPostDetails !== false && todo.some((p) => !p.details);
  let canRead = false;
  if (wantDetails) {
    canRead = (await hasInstagramAccess()) || (await requestInstagramAccess());
    if (!canRead) UI.toast('Without instagram.com access, posts are imported with what the grid showed (no captions, locations or links).', { duration: 8000 });
  }
  run.running = true;
  run.stop = false;
  ctx.render({ keepScroll: true });
  const ui = progressDialog(ctx, { title: `Importing ${scanTitle(scan)}`, total: todo.length });
  let posts = todo;
  let read = { done: 0, failed: 0, loginWalls: 0 };
  try {
    if (canRead) {
      const settings = ctx.state.settings.instagram || {};
      const result = await enrichPosts(todo, {
        send: ctx.send,
        delayMs: Math.max(500, Number(settings.readDelayMs) || 1500),
        shouldStop: () => run.stop,
        onProgress: (pr) => {
          const left = Math.ceil(((todo.length - pr.done - pr.failed) * 2.3) / 60);
          ui.update(`Reading post details… ${pr.done + pr.failed} of ${todo.length}`, pr.done + pr.failed, todo.length, left > 0 ? `About ${pluralize(left, 'minute', 'minutes')} left.` : '');
        },
      });
      posts = result.posts;
      read = result;
      const byUrl = new Map(posts.map((p) => [p.url, p]));
      await ctx.send({ type: MSG.IG_SCAN_SET_POSTS, posts: scan.posts.map((p) => byUrl.get(p.url) || p) });
    }
    ui.update('Filing posts…', todo.length, todo.length);
    const summary = await importPosts(ctx, scan, posts);
    summary.skipped += skipped;
    summary.bulk = !!scan.bulk;
    summary.unread = canRead ? read.failed : 0;
    summary.loginWalls = read.loginWalls || 0;
    ui.finish();
    await ctx.send({ type: MSG.IG_SCAN_CLEAR });
    ctx.state.scan = null;
    run.running = false;
    await showImportSummary(ctx, summary, scanTitle(scan));
  } catch (e) {
    ui.finish();
    run.running = false;
    UI.toast(String((e && e.message) || e), { kind: 'danger', duration: 8000 });
    ctx.render({ keepScroll: true });
  }
}

// Files each post and saves it. Returns where they went: [{ label, count, kind?, collectionId? }], plus
// how many went to Review and how many were already saved.
export async function importPosts(ctx, scan, posts) {
  const context = { collections: ctx.state.collections, prefs: ctx.state.prefs, settings: ctx.state.settings };
  // Bulk: each post's own Instagram collection decides; it becomes a group unless that's turned off.
  const keepGroups = !!scan.bulk && ctx.state.igKeepGroups !== false;
  const groups = new Map();
  const groupFor = async (name) => {
    if (!groups.has(name)) {
      const col = await ctx.store.createCollection({ name, description: 'From your Instagram Saved collection' }).then((r) => r.collection).catch(() => null);
      groups.set(name, col ? col.id : null);
    }
    return groups.get(name);
  };
  const kindOfPost = (post) => {
    const nameKind = kindForCollectionName(collectionNameFor(post, scan));
    if (nameKind) return nameKind;
    const cap = post.caption || '';
    const found = recipeOrWorkout(cap);
    if (found) return found.kind;
    if (placeFromText(cap)) return 'place';
    // The routine is in the video: a Workout with no exercises listed.
    if (isWorkoutPost(cap)) return 'workout';
    return null;
  };
  const inputs = [];
  const seen = new Set(); // links already in this import (they reach the store together at the end)
  const places = new Map();
  const newCollections = new Map();
  let review = 0;
  let skipped = 0;
  // The thumbnails the scan copied (src/instagram/scanStore.js); a post without one keeps Instagram's link.
  const thumbs = await getThumbs(posts.map(thumbKey)).catch(() => new Map());
  for (const raw of posts) {
    const post = raw.thumbnail?.startsWith('data:') || !thumbs.has(thumbKey(raw)) ? raw : { ...raw, thumbnail: thumbs.get(thumbKey(raw)) };
    const urlKey = normalizeUrl(post.url);
    if (seen.has(urlKey) || await ctx.store.findByUrl(post.url)) {
      skipped++;
      continue;
    }
    seen.add(urlKey);
    const product = productFor(post, scan);
    const kind = kindOfPost(post);
    const fromName = !!kind && !!kindForCollectionName(collectionNameFor(post, scan));
    const postGroup = collectionNameFor(post, scan);
    let collectionId = null;
    let cls = null;
    let kindFields = {};
    if (!kind && keepGroups && postGroup) collectionId = await groupFor(postGroup);
    if (kind) {
      const { details, title } = detailsForKind(kind, { ...product, url: post.url, type: 'instagram' });
      kindFields = { kind, details, ...(title ? { title } : {}) };
    } else if (!collectionId) {
      cls = classify(product, context);
      if (cls.isNew && cls.taxonomyKey) {
        if (!newCollections.has(cls.taxonomyKey)) newCollections.set(cls.taxonomyKey, (await ctx.store.ensureCollectionForTaxonomy(cls.taxonomyKey))?.id || null);
        collectionId = newCollections.get(cls.taxonomyKey);
      } else collectionId = cls.collectionId || null;
    }
    inputs.push({
      ...product,
      ...kindFields,
      type: 'instagram',
      url: post.url,
      sourceUrl: post.url,
      canonicalUrl: post.url,
      image: post.thumbnail || post.originalThumbnail || post.originalImage || '',
      images: [post.thumbnail, post.originalImage, post.originalThumbnail].filter(Boolean),
      imageAspect: 1,
      collectionId,
      confidence: kind || !cls ? 0.9 : cls.confidence,
      categorizationSource: 'local',
      categorizationReason: kind ? (fromName ? `From your Instagram collection “${postGroup}”` : `Imported into ${kindInfo(kind).plural}`) : cls ? cls.reason : `From your Instagram collection “${postGroup}”`,
      needsReview: !kind && !collectionId,
      // Not sent to your AI provider now: Run AI on imported saves reads it when you ask.
      needsAi: true,
    });
    const key = kind ? `kind:${kind}` : collectionId || 'review';
    if (key === 'review') review++;
    else places.set(key, (places.get(key) || 0) + 1);
  }
  const created = await ctx.store.addItems(inputs);
  await ctx.store.markImported(created.map((item) => [item.url, item.id]));
  for (const item of created) {
    if (!item.collectionId) continue;
    const col = await ctx.store.getCollection(item.collectionId);
    if (col && !col.coverImage && item.image) await ctx.store.updateCollection(col.id, { coverImage: item.image });
  }
  // Nothing goes to your AI provider here: a big import used to send every post at once and stall. Each
  // save is flagged instead, and the summary offers Run AI on them. Lifestyle saves get the Lookups you
  // turned on (no AI: fillSave leaves a flagged save for Run AI).
  for (const item of created) if (LIFESTYLE().some((k) => k.value === item.kind)) ctx.send({ type: MSG.FILL_ITEM, itemId: item.id });
  const cols = await ctx.store.getCollections();
  const where = [...places.entries()].map(([key, count]) => (key.startsWith('kind:')
    ? { label: kindInfo(key.slice(5)).plural, count, kind: key.slice(5) }
    : { label: cols.find((c) => c.id === key)?.name || 'A collection', count, collectionId: key })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: posts.length, imported: created.length, ids: created.map((i) => i.id), where, review, skipped };
}

async function showImportSummary(ctx, s, where) {
  const aiOn = !!ctx.state.settings?.ai?.on;
  const rows = s.where.map((w) => el('li', { class: 'import-dest' }, [
    el('span', { class: 'import-dest-name' }, [w.label]), el('span', { class: 'import-dest-count' }, [String(w.count)]),
  ]));
  if (s.review) rows.push(el('li', { class: 'import-dest is-review' }, [el('span', { class: 'import-dest-name' }, ['Review: for you to sort', aiOn ? ' (or with AI)' : '']), el('span', { class: 'import-dest-count' }, [String(s.review)])]));
  const hasPlaces = s.where.some((w) => w.kind === 'place') && !!ctx.state.settings?.lookups?.places;
  const notes = [
    s.skipped ? `${pluralize(s.skipped, 'post was', 'posts were')} already in Internet Binder, so ${s.skipped === 1 ? 'it was' : 'they were'} skipped.` : '',
    s.unread ? `${pluralize(s.unread, 'post', 'posts')} couldn’t be read${s.loginWalls ? ' (Instagram showed a login page)' : ''}, so ${s.unread === 1 ? 'it was' : 'they were'} imported with what the grid showed.` : '',
    s.imported ? (aiOn
      ? 'Nothing was sent to your AI provider yet. Run AI on them now, or later from Home: your provider works out what each post is, and recipes, workouts and places move to their Lifestyle views with their details.'
      : 'Sorted on this device. To have AI read them later, turn on Optional AI in Settings; Home then offers Run AI on imported saves.') : '',
    hasPlaces ? 'Places are being filled in (addresses and map pins) in the background, with the Lookups you turned on.' : '',
    s.bulk ? 'To bring them to your iPhone: Settings → Export JSON, then AirDrop the file to your iPhone and choose Internet Binder.' : '',
  ].filter(Boolean);
  const choice = await UI.openModal({
    title: `Imported ${pluralize(s.imported, 'post', 'posts')} from ${where}`,
    className: 'import-summary',
    body: [
      el('ul', { class: 'import-dests', role: 'list' }, rows.length ? rows : [el('li', { class: 'help' }, ['Nothing new to import.'])]),
      ...notes.map((n) => el('p', { class: 'help' }, [n])),
    ],
    actions: [
      ...(s.review ? [{ label: 'Open Review', quiet: true, value: 'review', onClick: (c) => c('review') }] : []),
      ...(s.imported && aiOn ? [{ label: `Run AI on ${pluralize(s.imported, 'post', 'posts')}…`, onClick: (c) => c('ai') }] : []),
      { label: 'Done', primary: true, onClick: (c) => c('home') },
    ],
  });
  if (choice === 'review') ctx.navigate('#review');
  else if (choice === 'ai') {
    ctx.navigate('#home');
    confirmAiRun(ctx, s.ids, { label: `Running AI on ${where}` });
  } else ctx.navigate('#home');
}
