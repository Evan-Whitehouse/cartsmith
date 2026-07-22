import type { Plan } from "./types.js";

/**
 * Cart application logic — the only part that touches the user's session, and it does so
 * WITHOUT ever reading a cookie file or handling an auth token. It calls TCGPlayer's cart
 * endpoint the same way the website does; when run same-origin (a content script on
 * tcgplayer.com, or a fetch with credentials), the browser attaches the login itself.
 *
 * This module is pure/injectable so it can be unit-tested with a fake fetch, and reused by
 * the extension's content script.
 */

const MPGATEWAY = "https://mpgateway.tcgplayer.com";
const DEFAULT_MPFEV = "5328"; // rolling client-version stamp; overridable when it changes.

/** Extract the cart key from a `document.cookie` string (cookie `StoreCart_PRODUCTION`). */
export function parseCartKey(cookieString: string): string | null {
  // cookie value looks like: StoreCart_PRODUCTION=CK=<guid>&Ignore=false
  const m = /StoreCart_PRODUCTION=([^;]+)/.exec(cookieString);
  const raw = m?.[1] ? decodeURIComponent(m[1]) : cookieString;
  const ck = /CK=([^&;]+)/.exec(raw);
  return ck?.[1] ?? null;
}

export interface AddItem {
  sku: string | number;
  sellerKey: string;
  quantity: number;
  price: number;
  label?: string;
}

export interface AddResult {
  item: AddItem;
  ok: boolean;
  status: number | null;
  error?: string;
}

export interface ApplyOptions {
  cartKey: string;
  /** Inject fetch for testing; defaults to global fetch with credentials included. */
  fetchImpl?: typeof fetch;
  mpfev?: string;
  countryCode?: string;
  /** ms between adds to be gentle (default 400). */
  spacingMs?: number;
  onProgress?: (done: number, total: number, last: AddResult) => void;
}

/** Flatten an optimizer Plan into cart line items. */
export function planToItems(plan: Plan): AddItem[] {
  return plan.picks.map((p) => ({
    sku: p.sku,
    sellerKey: p.sellerKey,
    quantity: p.qty,
    price: p.price,
    label: p.label,
  }));
}

async function addOne(item: AddItem, o: Required<Pick<ApplyOptions, "cartKey" | "mpfev" | "countryCode">>, doFetch: typeof fetch): Promise<AddResult> {
  const url = `${MPGATEWAY}/v1/cart/${o.cartKey}/item/add?mpfev=${o.mpfev}`;
  const body = {
    sku: typeof item.sku === "string" ? Number(item.sku) : item.sku,
    sellerKey: item.sellerKey,
    channelId: 0,
    requestedQuantity: item.quantity,
    price: item.price,
    isDirect: false,
    countryCode: o.countryCode,
  };
  try {
    const res = await doFetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { item, ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    return { item, ok: false, status: null, error: (e as Error).message };
  }
}

/**
 * Add every item to the cart. Returns a per-item result list. Never throws for HTTP errors —
 * a failed line is reported so the UI can fall back to the manual output view. Does not check
 * out.
 */
export async function applyPlan(items: AddItem[], opts: ApplyOptions): Promise<AddResult[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const o = {
    cartKey: opts.cartKey,
    mpfev: opts.mpfev ?? DEFAULT_MPFEV,
    countryCode: opts.countryCode ?? "US",
  };
  const spacing = opts.spacingMs ?? 400;
  const results: AddResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = await addOne(items[i]!, o, doFetch);
    results.push(r);
    opts.onProgress?.(i + 1, items.length, r);
    if (spacing > 0 && i < items.length - 1) await new Promise((res) => setTimeout(res, spacing));
  }
  return results;
}
