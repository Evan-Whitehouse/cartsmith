/**
 * Background service worker. It runs the optimize pipeline OUT OF the popup, so closing the
 * popup or switching tabs never loses progress — the run continues here and its state is
 * written to chrome.storage, which the popup reads back whenever it reopens.
 *
 * Uses the pure-JS greedy solver (no WASM in the worker). Pricing fetches run concurrently.
 */
import {
  parseDeck,
  resolveWantList,
  fetchListings,
  solveGreedy,
  setConcurrency,
  type SupplyListing,
} from "@cartsmith/core";
import { MSG_OPTIMIZE, setState, type OptimizeParams } from "./state.js";

let running = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== MSG_OPTIMIZE) return;
  if (running) {
    sendResponse({ ok: false, error: "already running" });
    return;
  }
  void run(msg.params as OptimizeParams).finally(() => (running = false));
  running = true;
  sendResponse({ ok: true });
  return true;
});

async function run(params: OptimizeParams): Promise<void> {
  try {
    setConcurrency(6);
    await setState({
      status: "running",
      progress: "Reading deck…",
      plan: null,
      unresolved: [],
      notes: [],
      error: null,
    });

    const parsed = parseDeck(params.deck);
    if (parsed.lines.length === 0) {
      await setState({ status: "error", error: parsed.warnings.join(" ") || "No cards recognized." });
      return;
    }

    await setState({ progress: `Resolving ${parsed.lines.length} cards…` });
    const resolve = await resolveWantList(parsed.lines);
    const pids = [...resolve.cardByProductId.keys()];
    if (pids.length === 0) {
      await setState({
        status: "error",
        error: "Couldn't find any of these cards in TCGplayer's Riftbound catalog. Check the card names.",
        unresolved: resolve.unresolved.map((u) => u.name),
      });
      return;
    }

    const listings: SupplyListing[] = [];
    let done = 0;
    let lastTick = 0;
    await Promise.all(
      pids.map(async (pid) => {
        const cardId = resolve.cardByProductId.get(pid)!;
        try {
          const raw = await fetchListings(pid, {
            conditions: params.conditions,
            languages: ["English"],
            maxPerProduct: 200,
          });
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
        } catch {
          /* skip a product that failed to price */
        }
        done++;
        const now = Date.now();
        if (now - lastTick > 250 || done === pids.length) {
          lastTick = now;
          await setState({ progress: `Pricing… ${done}/${pids.length} products` });
        }
      }),
    );

    await setState({ progress: "Optimizing…" });
    const plan = solveGreedy(resolve.demand, listings, { maxSellers: params.maxSellers });
    await setState({
      status: "done",
      progress: "",
      plan,
      unresolved: resolve.unresolved.map((u) => u.name),
      notes: resolve.notes.slice(0, 4),
    });
  } catch (e) {
    await setState({ status: "error", error: (e as Error).message });
  }
}
