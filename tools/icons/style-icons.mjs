// One app icon per Keepsake style, in light and dark. Shapes only, no fonts, so every size renders the same.
// Used by make-style-icons.mjs (PNG export) and readable on its own as the design source.

export const STYLE_ICONS = ['pantry', 'notebook', 'gallery', 'atlas', 'swiss'];

export const ICON_LABELS = {
  pocket: 'Felt pocket',
  pantry: 'Internet Binder', // the app's own icon (binder with tabs), shown with the other styles' icons
  notebook: 'Field Notebook',
  gallery: 'Gallery',
  atlas: 'Night Atlas',
  swiss: 'Swiss Index',
};

// The bookmark from the UI icon set (24-unit grid), placed at (x, y) and scaled to `size` units.
const bookmark = (x, y, size, attrs) =>
  `<path transform="translate(${x} ${y}) scale(${size / 24})" d="M6 3h12v18l-6-4-6 4z" ${attrs}/>`;

const ICONS = {
  // The app's own icon (Internet Binder, picked Oct 22 2026): a sky-blue binder with a dark spine and a cream
  // bookmark tag, terracotta, butter and mint index tabs out of the right edge, tilted with an offset shadow.
  // Toolbar sizes (small) sit straight, larger, with thicker lines.
  pantry(dark, small) {
    const ink = '#2A2420', cream = '#FFF7E8';
    const T = 232, W = 560, coverW = W - 70;
    const tile = (attrs, w = W, rx = 150) => `<rect x="${T}" y="${T}" width="${w}" height="${W}" rx="${rx}" ${attrs}/>`;
    const tabs = ['#D9694A', '#FFE4A0', '#BFE6D3'].map((fill, i) =>
      `<rect x="${T + coverW - 40}" y="${T + 60 + i * 160}" width="${small ? 120 : 110}" height="${small ? 130 : 120}" rx="28" fill="${fill}" stroke="${ink}" stroke-width="${small ? 30 : 22}"/>`).join('');
    const tagSize = small ? 300 : 240;
    const tag = `<path transform="translate(${T + 290 - tagSize / 2} ${T + 260 - tagSize / 2}) scale(${tagSize / 24})" d="M6 3h12v18l-6-4-6 4z" fill="${cream}" stroke="${ink}" stroke-width="${(24 / tagSize) * 20}" stroke-linejoin="round"/>`;
    const body = `${tabs}${tile(`fill="#9CC3EC" stroke="${ink}" stroke-width="${small ? 44 : 32}"`, coverW, 120)}` +
      `<rect x="${T}" y="${T}" width="110" height="${W}" fill="${ink}" opacity=".18" clip-path="url(#cv)"/>` +
      `<path d="M${T + 110} ${T + 20}V${T + W - 20}" stroke="${ink}" stroke-width="${small ? 24 : 16}"/>${tag}`;
    const framed = small
      ? `<g transform="translate(512 512) scale(1.42) translate(-512 -512)">${body}</g>`
      : `<g transform="rotate(-6 512 512)"><g class="shadow" transform="translate(36 40)">${tile(`fill="${dark ? cream : ink}"`)}</g>${body}</g>`;
    return `<defs><clipPath id="cv">${tile('', coverW, 120)}</clipPath></defs>
      <rect width="1024" height="1024" fill="${dark ? '#1B1A17' : cream}"/>${framed}`;
  },

  notebook(dark) {
    const bg = dark ? '#1E211F' : '#F7F4EC';
    const grid = dark ? '#2E3631' : '#D6E0E6';
    const ink = dark ? '#ECE8DD' : '#2B2B2B';
    const hi = dark ? '#B9A432' : '#FFE45C';
    const red = dark ? '#FF6B5C' : '#D23B2A';
    let lines = '';
    for (let p = 32; p < 1024; p += 64) {
      lines += `<path d="M${p} 0V1024M0 ${p}H1024" stroke="${grid}" stroke-width="${(p - 32) % 256 ? 3 : 6}"/>`;
    }
    return `<rect width="1024" height="1024" fill="${bg}"/>${lines}
      <path d="M190 560 Q 200 470 300 470 L 820 452 Q 850 520 820 600 L 230 628 Q 180 620 190 560z" fill="${hi}" opacity="${dark ? 0.75 : 0.9}"/>
      ${bookmark(272, 232, 480, `fill="none" stroke="${ink}" stroke-width="1.7" stroke-linejoin="round"`)}
      <path d="M640 330 l60 64 l120 -150" fill="none" stroke="${red}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`;
  },

  gallery(dark) {
    const wall = dark ? '#121212' : '#FFFFFF';
    const frame = dark ? '#F2F0EB' : '#111111';
    const mat = dark ? '#1E1E1E' : '#F4F2EE';
    return `<rect width="1024" height="1024" fill="${wall}"/>
      <rect x="252" y="182" width="520" height="660" fill="${mat}" stroke="${frame}" stroke-width="26"/>
      ${bookmark(332, 286, 360, `fill="${frame}"`)}
      <rect x="452" y="890" width="120" height="12" fill="${frame}"/>`;
  },

  atlas(dark) {
    const [top, bottom] = dark ? ['#1A2238', '#0A0E1A'] : ['#FAF3E6', '#EDE2CC'];
    const contour = dark ? '#2B3A5C' : '#D8C9AE';
    const amber = dark ? '#FFB547' : '#D97F00';
    const cyan = dark ? '#3CC8E0' : '#0F8297';
    let rings = '';
    for (let i = 0; i < 7; i++) {
      const rx = 120 + i * 78, ry = 90 + i * 64;
      rings += `<ellipse cx="560" cy="470" rx="${rx}" ry="${ry}" transform="rotate(${-18 + i * 3} 560 470)" fill="none" stroke="${contour}" stroke-width="7"/>`;
    }
    return `<defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34"/></filter>
      </defs>
      <rect width="1024" height="1024" fill="url(#sky)"/>${rings}
      <path d="M150 860 C 300 760 300 640 420 600" fill="none" stroke="${cyan}" stroke-width="22" stroke-linecap="round" stroke-dasharray="2 46"/>
      ${dark ? bookmark(352, 268, 400, `fill="${amber}" opacity="0.55" filter="url(#glow)"`) : ''}
      ${bookmark(352, 268, 400, `fill="${amber}"`)}`;
  },

  swiss(dark) {
    const paper = dark ? '#121212' : '#FFFFFF';
    const ink = dark ? '#F0F0F0' : '#111111';
    const red = dark ? '#FF3B2F' : '#E3271C';
    return `<rect width="1024" height="1024" fill="${paper}"/>
      <path d="M0 200H1024M0 824H1024M200 0V1024" stroke="${ink}" stroke-width="5"/>
      <rect x="200" y="200" width="300" height="300" fill="${red}"/>
      ${bookmark(392, 236, 560, `fill="${ink}"`)}`;
  },
};

// `small` is for toolbar sizes (48 px and under); only the app's own icon draws differently there.
// `noShadow` drops the offset shadow, which turns into a bright halo once tinted mode greys the art.
export function iconSVG(id, dark, { rounded = false, small = false, noShadow = false } = {}) {
  let art = ICONS[id](dark, small);
  if (noShadow) art = art.replace(/<g class="shadow"[^>]*>.*?<\/g>/s, '');
  const clip = rounded
    ? `<defs><clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath></defs><g clip-path="url(#tile)">${art}</g>`
    : art;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${clip}</svg>`;
}
