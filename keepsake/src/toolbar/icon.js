// Toolbar icon: the one picked in Settings → Appearance (felt pocket or a style's icon), in the version
// that suits the browser's light or dark theme. The manifest ships the light pocket; extension pages
// (which can read prefers-color-scheme, unlike the service worker) report the theme and the choice, and
// the last ones seen are kept so the worker can restore them after a browser restart.

const KEY = 'actionIconScheme';
const CHOICE_KEY = 'actionIconChoice';
const SIZES = [16, 32, 48, 128];
let scheme = 'light';
let choice = 'pocket';
let chosen = false; // a page has said which icon to use

// Path to one icon file. `icon` is 'pocket' or a style id (see ICONS in src/shared/storage.js).
export function iconPath(icon, mode, size) {
  const dir = icon && icon !== 'pocket' ? `icons/styles/${icon}` : 'icons';
  return `/${dir}${mode === 'dark' ? '/dark' : ''}/icon${size}.png`;
}

async function apply() {
  const path = Object.fromEntries(SIZES.map((s) => [s, iconPath(choice, scheme, s)]));
  try { await chrome.action.setIcon({ path }); } catch { /* icon is cosmetic */ }
}

// Service worker: re-apply the last theme and icon an extension page saw.
export async function restoreActionIcon() {
  try {
    const got = (await chrome.storage.local.get([KEY, CHOICE_KEY])) || {};
    scheme = got[KEY] === 'dark' ? 'dark' : 'light';
    choice = typeof got[CHOICE_KEY] === 'string' ? got[CHOICE_KEY] : 'pocket';
    if (scheme === 'dark' || choice !== 'pocket') await apply();
  } catch { /* icon is cosmetic */ }
}

// Extension pages: use this icon from now on (from settings.icon).
export function setActionIcon(icon) {
  const next = typeof icon === 'string' && icon ? icon : 'pocket';
  chosen = true;
  if (next === choice) return;
  choice = next;
  apply();
  Promise.resolve().then(() => chrome.storage.local.set({ [CHOICE_KEY]: choice })).catch(() => {});
}

// Extension pages: match the icon to the theme now and whenever it changes.
export function followColorScheme() {
  if (typeof matchMedia !== 'function') return;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    scheme = query.matches ? 'dark' : 'light';
    apply();
    Promise.resolve().then(() => chrome.storage.local.set({ [KEY]: scheme })).catch(() => {});
  };
  query.addEventListener('change', update);
  // Start from the last choice seen, so the icon doesn't flash the pocket while settings load.
  Promise.resolve().then(() => chrome.storage.local.get(CHOICE_KEY))
    .then((got) => { if (!chosen && typeof got?.[CHOICE_KEY] === 'string') choice = got[CHOICE_KEY]; })
    .catch(() => {})
    .finally(update);
}
