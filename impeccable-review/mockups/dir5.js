// Direction 5: Swiss Index. Hairlines, one signal red, every save numbered.
(() => {
  const ALL = KS.items.filter((i) => i.title !== 'Old phone case');
  const TOTAL = ALL.length; // 28
  // Index numbers: oldest save is No. 001.
  const byOld = [...ALL].sort((a, b) => a.created.localeCompare(b.created));
  const NO = new Map(byOld.map((it, i) => [it.id, i + 1]));
  const no = (it) => String(NO.get(it.id) || TOTAL + 1).padStart(3, '0');
  const count = (k) => ALL.filter((i) => i.kind === k).length;
  const CODE = { product: 'Pr', place: 'Pl', recipe: 'Rc', video: 'Vd', article: 'Ar', workout: 'Wk', media: 'Fm', book: 'Bk' };
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const I = (n, s = 18, w = 1.6) => KS.icon(n, s, w);

  const css = (mode) => {
    const dark = mode === 'dark';
    return `
:root{
  --bg:${dark ? '#0D0D0D' : '#FAFAF7'};
  --bg2:${dark ? '#171717' : '#F0F0EA'};
  --ink:${dark ? '#F5F5F0' : '#0A0A0A'};
  --mute:${dark ? '#A3A39C' : '#5C5C56'};
  --rule:${dark ? '#3A3A38' : '#D6D6CE'};
  --rule2:${dark ? '#F5F5F0' : '#0A0A0A'};
  --red:${dark ? '#F04438' : '#D92D20'};
  --onred:${dark ? '#0D0D0D' : '#FFFFFF'};
  --cell:${dark ? '#141414' : '#FFFFFF'};
}
body{background:var(--bg)}
#root{background:var(--bg);color:var(--ink);font:400 15px/1.35 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 1}
.cond{font-family:Archivo,Inter,sans-serif;font-stretch:62%;font-weight:700;letter-spacing:-.01em}
.ar{font-family:Archivo,Inter,sans-serif;font-stretch:100%}
.lab{font:600 11px/1 Archivo,Inter,sans-serif;font-stretch:100%;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.no{font:500 12px/1 'IBM Plex Mono',ui-monospace,monospace;color:var(--mute);letter-spacing:0}
.mute{color:var(--mute)}
.red{color:var(--red)}
.rule{border-top:1px solid var(--rule)}
.rule2{border-top:2px solid var(--rule2)}
img{display:block;object-fit:cover}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 16px;border:1px solid var(--rule2);background:transparent;color:var(--ink);font:600 15px/1 Archivo,Inter,sans-serif;font-stretch:100%;white-space:nowrap}
.btn.primary{background:var(--red);border-color:var(--red);color:var(--onred)}
.btn.black{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.btn.sm{height:32px;padding:0 12px;font-size:13px}
.key{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;border:1px solid currentColor;font:600 11px/1 'IBM Plex Mono',monospace;opacity:.85}
.typo{background:var(--cell);border:1px solid var(--rule);display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
/* iOS */
.ios .scroll{position:absolute;left:0;right:0;top:54px;bottom:83px;overflow:hidden}
.ios .tabbar{position:absolute;left:0;right:0;bottom:0;height:83px;background:var(--bg);border-top:1px solid var(--rule2);display:grid;grid-template-columns:repeat(4,1fr);padding-top:7px;z-index:40}
.ios .tab{display:flex;flex-direction:column;align-items:center;gap:3px;font:600 10px/1 Archivo,Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);position:relative}
.ios .tab.on{color:var(--ink)}
.ios .tab.on::before{content:"";position:absolute;top:-8px;left:28%;right:28%;height:3px;background:var(--ink)}
.ios .badge{position:absolute;top:-2px;left:56%;background:var(--red);color:var(--onred);font:700 11px/16px Archivo,sans-serif;min-width:16px;height:16px;text-align:center;padding:0 3px;letter-spacing:0}
.pad{padding:0 16px}
.row{display:flex;align-items:center}
.sq{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:1px solid var(--rule2);color:var(--ink)}
/* Desktop */
.ext .app{display:grid;grid-template-columns:232px 1fr;height:860px}
.side{border-right:1px solid var(--rule);padding:24px 0 16px;display:flex;flex-direction:column;font-family:Archivo,Inter,sans-serif;font-stretch:100%}
.side .brand{padding:0 24px 22px;font-size:30px;line-height:1}
.side .nav{display:flex;justify-content:space-between;align-items:center;height:32px;padding:0 24px 0 21px;border-left:3px solid transparent;font-size:14px;font-weight:500}
.side .nav.on{border-left-color:var(--red);font-weight:700}
.side .nav .c{font:500 12px 'IBM Plex Mono',monospace;color:var(--mute)}
.side .nav .c.red{color:var(--red);font-weight:600}
.side .sec{padding:18px 24px 6px}
.main{overflow:hidden;padding:0 40px}
.kbd{font:500 12px 'IBM Plex Mono',monospace}
`;
  };

  // A save's picture, or its typographic stand-in.
  const thumb = (it, w, h, big = false) => it.img
    ? `<img src="${it.img}" style="width:${w}px;height:${h}px" alt="">`
    : big
      ? `<div class="typo" style="width:${w}px;height:${h}px;padding:10px 12px"><span class="lab">${KS.kindLabel(it.kind)}</span><span class="cond" style="font-size:${Math.round(h * 0.42)}px;line-height:.85">${no(it)}</span></div>`
      : `<div class="typo" style="width:${w}px;height:${h}px;align-items:center;justify-content:center"><span class="cond" style="font-size:${Math.round(h * 0.42)}px;line-height:1">${CODE[it.kind] || 'Ln'}</span></div>`;

  const tabbar = (on, mode) => `<div class="tabbar">${[['home', 'Home'], ['library', 'Library'], ['map', 'Places'], ['search', 'Search']].map(([ic, t]) =>
    `<div class="tab ${t === on ? 'on' : ''}">${I(ic, 24, t === on ? 2.2 : 1.6)}<span>${t}</span>${t === 'Home' ? '<span class="badge">2</span>' : ''}</div>`).join('')}</div>${KS.homeIndicator(mode === 'dark' ? '#F5F5F0' : '#0A0A0A')}`;

  const status = (mode) => KS.statusBar(mode === 'dark' ? '#F5F5F0' : '#0A0A0A');

  // ---------- iPhone ----------
  const iosHome = (mode) => {
    const recent = ALL.slice(0, 3);
    const back = ['Café de Flore', 'Braiding Sweetgrass', 'Lemon olive oil cake', 'Paris, Texas'].map((t) => KS.find(t));
    return `${status(mode)}<div class="scroll">
  <div class="pad" style="padding-top:8px;display:flex;justify-content:space-between;align-items:flex-end">
    <div><div class="cond" style="font-size:44px;line-height:.9">Keepsake</div>
    <div class="ar mute" style="font-size:13px;margin-top:6px">28 saves · 6 collections · on this iPhone</div></div>
    <div class="sq">${I('settings', 18)}</div>
  </div>
  <div style="margin:16px 16px 0;border-top:2px solid var(--rule2);border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:14px;padding:12px 0">
    <span class="cond red" style="font-size:52px;line-height:.8">2</span>
    <div style="flex:1"><div style="font-weight:600">saves need a collection</div><div class="mute" style="font-size:13px">Keepsake wasn’t sure where they go.</div></div>
    <span class="ar red" style="font-weight:700;font-size:15px;display:flex;align-items:center">File${I('chevron', 16, 2.2)}</span>
  </div>
  <div class="pad" style="margin-top:20px;display:flex;justify-content:space-between;align-items:baseline"><span class="lab" style="color:var(--ink)">Recent</span><span class="lab">See all</span></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 16px 0">
    ${recent.map((it) => `<div>${thumb(it, 115, 115, true)}<div class="no" style="margin-top:8px">No. ${no(it)}</div>
      <div style="font:600 14px/1.2 Inter;margin-top:4px;height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(it.title)}</div>
      <div class="mute" style="font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(KS.fact(it) || KS.kindLabel(it.kind))}</div></div>`).join('')}
  </div>
  <div style="margin:18px 16px 0">
    ${[['Collections', '6', 'Kitchen, Coffee corner, Home Decor…'], ['Lifestyle', '7', 'Places, recipes, books, films…']].map(([t, n, s]) => `
    <div style="display:flex;align-items:center;border-top:1px solid var(--rule);padding:10px 0">
      <div style="flex:1"><div class="ar" style="font-weight:700;font-size:17px">${t}</div><div class="mute" style="font-size:13px">${s}</div></div>
      <span class="cond" style="font-size:36px;line-height:1;margin-right:6px">${n}</span><span class="mute">${I('chevron', 18)}</span></div>`).join('')}
  </div>
  <div class="pad" style="margin-top:14px;border-top:2px solid var(--rule2);margin-left:16px;margin-right:16px;padding:10px 0 0"><span class="lab" style="color:var(--ink)">Come back to</span></div>
  <div style="margin:0 16px">
    ${back.map((it) => `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--rule)">
      <span class="no" style="width:28px">${no(it)}</span>${thumb(it, 40, 40)}
      <div style="flex:1;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.title)}</div><div class="mute" style="font-size:13px">${esc(KS.fact(it))}</div></div>
      <span class="lab">${KS.kindLabel(it.kind)}</span></div>`).join('')}
  </div>
</div>${tabbar('Home', mode)}`;
  };

  const iosLibrary = (mode) => {
    const rows = ALL.slice(0, 10);
    return `${status(mode)}<div class="scroll">
  <div class="pad" style="padding-top:8px;display:flex;justify-content:space-between;align-items:flex-end">
    <div class="cond" style="font-size:44px;line-height:.9">Library</div>
    <div style="text-align:right"><span class="cond" style="font-size:44px;line-height:.9">28</span><div class="lab" style="margin-top:4px">saves</div></div>
  </div>
  <div style="margin:14px 16px 0;height:40px;border:1px solid var(--rule2);display:flex;align-items:center;gap:8px;padding:0 12px" class="mute">${I('search', 18)}<span>Search 28 saves</span></div>
  <div style="display:flex;gap:18px;padding:14px 16px 0;white-space:nowrap;overflow:hidden;font:600 14px Archivo,sans-serif;font-stretch:100%;border-bottom:1px solid var(--rule);margin:0 0 0 0">
    <span style="border-bottom:3px solid var(--ink);padding-bottom:9px">All <span class="no" style="color:var(--ink)">28</span></span>
    ${['place', 'product', 'recipe', 'media', 'book', 'workout'].map((k) => `<span class="mute" style="padding-bottom:9px">${KS.kindPlural(k)} <span class="no">${count(k)}</span></span>`).join('')}
  </div>
  <div style="display:flex;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--rule)"><span class="lab">No. · Newest first</span><span class="lab" style="display:flex;gap:10px;align-items:center"><span style="color:var(--ink)">${I('list', 16, 2)}</span>${I('grid', 16, 1.6)}</span></div>
  ${rows.map((it) => `<div style="display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid var(--rule)">
    <span class="no" style="width:28px">${no(it)}</span>${thumb(it, 44, 44)}
    <div style="flex:1;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.title)}</div>
    <div class="mute" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(KS.fact(it) || it.host)}</div></div>
    <span class="lab" style="width:64px;text-align:right;letter-spacing:.04em;font-size:10px">${KS.kindLabel(it.kind).replace('Film or show', 'Film')}</span></div>`).join('')}
</div>${tabbar('Library', mode)}`;
  };

  const iosRecipe = (mode) => {
    const it = KS.find('Spaghetti'), d = it.details;
    return `${status(mode)}<div class="scroll" style="bottom:96px">
  <div class="pad" style="display:flex;justify-content:space-between;align-items:center;padding-top:4px">
    <span class="ar" style="display:flex;align-items:center;font-weight:600;font-size:16px;margin-left:-6px">${I('back', 22, 2)}Library</span>
    <div class="sq">${I('more', 18, 2.4)}</div>
  </div>
  <div style="margin:12px 16px 0">${thumb(it, 361, 190, true)}</div>
  <div class="pad" style="margin-top:12px;display:flex;gap:10px;align-items:center"><span class="no">No. ${no(it)}</span><span class="lab" style="color:var(--ink)">Recipe</span><span class="lab">recipes.example.org</span></div>
  <div class="pad cond" style="font-size:40px;line-height:.95;margin-top:6px">Spaghetti alla carbonara</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);margin:14px 16px 0;border-top:2px solid var(--rule2);border-bottom:1px solid var(--rule)">
    ${[[d.ingredients.length, 'Ingredients'], [d.steps.length, 'Steps'], ['0', 'Times cooked']].map(([n, l], i) => `<div style="padding:8px 0 8px ${i ? 12 : 0}px;${i ? 'border-left:1px solid var(--rule)' : ''}"><div class="cond" style="font-size:30px;line-height:1">${n}</div><div class="lab" style="margin-top:4px">${l}</div></div>`).join('')}
  </div>
  <div class="pad" style="margin-top:14px"><span class="lab" style="color:var(--ink)">Ingredients</span></div>
  <div style="margin:4px 16px 0">${d.ingredients.map((g, i) => `<div style="display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--rule);font-size:16px"><span class="no" style="width:20px;padding-top:3px">${String(i + 1).padStart(2, '0')}</span>${esc(g)}</div>`).join('')}</div>
</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:96px;border-top:1px solid var(--rule2);background:var(--bg);display:flex;gap:8px;padding:10px 16px 0">
  <span class="btn" style="width:52px;height:52px;padding:0;flex-direction:column;gap:2px;font-size:10px;letter-spacing:.04em;text-transform:uppercase">${I('check', 18, 2.2)}Cooked</span>
  <span class="btn primary" style="flex:1;height:52px;font-size:17px">${I('flame', 20, 2)}Start cooking</span>
  <span class="btn" style="width:52px;height:52px;padding:0;flex-direction:column;gap:2px;font-size:10px;letter-spacing:.04em;text-transform:uppercase">${I('share', 18, 2)}Share</span>
</div>${KS.homeIndicator(mode === 'dark' ? '#F5F5F0' : '#0A0A0A')}`;
  };

  const REVIEW = [
    { title: 'Dutch oven (the blue one)', kind: 'product', img: '', host: 'Example Shop', no: '029', why: 'Your keyword “dutch oven” is in the title.', sug: ['Kitchen', 'Home Decor', 'Coffee corner'] },
    { title: 'Adjustable desk lamp', kind: 'product', img: 'img/adjustable-desk-lamp.jpg', host: 'Example Design', no: null, why: '“Desk lamp” is in the title.', sug: ['Home Decor', 'Technology', 'Kitchen'] },
    { title: 'Something from a newsletter', kind: 'product', img: '', host: 'Example', no: null, why: 'Nothing on the page said what this is.', sug: ['Home Decor', 'Kitchen', 'Clothing'] },
  ].map((r) => {
    const real = KS.find(r.title);
    return { ...r, id: real ? real.id : r.title, no: r.no || (real ? no(real) : '030') };
  });
  const rthumb = (r, s) => thumb(r, s, s);

  const iosReview = (mode) => `${status(mode)}<div class="scroll">
  <div class="pad" style="display:flex;justify-content:space-between;align-items:center;padding-top:4px">
    <span class="ar" style="display:flex;align-items:center;font-weight:600;font-size:16px;margin-left:-6px">${I('back', 22, 2)}Home</span>
  </div>
  <div class="pad" style="display:flex;align-items:flex-end;gap:12px;margin-top:6px">
    <span class="cond red" style="font-size:64px;line-height:.8">3</span>
    <div><div class="cond" style="font-size:30px;line-height:.95">Review</div><div class="mute" style="font-size:13px;margin-top:2px">Tap where each save belongs. Keepsake learns.</div></div>
  </div>
  ${REVIEW.map((r, i) => `<div style="margin:${i ? 0 : 16}px 16px 0;border-top:2px solid var(--rule2);padding:12px 0 14px">
    <div style="display:flex;gap:12px">${rthumb(r, 56)}
      <div style="flex:1;min-width:0"><div class="no">No. ${r.no} · ${r.host}</div><div style="font-weight:600;font-size:16px;margin-top:3px">${esc(r.title)}</div><div class="mute" style="font-size:13px">${esc(r.why)}</div></div></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <span class="btn black" style="flex:1.25;height:40px;font-size:14px;padding:0 10px">${esc(r.sug[0])}</span>
      <span class="btn" style="flex:1;height:40px;font-size:14px;padding:0 10px">${esc(r.sug[1])}</span>
      <span class="btn" style="flex:1;height:40px;font-size:14px;padding:0 10px">${esc(r.sug[2])}</span>
    </div>
    <div style="display:flex;gap:18px;margin-top:8px;font:600 13px Archivo,sans-serif;font-stretch:100%"><span>Other collection…</span><span class="mute">Skip</span></div>
  </div>`).join('')}
</div>${tabbar('Home', mode)}`;

  // ---------- Chrome popup ----------
  const popup = (mode) => `<div style="display:flex;justify-content:space-between;align-items:center;height:48px;padding:0 16px;border-bottom:2px solid var(--rule2)">
    <span class="cond" style="font-size:24px;line-height:1">Keepsake</span>
    <span class="ar" style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:4px">Library${I('chevron', 14, 2)}</span></div>
  <div style="padding:16px 16px 0;display:flex;align-items:baseline;justify-content:space-between">
    <span class="cond" style="font-size:40px;line-height:.9">Saved</span><span class="no" style="font-size:13px;color:var(--ink)">No. 029</span></div>
  <div style="display:flex;gap:14px;padding:14px 16px 16px">
    <img src="img/adjustable-desk-lamp.jpg" style="width:88px;height:88px" alt="">
    <div><div style="font-weight:600;font-size:16px;line-height:1.25">Arc desk lamp, brushed brass</div>
      <div class="mute" style="font-size:13px;margin-top:4px">$129.00 · Northlight</div>
      <div class="lab" style="margin-top:10px">Product</div></div>
  </div>
  <div style="margin:0 16px;border-top:1px solid var(--rule)">
    <div style="display:flex;align-items:center;height:48px;border-bottom:1px solid var(--rule)"><span class="lab" style="width:96px">Collection</span><span style="flex:1;font-weight:600">Home Decor</span><span class="ar" style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:2px">Change${I('down', 14, 2)}</span></div>
    <div style="display:flex;align-items:center;height:48px;border-bottom:1px solid var(--rule)"><span class="lab" style="width:96px">Note</span><span class="mute" style="flex:1">Add a note</span></div>
  </div>
  <div style="display:flex;gap:8px;padding:16px">
    <span class="btn" style="width:104px">${I('undo', 16, 2)}Undo</span>
    <span class="btn primary" style="flex:1">Open in Keepsake</span>
  </div>
  <div style="display:flex;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--rule)"><span class="mute" style="font-size:12px">Saved on this device</span><span class="kbd mute">⌥⇧K</span></div>`;

  // ---------- Dashboard ----------
  const side = (on) => `<aside class="side">
    <div class="brand cond">Keepsake</div>
    ${[['Home', ''], ['Library', '28'], ['Favorites', '1'], ['Review', '3']].map(([t, c]) => `<div class="nav ${t === on ? 'on' : ''}"><span>${t}</span><span class="c ${t === 'Review' ? 'red' : ''}">${c}</span></div>`).join('')}
    <div class="sec lab">Kinds</div>
    ${['place', 'product', 'recipe', 'media', 'book', 'workout', 'video', 'article'].map((k) => `<div class="nav ${KS.kindPlural(k) === on ? 'on' : ''}"><span>${KS.kindPlural(k)}</span><span class="c">${count(k)}</span></div>`).join('')}
    <div class="sec lab">Collections</div>
    ${KS.collections.map((c) => `<div class="nav"><span>${c}</span><span class="c">${({ Kitchen: 1, 'Coffee corner': 1, 'Home Decor': 1, Running: 1 })[c] || ''}</span></div>`).join('')}
    <div style="flex:1"></div>
    <div style="border-top:1px solid var(--rule);padding:12px 24px 0"><div style="display:flex;gap:8px;align-items:center;font-weight:500;font-size:14px">${I('settings', 16)}Settings</div><div class="mute" style="font:400 12px Inter,sans-serif;margin-top:8px">Saved on this device. No account.</div></div>
  </aside>`;
  const bar = (mode) => KS.browserBar(mode === 'dark' ? '#202020' : '#E6E6E0', '#3A3A36');

  const extLibrary = (mode) => {
    const cells = ALL.slice(0, 18);
    return `${bar(mode)}<div class="app">${side('Library')}<main class="main">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;padding-top:28px;border-bottom:2px solid var(--rule2);padding-bottom:12px">
      <span class="cond" style="font-size:72px;line-height:.8">Library</span>
      <span style="display:flex;align-items:flex-end;gap:10px"><span class="cond" style="font-size:72px;line-height:.8">28</span><span class="lab" style="padding-bottom:4px">saves</span></span>
    </div>
    <div style="display:flex;align-items:center;gap:24px;height:56px;border-bottom:1px solid var(--rule);font:500 14px Archivo,sans-serif;font-stretch:100%">
      <span style="display:flex;align-items:center;gap:8px;width:300px;height:36px;border:1px solid var(--rule2);padding:0 10px" class="mute">${I('search', 16)}Search your saves<span style="flex:1"></span><span class="key">/</span></span>
      ${[['Kind', 'All'], ['Status', 'Any'], ['Source', 'Any'], ['Sort', 'Newest']].map(([a, b]) => `<span><span class="mute">${a}</span> <b>${b}</b> <span class="mute" style="vertical-align:-3px">${I('down', 14, 2)}</span></span>`).join('')}
      <span style="flex:1"></span>
      <span style="display:flex;border:1px solid var(--rule2)"><span style="padding:6px 10px;display:flex;gap:6px;align-items:center">${I('list', 16, 2)}List</span><span style="padding:6px 10px;display:flex;gap:6px;align-items:center;background:var(--ink);color:var(--bg)">${I('grid', 16, 2)}Grid</span></span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);border-left:1px solid var(--rule);margin-top:20px">
      ${cells.map((it) => `<div style="border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);border-top:1px solid var(--rule);padding:10px;margin-top:-1px">
        ${thumb(it, 154, 116, true)}
        <div style="display:flex;justify-content:space-between;margin-top:10px"><span class="no">${it.img ? 'No. ' + no(it) : '&nbsp;'}</span><span class="lab" style="font-size:10px">${KS.kindLabel(it.kind).replace('Film or show', 'Film')}</span></div>
        <div style="font-weight:600;font-size:14px;line-height:1.25;margin-top:6px;height:36px;overflow:hidden">${esc(it.title)}</div>
        <div class="mute" style="font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(KS.fact(it) || it.host)}</div>
      </div>`).join('')}
    </div></main></div>`;
  };

  const extRecipe = (mode) => {
    const it = KS.find('Spaghetti'), d = it.details;
    return `${bar(mode)}<div class="app">${side('Recipes')}<main class="main">
    <div class="lab" style="padding-top:24px;display:flex;gap:8px"><span>Library</span><span>/</span><span>Recipes</span><span>/</span><span style="color:var(--ink)">No. ${no(it)}</span></div>
    <div style="display:grid;grid-template-columns:1fr 420px;gap:40px;margin-top:14px;border-top:2px solid var(--rule2);padding-top:20px">
      <div>
        <div class="cond" style="font-size:76px;line-height:.85">Spaghetti alla carbonara</div>
        <div style="display:flex;gap:8px;margin-top:22px">
          <span class="btn primary" style="padding:0 22px">${I('flame', 18, 2)}Start cooking</span>
          <span class="btn">${I('check', 16, 2)}Mark cooked</span>
          <span class="btn">${I('share', 16, 2)}Share</span>
          <span class="btn" style="border-color:transparent">Edit</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1.35fr;gap:32px;margin-top:28px">
          <div><div class="lab" style="color:var(--ink);padding-bottom:8px;border-bottom:2px solid var(--rule2)">Ingredients · ${d.ingredients.length}</div>
            ${d.ingredients.map((g, i) => `<div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid var(--rule)"><span class="no" style="padding-top:3px">${String(i + 1).padStart(2, '0')}</span>${esc(g)}</div>`).join('')}</div>
          <div><div class="lab" style="color:var(--ink);padding-bottom:8px;border-bottom:2px solid var(--rule2)">Steps · ${d.steps.length}</div>
            ${d.steps.map((s, i) => `<div style="display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--rule)"><span class="cond" style="font-size:28px;line-height:.9;width:22px">${i + 1}</span><span>${esc(s)}</span></div>`).join('')}</div>
        </div>
      </div>
      <div>
        <img src="${it.img}" style="width:420px;height:300px" alt="">
        <div style="margin-top:16px">${[['Source', 'recipes.example.org'], ['Saved', 'Oct 14, 2026'], ['Collection', 'None yet'], ['Kind', 'Recipe'], ['Cooked', 'Not yet']].map(([a, b]) => `<div style="display:flex;padding:9px 0;border-bottom:1px solid var(--rule)"><span class="lab" style="width:110px;padding-top:3px">${a}</span><span>${b}</span></div>`).join('')}</div>
      </div>
    </div></main></div>`;
  };

  const extReview = (mode) => `${bar(mode)}<div class="app">${side('Review')}<main class="main">
    <div style="display:flex;align-items:flex-end;gap:20px;padding-top:28px;padding-bottom:14px;border-bottom:2px solid var(--rule2)">
      <span class="cond red" style="font-size:96px;line-height:.78">3</span>
      <div><div class="cond" style="font-size:44px;line-height:.9">Review</div><div class="mute" style="margin-top:6px">These saves need a collection. Pick one and Keepsake learns from it.</div></div>
    </div>
    <div style="display:grid;grid-template-columns:64px 1fr 520px 96px;padding:10px 0;border-bottom:1px solid var(--rule)" class="lab"><span>No.</span><span>Save</span><span>Suggested collection</span><span style="text-align:right">More</span></div>
    ${REVIEW.map((r, i) => `<div style="display:grid;grid-template-columns:64px 1fr 520px 96px;align-items:center;padding:16px 0;border-bottom:1px solid var(--rule);${i === 0 ? 'background:var(--bg2);box-shadow:inset 3px 0 0 var(--red);margin:0 -16px;padding-left:16px;padding-right:16px' : ''}">
      <span class="no" style="color:var(--ink)">${r.no}</span>
      <div style="display:flex;gap:14px;align-items:center">${rthumb(r, 64)}<div><div style="font-weight:600;font-size:16px">${esc(r.title)}</div><div class="mute" style="font-size:13px;margin-top:2px">${r.host} · ${esc(r.why)}</div></div></div>
      <div style="display:flex;gap:8px">
        ${r.sug.map((s, j) => `<span class="btn ${j === 0 ? 'black' : ''}" style="flex:${j === 0 ? 1.2 : 1};justify-content:flex-start;padding:0 12px"><span class="key">${j + 1}</span>${esc(s)}</span>`).join('')}
      </div>
      <div style="text-align:right;font:600 13px Archivo,sans-serif;font-stretch:100%;line-height:1.7"><div>Other…</div><div class="mute">Skip</div></div>
    </div>`).join('')}
    <div class="mute kbd" style="display:flex;gap:28px;margin-top:20px"><span><span class="key">↑</span> <span class="key">↓</span> move</span><span><span class="key">1</span> <span class="key">2</span> <span class="key">3</span> file</span><span><span class="key">O</span> other collection</span><span><span class="key">S</span> skip</span><span><span class="key">⌫</span> move to Trash</span></div>
  </main></div>`;

  window.KS_DIR = {
    name: 'Swiss Index',
    css,
    screens: {
      'ios-home': iosHome, 'ios-library': iosLibrary, 'ios-recipe': iosRecipe, 'ios-review': iosReview,
      'popup-saved': popup, 'ext-library': extLibrary, 'ext-recipe': extRecipe, 'ext-review': extReview,
    },
  };
})();
