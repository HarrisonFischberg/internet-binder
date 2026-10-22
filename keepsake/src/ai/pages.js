// Reads a page a save links to, for your AI provider (src/shared/understand.js): only a site this
// browser already lets Internet Binder read (Fix with AI's access to all sites, or that site's own), without
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

// A small copy of a save's picture for your AI provider (src/shared/understand.js), when the picture is a
// link rather than a stored thumbnail: fetched like a page (only a site this browser already lets Internet Binder
// read, without cookies), shrunk to at most 640 px and sent as a JPEG.
export async function loadImage(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  try {
    if (!(await chrome.permissions.contains({ origins: [`${u.origin}/*`] }))) return null;
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(u.href, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) || blob.size > 15_000_000) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < jpeg.length; i += 0x8000) bin += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(bin)}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
