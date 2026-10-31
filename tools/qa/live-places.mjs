#!/usr/bin/env node
// Fix with AI on a place, live and end to end: a few real venues as saved posts in a throwaway library,
// the shipped place check (placeResolve.js) with real OpenStreetMap and your provider's web search, every
// request recorded by host. Shows what each fill wrote and what confirmed it (details.lookup.verifiedBy).
// Never touches your library. Bounded by --max-usd and --max-requests; the key comes only from --env.
//
//   node tools/qa/live-places.mjs --env /absolute/path/.env.qa.local [--model claude-haiku-5-5] [--max-usd 0.5]
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadQaEnv, redact } from './lib/env.mjs';
import { recordNetwork } from './lib/network.mjs';
import { createStore, memoryBackend, memoryRecordBackend } from '../../keepsake/src/shared/storage.js';
import { resolvePlaceSave } from '../../keepsake/src/shared/placeResolve.js';

const arg = (name, d = '') => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const POSTS = [
  { title: 'Lucali', caption: 'Worth the 2 hour wait 🍕\n📍 Lucali, Brooklyn' },
  { title: "Joe's Pizza", caption: "Classic slice 🍕\n📍 Joe's Pizza, New York" },
  { title: 'Tartine Bakery', caption: 'Morning bun heaven 🥐\n📍 Tartine Bakery, San Francisco' },
  { title: 'Dishoom', caption: 'Bacon naan roll 🥓\n📍 Dishoom, 7 Boundary St, London' },
  { title: 'Contramar', caption: 'Tuna tostadas 🐟\n📍 Contramar, Mexico City' },
  { title: 'Sunset dinner here was unreal', caption: 'Sunset dinner here was unreal 🌅' },
];
const { keys, status } = loadQaEnv(arg('env'));
console.log(`credentials file: ${status.found ? 'found' : 'missing'}; owner-only: ${status.private}`);
const key = keys.ANTHROPIC_API_KEY || '';
const net = recordNetwork({ maxRequests: Number(arg('max-requests', '40')), maxUsd: Number(arg('max-usd', '0.5')), keys });
// OpenStreetMap's Nominatim asks for at most one request a second.
let last = 0;
const waitTurn = async () => { const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); last = Date.now(); };
const rows = [];
for (const p of POSTS) {
  const store = createStore(memoryBackend(), memoryRecordBackend());
  await store.updateSettings({ lookups: { places: true }, ai: { on: true, provider: 'anthropic', model: arg('model', 'claude-haiku-5-5'), webLookup: !!key } });
  if (key) await store.setSecret('aiApiKey', key);
  const item = await store.addItem({ kind: 'place', type: 'instagram', title: p.title, url: `https://www.instagram.com/p/live${rows.length}/`, host: 'www.instagram.com', description: p.caption, instagram: { caption: p.caption }, details: { source: 'page' } });
  const before = { ...net.summary().hosts };
  const t0 = Date.now();
  let r = null;
  let error = '';
  try { r = await resolvePlaceSave(store, item.id, { fetchFn: (u, i) => fetch(u, { ...i, headers: { ...(i?.headers || {}), 'User-Agent': 'InternetBinder-QA/1.0 (place check eval)' } }), allowed: async (s, w) => !!s.lookups?.[w], waitTurn }); } catch (e) { error = redact(e?.message || e, keys).slice(0, 160); }
  const saved = await store.getItem(item.id);
  const d = saved.details || {};
  const hosts = Object.fromEntries(Object.entries(net.summary().hosts).map(([h, n]) => [h, n - (before[h] || 0)]).filter(([, n]) => n > 0));
  const wrote = !!(d.address || d.lat != null || d.phone);
  rows.push({ post: p.caption.replace(/\n/g, ' '), outcome: r?.outcome || 'error', reason: r?.reason || error, address: [d.address, d.locality, d.region].filter(Boolean).join(', '), pin: d.lat != null, verifiedBy: d.lookup?.verifiedBy || [], unsourced: wrote && !(d.lookup?.verifiedBy?.length), choices: (saved.placeChoices || []).map((c) => `${c.name} · ${c.address || c.locality} (${c.source})`), hosts, ms: Date.now() - t0 });
  const x = rows[rows.length - 1];
  console.log(`${x.outcome.padEnd(12)} ${p.title}: ${x.address || '—'}${x.pin ? ' · pin' : ''}${x.verifiedBy.length ? ` · by ${x.verifiedBy.join('+')}` : ''}${x.choices.length ? ` · ${x.choices.length} choices` : ''} · ${JSON.stringify(hosts)} · ${x.ms} ms${x.reason && x.outcome !== 'verified' ? ` (${x.reason})` : ''}`);
  if (net.stopped) break;
}
const summary = net.summary();
net.restore();
console.log(`unsourced facts: ${rows.filter((r) => r.unsourced).length}; network ${JSON.stringify(summary.hosts)}; est. $${summary.usd}`);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/live-places.json', import.meta.url), JSON.stringify({ meta: { at: new Date().toISOString(), network: summary }, rows }, null, 1));
