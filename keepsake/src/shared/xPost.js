// Reads a post on X (Twitter) you shared, the way src/instagram/post.js reads an Instagram post: its
// text, who posted it, when, its pictures or video poster, the links in it, and the post it quotes or
// answers (the earlier post of a thread). X's own post pages need a script and an account, so the
// details come from X's public embed data, the same data an embedded post on any web page shows:
//   1. cdn.syndication.twimg.com/tweet-result (the post as JSON: text, media, quoted post, parent), then
//   2. publish.twitter.com/oembed (the embed's HTML: text, name and date only), if the first fails.
// No cookies and no account; only the post you shared is asked for. The app fetches (xPostRequests),
// this file only parses (parseXPost), so it is pure and runs in Chrome, iOS and the tests alike.

import { sanitizeText, sanitizeMultiline, sanitizeUrl, decodeEntities } from './util.js';

const X_HOST = /^(?:www\.|mobile\.|m\.)?(?:x\.com|twitter\.com)$/i;
const HASHTAG_RE = /#([\p{L}\p{N}_]{2,60})/gu;
const URL_RE = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,!?:;]/gi;

export const isXHost = (host) => X_HOST.test(String(host || ''));

// The post's id, from x.com/<user>/status/<id>, /i/status/<id>, /i/web/status/<id> (twitter.com too).
export function xStatusId(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return ''; }
  if (!isXHost(u.hostname)) return '';
  const m = u.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})(?:\/|$)/);
  return m ? m[1] : '';
}

export const isXPost = (url) => !!xStatusId(url);

// The handle in the address (x.com/<handle>/status/…), when it's there.
export function xHandleFromUrl(url) {
  try {
    const seg = new URL(String(url)).pathname.split('/')[1] || '';
    return /^[A-Za-z0-9_]{1,15}$/.test(seg) && seg !== 'i' ? seg : '';
  } catch { return ''; }
}

// The post's own address with no tracking (?s=46&t=…).
export function xPostUrl(url) {
  const id = xStatusId(url);
  if (!id) return '';
  return `https://x.com/${xHandleFromUrl(url) || 'i'}/status/${id}`;
}

// The embed data's token: what X's own embed script sends with the request (react-tweet uses the same).
export function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// What to fetch for a shared post, best first. Each is a GET with no cookies.
export function xPostRequests(url) {
  const id = xStatusId(url);
  if (!id) return [];
  return [
    { key: 'tweet', url: `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${xToken(id)}` },
    { key: 'oembed', url: `https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/i/status/${id}`)}&omit_script=1&dnt=true&hide_thread=false` },
  ];
}

// A post's text with X's t.co links written out, the media links (pic.x.com…) left off, and the reply's
// leading @names dropped (display_text_range).
function textOf(t) {
  if (!t || typeof t !== 'object') return '';
  // A long post (more than 280 characters) carries its full text in note_tweet when the embed has it.
  const note = t.note_tweet?.note_tweet_results?.result;
  let text = String(note?.text || t.full_text || t.text || '');
  const entities = (note?.entity_set) || t.entities || {};
  if (!note && Array.isArray(t.display_text_range) && t.display_text_range.length === 2) {
    // Indices count code points, not UTF-16 units.
    text = Array.from(text).slice(t.display_text_range[0], t.display_text_range[1]).join('');
  }
  for (const u of entities.urls || []) {
    if (u?.url && u.expanded_url) text = text.split(u.url).join(u.expanded_url);
  }
  for (const m of [...(entities.media || []), ...(t.entities?.media || [])]) if (m?.url) text = text.split(m.url).join('');
  // A quoted post's link at the end says nothing the quote doesn't.
  text = text.replace(/\s*https?:\/\/(?:x|twitter)\.com\/\w+\/status\/\d+\S*\s*$/i, '');
  return sanitizeMultiline(decodeEntities(text).replace(/[ \t]+\n/g, '\n').trim(), 4000);
}

const userOf = (t) => ({ creator: sanitizeText(t?.user?.screen_name, 30).replace(/^@/, ''), name: sanitizeText(decodeEntities(t?.user?.name || ''), 80) });

function linksOf(t) {
  const out = [];
  const add = (raw, label) => {
    const u = sanitizeUrl(raw);
    if (!u || out.some((l) => l.url === u)) return;
    let host = '';
    try { host = new URL(u).hostname; } catch { return; }
    if (isXHost(host) || /(^|\.)(?:t\.co|pic\.x\.com|pic\.twitter\.com|twimg\.com)$/i.test(host)) return;
    out.push({ url: u, label: sanitizeText(label || u.replace(/^https?:\/\/(www\.)?/, ''), 80) });
  };
  const note = t?.note_tweet?.note_tweet_results?.result;
  for (const u of [...(note?.entity_set?.urls || []), ...(t?.entities?.urls || [])]) add(u?.expanded_url, u?.display_url);
  // A link card ("summary_large_image") names the page it points to.
  const card = t?.card?.binding_values || {};
  const cardUrl = card.card_url?.string_value || t?.card?.url;
  const cardTitle = card.title?.string_value;
  if (cardUrl && /^https?:/.test(cardUrl) && !/t\.co\//.test(cardUrl)) add(cardUrl, cardTitle);
  return out.slice(0, 10);
}

function mediaOf(t) {
  const images = [];
  let video = null;
  for (const m of t?.mediaDetails || []) {
    const src = sanitizeUrl(m?.media_url_https);
    if (src && !images.includes(src)) images.push(src);
    if ((m?.type === 'video' || m?.type === 'animated_gif') && !video) {
      const mp4 = (m.video_info?.variants || []).filter((v) => v?.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      video = { poster: src, url: sanitizeUrl(mp4?.url), seconds: m.video_info?.duration_millis ? Math.round(m.video_info.duration_millis / 1000) : null, gif: m.type === 'animated_gif' };
    }
  }
  for (const p of t?.photos || []) { const u = sanitizeUrl(p?.url); if (u && !images.includes(u)) images.push(u); }
  if (!video && t?.video?.poster) {
    const v = (t.video.variants || []).find((x) => /mp4/.test(x?.type || ''));
    video = { poster: sanitizeUrl(t.video.poster), url: sanitizeUrl(v?.src), seconds: t.video.durationMs ? Math.round(t.video.durationMs / 1000) : null, gif: false };
    if (video.poster && !images.includes(video.poster)) images.push(video.poster);
  }
  // A link card's picture, when the post has none of its own.
  const card = t?.card?.binding_values || {};
  const cardImage = sanitizeUrl(card.thumbnail_image_large?.image_value?.url || card.summary_photo_image_large?.image_value?.url || card.photo_image_full_size_large?.image_value?.url);
  return { images: images.slice(0, 10), video, cardImage };
}

// The embed's HTML (oEmbed): <blockquote><p>text</p>&mdash; Name (@handle) <a>Date</a></blockquote>.
function fromOembed(o) {
  if (!o || typeof o !== 'object' || typeof o.html !== 'string') return null;
  const p = (o.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
  const text = decodeEntities(p.replace(/<br\s*\/?>/gi, '\n').replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const l = label.replace(/<[^>]+>/g, '');
    if (/^pic\.(?:x|twitter)\.com\//i.test(l)) return '';
    if (/^[#@]/.test(l)) return l;
    // A bare t.co link says nothing; a link X shows by its address is written out, set apart by a space.
    if (/^(?:https?:\/\/)?t\.co\//i.test(l)) return ' ';
    return ` ${/^https?:\/\/t\.co\//.test(href) && !/^https?:/.test(l) ? `https://${l.replace(/…$/, '')}` : l} `;
  }).replace(/<[^>]+>/g, '')).replace(/\s*https?:\/\/t\.co\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
  const handle = (String(o.author_url || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i) || [])[1] || '';
  const date = (o.html.match(/<a\b[^>]*\/status\/\d+[^>]*>([^<]{4,40})<\/a>\s*<\/blockquote>/i) || [])[1] || '';
  return { text: sanitizeMultiline(text, 4000), creator: handle, name: sanitizeText(decodeEntities(o.author_name || ''), 80), postedAt: sanitizeText(date, 40) };
}

const iso = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };

// A post's title: its first line that says something, short, with no links or trailing hashtags.
export function xTitle(text, creator = '', type = 'post') {
  const lines = String(text || '').slice(0, 2000).split(/\r?\n/)
    .map((l) => sanitizeText(l.replace(URL_RE, ''), 600).replace(/^(?:[#@][\w.]+[\s,]*)+/u, '').replace(/^[\s\p{Extended_Pictographic}\p{P}\uFE0F\u200D]+/u, '').trim());
  const c = lines.find((l) => l.replace(/[#@\s\p{P}]/gu, '').length >= 4) || '';
  const first = c.split(/(?<=[.!?…])\s+|\s+[|•·]\s+|\s+-\s+/)[0] || '';
  let t = first.replace(/^[\s"“”'‘’«»]+|[\s"“”'‘’«»]+$/g, '').replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '').replace(/[\s\p{Extended_Pictographic}\uFE0F\u200D:.]+$/u, '').trim();
  if (t.length > 80) t = t.slice(0, 79).replace(/\s+\S*$/, '') + '…';
  if (t.replace(/[#@\s\p{P}]/gu, '').length >= 4) return t;
  const what = type === 'video' ? 'Video' : 'Post';
  return creator ? `${what} by @${creator} on X` : `${what} on X`;
}

// Everything worth keeping from a shared post. `bundle` is { tweet, oembed } (either may be missing):
// the two answers of xPostRequests, parsed as JSON. ok is false when neither said anything.
export function parseXPost(bundle, url) {
  const b = bundle || {};
  const id = xStatusId(url);
  const t = b.tweet && typeof b.tweet === 'object' && b.tweet.__typename !== 'TweetTombstone' && (b.tweet.text || b.tweet.id_str) ? b.tweet : null;
  const o = fromOembed(b.oembed);
  let text = '';
  let creator = xHandleFromUrl(url);
  let name = '';
  let postedAt = '';
  let links = [];
  let media = { images: [], video: null, cardImage: '' };
  let quoted = null;
  let parent = null;
  if (t) {
    text = textOf(t);
    const who = userOf(t);
    creator = who.creator || creator;
    name = who.name;
    postedAt = iso(t.created_at);
    links = linksOf(t);
    media = mediaOf(t);
    const q = t.quoted_tweet;
    if (q && (q.text || q.full_text)) quoted = { text: textOf(q), ...userOf(q), images: mediaOf(q).images.slice(0, 4) };
    // The post it answers: in a thread, the author's earlier post.
    const p = t.parent;
    if (p && (p.text || p.full_text)) parent = { text: textOf(p), ...userOf(p) };
    for (const l of q ? linksOf(q) : []) if (!links.some((x) => x.url === l.url)) links.push(l);
  } else if (o) {
    ({ text, name, postedAt } = o);
    creator = o.creator || creator;
    for (const m of text.matchAll(URL_RE)) {
      const u = sanitizeUrl(m[0]);
      let host = '';
      try { host = new URL(u).hostname; } catch { /* not a link */ }
      if (u && host && !isXHost(host) && !/(^|\.)t\.co$/.test(host) && !links.some((l) => l.url === u)) links.push({ url: u, label: u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80) });
    }
  }
  // A thread: the author answering their own post (or X saying the post starts one).
  const thread = !!(t && (t.self_thread?.id_str || (parent && parent.creator && parent.creator.toLowerCase() === creator.toLowerCase())));
  const type = media.video && !media.video.gif ? 'video' : media.images.length ? 'photo' : 'post';
  // What the post says, as one caption for the rest of the app: the post, then the post it quotes, and in
  // a thread the post before it. Each part is labelled so the AI knows whose words are whose.
  const parts = [text];
  if (quoted?.text) parts.push(`Quoting @${quoted.creator || 'someone'}: ${quoted.text}`);
  if (parent?.text) parts.push(thread ? `Earlier in the thread: ${parent.text}` : `Replying to @${parent.creator || 'someone'}: ${parent.text}`);
  const caption = sanitizeMultiline(parts.filter(Boolean).join('\n\n'), 4000);
  const hashtags = [...new Set([...caption.matchAll(HASHTAG_RE)].map((x) => x[1].toLowerCase()))].slice(0, 30);
  const ok = !!(text || quoted?.text || media.images.length);
  return {
    id, ok,
    url: id ? `https://x.com/${creator || 'i'}/status/${id}` : '',
    text, caption, creator, name, postedAt, hashtags, links,
    image: media.images[0] || media.cardImage || '',
    images: media.images.length ? media.images : media.cardImage ? [media.cardImage] : [],
    video: media.video,
    quoted, parent, thread, type,
    title: xTitle(text || quoted?.text || '', creator, type),
    source: t ? 'embed-data' : o ? 'oembed' : '',
  };
}

// What a capture keeps from a parsed post (capture.js normalizeProduct): the same record an Instagram
// post keeps (item.instagram: caption, creator, date, hashtags, links), so search, sorting, places and
// the AI read it the same way, with postType saying it came from X.
export function xPostRecord(post) {
  return {
    caption: post.caption,
    creator: post.creator,
    postedAt: post.postedAt,
    hashtags: post.hashtags,
    links: post.links,
    postType: post.thread ? 'x-thread' : post.type === 'video' ? 'x-video' : 'x-post',
    originalImage: post.image || '',
  };
}
