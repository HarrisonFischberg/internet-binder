// Patchwork page extraction. Injected on demand (toolbar click / context menu)
// into the active tab and returns a plain object describing the product on the
// page. Runs in the isolated world; never sends anything anywhere itself.
//
// Fallback order:
//   1. Schema.org JSON-LD Product
//   2. Open Graph metadata
//   3. Twitter card metadata
//   4. Common product price meta tags
//   5. Prominent headings, images and visible price patterns
//   6. document.title + location.href
//
// Every technique is wrapped so one failure never breaks the result.

(function keepsakeExtractModule() {
  const PRICE_RE = /(?:(?:US|CA|AU|NZ|HK|S|R|MX)?\$|€|£|¥|₹|₩|₺|₽|₪|฿|\b(?:USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|JPY|INR)\b)\s?\d{1,3}(?:[ .,\u202f]?\d{3})*(?:[.,]\d{1,2})?|\d{1,3}(?:[ .,\u202f]?\d{3})*(?:[.,]\d{1,2})?\s?(?:€|£|zł|kr|CHF|USD|EUR|GBP)\b/;
  const BAD_IMG_RE = /(logo|sprite|icon|favicon|avatar|pixel|badge|spinner|loading|placeholder|blank\.|1x1|tracking|banner-ad|\/ads?\/|flag|payment|visa|mastercard|paypal|star|rating)/i;
  const BAD_CONTAINER = 'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], [class*="logo"], [id*="logo"], [class*="cookie"], [class*="newsletter"], [class*="footer"], [class*="header"]:not([class*="product"]), iframe';

  const safe = (fn, fallback = null) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
  const abs = (u) => {
    if (!u || typeof u !== 'string') return '';
    try {
      const url = new URL(u.trim(), location.href);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };
  // Sites that change pages without reloading (YouTube and other apps) can leave the <head> describing
  // the page you came from. When it does (see staleHead), its tags and structured data are not read,
  // except the site's own name, which is the same on every page.
  let STALE = false;
  const rawMeta = (selector) => safe(() => text(document.querySelector(selector)?.getAttribute('content')), '');
  const meta = (selector) => (STALE && !/site_name|og:type|application-name/.test(selector) ? '' : rawMeta(selector));
  const metaAll = (selector) => (STALE ? [] : safe(() => Array.from(document.querySelectorAll(selector)).map((m) => text(m.getAttribute('content'))).filter(Boolean), []));

  // The head's tags belong to another page: og:url names a different page than the one open, and the
  // tab's title no longer contains og:title (or they're the home page's tags on an inner page).
  function staleHead() {
    const ogUrl = rawMeta('meta[property="og:url"]');
    if (!ogUrl) return false;
    const o = new URL(ogUrl, location.href);
    const here = new URL(location.href);
    // An Instagram post is the same page at /p/<code>/, /reel/<code>/ and /<user>/reel/<code>/.
    const igPost = (u) => (/(^|\.)instagram\.com$/.test(u.hostname) ? (u.pathname.match(/^\/(?:[^/]+\/)?(?:p|reels?|tv)\/([\w-]{5,})/) || [])[1] : '');
    const id = (u) => (igPost(u) ? `instagram.com/post/${igPost(u)}` : `${u.hostname.replace(/^www\.|^m\./, '')}${u.pathname.replace(/\/+$/, '')}${u.searchParams.get('v') ? `?v=${u.searchParams.get('v')}` : ''}`);
    if (id(o) === id(here)) return false;
    if (!o.pathname.replace(/\/+$/, '') && here.pathname.replace(/\/+$/, '')) return true;
    const t = rawMeta('meta[property="og:title"]').toLowerCase().slice(0, 30);
    return !!t && !String(document.title || '').toLowerCase().includes(t);
  }

  // A YouTube watch page, read from what's on screen (its head and microdata can be a previous video's).
  function youtubeWatch() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
    const here = new URL(location.href);
    const vid = here.searchParams.get('v') || (here.pathname.match(/^\/(?:shorts|live)\/([\w-]{6,})/) || [])[1];
    if (!vid || !/^[\w-]{6,20}$/.test(vid)) return null;
    const q = (sel) => safe(() => text(document.querySelector(sel)?.textContent), '');
    const player = document.querySelector('.html5-video-player');
    const ad = !!player && player.classList.contains('ad-showing');
    return {
      title: q('ytd-watch-metadata h1') || q('h1.title') || text(String(document.title || '').replace(/\s*-\s*YouTube\s*$/, '')),
      channel: q('ytd-watch-metadata ytd-channel-name a') || q('#owner #channel-name a') || q('ytd-video-owner-renderer #channel-name'),
      // The player's own clock, unless an ad is playing (then it's the ad's length).
      duration: ad ? '' : q('.ytp-time-duration'),
      // YouTube's own thumbnail address for this video id.
      image: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      description: q('ytd-watch-metadata #description-inline-expander yt-attributed-string') || q('#description-inline-expander') || '',
    };
  }

  // ---- 1. JSON-LD ------------------------------------------------------------
  function readJsonLd() {
    const out = { product: null, breadcrumbs: [], recipe: null, place: null, video: null, article: null, screen: null, book: null, types: [] };
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 25);
    const nodes = [];
    for (const s of scripts) {
      const raw = s.textContent || '';
      if (!raw.trim() || raw.length > 400000) continue;
      // Some sites wrap it for old browsers: /* <![CDATA[ */ {…} /* ]]> */
      const unwrapped = raw.replace(/^\s*(?:\/\*\s*)?<!\[CDATA\[\s*(?:\*\/)?/, '').replace(/(?:\/\*\s*)?\]\]>\s*(?:\*\/)?\s*$/, '');
      let parsed = safe(() => JSON.parse(unwrapped));
      if (parsed === null) parsed = safe(() => JSON.parse(unwrapped.replace(/[\u0000-\u001f]+/g, ' ')));
      if (parsed === null) continue;
      collect(parsed, nodes, 0);
    }
    const types = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).map((t) => String(t || '').toLowerCase());
    const products = nodes.filter((n) => types(n).some((t) => t === 'product' || t === 'productgroup' || t === 'individualproduct' || t === 'productmodel'));
    if (products.length) {
      // Prefer the product matching the current URL, otherwise the richest one.
      const here = location.href.split('#')[0];
      const scored = products.map((p) => ({ p, s: (p.url && here.startsWith(String(p.url).split('#')[0]) ? 10 : 0) + (p.offers ? 2 : 0) + (p.image ? 1 : 0) + (p.name ? 1 : 0) }));
      scored.sort((a, b) => b.s - a.s);
      out.product = scored[0].p;
    }
    // Everything the page says it is (Recipe, Article, Restaurant, VideoObject…), for its kind.
    out.types = [...new Set(nodes.flatMap(types))].filter(Boolean).slice(0, 30);
    out.recipe = nodes.find((n) => types(n).includes('recipe')) || null;
    // A restaurant, café, museum… with an address or a pin. The richest one wins.
    const PLACE = /^(?:restaurant|foodestablishment|cafeorcoffeeshop|bakery|barorpub|winery|brewery|fastfoodrestaurant|icecreamshop|localbusiness|touristattraction|touristdestination|museum|park|lodgingbusiness|hotel|landmarksorhistoricalbuildings|place|nightclub|entertainmentbusiness|sportsactivitylocation|healthandbeautybusiness|hairsalon|beautysalon|nailsalon|dayspa|healthclub|exercisegym|store|clothingstore|sportinggoodsstore|bikestore|bookstore|shoestore|shoppingcenter|movietheater|zoo|aquarium|amusementpark|artgallery)$/;
    const places = nodes.filter((n) => types(n).some((t) => PLACE.test(t)) && (n.address || n.geo));
    places.sort((a, b) => (b.geo ? 2 : 0) + (b.openingHoursSpecification || b.openingHours ? 1 : 0) - ((a.geo ? 2 : 0) + (a.openingHoursSpecification || a.openingHours ? 1 : 0)));
    out.place = places[0] || null;
    // The business behind the site (its name, phone, what it says it is), for a home page with no address.
    const ORG = /^(?:organization|corporation|localbusiness|onlinestore|website)$/;
    out.org = nodes.filter((n) => n.name && types(n).some((t) => ORG.test(t))).sort((a, b) => (types(a).includes('website') ? 1 : 0) - (types(b).includes('website') ? 1 : 0))[0] || null;
    out.video = nodes.find((n) => types(n).includes('videoobject')) || null;
    out.screen = nodes.find((n) => types(n).some((t) => t === 'movie' || t === 'tvseries')) || null;
    out.book = nodes.find((n) => types(n).includes('book')) || null;
    out.article = nodes.find((n) => types(n).some((t) => /^(?:article|newsarticle|blogposting|reportagenewsarticle|techarticle|analysisnewsarticle|opinionnewsarticle|reviewnewsarticle|scholarlyarticle)$/.test(t))) || null;
    const crumbs = nodes.find((n) => types(n).includes('breadcrumblist'));
    if (crumbs && Array.isArray(crumbs.itemListElement)) {
      out.breadcrumbs = crumbs.itemListElement
        .map((e) => text(e?.name || e?.item?.name || (typeof e?.item === 'string' ? '' : e?.item?.['@id'] ? '' : '')))
        .filter(Boolean)
        .slice(0, 8);
    }
    return out;

    function collect(node, acc, depth) {
      if (!node || depth > 6 || acc.length > 200) return;
      if (Array.isArray(node)) return node.forEach((n) => collect(n, acc, depth + 1));
      if (typeof node !== 'object') return;
      if (node['@type']) acc.push(node);
      if (node['@graph']) collect(node['@graph'], acc, depth + 1);
      for (const key of ['mainEntity', 'mainEntityOfPage', 'hasVariant', 'itemListElement', 'offers', 'item']) if (node[key]) collect(node[key], acc, depth + 1);
    }
  }

  // schema.org Recipe written as microdata (itemprop attributes) instead of JSON-LD.
  function readMicrodataRecipe() {
    const root = document.querySelector('[itemtype*="schema.org/Recipe" i]');
    if (!root) return null;
    const all = (prop) => Array.from(root.querySelectorAll(`[itemprop="${prop}"]`));
    const val = (el) => (el ? text(el.getAttribute('content') || el.textContent) : '');
    const steps = all('recipeInstructions').flatMap((el) => {
      const inner = Array.from(el.querySelectorAll('li, [itemprop="text"], p'));
      return inner.length ? inner.map(val) : [val(el)];
    }).filter(Boolean);
    const img = root.querySelector('[itemprop="image"]');
    return {
      __microdata: true,
      name: val(root.querySelector('[itemprop="name"]')),
      description: val(root.querySelector('[itemprop="description"]')),
      image: img ? img.getAttribute('src') || img.getAttribute('content') || '' : '',
      recipeIngredient: [...all('recipeIngredient'), ...all('ingredients')].map(val).filter(Boolean),
      recipeInstructions: steps,
      recipeYield: val(root.querySelector('[itemprop="recipeYield"]')),
      totalTime: (root.querySelector('[itemprop="totalTime"]') || {}).getAttribute?.('content') || '',
      prepTime: (root.querySelector('[itemprop="prepTime"]') || {}).getAttribute?.('content') || '',
      cookTime: (root.querySelector('[itemprop="cookTime"]') || {}).getAttribute?.('content') || '',
    };
  }

  function offerFrom(product) {
    if (!product) return {};
    let offers = product.offers;
    if (Array.isArray(offers)) offers = offers.find((o) => o && (o.price || o.lowPrice || o.priceSpecification)) || offers[0];
    if (!offers || typeof offers !== 'object') return {};
    const spec = Array.isArray(offers.priceSpecification) ? offers.priceSpecification[0] : offers.priceSpecification;
    const price = offers.price ?? offers.lowPrice ?? spec?.price ?? spec?.minPrice ?? null;
    const currency = offers.priceCurrency || spec?.priceCurrency || '';
    const availability = text(offers.availability || '').replace(/.*\//, '');
    return { price, currency: text(currency), availability };
  }

  function imagesFrom(value, acc) {
    if (!value) return;
    if (typeof value === 'string') acc.push(abs(value));
    else if (Array.isArray(value)) value.forEach((v) => imagesFrom(v, acc));
    else if (typeof value === 'object') imagesFrom(value.url || value.contentUrl || value['@id'], acc);
  }

  // ---- Store's own product type and tags ---------------------------------------
  // Shopify pages embed the product as JSON ("vendor":"…","type":"Hoodie","tags":[…]);
  // WooCommerce puts product_cat-<slug> / product_tag-<slug> classes on the product.
  // These say what the store thinks the item is, so they are strong category clues.
  const GENERIC_TYPES = /^(product|products|default|simple|variable|grouped|external|variant|item|general|misc|other|all|none|n\/a)$/i;
  function cleanTags(list) {
    const out = [];
    for (const raw of list) {
      const t = text(raw).replace(/[-_]+/g, ' ');
      // Skip merchandising and filter tags: "sale", "new", "size:M", "YGroup_x", ids.
      if (!t || t.length > 30 || /[:=\d]/.test(t) || /^(sale|new|new ?arrivals?|bestsellers?|best sellers?|featured|clearance|gift card|exclusive|limited|online only|hidden|default)$/i.test(t)) continue;
      if (/\b(feed|feeds|bundle|bundles|guide|module|slider|eligible|bfcm|black friday|cyber monday|aftership|storelocator|include|exclude|badge|promo|discount|filter|template|hide|hidden|campaign)\b/i.test(t)) continue;
      if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
      if (out.length >= 12) break;
    }
    return out;
  }
  function readStoreTaxonomy() {
    const out = { productType: '', tags: [] };
    const isShopify = !!document.querySelector('meta[name="shopify-digital-wallet"], meta[name="shopify-checkout-api-token"], script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"], script[src*="/cdn/shop/"], link[href*="/cdn/shop/"]');
    if (isShopify) {
      const unq = (v) => safe(() => JSON.parse(`"${v}"`), v);
      const scripts = Array.from(document.querySelectorAll('script:not([src])')).slice(0, 120);
      for (const s of scripts) {
        const raw = s.textContent || '';
        if (raw.length > 800000 || !raw.includes('"vendor"')) continue;
        const m = raw.match(/"vendor":"(?:[^"\\]|\\.)*","type":"((?:[^"\\]|\\.){1,80})"(?:,"tags":\[((?:"(?:[^"\\]|\\.)*",?){0,60})\])?/);
        if (!m) continue;
        const type = text(unq(m[1]));
        if (!out.productType && type && !GENERIC_TYPES.test(type)) out.productType = type;
        if (!out.tags.length && m[2]) out.tags = cleanTags([...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => unq(x[1])));
        if (out.productType && out.tags.length) break;
      }
    }
    if (!out.productType) {
      const woo = document.querySelector('.type-product[class*="product_cat-"]');
      if (woo) {
        const slugs = (prefix) => Array.from(woo.classList).filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
        const cats = slugs('product_cat-').filter((c) => c !== 'uncategorized').map((c) => c.replace(/-/g, ' '));
        out.productType = cats.slice(0, 3).join(', ');
        if (!out.tags.length) out.tags = cleanTags(slugs('product_tag-'));
      }
    }
    return out;
  }

  // ---- 5. Visible page heuristics ----------------------------------------------
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function imageCandidates(limit = 12) {
    const imgs = Array.from(document.images || []);
    const scored = [];
    const seen = new Set();
    const vh = window.innerHeight || 800;
    const titleWords = tokenizeTitle(pageTitle());
    for (const img of imgs) {
      const src = bestSrc(img);
      if (!src || seen.has(src) || BAD_IMG_RE.test(src) || /\.(svg|gif)(\?|$)/i.test(src)) continue;
      if (img.closest(BAD_CONTAINER)) continue;
      const rect = img.getBoundingClientRect();
      const w = rect.width || img.naturalWidth || Number(img.getAttribute('width')) || 0;
      const h = rect.height || img.naturalHeight || Number(img.getAttribute('height')) || 0;
      if (w < 150 || h < 150) continue;
      if (rect.width && !isVisible(img)) continue;
      const alt = text(img.getAttribute('alt'));
      if (/logo|icon|avatar/i.test(alt)) continue;
      let score = Math.min(w * h, 1_200_000) / 1000;
      if (rect.top >= 0 && rect.top < vh) score *= 1.5; // in the initial viewport
      if (img.closest('[class*="gallery"], [class*="product-image"], [class*="productimage"], [class*="pdp"], [data-testid*="image"], [class*="carousel"], [class*="slider"], [class*="media"], picture, main')) score *= 1.3;
      if (alt && titleWords.some((wd) => alt.toLowerCase().includes(wd))) score *= 1.4;
      seen.add(src);
      scored.push({ src, score, alt, w: img.naturalWidth || w, h: img.naturalHeight || h });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  function bestSrc(img) {
    const srcset = img.currentSrc || '';
    if (srcset && !srcset.startsWith('data:')) return abs(srcset);
    const set = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (set) {
      const best = set.split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]).map((p) => ({ url: p[0], w: parseFloat(p[1]) || 0 })).sort((a, b) => b.w - a.w)[0];
      if (best) return abs(best.url);
    }
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('data-zoom-image') || img.getAttribute('data-image');
    if (lazy && !lazy.startsWith('data:')) return abs(lazy);
    const src = img.getAttribute('src') || '';
    return src.startsWith('data:') ? '' : abs(src);
  }

  function pageTitle() {
    return text(document.title);
  }

  function tokenizeTitle(t) {
    return t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 8);
  }

  function visibleHeading() {
    const candidates = Array.from(document.querySelectorAll('h1, [itemprop="name"], [data-testid*="product-title"], [class*="product-title"], [class*="product-name"], [class*="productTitle"], [class*="productName"], [id*="productTitle"], [id*="product-title"]'));
    for (const c of candidates) {
      if (c.closest(BAD_CONTAINER)) continue;
      const t = text(c.textContent);
      if (t.length >= 3 && t.length <= 250 && isVisible(c)) return t;
    }
    return '';
  }

  function visiblePrice() {
    const preferred = Array.from(document.querySelectorAll('[itemprop="price"], [data-testid*="price"], [class*="price"]:not([class*="strike"]):not([class*="was"]):not([class*="old"]):not([class*="compare"]), [id*="price"]')).slice(0, 60);
    for (const p of preferred) {
      if (p.closest(BAD_CONTAINER)) continue;
      const attr = p.getAttribute('content') || p.getAttribute('data-price') || p.getAttribute('data-amount');
      if (attr && /^\d/.test(attr)) return { text: attr, currency: text(p.getAttribute('data-currency') || '') };
      const t = text(p.textContent);
      const m = t.match(PRICE_RE);
      if (m && t.length < 80 && (rectOk(p))) return { text: m[0], currency: '' };
    }
    // Scan the main area text for a price near the top of the page.
    const main = document.querySelector('main') || document.body;
    if (!main) return null;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode() && count++ < 4000) {
      const node = walker.currentNode;
      const t = text(node.nodeValue);
      if (t.length < 2 || t.length > 60) continue;
      const m = t.match(PRICE_RE);
      if (!m) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(BAD_CONTAINER) || parent.closest('script, style, noscript, del, s, strike')) continue;
      if (rectOk(parent)) return { text: m[0], currency: '' };
    }
    return null;
  }

  function rectOk(el) {
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? true : r.top < (window.innerHeight || 800) * 2.5;
  }

  function breadcrumbsFromDom() {
    const nav = document.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], ol[itemtype*="BreadcrumbList"]');
    if (!nav) return [];
    return Array.from(nav.querySelectorAll('a, li, span[itemprop="name"]'))
      .map((n) => text(n.textContent))
      .filter((t) => t && t.length < 60 && !/^(home|›|>|\/|»)$/i.test(t))
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 8);
  }

  function siteName() {
    return meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || '';
  }

  function canonical() {
    const link = document.querySelector('link[rel="canonical"]');
    const href = link ? abs(link.getAttribute('href')) : '';
    if (href) {
      try {
        if (new URL(href).hostname === location.hostname) return href;
      } catch {
        /* ignore */
      }
    }
    return meta('meta[property="og:url"]') && abs(meta('meta[property="og:url"]')) || location.href;
  }

  // ---- workout lines -------------------------------------------------------------
  // Only on a page that talks about training (title, description or main heading): the short lines of
  // its lists and headings, where workouts write "Squats 3×12". Bounded; read locally like the rest.
  const WORKOUT_WORDS = /\b(?:work[- ]?outs?|exercises?|routine|hiit|wod|amrap|emom|tabata|circuit|full[- ]body|upper body|lower body|leg day|strength training|calisthenics|mobility)\b/i;
  function workoutLines(title, description) {
    const h1 = text(document.querySelector('h1')?.textContent);
    if (!WORKOUT_WORDS.test(`${title} ${description} ${h1}`)) return [];
    const root = document.querySelector('main, article, [role="main"]') || document.body;
    const out = [];
    for (const n of root.querySelectorAll('li, h2, h3, h4, p, td')) {
      if (out.length >= 150) break;
      if (n.closest(BAD_CONTAINER)) continue;
      const t = text(n.textContent);
      // Headings travel marked ("## Wall push-ups"): prose under one ("Repeat 5 times") is that exercise.
      if (/^H[234]$/.test(n.tagName) && t && t.length <= 60 && !/\d/.test(t)) out.push(`## ${t}`);
      else if (t && t.length <= 160 && /\d/.test(t)) out.push(t);
    }
    return out;
  }

  // ---- videos and articles -----------------------------------------------------
  // The few facts that matter for watching or reading later: length, channel or author, date, word count.
  const nameOf = (v) => text(Array.isArray(v) ? nameOf(v[0]) : typeof v === 'string' ? v : v && typeof v === 'object' ? v.name || '' : '');
  function mediaFacts(ld, ogType) {
    const v = ld?.video || null;
    const a = ld?.article || null;
    const micro = (prop) => (STALE ? '' : safe(() => text(document.querySelector(`[itemprop="${prop}"]`)?.getAttribute('content')), ''));
    const out = {
      ogType,
      duration: text(v?.duration) || micro('duration') || meta('meta[property="video:duration"]') || meta('meta[property="og:video:duration"]'),
      channel: nameOf(v?.author) || nameOf(v?.creator) || (STALE ? '' : safe(() => text(document.querySelector('[itemprop="author"] [itemprop="name"]')?.getAttribute('content')), '')),
      author: nameOf(a?.author) || meta('meta[name="author"]') || meta('meta[property="article:author"]').replace(/^https?:\/\/\S+$/, ''),
      published: text(v?.uploadDate || a?.datePublished) || meta('meta[property="article:published_time"]') || micro('uploadDate') || micro('datePublished'),
      siteName: nameOf(a?.publisher),
      wordCount: Number(a?.wordCount) || 0,
    };
    // Reading time needs a word count: from the page's own article text when it didn't publish one.
    if (!out.wordCount && (a || /^article/i.test(ogType))) {
      const body = document.querySelector('article') || document.querySelector('main, [role="main"]');
      const t = body ? String(body.innerText || body.textContent || '').slice(0, 300000) : '';
      out.wordCount = t ? t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length : 0;
    }
    return out;
  }

  // ---- a place's address on the page ----------------------------------------------
  // For pages with no place data (a restaurant's own site): the visible address block, e.g.
  //   "Location / 560 Larkin St / San Francisco, CA 94102 / Phone / (415) 474-5698 / Opening Hours / …"
  // plus a phone number and opening hours near it, and the words that say people visit (menu, hours…).
  const STREET_RE = /\b(?:st|street|ave|avenue|av|rd|road|blvd|boulevard|ln|lane|dr|drive|way|pl|place|sq|square|ct|court|pkwy|parkway|hwy|highway|broadway|bowery)\b\.?/i;
  const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}/;
  const DAY_RE = /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i;
  const TIME_RE = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;
  function pagePlace() {
    const text = String(document.body?.innerText || document.body?.textContent || '').slice(0, 200000);
    const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.length > 90 || !/^\d{1,6}[a-z]?(?:-\d+)?\s+\S/i.test(l) || !STREET_RE.test(l)) continue;
      const parts = l.split(/\s*,\s*/);
      let address = parts[0];
      let rest = parts.slice(1).join(', ');
      const next = lines[i + 1] || '';
      if (!rest && /^[\p{L} .'-]{2,40},\s*[\p{L}]{2,}/u.test(next) && next.length < 60) rest = next;
      // A city alone on the next line and its postcode on the one after ("5337 W Devon Ave / Chicago / 60646").
      else if (!rest && /^[\p{L} .'-]{2,40}$/u.test(next) && /^\d{4,6}(?:-\d{4})?$/.test(lines[i + 2] || '')) rest = `${next} ${lines[i + 2]}`;
      const m = rest.match(/^([^,]+?)(?:,\s*([A-Za-z .]{2,30}?))?(?:\s+(\d{4,6}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}))?\s*$/);
      const near = lines.slice(Math.max(0, i - 6), i + 14);
      const phone = (near.find((x) => PHONE_RE.test(x) && x.length < 40) || '').match(PHONE_RE)?.[0] || '';
      const hoursAt = near.findIndex((x) => /^(?:opening )?hours\b|^open\b/i.test(x));
      const hours = hoursAt >= 0 ? near.slice(hoursAt + 1, hoursAt + 9).filter((x) => (DAY_RE.test(x) || TIME_RE.test(x)) && x.length < 60).slice(0, 7) : [];
      const visit = /\b(?:menu|order online|reservations?|book a table|visit us|visit our|our shop|location|directions|opening hours|hours)\b/i.test(near.join(' '));
      // Under its own "Address" label: a listing's details block, not an address in passing.
      const labeled = /^(?:address|location|where)\s*:?$/i.test(lines[i - 1] || '');
      return { address: address.slice(0, 120), locality: m ? m[1].trim() : '', region: m && m[2] ? m[2].trim() : '', postalCode: m && m[3] ? m[3] : '', phone, hours, visit, labeled };
    }
    return null;
  }

  // ---- a business's profile on Instagram or Facebook ------------------------------------
  // Read like a visitor sees it: the name, the bio and (Facebook) the Intro lines. Whether it's a place is
  // decided in the extension (kinds.js placeFromProfile). The head's tags count only when they're this
  // page's (Instagram and Facebook change pages without reloading).
  function socialProfile() {
    const host = location.hostname.replace(/^(?:www|m|web)\./, '');
    const seg = location.pathname.split('/').filter(Boolean);
    const here = location.pathname.replace(/\/+$/, '').toLowerCase();
    let fresh = false;
    try { fresh = new URL(rawMeta('meta[property="og:url"]')).pathname.replace(/\/+$/, '').toLowerCase() === here; } catch { /* no og:url */ }
    const raw = (sel) => (fresh ? String(document.querySelector(sel)?.getAttribute('content') || '') : '');
    const linesOf = (el) => String(el?.innerText || el?.textContent || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (host === 'instagram.com') {
      if (seg.length !== 1 || /^(?:p|reel|reels|explore|stories|accounts|direct|tv|about|legal)$/i.test(seg[0])) return null;
      const name = (raw('meta[property="og:title"]').match(/^(.*?)\s*\(@/) || [])[1]?.trim() || '';
      const bio = (raw('meta[name="description"]').match(/on Instagram:\s*"([\s\S]*?)"?\s*$/) || [])[1] || '';
      const header = linesOf(document.querySelector('header')).filter((l) => !/^(?:[\d.,]+[KM]?\s*)?(?:posts?|followers?|following)$|^[\d.,]+[KM]?$|^(?:follow|message|log in|sign up)$/i.test(l));
      return { platform: 'instagram', handle: seg[0], name, bio: bio.slice(0, 1500), header: header.join('\n').slice(0, 1500) };
    }
    if (host === 'facebook.com') {
      if (!seg.length || /^(?:groups|watch|events|marketplace|gaming|reel|reels|stories|photo|photos|videos|story\.php|permalink\.php|share|login|help|policies|privacy)$/i.test(seg[0])) return null;
      if (seg.length > 1 && !/^(?:about|p|pages)$/i.test(seg[1]) && !/^(?:p|pages)$/i.test(seg[0])) return null;
      const name = raw('meta[property="og:title"]') || text(document.querySelector('h1')?.innerText);
      const lines = linesOf(document.querySelector('[role="main"]') || document.body).slice(0, 400);
      const at = lines.findIndex((l) => /^intro$/i.test(l));
      const intro = at >= 0 ? lines.slice(at + 1, at + 25) : [];
      const end = intro.findIndex((l) => /^(?:photos|see all photos|featured|privacy|posts)$/i.test(l));
      return { platform: 'facebook', handle: seg[0], name: name.slice(0, 200), about: raw('meta[property="og:description"]').slice(0, 1000), bio: '', intro: (end >= 0 ? intro.slice(0, end) : intro).map((l) => l.slice(0, 200)) };
    }
    return null;
  }

  // ---- a business's own home page ------------------------------------------------------
  // When it shows no address: who it is, what it says about itself, a phone, and whether it links to
  // its locations or hours. kinds.js placeFromHome decides whether that's somewhere you go.
  function homeFacts(ld) {
    if (location.pathname.replace(/\/+$/, '').replace(/^\/(?:home|index(?:\.html?)?)$/i, '') !== '') return null;
    const org = ld?.org || {};
    const foot = String(document.querySelector('footer, [role="contentinfo"]')?.innerText || '').slice(0, 4000);
    const VISIT = /\b(?:locations?|find us|visit us|our (?:shops?|stores?|caf[eé]s?|bakeries|studios?)|scoop shops|store locator|hours(?: (?:&|and) locations?)?|directions)\b/i;
    const visitLink = Array.from(document.querySelectorAll('a[href]')).slice(0, 800).some((a) => VISIT.test(text(a.textContent).slice(0, 60)) || /\/(?:locations?|stores?|find-us|visit(?:-us)?|hours)\/?$/i.test(a.pathname || ''));
    const phone = text(typeof org.telephone === 'string' ? org.telephone : '') || (foot.match(PHONE_RE) || [])[0] || '';
    return {
      name: text(org.name).slice(0, 200), siteName: meta('meta[property="og:site_name"]').slice(0, 200), title: text(document.title).slice(0, 300),
      about: [text(org.description), meta('meta[name="description"]'), meta('meta[property="og:description"]')].filter(Boolean).join(' · ').slice(0, 1500),
      phone: phone.slice(0, 40), visitLink,
    };
  }

  // ---- assemble ----------------------------------------------------------------
  function extract(hints) {
    const h = hints || safe(() => globalThis.__keepsakeHints) || {};
    const result = {
      title: '', description: '', image: '', images: [], imageAlt: '', price: null, currency: '', priceText: '',
      retailer: '', siteName: '', brand: '', schemaCategory: '', productType: '', tags: [], breadcrumbs: [], availability: '',
      url: location.href, canonicalUrl: '', host: location.hostname.replace(/^www\./, ''), source: 'fallback', signals: [], imageAspect: null,
      isInstagram: /(^|\.)instagram\.com$/.test(location.hostname), sparse: false,
    };
    const images = [];

    STALE = !!safe(staleHead, false);
    const ld = STALE ? { product: null, breadcrumbs: [], recipe: null, place: null, video: null, article: null, types: [] } : safe(readJsonLd, { product: null, breadcrumbs: [], recipe: null, types: [] });
    if (STALE) result.signals.push('stale-head');
    result.schemaTypes = ld?.types || [];
    if (ld?.product) {
      const p = ld.product;
      result.title = text(p.name);
      result.description = text(typeof p.description === 'string' ? p.description : '').slice(0, 1000);
      imagesFrom(p.image, images);
      result.brand = text(typeof p.brand === 'string' ? p.brand : p.brand?.name);
      result.schemaCategory = text(typeof p.category === 'string' ? p.category : p.category?.name);
      const offer = offerFrom(p);
      if (offer.price !== null && offer.price !== undefined && offer.price !== '') {
        result.price = offer.price;
        result.currency = offer.currency;
        result.availability = offer.availability;
      }
      if (result.title) {
        result.source = 'jsonld';
        result.signals.push('jsonld');
      }
    }
    if (ld?.breadcrumbs?.length) result.breadcrumbs = ld.breadcrumbs;
    // A place page: its fields travel raw (bounded); the background worker normalizes them (kinds.js).
    if (ld?.place && !ld?.product) {
      const pl = ld.place;
      result.title = result.title || text(pl.name);
      result.description = result.description || text(typeof pl.description === 'string' ? pl.description : '').slice(0, 1000);
      imagesFrom(pl.image, images);
      result.place = safe(() => JSON.parse(JSON.stringify({
        '@type': pl['@type'], name: pl.name, address: pl.address, geo: pl.geo, telephone: pl.telephone, servesCuisine: pl.servesCuisine,
        priceRange: pl.priceRange, openingHours: pl.openingHours, openingHoursSpecification: Array.isArray(pl.openingHoursSpecification) ? pl.openingHoursSpecification.slice(0, 40) : pl.openingHoursSpecification,
      })), null);
      if (result.title && result.source === 'fallback') result.source = 'jsonld';
    }
    // A recipe page: its fields travel raw (bounded); the background worker normalizes them (kinds.js).
    const recipe = ld?.recipe || safe(readMicrodataRecipe, null);
    if (recipe && !ld?.product) {
      result.title = text(recipe.name) || result.title;
      result.description = text(typeof recipe.description === 'string' ? recipe.description : '').slice(0, 1000) || result.description;
      imagesFrom(recipe.image, images);
      if (result.title) result.source = recipe.__microdata ? 'microdata' : 'jsonld';
      result.signals.push('recipe');
    }
    if (recipe) {
      const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
      // A plain copy (no functions, no DOM nodes) so it survives the trip back to the extension.
      result.recipe = safe(() => JSON.parse(JSON.stringify({
        recipeIngredient: arr(recipe.recipeIngredient || recipe.ingredients).slice(0, 80),
        recipeInstructions: arr(recipe.recipeInstructions).slice(0, 60),
        recipeYield: recipe.recipeYield, totalTime: recipe.totalTime, prepTime: recipe.prepTime, cookTime: recipe.cookTime,
        recipeCuisine: recipe.recipeCuisine, recipeCategory: recipe.recipeCategory, author: recipe.author,
      })), null);
    }

    const ogTitle = meta('meta[property="og:title"]');
    const ogDesc = meta('meta[property="og:description"]') || meta('meta[name="description"]');
    const ogImages = metaAll('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]').map(abs).filter(Boolean);
    if (ogImages.length) result.signals.push('og');
    if (!result.title && ogTitle) {
      result.title = ogTitle;
      result.source = 'og';
    }
    if (!result.description && ogDesc) result.description = ogDesc.slice(0, 1000);
    images.push(...ogImages);

    const twTitle = meta('meta[name="twitter:title"]');
    const twImage = abs(meta('meta[name="twitter:image"], meta[name="twitter:image:src"]'));
    if (!result.title && twTitle) {
      result.title = twTitle;
      result.source = 'twitter';
    }
    if (twImage) images.push(twImage);

    if (result.price === null || result.price === '') {
      const amount = meta('meta[property="product:price:amount"], meta[property="og:price:amount"], meta[itemprop="price"], meta[name="price"], meta[property="product:sale_price:amount"]');
      const currency = meta('meta[property="product:price:currency"], meta[property="og:price:currency"], meta[itemprop="priceCurrency"], meta[name="currency"]');
      if (amount) {
        result.price = amount;
        result.currency = currency;
        result.signals.push('price-meta');
        if (result.source === 'fallback') result.source = 'price-meta';
      }
    }
    if (!result.brand) result.brand = meta('meta[property="product:brand"], meta[property="og:brand"]');
    if (!result.schemaCategory) result.schemaCategory = meta('meta[property="product:category"]') || safe(() => text(document.querySelector('[itemprop="category"]')?.getAttribute('content') || ''), '');
    const store = safe(readStoreTaxonomy, { productType: '', tags: [] });
    result.productType = store.productType.slice(0, 80);
    result.tags = store.tags;

    const heading = safe(visibleHeading, '');
    if (!result.title || result.title.length < 3) {
      result.title = heading || pageTitle();
      if (result.source === 'fallback' && heading) result.source = 'heading';
    }
    if (result.price === null || result.price === '') {
      const vp = safe(visiblePrice);
      if (vp) {
        result.priceText = vp.text;
        result.currency = result.currency || vp.currency;
        result.signals.push('visible-price');
      }
    } else {
      result.priceText = String(result.price);
      const n = Number(String(result.price).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, ''));
      result.price = Number.isFinite(n) ? n : null;
    }
    if (!result.breadcrumbs.length) result.breadcrumbs = safe(breadcrumbsFromDom, []);

    // Images: hints first, then structured, then visible heuristics.
    if (h.imageUrl) images.unshift(abs(h.imageUrl));
    const visible = safe(() => imageCandidates(12), []);
    const visibleSrcs = visible.map((v) => v.src);
    const ordered = [];
    const seen = new Set();
    for (const src of [...images, ...visibleSrcs]) {
      if (!src || seen.has(src) || BAD_IMG_RE.test(src)) continue;
      seen.add(src);
      ordered.push(src);
    }
    result.images = ordered.slice(0, 6);
    result.image = result.images[0] || '';
    const main = visible.find((v) => v.src === result.image);
    if (main) {
      result.imageAlt = main.alt || '';
      if (main.w && main.h) result.imageAspect = Math.round((main.w / main.h) * 100) / 100;
    }
    if (!result.imageAlt && visible[0]) result.imageAlt = visible[0].alt || '';

    result.siteName = safe(siteName, '');
    result.retailer = result.siteName || '';
    result.canonicalUrl = safe(canonical, location.href);
    if (!result.title) result.title = pageTitle() || location.hostname;
    result.sparse = (result.source === 'fallback' || result.source === 'heading') && !result.priceText && !result.image;
    if (h.selectionText && !result.description) result.description = text(h.selectionText).slice(0, 500);
    if (h.linkUrl) result.linkUrl = abs(h.linkUrl);
    result.pageTitle = pageTitle();
    if (!ld?.product && !recipe) result.media = safe(() => mediaFacts(ld, meta('meta[property="og:type"]')), null);
    // An Instagram post or reel: its own caption, creator and location, from the page's data for this post
    // (matched by its shortcode, so a grid or suggestions around it don't count) and the caption on screen.
    // Parsed in the extension (src/instagram/post.js); nothing here is sent anywhere.
    if (result.isInstagram) {
      result.igBundle = safe(() => {
        const code = (location.pathname.match(/\/(?:p|reel|reels)\/([\w-]{5,})/) || [])[1] || '';
        if (!code) return null;
        let metaMap = {};
        for (const m of document.querySelectorAll('meta[property], meta[name]')) {
          const k = m.getAttribute('property') || m.getAttribute('name');
          const v = m.getAttribute('content');
          if (k && v && !(k in metaMap)) metaMap[k] = v;
        }
        // The head's tags count only when they are this post's (their link carries its code).
        if (STALE || !String(metaMap['og:url'] || '').includes(code)) metaMap = {};
        const scripts = [];
        let total = 0;
        for (const s of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script:not([src])')) {
          const t = s.textContent || '';
          if (t.length < 20 || !t.includes(code) || !/"caption"|"edge_media_to_caption"|"location"/.test(t)) continue;
          if (total + t.length > 3000000) break;
          total += t.length;
          scripts.push({ type: s.getAttribute('type') || '', text: t });
        }
        // On screen: the caption heading, or the text block that holds a 📍 line.
        let visibleCaption = '';
        const roots = [document.querySelector('[role="dialog"]'), document.querySelector('main'), document.querySelector('article')].filter(Boolean);
        for (const root of roots) {
          const h1 = root.querySelector('h1');
          const t = h1 ? String(h1.innerText || h1.textContent || '').trim() : '';
          if (t.length > 20) { visibleCaption = t; break; }
        }
        if (!visibleCaption) {
          let best = '';
          for (const root of roots) for (const n of root.querySelectorAll('span[dir="auto"], div[dir="auto"], h1, span')) {
            const t = String(n.innerText || n.textContent || '').trim();
            if (t.length > best.length && t.length < 4000 && /📍|📌/u.test(t)) best = t;
          }
          visibleCaption = best;
        }
        return { meta: metaMap, scripts, visibleCaption: visibleCaption.slice(0, 4000) };
      }, null);
      result.igLocation = safe(() => {
        const a = document.querySelector('main a[href*="/explore/locations/"], article a[href*="/explore/locations/"]');
        const name = a ? text(a.textContent) : '';
        return name && name.length <= 120 ? { name, url: abs(a.getAttribute('href')) } : null;
      }, null);
    }
    // A film, show or book: its fields travel raw (bounded); kinds.js normalizes them. The open graph tags
    // stand in when there's no structured data (og:type video.movie / video.tv_show / book).
    const pick = (n, keys) => safe(() => JSON.parse(JSON.stringify(Object.fromEntries(keys.map((k) => [k, n[k]])))), null);
    if (!ld?.product && ld?.screen) result.screen = pick(ld.screen, ['@type', 'name', 'datePublished', 'startDate', 'dateCreated', 'director', 'creator', 'duration', 'numberOfSeasons', 'genre']);
    if (!ld?.product && ld?.book) result.book = pick(ld.book, ['@type', 'name', 'author', 'datePublished', 'copyrightYear', 'numberOfPages', 'isbn', 'genre', 'workExample']);
    if (!ld?.product && ld?.screen) { imagesFrom(ld.screen.image, images); result.title = text(ld.screen.name) || result.title; }
    if (!ld?.product && ld?.book) { imagesFrom(ld.book.image, images); result.title = text(ld.book.name) || result.title; }
    const og = meta('meta[property="og:type"]').toLowerCase();
    if (!result.screen && /^video\.(?:movie|tv_show)$/.test(og)) {
      result.screen = { '@type': og === 'video.tv_show' ? 'TVSeries' : 'Movie', datePublished: meta('meta[property="video:release_date"]'), director: metaAll('meta[property="video:director"]').map((d) => (/^https?:/.test(d) ? '' : d)).filter(Boolean) };
    }
    if (!result.book && og === 'book') {
      result.book = { '@type': 'Book', author: metaAll('meta[property="book:author"]').filter((a) => !/^https?:/.test(a)), isbn: meta('meta[property="book:isbn"]'), datePublished: meta('meta[property="book:release_date"]') };
    }
    if ((result.screen || result.book) && images.length && !result.images.length) {
      result.images = images.slice(0, 6);
      result.image = result.images[0];
    }

    // YouTube: what's on screen wins over the head, which may describe the previous video.
    const yt = safe(youtubeWatch, null);
    if (yt) {
      if (yt.title) result.title = yt.title;
      if (yt.description) result.description = yt.description.slice(0, 1000);
      else if (STALE) result.description = '';
      result.images = [yt.image, ...result.images.filter((u) => u !== yt.image)].slice(0, 6);
      result.image = yt.image;
      result.imageAspect = 16 / 9;
      result.media = { ...(result.media || {}), ogType: 'video.other', channel: yt.channel || (STALE ? '' : result.media?.channel || ''), duration: yt.duration || (STALE ? '' : result.media?.duration || '') };
      if (STALE && result.media) result.media.published = '';
    }
    if (!ld?.product && !recipe && !ld?.place && !result.isInstagram) result.pagePlace = safe(pagePlace, null);
    if (!ld?.product && !recipe && !ld?.place) result.profile = safe(socialProfile, null);
    if (!ld?.product && !recipe && !ld?.place && !result.profile && !result.pagePlace?.address) result.home = safe(() => homeFacts(ld), null);
    if (!ld?.product && !recipe && !result.isInstagram) result.workoutLines = safe(() => workoutLines(result.title, result.description), []);
    return result;
  }

  globalThis.__keepsakeExtract = extract;
  return extract();
})();
