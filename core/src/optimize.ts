import type {
  DemandLine,
  OptimizeOptions,
  Pick,
  Plan,
  SupplyListing,
} from "./types.js";

/** Estimate each seller's per-order shipping as the modal shipping value across its listings. */
export function estimateShipping(listings: SupplyListing[]): Map<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const l of listings) {
    let m = counts.get(l.sellerKey);
    if (!m) counts.set(l.sellerKey, (m = new Map()));
    m.set(l.shipping, (m.get(l.shipping) ?? 0) + 1);
  }
  const est = new Map<string, number>();
  for (const [seller, m] of counts) {
    let best = 0;
    let bestCount = -1;
    for (const [ship, c] of m) {
      // most frequent shipping wins; ties broken toward the lower price
      if (c > bestCount || (c === bestCount && ship < best)) {
        best = ship;
        bestCount = c;
      }
    }
    est.set(seller, best);
  }
  return est;
}

interface Prepared {
  demand: DemandLine[];
  listings: SupplyListing[];
  byCard: Map<string, number[]>; // cardId -> listing indices
  bySeller: Map<string, number[]>; // sellerKey -> listing indices
  shipEst: Map<string, number>;
  labels: Map<string, string>;
}

function prepare(demand: DemandLine[], listings: SupplyListing[]): Prepared {
  const byCard = new Map<string, number[]>();
  const bySeller = new Map<string, number[]>();
  listings.forEach((l, i) => {
    (byCard.get(l.cardId) ?? byCard.set(l.cardId, []).get(l.cardId)!).push(i);
    (bySeller.get(l.sellerKey) ?? bySeller.set(l.sellerKey, []).get(l.sellerKey)!).push(i);
  });
  const labels = new Map(demand.map((d) => [d.id, d.label]));
  return { demand, listings, byCard, bySeller, shipEst: estimateShipping(listings), labels };
}

/** Given a fixed set of sellers, greedily fill each card from the cheapest available copies. */
function assign(
  sellers: Set<string>,
  p: Prepared,
): { picks: Pick[]; cardsCost: number; shipCost: number } | null {
  const picks: Pick[] = [];
  let cardsCost = 0;
  for (const d of p.demand) {
    const idxs = (p.byCard.get(d.id) ?? [])
      .filter((i) => sellers.has(p.listings[i]!.sellerKey))
      .sort((a, b) => p.listings[a]!.price - p.listings[b]!.price);
    let left = d.need;
    for (const i of idxs) {
      if (left <= 0) break;
      const l = p.listings[i]!;
      const take = Math.min(l.quantity, left);
      if (take <= 0) continue;
      picks.push({
        cardId: d.id,
        label: d.label,
        sellerKey: l.sellerKey,
        sellerName: l.sellerName,
        sku: l.sku,
        qty: take,
        price: l.price,
      });
      cardsCost += l.price * take;
      left -= take;
    }
    if (left > 0) return null; // this seller set cannot cover the card
  }
  const used = new Set(picks.map((pk) => pk.sellerKey));
  let shipCost = 0;
  for (const s of used) shipCost += p.shipEst.get(s) ?? 0;
  return { picks, cardsCost, shipCost };
}

function coverageOf(seller: string, p: Prepared): number {
  const cards = new Set<string>();
  for (const i of p.bySeller.get(seller) ?? []) cards.add(p.listings[i]!.cardId);
  return cards.size;
}

/**
 * Beam search over seller SETS. Pure, synchronous, dependency-free — the fallback
 * when the exact solver is unavailable, and a fast first cut. Not guaranteed optimal.
 */
export function solveGreedy(
  demand: DemandLine[],
  listings: SupplyListing[],
  opts: OptimizeOptions,
): Plan {
  const p = prepare(demand, listings);
  const w = opts.shippingWeight ?? 1;
  const K = opts.maxSellers;
  const score = (r: { cardsCost: number; shipCost: number }) => r.cardsCost + w * r.shipCost;

  const allSellers = [...p.bySeller.keys()];
  // Candidate pool: top sellers by coverage, plus the cheapest sellers for the rarest cards.
  const pool = [...allSellers].sort((a, b) => coverageOf(b, p) - coverageOf(a, p)).slice(0, 120);
  const poolSet = new Set(pool);
  const rarest = [...p.demand].sort(
    (a, b) => (p.byCard.get(a.id)?.length ?? 0) - (p.byCard.get(b.id)?.length ?? 0),
  );
  for (const d of rarest.slice(0, 8)) {
    const sellersForCard = [...new Set((p.byCard.get(d.id) ?? []).map((i) => p.listings[i]!.sellerKey))]
      .sort((a, b) => {
        const pa = Math.min(...(p.byCard.get(d.id) ?? []).filter((i) => p.listings[i]!.sellerKey === a).map((i) => p.listings[i]!.price));
        const pb = Math.min(...(p.byCard.get(d.id) ?? []).filter((i) => p.listings[i]!.sellerKey === b).map((i) => p.listings[i]!.price));
        return pa - pb;
      })
      .slice(0, 3);
    for (const s of sellersForCard) poolSet.add(s);
  }
  const candidates = [...poolSet];

  let best: { set: Set<string>; result: ReturnType<typeof assign> } | null = null;
  let beam: Set<string>[] = [new Set()];
  const seen = new Set<string>();
  for (let round = 0; round < K; round++) {
    const next: { key: string; set: Set<string>; s: number }[] = [];
    for (const st of beam) {
      for (const seller of candidates) {
        if (st.has(seller)) continue;
        const ns = new Set(st).add(seller);
        if (ns.size > K) continue;
        const key = [...ns].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const result = assign(ns, p);
        const s = result ? score(result) : Number.POSITIVE_INFINITY;
        next.push({ key, set: ns, s });
        if (result && (!best || score(best.result!) > s)) best = { set: ns, result };
      }
    }
    next.sort((a, b) => a.s - b.s);
    beam = next.slice(0, 60).map((n) => n.set);
    if (beam.length === 0) break;
  }

  if (!best || !best.result) {
    return infeasiblePlan("greedy", p);
  }
  return finalize("greedy", best.result.picks, best.result.cardsCost, best.result.shipCost, p);
}

function infeasiblePlan(method: "exact" | "greedy", p: Prepared): Plan {
  return {
    feasible: false,
    method,
    picks: [],
    sellers: [],
    cardsCost: 0,
    shipCost: 0,
    total: 0,
    underCovered: p.demand.map((d) => ({ cardId: d.id, label: d.label, missing: d.need })),
  };
}

function finalize(
  method: "exact" | "greedy",
  picks: Pick[],
  cardsCost: number,
  shipCost: number,
  p: Prepared,
): Plan {
  const got = new Map<string, number>();
  for (const pk of picks) got.set(pk.cardId, (got.get(pk.cardId) ?? 0) + pk.qty);
  const underCovered = p.demand
    .filter((d) => (got.get(d.id) ?? 0) < d.need)
    .map((d) => ({ cardId: d.id, label: d.label, missing: d.need - (got.get(d.id) ?? 0) }));
  return {
    feasible: underCovered.length === 0,
    method,
    picks,
    sellers: [...new Set(picks.map((pk) => pk.sellerKey))],
    cardsCost: round2(cardsCost),
    shipCost: round2(shipCost),
    total: round2(cardsCost + shipCost),
    underCovered,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export { prepare, assign, finalize, infeasiblePlan, round2 };
export type { Prepared };
