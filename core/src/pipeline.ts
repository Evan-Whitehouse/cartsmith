import type { ParsedDeck } from "./parsers/index.js";
import { parseDeck } from "./parsers/index.js";
import { resolveWantList, type ResolveResult } from "./resolve.js";
import { fetchListings, type ListingQuery } from "./listings.js";
import { optimize } from "./run.js";
import type { HttpOptions } from "./http.js";
import type { OptimizeOptions, Plan, SupplyListing } from "./types.js";

export interface BuildOptions extends ListingQuery {
  maxSellers?: number;
  shippingWeight?: number;
  greedy?: boolean;
  timeLimitMs?: number;
  onProgress?: (msg: string) => void;
  http?: HttpOptions;
}

export interface BuildResult {
  parsed: ParsedDeck;
  resolve: ResolveResult;
  plan: Plan;
  listingCount: number;
}

/**
 * End-to-end: parse a Riftbound deck list, resolve it to products, pull live listings,
 * and optimize the ≤N-seller cart. This is the engine both the extension and the
 * CLI drive; it makes network calls but never touches credentials.
 */
export async function buildCart(deckText: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const log = opts.onProgress ?? (() => {});
  const parsed = parseDeck(deckText);
  log(`Parsed ${parsed.lines.length} card lines.`);

  const resolve = await resolveWantList(parsed.lines, opts.http);
  const pids = [...resolve.cardByProductId.keys()];
  log(`Resolved ${resolve.demand.length} cards to ${pids.length} printings.`);

  const q: ListingQuery = {
    conditions: opts.conditions,
    languages: opts.languages,
    printing: opts.printing,
    shippingCountry: opts.shippingCountry,
    maxPerProduct: opts.maxPerProduct,
  };
  // Price every product concurrently; the HTTP semaphore caps simultaneous requests.
  const listings: SupplyListing[] = [];
  let done = 0;
  await Promise.all(
    pids.map(async (pid) => {
      const cardId = resolve.cardByProductId.get(pid)!;
      try {
        const raw = await fetchListings(pid, q, opts.http);
        for (const l of raw) {
          listings.push({
            cardId,
            sellerKey: l.sellerKey,
            sellerName: l.sellerName,
            price: l.price,
            quantity: l.quantity,
            shipping: l.shippingPrice ?? 0,
            sku: l.productConditionId,
          });
        }
      } catch (e) {
        log(`  listings failed for product ${pid}: ${(e as Error).message}`);
      }
      log(`  priced ${++done}/${pids.length} products`);
    }),
  );
  log(`Collected ${listings.length} listings. Optimizing...`);

  const optOpts: OptimizeOptions = {
    maxSellers: opts.maxSellers ?? 5,
    shippingWeight: opts.shippingWeight,
    greedy: opts.greedy,
    timeLimitMs: opts.timeLimitMs,
  };
  const plan = await optimize(resolve.demand, listings, optOpts);
  return { parsed, resolve, plan, listingCount: listings.length };
}
