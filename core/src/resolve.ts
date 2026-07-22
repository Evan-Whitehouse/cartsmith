import type { DemandLine, WantLine } from "./types.js";
import { searchProducts, type ProductCandidate } from "./catalog.js";
import { norm } from "./norm.js";
import type { HttpOptions } from "./http.js";

/** Strip a trailing parenthetical like "(Alternate Art)" to get a card's base name. */
function baseName(productName: string): string {
  return productName.replace(/\s*\([^)]*\)\s*$/, "");
}

export interface ResolvedCard {
  /** Stable demand id (normalized name, or name+set when a set was given). */
  id: string;
  label: string;
  need: number;
  /** Candidate TCGPlayer productIds (all matching printings = substitutes). */
  productIds: number[];
  /** True when a set was requested but couldn't be pinned, so all printings are used. */
  setUnresolved?: boolean;
}

export interface ResolveResult {
  demand: DemandLine[];
  cards: ResolvedCard[];
  productIdsByCard: Map<string, number[]>;
  cardByProductId: Map<number, string>;
  unresolved: WantLine[];
  notes: string[];
}

/** Substring matched against TCGPlayer's productLineName to keep only Riftbound products. */
const PRODUCT_LINE = "riftbound";

/**
 * Resolve a parsed want-list to TCGPlayer Riftbound products. Each card's matching
 * printings across sets are treated as substitutes (cheapest wins in the optimizer). If a
 * set code is supplied and can be pinned to a printing, resolution narrows to it; otherwise
 * all printings are kept and a note is emitted.
 */
export async function resolveWantList(
  lines: WantLine[],
  http: HttpOptions = {},
): Promise<ResolveResult> {
  const cards: ResolvedCard[] = [];
  const unresolved: WantLine[] = [];
  const notes: string[] = [];
  const productIdsByCard = new Map<string, number[]>();
  const cardByProductId = new Map<number, string>();

  // Fire all catalog searches concurrently; the HTTP semaphore bounds actual parallelism.
  const searched = await Promise.all(
    lines.map((line) =>
      searchProducts(line.name, http).then(
        (candidates) => ({ line, candidates, err: null as Error | null }),
        (err: Error) => ({ line, candidates: [] as ProductCandidate[], err }),
      ),
    ),
  );

  for (const { line, candidates, err } of searched) {
    const target = norm(line.name);
    if (err) {
      unresolved.push(line);
      notes.push(`Search failed for "${line.name}": ${err.message}`);
      continue;
    }
    const inGame = candidates.filter((c) => c.productLineName?.toLowerCase().includes(PRODUCT_LINE));
    let matches = inGame.filter((c) => norm(baseName(c.productName)) === target);
    if (matches.length === 0) {
      unresolved.push(line);
      notes.push(`No product found for "${line.name}" in Riftbound.`);
      continue;
    }

    let setUnresolved = false;
    if (line.set) {
      const bySet = matches.filter((c) => {
        const s = c.setName?.toLowerCase() ?? "";
        return s.includes(line.set!.toLowerCase());
      });
      if (bySet.length > 0) matches = bySet;
      else setUnresolved = true; // couldn't map the set code; keep all printings
    }
    const distinctSets = new Set(matches.map((m) => m.setName ?? "")).size;
    if (!line.set && distinctSets > 1) {
      notes.push(
        `"${line.name}" appears in ${distinctSets} sets; using cheapest printing. Add a set code to pin it.`,
      );
    }

    const id = line.set ? `${target}|${line.set.toLowerCase()}` : target;
    const productIds = [...new Set(matches.map((m) => m.productId))];
    cards.push({ id, label: line.name, need: line.qty, productIds, setUnresolved });
    const existing = productIdsByCard.get(id) ?? [];
    productIdsByCard.set(id, [...new Set([...existing, ...productIds])]);
    for (const pid of productIds) cardByProductId.set(pid, id);
    if (setUnresolved) notes.push(`Set "${line.set}" for "${line.name}" not matched; using all printings.`);
  }

  // merge duplicate demand ids (same card requested twice)
  const byId = new Map<string, DemandLine>();
  for (const c of cards) {
    const d = byId.get(c.id);
    if (d) d.need += c.need;
    else byId.set(c.id, { id: c.id, label: c.label, need: c.need });
  }

  return {
    demand: [...byId.values()],
    cards,
    productIdsByCard,
    cardByProductId,
    unresolved,
    notes,
  };
}
