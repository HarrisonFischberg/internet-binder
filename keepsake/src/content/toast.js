// Patchwork in-page capture card (formerly a toast). Classic script; exposes globalThis.__keepsakeToast.
// Rendered inside a closed Shadow DOM with adopted stylesheets so host page CSS
// cannot leak in and ours cannot leak out. All text is set via textContent.
// Colours, type and shape come from the Patchwork design tokens (tokens-content.js, injected
// first); the host element carries data-style / data-theme from the person's settings.

(function keepsakeToastModule() {
  if (globalThis.__keepsakeToast) return;

  const CSS = `
    :host { all: initial; }
    .wrap {
      position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; width: min(360px, calc(100vw - 40px));
      font: var(--t-body-web); color: var(--c-text); pointer-events: none;
    }
    .card {
      position: relative; pointer-events: auto; background: var(--c-surface); border-radius: var(--r-xl); border: var(--bw) solid var(--c-line);
      box-shadow: var(--shadow-overlay); padding: 14px; display: grid; gap: 10px;
      transform: translateY(8px); opacity: 0; transition: transform var(--m-base) var(--m-ease), opacity var(--m-base) var(--m-ease);
    }
    .card.in { transform: none; opacity: 1; }
    .head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-right: 24px; }
    .icon { width: 22px; height: 22px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--c-success-soft); color: var(--c-success); }
    .icon svg { width: 13px; height: 13px; }
    .card.tone-review .icon { background: var(--c-warning-soft); color: var(--c-warning); }
    .card.tone-error .icon { background: var(--c-danger-soft); color: var(--c-danger); }
    .card.tone-info .icon { background: var(--c-accent-soft); color: var(--c-accent); }
    .heading { font: var(--t-subhead); font-family: var(--font-display); font-weight: var(--w-display); font-stretch: var(--stretch-display); letter-spacing: var(--track-display); color: var(--c-text); }
    .row { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
    .thumb { width: 52px; height: 52px; flex: none; border-radius: var(--r-md); overflow: hidden; background: var(--c-surface-2); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .text { min-width: 0; display: grid; gap: 3px; }
    .title { font: var(--t-footnote); font-weight: 600; color: var(--c-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .msg { font: var(--t-footnote); color: var(--c-text-muted); }
    .chip { position: relative; display: inline-flex; align-items: center; }
    .chip select {
      appearance: none; -webkit-appearance: none; font: var(--t-footnote); font-weight: 600; color: var(--c-accent); background: transparent;
      border: 1px solid var(--c-accent); border-radius: var(--r-pill); padding: 3px 24px 3px 10px; max-width: 200px; cursor: pointer;
    }
    .chip svg { position: absolute; right: 7px; width: 12px; height: 12px; color: var(--c-accent); pointer-events: none; }
    .suggest { display: flex; flex-wrap: wrap; gap: 6px; }
    .sugg { display: inline-flex; align-items: center; gap: 6px; font: var(--t-footnote); color: var(--c-text); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-pill); padding: 4px 10px; cursor: pointer; }
    .sugg:hover { border-color: var(--c-accent); }
    .sugg kbd { font: 10px/1 var(--font-mono); color: var(--c-text-muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    button.btn { font: var(--t-footnote); font-weight: 600; border-radius: var(--r-md); border: 1px solid var(--c-border); background: var(--c-surface); color: var(--c-text); padding: 5px 11px; cursor: pointer; }
    button.btn:hover { background: var(--c-surface-2); }
    button.btn.primary { background: var(--c-accent); border-color: var(--c-accent); color: var(--c-on-accent); }
    button.btn.quiet { border-color: transparent; background: transparent; color: var(--c-text-muted); }
    button.btn.quiet:hover { background: var(--c-surface-2); color: var(--c-text); }
    button:focus-visible, select:focus-visible { outline: 2px solid var(--c-focus); outline-offset: 2px; }
    .status { font: var(--t-caption); color: var(--c-text-muted); border-top: 1px solid var(--c-border); padding-top: 8px; }
    .close { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; width: 26px; height: 26px; padding: 0; border-radius: var(--r-sm); color: var(--c-text-muted); font: 18px/1 var(--font-sans); cursor: pointer; }
    .close:hover { background: var(--c-surface-2); color: var(--c-text); }
    @media (prefers-reduced-motion: reduce) { .card { transition: none; transform: none; } }
  `;

  let host = null;
  let shadow = null;
  let wrap = null;
  let current = null;
  let hideTimer = null;
  let keyHandler = null;

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('keepsake-toast');
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.setAttribute('aria-live', 'polite');
    shadow = host.attachShadow({ mode: 'closed' });
    const text = (globalThis.__keepsakeTokenCss || '') + CSS;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = text;
      shadow.append(style);
    }
    wrap = document.createElement('div');
    wrap.className = 'wrap';
    shadow.append(wrap);
    (document.documentElement || document.body).append(host);
  }

  function setLook(look) {
    // Styles other than the default (Pantry Pop), as in src/shared/storage.js.
    const style = look && ['notebook', 'gallery', 'atlas', 'swiss'].includes(look.style) ? look.style : '';
    const theme = look && ['light', 'dark'].includes(look.theme) ? look.theme : '';
    if (style) host.setAttribute('data-style', style);
    else host.removeAttribute('data-style');
    if (theme) host.setAttribute('data-theme', theme);
    else host.removeAttribute('data-theme');
  }

  function svg(d, { fill = 'none', stroke = 'currentColor', width = '2.2' } = {}) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', fill);
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', width);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
    return s;
  }
  const ICONS = {
    ok: 'm5 12.5 4.5 4.5L19 7.5',
    review: 'M12 7v6m0 4h.01',
    error: 'M12 7v6m0 4h.01',
    info: 'M7 3.5h10v17l-5-3.6-5 3.6z',
  };

  function hide() {
    clearTimeout(hideTimer);
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    if (!current) return;
    const node = current;
    current = null;
    node.classList.remove('in');
    setTimeout(() => node.remove(), 200);
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // show({ title, message, tone: ok|review|error|info, thumb, meta, status, look: { style, theme },
  //        actions: [{ label, primary, quiet, onClick, keepOpen }],
  //        picker: { options: [{id,name}], selectedId, label, onChange },
  //        suggestions: { items: [{ id, name }], onPick }, duration })
  function show(opts) {
    ensure();
    hide();
    setLook(opts.look);
    const tone = ['ok', 'review', 'error', 'info'].includes(opts.tone) ? opts.tone : (/couldn|not saved|error/i.test(opts.title || '') ? 'error' : 'ok');
    const card = el('div', `card tone-${tone}`);
    card.setAttribute('role', tone === 'error' ? 'alert' : 'status');

    const head = el('div', 'head');
    const icon = el('span', 'icon');
    icon.append(svg(ICONS[tone]));
    head.append(icon, el('span', 'heading', opts.title || 'Patchwork'));

    let pickerEl = null;
    if (opts.picker && Array.isArray(opts.picker.options) && opts.picker.options.length) {
      const chip = el('span', 'chip');
      pickerEl = document.createElement('select');
      pickerEl.setAttribute('aria-label', opts.picker.label || 'Collection');
      // Options may carry a group ("Lifestyle", "Collections"): shown as labelled groups.
      const groups = new Map();
      for (const o of opts.picker.options) {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name;
        if (o.id === opts.picker.selectedId) opt.selected = true;
        if (o.group) {
          if (!groups.has(o.group)) {
            const g = document.createElement('optgroup');
            g.label = o.group;
            groups.set(o.group, g);
            pickerEl.append(g);
          }
          groups.get(o.group).append(opt);
        } else pickerEl.append(opt);
      }
      if (typeof opts.picker.onChange === 'function') pickerEl.addEventListener('change', () => opts.picker.onChange(pickerEl.value, { close: hide }));
      chip.append(pickerEl, svg('m7 10 5 5 5-5', { width: '2' }));
      head.append(chip);
    }
    card.append(head);

    if (opts.thumb || opts.message || opts.meta) {
      const row = el('div', 'row');
      if (opts.thumb) {
        const t = el('div', 'thumb');
        const img = document.createElement('img');
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => t.remove());
        img.src = opts.thumb;
        t.append(img);
        row.append(t);
      }
      const text = el('div', 'text');
      if (opts.message) text.append(el('div', opts.thumb ? 'title' : 'msg', opts.message));
      if (opts.meta) text.append(el('div', 'msg', opts.meta));
      row.append(text);
      card.append(row);
    }

    const sugg = opts.suggestions && Array.isArray(opts.suggestions.items) ? opts.suggestions.items.slice(0, 3) : [];
    if (sugg.length) {
      const box = el('div', 'suggest');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Suggested collections');
      sugg.forEach((s, i) => {
        const b = el('button', 'sugg');
        b.type = 'button';
        b.append(el('kbd', '', String(i + 1)), document.createTextNode(s.name));
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          opts.suggestions.onPick(s.id, { close: hide });
        });
        box.append(b);
      });
      card.append(box);
      // 1/2/3 while the card is showing and focus isn't in a form field on the page.
      keyHandler = (e) => {
        const t = e.composedPath ? e.composedPath()[0] : e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || (t && t.isContentEditable)) return;
        const n = Number(e.key);
        if (n >= 1 && n <= sugg.length && !e.altKey && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          opts.suggestions.onPick(sugg[n - 1].id, { close: hide });
        }
      };
      document.addEventListener('keydown', keyHandler, true);
    }

    if (Array.isArray(opts.actions) && opts.actions.length) {
      const actions = el('div', 'actions');
      for (const a of opts.actions) {
        const b = el('button', 'btn', a.label);
        b.type = 'button';
        if (a.primary) b.classList.add('primary');
        if (a.quiet) b.classList.add('quiet');
        b.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          try {
            a.onClick && a.onClick({ pickedId: pickerEl ? pickerEl.value : null, close: hide });
          } finally {
            if (!a.keepOpen) hide();
          }
        });
        actions.append(b);
      }
      card.append(actions);
    }
    if (opts.status) card.append(el('div', 'status', opts.status));

    const close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', hide);
    card.append(close);

    wrap.append(card);
    current = card;
    requestAnimationFrame(() => card.classList.add('in'));
    // Every card stays up 25% longer than the duration it asks for; errors stay until dismissed.
    const duration = tone === 'error' && opts.duration === undefined ? 0 : (Number.isFinite(opts.duration) ? opts.duration : 6500) * 1.25;
    if (duration > 0) {
      hideTimer = setTimeout(hide, duration);
      card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      card.addEventListener('focusin', () => clearTimeout(hideTimer));
      card.addEventListener('mouseleave', () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 2500 * 1.25);
      });
    }
    if (opts.focus && pickerEl) pickerEl.focus();
    return { close: hide };
  }

  globalThis.__keepsakeToast = { show, hide };
})();
