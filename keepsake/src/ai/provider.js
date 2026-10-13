// Optional AI provider boundary. Disabled by default. Everything in the
// extension — saving, categorization, dashboard, Instagram import — works
// without this module ever being called.
//
// When the user enables it (and supplies their own API key), only these can
// be sent to the provider they chose:
//   1. "Find products in Instagram saves": the selected post's thumbnail
//      (as an image) and its caption/creator text.
//   2. Instant save: the product's title, price,
//      description, retailer and the list of the user's collection names.
//   3. "Clean up with AI": the same fields for each item being checked, plus
//      the title/price/availability read from its live product page.
// Nothing else leaves the browser: no cookies, no account data, no history.

export const PROVIDERS = {
  openai: { label: 'OpenAI (chat completions)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic (Messages API)', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },
  custom: { label: 'Custom OpenAI-compatible endpoint', baseUrl: '', model: '' },
};

export function providerConfig(settings) {
  const ai = settings?.ai || {};
  const base = PROVIDERS[ai.provider] || PROVIDERS.openai;
  return {
    provider: ai.provider || 'openai',
    baseUrl: (ai.baseUrl || base.baseUrl || '').replace(/\/+$/, ''),
    model: ai.model || base.model,
  };
}

export function originFor(settings) {
  const cfg = providerConfig(settings);
  try {
    const u = new URL(cfg.baseUrl);
    if (u.protocol !== 'https:') return '';
    return `${u.origin}/*`;
  } catch {
    return '';
  }
}

// What exactly will be sent, so the UI can show it before the user confirms.
export function describePayload(post) {
  return {
    image: post.thumbnail ? (post.thumbnail.startsWith('data:') ? 'Locally stored thumbnail (JPEG, ≤320px)' : post.thumbnail) : 'No image',
    text: [post.caption ? `Caption: ${post.caption}` : '', post.creator ? `Creator: ${post.creator}` : '', post.instagram?.collectionName || post.collectionName ? `Collection: ${post.instagram?.collectionName || post.collectionName}` : ''].filter(Boolean).join('\n') || 'No text',
  };
}

async function callProvider(cfg, apiKey, { system, userText, imageDataUrl, maxTokens = 600 }) {
  if (!apiKey) throw new Error('Add your API key in Settings → Optional AI first.');
  if (!cfg.baseUrl) throw new Error('Set the provider base URL first.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    if (cfg.provider === 'anthropic') {
      const content = [];
      if (imageDataUrl) {
        const m = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
        if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      }
      content.push({ type: 'text', text: userText });
      const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
      });
      const data = await readJson(res);
      return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    }
    // OpenAI-compatible chat completions
    const content = [{ type: 'text', text: userText }];
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
    });
    const data = await readJson(res);
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  const textBody = await res.text();
  let data = null;
  try {
    data = JSON.parse(textBody);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || textBody.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`Provider error (${res.status}): ${msg}`);
  }
  if (!data) throw new Error('Provider returned a non-JSON response.');
  return data;
}

function parseJsonBlock(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const candidates = [cleaned.slice(start), cleaned.slice(start, cleaned.lastIndexOf('}') + 1), cleaned.slice(start, cleaned.lastIndexOf(']') + 1)];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
  }
  return null;
}

// Only data: URLs are sent as images. Remote thumbnail URLs are not forwarded,
// because the provider would then fetch from Instagram on the user's behalf.
function imageFor(post) {
  return post.thumbnail && post.thumbnail.startsWith('data:image/') ? post.thumbnail : '';
}

export async function analyzePost(post, settings, apiKey) {
  const cfg = providerConfig(settings);
  const payload = describePayload(post);
  const system = 'You help someone identify what product is shown in a social media post they saved. Respond ONLY with a JSON object: {"suggestions":[{"name":"short likely item name","category":"broad product category","brand":"brand or empty string","searchPhrases":["2-4 search phrases"],"note":"one short caveat"}]}. Give 1-3 suggestions. Do not invent purchase links. If unsure, say so in note and keep the name generic.';
  const raw = await callProvider(cfg, apiKey, { system, userText: payload.text, imageDataUrl: imageFor(post), maxTokens: 500 });
  const parsed = parseJsonBlock(raw);
  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : Array.isArray(parsed) ? parsed : [];
  if (!suggestions.length) throw new Error('The provider did not return usable suggestions.');
  return {
    provider: cfg.provider, model: cfg.model, analyzedAt: new Date().toISOString(),
    suggestions: suggestions.slice(0, 3).map((s) => ({
      name: String(s.name || '').slice(0, 120),
      category: String(s.category || '').slice(0, 60),
      brand: String(s.brand || '').slice(0, 60),
      searchPhrases: (Array.isArray(s.searchPhrases) ? s.searchPhrases : []).map((p) => String(p).slice(0, 100)).slice(0, 4),
      note: String(s.note || '').slice(0, 200),
    })),
  };
}

// --- "Find online": identify + web-search for where to buy -------------------------------------
// Uses the provider's own web-search tool (Anthropic Messages API web_search,
// OpenAI Responses API web_search). Every URL in the result is checked
// against the URLs the search actually returned; anything else is dropped, so
// Keepsake never shows a link the model made up.

export function supportsWebLookup(settings) {
  const p = providerConfig(settings).provider;
  return p === 'openai' || p === 'anthropic';
}

const FIND_SYSTEM = 'You help someone find where to buy the product shown in a social media post they saved. First decide what the product most likely is, then use web search (at most 3 searches) to find real listings. Respond ONLY with a JSON object: {"candidates":[{"name":"product name","brand":"brand or empty","retailer":"store name","price":number or null,"currency":"ISO code or empty","url":"exact URL of a listing you found via search, or empty","confidence":0-1,"note":"one short caveat"}]}. Give 1-4 candidates, best first. Only use URLs that appeared in search results. If you cannot identify the product, return an empty candidates list.';

async function findViaAnthropic(cfg, apiKey, userText, imageDataUrl, controller) {
  const content = [];
  if (imageDataUrl) {
    const m = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: userText });
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: cfg.model, max_tokens: 1200, system: FIND_SYSTEM, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], messages: [{ role: 'user', content }] }),
  });
  const data = await readJson(res);
  const seen = new Set();
  let text = '';
  for (const block of data.content || []) {
    if (block.type === 'text') {
      text += block.text || '';
      for (const c of block.citations || []) if (c.url) seen.add(c.url);
    } else if (block.type === 'web_search_tool_result') {
      for (const r of Array.isArray(block.content) ? block.content : []) if (r && r.url) seen.add(r.url);
    }
  }
  return { text, seen };
}

async function findViaOpenAI(cfg, apiKey, userText, imageDataUrl, controller) {
  const content = [{ type: 'input_text', text: userText }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl, detail: 'low' });
  const res = await fetch(`${cfg.baseUrl}/responses`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: cfg.model, instructions: FIND_SYSTEM, tools: [{ type: 'web_search_preview' }], input: [{ role: 'user', content }], max_output_tokens: 1200 }),
  });
  const data = await readJson(res);
  const seen = new Set();
  let text = '';
  for (const out of data.output || []) {
    if (out.type !== 'message') continue;
    for (const c of out.content || []) {
      if (c.type === 'output_text') {
        text += c.text || '';
        for (const a of c.annotations || []) if (a.url) seen.add(a.url);
      }
    }
  }
  if (!text && typeof data.output_text === 'string') text = data.output_text;
  return { text, seen };
}

function urlVerified(url, seen) {
  if (!url) return false;
  if (seen.has(url)) return true;
  try {
    const u = new URL(url);
    for (const s of seen) {
      try {
        const v = new URL(s);
        if (v.hostname === u.hostname && v.pathname.replace(/\/$/, '') === u.pathname.replace(/\/$/, '')) return true;
      } catch {
        /* skip */
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function findProductOnline(post, settings, apiKey) {
  const cfg = providerConfig(settings);
  if (!apiKey) throw new Error('Add your API key in Settings → Optional AI first.');
  if (!supportsWebLookup(settings)) throw new Error('Web lookup needs OpenAI or Anthropic (custom endpoints have no search tool).');
  const payload = describePayload(post);
  const userText = `${payload.text}\n\nIdentify the product in this post and find real listings for it.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const { text, seen } = cfg.provider === 'anthropic'
      ? await findViaAnthropic(cfg, apiKey, userText, imageFor(post), controller)
      : await findViaOpenAI(cfg, apiKey, userText, imageFor(post), controller);
    const parsed = parseJsonBlock(text);
    const list = Array.isArray(parsed?.candidates) ? parsed.candidates : Array.isArray(parsed) ? parsed : [];
    const candidates = list.slice(0, 4).map((c) => {
      const url = typeof c.url === 'string' ? c.url.trim() : '';
      const verified = urlVerified(url, seen);
      return {
        name: String(c.name || '').slice(0, 160), brand: String(c.brand || '').slice(0, 60), retailer: String(c.retailer || '').slice(0, 80),
        price: Number.isFinite(Number(c.price)) && c.price !== null && c.price !== '' ? Number(c.price) : null,
        currency: String(c.currency || '').slice(0, 8), url: verified ? url : '', verified,
        confidence: Number.isFinite(Number(c.confidence)) ? Math.max(0, Math.min(1, Number(c.confidence))) : null,
        note: String(c.note || '').slice(0, 200) + (url && !verified ? ' (link not in search results — dropped)' : ''),
      };
    }).filter((c) => c.name);
    return { provider: cfg.provider, model: cfg.model, searchedAt: new Date().toISOString(), candidates, searchedUrls: [...seen].slice(0, 20) };
  } finally {
    clearTimeout(timer);
  }
}

// --- Cleanup: tidy titles, confirm prices, pick collections --------------------------------------
// One request handles a batch of items. The model may only choose a price
// that already appears in the item's stored or live-page data, and only an
// existing collection name; anything else is dropped here, so it can tidy
// and sort but never invent a price or a collection.

export const CLEANUP_BATCH = 8;

const CLEANUP_SYSTEM = `You tidy up a shopper's saved products and file them into their existing collections.
For each item you get the saved fields and, when available, "live" fields read from the product page today.
Return ONLY JSON: {"items":[{"ref":"…","title":"…","price":number|null,"currency":"ISO code or empty","collection":"exact collection name or null","confidence":0-1,"reason":"short"}]}
Rules:
- title: a clean, specific product name a shopper would recognise. Keep brand, model, size, colour and edition. Remove store names, SEO filler, "Buy now", "Free shipping", promo text, pipes and site suffixes. Never add facts that are not in the input. If the saved title is already good, return it unchanged.
- price: the product's current selling price. It MUST be one of the numbers given for that item (saved price, live price or live price candidates); prefer the live price. Use null if none is trustworthy (for example a unit price, a monthly instalment or a shipping fee).
- collection: the single best collection from the list, or null when none fits. confidence is how sure you are of the collection (0.9+ only when it clearly belongs).
- Return one entry per input ref, in any order.`;

function priceOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// entries: [{ ref, item: {title, price, currency, retailer, host, description, type, breadcrumbs}, currentCollection, live: {title, price, currency, availability, priceCandidates} | null }]
export async function cleanupWithAI(entries, collections, settings, apiKey) {
  const cfg = providerConfig(settings);
  const names = collections.map((c) => c.name);
  const payload = entries.map((e) => {
    const it = e.item || {};
    const out = {
      ref: e.ref,
      saved: {
        title: String(it.title || '').slice(0, 200),
        price: priceOrNull(it.price),
        currency: it.currency || '',
        retailer: it.retailer || it.host || '',
        description: String(it.description || '').slice(0, 300),
      },
    };
    if (it.breadcrumbs && it.breadcrumbs.length) out.saved.breadcrumbs = it.breadcrumbs.slice(0, 6).join(' > ');
    if (it.productType) out.saved.storeProductType = String(it.productType).slice(0, 80);
    if (e.currentCollection) out.currentCollection = e.currentCollection;
    if (e.live) {
      out.live = {
        title: String(e.live.title || '').slice(0, 200),
        price: priceOrNull(e.live.price),
        currency: e.live.currency || '',
        availability: e.live.availability || '',
        priceCandidates: (e.live.priceCandidates || []).map(priceOrNull).filter((n) => n !== null).slice(0, 6),
      };
    }
    return out;
  });
  const userText = `Collections: ${JSON.stringify(names)}\n\nItems:\n${JSON.stringify(payload)}`;
  const raw = await callProvider(cfg, apiKey, { system: CLEANUP_SYSTEM, userText, maxTokens: 220 * entries.length + 100 });
  const parsed = parseJsonBlock(raw);
  const list = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  const byRef = new Map(payload.map((p) => [p.ref, p]));
  const out = new Map();
  for (const r of list) {
    const src = r && byRef.get(String(r.ref));
    if (!src) continue;
    const allowed = [src.saved.price, src.live?.price, ...(src.live?.priceCandidates || [])].filter((n) => n !== null);
    const price = priceOrNull(r.price);
    const priceOk = price !== null && allowed.some((a) => Math.abs(a - price) < 0.005);
    const match = collections.find((c) => c.name.toLowerCase() === String(r.collection || '').toLowerCase()) || null;
    const title = typeof r.title === 'string' ? r.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    out.set(src.ref, {
      title: title.length >= 3 ? title : '',
      price: priceOk ? price : null,
      currency: priceOk ? String(r.currency || src.live?.currency || src.saved.currency || '').toUpperCase().slice(0, 8) : '',
      collectionId: match ? match.id : null,
      collectionName: match ? match.name : '',
      confidence: match ? Math.max(0, Math.min(1, Number(r.confidence) || 0)) : 0,
      reason: String(r.reason || '').slice(0, 200),
    });
  }
  return out;
}

// --- Draft a recipe (only when the person asks, from a saved dish with no written recipe) -------
// The result is a labelled suggestion: the person reviews it in the editor before anything is kept.
const RECIPE_SYSTEM = `Someone saved a dish they liked and asked you to draft a recipe for it.
Return ONLY JSON: {"ingredients":["quantity + ingredient", …],"steps":["one step", …],"yield":"e.g. 2 servings","totalMinutes":number|null,"note":"one short caveat"}
Rules: base it on the title, caption and description given; keep it to a home-cook version (6-15 ingredients, 3-10 steps); use metric and US quantities only if the input does; never claim it is the creator's exact recipe.`;

export async function draftRecipe(item, settings, apiKey) {
  const cfg = providerConfig(settings);
  const text = [
    `Title: ${String(item.title || '').slice(0, 200)}`,
    item.instagram?.caption ? `Caption: ${String(item.instagram.caption).slice(0, 1500)}` : '',
    item.description ? `Description: ${String(item.description).slice(0, 800)}` : '',
    item.retailer || item.host ? `From: ${item.retailer || item.host}` : '',
  ].filter(Boolean).join('\n');
  const raw = await callProvider(cfg, apiKey, { system: RECIPE_SYSTEM, userText: text, maxTokens: 900 });
  const parsed = parseJsonBlock(raw);
  if (!parsed || !Array.isArray(parsed.ingredients) || !parsed.ingredients.length) throw new Error('The provider didn’t return a usable recipe.');
  return {
    ingredients: parsed.ingredients.map((x) => String(x).slice(0, 200)).slice(0, 40),
    steps: (Array.isArray(parsed.steps) ? parsed.steps : []).map((x) => String(x).slice(0, 600)).slice(0, 30),
    yield: String(parsed.yield || '').slice(0, 60),
    totalMinutes: Number.isFinite(Number(parsed.totalMinutes)) && Number(parsed.totalMinutes) > 0 ? Math.round(Number(parsed.totalMinutes)) : null,
    note: String(parsed.note || '').slice(0, 200),
    source: 'ai-draft',
  };
}

const PROGRESSION_SYSTEM = `You plan gentle, safe training progressions for a home workout app. Only on the person's request.
Return ONLY JSON: {"plan":[{"week":1,"perWeek":number|null,"sets":number|null,"reps":number|null,"durationSeconds":number|null,"note":"short"}, …],"note":"one short caveat"}
Rules: one entry per week; for a frequency goal set perWeek (never above the goal's) and leave sets/reps empty unless useful; for a target goal build sets and reps (or seconds) up to the target by the last week, in small steps, starting near the person's best so far; never more than 10% harder week to week; no medical claims.`;

// A week-by-week plan for a workout goal. Sends the workout's title, its exercises and the goal's
// numbers (and best result so far), nothing else. The person previews it and accepts or dismisses it.
export async function suggestProgression(item, goal, progress, settings, apiKey) {
  const cfg = providerConfig(settings);
  const ex = (item.details?.exercises || []).slice(0, 20).map((e) => `- ${e.name}${e.sets ? ` ${e.sets} sets` : ''}${e.reps ? ` × ${e.reps}` : ''}${e.durationSeconds ? ` × ${e.durationSeconds}s` : ''}`).join('\n');
  const s = goal.spec || {};
  const weeks = goal.kind === 'frequency' ? s.weeks : Math.max(2, Math.min(12, Number(s.weeks) || 6));
  const text = [
    `Workout: ${String(item.title || '').slice(0, 200)}`,
    ex ? `Exercises:\n${ex}` : '',
    goal.kind === 'frequency' ? `Goal: do it ${s.perWeek} times a week for ${s.weeks} weeks.` : `Goal: reach ${s.sets} sets of ${s.durationSeconds ? `${s.durationSeconds} seconds` : `${s.reps} reps`} of ${s.exercise}. Plan ${weeks} weeks.`,
    progress?.best ? `Best so far: ${progress.best.result.sets || 1} sets of ${progress.best.result.durationSeconds ? `${progress.best.result.durationSeconds} seconds` : `${progress.best.result.reps} reps`}.` : '',
    progress?.weekNumber ? `They are in week ${progress.weekNumber}.` : '',
  ].filter(Boolean).join('\n');
  const raw = await callProvider(cfg, apiKey, { system: PROGRESSION_SYSTEM, userText: text, maxTokens: 700 });
  const parsed = parseJsonBlock(raw);
  const num = (v, max) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= max ? Math.round(Number(v)) : null);
  const plan = (Array.isArray(parsed?.plan) ? parsed.plan : []).slice(0, weeks).map((p, i) => ({
    week: num(p?.week, 52) || i + 1,
    perWeek: goal.kind === 'frequency' ? Math.min(num(p?.perWeek, 14) || s.perWeek, s.perWeek) : null,
    sets: num(p?.sets, 20), reps: num(p?.reps, 500), durationSeconds: num(p?.durationSeconds, 36000),
    note: String(p?.note || '').slice(0, 160),
  })).filter((p) => p.perWeek || p.sets || p.reps || p.durationSeconds);
  if (!plan.length) throw new Error('The provider didn’t return a usable plan.');
  return { plan, note: String(parsed?.note || '').slice(0, 200) };
}

const IDENTIFY_SYSTEM = {
  place: 'From this saved post, name the one place it is about. Return ONLY JSON: {"name":"the place\'s own name or null","city":"city or neighbourhood or null"}. Use only what the text says; if it does not name a place, return {"name":null}.',
  media: 'From this saved post, name the one film or TV show it is about. Return ONLY JSON: {"title":"the official title or null","year":number|null,"format":"film"|"series"|null}. Use only what the text says or clearly refers to; if unsure, return {"title":null}.',
  book: 'From this saved post, name the one book it is about. Return ONLY JSON: {"title":"the book\'s title or null","author":"author or null"}. Use only what the text says; if unsure, return {"title":null}.',
  workout: 'From this saved post, list the exercises it describes. Return ONLY JSON: {"exercises":[{"name":"exercise","sets":number|null,"reps":number|null,"seconds":number|null}],"minutes":number|null}. Use only what the text says; if it lists no exercises, return {"exercises":[]}.',
};

// Asks your AI provider what a saved post is about, for the kind you put it in (a place's name and city,
// a film's title, a book's title and author, a workout's exercises). Sends the save's title, caption or
// description and site; returns null when the text doesn't say.
export async function identifyForKind(kind, item, settings, apiKey) {
  const system = IDENTIFY_SYSTEM[kind];
  if (!system) return null;
  const cfg = providerConfig(settings);
  const text = [
    `Title: ${String(item.title || '').slice(0, 200)}`,
    item.instagram?.caption ? `Caption: ${String(item.instagram.caption).slice(0, 1500)}` : '',
    item.description ? `Description: ${String(item.description).slice(0, 1200)}` : '',
    item.retailer || item.host ? `From: ${item.retailer || item.host}` : '',
  ].filter(Boolean).join('\n');
  const parsed = parseJsonBlock(await callProvider(cfg, apiKey, { system, userText: text, maxTokens: 500 }));
  if (!parsed || typeof parsed !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, n) : '');
  if (kind === 'place') return s(parsed.name, 120) ? { name: s(parsed.name, 120), locality: s(parsed.city, 80) } : null;
  if (kind === 'media') return s(parsed.title, 200) ? { title: s(parsed.title, 200), year: Number(parsed.year) || null, format: parsed.format === 'series' ? 'series' : parsed.format === 'film' ? 'film' : '' } : null;
  if (kind === 'book') return s(parsed.title, 200) ? { title: s(parsed.title, 200), author: s(parsed.author, 120) } : null;
  if (kind === 'workout') {
    const exercises = (Array.isArray(parsed.exercises) ? parsed.exercises : []).slice(0, 30).map((e) => ({ name: s(e?.name, 60), sets: Number(e?.sets) || null, reps: Number(e?.reps) || null, durationSeconds: Number(e?.seconds) || null })).filter((e) => e.name);
    return exercises.length ? { exercises, durationMinutes: Number(parsed.minutes) || null } : null;
  }
  return null;
}

export async function testConnection(settings, apiKey) {
  const cfg = providerConfig(settings);
  const raw = await callProvider(cfg, apiKey, { system: 'Reply with the single word OK.', userText: 'Connection test.', maxTokens: 5 });
  return String(raw || '').trim().slice(0, 40);
}
