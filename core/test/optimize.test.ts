import { describe, expect, it } from "vitest";
import { optimize, solveGreedy } from "../src/index.js";
import type { DemandLine, SupplyListing } from "../src/types.js";

function L(
  cardId: string,
  sellerKey: string,
  price: number,
  quantity: number,
  shipping: number,
  sku: string | number = `${cardId}-${sellerKey}`,
): SupplyListing {
  return { cardId, sellerKey, price, quantity, shipping, sku };
}
const D = (id: string, need: number): DemandLine => ({ id, label: id, need });

describe("optimizer", () => {
  it("prefers one seller when shipping outweighs cheaper items elsewhere", async () => {
    const demand = [D("X", 2), D("Y", 1)];
    const listings = [
      L("X", "s1", 1, 5, 1),
      L("Y", "s1", 1, 5, 1),
      L("X", "s2", 0.5, 5, 5),
      L("Y", "s2", 0.5, 5, 5),
    ];
    const plan = await optimize(demand, listings, { maxSellers: 5 });
    expect(plan.feasible).toBe(true);
    expect(plan.sellers).toEqual(["s1"]);
    expect(plan.total).toBe(4);
  });

  it("uses multiple sellers when each holds a disjoint card", async () => {
    const demand = [D("A", 1), D("B", 1)];
    const listings = [L("A", "s1", 1, 1, 2), L("B", "s2", 1, 1, 3)];
    const plan = await optimize(demand, listings, { maxSellers: 2 });
    expect(plan.feasible).toBe(true);
    expect(new Set(plan.sellers)).toEqual(new Set(["s1", "s2"]));
    expect(plan.total).toBe(7);
  });

  it("reports infeasible when the seller cap cannot cover disjoint demand", async () => {
    const demand = [D("A", 1), D("B", 1)];
    const listings = [L("A", "s1", 1, 1, 2), L("B", "s2", 1, 1, 3)];
    const plan = await optimize(demand, listings, { maxSellers: 1 });
    expect(plan.feasible).toBe(false);
  });

  it("splits across sellers to satisfy quantity within the cap", async () => {
    const demand = [D("A", 3)];
    const listings = [
      L("A", "s1", 1, 2, 1),
      L("A", "s2", 1, 2, 1),
      L("A", "s3", 0.5, 1, 10),
    ];
    const plan = await optimize(demand, listings, { maxSellers: 2 });
    expect(plan.feasible).toBe(true);
    expect(plan.total).toBe(5); // s1(2)+s2(1) items=3 + ship 1+1
    expect(new Set(plan.sellers)).toEqual(new Set(["s1", "s2"]));
  });

  it("greedy agrees with exact on the disjoint-card case", async () => {
    const demand = [D("A", 1), D("B", 1)];
    const listings = [L("A", "s1", 1, 1, 2), L("B", "s2", 1, 1, 3)];
    const exact = await optimize(demand, listings, { maxSellers: 2 });
    const greedy = solveGreedy(demand, listings, { maxSellers: 2 });
    expect(greedy.total).toBe(exact.total);
    expect(new Set(greedy.sellers)).toEqual(new Set(exact.sellers));
  });
});
