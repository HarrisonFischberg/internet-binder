// Direction 4: Night Atlas. Dark-first, cinematic; saves as places on a map of your life.
(() => {
  const T = {
    dark: {
      bg: '#0B0F17', panel: '#141B27', panel2: '#1B2433', line: 'rgba(255,255,255,.09)', line2: 'rgba(255,255,255,.16)',
      ink: '#EEF1F6', muted: '#A3AEBF', faint: '#7D899B', amber: '#FFB547', amberText: '#FFC266', onAmber: '#1A1204', cyan: '#6FE3E8',
      glow: '0 0 0 1px rgba(255,181,71,.55), 0 0 28px rgba(255,181,71,.22)', shadow: '0 18px 40px rgba(0,0,0,.45)', contour: 'rgba(160,190,230,.10)',
      kinds: { place: '#6FE3E8', recipe: '#FF9F7A', product: '#FFC266', book: '#C9A7FF', media: '#8FB3FF', video: '#FF8FB1', workout: '#9BE58A', article: '#E3D7BE' },
      bar: ['#161C28', '#C9D1DC'],
    },
    light: {
      bg: '#F3F1EC', panel: '#FFFFFF', panel2: '#ECE8DF', line: 'rgba(18,22,31,.10)', line2: 'rgba(18,22,31,.18)',
      ink: '#12161F', muted: '#4F5866', faint: '#626B79', amber: '#FFB547', amberText: '#8A5200', onAmber: '#1A1204', cyan: '#0B7A80',
      glow: '0 0 0 1.5px #C77D00, 0 8px 24px rgba(199,125,0,.18)', shadow: '0 14px 30px rgba(40,34,20,.10)', contour: 'rgba(18,22,31,.07)',
      kinds: { place: '#0B7A80', recipe: '#B4441C', product: '#8A5200', book: '#6B3FC0', media: '#2F57B8', video: '#B0285A', workout: '#2E7D1F', article: '#6B5B3A' },
      bar: ['#E4E1DA', '#3C4043'],
    },
  };
  let M = T.dark;
  const kc = (k) => M.kinds[k] || M.muted;

  // Faint contour lines (topographic) behind headers.
  const contour = (w, h, seed = 1) => {
    let paths = '';
    for (let r = 0; r < 9; r++) {
      const cx = w * (0.72 + 0.05 * Math.sin(seed)), cy = h * 0.55;
      const rx = 40 + r * 46, ry = 22 + r * 26;
      let d = '';
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        const wob = 1 + 0.08 * Math.sin(3 * t + r + seed) + 0.05 * Math.cos(5 * t - r);
        const x = cx + Math.cos(t) * rx * wob, y = cy + Math.sin(t) * ry * wob;
        d += (a ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }
      paths += `<path d="${d}Z"/>`;
    }
    return `<svg class="na-contour" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="${M.contour}" stroke-width="1">${paths}</svg>`;
  };

  const coord = (i) => {
    const d = i.details || {};
    if (d.lat == null) return (d.locality || '').toUpperCase();
    const la = `${Math.abs(d.lat).toFixed(2)}° ${d.lat >= 0 ? 'N' : 'S'}`, lo = `${Math.abs(d.lng).toFixed(2)}° ${d.lng >= 0 ? 'E' : 'W'}`;
    return `${la} · ${lo}`;
  };
  const meta = (KS, i) => {
    if (i.kind === 'place') return coord(i);
    return [KS.kindLabel(i.kind), KS.fact(i)].filter(Boolean).join(' · ').toUpperCase();
  };

  // A save with no picture: a dark card, a big monogram and a thin route line in the kind's colour.
  const monogram = (KS, i, h, big = 64) => {
    const c = kc(i.kind);
    const letter = i.title.replace(/^(the|a)\s+/i, '').charAt(0).toUpperCase();
    return `<div class="na-mono" style="height:${h}px">
      <svg class="na-route" viewBox="0 0 200 120" preserveAspectRatio="none" fill="none"><path d="M-4 96 C 40 92, 52 40, 96 52 S 160 96, 204 24" stroke="${c}" stroke-width="1.4" stroke-dasharray="3 5" vector-effect="non-scaling-stroke" opacity=".85"/></svg>
      <span class="na-mono-pin" style="background:${c}"></span>
      <span class="na-mono-letter" style="font-size:${big}px">${letter}</span>
      <span class="na-mono-kind" style="color:${c}">${KS.icon(i.kind, 15, 1.8)}</span>
    </div>`;
  };
  const pic = (KS, i, h, big) => i.img
    ? `<div class="na-pic" style="height:${h}px;background-image:url(${i.img})"><div class="na-fade"></div></div>`
    : monogram(KS, i, h, big);

  const css = (mode) => {
    M = T[mode];
    return `
    .frame{background:${M.bg};color:${M.ink};font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    .frame *{box-sizing:border-box}
    .na-h{font-family:'Space Grotesk',Inter,sans-serif;letter-spacing:-.02em;font-weight:600}
    .na-m{font-family:'JetBrains Mono',monospace;letter-spacing:.04em;font-size:10.5px;color:${M.muted};text-transform:uppercase}
    .na-muted{color:${M.muted}}
    .na-contour{position:absolute;right:0;top:0;pointer-events:none}
    .na-panel{background:${M.panel};border:1px solid ${M.line};border-radius:18px}
    .na-glass{background:${mode === 'dark' ? 'rgba(20,27,39,.72)' : 'rgba(255,255,255,.78)'};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid ${M.line2}}
    .na-pic{position:relative;background-size:cover;background-position:center}
    .na-fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,${M.panel} 100%)}
    .na-mono{position:relative;background:${mode === 'dark' ? 'radial-gradient(120% 90% at 30% 20%,#1E2838 0%,#121925 70%)' : 'radial-gradient(120% 90% at 30% 20%,#F8F5EE 0%,#E9E4D9 75%)'};overflow:hidden;display:flex;align-items:center;justify-content:center}
    .na-route{position:absolute;inset:0;width:100%;height:100%}
    .na-mono-pin{position:absolute;right:16%;top:18%;width:7px;height:7px;border-radius:50%;box-shadow:0 0 12px currentColor}
    .na-mono-letter{font-family:'Space Grotesk',sans-serif;font-weight:500;color:${mode === 'dark' ? 'rgba(238,241,246,.88)' : 'rgba(18,22,31,.82)'};position:relative;line-height:1}
    .na-mono-kind{position:absolute;left:10px;bottom:8px;display:flex}
    .na-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;font:600 15px Inter,sans-serif;border:1px solid ${M.line2};color:${M.ink};background:transparent;height:40px;padding:0 16px;white-space:nowrap}
    .na-primary{background:${M.amber};color:${M.onAmber};border-color:transparent;box-shadow:0 6px 24px rgba(255,181,71,${mode === 'dark' ? '.28' : '.35'})}
    .na-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;border:1px solid ${M.line2};font-size:13.5px;color:${M.ink};white-space:nowrap}
    .na-chip.on{background:${M.ink};color:${M.bg};border-color:${M.ink}}
    .na-chip .n{font-family:'JetBrains Mono',monospace;font-size:11px;opacity:.75}
    .na-kbd{font-family:'JetBrains Mono',monospace;font-size:11px;min-width:20px;height:20px;padding:0 5px;border-radius:5px;border:1px solid ${M.line2};display:inline-flex;align-items:center;justify-content:center;color:${M.muted}}
    .na-circ{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:${M.ink}}
    .na-tab{position:absolute;left:0;right:0;bottom:0;height:84px;background:${mode === 'dark' ? 'rgba(13,18,27,.92)' : 'rgba(250,248,244,.94)'};backdrop-filter:blur(20px);border-top:1px solid ${M.line};display:flex;justify-content:space-around;padding-top:9px;z-index:40}
    .na-tab a{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:${M.faint};width:72px;position:relative}
    .na-tab a.on{color:${M.amberText}}
    .na-badge{position:absolute;top:-4px;right:17px;min-width:17px;height:17px;border-radius:9px;background:${M.amber};color:${M.onAmber};font:700 10.5px Inter;display:flex;align-items:center;justify-content:center;padding:0 4px}
    .na-side a{display:flex;align-items:center;gap:11px;height:34px;padding:0 10px;border-radius:9px;color:${M.muted};font-size:13.5px;font-weight:500}
    .na-side a.on{background:${M.panel2};color:${M.ink}}
    .na-side a .c{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11px;color:${M.faint}}
    .na-side .grp{margin:18px 10px 6px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.1em;color:${M.faint}}
    .na-search{display:flex;align-items:center;gap:10px;height:42px;border-radius:12px;border:1px solid ${M.line2};background:${M.panel};padding:0 14px;color:${M.faint};font-size:14.5px}
    .na-check{width:20px;height:20px;border-radius:6px;border:1.5px solid ${M.line2};flex:none}
    `;
  };

  const tabbar = (KS, on) => `<div class="na-tab">
    ${[['home', 'Home'], ['library', 'Library'], ['map', 'Places'], ['search', 'Search']].map(([ic, l]) => `<a class="${l === on ? 'on' : ''}">${KS.icon(ic, 24, 1.7)}${l}${l === 'Home' ? '<span class="na-badge">2</span>' : ''}</a>`).join('')}
  </div>${KS.homeIndicator(M.ink)}`;

  // ---------- iPhone ----------
  const iosHome = (mode, KS) => {
    const recent = ['Tartine', 'Glass pour', 'Spaghetti', 'Piranesi'].map(KS.find);
    const back = ['Café de Flore', 'Past Lives', 'Kettlebell'].map(KS.find);
    const stack = (imgs) => `<div style="position:relative;width:62px;height:48px;flex:none">${imgs.map((src, n) => `<div style="position:absolute;left:${n * 12}px;top:${n * 3}px;width:40px;height:44px;border-radius:9px;background:url(${src}) center/cover;border:1.5px solid ${M.panel};box-shadow:0 4px 10px rgba(0,0,0,.3)"></div>`).join('')}</div>`;
    return `${KS.statusBar(M.ink)}
    <div style="position:relative;padding:6px 20px 0">${contour(393, 150, 2)}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;position:relative">
        <div><div class="na-m">Mon 19 Oct · 28 saves</div><div class="na-h" style="font-size:36px;margin-top:4px">Keepsake</div></div>
        <div class="na-circ na-glass">${KS.icon('settings', 20)}</div>
      </div>
      <div class="na-panel" style="margin-top:18px;display:flex;align-items:center;gap:14px;padding:14px 14px 14px 16px;box-shadow:${M.glow}">
        <div style="width:10px;height:10px;border-radius:50%;background:${M.amber};box-shadow:0 0 14px ${M.amber};flex:none"></div>
        <div style="flex:1"><div style="font-weight:600;font-size:15.5px">2 saves need a collection</div><div class="na-muted" style="font-size:13.5px;margin-top:2px">Not sure where these go yet.</div></div>
        <span class="na-btn na-primary" style="height:34px;font-size:14px;padding:0 14px">Sort</span>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:24px 20px 10px"><div class="na-h" style="font-size:21px">Recent</div><span style="font-size:14px;color:${M.amberText};font-weight:600">See all</span></div>
    <div style="display:flex;gap:12px;padding:0 20px;overflow:hidden">
      ${recent.map((i) => `<div class="na-panel" style="width:150px;flex:none;overflow:hidden;border-radius:16px">${pic(KS, i, 128, 56)}
        <div style="padding:8px 12px 12px"><div class="na-m" style="color:${kc(i.kind)};font-size:9.5px">${KS.kindLabel(i.kind)}</div><div style="font-weight:600;font-size:14.5px;line-height:1.25;margin-top:4px;height:36px;overflow:hidden">${i.title}</div><div class="na-m" style="margin-top:4px;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.kind === 'place' ? (i.details.locality || '').toUpperCase() : (KS.fact(i) || i.host).toUpperCase()}</div></div></div>`).join('')}
    </div>
    <div style="padding:20px 20px 0;display:flex;flex-direction:column;gap:10px">
      ${[['Collections', '6 collections · 4 saves', ['img/molded-plywood-lounge-chair.jpg', 'img/stoneware-mugs-set-of-4.jpg', 'img/cushioned-road-running-shoes.jpg']], ['Lifestyle', '7 views · 22 saves', ['img/pike-place-market.jpg', 'img/shakshuka.jpg', 'img/kettlebell-basics.jpg']]].map(([t, s, imgs]) => `
      <div class="na-panel" style="display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:16px">${stack(imgs)}<div style="flex:1"><div class="na-h" style="font-size:17px">${t}</div><div class="na-m" style="margin-top:3px">${s}</div></div><span class="na-muted">${KS.icon('chevron', 18)}</span></div>`).join('')}
    </div>
    <div style="padding:22px 20px 10px" class="na-h"><span style="font-size:21px">Come back to</span></div>
    <div style="display:flex;gap:12px;padding:0 20px">${back.map((i) => `<div class="na-panel" style="width:150px;flex:none;overflow:hidden;border-radius:16px">${pic(KS, i, 110)}</div>`).join('')}</div>
    ${tabbar(KS, 'Home')}`;
  };

  const iosLibrary = (mode, KS) => {
    const order = ['Tartine', 'Piranesi', 'Spaghetti', 'Something from', 'Glass pour', 'How to fold', 'Café de Flore', 'Past Lives'].map(KS.find);
    const kinds = ['place', 'recipe', 'product', 'book', 'media'];
    return `${KS.statusBar(M.ink)}
    <div style="position:relative;padding:6px 20px 0">${contour(393, 130, 4)}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;position:relative"><div><div class="na-h" style="font-size:34px">Library</div><div class="na-m" style="margin-top:2px">28 saves · 6 collections</div></div><div class="na-circ na-glass">${KS.icon('more', 20)}</div></div>
      <div class="na-search" style="margin-top:16px">${KS.icon('search', 18)}<span>Search 28 saves</span></div>
    </div>
    <div style="display:flex;gap:8px;padding:14px 20px 4px;overflow:hidden"><span class="na-chip on">All <span class="n">28</span></span>${kinds.map((k) => `<span class="na-chip"><span style="color:${kc(k)};display:flex">${KS.icon(k, 15)}</span>${KS.kindPlural(k)} <span class="n">${KS.count(k)}</span></span>`).join('')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 20px">
      ${order.map((i) => `<div class="na-panel" style="overflow:hidden;border-radius:16px">${pic(KS, i, 112, 54)}<div style="padding:6px 12px 12px"><div class="na-m" style="color:${kc(i.kind)};font-size:9.5px">${KS.kindLabel(i.kind)}</div><div style="font-weight:600;font-size:14.5px;line-height:1.25;margin-top:3px;height:36px;overflow:hidden">${i.title}</div><div class="na-m" style="font-size:9.5px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(i.kind === 'place' ? i.details.locality : KS.fact(i) || i.host || 'Link').toUpperCase()}</div></div></div>`).join('')}
    </div>
    ${tabbar(KS, 'Library')}`;
  };

  const iosRecipe = (mode, KS) => {
    const r = KS.find('Spaghetti'), d = r.details;
    return `<div style="position:absolute;inset:0 0 auto 0;height:400px;background:url(${r.img}) center 40%/cover"></div>
    <div style="position:absolute;inset:0 0 auto 0;height:402px;background:linear-gradient(180deg,rgba(11,15,23,.45) 0%,rgba(11,15,23,0) 26%,rgba(0,0,0,0) 40%,${mode === 'dark' ? 'rgba(11,15,23,.88)' : 'rgba(243,241,236,.92)'} 78%,${M.bg} 100%)"></div>
    <div style="position:relative">${KS.statusBar(mode === 'dark' ? '#fff' : '#fff')}</div>
    <div style="position:relative;display:flex;justify-content:space-between;padding:4px 16px"><div class="na-circ na-glass">${KS.icon('back', 20, 2)}</div><div class="na-circ na-glass">${KS.icon('more', 20)}</div></div>
    <div style="position:relative;padding:216px 22px 0">
      <div class="na-m" style="color:${kc('recipe')}">Recipe · recipes.example.org</div>
      <div class="na-h" style="font-size:31px;line-height:1.08;margin-top:8px">Spaghetti alla carbonara</div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <span class="na-chip">${KS.icon('check', 15, 2.2)}Mark cooked</span><span class="na-chip">${KS.icon('share', 15)}Share</span><span class="na-chip">${KS.icon('star', 15)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:24px"><div class="na-h" style="font-size:19px">Ingredients</div><div class="na-m">${d.ingredients.length} items · ${d.steps.length} steps</div></div>
      <div style="margin-top:8px">${d.ingredients.map((x) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid ${M.line};font-size:15.5px"><span class="na-check"></span>${x}</div>`).join('')}</div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;padding:14px 20px 34px;background:${M.bg};border-top:1px solid ${M.line};z-index:40">
      <div class="na-btn na-primary" style="width:100%;height:54px;font-size:17px">${KS.icon('flame', 20, 2)}Start cooking</div>
    </div>${KS.homeIndicator(M.ink)}`;
  };

  const reviewData = (KS) => [
    { title: 'Dutch oven (the blue one)', why: 'You filed “dutch oven” in Kitchen before', sugg: ['Kitchen', 'Coffee corner', 'Home Decor'], sure: true, item: { title: 'Dutch oven', kind: 'product' }, src: 'Example Shop' },
    { title: 'Adjustable desk lamp', why: '“lamp” and “desk lamp” in the title', sugg: ['Home Decor', 'Technology', 'Kitchen'], sure: true, item: KS.find('Adjustable'), src: 'Example Design · $89.00' },
    { title: 'Something from a newsletter', why: 'No strong match. Pick one and Keepsake learns.', sugg: ['Home Decor', 'Kitchen', 'Coffee corner'], sure: false, item: KS.find('Something from'), src: 'Example' },
  ];

  const iosReview = (mode, KS) => `${KS.statusBar(M.ink)}
    <div style="position:relative;padding:4px 16px 0">${contour(393, 140, 6)}
      <div class="na-circ na-glass" style="position:relative">${KS.icon('back', 20, 2)}</div>
      <div style="position:relative;padding:12px 4px 0"><div class="na-h" style="font-size:32px">Review</div><div class="na-muted" style="font-size:15px;margin-top:4px;line-height:1.4">3 saves need a home. Tap a collection to file one; Keepsake learns from it.</div></div>
    </div>
    <div style="padding:16px 16px 0;display:flex;flex-direction:column;gap:12px">
      ${reviewData(KS).map((r, n) => `<div class="na-panel" style="padding:14px;border-radius:18px;${n === 0 ? `box-shadow:${M.glow}` : ''}">
        <div style="display:flex;gap:12px;align-items:center">
          <div style="width:56px;height:56px;border-radius:12px;overflow:hidden;flex:none">${r.item.img ? `<div style="width:100%;height:100%;background:url(${r.item.img}) center/cover"></div>` : monogram(KS, r.item, 56, 26)}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:15.5px">${r.title}</div><div class="na-muted" style="font-size:13px;margin-top:3px;line-height:1.35">${r.why}</div></div>
        </div>
        <div style="display:flex;gap:7px;margin-top:12px;flex-wrap:nowrap">
          ${r.sugg.map((s, k) => `<span class="na-btn ${k === 0 && r.sure ? 'na-primary' : ''}" style="height:36px;font-size:14px;padding:0 13px">${s}</span>`).join('')}
        </div>
        <div style="display:flex;gap:18px;margin-top:10px;font-size:14px;font-weight:600"><span style="color:${M.amberText}">Somewhere else…</span><span class="na-muted">Skip for now</span></div>
      </div>`).join('')}
    </div>
    ${tabbar(KS, 'Home')}`;

  // ---------- Chrome / Safari extension ----------
  const popup = (mode, KS) => {
    const lamp = KS.find('Adjustable');
    return `<div style="position:relative;overflow:hidden">${contour(400, 120, 3)}
      <div style="position:relative;display:flex;align-items:center;justify-content:space-between;padding:16px 18px 6px">
        <div style="display:flex;align-items:center;gap:10px"><div style="width:30px;height:30px;border-radius:9px;background:${M.amber};color:${M.onAmber};display:flex;align-items:center;justify-content:center">${KS.icon('bookmark', 17, 2.2)}</div><span class="na-h" style="font-size:19px">Keepsake</span></div>
        <span style="font-size:13.5px;font-weight:600;color:${M.amberText}">Open Keepsake</span>
      </div>
      <div style="position:relative;padding:12px 18px 0">
        <div style="display:flex;align-items:center;gap:10px"><div style="width:26px;height:26px;border-radius:50%;background:${M.amber};color:${M.onAmber};display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(255,181,71,.5)">${KS.icon('check', 15, 2.6)}</div>
          <span style="font-weight:600;font-size:16px">Saved to</span><span class="na-chip" style="height:30px;font-weight:600">Home Decor ${KS.icon('down', 14, 2)}</span></div>
        <div class="na-panel" style="margin-top:14px;display:flex;gap:14px;padding:12px;border-radius:16px">
          <div style="width:78px;height:78px;border-radius:12px;background:url(${lamp.img}) center/cover;flex:none"></div>
          <div style="min-width:0"><div class="na-m" style="color:${kc('product')}">Product · Northlight</div><div style="font-weight:600;font-size:15.5px;margin-top:5px;line-height:1.3">Arc desk lamp, brushed brass</div><div style="font-family:'JetBrains Mono',monospace;font-size:13px;margin-top:6px">$129.00</div></div>
        </div>
        <div style="margin-top:12px;height:42px;border-radius:12px;border:1px solid ${M.line2};display:flex;align-items:center;padding:0 14px;color:${M.faint};font-size:14px">Add a note</div>
        <div style="display:flex;gap:10px;margin-top:14px"><span class="na-btn" style="flex:none">${KS.icon('undo', 16)}Undo</span><span class="na-btn na-primary" style="flex:1">Open in Keepsake</span></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding:13px 18px;border-top:1px solid ${M.line};font-size:12.5px"><span class="na-muted" style="display:flex;gap:7px;align-items:center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Saved on this device</span><span style="color:${M.amberText};font-weight:600">On-page buttons</span></div>
    </div>`;
  };

  const sidebar = (KS, active) => `<aside class="na-side" style="width:236px;flex:none;border-right:1px solid ${M.line};padding:18px 12px;display:flex;flex-direction:column;height:860px;background:${M.bg}">
      <div style="display:flex;align-items:center;gap:10px;padding:2px 10px 18px"><div style="width:28px;height:28px;border-radius:8px;background:${M.amber};color:${M.onAmber};display:flex;align-items:center;justify-content:center">${KS.icon('bookmark', 16, 2.2)}</div><span class="na-h" style="font-size:18px">Keepsake</span></div>
      <a class="${active === 'Home' ? 'on' : ''}">${KS.icon('home', 17)}Home</a>
      <a class="${active === 'Library' ? 'on' : ''}">${KS.icon('library', 17)}Library<span class="c">28</span></a>
      <a>${KS.icon('star', 17)}Favorites<span class="c">1</span></a>
      <a class="${active === 'Review' ? 'on' : ''}">${KS.icon('inbox', 17)}Review<span class="c" style="background:${M.amber};color:${M.onAmber};border-radius:9px;padding:1px 7px;font-weight:700">3</span></a>
      <div class="grp">LIFESTYLE</div>
      ${['place', 'recipe', 'video', 'workout', 'media', 'book'].map((k) => `<a class="${active === k ? 'on' : ''}"><span style="color:${kc(k)};display:flex">${KS.icon(k, 17)}</span>${KS.kindPlural(k)}<span class="c">${KS.count(k)}</span></a>`).join('')}
      <div class="grp">COLLECTIONS</div>
      ${[['Kitchen', '#FF9F7A'], ['Coffee corner', '#FFC266'], ['Home Decor', '#C9A7FF'], ['Running', '#9BE58A'], ['Technology', '#8FB3FF']].map(([n, c]) => `<a><span style="width:8px;height:8px;border-radius:50%;background:${c};margin:0 4px 0 5px"></span>${n}</a>`).join('')}
      <div style="margin-top:auto"><a>${KS.icon('settings', 17)}Settings</a><div class="na-m" style="padding:10px 10px 0;font-size:9.5px">Saved on this device</div></div>
    </aside>`;

  const bar = () => `<div style="height:40px;background:${M.bar[0]};display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid ${M.line}"><span style="display:flex;gap:7px"><i style="width:12px;height:12px;border-radius:50%;background:#ff5f57;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#febc2e;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c840;display:block"></i></span><span style="margin-left:14px;width:480px;height:26px;border-radius:13px;background:${M.panel2};display:flex;align-items:center;gap:8px;padding:0 12px;color:${M.muted};font:12.5px Inter,sans-serif"><span style="width:14px;height:14px;border-radius:4px;background:${M.amber}"></span>Keepsake  ·  chrome-extension://keepsake/dashboard</span></div>`;
  const extShell = (mode, KS, active, main) => `${bar()}<div style="display:flex;height:860px">${sidebar(KS, active)}<main style="flex:1;position:relative;overflow:hidden">${main}</main></div>`;

  const extLibrary = (mode, KS) => {
    const order = ['Tartine', 'Glass pour', 'Piranesi', 'Spaghetti', 'Past Lives', 'Café de Flore', 'Something from', 'Kettlebell', 'How to fold', 'Molded plywood', 'Pike Place', 'The Overstory', 'Shakshuka', 'The case for', 'Stoneware'].map(KS.find);
    return extShell(mode, KS, 'Library', `${contour(1124, 200, 1)}
      <div style="position:relative;padding:28px 36px 0;display:flex;justify-content:space-between;align-items:flex-end">
        <div><div class="na-m">28 saves · 6 collections · 8 places</div><div class="na-h" style="font-size:38px;margin-top:6px">Library</div></div>
        <div style="display:flex;gap:10px;align-items:center"><div class="na-search" style="width:340px">${KS.icon('search', 17)}<span style="flex:1">Search your saves</span><span class="na-kbd">/</span></div><span class="na-btn">Select</span></div>
      </div>
      <div style="position:relative;display:flex;gap:8px;padding:20px 36px 0;align-items:center"><span class="na-chip on">All <span class="n">28</span></span>${['product', 'place', 'recipe', 'video', 'workout', 'media', 'book'].map((k) => `<span class="na-chip"><span style="color:${kc(k)};display:flex">${KS.icon(k, 15)}</span>${KS.kindPlural(k)} <span class="n">${KS.count(k)}</span></span>`).join('')}
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center" class="na-muted"><span class="na-circ" style="width:32px;height:32px;background:${M.panel2};border-radius:8px">${KS.icon('grid', 16)}</span><span class="na-circ" style="width:32px;height:32px">${KS.icon('list', 16)}</span></span></div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;padding:22px 36px">
        ${order.map((i) => `<div class="na-panel" style="overflow:hidden;border-radius:16px;${i.fav ? '' : ''}">${pic(KS, i, 150, 64)}<div style="padding:8px 14px 14px"><div class="na-m" style="color:${kc(i.kind)};font-size:10px">${KS.kindLabel(i.kind)}</div><div style="font-weight:600;font-size:15px;line-height:1.3;margin-top:4px;height:39px;overflow:hidden">${i.title}</div><div class="na-m" style="font-size:10px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.kind === 'place' ? coord(i) : (KS.fact(i) || i.host || '').toUpperCase()}</div></div></div>`).join('')}
      </div>`);
  };

  const extRecipe = (mode, KS) => {
    const r = KS.find('Spaghetti'), d = r.details;
    return extShell(mode, KS, 'recipe', `${contour(1124, 220, 5)}
      <div style="position:relative;padding:22px 40px 0;display:flex;align-items:center;gap:10px" class="na-m"><span>${KS.icon('back', 14, 2)}</span>Recipes / Spaghetti alla carbonara</div>
      <div style="position:relative;display:grid;grid-template-columns:420px 1fr;gap:44px;padding:20px 40px">
        <div>
          <div style="height:500px;border-radius:20px;background:url(${r.img}) center/cover;position:relative;overflow:hidden;box-shadow:${M.shadow}"><div style="position:absolute;inset:auto 0 0 0;height:120px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(11,15,23,.75))"></div>
            <div style="position:absolute;left:18px;bottom:16px;color:#fff;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.06em">SAVED 14 OCT 2026 · FILED AUTOMATICALLY</div></div>
          <div style="display:flex;gap:8px;margin-top:16px"><span class="na-chip">${KS.icon('check', 15, 2.2)}Mark cooked</span><span class="na-chip">${KS.icon('star', 15)}Favorite</span><span class="na-chip">${KS.icon('share', 15)}Share</span><span class="na-chip">${KS.icon('link', 15)}Copy link</span></div>
          <div class="na-panel" style="margin-top:16px;padding:14px 16px;border-radius:14px;font-size:14px;display:flex;gap:10px;align-items:center"><span class="na-m" style="color:${M.muted}">Note</span><span class="na-muted">Add a note for next time</span></div>
        </div>
        <div>
          <div class="na-m" style="color:${kc('recipe')}">Recipe · recipes.example.org</div>
          <div class="na-h" style="font-size:46px;line-height:1.04;margin-top:10px">Spaghetti alla carbonara</div>
          <div style="display:flex;gap:10px;margin-top:20px"><span class="na-btn na-primary" style="height:44px;padding:0 22px">${KS.icon('flame', 18, 2)}Start cooking</span><span class="na-btn" style="height:44px">Edit</span><span class="na-btn" style="height:44px">${KS.icon('link', 16)}Visit page</span></div>
          <div style="display:grid;grid-template-columns:1fr 1.25fr;gap:36px;margin-top:30px">
            <div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="na-h" style="font-size:20px">Ingredients</div><span class="na-m">${d.ingredients.length} items</span></div>
              ${d.ingredients.map((x) => `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid ${M.line};font-size:15px"><span class="na-check"></span>${x}</div>`).join('')}</div>
            <div><div style="display:flex;justify-content:space-between;align-items:baseline"><div class="na-h" style="font-size:20px">Steps</div><span class="na-m">${d.steps.length} steps</span></div>
              ${d.steps.map((x, n) => `<div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid ${M.line};font-size:15px;line-height:1.5"><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:${M.amberText};padding-top:3px">0${n + 1}</span><span>${x}</span></div>`).join('')}</div>
          </div>
        </div>
      </div>`);
  };

  const extReview = (mode, KS) => extShell(mode, KS, 'Review', `${contour(1124, 200, 7)}
      <div style="position:relative;padding:30px 40px 0;display:flex;justify-content:space-between;align-items:flex-end">
        <div><div class="na-m">3 waiting · oldest from 14 Oct</div><div class="na-h" style="font-size:38px;margin-top:6px">Review</div><div class="na-muted" style="font-size:15px;margin-top:6px">Keepsake wasn't sure where these go. Pick a collection and it learns from your choice.</div></div>
        <div class="na-panel" style="display:flex;gap:16px;align-items:center;padding:10px 14px;border-radius:12px;font-size:13px" ><span class="na-muted" style="display:flex;gap:6px;align-items:center"><span class="na-kbd">↑</span><span class="na-kbd">↓</span> move</span><span class="na-muted" style="display:flex;gap:6px;align-items:center"><span class="na-kbd">1</span><span class="na-kbd">2</span><span class="na-kbd">3</span> file</span><span class="na-muted" style="display:flex;gap:6px;align-items:center"><span class="na-kbd">S</span> skip</span></div>
      </div>
      <div style="position:relative;padding:26px 40px;display:flex;flex-direction:column;gap:14px">
      ${reviewData(KS).map((r, n) => `<div class="na-panel" style="display:flex;gap:18px;align-items:center;padding:16px 18px;border-radius:18px;${n === 0 ? `box-shadow:${M.glow}` : ''}">
          <div style="width:84px;height:84px;border-radius:14px;overflow:hidden;flex:none">${r.item.img ? `<div style="width:100%;height:100%;background:url(${r.item.img}) center/cover"></div>` : monogram(KS, r.item, 84, 38)}</div>
          <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:17px">${r.title}</div><div class="na-m" style="margin-top:5px">${r.src}</div><div class="na-muted" style="font-size:13.5px;margin-top:5px">${r.why}</div></div>
          <div style="display:flex;gap:8px;align-items:center">${r.sugg.map((s, k) => `<span class="na-btn ${k === 0 && r.sure ? 'na-primary' : ''}" style="padding:0 14px 0 8px;gap:9px"><span class="na-kbd" style="${k === 0 && r.sure ? `border-color:rgba(26,18,4,.35);color:${M.onAmber}` : ''}">${k + 1}</span>${s}</span>`).join('')}
            <span class="na-btn" style="color:${M.muted}">Other…</span><span style="width:1px;height:28px;background:${M.line2};margin:0 4px"></span><span style="font-size:14px;font-weight:600;color:${M.muted};padding:0 6px">Skip</span><span class="na-circ" style="color:${M.muted}" title="Delete"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span></div>
        </div>`).join('')}
      </div>
      <div class="na-m" style="position:relative;padding:0 40px;display:flex;gap:8px;align-items:center">${KS.icon('check', 14, 2.2)} Filed saves move to their collection. Undo is in the corner for 10 seconds.</div>`);

  window.KS_DIR = {
    name: 'Night Atlas',
    css,
    screens: { 'ios-home': iosHome, 'ios-library': iosLibrary, 'ios-recipe': iosRecipe, 'ios-review': iosReview, 'popup-saved': popup, 'ext-library': extLibrary, 'ext-recipe': extRecipe, 'ext-review': extReview },
  };
})();
