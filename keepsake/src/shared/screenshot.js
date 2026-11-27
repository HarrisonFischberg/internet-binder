// A screenshot shared to Internet Binder: what its text says the picture is. The phone reads the text on
// the device (Vision, ios ImageCapture.swift) and hands over each line with where it sits and how tall it
// is; this file works out the rest, with no network and no AI: which lines are the phone's and the app's
// own furniture (the clock, "Liked by…", the tab bar), what the save should be called (the biggest text on
// a page, the caption's first line on a post), who posted it, which shop's page it is, and its price when
// it is something to buy. capture.js then sorts it like any other save, so a screenshot of a recipe post
// lands in Recipes and one of a product page in its collection, instead of every screenshot being a
// "link" named after the clock.
//
// Pure and shared (Chrome's tests run it); nothing here knows about UIKit.

import { sanitizeText, sanitizeMultiline, prettyRetailer } from './util.js';

const HASHTAG_RE = /#([\p{L}\p{N}_]{2,60})/gu;
const HANDLE = /^@?[a-z0-9](?:[a-z0-9._]{1,28})[a-z0-9_]$/;
// A web address on its own line (Safari's address bar, a shop's header): "nike.com", "www.rei.com/product".
const DOMAIN_LINE = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,24})(?:\/\S*)?$/i;

// The phone's status bar: the clock, signal and battery.
const STATUS = /^(?:\d{1,2}[:.]\d{2}(?:\s?[ap]m)?|\d{1,3}\s?%|[45]g|lte|5g\s?uc|5ge|wi-?fi|sos|sos only|no service|[•.·]{2,}|\d{1,3})$/i;
// Buttons and counters the apps draw around a post or a page: never what the save is about.
const FURNITURE = new RegExp(`^(?:${[
  'follow', 'following', 'follow back', 'message', 'share', 'send', 'save', 'saved', 'like', 'liked', 'reply', 'replies', 'comment', 'comments', 'repost', 'reposted', 'quote',
  'home', 'search', 'explore', 'reels', 'shop', 'profile', 'inbox', 'friends', 'for you', 'activity', 'notifications', 'messages', 'create', 'menu', 'back', 'done', 'cancel', 'close', 'edit', 'more', 'see more', 'show more', 'read more', '\\.{2,}\\s*more',
  'sponsored', 'suggested for you', 'suggested posts?', 'see translation', 'translate', 'view insights', 'boost post', 'original audio', 'paid partnership.*',
  'liked by .*', 'view (?:all )?[\\d,.]+[km]? comments?', 'view (?:all )?replies.*', 'view \\d+ more repl(?:y|ies)', 'add a comment.*', '[\\d,.]+[km]? (?:likes?|views?|comments?|shares?|reposts?|quotes?|bookmarks?|plays?|followers?|following|posts?)',
  '\\d+\\s?(?:s|m|h|d|w|mo|y|min|mins|hr|hrs|hours?|days?|weeks?)(?: ago)?', '(?:just now|yesterday|today)', '(?:january|february|march|april|may|june|july|august|september|october|november|december) \\d{1,2}(?:, \\d{4})?',
  'add to (?:cart|bag|basket|wish ?list|list)', 'buy now', 'shop now', 'learn more', 'sign up', 'log ?in', 'sign in', 'install', 'open', 'get', 'view (?:cart|bag)', 'checkout', 'select (?:a )?size', 'size guide', 'qty:?\\s?\\d*', 'quantity',
  'aa', '[<>‹›←→×✕+…]+', '[\\d,.]+[km]?',
].join('|')})$`, 'i');
// Signs of an Instagram (or similar) post around the text.
const POST_SIGNS = /^(?:liked by .*|view (?:all )?[\d,.]+[km]? comments?|add a comment.*|[\d,.]+[km]? likes?|suggested for you|original audio|see translation|paid partnership.*)$/i;
// Signs of a shop's product page.
const SHOP_SIGNS = /\b(?:add to (?:cart|bag|basket)|buy now|in stock|out of stock|sold out|free (?:shipping|delivery|returns)|select (?:a )?size|size guide|ships? (?:in|by|free)|check ?out|qty|\d+ reviews?|write a review|add to wish ?list)\b/i;
// "$139.99", "$1,299", "£45": a whole amount (never the first digits of a longer one).
const PRICE = /[$£€]\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?(?![\d,.]*\d)/;
// A line whose amount is about delivery or a discount, not what the thing costs.
const NOT_THE_PRICE = /\b(?:shipping|delivery|orders? (?:over|above)|spend|save|off|was|reg(?:ular)?\.?|compare at|msrp|per month|\/mo|points|rewards)\b/i;

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// Lines as the phone read them: { text, x, y, w, h } with x/y/w/h as fractions of the picture, y measured
// from the top. Older callers send plain strings: then nothing is known about where a line sits.
function linesOf(ocr) {
  const raw = Array.isArray(ocr?.lines) ? ocr.lines : [];
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : null);
  return raw.slice(0, 400)
    .map((l) => (typeof l === 'string' ? { text: clean(l), x: null, y: null, w: null, h: null } : l && typeof l === 'object' ? { text: clean(l.text), x: num(l.x), y: num(l.y), w: num(l.w), h: num(l.h) } : null))
    .filter((l) => l && l.text)
    // "thatchef • Follow", "@coach.kim · 2h": each part is its own piece of the header.
    .flatMap((l) => l.text.split(/\s+[•·]\s+/).map((t) => ({ ...l, text: clean(t) })).filter((x) => x.text))
    .sort((a, b) => (a.y === null || b.y === null ? 0 : a.y - b.y));
}

// What the text of a screenshot says it is. Returns the fields a capture takes (title, description, …);
// `text` false when nothing readable was in the picture.
export function screenshotFacts(ocr) {
  const all = linesOf(ocr);
  const placed = all.some((l) => l.y !== null);
  const isStatus = (l) => (placed ? l.y !== null && l.y < 0.07 && (STATUS.test(l.text) || l.text.length <= 6) : STATUS.test(l.text) && all.indexOf(l) < 3);
  const post = all.some((l) => POST_SIGNS.test(l.text));
  const shopSign = all.some((l) => SHOP_SIGNS.test(l.text));

  // The page's own address, when the browser's bar is in the picture (top or bottom edge).
  let host = '';
  for (const l of all) {
    const m = l.text.replace(/^[\u{1F512}\u{1F513}🔒\s]+/u, '').match(DOMAIN_LINE);
    if (m && (!placed || l.y < 0.14 || l.y > 0.84)) { host = m[1].toLowerCase().replace(/^www\./, ''); break; }
  }

  // Who posted it: an @handle anywhere, or (on a post) the account's name above the picture.
  let creator = '';
  // (A line that is only the handle. "@sam can you review this?" in a message is a mention, not who posted it.)
  const tagged = all.map((l) => l.text.match(/^@([a-z0-9._]{2,30})$/i)).find(Boolean);
  if (tagged) creator = tagged[1].toLowerCase();
  if (!creator && post) {
    const head = all.find((l) => !isStatus(l) && HANDLE.test(l.text) && /[._\d]|^[a-z]{5,}$/.test(l.text) && !FURNITURE.test(l.text) && (!placed || l.y < 0.3));
    if (head) creator = head.text.replace(/^@/, '').toLowerCase();
  }

  const content = all.filter((l) => !isStatus(l) && !FURNITURE.test(l.text) && !DOMAIN_LINE.test(l.text) && !(creator && l.text.replace(/^@/, '').toLowerCase() === creator)
    // The bottom edge is the tab bar or the home indicator's neighbours: short labels there are furniture.
    && !(placed && l.y > 0.93 && l.text.length <= 14));
  // A caption starts with the account's name ("thatchef Slow braised short ribs…"): the name isn't the caption.
  const strip = (t) => (creator && t.toLowerCase().startsWith(`${creator} `) ? t.slice(creator.length + 1).trim() : t);
  // On a post the caption starts at the line that opens with the account's name, or else under the likes:
  // what sits above it (a location tag, the music credit) is the header, not the caption.
  let from = 0;
  if (post) {
    const opens = creator ? content.findIndex((l) => l.text.toLowerCase().startsWith(`${creator} `)) : -1;
    const likes = all.find((l) => /^(?:liked by .*|[\d,.]+[km]? likes?)$/i.test(l.text));
    const under = likes && likes.y !== null ? content.findIndex((l) => l.y !== null && l.y > likes.y) : -1;
    from = opens >= 0 ? opens : under >= 0 ? under : 0;
  }
  const texts = content.slice(from).map((l) => ({ ...l, text: strip(l.text) })).filter((l) => l.text);
  const body = texts.map((l) => l.text).join('\n');
  if (!texts.length) return { text: false, title: '', description: '' };

  // A price counts only on a shop's page (its own buttons show: Add to Bag, In stock…), never on a post, a
  // menu or an article that mentions money. The biggest one that isn't about delivery or a discount.
  let priced = null;
  if (!post && shopSign) {
    const prices = texts.filter((l) => PRICE.test(l.text) && !NOT_THE_PRICE.test(l.text));
    const best = prices.reduce((b, l) => (!b || (l.h !== null && b.h !== null && l.h > b.h * 1.08) ? l : b), null);
    priced = best ? best.text.match(PRICE) : null;
  }

  // The name: on a post, the caption's first line. Elsewhere the biggest text, with the lines it wraps onto.
  let title = texts[0].text;
  if (!post && texts.some((l) => l.h !== null)) {
    const named = texts.filter((l) => l.h !== null && l.text.length >= 3 && /\p{L}{2}/u.test(l.text) && !PRICE.test(l.text));
    const top = named.reduce((best, l) => (!best || l.h > best.h * 1.08 ? l : best), null);
    if (top) {
      const at = texts.indexOf(top);
      const parts = [top.text];
      for (let i = at + 1; i < texts.length && parts.length < 3; i++) {
        const l = texts[i];
        if (l.h === null || Math.abs(l.h - top.h) > top.h * 0.2 || PRICE.test(l.text)) break;
        parts.push(l.text);
      }
      title = parts.join(' ');
    }
  }
  const hashtags = [...new Set([...body.matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase()))].slice(0, 30);
  const out = {
    text: true,
    title: sanitizeText(title, 120),
    description: sanitizeMultiline(body, 2200),
    hashtags,
    isScreenshot: true,
  };
  if (post || creator) {
    out.instagram = { caption: out.description, creator, hashtags, postType: 'screenshot', links: [], products: [] };
  }
  if (host && !post) {
    out.retailerHost = host;
    out.retailer = prettyRetailer(host) || host;
  }
  if (priced) {
    out.priceText = priced[0];
    out.kind = 'product';
  }
  return out;
}
