/**
 * Minimal HTTP helpers shared by the catalog and listings clients. Uses the global `fetch`
 * (present in Node 18+ and every browser). In the extension these run same-origin; the
 * search/listings endpoints need no credentials.
 *
 * Requests are bounded by a concurrency semaphore (not serialized), so many product lookups
 * run in parallel while still capping the load we put on TCGPlayer.
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";

export interface HttpOptions {
  timeoutMs?: number;
  userAgent?: string;
}

let maxConcurrency = 6;
/** Cap on simultaneous in-flight requests to TCGPlayer. */
export function setConcurrency(n: number): void {
  maxConcurrency = Math.max(1, Math.floor(n));
}

let jitterMs = 0;
/** Optional random pre-request delay (0–jitterMs) to avoid lockstep bursts. Kept for compat. */
export function setMinSpacing(ms: number): void {
  jitterMs = Math.max(0, ms);
}

let active = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < maxConcurrency) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot to the next waiter; active unchanged
  else active--;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    if (jitterMs) await new Promise((r) => setTimeout(r, Math.random() * jitterMs));
    return await fn();
  } finally {
    release();
  }
}

function headersFor(json: boolean, opts: HttpOptions): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (json) h["content-type"] = "application/json";
  // Node needs a browser-like UA to avoid being bounced; browsers disallow setting it.
  if (typeof window === "undefined") h["user-agent"] = opts.userAgent ?? DEFAULT_UA;
  return h;
}

async function doFetch<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function postJson<T>(url: string, body: unknown, opts: HttpOptions = {}): Promise<T> {
  return guarded(() =>
    doFetch<T>(
      url,
      { method: "POST", headers: headersFor(true, opts), body: JSON.stringify(body) },
      opts.timeoutMs ?? 30000,
    ),
  );
}

/** Retry a promise-returning fn with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}
