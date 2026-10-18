// Toolbar icon that follows the browser's light or dark theme.
// The manifest ships the light pocket; extension pages (which can read
// prefers-color-scheme, unlike the service worker) report the theme, and the
// last one seen is kept so the worker can restore it after a browser restart.

const KEY = 'actionIconScheme';
const SIZES = [16, 32, 48, 128];

function paths(scheme) {
  const dir = scheme === 'dark' ? 'icons/dark' : 'icons';
  return Object.fromEntries(SIZES.map((s) => [s, `/${dir}/icon${s}.png`]));
}

async function apply(scheme) {
  try { await chrome.action.setIcon({ path: paths(scheme) }); } catch { /* icon is cosmetic */ }
}

// Service worker: re-apply the last theme an extension page saw.
export async function restoreActionIcon() {
  try {
    const { [KEY]: scheme } = (await chrome.storage.local.get(KEY)) || {};
    if (scheme === 'dark') await apply(scheme);
  } catch { /* icon is cosmetic */ }
}

// Extension pages: match the icon to the theme now and whenever it changes.
export function followColorScheme() {
  if (typeof matchMedia !== 'function') return;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const scheme = query.matches ? 'dark' : 'light';
    apply(scheme);
    Promise.resolve().then(() => chrome.storage.local.set({ [KEY]: scheme })).catch(() => {});
  };
  update();
  query.addEventListener('change', update);
}
