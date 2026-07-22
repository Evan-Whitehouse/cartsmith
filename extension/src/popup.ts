import { generateMassEntry, sellerLinks, planToItems, type AddItem, type Plan } from "@cartsmith/core";
import {
  MSG_OPTIMIZE,
  STATE_KEY,
  emptyState,
  getInputs,
  getState,
  saveInputs,
  type Inputs,
  type RunState,
} from "./state.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const money = (n: number) => `$${n.toFixed(2)}`;
const statusEl = $("status");
const resultEl = $("result");

const deckEl = $("deck") as HTMLTextAreaElement;
const maxEl = $("maxSellers") as HTMLInputElement;
const nmEl = $("condNM") as HTMLInputElement;
const lpEl = $("condLP") as HTMLInputElement;
const optimizeBtn = $("optimize") as HTMLButtonElement;

function readInputs(): Inputs {
  return {
    deck: deckEl.value,
    maxSellers: Math.max(1, Number(maxEl.value) || 5),
    condNM: nmEl.checked,
    condLP: lpEl.checked,
  };
}

function applyInputs(i: Inputs): void {
  deckEl.value = i.deck;
  maxEl.value = String(i.maxSellers);
  nmEl.checked = i.condNM;
  lpEl.checked = i.condLP;
}

// Restore form + last result the moment the popup opens.
void (async () => {
  const inputs = await getInputs();
  if (inputs) applyInputs(inputs);
  render(await getState());
})();

// Persist every keystroke/toggle so nothing is lost when the popup closes.
for (const el of [deckEl, maxEl, nmEl, lpEl]) {
  el.addEventListener("input", () => void saveInputs(readInputs()));
  el.addEventListener("change", () => void saveInputs(readInputs()));
}

// Live-update while the popup is open: the worker writes state, storage fires this.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STATE_KEY]) render(changes[STATE_KEY].newValue as RunState);
});

optimizeBtn.addEventListener("click", () => {
  const inputs = readInputs();
  if (!inputs.deck.trim()) return setStatus("Paste a deck list first.", true);
  const conditions = [
    inputs.condNM ? "Near Mint" : null,
    inputs.condLP ? "Lightly Played" : null,
  ].filter(Boolean) as string[];
  if (conditions.length === 0) conditions.push("Near Mint");
  void saveInputs(inputs);
  chrome.runtime.sendMessage({
    type: MSG_OPTIMIZE,
    params: { deck: inputs.deck, maxSellers: inputs.maxSellers, conditions },
  });
  render({ ...emptyState(), status: "running", progress: "Starting…" });
});

function setStatus(msg: string, err = false): void {
  statusEl.hidden = !msg;
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", err);
}

function render(state: RunState): void {
  optimizeBtn.disabled = state.status === "running";
  optimizeBtn.textContent = state.status === "running" ? "Optimizing…" : "Optimize cart";

  if (state.status === "running") {
    const stale = state.updatedAt > 0 && Date.now() - state.updatedAt > 90000;
    if (stale) {
      optimizeBtn.disabled = false;
      optimizeBtn.textContent = "Optimize cart";
      setStatus("The previous run stalled — click Optimize to retry.", true);
    } else {
      setStatus(state.progress || "Working…");
    }
    resultEl.hidden = true;
    return;
  }
  if (state.status === "error") {
    setStatus(state.error ?? "Something went wrong.", true);
    resultEl.hidden = true;
    return;
  }
  if (state.status !== "done" || !state.plan) {
    setStatus("");
    resultEl.hidden = true;
    return;
  }
  setStatus("");
  renderPlan(state.plan, state.unresolved, state.notes);
}

function renderPlan(plan: Plan, unresolved: string[], notes: string[]): void {
  const frag = document.createDocumentFragment();

  const summary = document.createElement("div");
  summary.className = "summary";
  const nCards = plan.picks.reduce((s, p) => s + p.qty, 0);
  summary.innerHTML = `<span>${plan.sellers.length} package${plan.sellers.length === 1 ? "" : "s"} · ${nCards} cards</span><b>${money(plan.total)}</b>`;
  frag.appendChild(summary);

  const addNote = (msg: string) => {
    const n = document.createElement("div");
    n.className = "note";
    n.textContent = msg;
    frag.appendChild(n);
  };
  if (!plan.feasible) {
    addNote(`Couldn't fully cover: ${plan.underCovered.map((u) => `${u.missing}× ${u.label}`).join(", ")}. Try raising max sellers.`);
  }
  if (unresolved.length) addNote(`Not found: ${unresolved.join(", ")}`);
  for (const msg of notes.slice(0, 4)) addNote(msg);

  for (const s of sellerLinks(plan)) {
    const box = document.createElement("div");
    box.className = "seller";
    const items = s.cards
      .sort((a, b) => b.price - a.price)
      .map((c) => `<li><span>${c.qty}× ${escapeHtml(c.label)}</span><span>${money(c.price)}</span></li>`)
      .join("");
    box.innerHTML = `<h3>${escapeHtml(s.sellerName ?? s.sellerKey)}<small>${money(s.subtotal)}</small></h3><ul>${items}</ul>`;
    frag.appendChild(box);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const addBtn = document.createElement("button");
  addBtn.className = "primary";
  addBtn.textContent = "Add to TCGplayer cart";
  addBtn.onclick = () => void addToCart(plan, addBtn);
  actions.appendChild(addBtn);
  frag.appendChild(actions);

  const details = document.createElement("details");
  const links = sellerLinks(plan)
    .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.sellerName ?? s.sellerKey)}</a>`)
    .join(" · ");
  details.innerHTML = `<summary>Manual fallback (Mass Entry + seller links)</summary><div>${links}</div><textarea readonly>${escapeHtml(generateMassEntry(plan))}</textarea>`;
  frag.appendChild(details);

  resultEl.innerHTML = "";
  resultEl.appendChild(frag);
  resultEl.hidden = false;
}

const MPFEV = "5328"; // rolling client-version stamp; update if TCGplayer rotates it.

/**
 * Runs INSIDE the tcgplayer.com tab (injected via chrome.scripting). Self-contained on
 * purpose — it cannot reference anything from the popup's scope. Reads the non-secret cart
 * key from document.cookie and POSTs each item same-origin, so the browser attaches the
 * user's login. Never reads a cookie file or the auth token.
 *
 * TCGplayer only creates a cart (and its StoreCart_PRODUCTION cookie) on the first add, so
 * a fresh account has neither. In that case this bootstraps one via the same
 * v1/cart/create/* endpoints the site's own frontend calls, then writes the cookie the way
 * the site does so the cart shows up when the user browses.
 */
interface ApplyResult {
  ok: boolean;
  error?: string;
  added?: number;
  total?: number;
  failed?: { index: number; status: number | null }[];
}

function applyInPage(
  items: { sku: number | string; sellerKey: string; quantity: number; price: number; label?: string }[],
  mpfev: string,
  countryCode: string,
): Promise<ApplyResult> {
  return (async () => {
    const readCookieKey = (): string | null => {
      const m = /StoreCart_PRODUCTION=([^;]+)/.exec(document.cookie);
      const raw = m && m[1] ? decodeURIComponent(m[1]) : document.cookie;
      const ck = /CK=([^&;]+)/.exec(raw);
      return ck?.[1] ?? null;
    };
    const GUID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;

    const createCart = async (path: string, body?: unknown): Promise<string | null> => {
      try {
        const res = await fetch(`https://mpgateway.tcgplayer.com/v1/cart/create/${path}?mpfev=${mpfev}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status < 200 || res.status >= 300) return null;
        const scan = (o: unknown): string | null => {
          if (typeof o === "string") return GUID.test(o) ? o : null;
          if (!o || typeof o !== "object") return null;
          const rec = o as Record<string, unknown>;
          for (const k of ["cartKey", "key", "cartId", "id"]) {
            const v = rec[k];
            if (typeof v === "string" && GUID.test(v)) return v;
          }
          return Array.isArray(rec.results) ? scan(rec.results[0]) : null;
        };
        return scan(await res.json().catch(() => null));
      } catch {
        return null;
      }
    };

    let cartKey = readCookieKey();
    if (!cartKey) {
      let externalId: string | null = null;
      try {
        const u = JSON.parse(localStorage.getItem("tcgplayer-user") ?? "null") as Record<string, unknown> | null;
        for (const k of ["externalUserId", "userKey", "userId", "id"]) {
          const v = u?.[k];
          if (typeof v === "string" && GUID.test(v)) {
            externalId = v;
            break;
          }
        }
        if (!externalId) {
          const ajs = (localStorage.getItem("ajs_user_id") ?? "").replace(/^"|"$/g, "");
          if (GUID.test(ajs)) externalId = ajs;
        }
      } catch {
        /* fall through to an anonymous cart */
      }
      cartKey =
        (externalId ? await createCart("usercart", { externalUserId: externalId }) : null) ??
        (await createCart("anonymouscart"));
      cartKey = readCookieKey() ?? cartKey; // prefer the cookie if the server set one during create
      if (cartKey && !readCookieKey()) {
        document.cookie = `StoreCart_PRODUCTION=${encodeURIComponent(`CK=${cartKey}&Ignore=false`)}; domain=.tcgplayer.com; path=/; max-age=31536000; secure`;
      }
    }
    if (!cartKey) {
      return {
        ok: false,
        error:
          "Couldn't find or create your TCGplayer cart. Add any item to your cart on tcgplayer.com once (that creates it), then click Add again.",
      };
    }
    // Add one listing per request, retrying rate limits (429) / server errors with backoff.
    // Failed indices are returned so the popup can offer a retry of just those items.
    let added = 0;
    const failed: { index: number; status: number | null }[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      let ok = false;
      let status: number | null = null;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
        try {
          const res = await fetch(`https://mpgateway.tcgplayer.com/v1/cart/${cartKey}/item/add?mpfev=${mpfev}`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              sku: Number(it.sku),
              sellerKey: it.sellerKey,
              channelId: 0,
              requestedQuantity: it.quantity,
              price: it.price,
              isDirect: false,
              countryCode,
            }),
          });
          status = res.status;
          ok = res.status >= 200 && res.status < 300;
          // 4xx other than 429 won't get better by retrying (bad sku, gone listing, …).
          if (!ok && status >= 400 && status < 500 && status !== 429) break;
        } catch {
          status = null; // network hiccup; retry
        }
      }
      if (ok) added++;
      else failed.push({ index: i, status });
      if (i < items.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: true, added, total: items.length, failed };
  })();
}

/**
 * Add `items` (defaults to the whole plan) to the cart via the injected page script. On a
 * partial failure the button becomes "Retry N failed" and re-adds ONLY the failed listings,
 * so already-added items are never duplicated.
 */
async function addToCart(plan: Plan, btn: HTMLButtonElement, subset?: AddItem[]): Promise<void> {
  const items = subset ?? planToItems(plan);
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "Adding…";
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.tcgplayer.com/*" });
    // Prefer the active tab if several tcgplayer tabs are open.
    const tab = tabs.find((t) => t.active) ?? tabs[0];
    if (!tab?.id) {
      setStatus("Open tcgplayer.com in a tab and log in, then click Add again.", true);
      btn.textContent = prev;
      return;
    }
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyInPage,
      args: [items, MPFEV, "US"],
    });
    const resp = injection?.result as ApplyResult | undefined;
    if (resp?.ok) {
      const added = resp.added ?? 0;
      const total = resp.total ?? 0;
      const failedItems = (resp.failed ?? []).map((f) => items[f.index]).filter((x): x is AddItem => !!x);
      if (failedItems.length === 0) {
        btn.textContent = `Added ${added}/${total}`;
        btn.onclick = null;
        setStatus("Done — review and check out on tcgplayer.com.");
      } else {
        const names = failedItems.slice(0, 3).map((f) => f.label ?? String(f.sku));
        const more = failedItems.length > names.length ? ` +${failedItems.length - names.length} more` : "";
        const statuses = (resp.failed ?? []).map((f) => f.status);
        const why = statuses.every((s) => s === 429)
          ? "TCGplayer rate-limited the adds"
          : `listing errors: ${[...new Set(statuses.map((s) => s ?? "network"))].join(", ")}`;
        btn.textContent = `Retry ${failedItems.length} failed`;
        btn.onclick = () => void addToCart(plan, btn, failedItems);
        setStatus(
          `Added ${added} of ${total} listings (${why}). Failed: ${names.join(", ")}${more}. ` +
            `Click "Retry ${failedItems.length} failed" — it re-adds only those.`,
          true,
        );
      }
    } else {
      setStatus(resp?.error ?? "Add failed. Use the manual fallback below.", true);
      btn.textContent = prev;
    }
  } catch (e) {
    setStatus(`Couldn't run on the TCGplayer tab: ${(e as Error).message}. Refresh tcgplayer.com and retry.`, true);
    btn.textContent = prev;
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
