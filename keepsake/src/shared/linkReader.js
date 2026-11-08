// Reads a link you shared from another app (TikTok, YouTube, Reddit, Bluesky, Pinterest, Threads, Facebook,
// Vimeo, Spotify, SoundCloud, or any web page) the way xPost.js reads a post on X: from the public data
// the site itself publishes for embeds and link previews, with no account and no cookies.
//   TikTok     tiktok.com/oembed (caption, creator, picture) + the video's page (date, length, sound, place)
//   YouTube    youtube.com/oembed (title, channel, picture) + the watch page (description, length, date)
//   Reddit     the post's .json (title, text, subreddit, pictures, the poster's own comments) + oEmbed
//   Bluesky    public.api.bsky.app (the post, its pictures, links and the post it answers) + oEmbed
//   Pinterest  widgets.pinterest.com pin info (description, picture, the page it links to) + the pin's page
//   Vimeo, SoundCloud, Spotify: their oEmbed (+ the page for Spotify's "Song · Artist · Year")
//   Threads, Facebook, and every other site: the page's Open Graph tags, schema.org data and title.
// Short links (vm.tiktok.com, pin.it, reddit.com/r/…/s/…, spotify.link, fb share links…) are read in two
// rounds: the page first, which says where the link really points, then that post's own data.
//
// The app fetches (linkRequests, then linkFollowUp), this file only parses (parseLink), so it is pure and
// runs in Chrome, iOS (JavaScriptCore) and the tests alike. mergeLinkRead puts what it found on the
// capture: a post keeps the same record an Instagram post has (item.instagram, with postType saying where
// it came from), so search, sorting, places and the AI read every post alike.

import { sanitizeText, sanitizeMultiline, sanitizeUrl, decodeEntities } from './util.js';
import { xTitle, isXPost } from './xPost.js';

// What the requests say they are (some sites only serve their full page to a browser).
export const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const HASHTAG_RE = /#([\p{L}\p{N}_]{2,60})/gu;
const URL_RE = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,!?:;]/gi;

const parse = (url) => { try { const u = new URL(String(url || '').trim()); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
const bare = (host) => String(host || '').toLowerCase().replace(/^(?:www|m|mobile|old|new|np|amp|i|vm|vt)\./, '');
const enc = encodeURIComponent;

// --- which site a link is on ------------------------------------------------------------------------

// { site, id, short, ... } for a link, or null when it isn't a web address. Sites this file doesn't know
// are { site: 'page' }; Instagram and X have their own readers and are { site: 'instagram' | 'x' }.
export function linkSite(url) {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const h = bare(host);
  const path = u.pathname;
  let m;
  if (/(^|\.)instagram\.com$/.test(host)) return { site: 'instagram' };
  if (isXPost(u.href)) return { site: 'x' };
  // YouTube: watch?v=, youtu.be/<id>, /shorts/, /live/, /embed/, /v/, music.youtube.com.
  if (/^(?:youtube\.com|music\.youtube\.com|youtube-nocookie\.com)$/.test(h) || h === 'youtu.be') {
    const id = h === 'youtu.be' ? (path.match(/^\/([\w-]{11})/) || [])[1]
      : u.searchParams.get('v')?.match(/^[\w-]{11}$/)?.[0] || (path.match(/^\/(?:shorts|live|embed|v|e)\/([\w-]{11})/) || [])[1];
    return id ? { site: 'youtube', id, short: /^\/shorts\//.test(path) } : { site: 'page' };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) {
    if (/^(?:vm|vt)\.tiktok\.com$/.test(host) || /^\/t\/[\w-]+/.test(path)) return { site: 'tiktok', short: true };
    if ((m = path.match(/^\/@([\w.-]{1,40})\/(video|photo)\/(\d{8,25})/))) return { site: 'tiktok', id: m[3], handle: m[1], photo: m[2] === 'photo' };
    if ((m = path.match(/^\/v\/(\d{8,25})/)) || (m = path.match(/\/(?:video|embed(?:\/v2)?)\/(\d{8,25})/))) return { site: 'tiktok', id: m[1] };
    return { site: 'page' };
  }
  if (/(^|\.)reddit\.com$/.test(host) || h === 'redd.it') {
    if (h === 'redd.it') return (m = path.match(/^\/([a-z0-9]{4,12})\/?$/i)) ? { site: 'reddit', id: m[1].toLowerCase() } : { site: 'page' };
    if ((m = path.match(/\/comments\/([a-z0-9]{4,12})(?:\/|$)/i))) return { site: 'reddit', id: m[1].toLowerCase(), sub: (path.match(/^\/r\/([\w]{2,30})\//) || [])[1] || '' };
    if (/^\/(?:r|u|user)\/[\w-]+\/s\/[\w]+/.test(path)) return { site: 'reddit', short: true };
    return { site: 'page' };
  }
  if (h === 'bsky.app' && (m = path.match(/^\/profile\/([^/]+)\/post\/([a-z0-9]{6,20})/i))) return { site: 'bluesky', actor: decodeURIComponent(m[1]), rkey: m[2] };
  if (/(^|\.)pinterest\.[a-z.]{2,8}$/.test(host)) {
    if ((m = path.match(/^\/pin\/(?:[^/]*?--)?(\d{6,25})\/?/))) return { site: 'pinterest', id: m[1] };
    return { site: 'page' };
  }
  if (h === 'pin.it') return { site: 'pinterest', short: true };
  if (/^(?:vimeo\.com|player\.vimeo\.com)$/.test(h) && /\/(\d{5,12})(?:\/|$)/.test(path)) return { site: 'vimeo' };
  if (h === 'open.spotify.com' && /^\/(?:intl-[a-z-]+\/)?(?:track|album|playlist|episode|show|artist)\/[A-Za-z0-9]{10,30}/.test(path)) return { site: 'spotify' };
  if (h === 'spotify.link') return { site: 'spotify', short: true };
  if (h === 'soundcloud.com' && /^\/[\w-]+\/[\w-]+/.test(path)) return { site: 'soundcloud' };
  if (h === 'on.soundcloud.com') return { site: 'soundcloud', short: true };
  if (/^threads\.(?:net|com)$/.test(h) && (m = path.match(/^\/@([\w.]{1,40})\/post\/([\w-]{5,20})/))) return { site: 'threads', handle: m[1], code: m[2] };
  if (/^(?:facebook\.com|fb\.watch|fb\.com|web\.facebook\.com)$/.test(h)) return { site: 'facebook', post: /^\/(?:share\/|permalink\.php|story\.php|photo|watch|reel\/|groups\/[^/]+\/(?:posts|permalink)\/|[^/]+\/(?:posts|videos|photos)\/)/.test(path) || h === 'fb.watch' };
  if (/^(?:linkedin\.com)$/.test(h) && /^\/(?:posts|feed\/update|pulse)\//.test(path)) return { site: 'linkedin' };
  return { site: 'page' };
}

// What's worth reading: a link this file has a reader for (not Instagram or X, which have their own).
export const canReadLink = (url) => { const s = linkSite(url); return !!s && s.site !== 'instagram' && s.site !== 'x'; };

// --- what to fetch ------------------------------------------------------------------------------------

// A request: { key, url, as: 'json' | 'html', browser (send BROWSER_UA), keep (markers of the inline
// scripts worth keeping when the app trims a big page before parsing it) }.
const page = (url, keep = []) => ({ key: 'page', url, as: 'html', browser: true, keep });
const json = (key, url, browser = false) => ({ key, url, as: 'json', browser, keep: [] });

// What to fetch for a shared link, best first. Each is a GET with no cookies. [] for Instagram and X.
export function linkRequests(url) {
  const s = linkSite(url);
  const u = parse(url);
  if (!s || !u || s.site === 'instagram' || s.site === 'x') return [];
  const href = u.href;
  switch (s.site) {
    case 'youtube': {
      const watch = `https://www.youtube.com/watch?v=${s.id}`;
      return [json('oembed', `https://www.youtube.com/oembed?format=json&url=${enc(s.short ? `https://www.youtube.com/shorts/${s.id}` : watch)}`), page(`${watch}&hl=en`, ['ytInitialPlayerResponse'])];
    }
    case 'tiktok':
      if (s.short) return [page(href, ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE'])];
      return [json('oembed', `https://www.tiktok.com/oembed?url=${enc(`https://www.tiktok.com/@${s.handle || '_'}/${s.photo ? 'photo' : 'video'}/${s.id}`)}`), page(`https://www.tiktok.com/@${s.handle || '_'}/${s.photo ? 'photo' : 'video'}/${s.id}`, ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE'])];
    case 'reddit':
      if (s.short) return [page(href, [])];
      return [json('post', `https://www.reddit.com/comments/${s.id}/.json?raw_json=1&limit=12&depth=1&sort=top`, true), json('oembed', `https://www.reddit.com/oembed?url=${enc(`https://www.reddit.com/comments/${s.id}/`)}`)];
    case 'bluesky':
      return [
        json('thread', `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${enc(`at://${s.actor}/app.bsky.feed.post/${s.rkey}`)}&depth=0&parentHeight=1`),
        json('oembed', `https://embed.bsky.app/oembed?format=json&url=${enc(`https://bsky.app/profile/${s.actor}/post/${s.rkey}`)}`),
      ];
    case 'pinterest':
      if (s.short) return [page(href, [])];
      return [json('pin', `https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${s.id}`), page(`https://www.pinterest.com/pin/${s.id}/`, [])];
    case 'vimeo':
      return [json('oembed', `https://vimeo.com/api/oembed.json?url=${enc(href)}`)];
    case 'spotify':
      if (s.short) return [page(href, [])];
      return [json('oembed', `https://open.spotify.com/oembed?url=${enc(href)}`), page(href, [])];
    case 'soundcloud':
      if (s.short) return [page(href, [])];
      return [json('oembed', `https://soundcloud.com/oembed?format=json&url=${enc(href)}`)];
    default:
      return [page(href, [])];
  }
}

// Where a page says it really is: its canonical link, og:url, or an app link to the post.
export function resolvedUrl(html, base = '') {
  const src = String(html || '').slice(0, 600_000);
  const candidates = [
    linkHref(src, 'canonical'),
    metaOf(src, 'og:url'),
    metaOf(src, 'twitter:url'),
    metaOf(src, 'al:web:url'),
    (src.match(/<shreddit-post\b[^>]*\bpermalink="([^"]+)"/i) || [])[1],
    (src.match(/"canonicalUrl"\s*:\s*"([^"]+)"/) || [])[1]?.replace(/\\u002F/g, '/'),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const u = new URL(decodeEntities(c), base || undefined);
      if (/^https?:$/.test(u.protocol)) return u.href;
    } catch { /* not a URL */ }
  }
  return '';
}

// After the first round: for a short link, the post it points to and that post's own data. Returns
// { url, requests } (requests [] when there is nothing more to ask).
export function linkFollowUp(url, bundle = {}) {
  const s = linkSite(url);
  const out = { url: '', requests: [] };
  if (!s) return out;
  const html = typeof bundle?.page === 'string' ? bundle.page : '';
  if (s.short) {
    const real = resolvedUrl(html, url);
    const r = linkSite(real);
    if (!real || !r || r.short || r.site === 'page' || r.site !== s.site) return out;
    out.url = real;
    // The page already read is that post's page: only its data is asked for.
    out.requests = linkRequests(real).filter((q) => !(q.key in (bundle || {})));
    return out;
  }
  // Any other page that says nothing itself but offers an oEmbed answer (WordPress, many blogs and video sites).
  if (s.site === 'page' && html && !bundle.oembed) {
    const thin = !metaOf(html, 'og:description') && !metaOf(html, 'description') && !metaOf(html, 'og:title');
    const oe = (html.match(/<link\b[^>]*type=["']application\/json\+oembed["'][^>]*>/i) || [])[0];
    const href = oe ? attr(oe, 'href') : '';
    if (thin && href) {
      try { const u = new URL(decodeEntities(href), url); if (u.protocol === 'https:') out.requests = [json('oembed', u.href)]; } catch { /* not a URL */ }
    }
  }
  return out;
}

// --- reading HTML without a DOM --------------------------------------------------------------------

function attr(tag, name) {
  const m = String(tag).match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

// Every <meta> by property, name or itemprop (first wins), with entities decoded.
export function metaTags(html) {
  const out = {};
  const src = String(html || '').slice(0, 3_000_000);
  for (const m of src.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop')).toLowerCase();
    const value = attr(tag, 'content');
    if (key && value && !(key in out)) out[key] = decodeEntities(value).trim();
    if (Object.keys(out).length > 300) break;
  }
  return out;
}

function metaOf(html, name) { return metaTags(html)[name.toLowerCase()] || ''; }

function linkHref(html, rel) {
  for (const m of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    if (attr(m[0], 'rel').toLowerCase().split(/\s+/).includes(rel)) return attr(m[0], 'href');
  }
  return '';
}

// The JSON object that starts at the first "{" after `marker` (a script's `var x = {...};`), or null.
export function jsonAfter(src, marker, limit = 4_000_000) {
  const s = String(src || '');
  const at = s.indexOf(marker);
  if (at < 0) return null;
  const start = s.indexOf('{', at + marker.length);
  if (start < 0 || start - at > 200) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start, end = Math.min(s.length, start + limit); i < end; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// An inline <script id="…"> that holds JSON.
function scriptJson(src, id) {
  const m = String(src || '').match(new RegExp(`<script\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, 'i'));
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

function ldNodes(src) {
  const nodes = [];
  const walk = (n, depth = 0) => {
    if (!n || depth > 6 || nodes.length > 200) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (typeof n !== 'object') return;
    nodes.push(n);
    if (n['@graph']) walk(n['@graph'], depth + 1);
    if (n.mainEntity && typeof n.mainEntity === 'object') walk(n.mainEntity, depth + 1);
  };
  for (const m of String(src || '').matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* not JSON */ }
  }
  return nodes;
}

const typesOf = (n) => [].concat(n?.['@type'] || []).map((t) => String(t));
const textOf = (v) => decodeEntities(String(v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
const nameOf = (v) => (Array.isArray(v) ? nameOf(v[0]) : v && typeof v === 'object' ? textOf(v.name || '') : textOf(v || ''));
const absUrl = (v, base) => {
  const raw = Array.isArray(v) ? v[0] : v && typeof v === 'object' ? v.url || v.contentUrl || '' : v;
  try { const u = new URL(decodeEntities(String(raw || '').trim()), base || undefined); return /^https?:$/.test(u.protocol) ? sanitizeUrl(u.href) : ''; } catch { return ''; }
};

// What sign-in pages, bot checks and error pages are called: not what the link is about.
const JUNK_TITLE = /^(?:(?:tiktok|youtube|reddit|facebook|instagram|pinterest|threads|bluesky|vimeo|spotify|soundcloud|linkedin)(?:\s*[-–|:]\s*.{0,60})?|log ?in|sign ?in|sign up|log in or sign up(?: to view)?|just a moment\.{0,3}|attention required!?.*|access denied|403 forbidden|404 not found|page not found|are you a robot\??|security check|verify you are human|please wait\.{0,3}|redirecting\.{0,3}|error|whoops!?.*|blocked|too many requests)$/i;
export const junkTitle = (t) => !String(t || '').trim() || JUNK_TITLE.test(String(t).trim());
const BOT_WALL = /<title>\s*(?:just a moment|attention required|access denied|are you a robot|security check|blocked|too many requests)|cf-browser-verification|challenge-platform|captcha-delivery|px-captcha|You've been blocked by network security/i;

// A web page's own description of itself: title, description, picture, site, type, date, author, and the
// schema.org data capture.js reads (types, a recipe, a place, a product's price). Plain string parsing.
export function pageFacts(html, url = '') {
  const src = String(html || '').slice(0, 3_000_000);
  const meta = metaTags(src);
  const nodes = ldNodes(src);
  const of = (re) => nodes.find((n) => typesOf(n).some((t) => re.test(t)));
  const recipe = of(/^recipe$/i);
  const product = of(/^(?:product|productgroup|individualproduct|productmodel)$/i);
  const video = of(/^(?:videoobject)$/i);
  const article = of(/article$|^blogposting$|^socialmediaposting$|^discussionforumposting$/i);
  const place = of(/^(?:restaurant|foodestablishment|cafeorcoffeeshop|bakery|barorpub|localbusiness|touristattraction|museum|park|lodgingbusiness|hotel|store|winery|brewery)$/i);
  const docTitle = textOf((src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const title = [nameOf(recipe?.name), nameOf(product?.name), meta['og:title'], meta['twitter:title'], nameOf(article?.headline), nameOf(video?.name), docTitle].find((t) => t && !junkTitle(t)) || '';
  const description = [meta['og:description'], meta['twitter:description'], meta.description, textOf(typeof recipe?.description === 'string' ? recipe.description : ''), textOf(typeof video?.description === 'string' ? video.description : '')].find((t) => t && t.length > 3) || '';
  const images = [];
  for (const v of [meta['og:image'], meta['og:image:url'], meta['og:image:secure_url'], meta['twitter:image'], meta['twitter:image:src'], recipe?.image, product?.image, video?.thumbnailUrl, article?.image]) {
    const a = absUrl(v, url);
    if (a && !/logo|favicon|placeholder|\.svg(?:$|\?)/i.test(a) && !images.includes(a)) images.push(a);
  }
  let price = null;
  let currency = '';
  for (const o of [].concat(product?.offers || []).flatMap((x) => (x?.offers ? [x, ...[].concat(x.offers)] : [x])).slice(0, 10)) {
    const p = Number(String(o?.price ?? o?.lowPrice ?? '').replace(/[^\d.]/g, ''));
    if (price === null && p > 0) { price = p; currency = String(o.priceCurrency || '').toUpperCase(); }
  }
  if (price === null && meta['product:price:amount']) {
    const p = Number(String(meta['product:price:amount']).replace(/[^\d.]/g, ''));
    if (p > 0) { price = p; currency = String(meta['product:price:currency'] || '').toUpperCase(); }
  }
  const loginWall = !meta['og:description'] && !meta.description && /name=["']?(?:username|email|pass)["']?|\/accounts\/login|\/login\/?["'?]/i.test(src);
  return {
    title: sanitizeText(title, 300),
    description: sanitizeMultiline(description, 2000),
    image: images[0] || '',
    images: images.slice(0, 8),
    siteName: sanitizeText(meta['og:site_name'] || meta['application-name'] || nameOf(article?.publisher), 80),
    ogType: sanitizeText(meta['og:type'], 40),
    canonical: resolvedUrl(src, url),
    author: sanitizeText(nameOf(article?.author) || nameOf(recipe?.author) || meta.author || (/^https?:/.test(meta['article:author'] || '') ? '' : meta['article:author'] || ''), 80),
    published: sanitizeText(meta['article:published_time'] || article?.datePublished || video?.uploadDate || recipe?.datePublished || '', 40),
    duration: sanitizeText(video?.duration || meta['video:duration'] || meta['og:video:duration'] || '', 20),
    channel: sanitizeText(nameOf(video?.author) || nameOf(video?.creator), 80),
    keywords: sanitizeText(meta.keywords, 400),
    schemaTypes: [...new Set(nodes.flatMap(typesOf))].slice(0, 20),
    recipe: recipe ? plain({
      name: recipe.name, recipeIngredient: [].concat(recipe.recipeIngredient || recipe.ingredients || []).slice(0, 80), recipeInstructions: [].concat(recipe.recipeInstructions || []).slice(0, 60),
      recipeYield: recipe.recipeYield, totalTime: recipe.totalTime, prepTime: recipe.prepTime, cookTime: recipe.cookTime, recipeCuisine: recipe.recipeCuisine, recipeCategory: recipe.recipeCategory, author: recipe.author,
    }) : null,
    place: place && !product ? plain({ '@type': place['@type'], name: place.name, address: place.address, geo: place.geo, telephone: place.telephone, servesCuisine: place.servesCuisine, priceRange: place.priceRange, openingHours: place.openingHours, openingHoursSpecification: [].concat(place.openingHoursSpecification || []).slice(0, 40) }) : null,
    price,
    currency: currency.slice(0, 3),
    loginWall,
    botWall: BOT_WALL.test(src.slice(0, 200_000)),
  };
}

const plain = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch { return null; } };

// --- each site's data ------------------------------------------------------------------------------

const iso = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  const d = Number.isFinite(n) && String(v).trim() !== '' ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2004 ? '' : d.toISOString();
};
const seconds = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n < 86400 * 2 ? n : null; };
const ok = (o) => o && typeof o === 'object' && !Array.isArray(o);

function blank(site, url) {
  return { site, ok: false, url, post: false, postType: '', title: '', text: '', creator: '', name: '', postedAt: '', hashtags: [], links: [], image: '', images: [], durationSeconds: null, location: '', place: null, siteName: '', page: null, source: '' };
}

const pushImage = (r, v) => { const u = sanitizeUrl(v); if (u && !r.images.includes(u)) r.images.push(u); };

function youtube(b, s, url) {
  const r = blank('youtube', `https://www.youtube.com/${s.short ? `shorts/${s.id}` : `watch?v=${s.id}`}`);
  r.siteName = 'YouTube';
  r.postType = s.short ? 'youtube-short' : 'youtube';
  const o = ok(b.oembed) ? b.oembed : null;
  const html = typeof b.page === 'string' ? b.page : '';
  const player = html ? jsonAfter(html, 'ytInitialPlayerResponse') : null;
  const v = player?.videoDetails || {};
  const mf = player?.microformat?.playerMicroformatRenderer || {};
  r.title = sanitizeText(v.title || o?.title || '', 300);
  r.text = sanitizeMultiline(v.shortDescription || mf.description?.simpleText || '', 4000);
  r.name = sanitizeText(v.author || o?.author_name || '', 80);
  r.creator = sanitizeText((String(o?.author_url || '').match(/youtube\.com\/@([\w.-]{1,40})/) || [])[1] || (String(mf.ownerProfileUrl || '').match(/@([\w.-]{1,40})/) || [])[1] || '', 40);
  r.postedAt = iso(mf.publishDate || mf.uploadDate);
  r.durationSeconds = seconds(v.lengthSeconds);
  pushImage(r, `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`);
  if (o?.thumbnail_url) pushImage(r, o.thumbnail_url);
  r.image = r.images[0];
  r.hashtags = [...new Set([...(r.text.matchAll(HASHTAG_RE))].map((x) => x[1].toLowerCase()))].slice(0, 20);
  r.keywords = (Array.isArray(v.keywords) ? v.keywords : []).slice(0, 20).map((k) => sanitizeText(k, 60));
  r.category = sanitizeText(mf.category, 40);
  r.links = linksIn(r.text, ['youtube.com', 'youtu.be']);
  r.ok = !!(r.title || o);
  r.source = player ? 'page' : o ? 'oembed' : '';
  return r;
}

// TikTok's page data: the video (or photo post) itself, with its sound and tagged place.
function tiktokItem(html) {
  if (!html) return null;
  const u = scriptJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const scope = u?.__DEFAULT_SCOPE__ || {};
  const item = scope['webapp.video-detail']?.itemInfo?.itemStruct || scope['webapp.reflow.video.detail']?.itemInfo?.itemStruct;
  if (ok(item) && (item.desc !== undefined || item.id)) return item;
  const sigi = scriptJson(html, 'SIGI_STATE');
  const mod = sigi?.ItemModule && Object.values(sigi.ItemModule)[0];
  return ok(mod) ? mod : null;
}

function tiktok(b, s, url) {
  const r = blank('tiktok', url);
  r.siteName = 'TikTok';
  r.post = true;
  const o = ok(b.oembed) && (b.oembed.title !== undefined || b.oembed.author_name) ? b.oembed : null;
  const html = typeof b.page === 'string' ? b.page : '';
  const item = tiktokItem(html);
  const author = ok(item?.author) ? item.author : {};
  const handle = sanitizeText(author.uniqueId || o?.author_unique_id || s.handle || (String(o?.author_url || '').match(/@([\w.-]+)/) || [])[1] || '', 40);
  const id = s.id || sanitizeText(item?.id || o?.embed_product_id || '', 25);
  const photo = !!(item?.imagePost || s.photo);
  r.url = id ? `https://www.tiktok.com/@${handle || '_'}/${photo ? 'photo' : 'video'}/${id}` : url;
  r.creator = handle;
  r.name = sanitizeText(author.nickname || o?.author_name || '', 80);
  // The caption: TikTok's own text (with the photo post's title), else the embed's.
  const contents = Array.isArray(item?.contents) ? item.contents.map((c) => c?.desc).filter(Boolean).join('\n') : '';
  const caption = [item?.imagePost?.title, item?.desc || contents || o?.title].filter(Boolean).join('\n');
  r.text = sanitizeMultiline(decodeEntities(caption), 4000);
  r.postedAt = iso(item?.createTime);
  r.durationSeconds = seconds(item?.video?.duration);
  for (const img of (item?.imagePost?.images || []).slice(0, 10)) pushImage(r, img?.imageURL?.urlList?.[0]);
  pushImage(r, item?.video?.cover || item?.video?.originCover);
  pushImage(r, o?.thumbnail_url);
  if (!r.images.length && html) pushImage(r, metaOf(html, 'og:image'));
  r.image = r.images[0] || '';
  const tags = (item?.textExtra || []).map((t) => t?.hashtagName).filter(Boolean);
  r.hashtags = [...new Set([...tags, ...[...r.text.matchAll(HASHTAG_RE)].map((x) => x[1])].map((t) => String(t).toLowerCase()))].slice(0, 30);
  const poi = item?.poi || item?.poiInfo;
  if (ok(poi) && poi.name) {
    r.location = sanitizeText(poi.name, 120);
    r.place = { name: poi.name, address: poi.address || '', city: poi.city || '', region: poi.province || poi.region || '', postalCode: '', lat: null, lng: null };
  }
  if (item?.music?.title && !item.music.original) r.sound = sanitizeText(`${item.music.title}${item.music.authorName ? ` · ${item.music.authorName}` : ''}`, 120);
  r.postType = photo ? 'tiktok-photo' : 'tiktok';
  r.title = xTitle(r.text, '', photo ? 'post' : 'video', '') || (handle ? `${photo ? 'Post' : 'Video'} by @${handle} on TikTok` : '');
  r.links = linksIn(r.text, ['tiktok.com']);
  r.ok = !!(r.text || (o && handle) || item);
  r.source = item ? 'page' : o ? 'oembed' : '';
  if (!r.ok && html) return pageOnly(r, html, url);
  return r;
}

function reddit(b, s, url) {
  const r = blank('reddit', url);
  r.siteName = 'Reddit';
  r.post = true;
  r.postType = 'reddit';
  const listing = Array.isArray(b.post) ? b.post : null;
  let p = listing?.[0]?.data?.children?.[0]?.data;
  if (ok(p) && Array.isArray(p.crosspost_parent_list) && p.crosspost_parent_list[0] && !p.selftext) p = { ...p.crosspost_parent_list[0], title: p.title || p.crosspost_parent_list[0].title };
  const o = ok(b.oembed) ? b.oembed : null;
  if (ok(p) && p.title) {
    r.url = p.permalink ? `https://www.reddit.com${p.permalink}` : url;
    r.title = sanitizeText(decodeEntities(p.title), 300);
    r.creator = p.author && p.author !== '[deleted]' ? sanitizeText(p.author, 40) : '';
    r.subreddit = sanitizeText(p.subreddit, 40);
    r.postedAt = iso(p.created_utc);
    const parts = [decodeEntities(p.selftext || '')];
    // The poster's own comments: where "recipe in the comments" and "details below" usually are.
    const comments = (listing?.[1]?.data?.children || []).map((c) => c?.data).filter((c) => ok(c) && c.body && c.author && c.author === p.author);
    for (const c of comments.slice(0, 2)) parts.push(`Comment by the poster: ${decodeEntities(c.body)}`);
    r.text = sanitizeMultiline(parts.filter(Boolean).join('\n\n'), 4000);
    if (p.url && !/reddit\.com|redd\.it/.test(p.url) && !p.is_self) r.links = [{ url: sanitizeUrl(p.url), label: sanitizeText(p.domain || p.url, 80) }].filter((l) => l.url);
    for (const l of linksIn(r.text, ['reddit.com', 'redd.it'])) if (!r.links.some((x) => x.url === l.url)) r.links.push(l);
    if (p.media_metadata && typeof p.media_metadata === 'object') {
      const order = (p.gallery_data?.items || []).map((i) => i.media_id);
      for (const id of (order.length ? order : Object.keys(p.media_metadata)).slice(0, 10)) pushImage(r, decodeEntities(p.media_metadata[id]?.s?.u || p.media_metadata[id]?.s?.gif || ''));
    }
    pushImage(r, decodeEntities(p.preview?.images?.[0]?.source?.url || ''));
    if (/^https:/.test(p.thumbnail || '')) pushImage(r, p.thumbnail);
    if (/\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(p.url || '')) pushImage(r, p.url);
    r.image = r.images[0] || '';
    r.durationSeconds = seconds(p.media?.reddit_video?.duration || p.secure_media?.reddit_video?.duration);
    if (p.is_video) r.postType = 'reddit-video';
    r.flair = sanitizeText(p.link_flair_text, 60);
    r.ok = true;
    r.source = 'json';
  } else if (o && (o.title || o.author_name)) {
    r.title = sanitizeText(decodeEntities(o.title || ''), 300);
    r.creator = sanitizeText(o.author_name, 40);
    r.subreddit = sanitizeText((String(o.html || '').match(/reddit\.com\/r\/(\w+)/) || [])[1] || s.sub || '', 40);
    r.ok = !!r.title;
    r.source = 'oembed';
  } else if (typeof b.page === 'string') {
    const html = b.page;
    const tag = (html.match(/<shreddit-post\b[^>]*>/i) || [])[0] || '';
    if (tag) {
      r.title = sanitizeText(decodeEntities(attr(tag, 'post-title')), 300);
      r.creator = sanitizeText(attr(tag, 'author'), 40);
      r.subreddit = sanitizeText(attr(tag, 'subreddit-prefixed-name').replace(/^r\//, ''), 40);
      r.postedAt = iso(attr(tag, 'created-timestamp'));
      const href = decodeEntities(attr(tag, 'content-href'));
      if (href && !/reddit\.com|redd\.it/.test(href)) r.links = [{ url: sanitizeUrl(href), label: sanitizeText(href.replace(/^https?:\/\/(www\.)?/, ''), 80) }].filter((l) => l.url);
      const perm = attr(tag, 'permalink');
      if (perm) r.url = `https://www.reddit.com${perm}`;
    }
    const f = pageFacts(html, url);
    if (!r.title) r.title = f.title.replace(/\s*:\s*r\/\w+\s*$/i, '');
    if (!r.text && f.description && f.description !== r.title) r.text = f.description;
    for (const i of f.images) pushImage(r, i);
    r.image = r.images[0] || '';
    r.ok = !!r.title && !f.botWall;
    r.source = 'page';
  }
  if (r.subreddit) r.text = sanitizeMultiline([r.text, `Posted in r/${r.subreddit}${r.flair ? ` (${r.flair})` : ''}`].filter(Boolean).join('\n\n'), 4000);
  r.hashtags = [...new Set([...r.text.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))].slice(0, 20);
  return r;
}

function bluesky(b, s, url) {
  const r = blank('bluesky', url);
  r.siteName = 'Bluesky';
  r.post = true;
  r.postType = 'bluesky';
  const post = b.thread?.thread?.post;
  const o = ok(b.oembed) ? b.oembed : null;
  const textWithLinks = (record) => {
    let t = String(record?.text || '');
    // Links are shortened in the text ("example.com/long-pa…"); the facets have them whole. Facets count
    // UTF-8 bytes (no TextEncoder in JavaScriptCore, so the byte offsets are counted here).
    const chars = Array.from(t);
    const at = [0];
    for (const c of chars) { const n = c.codePointAt(0); at.push(at[at.length - 1] + (n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4)); }
    const charAt = (byte) => { const i = at.indexOf(byte); return i < 0 ? -1 : i; };
    const pieces = [];
    let last = 0;
    for (const f of [...(record?.facets || [])].sort((a, z) => (a.index?.byteStart || 0) - (z.index?.byteStart || 0))) {
      const link = (f.features || []).find((x) => /#link$/.test(x?.$type || ''))?.uri;
      const from = charAt(f.index?.byteStart);
      const to = charAt(f.index?.byteEnd);
      if (!link || from < last || to <= from) continue;
      pieces.push(chars.slice(last, from).join(''), link);
      last = to;
    }
    if (pieces.length) t = pieces.join('') + chars.slice(last).join('');
    return t;
  };
  if (ok(post) && post.record) {
    r.creator = sanitizeText(post.author?.handle, 60);
    r.name = sanitizeText(post.author?.displayName, 80);
    r.postedAt = iso(post.record.createdAt || post.indexedAt);
    const parts = [textWithLinks(post.record)];
    const e = post.embed || {};
    const media = e.media || e;
    for (const img of (media.images || []).slice(0, 10)) pushImage(r, img?.fullsize || img?.thumb);
    if (media.thumbnail) pushImage(r, media.thumbnail);
    const ext = media.external || e.external;
    if (ext?.uri) { r.links.push({ url: sanitizeUrl(ext.uri), label: sanitizeText(ext.title || ext.uri, 80) }); if (ext.thumb) pushImage(r, ext.thumb); }
    const q = e.record?.record || e.record;
    const qv = q?.value;
    if (qv?.text) parts.push(`Quoting @${q.author?.handle || 'someone'}: ${qv.text}`);
    const parent = b.thread.thread.parent?.post;
    if (parent?.record?.text) parts.push(parent.author?.did === post.author?.did ? `Earlier in the thread: ${parent.record.text}` : `Replying to @${parent.author?.handle || 'someone'}: ${parent.record.text}`);
    r.text = sanitizeMultiline(parts.filter(Boolean).join('\n\n'), 4000);
    r.url = `https://bsky.app/profile/${r.creator || s.actor}/post/${s.rkey}`;
    r.source = 'api';
  } else if (o?.html) {
    const p = (o.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
    r.text = sanitizeMultiline(textOf(p), 4000);
    r.name = sanitizeText(o.author_name, 80);
    r.creator = s.actor.includes('.') ? s.actor : '';
    r.source = 'oembed';
  }
  r.links = r.links.filter((l) => l.url);
  for (const l of linksIn(r.text, ['bsky.app'])) if (!r.links.some((x) => x.url === l.url)) r.links.push(l);
  r.image = r.images[0] || '';
  r.hashtags = [...new Set([...r.text.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))].slice(0, 30);
  r.title = xTitle(r.text, '', 'post', '') || (r.creator ? `Post by @${r.creator} on Bluesky` : '');
  r.ok = !!(r.text || r.images.length);
  return r;
}

function pinterest(b, s, url) {
  const r = blank('pinterest', url);
  r.siteName = 'Pinterest';
  r.post = true;
  r.postType = 'pinterest';
  const pin = b.pin?.data?.[0] || (Array.isArray(b.pin?.data) ? null : b.pin?.data);
  const html = typeof b.page === 'string' ? b.page : '';
  if (ok(pin)) {
    const id = s.id || pin.id;
    if (id) r.url = `https://www.pinterest.com/pin/${id}/`;
    const title = textOf(pin.title || pin.grid_title || pin.rich_metadata?.title || '');
    const desc = textOf(pin.description || pin.rich_metadata?.description || '');
    r.text = sanitizeMultiline([title && !desc.startsWith(title) ? title : '', desc].filter(Boolean).join('\n'), 4000);
    r.creator = sanitizeText(pin.pinner?.username, 40);
    r.name = sanitizeText(pin.pinner?.full_name, 80);
    r.board = sanitizeText(pin.board?.name, 80);
    const imgs = pin.images || {};
    pushImage(r, imgs.orig?.url || imgs['736x']?.url || imgs['564x']?.url || imgs['237x']?.url);
    if (pin.link && !/pinterest\./.test(pin.link)) r.links.push({ url: sanitizeUrl(pin.link), label: sanitizeText(pin.domain || pin.link.replace(/^https?:\/\/(www\.)?/, ''), 80) });
    r.title = sanitizeText(title, 200) || xTitle(desc, '', 'post', '');
    r.source = 'widget';
  }
  if (html && (!r.text || !r.images.length)) {
    const f = pageFacts(html, url);
    if (!r.text) r.text = sanitizeMultiline(f.description, 4000);
    if (!r.title && f.title && !/^pin on /i.test(f.title)) r.title = f.title.replace(/\s*\|\s*Pinterest$/i, '');
    for (const i of f.images) pushImage(r, i);
    if (f.recipe) r.recipe = f.recipe;
    if (!r.source) r.source = 'page';
  }
  r.links = r.links.filter((l) => l.url);
  if (r.board) r.text = sanitizeMultiline([r.text, `Saved to the board “${r.board}”`].filter(Boolean).join('\n\n'), 4000);
  r.image = r.images[0] || '';
  r.hashtags = [...new Set([...r.text.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))].slice(0, 20);
  if (!r.title) r.title = xTitle(r.text, '', 'post', '') || (r.creator ? `Pin by @${r.creator}` : '');
  r.ok = !!(r.text || r.images.length);
  return r;
}

// Vimeo, SoundCloud, Spotify: the site's oEmbed (title, who made it, picture, length).
function oembedOnly(site, label, b, url) {
  const r = blank(site, url);
  r.siteName = label;
  const o = ok(b.oembed) ? b.oembed : null;
  const html = typeof b.page === 'string' ? b.page : '';
  const f = html ? pageFacts(html, url) : null;
  if (o) {
    r.title = sanitizeText(decodeEntities(o.title || ''), 300);
    r.name = sanitizeText(o.author_name, 80);
    r.text = sanitizeMultiline(decodeEntities(o.description || ''), 4000);
    r.durationSeconds = seconds(o.duration);
    r.postedAt = iso(o.upload_date);
    pushImage(r, o.thumbnail_url);
  }
  if (f) {
    if (!r.title) r.title = f.title;
    if (!r.text) r.text = sanitizeMultiline(f.description, 4000);
    for (const i of f.images) pushImage(r, i);
    r.ogType = f.ogType;
    if (f.canonical && linkSite(f.canonical)?.site === site) r.url = f.canonical;
  }
  r.image = r.images[0] || '';
  r.ok = !!r.title;
  r.source = o ? 'oembed' : f ? 'page' : '';
  return r;
}

// Threads, Facebook, LinkedIn posts: what their public page shares in its link preview.
function socialPage(site, label, b, s, url) {
  const r = blank(site, url);
  r.siteName = label;
  r.post = site === 'threads' || site === 'linkedin' || !!s.post;
  r.postType = r.post ? site : '';
  const html = typeof b.page === 'string' ? b.page : '';
  if (!html) return r;
  const f = pageFacts(html, url);
  if (f.botWall) return r;
  let text = f.description;
  // "Name (@handle) on Threads" / Facebook's "Name - Some words | Facebook".
  const who = f.title.match(/^(.*?)\s*\(@([\w.]{1,40})\)\s+on\s+Threads/i);
  if (who) { r.name = sanitizeText(who[1], 80); r.creator = who[2]; }
  if (site === 'threads') r.creator = r.creator || s.handle || '';
  if (site === 'facebook') {
    // Facebook's preview says "12K reactions · 300 comments | Name | Text…" ahead of the post's words.
    text = text.replace(/^(?:[\d.,]+[KM]?\s+(?:reactions?|likes?|comments?|shares?|views?)\s*(?:·|\|)\s*)+/i, '').trim();
  }
  r.text = sanitizeMultiline(text, 4000);
  for (const i of f.images) pushImage(r, i);
  r.image = r.images[0] || '';
  if (f.canonical && linkSite(f.canonical)?.site === site) r.url = f.canonical;
  r.title = r.post ? xTitle(r.text, '', 'post', '') || (f.title && !junkTitle(f.title) ? f.title : '') : f.title;
  r.hashtags = [...new Set([...r.text.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))].slice(0, 30);
  r.links = linksIn(r.text, [site === 'threads' ? 'threads.net' : 'facebook.com']);
  r.page = f;
  r.ok = !!(r.text || (f.title && !junkTitle(f.title))) && !(f.loginWall && !f.description);
  r.source = 'page';
  return r;
}

// Any other web page: its own description of itself.
function pageOnly(r, html, url) {
  const f = pageFacts(html, url);
  r.page = f;
  r.title = r.title || f.title;
  r.text = r.text || f.description;
  for (const i of f.images) pushImage(r, i);
  r.image = r.images[0] || '';
  r.siteName = r.siteName || f.siteName;
  if (f.canonical) {
    // A canonical link to the same site only (a page never moves itself to another site).
    try { if (bare(new URL(f.canonical).hostname) === bare(new URL(url).hostname)) r.url = f.canonical; } catch { /* not a URL */ }
  }
  r.ok = !f.botWall && !!(f.title || f.description || f.image || f.schemaTypes.length);
  r.source = 'page';
  return r;
}

function linksIn(text, skipHosts = []) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = sanitizeUrl(m[0]);
    let host = '';
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { continue; }
    if (!u || skipHosts.some((h) => host === h || host.endsWith(`.${h}`)) || out.some((l) => l.url === u)) continue;
    out.push({ url: u, label: sanitizeText(u.replace(/^https?:\/\/(www\.)?/, ''), 80) });
    if (out.length >= 10) break;
  }
  return out;
}

// Everything worth keeping from a shared link. `bundle` holds the answers of linkRequests and
// linkFollowUp by key ({ page: html, oembed: {...}, post: [...], … }); `url` is the link as shared (or
// where linkFollowUp said a short link points). ok is false when nothing useful came back.
export function parseLink(bundle, url) {
  const b = bundle && typeof bundle === 'object' ? bundle : {};
  const real = b.resolvedUrl && linkSite(b.resolvedUrl) ? b.resolvedUrl : url;
  const s = linkSite(real);
  if (!s) return blank('', url);
  let r;
  switch (s.site) {
    case 'youtube': r = youtube(b, s, real); break;
    case 'tiktok': r = tiktok(b, s, real); break;
    case 'reddit': r = reddit(b, s, real); break;
    case 'bluesky': r = bluesky(b, s, real); break;
    case 'pinterest': r = pinterest(b, s, real); break;
    case 'vimeo': r = oembedOnly('vimeo', 'Vimeo', b, real); break;
    case 'spotify': r = oembedOnly('spotify', 'Spotify', b, real); break;
    case 'soundcloud': r = oembedOnly('soundcloud', 'SoundCloud', b, real); break;
    case 'threads': r = socialPage('threads', 'Threads', b, s, real); break;
    case 'facebook': r = socialPage('facebook', 'Facebook', b, s, real); break;
    case 'linkedin': r = socialPage('linkedin', 'LinkedIn', b, s, real); break;
    case 'page': r = typeof b.page === 'string' ? pageOnly(blank('page', real), b.page, real) : blank('page', real); break;
    default: r = blank(s.site, real);
  }
  // A page that only offered oEmbed (followed by linkFollowUp).
  if (s.site === 'page' && ok(b.oembed)) {
    if (!r.title || junkTitle(r.title)) r.title = sanitizeText(decodeEntities(b.oembed.title || ''), 300);
    if (!r.name) r.name = sanitizeText(b.oembed.author_name, 80);
    pushImage(r, b.oembed.thumbnail_url);
    r.image = r.image || r.images[0] || '';
    r.ok = r.ok || !!r.title;
  }
  r.title = sanitizeText(r.title, 300);
  if (junkTitle(r.title)) r.title = '';
  return r;
}

// What a capture keeps from a parsed post: the same record an Instagram post keeps (item.instagram).
export function linkPostRecord(r) {
  return {
    caption: r.text,
    creator: r.creator,
    postedAt: r.postedAt,
    hashtags: r.hashtags,
    links: r.links,
    location: r.location || '',
    place: r.place || null,
    postType: r.postType || r.site,
    originalImage: r.image || '',
  };
}

// Puts what was read on a capture (pure; returns a new product). What the share or the live page already
// gave wins, except a title that only names the app ("TikTok - Make Your Day") or is the address itself.
export function mergeLinkRead(product, r) {
  const p = { ...(product || {}) };
  if (!r || !r.ok) { p.linkRead = 'none'; return p; }
  p.linkRead = r.source || 'read';
  if (r.url && r.url !== p.url) {
    // A short link becomes the post's own address, so the same post shared twice is one save.
    p.sharedUrl = p.sharedUrl || p.url;
    p.url = r.url;
    p.canonicalUrl = r.url;
  }
  const weakTitle = !p.title || junkTitle(p.title) || p.title === p.sharedUrl || /^https?:\/\//.test(p.title) || p.title === r.siteName;
  if (r.title && weakTitle) p.title = r.title;
  if (r.siteName && !p.retailer) p.retailer = r.siteName;
  if (r.text && (!p.description || p.description.length < r.text.length || /^https?:\/\/\S+$/.test(p.description))) p.description = r.text;
  if (r.image && !p.image) p.image = r.image;
  if (r.images.length && !p.images?.length) p.images = r.images;
  if (r.hashtags.length && !p.hashtags?.length) p.hashtags = r.hashtags;
  // A post or a video site's own data says what it is; a page read from the share sheet stays a link unless
  // its own data says otherwise (a recipe, a product with a price, an article…), as before.
  if (r.site !== 'page') p.sparse = false;
  if (r.post) {
    p.isPost = true;
    if (!p.instagram) p.instagram = linkPostRecord(r);
    if (r.location && !p.igLocation?.name) p.igLocation = { name: r.location };
    if (r.recipe && !p.recipe) p.recipe = r.recipe;
  } else if (r.site === 'youtube') {
    p.media = { ...(p.media || {}), ogType: 'video.other', channel: p.media?.channel || r.name, duration: p.media?.duration || (r.durationSeconds ? String(r.durationSeconds) : ''), published: p.media?.published || r.postedAt, siteName: 'YouTube' };
    if (r.keywords?.length && !p.tags?.length) p.tags = r.keywords;
  } else if (['vimeo', 'soundcloud', 'spotify'].includes(r.site)) {
    p.media = { ...(p.media || {}), ogType: p.media?.ogType || r.ogType || (r.site === 'vimeo' ? 'video.other' : 'music'), channel: p.media?.channel || r.name, duration: p.media?.duration || (r.durationSeconds ? String(r.durationSeconds) : ''), published: p.media?.published || r.postedAt, siteName: r.siteName };
  } else if (r.page) {
    const f = r.page;
    if (!p.siteName && f.siteName) p.siteName = f.siteName;
    if (!p.schemaTypes?.length && f.schemaTypes.length) p.schemaTypes = f.schemaTypes;
    if (!p.recipe && f.recipe) p.recipe = f.recipe;
    if (!p.place && f.place) p.place = f.place;
    if ((p.price === null || p.price === undefined || p.price === '') && f.price !== null) { p.price = f.price; if (f.currency) p.currency = f.currency; }
    if (!p.media) p.media = { ogType: f.ogType, duration: f.duration, channel: f.channel, author: f.author, published: f.published, siteName: f.siteName, wordCount: 0 };
  }
  return p;
}
