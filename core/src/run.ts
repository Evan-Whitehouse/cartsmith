import type { DemandLine, OptimizeOptions, Plan, SupplyListing } from "./types.js";
import { solveGreedy } from "./optimize.js";

/**
 * Optimize a cart: satisfy every demand line at minimum item + shipping cost using at most
 * `opts.maxSellers` sellers. Uses the exact MIP solver (HiGHS) when available, and falls
 * back to the greedy heuristic if the solver can't load or returns a non-optimal status.
 *
 * The exact solver (and its HiGHS-WASM dependency) is loaded lazily via dynamic import, so a
 * caller that passes `greedy: true` (e.g. the browser extension's default) never pulls the
 * WASM into its bundle.
 */
export async function optimize(
  demand: DemandLine[],
  listings: SupplyListing[],
  opts: OptimizeOptions,
): Promise<Plan> {
  if (!opts.greedy) {
    try {
      const { solveExact } = await import("./exact.js");
      const exact = await solveExact(demand, listings, opts);
      if (exact) return exact;
    } catch {
      // WASM unavailable / failed to load -> greedy fallback below
    }
  }
  return solveGreedy(demand, listings, opts);
}
