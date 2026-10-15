// Web APIs the shared Keepsake rules use that JavaScriptCore doesn't have.
// Prepended to the iOS core bundle by bundle-core.mjs. Checked against Node's own URL by
// ios/tools/url-parity.test.mjs, so a URL means the same thing on iPhone and in Chrome.
//
// The host (Swift) provides globalThis.__native with: uuid(), setTimeout(fn, ms), log(msg).

(function () {
  const g = globalThis;
  const native = g.__native || {};

  if (!g.crypto) g.crypto = {};
  if (typeof g.crypto.randomUUID !== 'function') {
    g.crypto.randomUUID = () => (native.uuid ? native.uuid() : fallbackUuid());
  }
  if (typeof g.crypto.getRandomValues !== 'function') {
    g.crypto.getRandomValues = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; };
  }
  function fallbackUuid() {
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += h[(Math.random() * 4) | 8];
      else s += h[(Math.random() * 16) | 0];
    }
    return s;
  }

  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = function clone(v) {
      if (v === null || typeof v !== 'object') return v;
      if (v instanceof Date) return new Date(v.getTime());
      if (Array.isArray(v)) return v.map(clone);
      if (v instanceof Map) return new Map([...v].map(([k, x]) => [clone(k), clone(x)]));
      if (v instanceof Set) return new Set([...v].map(clone));
      const out = {};
      for (const k of Object.keys(v)) out[k] = clone(v[k]);
      return out;
    };
  }

  if (typeof g.setTimeout !== 'function') {
    g.setTimeout = (fn, ms, ...args) => (native.setTimeout ? native.setTimeout(() => fn(...args), ms || 0) : (Promise.resolve().then(() => fn(...args)), 0));
    g.clearTimeout = (id) => { if (native.clearTimeout) native.clearTimeout(id); };
  }

  if (!g.console) {
    const log = (...a) => native.log && native.log(a.map(String).join(' '));
    g.console = { log, warn: log, error: log, info: log, debug: () => {} };
  }

  // fetch over the host's network bridge. The host decides what may be contacted (an allowlist built
  // from the person's settings: their AI provider when AI is on, each Lookup they turned on) and sends
  // no cookies. __native.fetch(url, method, headersJSON, body, done(status, bodyText, error)).
  if (typeof g.AbortController !== 'function') {
    g.AbortController = class AbortController {
      constructor() {
        const listeners = [];
        this.signal = { aborted: false, addEventListener: (t, fn) => { if (t === 'abort') listeners.push(fn); }, removeEventListener() {} };
        this._fire = () => listeners.forEach((fn) => fn());
      }
      abort() { if (!this.signal.aborted) { this.signal.aborted = true; this._fire(); } }
    };
  }
  if (typeof g.fetch !== 'function' && native.fetch) {
    g.fetch = (input, init = {}) => new Promise((resolve, reject) => {
      const url = String(input && input.url ? input.url : input);
      const signal = init.signal;
      if (signal && signal.aborted) { reject(new Error('The request was cancelled.')); return; }
      let settled = false;
      if (signal) signal.addEventListener('abort', () => { if (!settled) { settled = true; reject(new Error('The request took too long.')); } });
      const headers = {};
      const h = init.headers || {};
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { headers[k] = v; });
      else for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) headers[k] = String(v);
      native.fetch(url, String(init.method || 'GET').toUpperCase(), JSON.stringify(headers), init.body == null ? '' : String(init.body), (status, text, error) => {
        if (settled) return;
        settled = true;
        if (error) { reject(new TypeError(error)); return; }
        resolve({
          ok: status >= 200 && status < 300, status, statusText: '', url,
          text: async () => text,
          json: async () => JSON.parse(text),
          headers: { get: () => null },
        });
      });
    });
  }

  if (typeof g.URL === 'function' && !g.__forceUrlPolyfill) return;

  // --- WHATWG URL (the parts Keepsake uses) -------------------------------------------------------
  // Special schemes (http, https, ws, wss, ftp, file) are parsed fully: host lowercasing and IDNA,
  // default ports, path dot-segments, and percent-encoding sets. Other schemes keep an opaque path.

  const SPECIAL = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21', 'file:': '' };
  const C0 = (c) => c <= 0x1f || c > 0x7e;
  const FRAGMENT = new Set([0x20, 0x22, 0x3c, 0x3e, 0x60]);
  const QUERY = new Set([0x20, 0x22, 0x23, 0x3c, 0x3e]);
  const SPECIAL_QUERY = new Set([...QUERY, 0x27]);
  const PATH = new Set([...QUERY, 0x3f, 0x5e, 0x60, 0x7b, 0x7d]);
  const USERINFO = new Set([...PATH, 0x2f, 0x3a, 0x3b, 0x3d, 0x40, 0x5b, 0x5c, 0x5d, 0x7c]);
  const FORBIDDEN_HOST = /[\u0000\t\n\r #/:<>?@[\\\]^|]/;
  const FORBIDDEN_DOMAIN = /[\u0000-\u001f\t\n\r #%/:<>?@[\\\]^|\u007f]/;

  const utf8 = (s) => unescape(encodeURIComponent(s));
  function encodeSet(s, set) {
    let out = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x80 && !C0(c) && !set.has(c)) { out += ch; continue; }
      if (c < 0x80 && !set.has(c) && !C0(c)) { out += ch; continue; }
      let bytes;
      try { bytes = utf8(ch); } catch { bytes = '\xef\xbf\xbd'; }
      for (let i = 0; i < bytes.length; i++) out += '%' + bytes.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
  }
  function percentDecodeBytes(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x25 && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
      else if (c < 0x80) bytes.push(c);
      else { const b = utf8(s[i] + (c >= 0xd800 && c <= 0xdbff ? s[i + 1] || '' : '')); if (c >= 0xd800 && c <= 0xdbff) i++; for (let j = 0; j < b.length; j++) bytes.push(b.charCodeAt(j)); }
    }
    return bytes;
  }
  function utf8Decode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      let n = b < 0x80 ? 0 : b >= 0xf0 && b < 0xf5 ? 3 : b >= 0xe0 ? 2 : b >= 0xc2 && b < 0xe0 ? 1 : -1;
      if (n < 0) { out += '�'; i++; continue; }
      let cp = n === 0 ? b : b & (0xff >> (n + 2));
      let ok = true;
      for (let k = 1; k <= n; k++) {
        const x = bytes[i + k];
        if (x === undefined || (x & 0xc0) !== 0x80) { ok = false; break; }
        cp = (cp << 6) | (x & 0x3f);
      }
      if (!ok) { out += '�'; i++; continue; }
      out += String.fromCodePoint(cp);
      i += n + 1;
    }
    return out;
  }
  const percentDecode = (s) => utf8Decode(percentDecodeBytes(s));

  // Punycode (RFC 3492) for internationalised host names.
  function punycode(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const cps = [...input].map((c) => c.codePointAt(0));
    let n = 128, delta = 0, bias = 72;
    let out = cps.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join('');
    const b = out.length;
    let h = b;
    if (b) out += '-';
    const digit = (d) => String.fromCharCode(d + 22 + 75 * (d < 26));
    const adapt = (d, num, first) => {
      d = first ? Math.floor(d / damp) : d >> 1;
      d += Math.floor(d / num);
      let k = 0;
      while (d > ((base - tMin) * tMax) >> 1) { d = Math.floor(d / (base - tMin)); k += base; }
      return k + Math.floor(((base - tMin + 1) * d) / (d + skew));
    };
    while (h < cps.length) {
      const m = Math.min(...cps.filter((c) => c >= n));
      delta += (m - n) * (h + 1);
      n = m;
      for (const c of cps) {
        if (c < n) delta++;
        if (c === n) {
          let q = delta;
          for (let k = base; ; k += base) {
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (q < t) break;
            out += digit(t + ((q - t) % (base - t)));
            q = Math.floor((q - t) / (base - t));
          }
          out += digit(q);
          bias = adapt(delta, h + 1, h === b);
          delta = 0;
          h++;
        }
      }
      delta++;
      n++;
    }
    return out;
  }
  function toAscii(domain) {
    const mapped = domain.normalize('NFC').toLowerCase().replace(/[。．｡]/g, '.');
    return mapped.split('.').map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : 'xn--' + punycode(label))).join('.');
  }

  function parseIPv4Number(s) {
    if (s === '') return NaN;
    let r = 10;
    if (/^0[xX]/.test(s)) { s = s.slice(2); r = 16; } else if (s.length > 1 && s[0] === '0') { s = s.slice(1); r = 8; }
    if (s === '') return 0;
    const re = r === 16 ? /^[0-9a-fA-F]+$/ : r === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
    return re.test(s) ? parseInt(s, r) : NaN;
  }
  function parseHost(input, special) {
    if (input.startsWith('[')) {
      if (!input.endsWith(']')) throw new TypeError('Invalid URL');
      return input.toLowerCase(); // IPv6: kept as written (lowercased); Keepsake never relies on its compression
    }
    if (!special) {
      if (FORBIDDEN_HOST.test(input)) throw new TypeError('Invalid URL');
      return encodeSet(input, new Set());
    }
    const domain = percentDecode(input);
    const ascii = toAscii(domain);
    if (ascii === '' || FORBIDDEN_DOMAIN.test(ascii)) throw new TypeError('Invalid URL');
    const parts = ascii.split('.');
    if (parts[parts.length - 1] === '' && parts.length > 1) parts.pop();
    const last = parts[parts.length - 1];
    if (/^[0-9]+$/.test(last) || /^0[xX][0-9a-fA-F]*$/.test(last)) {
      const nums = parts.map(parseIPv4Number);
      if (nums.some((x) => Number.isNaN(x)) || nums.length > 4) throw new TypeError('Invalid URL');
      let ip = nums[nums.length - 1];
      if (ip >= 256 ** (5 - nums.length)) throw new TypeError('Invalid URL');
      for (let i = 0; i < nums.length - 1; i++) { if (nums[i] > 255) throw new TypeError('Invalid URL'); ip += nums[i] * 256 ** (3 - i); }
      const o = [];
      for (let i = 3; i >= 0; i--) o.push(Math.floor(ip / 256 ** i) % 256);
      return o.join('.');
    }
    return ascii;
  }

  function normalizePath(raw, special) {
    const segs = raw.split(special ? /[\/\\]/ : /\//);
    if (segs[0] === '') segs.shift();
    const out = [];
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1;
      const s = seg.toLowerCase();
      if (s === '..' || s === '.%2e' || s === '%2e.' || s === '%2e%2e') { out.pop(); if (last) out.push(''); }
      else if (s === '.' || s === '%2e') { if (last) out.push(''); }
      else out.push(encodeSet(seg, PATH));
    });
    return '/' + out.join('/');
  }

  class URLSearchParams {
    constructor(init = '', url = null) {
      this._list = [];
      this._url = url;
      if (typeof init === 'string') this._parse(init);
      else if (init && typeof init === 'object') {
        const pairs = typeof init[Symbol.iterator] === 'function' ? [...init] : Object.entries(init);
        for (const [k, v] of pairs) this._list.push([String(k), String(v)]);
      }
    }
    _parse(s) {
      this._list = [];
      if (s.startsWith('?')) s = s.slice(1);
      for (const part of s.split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = i < 0 ? part : part.slice(0, i);
        const v = i < 0 ? '' : part.slice(i + 1);
        this._list.push([percentDecode(k.replace(/\+/g, ' ')), percentDecode(v.replace(/\+/g, ' '))]);
      }
    }
    _update() {
      if (!this._url) return;
      const s = this.toString();
      this._url._query = s === '' ? null : s;
    }
    append(k, v) { this._list.push([String(k), String(v)]); this._update(); }
    delete(k, v) { this._list = this._list.filter(([a, b]) => a !== String(k) || (v !== undefined && b !== String(v))); this._update(); }
    get(k) { const e = this._list.find(([a]) => a === String(k)); return e ? e[1] : null; }
    getAll(k) { return this._list.filter(([a]) => a === String(k)).map(([, b]) => b); }
    has(k, v) { return this._list.some(([a, b]) => a === String(k) && (v === undefined || b === String(v))); }
    set(k, v) {
      k = String(k); v = String(v);
      const i = this._list.findIndex(([a]) => a === k);
      if (i < 0) this._list.push([k, v]);
      else { this._list[i][1] = v; this._list = this._list.filter(([a], j) => a !== k || j === i); }
      this._update();
    }
    sort() { this._list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); this._update(); }
    get size() { return this._list.length; }
    forEach(fn, self) { for (const [k, v] of this._list) fn.call(self, v, k, this); }
    *keys() { for (const [k] of this._list) yield k; }
    *values() { for (const [, v] of this._list) yield v; }
    *entries() { for (const e of this._list) yield [e[0], e[1]]; }
    [Symbol.iterator]() { return this.entries(); }
    toString() {
      const enc = (s) => {
        let out = '';
        const bytes = utf8(s);
        for (let i = 0; i < bytes.length; i++) {
          const c = bytes.charCodeAt(i);
          if (c === 0x20) out += '+';
          else if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2a || c === 0x2d || c === 0x2e || c === 0x5f) out += String.fromCharCode(c);
          else out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
        }
        return out;
      };
      return this._list.map(([k, v]) => enc(k) + '=' + enc(v)).join('&');
    }
  }

  class URL {
    constructor(input, base) {
      let s = String(input).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
      const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(s);
      if (!m) {
        if (base === undefined) throw new TypeError(`Invalid URL: ${input}`);
        const b = base instanceof URL ? base : new URL(base);
        if (!(b.protocol in SPECIAL)) throw new TypeError(`Invalid URL: ${input}`);
        if (/^[\/\\]{2}/.test(s)) s = b.protocol + s;
        else if (/^[\/\\]/.test(s)) s = b.protocol + '//' + b.host + s;
        else if (s.startsWith('?')) s = b.protocol + '//' + b.host + b.pathname + s;
        else if (s.startsWith('#')) s = b.protocol + '//' + b.host + b.pathname + b.search + s;
        else s = b.protocol + '//' + b.host + b.pathname.replace(/[^/]*$/, '') + s;
        return new URL(s);
      }
      this._protocol = m[1].toLowerCase() + ':';
      let rest = s.slice(m[0].length);
      this._username = ''; this._password = ''; this._host = ''; this._port = ''; this._query = null; this._fragment = null;
      const hashAt = rest.indexOf('#');
      if (hashAt >= 0) { this._fragment = encodeSet(rest.slice(hashAt + 1), FRAGMENT); rest = rest.slice(0, hashAt); }
      const special = this._protocol in SPECIAL;
      this._special = special;
      const qAt = rest.indexOf('?');
      if (qAt >= 0) { this._query = encodeSet(rest.slice(qAt + 1), special ? SPECIAL_QUERY : QUERY); rest = rest.slice(0, qAt); }
      if (special || rest.startsWith('//')) {
        rest = special ? rest.replace(/^[\/\\]*/, '') : rest.slice(2);
        const end = rest.search(special ? /[\/\\]/ : /\//);
        let auth = end < 0 ? rest : rest.slice(0, end);
        const path = end < 0 ? '' : rest.slice(end);
        const at = auth.lastIndexOf('@');
        if (at >= 0) {
          const info = auth.slice(0, at);
          auth = auth.slice(at + 1);
          const c = info.indexOf(':');
          this._username = encodeSet(c < 0 ? info : info.slice(0, c), USERINFO);
          this._password = c < 0 ? '' : encodeSet(info.slice(c + 1), USERINFO);
        }
        const pm = /:([0-9]*)$/.exec(auth);
        let hostPart = auth;
        if (pm && !(auth.startsWith('[') && !auth.slice(0, pm.index).endsWith(']'))) {
          hostPart = auth.slice(0, pm.index);
          if (pm[1] !== '') {
            const port = Number(pm[1]);
            if (port > 65535) throw new TypeError(`Invalid URL: ${input}`);
            this._port = SPECIAL[this._protocol] === String(port) ? '' : String(port);
          }
        } else if (/:[^\]]*$/.test(auth) && !auth.startsWith('[')) {
          throw new TypeError(`Invalid URL: ${input}`);
        }
        if (special && this._protocol !== 'file:' && hostPart === '') throw new TypeError(`Invalid URL: ${input}`);
        this._host = hostPart === '' ? '' : parseHost(hostPart, special);
        this._path = special ? normalizePath(path || '/', true) : path === '' ? '' : normalizePath(path, false);
        this._opaque = false;
      } else {
        this._path = encodeSet(rest, new Set());
        this._opaque = true;
      }
      this._params = new URLSearchParams(this._query || '', this);
    }
    get protocol() { return this._protocol; }
    get username() { return this._username; }
    get password() { return this._password; }
    get hostname() { return this._host; }
    get port() { return this._port; }
    get host() { return this._host + (this._port ? ':' + this._port : ''); }
    get origin() { return this._special && this._protocol !== 'file:' ? this._protocol + '//' + this.host : 'null'; }
    get pathname() { return this._path; }
    get search() { return this._query ? '?' + this._query : ''; }
    set search(v) {
      v = String(v);
      if (v.startsWith('?')) v = v.slice(1);
      this._query = v === '' ? null : encodeSet(v, this._special ? SPECIAL_QUERY : QUERY);
      this._params._parse(this._query || '');
    }
    get searchParams() { return this._params; }
    get hash() { return this._fragment ? '#' + this._fragment : ''; }
    set hash(v) {
      v = String(v);
      if (v.startsWith('#')) v = v.slice(1);
      this._fragment = v === '' ? null : encodeSet(v, FRAGMENT);
    }
    get href() {
      let s = this._protocol;
      if (!this._opaque) {
        s += '//';
        if (this._username || this._password) s += this._username + (this._password ? ':' + this._password : '') + '@';
        s += this.host;
      }
      return s + this._path + (this._query !== null ? '?' + this._query : '') + (this._fragment !== null ? '#' + this._fragment : '');
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
    static canParse(u, b) { try { new URL(u, b); return true; } catch { return false; } }
  }

  g.URL = URL;
  g.URLSearchParams = URLSearchParams;
})();
