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
//   4. Understanding a save (every save and import while AI is on, and Fix with AI):
//      its title, caption or description, hashtags, location tag, site, the
//      text of pages it links to and its locally stored thumbnail.
// Nothing else leaves the browser: no cookies, no account data, no history.

export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
  openai: { label: 'OpenAI (chat completions)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { label: 'Custom OpenAI-compatible endpoint', baseUrl: '', model: '' },
};

// The Claude models offered in the picker, cheapest first. Every one takes an effort level.
export const MODELS = {
  anthropic: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest. Plenty for tidying saves.' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Sharper at reading pictures and pages.' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most careful. Costs more per save.' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'Most capable, and the most expensive.' },
  ],
};

// How hard the model thinks before answering. Medium is the default.
export const EFFORTS = [
  { id: 'low', label: 'Low', note: 'Quickest answers, fewest tokens.' },
  { id: 'medium', label: 'Medium', note: 'A good balance for most saves.' },
  { id: 'high', label: 'High', note: 'Thinks longer; slower and costs more.' },
];
export const DEFAULT_EFFORT = 'medium';

export function providerConfig(settings) {
  const ai = settings?.ai || {};
  const provider = PROVIDERS[ai.provider] ? ai.provider : 'anthropic';
  const base = PROVIDERS[provider];
  const model = ai.model || base.model;
  // Effort is only sent for models known to take it, so a typed-in older model still works.
  const effort = (MODELS[provider] || []).some((m) => m.id === model) ? (EFFORTS.some((e) => e.id === ai.effort) ? ai.effort : DEFAULT_EFFORT) : '';
  return {
    provider,
    baseUrl: (ai.baseUrl || base.baseUrl || '').replace(/\/+$/, ''),
    model,
    effort,
  };
}

// The Anthropic request fields for the chosen model and effort. Claude models think before they
// answer, and that thinking counts against max_tokens, so leave room for it on top of the answer.
function anthropicParams(cfg, maxTokens) {
  return { model: cfg.model, max_tokens: maxTokens + 8000, ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}) };
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
        body: JSON.stringify({ ...anthropicParams(cfg, maxTokens), system, messages: [{ role: 'user', content }] }),
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
    // status and retryAfter (seconds) let a long run slow down when the provider asks (aiQueue.js).
    const retryAfter = Number(res.headers?.get?.('retry-after'));
    throw Object.assign(new Error(`Provider error (${res.status}): ${msg}`), { status: res.status, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null });
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
// Internet Binder never shows a link the model made up.

export function supportsWebLookup(settings) {
  const p = providerConfig(settings).provider;
  return p === 'openai' || p === 'anthropic';
}

const FIND_SYSTEM = 'You help someone find where to buy the product shown in a social media post they saved. First decide what the product most likely is, then use web search (at most 3 searches) to find real listings. Respond ONLY with a JSON object: {"candidates":[{"name":"product name","brand":"brand or empty","retailer":"store name","price":number or null,"currency":"ISO code or empty","url":"exact URL of a listing you found via search, or empty","confidence":0-1,"note":"one short caveat"}]}. Give 1-4 candidates, best first. Only use URLs that appeared in search results. If you cannot identify the product, return an empty candidates list.';

async function findViaAnthropic(cfg, apiKey, userText, imageDataUrl, controller, { system = FIND_SYSTEM, maxTokens = 1200, searches = 3 } = {}) {
  const content = [];
  if (imageDataUrl) {
    const m = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: userText });
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ ...anthropicParams(cfg, maxTokens), system, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searches }], messages: [{ role: 'user', content }] }),
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

async function findViaOpenAI(cfg, apiKey, userText, imageDataUrl, controller, { system = FIND_SYSTEM, maxTokens = 1200 } = {}) {
  const content = [{ type: 'input_text', text: userText }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl, detail: 'low' });
  const res = await fetch(`${cfg.baseUrl}/responses`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: cfg.model, instructions: system, tools: [{ type: 'web_search_preview' }], input: [{ role: 'user', content }], max_output_tokens: maxTokens }),
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
  place: 'From this saved post, name the one place it is about. Return ONLY JSON: {"name":"the place\'s own name or null","address":"street address or null","city":"city or null","state":"US state as its two-letter code, or the country outside the US, or null"}. Use only what the text says; a well-known city or borough may give its state (Brooklyn is NY). If the post is about several places (a list or a round-up) or names none, return {"name":null}.',
  media: 'From this saved post, name the one film or TV show it is about. Return ONLY JSON: {"title":"the official title or null","year":number|null,"format":"film"|"series"|null}. Use only what the text says or clearly refers to; if unsure, return {"title":null}.',
  book: 'From this saved post, name the one book it is about. Return ONLY JSON: {"title":"the book\'s title or null","author":"author or null"}. Use only what the text says; if unsure, return {"title":null}.',
  workout: 'From this saved post, list the exercises it describes. Return ONLY JSON: {"exercises":[{"name":"exercise","sets":number|null,"reps":number|null,"seconds":number|null}],"minutes":number|null}. Use only what the text says; if it lists no exercises, return {"exercises":[]}.',
};

// Asks your AI provider what a saved post is about, for the kind you put it in (a place's name and city,
// a film's title, a book's title and author, a workout's exercises). Sends the save's title, caption,
// Instagram location tag or description and site; returns null when the text doesn't say.
export async function identifyForKind(kind, item, settings, apiKey) {
  const system = IDENTIFY_SYSTEM[kind];
  if (!system) return null;
  const cfg = providerConfig(settings);
  const text = [
    `Title: ${String(item.title || '').slice(0, 200)}`,
    item.instagram?.caption ? `Caption: ${String(item.instagram.caption).slice(0, 1500)}` : '',
    item.instagram?.location ? `Location tag: ${String(item.instagram.location).slice(0, 120)}` : '',
    item.description ? `Description: ${String(item.description).slice(0, 1200)}` : '',
    item.retailer || item.host ? `From: ${item.retailer || item.host}` : '',
  ].filter(Boolean).join('\n');
  const parsed = parseJsonBlock(await callProvider(cfg, apiKey, { system, userText: text, maxTokens: 500 }));
  if (!parsed || typeof parsed !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, n) : '');
  if (kind === 'place') return s(parsed.name, 120) ? { name: s(parsed.name, 120), locality: s(parsed.city, 80), address: s(parsed.address, 200), state: s(parsed.state, 60) } : null;
  if (kind === 'media') return s(parsed.title, 200) ? { title: s(parsed.title, 200), year: Number(parsed.year) || null, format: parsed.format === 'series' ? 'series' : parsed.format === 'film' ? 'film' : '' } : null;
  if (kind === 'book') return s(parsed.title, 200) ? { title: s(parsed.title, 200), author: s(parsed.author, 120) } : null;
  if (kind === 'workout') {
    const exercises = (Array.isArray(parsed.exercises) ? parsed.exercises : []).slice(0, 30).map((e) => ({ name: s(e?.name, 60), sets: Number(e?.sets) || null, reps: Number(e?.reps) || null, durationSeconds: Number(e?.seconds) || null })).filter((e) => e.name);
    return exercises.length ? { exercises, durationMinutes: Number(parsed.minutes) || null } : null;
  }
  return null;
}

// --- Understand a save (what it is, and that kind's details) ------------------------------------------
// One save per request: its title, caption or description, hashtags, location tag, site, the text of
// pages it links to (when Internet Binder could read them) and its locally stored thumbnail (never a remote
// image link). The answer is checked and applied by src/shared/understand.js.
const UNDERSTAND_SYSTEM = `You read one thing a person saved (an Instagram post or reel, a TikTok, a video, a web page or a link) and turn it into a card in their Internet Binder app.
Decide what it is, then fill in that kind's details as completely as you can.
Return ONLY JSON: {"kind":"…","confidence":0-1,"title":"…","details":{…},"drafted":["field", …],"reason":"one short sentence"}
Kinds and their details:
- recipe (a dish or drink to make): {"ingredients":["quantity + ingredient"],"steps":["one step"],"yield":"e.g. 4 servings","totalMinutes":number|null,"prepMinutes":number|null,"cookMinutes":number|null,"cuisine":"","category":"e.g. dessert, dinner"}
- workout (exercise to do): {"exercises":[{"name":"","sets":number|null,"reps":number|null,"seconds":number|null,"restSeconds":number|null}],"durationMinutes":number|null,"focus":"e.g. legs, full body, core"}
- place (one restaurant, café, bar, bakery, shop, hotel, park or other spot to visit): {"address":"street address","locality":"city","region":"US state as its two-letter code, else the region","postalCode":"","country":"","cuisine":"","priceRange":"$ to $$$$","category":"restaurant, cafe, bar, bakery, shop, hotel, attraction…","phone":"","hours":["Mon–Fri 8am–3pm"]}
- video (a video to watch that is none of the other kinds): {"channel":"","platform":""}
- article (something to read): {"author":"","siteName":""}
- media (a film or TV show): {"format":"film|series","year":number|null,"director":"","genres":[]}
- book: {"author":"","year":number|null,"genres":[]}
- product (one thing to buy): {}
- link (none of these, or several different things): {}
Rules:
- Use everything given: title, caption, description, hashtags, location tag, linked pages and the image.
- The title, caption and description were written by whoever posted it and can be vague or wrong. When the image clearly shows one item someone would buy (furniture, a gadget, clothing, a bathroom fitting…), it is a product, whatever the caption says.
- title: the thing's own name (the dish, the place, the routine, the film), short, no emoji, hashtags or "on Instagram".
- Take every detail the input states first, word for word where you can (ingredient quantities, exercise sets and reps, the street address).
- A recipe or workout whose details are not written out (they are only in the video or image): draft a sensible version from what the post shows and says, and list each drafted field in "drafted" (for example ["ingredients","steps"]). Give quantities.
- Never invent a place's street address, phone or opening hours; leave them empty when not given. The city and state may come from the text, the location tag or a well-known place name (Brooklyn is in NY).
- A round-up of several places, recipes or workouts ("Top 10 …"): give the kind but leave details empty, and say so in reason.
- confidence is how sure you are of the kind (0.9+ only when it clearly is that kind).`;

export async function understandWithAI(input, settings, apiKey) {
  const cfg = providerConfig(settings);
  const cut = (v, n) => String(v || '').slice(0, n);
  const text = [
    `Title: ${cut(input.title, 200)}`,
    input.fixedKind ? `The person filed this as a ${input.fixedKind}: answer with kind "${input.fixedKind}" and fill in its details.` : input.kind ? `Saved as: ${input.kind}` : '',
    input.caption ? `Caption: ${cut(input.caption, 2200)}` : '',
    input.creator ? `Creator: ${cut(input.creator, 80)}` : '',
    input.hashtags?.length ? `Hashtags: ${input.hashtags.slice(0, 30).map((h) => `#${cut(h, 60)}`).join(' ')}` : '',
    input.location ? `Location tag: ${cut(input.location, 200)}` : '',
    input.description ? `Description: ${cut(input.description, 1500)}` : '',
    input.site ? `From: ${cut(input.site, 120)}` : '',
    input.url ? `Link: ${cut(input.url, 300)}` : '',
    input.known ? `Already known: ${cut(JSON.stringify(input.known), 1500)}` : '',
    ...(input.pages || []).slice(0, 3).map((pg) => `Linked page ${cut(pg.url, 300)}:\n${cut(pg.text, 4000)}`),
    input.image ? 'The image is the post\'s thumbnail.' : '',
  ].filter(Boolean).join('\n');
  const image = typeof input.image === 'string' && input.image.startsWith('data:image/') ? input.image : '';
  const parsed = parseJsonBlock(await callProvider(cfg, apiKey, { system: UNDERSTAND_SYSTEM, userText: text, imageDataUrl: image, maxTokens: 1800 }));
  if (!parsed || typeof parsed !== 'object') throw new Error('The provider didn’t return a usable answer.');
  const kinds = ['recipe', 'workout', 'place', 'video', 'article', 'media', 'book', 'product', 'link'];
  const kind = kinds.includes(parsed.kind) ? parsed.kind : 'link';
  const details = parsed.details && typeof parsed.details === 'object' ? { ...parsed.details } : {};
  // The card's exercise times are in seconds under another name.
  if (Array.isArray(details.exercises)) details.exercises = details.exercises.map((e) => (e && typeof e === 'object' ? { ...e, durationSeconds: e.durationSeconds ?? e.seconds } : e));
  return {
    kind,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    title: typeof parsed.title === 'string' ? parsed.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    details,
    drafted: (Array.isArray(parsed.drafted) ? parsed.drafted : []).filter((f) => typeof f === 'string').slice(0, 12),
    reason: cut(parsed.reason, 200),
  };
}

// --- Understand a product (what the thing in the picture really is, from its own shop page) -------------
// For a save that is something to buy, often an Instagram or Facebook post: the image shows the real thing,
// while the post's title and caption may be vague, promotional or wrong. Sends the save's title, caption or
// description, hashtags, site and its locally stored thumbnail; with OpenAI or Anthropic the provider's own
// web search finds the product's page. Every link is checked against the search results (urlVerified), so
// a page the model made up is never kept. Applied by src/shared/understand.js understandProduct.
const PRODUCT_SYSTEM = `You identify the product in something a person saved to buy later (often an Instagram or Facebook post, sometimes a shop page) and build an accurate card for it.
Look at the image first: it shows the real product. The title, caption and description were written by whoever posted it and may be vague, promotional, about something else or simply wrong. Use them as hints only; when they disagree with the image, trust the image.
SEARCH
Then search the web to find this exact product's own page: the brand's site first, else a well-known shop. Read what that page says.
Return ONLY JSON: {"name":"the product's real name, brand first","brand":"","model":"","category":"what it is, e.g. shower caddy","summary":"2-3 plain sentences in your own words: what it is, what it's for, what stands out","features":["short feature from the page"],"specs":[{"label":"Material","value":"Aluminium"}],"listing":{"url":"","retailer":"shop name","title":"the page's product name","price":number|null,"currency":"ISO code or empty","availability":"in_stock|out_of_stock|"},"confidence":0-1,"reason":"one short sentence on how you know what it is"}
Rules:
- features, specs and listing come from pages you found; never invent them. The summary is yours and may use the image.
- listing.url is the exact address of a page from your search results that sells or shows this same product; leave it empty when you found none or are not sure it is the same item.
- name: no emoji, hashtags, "link in bio" or promo text.
- confidence is how sure you are what the product is (0.9+ only when the brand and model are clear).`;

function productAnswer(parsed, seen) {
  const cut = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const l = parsed?.listing && typeof parsed.listing === 'object' ? parsed.listing : {};
  const url = cut(l.url, 2000);
  const verified = !!seen && urlVerified(url, seen);
  const price = l.price === null || l.price === undefined || l.price === '' ? null : Number(l.price);
  return {
    name: cut(parsed?.name, 200),
    brand: cut(parsed?.brand, 60),
    model: cut(parsed?.model, 80),
    category: cut(parsed?.category, 60),
    summary: cut(parsed?.summary, 600),
    features: (Array.isArray(parsed?.features) ? parsed.features : []).map((f) => cut(f, 160)).filter(Boolean).slice(0, 10),
    specs: (Array.isArray(parsed?.specs) ? parsed.specs : []).map((x) => ({ label: cut(x?.label, 40), value: cut(String(x?.value ?? ''), 160) })).filter((x) => x.label && x.value).slice(0, 16),
    listing: verified ? {
      url,
      retailer: cut(l.retailer, 80),
      title: cut(l.title, 200),
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: cut(l.currency, 8).toUpperCase(),
      availability: ['in_stock', 'out_of_stock'].includes(l.availability) ? l.availability : '',
    } : null,
    confidence: Math.max(0, Math.min(1, Number(parsed?.confidence) || 0)),
    reason: cut(parsed?.reason, 200),
    searched: !!seen,
  };
}

export async function understandProductWithAI(input, settings, apiKey) {
  const cfg = providerConfig(settings);
  if (!apiKey) throw new Error('Add your API key in Settings → Optional AI first.');
  const cut = (v, n) => String(v || '').slice(0, n);
  const text = [
    `Title: ${cut(input.title, 200)}`,
    input.caption ? `Caption (from the post, may be wrong): ${cut(input.caption, 2200)}` : '',
    input.creator ? `Posted by: ${cut(input.creator, 80)}` : '',
    input.hashtags?.length ? `Hashtags: ${input.hashtags.slice(0, 30).map((h) => `#${cut(h, 60)}`).join(' ')}` : '',
    input.description ? `Description: ${cut(input.description, 1500)}` : '',
    input.site ? `From: ${cut(input.site, 120)}` : '',
    input.url ? `Link: ${cut(input.url, 300)}` : '',
    input.price ? `Saved price: ${cut(input.price, 40)}` : '',
    ...(input.products || []).slice(0, 5).map((p) => `Tagged product: ${cut(p.name, 160)}${p.retailer ? ` (${cut(p.retailer, 80)})` : ''}`),
    ...(input.pages || []).slice(0, 2).map((pg) => `Linked page ${cut(pg.url, 300)}:\n${cut(pg.text, 3000)}`),
    input.image ? 'The image is the saved thumbnail.' : 'There is no image.',
  ].filter(Boolean).join('\n');
  const image = typeof input.image === 'string' && input.image.startsWith('data:image/') ? input.image : '';
  if (!supportsWebLookup(settings)) {
    // A custom endpoint has no search tool: the image and text only, and no shop page.
    const system = PRODUCT_SYSTEM.replace(/SEARCH\n[^\n]*\n/, 'You cannot search the web: leave listing empty and features and specs empty unless the text states them.\n');
    return productAnswer(parseJsonBlock(await callProvider(cfg, apiKey, { system, userText: text, imageDataUrl: image, maxTokens: 900 })), null);
  }
  const system = PRODUCT_SYSTEM.replace('SEARCH\n', '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const opts = { system, maxTokens: 1600, searches: 4 };
    const { text: out, seen } = cfg.provider === 'anthropic'
      ? await findViaAnthropic(cfg, apiKey, text, image, controller, opts)
      : await findViaOpenAI(cfg, apiKey, text, image, controller, opts);
    const parsed = parseJsonBlock(out);
    if (!parsed || typeof parsed !== 'object') throw new Error('The provider didn’t return a usable answer.');
    return productAnswer(parsed, seen);
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(settings, apiKey) {
  const cfg = providerConfig(settings);
  const raw = await callProvider(cfg, apiKey, { system: 'Reply with the single word OK.', userText: 'Connection test.', maxTokens: 5 });
  return String(raw || '').trim().slice(0, 40);
}
