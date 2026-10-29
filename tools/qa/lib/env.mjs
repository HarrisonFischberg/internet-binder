// Live-provider credentials for QA runs, read from one explicit file and never from the shell profile.
// The file holds KEY=value lines (ANTHROPIC_API_KEY, OPENAI_API_KEY). Values are returned to the caller
// only; nothing here prints, logs or writes them. The report says which names were present, never values.

import { readFileSync, statSync } from 'node:fs';

const ALLOWED = new Set(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);

export function loadQaEnv(path) {
  const status = { path, found: false, private: false, names: [] };
  if (!path) return { keys: {}, status };
  let text = '';
  try {
    const st = statSync(path);
    status.found = true;
    // Readable by the owner only (600 or 400); anything wider is refused so a loose file isn't used.
    status.private = (st.mode & 0o077) === 0;
    if (!status.private) return { keys: {}, status: { ...status, error: 'credentials file is readable by other users; run chmod 600 on it' } };
    text = readFileSync(path, 'utf8');
  } catch {
    return { keys: {}, status };
  }
  const keys = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !ALLOWED.has(m[1]) || !m[2]) continue;
    keys[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  status.names = Object.keys(keys);
  return { keys, status };
}

// Anything that might echo a key (an error message, a request dump) goes through this first.
export function redact(text, keys) {
  let out = String(text ?? '');
  for (const v of Object.values(keys || {})) if (v && v.length >= 8) out = out.split(v).join('[redacted]');
  return out.replace(/sk-(?:ant-)?[A-Za-z0-9_-]{12,}/g, '[redacted]');
}
