// URL normalization used only to produce a comparison key for duplicate
// detection. The original URL is always stored untouched.

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'srsltid', 'ref', 'ref_', 'refid', 'referrer', 'affid', 'aff', 'tag',
  'cmpid', 'cid', 'sscid', 'irclickid', 'irgwc', 'spm', 'scm', 'pf_rd_p', 'pf_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pd_rd_r',
  'psc', 'th', 'qid', 'sr', 'keywords', 's', 'sprefix', 'crid', 'linkcode', 'linkid', 'camp', 'creative', 'ascsubtag',
  'share', 'si', 'feature', 'source', 'campaign', 'trk', 'trkid', 'epik', 'ncid', 'ocid', 'oly_enc_id', 'oly_anon_id',
  'vero_id', 'wickedid', 'yhsclid', 'zanpid',
]);

// v, fbid, story_fbid: Facebook names a video, photo or post by a long number in the query.
const PARAMS_THAT_IDENTIFY_PRODUCTS = new Set(['variant', 'sku', 'productid', 'product_id', 'pid', 'id', 'p', 'itemid', 'item', 'asin', 'color', 'size', 'v', 'fbid', 'story_fbid']);

export function normalizeUrl(input) {
  if (!input) return '';
  let u;
  try {
    u = new URL(String(input));
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  let host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let path = u.pathname.replace(/\/+$/, '') || '/';
  let search = '';

  // Amazon: /gp/product/ASIN, /Some-Title/dp/ASIN -> /dp/ASIN
  const asin = path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  if (/(^|\.)amazon\./.test(host) && asin) {
    path = `/dp/${asin[1].toUpperCase()}`;
    return `${host}${path}`;
  }
  // Etsy: /listing/ID/slug -> /listing/ID
  const etsy = path.match(/^\/listing\/(\d+)/);
  if (/(^|\.)etsy\.com$/.test(host) && etsy) return `${host}/listing/${etsy[1]}`;
  // eBay: /itm/slug/ID or /itm/ID -> /itm/ID
  const ebay = path.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
  if (/(^|\.)ebay\./.test(host) && ebay) return `${host}/itm/${ebay[1]}`;
  // Instagram posts and reels: keep the shortcode only
  const ig = path.match(/^\/(?:[^/]+\/)?(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (/(^|\.)instagram\.com$/.test(host) && ig) return `instagram.com/${ig[1] === 'reels' ? 'reel' : ig[1]}/${ig[2]}`;
  // Posts on X: the post's id only (x.com and twitter.com, any handle or /i/, ?s=46&t=… are the same post).
  const xs = path.match(/^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})(?:\/|$)/);
  if (/^(?:mobile\.)?(?:x|twitter)\.com$/.test(host) && xs) return `x.com/status/${xs[1]}`;

  // YouTube: watch?v=, youtu.be/, /shorts/, /live/, /embed/ are the same video.
  if (/^(?:youtube\.com|music\.youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(host)) {
    const yt = host === 'youtu.be' ? (u.pathname.match(/^\/([\w-]{11})/) || [])[1] : (u.searchParams.get('v') || '').match(/^[\w-]{11}$/)?.[0] || (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/) || [])[1];
    if (yt) return `youtube.com/watch?v=${yt}`;
  }
  // TikTok: the video or photo post's id, whatever the handle in front of it.
  const tt = u.pathname.match(/^\/@[^/]+\/(?:video|photo)\/(\d{8,25})/) || u.pathname.match(/^\/v\/(\d{8,25})/);
  if (/(^|\.)tiktok\.com$/.test(host) && tt) return `tiktok.com/video/${tt[1]}`;
  // Reddit: the post's id (any subreddit path, title slug, old./new. host, or redd.it).
  const rd = u.pathname.match(/\/comments\/([a-z0-9]{4,12})(?:\/|$)/i);
  if (/(^|\.)reddit\.com$/.test(host) && rd) return `reddit.com/comments/${rd[1].toLowerCase()}`;
  if (host === 'redd.it' && /^\/[a-z0-9]{4,12}\/?$/i.test(u.pathname)) return `reddit.com/comments/${u.pathname.replace(/\//g, '').toLowerCase()}`;
  // Pinterest: the pin's id (any country's site).
  const pin = u.pathname.match(/^\/pin\/(?:[^/]*?--)?(\d{6,25})/);
  if (/(^|\.)pinterest\.[a-z.]{2,8}$/.test(host) && pin) return `pinterest.com/pin/${pin[1]}`;
  // Google Maps: a place shared by its id (?cid=…). cid is a campaign id everywhere else.
  const cid = u.searchParams.get('cid') || '';
  if (/(^|\.)google\.[a-z.]{2,6}$/.test(host) && /^\d+$/.test(cid)) return `google.com/maps?cid=${cid}`;

  const params = [];
  for (const [key, value] of u.searchParams.entries()) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || k.startsWith('utm_') || k.startsWith('mkt_') || k.startsWith('pk_')) continue;
    if (PARAMS_THAT_IDENTIFY_PRODUCTS.has(k)) params.push([k, value]);
    else if (params.length < 8 && value.length < 80 && !/^(\d{10,}|[a-f0-9]{24,})$/i.test(value)) params.push([k, value]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (params.length) search = '?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${host}${path.toLowerCase()}${search}`;
}

// Strip tracking params but keep everything else, for a tidy "canonical" URL to
// display and open. Falls back to the input if parsing fails.
export function cleanUrl(input) {
  try {
    const u = new URL(String(input));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k) || k.startsWith('utm_')) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.href;
  } catch {
    return '';
  }
}

// The link to actually open for a saved URL. A logged-in Instagram session
// reroutes /reel/<code>/ into its reels feed viewer, which lands on other
// reels; /p/<code>/ serves the same post without that redirect. The stored
// URL is left alone (it's the duplicate-detection key); use this for display
// and for anything the user clicks.
export function openableUrl(input) {
  try {
    const u = new URL(String(input));
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return input;
    const m = u.pathname.match(/^\/(?:[^/]+\/)?(?:reel|reels)\/([A-Za-z0-9_-]{5,})/);
    return m ? `https://www.instagram.com/p/${m[1]}/` : input;
  } catch {
    return input;
  }
}

export function isRestrictedUrl(url) {
  if (!url) return true;
  return !/^https?:\/\//i.test(url) || /^https?:\/\/chrome\.google\.com\/webstore/i.test(url) || /^https?:\/\/chromewebstore\.google\.com/i.test(url);
}

export function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `*://${u.hostname}/*`;
  } catch {
    return '';
  }
}

export function hostFromPattern(pattern) {
  const m = String(pattern).match(/^\*?:?\/\/(?:\*\.)?([^/]+)\/\*$/) || String(pattern).match(/^(?:https?|\*):\/\/([^/]+)\//);
  return m ? m[1] : String(pattern);
}
