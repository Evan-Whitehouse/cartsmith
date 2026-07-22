import { describe, expect, it, vi } from "vitest";
import { applyPlan, parseCartKey, planToItems, type AddItem } from "../src/cart.js";
import type { Plan } from "../src/types.js";

describe("parseCartKey", () => {
  it("extracts CK guid from the StoreCart_PRODUCTION cookie", () => {
    const cookie = "foo=1; StoreCart_PRODUCTION=CK=18b79f09a0cf425abf39229f3a86c888&Ignore=false; bar=2";
    expect(parseCartKey(cookie)).toBe("18b79f09a0cf425abf39229f3a86c888");
  });
  it("handles url-encoded cookie values", () => {
    const cookie = "StoreCart_PRODUCTION=CK%3Dabc123%26Ignore%3Dfalse";
    expect(parseCartKey(cookie)).toBe("abc123");
  });
  it("returns null when absent", () => {
    expect(parseCartKey("session=xyz")).toBeNull();
  });
});

describe("applyPlan", () => {
  const items: AddItem[] = [
    { sku: 111, sellerKey: "s1", quantity: 2, price: 1.5, label: "A" },
    { sku: "222", sellerKey: "s2", quantity: 1, price: 3.0, label: "B" },
  ];

  it("POSTs each item to the cart endpoint with credentials and correct payload", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;

    const results = await applyPlan(items, {
      cartKey: "CARTKEY",
      fetchImpl: fakeFetch,
      spacingMs: 0,
    });

    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://mpgateway.tcgplayer.com/v1/cart/CARTKEY/item/add?mpfev=5328");
    expect(calls[0]!.init.credentials).toBe("include");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      sku: 111,
      sellerKey: "s1",
      channelId: 0,
      requestedQuantity: 2,
      price: 1.5,
      isDirect: false,
      countryCode: "US",
    });
    // string sku coerced to number
    expect(JSON.parse(calls[1]!.init.body as string).sku).toBe(222);
  });

  it("reports per-item failures without throwing", async () => {
    const fakeFetch = vi.fn(async (_url: string, _init: RequestInit) => {
      return { status: 401 } as Response;
    }) as unknown as typeof fetch;
    const results = await applyPlan(items, { cartKey: "K", fetchImpl: fakeFetch, spacingMs: 0 });
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0]!.status).toBe(401);
  });

  it("planToItems flattens optimizer picks", () => {
    const plan = {
      picks: [{ cardId: "a", label: "A", sellerKey: "s1", sku: 5, qty: 3, price: 0.1 }],
    } as unknown as Plan;
    expect(planToItems(plan)).toEqual([
      { sku: 5, sellerKey: "s1", quantity: 3, price: 0.1, label: "A" },
    ]);
  });
});
