import type { WantLine } from "../types.js";

// leading "<qty>[x] <rest>"
const QTY = /^(\d+)\s*x?\s+(.*)$/;
// trailing "(SET) number" on the remainder.
const SETNUM = /^(.+?)\s*(?:\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9-]+)?)?\s*$/;

export interface ParsedDeck {
  lines: WantLine[];
  warnings: string[];
}

/**
 * Parse a Riftbound deck list of plain "<qty> <name>" lines into a normalized want-list.
 * An optional trailing "(SET) number" pins a printing. Blank lines, `//` comments, and
 * anything without a leading quantity (section headers like "Legend:") are ignored;
 * every card across all sections is included. Duplicate lines are summed.
 */
export function parseDeck(text: string): ParsedDeck {
  const merged = new Map<string, WantLine>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//")) continue; // comment
    const q = QTY.exec(line);
    if (!q) continue;
    const qty = parseInt(q[1]!, 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const m = SETNUM.exec(q[2]!.trim());
    if (!m) continue;
    const name = m[1]!.trim();
    if (!name) continue;
    const set = m[2]?.toUpperCase();
    const number = m[3]?.replace(/^0+(?=\d)/, "");
    const key = [name.toLowerCase(), set ?? "", number ?? ""].join("|");
    const existing = merged.get(key);
    if (existing) existing.qty += qty;
    else merged.set(key, { qty, name, set, number, raw: line });
  }
  const lines = [...merged.values()];
  const warnings: string[] = [];
  if (lines.length === 0) {
    warnings.push("No card lines were recognized. Check the list format.");
  }
  return { lines, warnings };
}
