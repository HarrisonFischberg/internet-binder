// Every request the engine makes during an evaluation goes through here: which host it went to (the
// privacy check: an AI-off run must show none), and for Anthropic and OpenAI the tokens used, so a live
// run reports what it cost and stops at its budget. Request bodies and keys are never recorded.

// US$ per million tokens (Anthropic first-party list prices, Oct 2026; web search $10 per 1,000 searches).
// An unknown model is priced as the most expensive listed, so the budget errs on the safe side.
const PRICES = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-fable-5-1': [10, 50],
};
const WEB_SEARCH_USD = 0.01;

export function recordNetwork({ maxRequests = 120, maxUsd = 1, keys = {} } = {}) {
  const real = globalThis.fetch;
  const hosts = {};
  const usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, usd: 0, models: {} };
  const state = { stopped: '' };
  globalThis.fetch = async (url, init = {}) => {
    let host = '';
    try { host = new URL(String(url)).host; } catch { host = String(url).slice(0, 40); }
    hosts[host] = (hosts[host] || 0) + 1;
    const ai = /api\.anthropic\.com|api\.openai\.com/.test(host);
    if (ai) {
      if (usage.requests >= maxRequests) { state.stopped = `request budget (${maxRequests}) reached`; throw new Error(`QA budget: ${state.stopped}`); }
      if (usage.usd >= maxUsd) { state.stopped = `cost budget ($${maxUsd}) reached`; throw new Error(`QA budget: ${state.stopped}`); }
      usage.requests++;
    }
    const res = await real(url, init);
    if (ai) {
      try {
        const data = await res.clone().json();
        const u = data.usage || {};
        const model = data.model || '';
        const input = (u.input_tokens ?? u.prompt_tokens ?? 0);
        const output = (u.output_tokens ?? u.completion_tokens ?? 0);
        const searches = u.server_tool_use?.web_search_requests || 0;
        usage.input += input;
        usage.output += output;
        usage.cacheRead += u.cache_read_input_tokens || 0;
        usage.cacheWrite += u.cache_creation_input_tokens || 0;
        usage.searches += searches;
        if (model) usage.models[model] = (usage.models[model] || 0) + 1;
        const [pin, pout] = PRICES[Object.keys(PRICES).find((m) => model.startsWith(m))] || [10, 50];
        usage.usd += ((input + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1) * pin + output * pout) / 1e6 + searches * WEB_SEARCH_USD;
      } catch { /* not JSON: counted as a request only */ }
    }
    return res;
  };
  return {
    get stopped() { return state.stopped; },
    summary: () => ({ hosts, ...usage, usd: Math.round(usage.usd * 10000) / 10000, estimated: true }),
    restore: () => { globalThis.fetch = real; },
    keysSeen: Object.keys(keys),
  };
}
