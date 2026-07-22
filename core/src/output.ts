import type { Plan } from "./types.js";

/**
 * Fallback outputs for when the one-click cart-add is unavailable (endpoint changed, not on
 * a tcgplayer.com tab, or the user prefers manual). These are ToS-clean: a Mass Entry string
 * uses TCGPlayer's official bulk-add feature, and the per-seller links just open storefronts.
 */

/** Aggregate a plan's picks into a `<qty> <name>` Mass Entry blob (TCGPlayer /massentry). */
export function generateMassEntry(plan: Plan): string {
  const byName = new Map<string, number>();
  for (const p of plan.picks) byName.set(p.label, (byName.get(p.label) ?? 0) + p.qty);
  return [...byName.entries()].map(([name, qty]) => `${qty} ${name}`).join("\n");
}

export interface SellerLink {
  sellerKey: string;
  sellerName?: string;
  url: string;
  cards: { label: string; qty: number; price: number }[];
  subtotal: number;
}

/** Per-seller storefront links plus what to buy from each — the manual fallback checklist. */
export function sellerLinks(plan: Plan): SellerLink[] {
  const bySeller = new Map<string, SellerLink>();
  for (const p of plan.picks) {
    let entry = bySeller.get(p.sellerKey);
    if (!entry) {
      entry = {
        sellerKey: p.sellerKey,
        sellerName: p.sellerName,
        url: `https://www.tcgplayer.com/search/all/product?seller=${encodeURIComponent(p.sellerKey)}&view=grid`,
        cards: [],
        subtotal: 0,
      };
      bySeller.set(p.sellerKey, entry);
    }
    entry.cards.push({ label: p.label, qty: p.qty, price: p.price });
    entry.subtotal += p.price * p.qty;
  }
  return [...bySeller.values()].sort((a, b) => b.subtotal - a.subtotal);
}
