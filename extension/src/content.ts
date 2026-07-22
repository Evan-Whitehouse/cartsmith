/**
 * Content script injected into tcgplayer.com. It applies an optimizer plan to the user's
 * cart from *within* the logged-in page, so the browser attaches the session automatically —
 * cartsmith never reads a cookie file or the auth token. The only cookie it touches is the
 * non-secret cart key, read from document.cookie.
 */
import { applyPlan, parseCartKey, type AddItem, type AddResult } from "@cartsmith/core";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "CARTSMITH_APPLY") return;
  void (async () => {
    const cartKey = parseCartKey(document.cookie);
    if (!cartKey) {
      sendResponse({
        ok: false,
        error: "Couldn't find your TCGPlayer cart. Make sure you're logged in on this tab, then retry.",
      });
      return;
    }
    try {
      const results: AddResult[] = await applyPlan(msg.items as AddItem[], { cartKey });
      const added = results.filter((r) => r.ok).length;
      sendResponse({ ok: true, added, total: results.length, results });
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true; // keep the message channel open for the async response
});
