// Direction 1: Field Notebook. A naturalist's notebook: graph paper, graphite ink, serif names,
// mono labels, one highlighter swipe for the thing that matters, red pencil for stamps.
(() => {
const T = {
  light: { paper: '#F6F2E7', page: '#FBF8F0', grid: 'rgba(60,80,110,.07)', ink: '#2B2A27', soft: '#5E5A52', rule: 'rgba(43,42,39,.16)', hi: '#F2D64B', hiInk: '#2B2A27', red: '#A63A28', tape: 'rgba(214,196,150,.75)', blue: '#2F4A7A', card: '#FFFDF7', shadow: '0 1px 0 rgba(43,42,39,.08), 0 6px 14px -8px rgba(43,42,39,.25)' },
  dark: { paper: '#1C1B18', page: '#22211D', grid: 'rgba(240,235,220,.045)', ink: '#ECE7DA', soft: '#ADA796', rule: 'rgba(236,231,218,.16)', hi: '#E9CF52', hiInk: '#1C1B18', red: '#F0907A', tape: 'rgba(200,185,140,.35)', blue: '#A9BEE8', card: '#2A2924', shadow: '0 1px 0 rgba(0,0,0,.4), 0 8px 16px -8px rgba(0,0,0,.6)' },
};
const SERIF = "'Newsreader', Georgia, serif", MONO = "'IBM Plex Mono', ui-monospace, monospace", SANS = "Inter, system-ui, sans-serif";
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const css = (mode) => { const c = T[mode]; return `
:root{--paper:${c.paper};--page:${c.page};--ink:${c.ink};--soft:${c.soft};--rule:${c.rule};--hi:${c.hi};--hiInk:${c.hiInk};--red:${c.red};--tape:${c.tape};--blue:${c.blue};--card:${c.card};--shadow:${c.shadow}}
body{background:var(--paper)}
#root{background-color:var(--paper);background-image:linear-gradient(${c.grid} 1px,transparent 1px),linear-gradient(90deg,${c.grid} 1px,transparent 1px);background-size:24px 24px;color:var(--ink);font-family:${SANS};-webkit-font-smoothing:antialiased}
.serif{font-family:${SERIF}} .mono{font-family:${MONO};text-transform:uppercase;letter-spacing:.08em;font-size:10.5px;font-weight:500;color:var(--soft)}
.hl{background:linear-gradient(100deg,transparent 0 2%,var(--hi) 3% 96%,transparent 98%);background-size:100% 62%;background-repeat:no-repeat;background-position:0 78%;color:var(--hiInk);padding:0 4px;margin:0 -4px}
.dark .hl{color:var(--ink);background-image:linear-gradient(100deg,transparent 0 2%,rgba(233,207,82,.38) 3% 96%,transparent 98%)}
.tape{position:absolute;width:34px;height:12px;background:var(--tape);transform:rotate(-38deg);top:-2px;left:-10px;box-shadow:0 1px 1px rgba(0,0,0,.06)}
.tape.r{left:auto;right:-10px;transform:rotate(38deg)}
.photo{position:relative;background:var(--card);padding:4px;box-shadow:var(--shadow)}
.photo img{display:block;width:100%;height:100%;object-fit:cover}
.idx{position:relative;background:var(--card);box-shadow:var(--shadow);background-image:linear-gradient(transparent 21px,rgba(166,58,40,.35) 21px,rgba(166,58,40,.35) 22px,transparent 22px),repeating-linear-gradient(transparent 0 15px,rgba(47,74,122,.13) 15px 16px);background-position:0 0,0 22px;background-repeat:no-repeat,repeat;display:flex;align-items:center;justify-content:center;text-align:center;font-family:${SERIF};font-style:italic;color:var(--ink);padding:26px 8px 8px;line-height:1.15}
.dark .idx{background-image:linear-gradient(transparent 21px,rgba(240,144,122,.4) 21px,rgba(240,144,122,.4) 22px,transparent 22px),repeating-linear-gradient(transparent 0 15px,rgba(169,190,232,.12) 15px 16px)}
.stamp{display:inline-flex;align-items:center;gap:6px;border:2px solid var(--red);color:var(--red);border-radius:6px;padding:6px 10px;font-family:${MONO};font-weight:600;font-size:11px;letter-spacing:.12em;text-transform:uppercase;transform:rotate(-3deg)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;font:600 15px ${SANS};color:var(--ink);background:transparent;border:1.5px solid var(--ink);height:44px;padding:0 16px}
.btn.primary{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.btn.quiet{border-color:transparent;padding:0 10px;color:var(--soft)}
.ruled > *{border-bottom:1px solid var(--rule)}
.chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--rule);font:500 13.5px ${SANS};color:var(--ink);white-space:nowrap;background:var(--page)}
.chip.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:5px;border:1px solid var(--rule);border-bottom-width:2px;font:600 11px ${MONO};color:var(--soft);padding:0 4px}
`; };

const KS_ = () => window.KS;
const GEAR = (sz = 20) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const icon = (n, sz, st) => n === 'settings' ? GEAR(sz) : window.KS.icon(n, sz, st);
const thumb = (i, w, h, tape = true, fs = 15) => i.img
  ? `<div class="photo" style="width:${w}px;height:${h}px;flex:none">${tape ? '<i class="tape"></i>' : ''}<img src="${i.img}" alt=""></div>`
  : (w < 80 ? `<div class="idx" style="width:${w}px;height:${h}px;flex:none;padding:18px 0 0;color:var(--blue)">${KS_().icon(i.kind, Math.round(w * .42), 1.6)}</div>`
    : `<div class="idx" style="width:${w}px;height:${h}px;flex:none;font-size:${fs}px">${esc(i.title)}</div>`);
const meta = (i) => { const K = KS_(); const f = K.fact(i); return `${K.kindLabel(i.kind)}${f ? ' · ' + f : ''}`; };

// ---------- iOS ----------
const ink = (m) => T[m].ink;
const tabBar = (m, active) => {
  const tab = (id, icon, label) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;color:${id === active ? 'var(--ink)' : 'var(--soft)'};font:${id === active ? 600 : 500} 10.5px ${SANS}">${id === active ? `<span style="position:relative">${KS_().icon(icon, 24, 2)}<i style="position:absolute;left:-6px;right:-6px;bottom:-1px;height:9px;background:var(--hi);opacity:${m === 'dark' ? .5 : .9};z-index:-1;border-radius:3px"></i></span>` : KS_().icon(icon, 24, 1.7)}<span>${label}</span></div>`;
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:86px;background:var(--page);border-top:1px solid var(--rule);display:flex;padding:9px 6px 0;z-index:40">${tab('home', 'home', 'Home')}${tab('library', 'library', 'Library')}${tab('places', 'map', 'Places')}${tab('search', 'search', 'Search')}</div>${KS_().homeIndicator(ink(m))}`;
};
const iosTop = (m, title, sub, right = 'settings') => `${KS_().statusBar(ink(m))}
<div style="display:flex;align-items:flex-end;justify-content:space-between;padding:10px 20px 6px">
  <div><div class="mono" style="margin-bottom:4px">${sub}</div><div class="serif" style="font-size:36px;font-weight:600;letter-spacing:-.01em;line-height:1">${title}</div></div>
  <div style="width:40px;height:40px;border-radius:20px;border:1px solid var(--rule);display:flex;align-items:center;justify-content:center;color:var(--ink);background:var(--page)">${icon(right, 20)}</div>
</div>`;

const iosHome = (m) => {
  const K = KS_();
  const recent = K.items.filter((i) => i.img).slice(0, 4);
  const back = [K.find('Café de Flore'), K.find('Piranesi'), K.find('Kettlebell')];
  return `${iosTop(m, 'Keepsake', 'Sunday, 19 October')}
<div style="padding:0 20px 120px;height:712px;overflow:hidden">
  <div style="margin:14px 0 18px;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px dashed var(--ink);border-radius:12px;background:var(--page)">
    <div style="color:var(--ink)">${K.icon('inbox', 22)}</div>
    <div style="flex:1"><div style="font:600 15px ${SANS}"><span class="hl">2 saves need a collection</span></div><div style="font:13px ${SANS};color:var(--soft);margin-top:2px">One tap each. Keepsake learns as you go.</div></div>
    <div style="color:var(--soft)">${K.icon('chevron', 18)}</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="serif" style="font-size:21px;font-weight:600">Recent</div><div class="mono">See all</div></div>
  <div style="display:flex;gap:16px;margin:12px -20px 0;padding:6px 20px 8px;overflow:hidden">
    ${recent.map((i, n) => `<div style="width:132px;flex:none;transform:rotate(${[-1.2, .8, -.6, 1][n]}deg)">${thumb(i, 132, 120, true)}<div class="mono" style="margin-top:10px;color:${i.kind === 'place' ? 'var(--red)' : 'var(--soft)'}">${K.kindLabel(i.kind)}</div><div class="serif" style="font-size:16px;font-weight:600;line-height:1.15;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(i.title)}</div></div>`).join('')}
  </div>
  <div class="ruled" style="margin-top:14px;border-top:1px solid var(--rule)">
    ${[['Collections', '6 collections · 4 saves', 'library'], ['Lifestyle', 'Places, recipes, films and 4 more', 'bookmark']].map(([t, s, ic]) => `<div style="display:flex;align-items:center;gap:12px;height:62px"><div style="width:36px;height:36px;border-radius:8px;border:1px solid var(--rule);display:flex;align-items:center;justify-content:center;background:var(--page)">${K.icon(ic, 19)}</div><div style="flex:1"><div class="serif" style="font-size:18px;font-weight:600">${t}</div><div style="font:13px ${SANS};color:var(--soft)">${s}</div></div><div style="color:var(--soft)">${K.icon('chevron', 18)}</div></div>`).join('')}
  </div>
  <div class="serif" style="font-size:21px;font-weight:600;margin:20px 0 4px">Come back to</div>
  <div class="ruled">
    ${back.map((i) => `<div style="display:flex;gap:12px;align-items:center;padding:9px 0">${thumb(i, 46, 46, false, 9)}<div style="flex:1;min-width:0"><div class="serif" style="font-size:16.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</div><div class="mono" style="margin-top:2px">${esc(meta(i))}</div></div></div>`).join('')}
  </div>
</div>${tabBar(m, 'home')}`;
};

const iosLibrary = (m) => {
  const K = KS_();
  const list = K.items.slice(0, 9);
  return `${iosTop(m, 'Library', '28 saves', 'more')}
<div style="padding:8px 20px 0">
  <div style="display:flex;align-items:center;gap:10px;height:42px;border-radius:12px;background:var(--page);border:1px solid var(--rule);padding:0 12px;color:var(--soft);font:15px ${SANS}">${K.icon('search', 18)} Search 28 saves</div>
  <div style="display:flex;gap:8px;margin:12px -20px 0;padding:0 20px;overflow:hidden"><span class="chip on">All 28</span>${['place', 'recipe', 'product', 'book', 'media'].map((k) => `<span class="chip">${K.icon(k, 15)} ${K.kindPlural(k)} <span style="color:var(--soft)">${K.count(k)}</span></span>`).join('')}</div>
</div>
<div class="ruled" style="padding:6px 20px 0;height:600px;overflow:hidden">
  ${list.map((i) => `<div style="display:flex;gap:14px;align-items:center;padding:11px 0">${thumb(i, 58, 58, !!i.img, 10)}<div style="flex:1;min-width:0"><div class="mono" style="color:${i.kind === 'place' ? 'var(--red)' : 'var(--soft)'}">${esc(meta(i))}</div><div class="serif" style="font-size:18px;font-weight:600;line-height:1.2;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</div>${i.note ? `<div class="serif" style="font-style:italic;font-size:14px;color:var(--soft);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">“${esc(i.note)}”</div>` : ''}</div>${i.fav ? `<span style="color:var(--red)">${K.icon('star', 16)}</span>` : ''}</div>`).join('')}
</div>${tabBar(m, 'library')}`;
};

const iosRecipe = (m) => {
  const K = KS_(), r = K.find('Spaghetti'), d = r.details;
  return `${KS_().statusBar(ink(m))}
<div style="display:flex;justify-content:space-between;padding:4px 16px 8px">${['back', 'more'].map((ic) => `<div style="width:40px;height:40px;border-radius:20px;border:1px solid var(--rule);background:var(--page);display:flex;align-items:center;justify-content:center">${K.icon(ic, 20)}</div>`).join('')}</div>
<div style="padding:0 20px;height:640px;overflow:hidden">
  <div style="display:flex;gap:16px;align-items:flex-start">
    <div style="transform:rotate(-1.5deg);margin-top:4px">${thumb(r, 132, 150)}</div>
    <div style="flex:1;padding-top:6px"><div class="mono">Recipe · 6 ingredients</div><div class="serif" style="font-size:30px;font-weight:600;line-height:1.02;margin-top:6px;letter-spacing:-.01em">Spaghetti alla carbonara</div><div style="margin-top:10px;font:13px ${SANS};color:var(--soft)">recipes.example.org</div>
      <div style="margin-top:12px"><span class="stamp">${K.icon('check', 14, 2.5)} Cooked twice</span></div></div>
  </div>
  <div class="serif" style="font-style:italic;font-size:15px;color:var(--soft);margin:16px 0 4px">“Use guanciale if you can find it.”</div>
  <div class="mono" style="margin:16px 0 4px;color:var(--ink)">Ingredients</div>
  <div class="ruled">${d.ingredients.map((x, n) => `<div style="display:flex;align-items:center;gap:12px;height:40px;font:16px ${SANS}"><span style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${n < 2 ? 'var(--ink)' : 'var(--soft)'};display:flex;align-items:center;justify-content:center;${n < 2 ? 'background:var(--ink);color:var(--paper)' : ''}">${n < 2 ? K.icon('check', 13, 3) : ''}</span><span style="${n < 2 ? 'color:var(--soft);text-decoration:line-through;text-decoration-color:var(--rule)' : ''}">${esc(x)}</span></div>`).join('')}</div>
  <div class="mono" style="margin:18px 0 6px;color:var(--ink)">Steps · ${(d.steps || []).length}</div>
  ${(d.steps || []).slice(0, 2).map((s, n) => `<div style="display:flex;gap:10px;margin-bottom:8px"><span class="serif" style="font-size:20px;font-weight:600;color:var(--red);width:14px;line-height:1.1">${n + 1}</span><span class="serif" style="font-size:16px;line-height:1.4">${esc(s)}</span></div>`).join('')}
</div>
<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--page);border-top:1px solid var(--rule);display:flex;gap:10px;z-index:40">
  <div class="btn" style="width:52px;padding:0">${K.icon('share', 20)}</div>
  <div class="btn primary" style="flex:1;height:52px;font-size:17px;border-radius:12px">${K.icon('flame', 20, 2)} Start cooking</div>
</div>${K.homeIndicator(ink(m))}`;
};

const REVIEW = () => {
  const K = KS_();
  return [
    { title: 'Dutch oven (the blue one)', img: '', kind: 'product', why: 'Example Shop · “dutch oven” is your keyword', sug: ['Kitchen', 'Coffee corner', 'Home Decor'] },
    { title: 'Adjustable desk lamp', img: K.find('Adjustable desk lamp').img, kind: 'product', why: 'Example Design · “lamp” in the title', sug: ['Home Decor', 'Technology', 'Kitchen'] },
    { title: 'Something from a newsletter', img: '', kind: 'product', why: 'Example · no clues in the page text', sug: ['Home Decor', 'Kitchen', 'Clothing'] },
  ];
};
const iosReview = (m) => {
  const K = KS_();
  return `${KS_().statusBar(ink(m))}
<div style="display:flex;align-items:center;gap:8px;padding:4px 16px 0;color:var(--ink);font:500 16px ${SANS}">${K.icon('back', 20)} Home</div>
<div style="padding:10px 20px 0"><div class="mono">3 left</div><div class="serif" style="font-size:34px;font-weight:600;line-height:1.05;margin-top:4px">Review</div><div style="font:14.5px/1.4 ${SANS};color:var(--soft);margin-top:6px">Keepsake wasn’t sure where these go. Tap the right collection and it learns.</div></div>
<div style="padding:8px 20px 0">
  ${REVIEW().map((r, n) => `<div style="position:relative;background:var(--card);box-shadow:var(--shadow);border-radius:4px;padding:14px;margin-top:14px">
    <div style="display:flex;gap:12px;align-items:center">${thumb(r, 54, 54, false, 9.5)}<div style="flex:1;min-width:0"><div class="serif" style="font-size:18px;font-weight:600;line-height:1.15">${esc(r.title)}</div><div style="font:12.5px ${SANS};color:var(--soft);margin-top:3px">${esc(r.why)}</div></div></div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      <span class="chip" style="background:var(--hi);color:#2B2A27;border-color:transparent;font-weight:600">${r.sug[0]}</span>
      <span class="chip">${r.sug[1]}</span><span class="chip">${r.sug[2]}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;font:500 13.5px ${SANS};color:var(--soft)"><span>Somewhere else…</span><span>Skip for now</span></div>
  </div>`).join('')}
  <div class="mono" style="margin-top:22px;text-align:center;line-height:1.6">Skipped saves stay here.<br>Nothing is deleted.</div>
</div>${KS_().homeIndicator(ink(m))}`;
};

// ---------- Popup ----------
const popup = (m) => {
  const K = KS_(), lamp = K.find('Adjustable desk lamp');
  return `<div style="padding:14px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--rule);background:var(--page)">
  <div style="width:26px;height:26px;border-radius:6px;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center">${K.icon('bookmark', 15, 2.2)}</div>
  <div class="serif" style="font-size:19px;font-weight:600;flex:1">Keepsake</div><div class="mono">Open library</div></div>
<div style="padding:18px 18px 6px">
  <div style="display:flex;align-items:center;gap:8px;font:600 15px ${SANS}"><span style="width:22px;height:22px;border-radius:11px;background:var(--hi);display:flex;align-items:center;justify-content:center;color:#2B2A27">${K.icon('check', 14, 3)}</span>Saved to <span style="display:inline-flex;align-items:center;gap:4px;border-bottom:1.5px solid var(--ink)">Home Decor ${K.icon('down', 14, 2)}</span></div>
  <div style="display:flex;gap:16px;margin-top:18px;align-items:center">
    <div style="transform:rotate(-2deg)">${thumb(lamp, 104, 104)}</div>
    <div style="flex:1"><div class="mono">Product · Northlight</div><div class="serif" style="font-size:21px;font-weight:600;line-height:1.12;margin-top:5px">Arc desk lamp, brushed brass</div><div style="font:600 16px ${SANS};margin-top:6px">$129.00</div></div>
  </div>
  <div style="margin-top:18px;border-bottom:1px solid var(--rule);padding:8px 0;font:italic 15px ${SERIF};color:var(--soft)">Add a note…</div>
  <div style="display:flex;gap:10px;margin-top:16px"><div class="btn" style="flex:none">${K.icon('undo', 16, 2)} Undo</div><div class="btn primary" style="flex:1">Open in Keepsake</div></div>
</div>
<div style="display:flex;justify-content:space-between;padding:12px 18px 14px;margin-top:10px;border-top:1px solid var(--rule)"><span class="mono">Saved on this device</span><span class="mono">On-page buttons</span></div>`;
};

// ---------- Dashboard ----------
const sidebar = (active) => {
  const K = KS_();
  const row = (id, ic, label, n) => `<div style="display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:8px;font:${id === active ? 600 : 500} 14px ${SANS};color:var(--ink)">${icon(ic, 17)}<span style="flex:1">${id === active ? `<span class="hl">${label}</span>` : label}</span>${n ? `<span style="font:500 12px ${MONO};color:var(--soft)">${n}</span>` : ''}</div>`;
  return `<aside style="width:244px;flex:none;border-right:1px solid var(--rule);padding:22px 14px;background:var(--page);height:100%;overflow:hidden">
  <div style="display:flex;align-items:center;gap:10px;padding:0 10px 18px"><div style="width:28px;height:28px;border-radius:7px;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center">${K.icon('bookmark', 16, 2.2)}</div><div class="serif" style="font-size:22px;font-weight:600">Keepsake</div></div>
  ${row('home', 'home', 'Home')}${row('library', 'library', 'Library', 28)}${row('fav', 'star', 'Favorites', 1)}${row('review', 'inbox', 'Review', 3)}
  <div class="mono" style="padding:18px 10px 6px">Kinds</div>
  ${['place', 'recipe', 'media', 'book', 'workout'].map((k) => row(k, k, K.kindPlural(k), K.count(k))).join('')}
  <div class="mono" style="padding:18px 10px 6px">Collections</div>
  ${['Kitchen', 'Coffee corner', 'Home Decor', 'Running'].map((c) => row(c, 'bookmark', c, 1)).join('')}
  <div style="margin-top:14px;border-top:1px solid var(--rule);padding-top:10px">${row('settings', 'settings', 'Settings')}</div>
</aside>`;
};
const shell = (m, active, body) => `${m === 'dark' ? KS_().browserBar('#2a2925', '#d8d2c2').replace('background:rgba(255,255,255,.7)', 'background:#3a3833') : KS_().browserBar('#e7e3d8', '#3c3a35')}<div style="display:flex;height:860px">${sidebar(active)}<main style="flex:1;overflow:hidden;position:relative">${body}</main></div>`;

const extLibrary = (m) => {
  const K = KS_();
  const items = K.items.slice(0, 15);
  const card = (i, n) => `<div style="position:relative;min-width:0">
    ${i.img ? `<div class="photo" style="height:150px;transform:rotate(${[-.6, .5, -.3, .7, -.5][n % 5]}deg)"><i class="tape"></i><img src="${i.img}" alt=""></div>` : `<div class="idx" style="height:150px;font-size:20px;transform:rotate(${[-.6, .5, -.3, .7, -.5][n % 5]}deg)">${esc(i.title)}</div>`}
    <div class="mono" style="margin-top:12px;color:${i.kind === 'place' ? 'var(--red)' : 'var(--soft)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(meta(i))}</div>
    <div class="serif" style="font-size:17px;font-weight:600;line-height:1.2;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</div></div>`;
  return shell(m, 'library', `
  <div style="display:flex;align-items:flex-end;justify-content:space-between;padding:26px 36px 0">
    <div><div class="mono">28 saves · 6 collections</div><div class="serif" style="font-size:40px;font-weight:600;line-height:1;margin-top:6px">Library</div></div>
    <div style="display:flex;gap:10px;align-items:center"><div style="width:320px;height:40px;border-radius:10px;border:1px solid var(--rule);background:var(--page);display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--soft);font:14px ${SANS}">${K.icon('search', 17)} Search your saves <span style="margin-left:auto" class="kbd">/</span></div><div class="btn" style="height:40px">Select</div></div>
  </div>
  <div style="display:flex;gap:8px;padding:18px 36px 0;align-items:center"><span class="chip on">All</span>${['product', 'place', 'recipe', 'video', 'book', 'media', 'workout'].map((k) => `<span class="chip">${K.kindPlural(k)} <span style="color:var(--soft)">${K.count(k)}</span></span>`).join('')}<span style="margin-left:auto" class="mono">Newest first ${K.icon('down', 12, 2)}</span></div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:34px 26px;padding:28px 36px">${items.map(card).join('')}</div>`);
};

const extRecipe = (m) => {
  const K = KS_(), r = K.find('Spaghetti'), d = r.details;
  return shell(m, 'recipe', `
  <div style="display:flex;align-items:center;gap:8px;padding:20px 40px 0;font:500 14px ${SANS};color:var(--soft)">${K.icon('back', 16)} Recipes</div>
  <div style="display:grid;grid-template-columns:380px 1fr;gap:48px;padding:18px 40px 0">
    <div>
      <div style="transform:rotate(-1.2deg)">${thumb(r, 372, 300)}</div>
      <div style="margin-top:24px"><span class="stamp">${K.icon('check', 14, 2.5)} Cooked twice · last on 12 Oct</span></div>
      <div class="serif" style="font-style:italic;font-size:17px;color:var(--soft);margin-top:20px;line-height:1.4">“Use guanciale if you can find it. Pecorino, not parmesan.”</div>
    </div>
    <div>
      <div class="mono">Recipe · 6 ingredients · 4 steps · saved 14 Oct</div>
      <div class="serif" style="font-size:46px;font-weight:600;line-height:1.02;margin-top:8px;letter-spacing:-.01em">Spaghetti alla carbonara</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:10px;font:14px ${SANS};color:var(--soft)">${K.icon('link', 15)} recipes.example.org</div>
      <div style="display:flex;gap:10px;margin-top:20px"><div class="btn primary" style="padding:0 22px">${K.icon('flame', 18, 2)} Start cooking</div><div class="btn">Mark cooked</div><div class="btn quiet">Edit</div><div class="btn quiet">${K.icon('share', 17)} Share</div></div>
      <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:40px;margin-top:30px">
        <div><div class="mono" style="color:var(--ink);margin-bottom:4px">Ingredients</div><div class="ruled">${d.ingredients.map((x) => `<div style="display:flex;align-items:center;gap:10px;height:38px;font:15px ${SANS}"><span style="width:17px;height:17px;border-radius:4px;border:1.5px solid var(--soft)"></span>${esc(x)}</div>`).join('')}</div></div>
        <div><div class="mono" style="color:var(--ink);margin-bottom:8px">Steps</div>${(d.steps || []).map((s, n) => `<div style="display:flex;gap:14px;margin-bottom:16px"><span class="serif" style="font-size:26px;font-weight:600;line-height:1;color:var(--red);width:20px">${n + 1}</span><span class="serif" style="font-size:17px;line-height:1.45">${esc(s)}</span></div>`).join('')}</div>
      </div>
    </div>
  </div>`);
};

const extReview = (m) => {
  const K = KS_();
  return shell(m, 'review', `
  <div style="padding:30px 44px 0;max-width:980px">
    <div class="mono">3 saves left</div><div class="serif" style="font-size:40px;font-weight:600;line-height:1;margin-top:6px">Review</div>
    <div style="font:15px/1.5 ${SANS};color:var(--soft);margin-top:10px">Keepsake wasn’t sure where these belong. Pick a collection, or select a row and press <span class="kbd">1</span> <span class="kbd">2</span> <span class="kbd">3</span>. It learns from each choice.</div>
    ${REVIEW().map((r, n) => `<div style="display:flex;gap:18px;align-items:center;background:var(--card);box-shadow:var(--shadow);padding:16px 18px;margin-top:${n ? 14 : 26}px;border-radius:4px;${n === 0 ? 'outline:2px solid var(--ink);outline-offset:3px' : ''}">
      ${thumb(r, 72, 72, false, 11)}
      <div style="flex:1;min-width:0"><div class="serif" style="font-size:20px;font-weight:600">${esc(r.title)}</div><div style="font:13px ${SANS};color:var(--soft);margin-top:3px">${esc(r.why)}</div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center">${r.sug.map((s, k) => `<span class="chip" style="${k === 0 ? 'background:var(--hi);color:#2B2A27;border-color:transparent;font-weight:600' : ''}"><span class="kbd" style="height:18px;min-width:18px;${k === 0 ? 'color:#2B2A27;border-color:rgba(43,42,39,.35)' : ''}">${k + 1}</span>${s}</span>`).join('')}<span class="chip" style="border-style:dashed">Somewhere else…</span></div></div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;font:500 13.5px ${SANS};color:var(--soft)"><span>Skip</span><span>Open</span></div>
    </div>`).join('')}
    <div class="mono" style="margin-top:22px">Tip: Delete lives in Open, so a stray key can’t throw a save away.</div>
  </div>`);
};

window.KS_DIR = {
  name: 'Field Notebook', css,
  screens: { 'ios-home': iosHome, 'ios-library': iosLibrary, 'ios-recipe': iosRecipe, 'ios-review': iosReview, 'popup-saved': popup, 'ext-library': extLibrary, 'ext-recipe': extRecipe, 'ext-review': extReview },
};
})();
