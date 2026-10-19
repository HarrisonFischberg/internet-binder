// Direction 2: Gallery. A quiet museum for your finds.
(() => {
const T = {
  light: { bg: '#FFFFFF', ink: '#111111', muted: '#5E5E5E', faint: '#8A8A8A', rule: '#E4E4E4', soft: '#F6F6F4', btn: '#111111', onBtn: '#FFFFFF',
    plate: { product: '#F1EEE8', place: '#ECEFEA', recipe: '#F4EEE6', video: '#ECEEF2', article: '#EFEDE8', workout: '#EAEFEE', media: '#F1ECEE', book: '#EFECE4' } },
  dark: { bg: '#0E0E0E', ink: '#F2EDE4', muted: '#A7A196', faint: '#8C877E', rule: '#2A2927', soft: '#171716', btn: '#F2EDE4', onBtn: '#0E0E0E',
    plate: { product: '#1C1A17', place: '#171B18', recipe: '#1D1915', video: '#17191D', article: '#1B1A17', workout: '#161B1A', media: '#1C181A', book: '#1C1A15' } },
};
let M = 'light';
const t = () => T[M];
const serif = "'Instrument Serif', 'New York', Georgia, serif";
const sans = "'Inter Tight', Inter, -apple-system, system-ui, sans-serif";

const live = () => KS.items.filter((i) => i.title !== 'Old phone case');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (i) => [KS.kindLabel(i.kind), KS.fact(i)].filter(Boolean).join(' · ');

// What a plate shows when a save has no picture: the one detail that names it, set like a title page.
function mark(i) {
  const d = i.details || {};
  if (i.kind === 'book') return d.author || i.title;
  if (i.kind === 'media') return String(d.year || i.title);
  if (i.kind === 'place') return d.locality || i.title;
  if (i.kind === 'article') return d.siteName || i.title;
  if (i.kind === 'video') return d.durationSeconds ? `${Math.round(d.durationSeconds / 60)} min` : i.title;
  if (i.kind === 'workout') return d.exercises ? `${d.exercises.length} moves` : i.title;
  return i.title;
}
const gear = (n = 21) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

// A save's picture, or a typographic plate when it has none.
function pic(i, { w = '100%', h = 200, size = 26, cap = true } = {}) {
  if (i.img) return `<div class="g-pic" style="width:${w};height:${typeof h === 'number' ? h + 'px' : h};background-image:url(${i.img})"></div>`;
  return `<div class="g-plate" style="width:${w};height:${typeof h === 'number' ? h + 'px' : h};background:${t().plate[i.kind] || t().soft}">
    ${cap ? `<span class="g-cap">${KS.kindLabel(i.kind)}</span>` : ''}
    <span class="g-plate-t" style="font-size:${size}px">${esc(mark(i))}</span></div>`;
}
const wall = (i, ts = 21) => `<div class="g-wall"><div class="g-t" style="font-size:${ts}px">${esc(i.title)}</div><div class="g-cap">${esc(label(i))}</div></div>`;

const css = (mode) => {
  M = mode; const c = T[mode];
  return `
  body{background:${c.bg}}
  #root{background:${c.bg};color:${c.ink};font-family:${sans};-webkit-font-smoothing:antialiased}
  .g-pic{background-size:cover;background-position:center;background-color:${c.soft}}
  .g-plate{position:relative;display:flex;flex-direction:column;justify-content:flex-end;padding:14px;overflow:hidden}
  .g-plate .g-cap{position:absolute;top:12px;left:14px}
  .g-plate-t{font-family:${serif};line-height:1.02;color:${c.ink};letter-spacing:-.01em}
  .g-t{font-family:${serif};line-height:1.08;letter-spacing:-.005em;color:${c.ink}}
  .g-cap{font-family:${sans};font-size:12px;letter-spacing:.01em;color:${c.muted};line-height:1.4}
  .g-eyebrow{font-family:${sans};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};font-weight:500}
  .g-wall{padding-top:10px}
  .g-wall .g-cap{margin-top:3px}
  .g-rule{height:1px;background:${c.rule}}
  .g-link{color:${c.ink};text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
  .g-btn{white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:${c.btn};color:${c.onBtn};font:500 15px ${sans};height:48px;padding:0 22px;border-radius:2px;letter-spacing:.01em}
  .g-ghost{white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid ${c.ink};color:${c.ink};font:500 14px ${sans};height:40px;padding:0 16px;border-radius:2px}
  .g-quiet{white-space:nowrap;display:inline-flex;align-items:center;gap:6px;color:${c.muted};font:500 14px ${sans}}
  .g-kbd{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid currentColor;border-radius:2px;font:500 11px ${sans};opacity:.85}
  .g-tabs{position:absolute;left:0;right:0;bottom:0;height:84px;background:${c.bg};border-top:1px solid ${c.rule};display:flex;align-items:flex-start;padding:14px 26px 0;gap:26px;font:500 15px ${sans};z-index:40}
  .g-tabs span{color:${c.muted}} .g-tabs span.on{color:${c.ink};text-decoration:underline;text-underline-offset:6px;text-decoration-thickness:1px}
  .g-tabs .sp{flex:1}
  .g-scroll{position:absolute;top:54px;left:0;right:0;bottom:84px;overflow:hidden}
  /* dashboard */
  .g-app{display:flex;height:860px}
  .g-side{width:232px;flex:none;border-right:1px solid ${c.rule};padding:28px 26px;display:flex;flex-direction:column;gap:3px;font:14px ${sans}}
  .g-side .wm{font-family:${serif};font-size:30px;margin-bottom:26px;color:${c.ink}}
  .g-side a{display:flex;justify-content:space-between;color:${c.muted};padding:5px 0;text-decoration:none}
  .g-side a.on{color:${c.ink};text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:1px}
  .g-side a b{font-weight:400;color:${c.muted};font-variant-numeric:tabular-nums}
  .g-side .g-eyebrow{margin:22px 0 6px}
  .g-main{flex:1;overflow:hidden;padding:34px 48px}
  .g-input{display:flex;align-items:center;gap:10px;border-bottom:1px solid ${c.ink};height:38px;color:${c.muted};font:14px ${sans}}
  `;
};

const status = () => KS.statusBar(t().ink);
const tabs = (on) => `<div class="g-tabs">${['Home', 'Library', 'Places'].map((x) => `<span class="${x === on ? 'on' : ''}">${x}</span>`).join('')}<span class="sp"></span><span style="color:${t().ink}">${KS.icon('search', 21, 1.5)}</span></div>${KS.homeIndicator(t().ink)}`;

// --- iPhone ---------------------------------------------------------------
function iosHome() {
  const it = live();
  const hero = KS.find('Tartine'), next = [KS.find('Glass pour'), KS.find('Spaghetti'), KS.find('Piranesi')];
  const back = [KS.find('Café de Flore'), KS.find('The case for slow'), KS.find('Molded')];
  return `${status()}<div class="g-scroll">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;padding:10px 20px 14px">
      <div class="g-t" style="font-size:42px">Keepsake</div>
      <span style="color:${t().ink};padding-bottom:8px">${gear()}</span></div>
    <div style="margin:0 20px;border-top:1px solid ${t().ink};border-bottom:1px solid ${t().rule};padding:11px 0;display:flex;justify-content:space-between;align-items:center;font:14px ${sans}">
      <span>2 saves need a collection</span><span class="g-link" style="font-size:14px">File them</span></div>
    <div style="padding:18px 20px 10px;display:flex;justify-content:space-between"><span class="g-eyebrow">Recent</span><span class="g-cap">${it.length} saves</span></div>
    ${pic(hero, { h: 176 })}
    <div style="padding:0 20px">${wall(hero, 26)}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px 20px 0">
      ${next.map((i) => `<div style="min-width:0">${pic(i, { h: 80, size: 16, cap: false })}<div class="g-t" style="font-size:15px;margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</div><div class="g-cap" style="font-size:11px">${KS.kindLabel(i.kind)}</div></div>`).join('')}
    </div>
    <div style="margin:16px 20px 0;border-top:1px solid ${t().rule}">
      ${[['Collections', '6 collections'], ['Lifestyle', '7 rooms · 22 saves']].map(([a, b]) => `<div style="display:flex;align-items:baseline;justify-content:space-between;padding:9px 0;border-bottom:1px solid ${t().rule}"><span class="g-t" style="font-size:22px">${a}</span><span class="g-cap" style="display:flex;align-items:center;gap:4px">${b} ${KS.icon('chevron', 14, 1.5)}</span></div>`).join('')}
    </div>
    <div style="padding:18px 20px 10px"><span class="g-eyebrow">Come back to</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">${back.map((i) => pic(i, { h: 130, size: 18 })).join('')}</div>
  </div>${tabs('Home')}`;
}

function iosLibrary() {
  const order = ['Tartine', 'Something from', 'Spaghetti', 'Piranesi', 'Kettlebell', 'Past Lives'].map(KS.find);
  const filters = [['All', 28], ['Places', 8], ['Products', 6], ['Recipes', 4], ['Books', 3]];
  return `${status()}<div class="g-scroll">
    <div style="padding:10px 20px 0;display:flex;align-items:flex-end;justify-content:space-between"><div class="g-t" style="font-size:42px">Library</div><span class="g-cap" style="padding-bottom:9px">28 saves</span></div>
    <div style="padding:10px 20px 0"><div class="g-input">${KS.icon('search', 17, 1.5)}<span>Search 28 saves</span></div></div>
    <div style="display:flex;gap:18px;padding:16px 20px 16px;font:14px ${sans};white-space:nowrap">${filters.map(([n, c], k) => `<span style="color:${k ? t().muted : t().ink};${k ? '' : 'text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:1px'}">${n} <span style="color:${t().faint}">${c}</span></span>`).join('')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px 12px;padding:0 20px">
      ${order.map((i) => `<div>${pic(i, { h: 168, size: 24 })}${wall(i, 19)}</div>`).join('')}
    </div></div>${tabs('Library')}`;
}

function iosRecipe() {
  const r = KS.find('Spaghetti'), d = r.details;
  return `${status()}
  <div style="position:absolute;top:54px;left:0;right:0;bottom:100px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 14px 10px;color:${t().ink}">${KS.icon('back', 24, 1.5)}<span style="display:flex;gap:18px">${KS.icon('share', 21, 1.5)}${KS.icon('more', 22, 2)}</span></div>
    ${pic(r, { h: 250 })}
    <div style="padding:16px 20px 0">
      <div class="g-cap">Recipe · recipes.example.org · Saved Oct 14</div>
      <div class="g-t" style="font-size:40px;margin-top:6px">Spaghetti alla carbonara</div>
      <div class="g-cap" style="margin-top:8px">6 ingredients · 4 steps · Cooked twice, last on Oct 12</div>
    </div>
    <div style="padding:20px 20px 0"><div class="g-eyebrow" style="margin-bottom:6px">Ingredients</div>
      ${d.ingredients.map((x) => `<div style="display:flex;gap:12px;align-items:center;padding:9px 0;border-top:1px solid ${t().rule};font:16px ${sans}"><span style="width:16px;height:16px;border:1px solid ${t().muted};border-radius:1px;flex:none"></span>${esc(x)}</div>`).join('')}
    </div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:100px;background:${t().bg};border-top:1px solid ${t().rule};padding:12px 20px 0;display:flex;gap:10px;align-items:flex-start;z-index:40">
    <span class="g-btn" style="flex:1;height:50px">${KS.icon('flame', 18, 1.6)} Start cooking</span>
    <span class="g-ghost" style="height:50px;padding:0 16px">${KS.icon('check', 18, 1.6)} Cooked</span>
  </div>${KS.homeIndicator(t().ink)}`;
}

const REVIEW = () => [
  { i: { title: 'Dutch oven (the blue one)', kind: 'product', img: '' }, why: 'Example Shop · “dutch oven” is one of your Kitchen words', sug: ['Kitchen', 'Coffee corner', 'Home Decor'] },
  { i: KS.find('Adjustable desk lamp'), why: 'Example Design · “lamp” and “desk lamp” in the title', sug: ['Home Decor', 'Technology', 'Kitchen'] },
  { i: KS.find('Something from a newsletter'), why: 'Example · No clues in the page, so it’s your call', sug: ['Home Decor', 'Kitchen', 'Coffee corner'] },
];

function iosReview() {
  return `${status()}<div class="g-scroll" style="bottom:0">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 14px 0;color:${t().ink}">${KS.icon('back', 24, 1.5)}<span class="g-cap">3 left</span></div>
    <div style="padding:6px 20px 0"><div class="g-t" style="font-size:42px">Review</div>
      <div style="font:15px/1.45 ${sans};color:${t().muted};margin-top:6px">Keepsake wasn’t sure where these go. Tap a collection and it learns from you.</div></div>
    ${REVIEW().map(({ i, why, sug }) => `
      <div style="margin:18px 20px 0;padding-top:16px;border-top:1px solid ${t().rule}">
        <div style="display:flex;gap:14px">${pic(i, { w: '84px', h: 84, size: 14, cap: false })}
          <div style="flex:1;min-width:0"><div class="g-t" style="font-size:23px">${esc(i.title)}</div><div class="g-cap" style="margin-top:4px">${why}</div></div></div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap">
          <span class="g-btn" style="height:38px;padding:0 14px;font-size:14px">${sug[0]}</span>
          <span class="g-ghost" style="height:38px;padding:0 12px;border-color:${t().rule}">${sug[1]}</span>
          <span class="g-ghost" style="height:38px;padding:0 12px;border-color:${t().rule}">${sug[2]}</span>
        </div>
        <div style="display:flex;gap:18px;margin-top:10px;font:13px ${sans};color:${t().muted}"><span class="g-link" style="color:${t().muted}">Other collection</span><span>Skip</span></div>
      </div>`).join('')}
  </div>${KS.homeIndicator(t().ink)}`;
}

// --- Chrome popup -----------------------------------------------------------
function popup() {
  const lamp = KS.find('Adjustable desk lamp');
  return `<div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
      <span class="g-t" style="font-size:24px">Keepsake</span><span class="g-cap">Alt Shift K</span></div>
    <div style="height:210px;background:#F4F2EE url(${lamp.img}) center/contain no-repeat"></div>
    <div style="padding:16px 18px 0">
      <div class="g-cap" style="display:flex;align-items:center;gap:6px;color:${t().ink}">${KS.icon('check', 15, 1.8)} Saved</div>
      <div class="g-t" style="font-size:30px;margin-top:4px">Arc desk lamp, brushed brass</div>
      <div class="g-cap" style="margin-top:4px">Product · Northlight · $129.00</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding:11px 0;border-top:1px solid ${t().rule};border-bottom:1px solid ${t().rule};font:14px ${sans}">
        <span style="color:${t().muted}">In</span><span style="display:flex;align-items:center;gap:4px" class="g-link">Home Decor ${KS.icon('down', 14, 1.6)}</span></div>
      <div style="padding:11px 0;border-bottom:1px solid ${t().rule};font:14px ${sans};color:${t().muted}">Add a note</div>
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
        <span class="g-btn" style="flex:1;height:44px">Open in Keepsake</span>
        <span class="g-ghost" style="height:44px">${KS.icon('undo', 16, 1.6)} Undo</span></div>
    </div>
    <div style="margin-top:16px;padding:12px 18px;border-top:1px solid ${t().rule};display:flex;justify-content:space-between" class="g-cap"><span>Saved on this device</span><span class="g-link" style="color:${t().muted}">Settings</span></div>`;
}

// --- Dashboard ---------------------------------------------------------------
function side(on) {
  const k = ['product', 'place', 'recipe', 'book', 'media', 'workout', 'video', 'article'];
  const cnt = { product: 6, place: 8, recipe: 4, book: 3, media: 3, workout: 2, video: 1, article: 1 };
  const a = (n, c, cls = '') => `<a class="${cls}">${n}<b>${c ?? ''}</b></a>`;
  return `<nav class="g-side"><div class="wm">Keepsake</div>
    ${a('Home', '', on === 'Home' ? 'on' : '')}${a('Library', 28, on === 'Library' ? 'on' : '')}${a('Favorites', 1)}${a('Review', 3, on === 'Review' ? 'on' : '')}
    <div class="g-eyebrow">Lifestyle</div>${k.slice(1).map((x) => a(KS.kindPlural(x), cnt[x], on === x ? 'on' : '')).join('')}
    <div class="g-eyebrow">Collections</div>${KS.collections.map((c) => a(c, '')).join('')}
    <div style="flex:1"></div>${a('Settings', '')}</nav>`;
}
const bar = () => { const d = M === 'dark'; return `<div style="height:40px;background:${d ? '#1E1E1D' : '#ECECEA'};display:flex;align-items:center;gap:10px;padding:0 14px;font:13px ${sans}"><span style="display:flex;gap:7px"><i style="width:12px;height:12px;border-radius:50%;background:#ff5f57;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#febc2e;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c840;display:block"></i></span><span style="margin-left:14px;width:520px;height:26px;border-radius:13px;background:${d ? '#2E2E2C' : '#FFFFFF'};color:${d ? '#C9C4BA' : '#4A4A4A'};display:flex;align-items:center;padding:0 12px">chrome-extension://keepsake/dashboard</span></div>`; };
const dash = (on, main) => `${bar()}<div class="g-app">${side(on)}<main class="g-main">${main}</main></div>`;

function extLibrary() {
  const order = ['Tartine', 'Glass pour', 'Piranesi', 'Spaghetti', 'Kettlebell', 'Something from', 'Molded', 'Past Lives', 'Café de Flore', 'The case for', 'Shakshuka', 'Katz'].map(KS.find);
  const f = [['All', 28], ['Products', 6], ['Places', 8], ['Recipes', 4], ['Books', 3], ['Films & shows', 3], ['Workouts', 2], ['Videos', 1], ['Articles', 1]];
  return dash('Library', `
    <div style="display:flex;align-items:flex-end;justify-content:space-between">
      <div style="display:flex;align-items:baseline;gap:16px"><div class="g-t" style="font-size:60px;line-height:1">Library</div><span class="g-cap">28 saves</span></div>
      <div style="display:flex;gap:22px;align-items:center"><div class="g-input" style="width:300px">${KS.icon('search', 16, 1.5)}<span style="flex:1">Search your saves</span><span class="g-kbd">/</span></div>
      <span style="color:${t().ink}">${KS.icon('grid', 18, 1.5)}</span><span style="color:${t().muted}">${KS.icon('list', 18, 1.5)}</span></div></div>
    <div style="display:flex;gap:22px;margin-top:22px;padding-bottom:12px;border-bottom:1px solid ${t().rule};font:14px ${sans}">
      ${f.map(([n, c], k) => `<span style="color:${k ? t().muted : t().ink};${k ? '' : 'text-decoration:underline;text-underline-offset:6px;text-decoration-thickness:1px'}">${n} <span style="color:${t().faint}">${c}</span></span>`).join('')}
      <span style="flex:1"></span><span style="color:${t().muted}">Newest first</span></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:30px 22px;margin-top:24px">
      ${order.map((i) => `<div>${pic(i, { h: 236, size: 30 })}${wall(i, 21)}</div>`).join('')}
    </div>`);
}

function extRecipe() {
  const r = KS.find('Spaghetti'), d = r.details;
  return dash('recipe', `
    <div style="display:flex;gap:52px;height:100%">
      <div style="width:470px;flex:none">${pic(r, { h: 620 })}<div class="g-cap" style="margin-top:8px">Photo from recipes.example.org</div></div>
      <div style="flex:1;min-width:0;padding-top:4px">
        <div class="g-cap" style="display:flex;gap:6px;align-items:center"><span class="g-link" style="color:${t().muted}">Recipes</span> · Saved Oct 14 from recipes.example.org</div>
        <div class="g-t" style="font-size:62px;line-height:1;margin-top:12px">Spaghetti alla carbonara</div>
        <div class="g-cap" style="margin-top:10px;font-size:13px">6 ingredients · 4 steps · Cooked twice, last on Oct 12</div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:22px">
          <span class="g-btn">${KS.icon('flame', 17, 1.6)} Start cooking</span>
          <span class="g-ghost" style="height:48px">${KS.icon('check', 16, 1.6)} Cooked</span>
          <span class="g-quiet" style="margin-left:10px">${KS.icon('share', 16, 1.6)} Share</span>
          <span class="g-quiet" style="margin-left:10px">Edit</span>
          <span class="g-quiet" style="margin-left:10px">${KS.icon('link', 16, 1.6)} Open page</span></div>
        <div style="display:grid;grid-template-columns:240px 1fr;gap:40px;margin-top:34px">
          <div><div class="g-eyebrow" style="margin-bottom:8px">Ingredients</div>
            ${d.ingredients.map((x) => `<div style="padding:9px 0;border-top:1px solid ${t().rule};font:15px ${sans}">${esc(x)}</div>`).join('')}</div>
          <div><div class="g-eyebrow" style="margin-bottom:8px">Steps</div>
            ${d.steps.map((x, n) => `<div style="display:flex;gap:16px;padding:10px 0;border-top:1px solid ${t().rule}"><span class="g-t" style="font-size:24px;width:18px;line-height:1">${n + 1}</span><span style="font:15px/1.5 ${sans}">${esc(x)}</span></div>`).join('')}</div>
        </div>
      </div></div>`);
}

function extReview() {
  return dash('Review', `
    <div style="display:flex;align-items:baseline;gap:16px"><div class="g-t" style="font-size:60px;line-height:1">Review</div><span class="g-cap">3 saves</span></div>
    <div style="font:15px/1.5 ${sans};color:${t().muted};margin-top:10px;max-width:640px">Keepsake wasn’t sure where these go. Pick a collection and it learns from you. Use ↑ ↓ to move, <span class="g-kbd">1</span> <span class="g-kbd">2</span> <span class="g-kbd">3</span> to file, S to skip.</div>
    <div style="margin-top:26px;max-width:1000px">
    ${REVIEW().map(({ i, why, sug }, n) => `
      <div style="display:flex;gap:24px;padding:22px 20px;border-top:1px solid ${t().rule};${n === 0 ? `box-shadow:inset 2px 0 0 ${t().ink};background:${t().soft}` : ''}">
        ${pic(i, { w: '120px', h: 120, size: 17, cap: false })}
        <div style="flex:1;min-width:0">
          <div class="g-t" style="font-size:30px">${esc(i.title)}</div>
          <div class="g-cap" style="margin-top:4px;font-size:13px">${why}</div>
          <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
            <span class="g-btn" style="height:40px;padding:0 16px;font-size:14px"><span class="g-kbd" style="border-color:${t().onBtn}">1</span> ${sug[0]}</span>
            <span class="g-ghost" style="border-color:${t().rule}"><span class="g-kbd">2</span> ${sug[1]}</span>
            <span class="g-ghost" style="border-color:${t().rule}"><span class="g-kbd">3</span> ${sug[2]}</span>
            <span class="g-quiet" style="margin-left:14px"><span class="g-link" style="color:${t().muted}">Other collection</span></span>
            <span class="g-quiet" style="margin-left:14px">Skip</span>
            <span style="flex:1"></span><span class="g-quiet" style="padding-right:20px">Open</span></div>
        </div></div>`).join('')}
      <div style="border-top:1px solid ${t().rule}"></div></div>`);
}

window.KS_DIR = {
  name: 'Gallery',
  css,
  screens: {
    'ios-home': iosHome, 'ios-library': iosLibrary, 'ios-recipe': iosRecipe, 'ios-review': iosReview,
    'popup-saved': popup, 'ext-library': extLibrary, 'ext-recipe': extRecipe, 'ext-review': extReview,
  },
};
})();
