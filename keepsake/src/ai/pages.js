// Reads a page a save links to, for your AI provider (src/shared/understand.js): only a site this
// browser already lets Keepsake read (Fix with AI's access to all sites, or that site's own), without
// cookies, and only its HTML.
export async function fetchPage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  try {
    if (!(await chrome.permissions.contains({ origins: [`${u.origin}/*`] }))) return null;
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(u.href, { credentials: 'omit', redirect: 'follow', signal: controller.signal, headers: { accept: 'text/html,application/xhtml+xml' } });
    if (!res.ok || !/html/i.test(res.headers?.get?.('content-type') || '')) return null;
    return (await res.text()).slice(0, 2_000_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
