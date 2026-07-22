import highsLoader from "highs";
import type { DemandLine, OptimizeOptions, Pick, Plan, SupplyListing } from "./types.js";
import { prepare, finalize, infeasiblePlan, type Prepared } from "./optimize.js";

// highs-js is loaded once and reused.
let highsPromise: Promise<any> | null = null;
function loadHighs(): Promise<any> {
  if (!highsPromise) highsPromise = (highsLoader as unknown as () => Promise<any>)();
  return highsPromise;
}

/** Format a float for CPLEX-LP output without scientific notation. */
function num(n: number): string {
  return n.toFixed(6).replace(/\.?0+$/, "") || "0";
}

/**
 * Build a CPLEX-LP model of the cart problem.
 *
 *   minimize   Σ price_i · x_i  +  w · Σ ship_s · y_s
 *   s.t.       Σ_{i∈card} x_i = need           (cover each card exactly)
 *              x_i − qty_i · y_{seller(i)} ≤ 0 (buy only from selected sellers)
 *              Σ_s y_s ≤ K                     (seller/package cap)
 *              0 ≤ x_i ≤ qty_i integer,  y_s ∈ {0,1}
 */
function buildLp(p: Prepared, opts: OptimizeOptions): { lp: string; sellerVar: Map<string, string> } {
  const w = opts.shippingWeight ?? 1;
  const K = opts.maxSellers;
  const sellers = [...p.bySeller.keys()];
  const sellerVar = new Map(sellers.map((s, i) => [s, `y${i}`]));

  const obj: string[] = [];
  p.listings.forEach((l, i) => {
    if (l.price !== 0) obj.push(`+ ${num(l.price)} x${i}`);
  });
  for (const s of sellers) {
    const ship = (p.shipEst.get(s) ?? 0) * w;
    if (ship !== 0) obj.push(`+ ${num(ship)} ${sellerVar.get(s)}`);
  }

  const cons: string[] = [];
  // demand equality per card
  for (const d of p.demand) {
    const terms = (p.byCard.get(d.id) ?? []).map((i) => `+ x${i}`);
    cons.push(` dem_${sanitize(d.id)}: ${terms.join(" ")} = ${d.need}`);
  }
  // linking: x_i - qty_i * y_seller <= 0
  p.listings.forEach((l, i) => {
    cons.push(` lnk${i}: x${i} - ${num(l.quantity)} ${sellerVar.get(l.sellerKey)} <= 0`);
  });
  // seller cap
  cons.push(` cap: ${sellers.map((s) => `+ ${sellerVar.get(s)}`).join(" ")} <= ${K}`);

  const bounds: string[] = [];
  p.listings.forEach((l, i) => bounds.push(` 0 <= x${i} <= ${num(l.quantity)}`));

  const ints = p.listings.map((_, i) => `x${i}`).join(" ");
  const bins = sellers.map((s) => sellerVar.get(s)!).join(" ");

  const lp = [
    "Minimize",
    ` obj: ${obj.join(" ") || "0"}`,
    "Subject To",
    ...cons,
    "Bounds",
    ...bounds,
    "General",
    ` ${ints}`,
    "Binary",
    ` ${bins}`,
    "End",
    "",
  ].join("\n");
  return { lp, sellerVar };
}

function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
}

/** Solve the cart problem to optimality with HiGHS (MIP). Falls back to null on failure. */
export async function solveExact(
  demand: DemandLine[],
  listings: SupplyListing[],
  opts: OptimizeOptions,
): Promise<Plan | null> {
  const p = prepare(demand, listings);
  if (p.listings.length === 0) return infeasiblePlan("exact", p);
  let highs: any;
  try {
    highs = await loadHighs();
  } catch {
    return null; // WASM unavailable -> caller falls back to greedy
  }
  const { lp } = buildLp(p, opts);
  let sol: any;
  try {
    sol = highs.solve(lp, { time_limit: (opts.timeLimitMs ?? 20000) / 1000 });
  } catch {
    return null;
  }
  const status = String(sol?.Status ?? "");
  if (status !== "Optimal") {
    // Infeasible is a real answer; anything else -> let greedy try.
    return status === "Infeasible" ? infeasiblePlan("exact", p) : null;
  }

  const picks: Pick[] = [];
  let cardsCost = 0;
  const cols = sol.Columns ?? {};
  p.listings.forEach((l, i) => {
    const v = cols[`x${i}`];
    const q = Math.round(v?.Primal ?? 0);
    if (q > 0) {
      picks.push({
        cardId: l.cardId,
        label: p.labels.get(l.cardId) ?? l.cardId,
        sellerKey: l.sellerKey,
        sellerName: l.sellerName,
        sku: l.sku,
        qty: q,
        price: l.price,
      });
      cardsCost += l.price * q;
    }
  });
  let shipCost = 0;
  for (const s of new Set(picks.map((pk) => pk.sellerKey))) shipCost += p.shipEst.get(s) ?? 0;
  return finalize("exact", picks, cardsCost, shipCost, p);
}
