// Shared helpers for every direction's mockups.
const P = (d) => d; // icon path data (24px grid, stroke icons)
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  library: '<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="9" y="4" width="4" height="16" rx="1"/><path d="m15.5 5.2 3.9-1 3.6 15-3.9 1z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  place: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  recipe: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2.5-3 6s1 4 3 4v8"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  media: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  product: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  workout: '<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/>',
  article: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  star: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 1.5 2 2 2 0-3 0-5 1-7z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
};
const KIND_LABEL = { place: 'Place', recipe: 'Recipe', video: 'Video', media: 'Film or show', book: 'Book', product: 'Product', workout: 'Workout', article: 'Article' };
const KIND_PLURAL = { place: 'Places', recipe: 'Recipes', video: 'Videos', media: 'Films & shows', book: 'Books', product: 'Products', workout: 'Workouts', article: 'Articles' };
window.KS = {
  items: window.KS_ITEMS,
  collections: ['Kitchen', 'Coffee corner', 'Home Decor', 'Clothing', 'Running', 'Technology'],
  sizes: { ios: { w: 393, h: 852 }, ext: { w: 1360, h: 900 }, popup: { w: 400 } },
  kinds: ['product', 'place', 'recipe', 'video', 'article', 'workout', 'media', 'book'],
  kindLabel: (k) => KIND_LABEL[k] || 'Link',
  kindPlural: (k) => KIND_PLURAL[k] || 'Links',
  count: (k) => window.KS_ITEMS.filter((i) => i.kind === k).length,
  byKind: (k) => window.KS_ITEMS.filter((i) => i.kind === k),
  find: (t) => window.KS_ITEMS.find((i) => i.title.startsWith(t)),
  withImg: () => window.KS_ITEMS.filter((i) => i.img),
  // The one fact that matters for a kind (same rule as the app's cards).
  fact(i) {
    const d = i.details || {};
    if (i.kind === 'place') return d.locality || '';
    if (i.kind === 'recipe') return d.ingredients ? `${d.ingredients.length} ingredients` : '';
    if (i.kind === 'book') return [d.author, d.year].filter(Boolean).join(' · ');
    if (i.kind === 'media') return [d.year, d.format === 'film' ? 'Film' : 'Show'].filter(Boolean).join(' · ');
    if (i.kind === 'video') return d.durationSeconds ? `${d.channel || ''} · ${Math.round(d.durationSeconds / 60)} min` : '';
    if (i.kind === 'workout') return d.exercises ? `${d.exercises.length} exercises` : '';
    if (i.kind === 'article') return d.readingMinutes ? `${d.readingMinutes} min read` : (d.wordCount ? `${Math.round(d.wordCount / 230)} min read` : '');
    if (i.kind === 'product') return i.price ? `$${Number(i.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '';
    return '';
  },
  icon: (name, size = 20, stroke = 1.8) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.bookmark}</svg>`,
  // iOS status bar (9:41, signal, wifi, battery) in the given colour.
  statusBar: (color = '#000') => `<div style="height:54px;display:flex;align-items:flex-end;justify-content:space-between;padding:0 30px 10px 44px;color:${color};font:600 17px -apple-system,'SF Pro Text',Inter,system-ui,sans-serif;position:relative;z-index:50"><span>9:41</span><span style="display:flex;gap:6px;align-items:center"><svg width="18" height="12" viewBox="0 0 18 12" fill="${color}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="16" height="12" viewBox="0 0 16 12" fill="${color}"><path d="M8 2.5c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .7 10.4 10.4 0 0 0 .8 3.6L2 4.9a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4.3 6.7 6.7 0 0 0 3.4 6.1l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3zM8 9.6l2-2a2.9 2.9 0 0 0-4 0z"/></svg><svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="${color}" opacity=".4"/><rect x="2" y="2" width="19" height="9" rx="2" fill="${color}"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="${color}" opacity=".5"/></svg></span></div>`,
  homeIndicator: (color = '#000') => `<div style="position:absolute;left:50%;bottom:8px;transform:translateX(-50%);width:139px;height:5px;border-radius:3px;background:${color};z-index:60"></div>`,
  // Browser chrome strip for the dashboard, so it reads as a Chrome tab.
  browserBar: (bg = '#e8eaed', fg = '#3c4043') => `<div style="height:40px;background:${bg};display:flex;align-items:center;gap:10px;padding:0 14px;color:${fg};font:13px Inter,system-ui,sans-serif"><span style="display:flex;gap:7px"><i style="width:12px;height:12px;border-radius:50%;background:#ff5f57;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#febc2e;display:block"></i><i style="width:12px;height:12px;border-radius:50%;background:#28c840;display:block"></i></span><span style="margin-left:14px;flex:1;max-width:520px;height:26px;border-radius:13px;background:rgba(255,255,255,.7);display:flex;align-items:center;padding:0 12px;opacity:.9">chrome-extension://keepsake/dashboard</span></div>`,
};
