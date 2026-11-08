#!/usr/bin/env node
// Reads real shared links the way the iPhone app does (src/shared/linkReader.js: linkRequests, then
// linkFollowUp, then parseLink, then the save rules) and prints what each became. Needs the network, so it
// runs on a Mac, not in the cloud. Finds a few fresh public posts by itself (Reddit, Bluesky, Pinterest);
// pass more links as arguments. With --out <dir>, writes report.json and each link's raw answers there.
//   node tools/links/live-check.mjs [--out <dir>] [links…]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkRequests, linkFollowUp, parseLink, mergeLinkRead, BROWSER_UA } from '../../keepsake/src/shared/linkReader.js';
import { createStore, memoryBackend, memoryRecordBackend } from '../../keepsake/src/shared/storage.js';
import { saveCapture } from '../../keepsake/src/shared/capture.js';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : '';

const FIXED = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/xOXolSQcEb4?si=abc',
  'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share',
  'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  'https://vimeo.com/76979871',
  'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
  'https://soundcloud.com/forss/flickermood',
  'https://www.facebook.com/NASA',
  'https://www.bbcgoodfood.com/recipes/lemon-drizzle-cake',
  'https://www.seriouseats.com/the-food-lab-best-lasagna-recipe',
  'https://www.theverge.com/',
  'https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html',
  'https://en.wikipedia.org/wiki/Cacio_e_pepe',
];

async function get(url, { as = 'html', browser = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { redirect: 'follow', credentials: 'omit', signal: controller.signal, headers: { accept: as === 'html' ? 'text/html,application/xhtml+xml' : 'application/json', 'accept-language': 'en-US,en;q=0.8', ...(browser ? { 'user-agent': BROWSER_UA } : {}) } });
    const body = await res.text();
    if (!res.ok) return { status: res.status, value: null };
    if (as === 'html') return { status: res.status, value: body.slice(0, 8_000_000) };
    try { const j = JSON.parse(body); return { status: res.status, value: j && typeof j === 'object' ? j : null }; } catch { return { status: res.status, value: null }; }
  } catch (e) {
    return { status: 0, value: null, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function round(requests, bundle, log) {
  await Promise.all(requests.map(async (r) => {
    const t = Date.now();
    const a = await get(r.url, r);
    log.push({ key: r.key, url: r.url, status: a.status, ms: Date.now() - t, ok: a.value !== null, error: a.error });
    if (a.value !== null) bundle[r.key] = a.value;
  }));
}

async function discover() {
  const found = [];
  const rd = await get('https://www.reddit.com/r/Cooking/top.json?t=week&limit=3', { as: 'json', browser: true });
  for (const c of rd.value?.data?.children || []) if (c?.data?.permalink) found.push(`https://www.reddit.com${c.data.permalink}?share_id=test&utm_source=share`);
  const bs = await get('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=bsky.app&limit=3&filter=posts_no_replies', { as: 'json', browser: false });
  for (const f of bs.value?.feed || []) {
    const m = String(f?.post?.uri || '').match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(\w+)$/);
    if (m) found.push(`https://bsky.app/profile/${f.post.author?.handle || m[1]}/post/${m[2]}`);
  }
  const pins = await get('https://widgets.pinterest.com/v3/pidgets/boards/pinterest/official-news/pins/', { as: 'json', browser: false });
  for (const p of (pins.value?.data?.pins || []).slice(0, 2)) if (p?.id) found.push(`https://www.pinterest.com/pin/${p.id}/`);
  return found;
}

const links = [...FIXED, ...(await discover()), ...args];
const report = [];
if (out) mkdirSync(out, { recursive: true });
for (const url of links) {
  const t = Date.now();
  const bundle = {};
  const log = [];
  await round(linkRequests(url), bundle, log);
  const next = linkFollowUp(url, bundle);
  if (next.url) bundle.resolvedUrl = next.url;
  if (next.requests.length) await round(next.requests, bundle, log);
  const r = parseLink(bundle, url);
  const product = mergeLinkRead({ url, canonicalUrl: url, sparse: true }, r);
  let item = null;
  try { item = (await saveCapture(createStore(memoryBackend(), memoryRecordBackend()), product)).item; } catch (e) { item = { error: e.message }; }
  const row = {
    url, ms: Date.now() - t, site: r.site, ok: r.ok, source: r.source, requests: log,
    title: r.title, creator: r.creator, name: r.name, postedAt: r.postedAt, text: (r.text || '').slice(0, 160), image: !!r.image, images: r.images.length,
    seconds: r.durationSeconds, location: r.location, links: r.links.length, savedAs: item?.kind, savedTitle: item?.title, savedUrl: item?.url, reason: item?.categorizationReason,
  };
  report.push(row);
  const status = log.map((l) => `${l.key}:${l.status || l.error}`).join(' ');
  console.log(`${r.ok ? '✓' : '✗'} ${r.site.padEnd(10)} ${String(row.ms).padStart(5)}ms  ${status}\n    ${url}\n    → ${item?.kind || '?'} “${item?.title || ''}”${r.creator ? ` @${r.creator}` : ''}${r.durationSeconds ? ` ${r.durationSeconds}s` : ''}${r.image ? ' 🖼' : ''}${r.text ? ` | ${r.text.replace(/\s+/g, ' ').slice(0, 90)}` : ''}`);
  if (out) writeFileSync(join(out, `${report.length.toString().padStart(2, '0')}-${r.site}.json`), JSON.stringify({ url, bundle: Object.fromEntries(Object.entries(bundle).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 400_000) : v])) }, null, 1));
}
const good = report.filter((r) => r.ok).length;
console.log(`\n${good}/${report.length} links read`);
if (out) writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
