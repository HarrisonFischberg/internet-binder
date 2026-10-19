// Direction 3: Pantry Pop. Labelled jars on a cream shelf: thick ink outlines, hard shadows, one
// saturated colour per kind, always with ink text on it.
(() => {
  const KC = { recipe: '#FF5A36', place: '#12A08F', product: '#FFC23D', media: '#8E6CEF', book: '#4DA3FF', workout: '#9BD13B', video: '#FF7AB6', article: '#FF9A3D' };
  const ROT = [-4, 3, -2, 4, -3, 2];
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const css = (mode) => {
    const dark = mode === 'dark';
    return `
:root{
  --bg:${dark ? '#1B1A17' : '#FFF7E8'};
  --card:${dark ? '#26241F' : '#FFFFFF'};
  --well:${dark ? '#302D27' : '#F6EAD3'};
  --ink:${dark ? '#FFF7E8' : '#16130F'};
  --line:${dark ? '#FFF7E8' : '#16130F'};
  --muted:${dark ? '#CFC6B4' : '#5B5348'};
  --on:#16130F;
  --shadow:${dark ? '#000000' : '#16130F'};
  --primary-bg:${dark ? '#FFC23D' : '#16130F'};
  --primary-ink:${dark ? '#16130F' : '#FFF7E8'};
  --tab:${dark ? '#24221E' : '#FFFDF7'};
}
.frame{background:var(--bg);color:var(--ink);font-family:Nunito,Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.t{font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;letter-spacing:-.02em;line-height:1.02}
.box{background:var(--card);border:2.5px solid var(--line);border-radius:20px;box-shadow:4px 4px 0 var(--shadow)}
.box.flat{box-shadow:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:2.5px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);font:800 15px Nunito,sans-serif;padding:9px 16px;box-shadow:3px 3px 0 var(--shadow);white-space:nowrap}
.btn.primary{background:var(--primary-bg);color:var(--primary-ink);border-color:var(--line)}
.btn.big{font-size:19px;padding:16px 22px;border-radius:22px;box-shadow:5px 5px 0 var(--shadow)}
.btn.pressed{transform:translate(3px,3px);box-shadow:0 0 0 var(--shadow)}
.btn.ghost{box-shadow:none;background:transparent}
.sticker{display:inline-flex;align-items:center;gap:5px;border:2px solid #16130F;border-radius:999px;color:#16130F;font:800 12px Nunito,sans-serif;padding:3px 9px 3px 7px;box-shadow:2px 2px 0 #16130F;white-space:nowrap}
.chip{display:inline-flex;align-items:center;gap:6px;border:2.5px solid var(--line);border-radius:999px;font:800 14px Nunito,sans-serif;padding:7px 13px;background:var(--card);color:var(--ink);white-space:nowrap}
.chip.on{background:var(--ink);color:var(--bg)}
.chip .n{font-weight:700;opacity:.75}
.muted{color:var(--muted)}
.img{display:block;width:100%;height:100%;object-fit:cover}
.jar{display:flex;flex-direction:column;justify-content:space-between;color:#16130F;padding:14px;height:100%;position:relative;overflow:hidden}
.jar .jt{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;letter-spacing:-.02em;line-height:1.02}
.jar .lid{position:absolute;left:0;right:0;top:0;height:12px;background:repeating-linear-gradient(90deg,rgba(22,19,15,.18) 0 3px,transparent 3px 8px)}
.kbd{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:2px solid currentColor;border-radius:7px;font:800 12px 'JetBrains Mono',monospace}
.scroll-hide::-webkit-scrollbar{display:none}
`;
  };

  // A save's picture, or its jar label when it has none.
  const pic = (i, { h = 140, titleSize = 20, radius = 0 } = {}) => i.img
    ? `<div style="height:${h}px;overflow:hidden;border-radius:${radius}px"><img class="img" src="${i.img}"></div>`
    : `<div style="height:${h}px;background:${KC[i.kind]};border-radius:${radius}px"><div class="jar"><div class="lid"></div><span style="margin-top:6px">${KS.icon(i.kind, 22, 2.4)}</span><div class="jt" style="font-size:${titleSize}px">${esc(i.title)}</div></div></div>`;
  const sticker = (k, rot = -3, extra = '') => `<span class="sticker" style="background:${KC[k]};transform:rotate(${rot}deg);${extra}">${KS.icon(k, 13, 2.6)}${KS.kindLabel(k)}</span>`;

  const card = (i, n, { h = 130, w = '' } = {}) => !i.img ? `
    <div class="box" style="overflow:hidden;position:relative;background:${KC[i.kind]};${w ? `width:${w}px;flex:none;` : ''}">
      <div class="jar" style="min-height:${h + 74}px;padding:22px 14px 14px"><div class="lid"></div>
        <span style="display:inline-flex;align-items:center;gap:5px;font:900 12px Nunito;letter-spacing:.06em;text-transform:uppercase">${KS.icon(i.kind, 15, 2.6)}${KS.kindLabel(i.kind)}</span>
        <div><div class="jt" style="font-size:${i.title.length > 22 ? 21 : 25}px;margin-bottom:6px">${esc(i.title)}</div>
        <div style="font:800 13px Nunito">${esc(KS.fact(i) || i.retailer || i.host)}</div></div>
      </div>
    </div>` : `
    <div class="box" style="overflow:hidden;position:relative;${w ? `width:${w}px;flex:none;` : ''}">
      ${pic(i, { h, titleSize: 19 })}
      <div style="border-top:2.5px solid var(--line);padding:12px 12px 13px">
        ${i.img ? '' : ''}
        <div class="t" style="font-size:17px;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(i.title)}</div>
        <div class="muted" style="font-size:13px;font-weight:700">${esc(KS.fact(i) || i.retailer || i.host)}</div>
      </div>
      ${i.img ? sticker(i.kind, ROT[n % ROT.length], 'position:absolute;top:10px;left:10px') : ''}
    </div>`;

  const iosTabs = (active, mode, badge = 2) => {
    const tabs = [['home', 'Home'], ['library', 'Library'], ['map', 'Places'], ['search', 'Search']];
    return `<div style="position:absolute;left:0;right:0;bottom:0;height:86px;background:var(--tab);border-top:2.5px solid var(--line);display:flex;justify-content:space-around;padding:8px 10px 0;z-index:40">
      ${tabs.map(([ic, l]) => {
        const on = l === active;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;width:74px;position:relative">
          <div style="width:52px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;${on ? 'background:#FFC23D;color:#16130F;border:2.5px solid var(--line)' : 'color:var(--ink)'}">${KS.icon(ic, 21, 2.3)}</div>
          <span style="font:800 11px Nunito;color:${on ? 'var(--ink)' : 'var(--muted)'}">${l}</span>
          ${l === 'Home' && badge ? `<span style="position:absolute;top:-4px;right:10px;background:#FF5A36;color:#16130F;border:2px solid var(--line);border-radius:999px;font:900 11px Nunito;min-width:20px;height:20px;display:flex;align-items:center;justify-content:center">${badge}</span>` : ''}
        </div>`;
      }).join('')}
    </div>${KS.homeIndicator(mode === 'dark' ? '#FFF7E8' : '#16130F')}`;
  };
  const GEAR = (sz) => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"><path d="M10.3 2.8h3.4l.5 2.6 1.9 1.1 2.5-.9 1.7 2.9-2 1.7v2.2l2 1.7-1.7 2.9-2.5-.9-1.9 1.1-.5 2.6h-3.4l-.5-2.6-1.9-1.1-2.5.9-1.7-2.9 2-1.7v-2.2l-2-1.7 1.7-2.9 2.5.9 1.9-1.1z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const round = (ic) => `<div style="width:44px;height:44px;border-radius:50%;border:2.5px solid var(--line);background:var(--card);box-shadow:3px 3px 0 var(--shadow);display:flex;align-items:center;justify-content:center;color:var(--ink)">${ic === 'settings' ? GEAR(20) : KS.icon(ic, 20, 2.4)}</div>`;

  // ---------- iPhone ----------
  const iosHome = (mode) => {
    const recent = KS.items.filter((i) => i.img).slice(0, 4);
    const comeBack = [KS.find('Café de Flore'), KS.find('Piranesi'), KS.find('Lemon olive')];
    const thumbs = (arr) => arr.map((i, n) => `<div style="position:absolute;left:${n * 20}px;top:${n % 2 ? 4 : 0}px;width:40px;height:48px;border:2px solid #16130F;border-radius:9px;overflow:hidden;transform:rotate(${ROT[n] * 1.5}deg);background:#fff">${i.img ? `<img class="img" src="${i.img}">` : ''}</div>`).join('');
    return `${KS.statusBar(mode === 'dark' ? '#FFF7E8' : '#16130F')}
    <div style="position:absolute;top:54px;left:0;right:0;bottom:86px;overflow:hidden;padding:6px 20px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="t" style="font-size:40px">Keepsake</div>${round('settings')}
      </div>
      <div class="box" style="background:#FFC23D;color:#16130F;padding:13px 14px;display:flex;align-items:center;gap:12px;margin-bottom:22px">
        <div style="width:40px;height:40px;border-radius:12px;background:#FFF7E8;border:2.5px solid #16130F;display:flex;align-items:center;justify-content:center;transform:rotate(-5deg)">${KS.icon('inbox', 21, 2.4)}</div>
        <div style="flex:1"><div class="t" style="font-size:18px">3 saves need a collection</div><div style="font:700 13.5px Nunito">One tap each, and Keepsake learns.</div></div>
        <div style="color:#16130F">${KS.icon('chevron', 22, 2.8)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px"><div class="t" style="font-size:24px">Recent</div><span style="font:800 14px Nunito" class="muted">See all</span></div>
      <div style="display:flex;gap:14px;margin-right:-20px;margin-bottom:24px">${recent.map((i, n) => card(i, n, { h: 112, w: 158 })).join('')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">
        <div class="box" style="background:#12A08F;color:#16130F;padding:14px;height:124px;position:relative">
          <div style="position:relative;height:52px">${thumbs([KS.find('Molded'), KS.find('Stoneware'), KS.find('Cushioned')])}</div>
          <div class="t" style="font-size:20px;margin-top:6px">Collections</div><div style="font:800 13px Nunito">6 collections</div>
        </div>
        <div class="box" style="background:#FF7AB6;color:#16130F;padding:14px;height:124px;position:relative">
          <div style="position:relative;height:52px">${thumbs([KS.find('Tartine'), KS.find('Shakshuka'), KS.find('Kettlebell')])}</div>
          <div class="t" style="font-size:20px;margin-top:6px">Lifestyle</div><div style="font:800 13px Nunito">7 kinds · 22 saves</div>
        </div>
      </div>
      <div class="t" style="font-size:24px;margin-bottom:10px">Come back to</div>
      <div style="display:flex;gap:14px;margin-right:-20px">${comeBack.map((i, n) => card(i, n + 2, { h: 112, w: 158 })).join('')}</div>
    </div>${iosTabs('Home', mode, 3)}`;
  };

  const iosLibrary = (mode) => {
    const pick = ['Piranesi', 'Glass pour', 'Tartine', 'Past Lives', 'Shakshuka', 'How to fold', 'Kettlebell', 'The case for'].map(KS.find);
    const kinds = KS.kinds.filter((k) => KS.count(k));
    return `${KS.statusBar(mode === 'dark' ? '#FFF7E8' : '#16130F')}
    <div style="position:absolute;top:54px;left:0;right:0;bottom:86px;overflow:hidden;padding:6px 20px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div><div class="t" style="font-size:40px">Library</div><div class="muted" style="font:800 14px Nunito;margin-top:2px">29 saves in 6 collections</div></div>${round('more')}
      </div>
      <div class="box flat" style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:16px;margin-bottom:12px;color:var(--muted);font:700 16px Nunito">${KS.icon('search', 20, 2.4)}Search 29 saves</div>
      <div class="scroll-hide" style="display:flex;gap:8px;margin:0 -20px 16px;padding:0 20px 4px;overflow:hidden">
        <span class="chip on">All</span>
        ${kinds.map((k) => `<span class="chip" style="background:${KC[k]};color:#16130F">${KS.icon(k, 15, 2.5)}${KS.kindPlural(k)} <span class="n">${KS.count(k)}</span></span>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${pick.map((i, n) => card(i, n, { h: i.img ? 118 : 118 })).join('')}
      </div>
    </div>${iosTabs('Library', mode, 3)}`;
  };

  const iosRecipe = (mode) => {
    const r = KS.find('Spaghetti');
    const ing = r.details.ingredients;
    return `${KS.statusBar(mode === 'dark' ? '#FFF7E8' : '#16130F')}
    <div style="position:absolute;top:54px;left:0;right:0;bottom:112px;overflow:hidden;padding:4px 20px 0">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">${round('back')}${round('more')}</div>
      <div class="box" style="overflow:hidden;position:relative;height:188px"><img class="img" src="${r.img}"></div>
      <div style="margin:-14px 0 0 14px;position:relative;z-index:2">${sticker('recipe', -4, 'font-size:13px;padding:4px 11px 4px 9px')}</div>
      <div class="t" style="font-size:34px;margin:10px 0 6px">Spaghetti alla carbonara</div>
      <div class="muted" style="font:700 14.5px Nunito;margin-bottom:12px">recipes.example.org · 6 ingredients · 4 steps</div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <span class="btn" style="font-size:14px;padding:7px 13px">${KS.icon('check', 16, 3)}Cooked it</span>
        <span class="btn" style="font-size:14px;padding:7px 13px">${KS.icon('share', 16, 2.6)}Share</span>
      </div>
      <div class="box flat" style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><div class="t" style="font-size:20px">Ingredients</div><span class="muted" style="font:800 13px Nunito">Serves 2</span></div>
        ${ing.map((x, n) => `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;${n ? 'border-top:2px dashed color-mix(in srgb,var(--line) 25%,transparent)' : ''};font:700 16px Nunito">
          <span style="width:22px;height:22px;border:2.5px solid var(--line);border-radius:7px;flex:none;${n === 0 ? 'background:#9BD13B;color:#16130F;display:flex;align-items:center;justify-content:center' : ''}">${n === 0 ? KS.icon('check', 14, 3.4) : ''}</span>
          <span style="${n === 0 ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(x)}</span></div>`).join('')}
      </div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:112px;background:var(--tab);border-top:2.5px solid var(--line);padding:14px 20px 0;z-index:40">
      <div class="btn primary big" style="width:100%;background:#FF5A36;color:#16130F">${KS.icon('flame', 22, 2.6)}Start cooking</div>
    </div>${KS.homeIndicator(mode === 'dark' ? '#FFF7E8' : '#16130F')}`;
  };

  const reviewItems = () => [
    { title: 'Dutch oven (the blue one)', kind: 'product', retailer: 'Example Shop', img: '', why: '“dutch oven” is one of your words for Kitchen', sugg: ['Kitchen', 'Coffee corner', 'Home Decor'] },
    { ...KS.find('Adjustable desk lamp'), why: '“lamp” and “desk lamp” in the title', sugg: ['Home Decor', 'Technology', 'Kitchen'] },
    { ...KS.find('Something from a newsletter'), why: 'Not much to go on yet', sugg: ['Home Decor', 'Kitchen', 'Coffee corner'] },
  ];
  const thumb = (i, s = 64) => i.img
    ? `<div style="width:${s}px;height:${s}px;border:2.5px solid var(--line);border-radius:14px;overflow:hidden;flex:none"><img class="img" src="${i.img}"></div>`
    : `<div style="width:${s}px;height:${s}px;border:2.5px solid var(--line);border-radius:14px;flex:none;background:${KC[i.kind]};color:#16130F;display:flex;align-items:center;justify-content:center;transform:rotate(-3deg)"><span class="t" style="font-size:${s * 0.42}px">${esc(i.title[0])}</span></div>`;

  const iosReview = (mode) => `${KS.statusBar(mode === 'dark' ? '#FFF7E8' : '#16130F')}
    <div style="position:absolute;top:54px;left:0;right:0;bottom:86px;overflow:hidden;padding:4px 20px 0">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">${round('back')}</div>
      <div class="t" style="font-size:38px">Review</div>
      <div class="muted" style="font:700 15px Nunito;margin:4px 0 16px">Keepsake wasn’t sure where these go. Tap where each one goes and it learns.</div>
      ${reviewItems().map((i) => `
      <div class="box" style="padding:14px;margin-bottom:16px">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
          ${thumb(i, 56)}
          <div style="min-width:0"><div class="t" style="font-size:18px">${esc(i.title)}</div><div class="muted" style="font:700 13px Nunito;margin-top:2px">${esc(i.why)}</div></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="btn primary" style="background:#FFC23D;color:#16130F;flex:1;padding:9px 10px">${KS.icon('check', 16, 3)}${i.sugg[0]}</span>
          <span class="chip" style="font-size:13px;padding:6px 10px">${i.sugg[1]}</span>
          <span class="chip" style="font-size:13px;padding:6px 10px">${i.sugg[2]}</span>
        </div>
        <div style="display:flex;gap:18px;margin-top:10px;font:800 13.5px Nunito" class="muted"><span>Another collection…</span><span>Skip for now</span></div>
      </div>`).join('')}
    </div>${iosTabs('Home', mode, 3)}`;

  // ---------- Chrome ----------
  const logo = (s = 30) => `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.3}px;background:#FF5A36;border:2.5px solid var(--line);color:#16130F;display:flex;align-items:center;justify-content:center;transform:rotate(-6deg);box-shadow:2px 2px 0 var(--shadow)">${KS.icon('bookmark', s * 0.55, 2.8)}</div>`;

  const popup = (mode) => {
    const lamp = KS.find('Adjustable desk lamp');
    return `<div style="padding:14px 16px;display:flex;align-items:center;gap:10px;border-bottom:2.5px solid var(--line)">
      ${logo(30)}<div class="t" style="font-size:21px;flex:1">Keepsake</div>
      <span style="color:var(--ink)">${GEAR(22)}</span>
    </div>
    <div style="padding:18px 16px 16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="width:34px;height:34px;border-radius:50%;background:#9BD13B;border:2.5px solid var(--line);color:#16130F;display:flex;align-items:center;justify-content:center;transform:rotate(-8deg)">${KS.icon('check', 18, 3.4)}</span>
        <div class="t" style="font-size:26px">Saved!</div>
      </div>
      <div class="box" style="padding:12px;display:flex;gap:14px;align-items:center;margin-bottom:14px">
        <div style="width:84px;height:84px;border:2.5px solid var(--line);border-radius:14px;overflow:hidden;flex:none;background:#fff"><img class="img" src="${lamp.img}"></div>
        <div style="min-width:0">
          ${sticker('product', -3)}
          <div class="t" style="font-size:18px;margin:7px 0 3px">Arc desk lamp, brushed brass</div>
          <div class="muted" style="font:700 14px Nunito">$129.00 · Northlight</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font:800 14.5px Nunito">Saved to</span>
        <span class="chip" style="background:#FFC23D;color:#16130F;gap:8px">Home Decor ${KS.icon('down', 16, 2.8)}</span>
      </div>
      <div style="border:2.5px dashed color-mix(in srgb,var(--line) 45%,transparent);border-radius:16px;padding:11px 14px;font:700 14.5px Nunito;margin-bottom:16px" class="muted">Add a note, like “for the reading corner”</div>
      <div style="display:flex;gap:12px">
        <span class="btn primary" style="flex:1;font-size:16px;padding:12px">Open in Keepsake</span>
        <span class="btn" style="font-size:16px;padding:12px 18px">${KS.icon('undo', 16, 2.6)}Undo</span>
      </div>
    </div>
    <div style="border-top:2.5px solid var(--line);padding:11px 16px;display:flex;justify-content:space-between;font:700 13px Nunito" class="muted">
      <span>Saved on this device</span><span>On-page buttons</span>
    </div>`;
  };

  const sidebar = (active, mode) => {
    const nav = [['home', 'Home', ''], ['library', 'Library', '29'], ['star', 'Favorites', '1'], ['inbox', 'Review', '3']];
    const kinds = KS.kinds.filter((k) => KS.count(k));
    return `<aside style="width:250px;flex:none;border-right:2.5px solid var(--line);padding:18px 16px;display:flex;flex-direction:column;gap:4px;height:100%;background:var(--bg)">
      <div style="display:flex;align-items:center;gap:10px;margin:0 4px 16px">${logo(32)}<span class="t" style="font-size:23px">Keepsake</span></div>
      ${nav.map(([ic, l, n]) => {
        const on = l === active;
        return `<div style="display:flex;align-items:center;gap:11px;padding:8px 12px;border-radius:14px;font:800 15px Nunito;${on ? 'background:var(--ink);color:var(--bg)' : ''}">${KS.icon(ic, 18, 2.4)}<span style="flex:1">${l}</span>${l === 'Review' ? `<span style="background:#FF5A36;color:#16130F;border:2px solid var(--line);border-radius:999px;padding:0 8px;font:900 12px Nunito">${n}</span>` : `<span style="font-weight:700;opacity:.75">${n}</span>`}</div>`;
      }).join('')}
      <div style="font:900 12px Nunito;letter-spacing:.08em;text-transform:uppercase;margin:16px 12px 6px" class="muted">Lifestyle</div>
      ${kinds.slice(1).map((k) => `<div style="display:flex;align-items:center;gap:11px;padding:5px 12px;font:700 14.5px Nunito"><span style="width:14px;height:14px;border-radius:5px;background:${KC[k]};border:2px solid var(--line)"></span><span style="flex:1">${KS.kindPlural(k)}</span><span class="muted">${KS.count(k)}</span></div>`).join('')}
      <div style="font:900 12px Nunito;letter-spacing:.08em;text-transform:uppercase;margin:16px 12px 6px" class="muted">Collections</div>
      ${KS.collections.slice(0, 4).map((c, n) => `<div style="display:flex;align-items:center;gap:11px;padding:5px 12px;font:700 14.5px Nunito"><span style="width:14px;height:14px;border-radius:50%;border:2px solid var(--line);background:${['#FFC23D', '#FF9A3D', '#12A08F', '#8E6CEF'][n]}"></span>${c}</div>`).join('')}
      <div style="margin-top:auto;display:flex;align-items:center;gap:11px;padding:8px 12px;font:800 15px Nunito">${GEAR(18)}Settings</div>
    </aside>`;
  };
  const shell = (active, mode, body) => `${KS.browserBar(mode === 'dark' ? '#2E2B26' : '#EFE4CF', mode === 'dark' ? '#E9E1D2' : '#3C362E').replace('rgba(255,255,255,.7)', mode === 'dark' ? '#1B1A17' : 'rgba(255,255,255,.7)')}
    <div style="display:flex;height:860px">${sidebar(active, mode)}<main style="flex:1;min-width:0;padding:22px 30px;overflow:hidden">${body}</main></div>`;

  const extLibrary = (mode) => {
    const kinds = KS.kinds.filter((k) => KS.count(k));
    const pick = ['Tartine', 'Piranesi', 'Glass pour', 'Spaghetti', 'Past Lives', 'Kettlebell', 'How to fold', 'Molded', 'The case for', 'Pastéis', 'Café de Flore', 'Braiding', 'Shakshuka', 'Cushioned', 'Paris, Texas'].map(KS.find);
    return shell('Library', mode, `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div class="t" style="font-size:40px">Library</div><span class="muted" style="font:800 15px Nunito;margin-top:10px">29 saves</span>
        <div style="flex:1"></div>
        <div class="box flat" style="width:340px;display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:999px;font:700 15px Nunito;color:var(--muted)">${KS.icon('search', 18, 2.4)}Search your saves<span style="margin-left:auto" class="kbd">/</span></div>
        <span class="btn">Select</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <span class="chip on" style="font-size:13.5px;padding:6px 12px">All 29</span>
        ${kinds.map((k) => `<span class="chip" style="background:${KC[k]};color:#16130F;font-size:13.5px;padding:6px 11px;gap:5px">${KS.icon(k, 14, 2.5)}${KS.kindPlural(k)} <span class="n">${KS.count(k)}</span></span>`).join('')}
      </div>
      <div style="display:flex;gap:10px;margin-bottom:18px;font:800 14px Nunito">
        <span class="chip" style="font-size:13.5px">Newest first ${KS.icon('down', 14, 2.6)}</span>
        <span class="chip" style="font-size:13.5px">Any collection ${KS.icon('down', 14, 2.6)}</span>
        <div style="flex:1"></div>
        <span class="chip on" style="padding:6px 10px">${KS.icon('grid', 16, 2.4)}</span><span class="chip" style="padding:6px 10px">${KS.icon('list', 16, 2.4)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:20px">${pick.map((i, n) => card(i, n, { h: 138 })).join('')}</div>`);
  };

  const extRecipe = (mode) => {
    const r = KS.find('Spaghetti');
    return shell('Library', mode, `
      <div style="display:flex;align-items:center;gap:8px;font:800 14px Nunito;margin-bottom:16px" class="muted">${KS.icon('back', 16, 2.6)}Library <span>/</span> Recipes</div>
      <div style="display:grid;grid-template-columns:440px 1fr;gap:34px">
        <div>
          <div class="box" style="overflow:hidden;height:330px"><img class="img" src="${r.img}"></div>
          <div class="box flat" style="margin-top:20px;padding:16px 18px;background:var(--well)">
            <div style="font:900 12px Nunito;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px" class="muted">Your note</div>
            <div style="font:700 15px Nunito">Use guanciale, not bacon. Take the pan off the heat before the eggs go in.</div>
          </div>
          <div style="display:flex;gap:16px;margin-top:20px">
            <div class="box flat" style="flex:1;padding:14px 16px;background:#9BD13B;color:#16130F"><div class="t" style="font-size:30px">3×</div><div style="font:800 14px Nunito">Cooked, last on Oct 12</div></div>
            <div class="box flat" style="flex:1;padding:14px 16px;background:#FFC23D;color:#16130F"><div class="t" style="font-size:30px">25 min</div><div style="font:800 14px Nunito">From start to plate</div></div>
          </div>
        </div>
        <div>
          ${sticker('recipe', -3, 'font-size:13px')}
          <div class="t" style="font-size:52px;margin:12px 0 8px">Spaghetti alla carbonara</div>
          <div class="muted" style="font:700 15.5px Nunito;margin-bottom:18px">recipes.example.org · Saved Oct 14 · 6 ingredients · 4 steps</div>
          <div style="display:flex;gap:12px;margin-bottom:24px">
            <span class="btn primary big" style="background:#FF5A36;color:#16130F;font-size:17px;padding:13px 22px">${KS.icon('flame', 20, 2.6)}Start cooking</span>
            <span class="btn">${KS.icon('check', 16, 3)}Cooked it</span>
            <span class="btn">${KS.icon('link', 16, 2.4)}Visit page</span>
            <span class="btn ghost" style="border-color:transparent">Edit</span>
          </div>
          <div style="display:grid;grid-template-columns:260px 1fr;gap:20px">
            <div class="box flat" style="padding:14px 16px">
              <div class="t" style="font-size:20px;margin-bottom:6px">Ingredients</div>
              ${r.details.ingredients.map((x) => `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;font:700 14.5px Nunito"><span style="width:18px;height:18px;border:2.5px solid var(--line);border-radius:6px;flex:none"></span>${esc(x)}</div>`).join('')}
            </div>
            <div class="box flat" style="padding:14px 18px">
              <div class="t" style="font-size:20px;margin-bottom:6px">Steps</div>
              ${r.details.steps.map((x, n) => `<div style="display:flex;gap:12px;padding:7px 0;font:700 14.5px/1.4 Nunito"><span style="width:26px;height:26px;border-radius:50%;background:#FFC23D;color:#16130F;border:2px solid var(--line);flex:none;display:flex;align-items:center;justify-content:center;font:900 13px Nunito">${n + 1}</span><span>${esc(x)}</span></div>`).join('')}
            </div>
          </div>
        </div>
      </div>`);
  };

  const extReview = (mode) => shell('Review', mode, `
    <div style="display:flex;align-items:flex-end;gap:16px;margin-bottom:6px"><div class="t" style="font-size:40px">Review</div><span class="muted" style="font:800 15px Nunito;margin-bottom:6px">3 saves</span></div>
    <div class="muted" style="font:700 16px Nunito;margin-bottom:22px;max-width:760px">Keepsake wasn’t sure where these go. Pick a collection, or press <span class="kbd">1</span> <span class="kbd">2</span> <span class="kbd">3</span> on the selected row. It learns from every pick.</div>
    ${reviewItems().map((i, n) => `
      <div class="box" style="padding:16px 18px;margin-bottom:18px;display:flex;align-items:center;gap:18px;${n === 0 ? 'outline:3px solid #FFC23D;outline-offset:3px' : ''}">
        ${thumb(i, 76)}
        <div style="flex:1;min-width:0">
          <div class="t" style="font-size:21px">${esc(i.title)}</div>
          <div class="muted" style="font:700 14px Nunito;margin:3px 0 12px">${esc(i.retailer || i.host)} · ${esc(i.why)}</div>
          <div style="display:flex;gap:10px;align-items:center">
            <span class="btn primary" style="background:#FFC23D;color:#16130F"><span class="kbd">1</span>${i.sugg[0]}</span>
            <span class="chip"><span class="kbd">2</span>${i.sugg[1]}</span>
            <span class="chip"><span class="kbd">3</span>${i.sugg[2]}</span>
            <span class="chip" style="border-style:dashed">Another… ${KS.icon('down', 14, 2.6)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;font:800 14px Nunito" class="muted"><span>Open</span><span>Skip</span></div>
      </div>`).join('')}
    <div class="muted" style="font:700 14px Nunito;margin-top:4px">Each pick files the save straight away. Undo with ⌥Z.</div>`);

  window.KS_DIR = {
    name: 'Pantry Pop',
    css,
    screens: {
      'ios-home': iosHome, 'ios-library': iosLibrary, 'ios-recipe': iosRecipe, 'ios-review': iosReview,
      'popup-saved': popup, 'ext-library': extLibrary, 'ext-recipe': extRecipe, 'ext-review': extReview,
    },
  };
})();
