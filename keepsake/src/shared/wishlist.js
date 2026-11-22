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
import { findDealsWithAI, supportsWebLookup, usableKey, DEAL_FLOOR } from '../ai/provider.js';

// How sure the provider must be that it priced the product you saved before its offers are shown.
export const DEALS_CONFIDENCE = 0.5;
// Check all leaves alone what was checked this recently; older results are called out as old.
export const DEALS_FRESH_HOURS = 12;
export const DEALS_OLD_HOURS = 48;
// A store page's price this far under the search result's price is taken for another variant's.
export const CONFIRM_FLOOR = 0.8;

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

// Offers as shown: in stock first, then lowest price.
export function sortOffers(offers) {
  return [...(offers || [])].sort((a, b) => (a.outOfStock === true) - (b.outOfStock === true) || a.price - b.price);
}

// What a Wish List row says about a save (pure).
//   state: 'unchecked' | 'found' | 'none' (no prices found) | 'unsure' (couldn't tell which product)
//   best: the lowest offer in stock; saving / savingPct: how far it is below the price you saved it at
//   (null when the save has no price, the currencies differ, or it isn't lower).
export function dealSummary(item, now = Date.now()) {
  const deals = item?.deals || null;
  if (!deals) return { state: 'unchecked', offers: [], best: null, saving: null, savingPct: null, checkedAt: null, old: false };
  const offers = sortOffers(deals.offers);
  const best = offers.find((o) => !o.outOfStock) || null;
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

// An offer after reading the store's own page (pure). The page's published price wins and marks the offer
// confirmed; a page with no price, another currency, or a price so low it must be another item leaves the
// search result's price as it was, unconfirmed.
export function confirmOffer(offer, page, saved = null) {
  const out = { ...offer, confirmed: false };
  if (!page) return out;
  if (page.availability === 'out_of_stock') out.outOfStock = true;
  const price = Number(page.price);
  if (!Number.isFinite(price) || price <= 0) return out;
  if (page.currency && offer.currency && page.currency !== offer.currency) return out;
  if (saved !== null && price < saved * DEAL_FLOOR) return out;
  // A page that prices several variants, or a page price well under the search result's, is most likely
  // the cheapest variant's "from" price: not this item's, so nothing is confirmed.
  if (page.priceVaries || price < offer.price * CONFIRM_FLOOR) return out;
  return { ...out, price: Math.round(price * 100) / 100, currency: offer.currency || page.currency || '', confirmed: true };
}

// What the provider is told about the product (pure).
export function dealsInput(item, { region = '', today = '' } = {}) {
  const d = kindOf(item) === 'product' ? item.details || {} : {};
  const social = item.type === 'instagram' || isSocialHost(item.host || hostnameOf(item.url || ''));
  const saved = Number.isFinite(item.price) && item.price > 0 ? item.price : null;
  return {
    title: item.title || '', listing: d.shopTitle || '', brand: d.brand || '', model: d.model || '',
    specs: (d.specs || []).filter((s) => /^(colou?r|size|capacity|storage|style|edition|version|material)$/i.test(s.label || '')),
    // amount (what offers are measured against) only with its currency: a bare number can't be compared.
    price: saved !== null ? formatPrice(saved, item.currency) : '', amount: item.currency ? saved : null, currency: item.currency || '',
    retailer: d.shopName || (social ? '' : item.retailer || ''), url: d.shopUrl || (social ? '' : item.url || ''),
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
  const found = await findDealsWithAI(input, settings, key);
  const sure = found.confidence >= DEALS_CONFIDENCE;
  const offers = sure ? await Promise.all(found.offers.map(async (o) => {
    let page = null;
    try {
      const html = await fetchShopPage(o.url);
      page = html ? productFromHtml(html, o.url) : null;
    } catch {
      /* unreadable: the search result's price stands, unconfirmed */
    }
    return confirmOffer(o, page, input.amount);
  })) : [];
  const deals = {
    checkedAt: at.toISOString(), product: found.product, offers: sortOffers(offers),
    empty: offers.length ? '' : sure ? 'none' : 'unsure', provider: found.provider, model: found.model, usage: found.usage,
  };
  // by 'deals': not an edit of yours, so no field is marked as hand-edited.
  const next = await store.updateItem(id, { deals }, { by: 'deals' });
  return { item: next, summary: dealSummary(next, at.getTime()) };
}

// Take saves off the Wish List, or put them back. Their deals stay.
export async function setWishHidden(store, ids, hidden) {
  for (const id of ids) await store.updateItem(id, { wishHidden: !!hidden }, { by: 'deals' });
}

