// Wish List: every save that is something to buy, gathered from all your collections (and Review), with
// the lowest prices found for each when you ask.
//
// Nothing here runs by itself. "Find deals" (one save) and "Check all" send the product's name, brand,
// model, saved price, shop and link to your own AI provider, which searches the web (src/ai/provider.js
// findDealsWithAI). Each store page it found is then read once, without cookies, for the price the store
// itself publishes (understand.js productFromHtml): that price wins over the search result's, and the offer
// is marked confirmed. What was found is kept on the save (item.deals) with the time it was checked.
//
// Honest limits, shown in the app too: a price is what a page said at that moment. It can be for another
// size or colour, and leaves out shipping, tax, coupons and member prices.

import { formatPrice, hostnameOf } from './util.js';
import { kindOf } from './kinds.js';
import { isSocialHost } from './categorizer.js';
import { isShopping, productFromHtml, regionNow } from './understand.js';
import { findDealsWithAI, supportsWebLookup, usableKey, lookupCost, siteOfHost, DEAL_FLOOR } from '../ai/provider.js';

// How sure the provider must be that it priced the product you saved before its offers are shown.
export const DEALS_CONFIDENCE = 0.5;
// Check all leaves alone what was checked this recently; older results are called out as old.
export const DEALS_FRESH_HOURS = 12;
// A store page's price more than this far from the search result's is another variant, so it isn't trusted.
export const DEAL_PAGE_DRIFT = 0.25;
export const DEALS_OLD_HOURS = 48;
// A store page's price this far under the search result's price is taken for another variant's.
export const CONFIRM_FLOOR = 0.8;

// A price this far under what stores you know charge (or under the other stores' middle price), at a store
// that isn't one of them, is shown with a warning and never as the best price.
export const DOUBT_BELOW = 0.75;
// With nothing else to compare with, the same for a price this far under the price you saved it at.
export const DOUBT_BELOW_SAVED = 0.6;

// Large retailers people know. Not a seal of approval and not complete: it only decides which stores'
// prices the others are measured against. A store off this list is never hidden, only flagged when its
// price is far below theirs.
const KNOWN_STORES = new Set(`amazon.com amazon.co.uk amazon.ca amazon.de amazon.fr amazon.it amazon.es amazon.com.au amazon.co.jp
walmart.com target.com bestbuy.com bestbuy.ca costco.com costco.ca samsclub.com bjs.com bhphotovideo.com adorama.com newegg.com
apple.com homedepot.com lowes.com wayfair.com macys.com nordstrom.com nordstromrack.com kohls.com rei.com backcountry.com
dickssportinggoods.com zappos.com sephora.com ulta.com gamestop.com staples.com officedepot.com crutchfield.com chewy.com
petco.com petsmart.com ikea.com crateandbarrel.com williams-sonoma.com surlatable.com potterybarn.com westelm.com
bloomingdales.com saksfifthavenue.com neimanmarcus.com jcpenney.com qvc.com hsn.com microcenter.com
argos.co.uk currys.co.uk johnlewis.com boots.com very.co.uk ao.com selfridges.com marksandspencer.com
canadiantire.ca thebay.com londondrugs.com mediamarkt.de saturn.de otto.de fnac.com darty.com bol.com coolblue.nl
elcorteingles.es zalando.com zalando.de zalando.co.uk jbhifi.com.au harveynorman.com.au thegoodguys.com.au kmart.com.au
bigw.com.au officeworks.com.au`.split(/\s+/));

const BRAND_ENDINGS = /^(com|ca|de|fr|it|es|nl|se|dk|no|fi|ie|at|ch|be|pl|pt|jp|eu|co\.uk|com\.au|co\.jp|co\.nz|com\.mx|com\.br)$/;
const storeHost = (url) => hostnameOf(url || '').toLowerCase();
const siteOf = siteOfHost;
const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// A store whose prices the others are measured against: a large retailer, the shop the save came from,
// or the brand's own site (dyson.com for a Dyson).
export function knownStore(host, item = null) {
  const site = siteOf(String(host || '').toLowerCase());
  if (!site) return false;
  if (KNOWN_STORES.has(site)) return true;
  const d = item?.details || {};
  const own = [d.shopUrl, item?.type === 'instagram' ? '' : item?.url].map((u) => siteOf(storeHost(u))).filter(Boolean);
  if (own.includes(site) && !isSocialHost(site)) return true;
  // The brand's own site, on the endings brands actually use: nike.com or dyson.co.uk, not nike.top or sony.shop.
  const brand = slug(d.brand);
  const [name, ...ending] = site.split('.');
  return brand.length >= 3 && slug(name) === brand && BRAND_ENDINGS.test(ending.join('.'));
}

// Offers with doubt: true on the ones that look too good (pure). Only stores in stock set the bar.
export function markDoubt(offers, item = null) {
  const list = offers || [];
  const live = list.filter((o) => !o.outOfStock);
  const known = live.filter((o) => knownStore(storeHost(o.url), item));
  // Only prices in the same currency are measured against each other.
  const like = (o, list_) => list_.filter((x) => (x.currency || '') === (o.currency || ''));
  const saved = Number.isFinite(item?.price) && item.price > 0 && item.currency ? item.price : null;
  return list.map((o) => {
    if (known.includes(o)) return o;
    let bar = null;
    const peers = like(o, known);
    if (peers.length) bar = Math.min(...peers.map((k) => k.price)) * DOUBT_BELOW;
    else {
      const others = like(o, live).filter((x) => x !== o).map((x) => x.price).sort((a, b) => a - b);
      if (others.length >= 2) bar = (others.length % 2 ? others[(others.length - 1) / 2] : (others[others.length / 2 - 1] + others[others.length / 2]) / 2) * DOUBT_BELOW;
      else if (saved !== null && (!o.currency || o.currency === item.currency)) bar = saved * DOUBT_BELOW_SAVED;
    }
    return bar !== null && o.price < bar ? { ...o, doubt: true } : o;
  });
}

// On the Wish List: something to buy (a product anywhere, or a page saved into a collection), not bought
// yet, not in the Trash and not taken off the list by you.
export function onWishList(item) {
  return !!item && !item.deletedAt && !item.purchased && !item.wishHidden && item.captureState !== 'pending' && isShopping(item);
}

// Taken off the list by you, and would be on it otherwise (for "Hidden", where it can be put back).
export function hiddenFromWishList(item) {
  return !!item && !!item.wishHidden && onWishList({ ...item, wishHidden: false });
}

const hoursSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 36e5 : Infinity);

// Offers as shown: in stock first, the ones that look too good last, then lowest price.
export function sortOffers(offers) {
  return [...(offers || [])].sort((a, b) => (a.outOfStock === true) - (b.outOfStock === true) || (a.doubt === true) - (b.doubt === true) || a.price - b.price);
}

// What a Wish List row says about a save (pure).
//   state: 'unchecked' | 'found' | 'none' (no prices found) | 'unsure' (couldn't tell which product)
//   best: the lowest offer in stock that doesn't look too good to be true (markDoubt); saving / savingPct: how far it is below the price you saved it at
//   (null when the save has no price, the currencies differ, or it isn't lower).
export function dealSummary(item, now = Date.now()) {
  const deals = item?.deals || null;
  if (!deals) return { state: 'unchecked', offers: [], best: null, saving: null, savingPct: null, checkedAt: null, old: false };
  const offers = sortOffers(markDoubt(deals.offers, item));
  const best = offers.find((o) => !o.outOfStock && !o.doubt) || null;
  const saved = Number.isFinite(item.price) && item.price > 0 ? item.price : null;
  // Only prices in the same, known currency can be compared.
  const comparable = best && saved !== null && !!item.currency && item.currency === best.currency;
  const saving = comparable && best.price < saved ? Math.round((saved - best.price) * 100) / 100 : null;
  return {
    state: offers.length ? 'found' : deals.empty === 'unsure' ? 'unsure' : 'none',
    offers, best, saving, savingPct: saving !== null ? Math.round((saving / saved) * 100) : null,
    checkedAt: deals.checkedAt, old: hoursSince(deals.checkedAt, now) > DEALS_OLD_HOURS,
  };
}

// The Wish List in order: the biggest savings first, then what has prices, then the rest, newest first.
export function wishList(items, now = Date.now()) {
  const rows = (items || []).filter(onWishList).map((item) => ({ item, summary: dealSummary(item, now) }));
  const rank = (r) => (r.summary.saving !== null ? 0 : r.summary.state === 'found' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || (b.summary.savingPct || 0) - (a.summary.savingPct || 0) || String(b.item.createdAt || '').localeCompare(String(a.item.createdAt || '')));
}

// Check all: the saves on the list with no prices yet, or prices older than DEALS_FRESH_HOURS.
export function dealsToCheck(items, now = Date.now()) {
  return (items || []).filter(onWishList).filter((i) => hoursSince(i.deals?.checkedAt, now) > DEALS_FRESH_HOURS);
}

// Model-like words in a title: anything with a digit (XM5, V15, 9, 5.5, 16GB), minus years. A store page whose
// own title lacks one of them is a different model or size (a Clifton 11 for a Clifton 9).
const modelWords = (title) => [...new Set(String(title || '').toLowerCase().replace(/[()\[\],]/g, ' ').split(/\s+/)
  .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').replace(/-/g, '')).filter((w) => /\d/.test(w) && !/^(19|20)\d\d$/.test(w) && !/^\$?\d+(\.\d\d)?$/.test(w) || /^\d{1,2}(\.\d)?$/.test(w)))];
export function pageIsOtherModel(page, title) {
  const seen = String(page?.title || page?.name || '').toLowerCase().replace(/&(#\d+|#x[0-9a-f]+|\w+);/g, ' ');
  if (!seen.trim() || !/\d/.test(seen)) return false;   // no digits on the page's title: nothing to compare
  const flat = seen.replace(/[\s-]+/g, '');
  return modelWords(title).some((w) => (/^\d+$/.test(w) ? !new RegExp(`(^|[^0-9.])${w}([^0-9]|\\.(?!\\d)|$)`).test(seen) : !flat.includes(w.replace(/\s/g, ''))));
}

// An offer after reading the store's own page (pure), or null when that page is another model than the
// saved product's. The page's published price wins and marks the offer confirmed; a page with no price,
// another currency, a price so low it must be another item, or one far from the search result's (another
// variant or bundle on the same page) leaves the search result's price as it was, unconfirmed.
export function confirmOffer(offer, page, saved = null, title = '') {
  const out = { ...offer, confirmed: false };
  if (!page) return out;
  if (title && pageIsOtherModel(page, title)) return null;
  if (page.availability === 'out_of_stock') out.outOfStock = true;
  const price = Number(page.price);
  if (!Number.isFinite(price) || price <= 0) return out;
  if (page.currency && offer.currency && page.currency !== offer.currency) return out;
  if (saved !== null && price < saved * DEAL_FLOOR) return out;
  // A page that prices several variants, or a page price well under the search result's, is most likely
  // the cheapest variant's "from" price: not this item's, so nothing is confirmed.
  if (page.priceVaries || price < offer.price * CONFIRM_FLOOR) return out;
  // The other way: a page price far above the search result's is another variant or bundle too.
  if (price > offer.price * (1 + DEAL_PAGE_DRIFT)) return out;
  return { ...out, price: Math.round(price * 100) / 100, currency: offer.currency || page.currency || '', confirmed: true };
}

// What the provider is told about the product (pure).
export function dealsInput(item, { region = '', today = '' } = {}) {
  const d = kindOf(item) === 'product' ? item.details || {} : {};
  const social = item.type === 'instagram' || isSocialHost(item.host || hostnameOf(item.url || ''));
  const saved = Number.isFinite(item.price) && item.price > 0 ? item.price : null;
  // Your own words for the product win over what was read from the page: its model and specs could be
  // the very thing you corrected.
  const named = String(item.wishName || '').trim();
  return {
    title: named || item.title || '', listing: named ? '' : d.shopTitle || '', brand: d.brand || '', model: named ? '' : d.model || '',
    specs: named ? [] : (d.specs || []).filter((s) => /^(colou?r|size|capacity|storage|style|edition|version|material)$/i.test(s.label || '')),
    // amount (what offers are measured against) only with its currency: a bare number can't be compared.
    price: saved !== null ? formatPrice(saved, item.currency) : '', amount: item.currency ? saved : null, currency: item.currency || '',
    retailer: d.shopName || (social ? '' : item.retailer || ''), url: d.shopUrl || (social ? '' : item.url || ''),
    skip: Array.isArray(item.dealSkip) ? item.dealSkip : [],
    region, today,
  };
}

// Find deals for one save, and keep them on it. Throws the provider's error (the app shows it and the
// save's last results stay as they were). fetchShopPage(url) → html | null reads a store page the search
// found, without cookies.
export async function findDeals(store, id, { fetchShopPage = async () => null, region = '', now = () => new Date() } = {}) {
  const item = await store.getItem(id);
  if (!item || item.deletedAt) throw new Error('That save is gone.');
  // Hidden or bought since you asked (Check all was still running): nothing is sent for it.
  if (!onWishList(item)) return { item, summary: dealSummary(item), skipped: true };
  const settings = await store.getSettings();
  const key = usableKey(settings, await store.getSecret('aiApiKey'));
  if (!key) throw new Error('Finding deals uses your own AI key. Add one in Settings first.');
  if (!supportsWebLookup(settings)) throw new Error('Finding deals needs Anthropic or OpenAI: a custom endpoint has no web search.');
  const at = now();
  const input = dealsInput(item, { region: region || regionNow(), today: at.toISOString().slice(0, 10) });
  // A lookup the provider answered was paid for whatever it found, usable or not: it goes on this month's
  // total. (One that timed out or was refused isn't counted: whether it was billed can't be known here.)
  const spent = async (r) => store.updateSettings({ wish: { spend: addSpend((await store.getSettings()).wish?.spend, r.usage, r.provider, r.model, monthOf(at)) } });
  let found;
  try {
    found = await findDealsWithAI(input, settings, key);
  } catch (e) {
    if (e && e.usage) await spent(e);
    throw e;
  }
  await spent(found);
  // Renamed, hidden or bought while the search ran: these prices are for the old name, so they aren't kept.
  const after = await store.getItem(id);
  if (!after || !onWishList(after) || (after.wishName || '') !== (item.wishName || '')) return { item: after || item, summary: dealSummary(after || item), skipped: true };
  const sure = found.confidence >= DEALS_CONFIDENCE;
  const offers = sure ? await Promise.all(found.offers.map(async (o) => {
    let page = null;
    try {
      const html = await fetchShopPage(o.url);
      page = html ? productFromHtml(html, o.url) : null;
    } catch {
      /* unreadable: the search result's price stands, unconfirmed */
    }
    return confirmOffer(o, page, input.amount, input.title);
  })) : [];
  const kept = offers.filter(Boolean);
  const deals = {
    checkedAt: at.toISOString(), product: found.product, offers: sortOffers(kept),
    empty: kept.length ? '' : sure ? 'none' : 'unsure', provider: found.provider, model: found.model, usage: found.usage,
  };
  // by 'deals': not an edit of yours, so no field is marked as hand-edited.
  const next = await store.updateItem(id, { deals }, { by: 'deals' });
  return { item: next, summary: dealSummary(next, at.getTime()) };
}

// The month on this device's clock: "2026-11".
const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// This month's spend on Find deals with one more lookup added (pure). usd counts the lookups whose model
// has a known price; unpriced counts the rest, so a total is never passed off as complete.
export function addSpend(spend, usage, provider, model, month) {
  const now = spend && spend.month === month ? spend : { month, usd: 0, lookups: 0, unpriced: 0 };
  const cost = lookupCost(usage, provider, model);
  return {
    month, lookups: (Number(now.lookups) || 0) + 1,
    usd: Math.round(((Number(now.usd) || 0) + (cost || 0)) * 1e4) / 1e4,
    unpriced: (Number(now.unpriced) || 0) + (cost === null ? 1 : 0),
  };
}
// This month's spend as stored, or zeroes when the stored one is another month's.
export function spendThisMonth(settings, now = new Date()) {
  const sp = settings?.wish?.spend;
  const month = monthOf(now);
  return sp && sp.month === month ? { month, usd: Number(sp.usd) || 0, lookups: Number(sp.lookups) || 0, unpriced: Number(sp.unpriced) || 0 } : { month, usd: 0, lookups: 0, unpriced: 0 };
}

// "Not the same item": the offer goes, and that store is left out of this save's later lookups. Returns
// the offer taken away (for Undo), or null when it was already gone.
export async function removeOffer(store, id, url) {
  const item = await store.getItem(id);
  const gone = (item?.deals?.offers || []).find((o) => o.url === url);
  if (!item || !gone) return null;
  const host = siteOf(storeHost(url));
  await store.updateItem(id, {
    deals: { ...item.deals, offers: item.deals.offers.filter((o) => o !== gone) },
    dealSkip: [...new Set([...(item.dealSkip || []), host].filter(Boolean))].slice(-20),
  }, { by: 'deals' });
  return gone;
}
// Undo of removeOffer: the offer is back (if this is still the lookup it came from) and its store is
// searched again.
export async function restoreOffer(store, id, offer, checkedAt = '') {
  const item = await store.getItem(id);
  if (!item || !offer?.url) return;
  const host = siteOf(storeHost(offer.url));
  const same = item.deals && (!checkedAt || item.deals.checkedAt === checkedAt) && !item.deals.offers.some((o) => o.url === offer.url);
  await store.updateItem(id, {
    ...(same ? { deals: { ...item.deals, offers: sortOffers([...item.deals.offers, offer]) } } : {}),
    dealSkip: (item.dealSkip || []).filter((h) => h !== host),
  }, { by: 'deals' });
}

// The exact product in your words, for Find deals. The save's own title stays as it is. Empty clears it.
// Prices found for the old name are dropped: they were for whatever the search took it to be. So are the
// stores you skipped, whose listings were wrong for the old name and may be right for this one.
export async function setWishName(store, id, name) {
  const item = await store.getItem(id);
  if (!item) return;
  const next = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (next === (item.wishName || '')) return;
  await store.updateItem(id, { wishName: next === (item.title || '').trim() ? '' : next, deals: null, dealSkip: [] }, { by: 'deals' });
}

// Take saves off the Wish List, or put them back. Their deals stay.
export async function setWishHidden(store, ids, hidden) {
  for (const id of ids) await store.updateItem(id, { wishHidden: !!hidden }, { by: 'deals' });
}

