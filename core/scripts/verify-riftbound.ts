/**
 * Live end-to-end check: run the engine on the Riftbound deck the prototype used and confirm
 * it produces a ≤5-seller plan in the same ballpark as the prototype's ~$186 result.
 *
 *   npx tsx scripts/verify-riftbound.ts
 *
 * Hits live TCGPlayer endpoints; takes a couple of minutes. Not part of the unit suite.
 */
import { buildCart } from "../src/index.js";

const DECK = `2 Alpha Strike
7 Body Rune
5 Calm Rune
2 Challenge
3 Charm
3 Defy
3 Disarming Rake
3 Discipline
1 Emperor's Dais
2 En Garde
3 Fiora - Peerless
2 First Mate
1 Master Yi - Tempered
1 Master Yi - Wuju Bladesman
3 Pit Rookie
1 Primal Strength
3 Punch First
3 Rengar - Trophy Hunter
3 Ruin Runner
1 Seat of Power
1 The Arena's Greatest
2 Zhonya's Hourglass
2 Mindsplitter
1 Void Seeker
3 Bewitching Spirit
3 Treasure Trove
3 Pack of Wonders
3 Acceptable Losses
3 The List
3 Void Seeker
1 Beast Below
2 Downwell
1 Death from Below
1 Abandon
1 Factory Recall
1 Switcheroo
2 Vex - Apathetic
1 Windsinger
1 Fading Memories
1 Ripper's Bay
1 Forbidding Waste
1 Void Gate
1 Vilemaw's Lair
1 Aspirant's Climb
1 Frozen Fortress`;

const t0 = Date.now();
const res = await buildCart(DECK, {
  maxSellers: 5,
  conditions: ["Near Mint", "Lightly Played"],
  languages: ["English"],
  shippingCountry: "US",
  onProgress: (m) => process.stdout.write(`\r\x1b[2K${m}`),
});
process.stdout.write("\n\n");

const { plan, resolve } = res;
if (resolve.unresolved.length) {
  console.log("UNRESOLVED:", resolve.unresolved.map((l) => l.name).join(", "));
}
for (const note of resolve.notes.slice(0, 6)) console.log("note:", note);

const bySeller = new Map<string, typeof plan.picks>();
for (const p of plan.picks) (bySeller.get(p.sellerKey) ?? bySeller.set(p.sellerKey, []).get(p.sellerKey)!).push(p);
console.log("\n=== PLAN ===");
for (const [sk, picks] of bySeller) {
  const sub = picks.reduce((s, p) => s + p.price * p.qty, 0);
  const name = picks[0]?.sellerName ?? sk;
  console.log(`\n${name}  ($${sub.toFixed(2)}, ${picks.reduce((s, p) => s + p.qty, 0)} cards)`);
  for (const p of picks.sort((a, b) => b.price - a.price)) {
    console.log(`   ${p.qty}x ${p.label.padEnd(26)} $${p.price.toFixed(2)}`);
  }
}
console.log(
  `\nfeasible=${plan.feasible} method=${plan.method} sellers=${plan.sellers.length} ` +
    `cards=$${plan.cardsCost} ship=$${plan.shipCost} TOTAL=$${plan.total}`,
);
console.log(`(${res.listingCount} listings, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
if (plan.underCovered.length) {
  console.log("UNDER-COVERED:", plan.underCovered.map((u) => `${u.missing}x ${u.label}`).join(", "));
}
