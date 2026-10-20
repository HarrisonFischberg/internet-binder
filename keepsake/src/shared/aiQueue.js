// Run AI on imported saves: works through a list of saves a couple at a time, slowing down when your
// provider asks (a 429 or 529, an overloaded or timed-out request) and stopping when it can't go on (a
// bad key, no credit). Shared by the Chrome worker and the tests; the caller supplies the work for one
// save (src/shared/fill.js readImported) and how to wait. Nothing here talks to the network itself.

export const AI_QUEUE = {
  concurrency: 2, // requests in flight at once
  tries: 4, // a save the provider keeps turning away is left for the next run
  baseDelayMs: 4000, // first wait after "slow down", doubled each time in a row
  maxDelayMs: 120000,
  busyStreak: 8, // this many "slow down" answers in a row: pause the run rather than keep knocking
};

// What an error from the provider means for the run: 'fatal' stops it (every other save would fail the
// same way), 'slow' waits and tries the save again, 'item' gives up on that save only.
export function aiErrorKind(e) {
  const msg = String((e && e.message) || e || '');
  const status = Number(e?.status) || Number(msg.match(/\((\d{3})\)/)?.[1]) || 0;
  if (status === 401 || status === 403 || /API key|base URL|credit balance|billing|quota/i.test(msg)) return 'fatal';
  if (status === 408 || status === 409 || status === 429 || status >= 500 || e?.name === 'AbortError'
    || /aborted|timed? ?out|overloaded|rate.?limit|failed to fetch|networkerror|network/i.test(msg)) return 'slow';
  return 'item';
}

// How long to wait before the next request: what the provider said (Retry-After), else doubling from
// baseDelayMs, with a little jitter so two runs don't line up.
export function backoffMs(e, streak, { baseDelayMs = AI_QUEUE.baseDelayMs, maxDelayMs = AI_QUEUE.maxDelayMs, random = Math.random } = {}) {
  const asked = Number(e?.retryAfter);
  const ms = Number.isFinite(asked) && asked > 0 ? asked * 1000 : baseDelayMs * 2 ** Math.max(0, streak - 1);
  return Math.min(maxDelayMs, ms) + Math.round(random() * 1000);
}

// ids: the saves to read. work(id) does one save and returns { changed } (or null when there was nothing
// to do). stopped() is checked between saves and while waiting: Pause and Cancel. onProgress(p) hears every
// change: { done, changed, failed, waitingUntil }. sleep(ms) waits (the worker passes one that keeps Chrome
// from putting it to sleep). Returns the totals and, when the run ended early, why.
export async function runAiQueue(ids, { work, stopped = () => false, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), ...opts } = {}) {
  const cfg = { ...AI_QUEUE, ...opts };
  const p = { done: 0, changed: 0, failed: 0, waitingUntil: 0, error: '', reason: '' };
  let next = 0;
  let streak = 0; // "slow down" answers in a row, across saves
  let resumeAt = 0; // every worker waits until then after one is told to slow down
  const halted = () => !!p.reason || stopped();
  const waitTurn = async () => {
    while (!halted() && now() < resumeAt) await sleep(Math.min(1000, resumeAt - now()));
    if (p.waitingUntil) {
      p.waitingUntil = 0;
      onProgress({ ...p });
    }
  };
  async function one(id) {
    for (let attempt = 1; ; attempt++) {
      await waitTurn();
      if (halted()) return false;
      try {
        const r = await work(id);
        streak = 0;
        if (r && r.changed) p.changed++;
        return true;
      } catch (e) {
        const kind = aiErrorKind(e);
        p.error = String((e && e.message) || e).slice(0, 200);
        if (kind === 'fatal') {
          p.reason = 'fatal';
          return false;
        }
        if (kind === 'item' || attempt >= cfg.tries) {
          p.failed++;
          return true;
        }
        streak++;
        if (streak >= cfg.busyStreak) {
          p.reason = 'busy';
          return false;
        }
        resumeAt = Math.max(resumeAt, now() + backoffMs(e, streak, cfg));
        p.waitingUntil = resumeAt;
        onProgress({ ...p });
      }
    }
  }
  async function worker() {
    while (next < ids.length && !halted()) {
      const id = ids[next++];
      // A save left unread when the run stops keeps its flag, so the next run reads it.
      if (await one(id)) {
        p.done++;
        onProgress({ ...p });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.concurrency, ids.length)) }, worker));
  return { ...p, waitingUntil: 0, stopped: !p.reason && stopped() };
}
