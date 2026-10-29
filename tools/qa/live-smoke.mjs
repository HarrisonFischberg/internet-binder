#!/usr/bin/env node
// Live provider smoke test through the shipped adapter (keepsake/src/ai/provider.js testConnection, the
// same call Settings → Test makes). Prints only: whether the credentials file was usable, whether
// authentication worked, which model answered and the request's token use. Never the key.
//
//   node tools/qa/live-smoke.mjs --env /absolute/path/.env.qa.local [--provider anthropic] [--model claude-haiku-5-5]

import { loadQaEnv, redact } from './lib/env.mjs';
import { recordNetwork } from './lib/network.mjs';
import { testConnection, providerConfig } from '../../keepsake/src/ai/provider.js';

const arg = (name, d = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const provider = arg('provider', 'anthropic');
const { keys, status } = loadQaEnv(arg('env'));
console.log(`credentials file: ${status.found ? 'found' : 'missing'}; owner-only: ${status.private}; names: [${status.names.join(', ')}]${status.error ? `; ${status.error}` : ''}`);
const key = keys[provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'];
if (!key) { console.log(`${provider}: BLOCKED (no key configured)`); process.exit(2); }
const settings = { ai: { on: true, provider, model: arg('model', ''), effort: 'low' } };
const net = recordNetwork({ maxRequests: 2, maxUsd: 0.05, keys });
try {
  const answer = await testConnection(settings, key);
  const s = net.summary();
  console.log(`${provider}: authentication OK; adapter ${JSON.stringify(providerConfig(settings))}; answered ${JSON.stringify(answer.slice(0, 10))}; served by ${Object.keys(s.models).join(', ') || '(not reported)'}; tokens in ${s.input} out ${s.output}; est. $${s.usd}`);
} catch (e) {
  console.log(`${provider}: authentication FAILED: ${redact(e?.message || e, keys).slice(0, 200)}`);
  process.exit(1);
} finally {
  net.restore();
}
