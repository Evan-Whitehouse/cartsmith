/** A single line parsed from a deck list, before catalog resolution. */
export interface WantLine {
  qty: number;
  name: string;
  /** Set code / abbreviation if the list provided one (e.g. "M21", "OBF"). */
  set?: string;
  /** Collector / card number within the set, if provided. */
  number?: string;
  /** Raw source line, for diagnostics and ambiguity reporting. */
  raw?: string;
}

/** A demand line the optimizer must satisfy: buy `need` copies of card `id`. */
export interface DemandLine {
  /** Stable key identifying the wanted card (normalized name, or name+set). */
  id: string;
  /** Human label for display. */
  label: string;
  need: number;
}

/**
 * One purchasable offer. Game/marketplace-agnostic on purpose so the optimizer
 * and its tests never depend on TCGPlayer specifics. `cardId` ties the offer to
 * the demand line it can fill (a card may be filled by several products/printings).
 */
export interface SupplyListing {
  cardId: string;
  sellerKey: string;
  sellerName?: string;
  /** Per-copy item price. */
  price: number;
  /** Copies available at this price from this seller. */
  quantity: number;
  /** Per-order shipping this seller charges (used to estimate seller shipping). */
  shipping: number;
  /** Opaque SKU passed straight through to the cart (TCGPlayer productConditionId). */
  sku: string | number;
}

export interface OptimizeOptions {
  /** Maximum number of distinct sellers / packages. */
  maxSellers: number;
  /** Multiplier on shipping in the objective (default 1). >1 favors fewer packages. */
  shippingWeight?: number;
  /** Solver time budget in milliseconds for the exact solver (default 20000). */
  timeLimitMs?: number;
  /** Force the greedy heuristic instead of the exact solver. */
  greedy?: boolean;
}

export interface Pick {
  cardId: string;
  label: string;
  sellerKey: string;
  sellerName?: string;
  sku: string | number;
  qty: number;
  price: number;
}

export interface Plan {
  feasible: boolean;
  /** Which solver produced this plan. */
  method: "exact" | "greedy";
  picks: Pick[];
  sellers: string[];
  cardsCost: number;
  shipCost: number;
  total: number;
  /** Cards that could not be fully covered within the seller cap / supply. */
  underCovered: { cardId: string; label: string; missing: number }[];
}
