# cartsmith extension

The primary cartsmith product: paste a Riftbound deck list, get the cheapest ≤N-seller
cart, and add it to your TCGplayer cart in one click — all in the browser.

## Load it (unpacked)

From the **repo root** (not this directory — it's an npm workspace):

```
npm install
npm run build        # outputs extension/dist/
```

- **Chrome/Edge:** `chrome://extensions` → enable Developer mode → *Load unpacked* → pick
  `extension/dist`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick
  `extension/dist/manifest.json`.

Then log in to tcgplayer.com in a tab, open the extension popup, paste a deck, and Optimize.
"Add to TCGplayer cart" applies the plan to your cart in your logged-in tab (it never reads
cookies or checks out — you review and pay).

The optimize runs in a **background service worker**, so closing the popup or switching tabs
does not cancel it or lose your work — your deck, options, and last result are persisted and
restored when you reopen. Pricing lookups run **concurrently** (a bounded pool), so a full
deck prices in seconds rather than minutes.

## How the cart-add stays safe

The apply step is injected into your open tcgplayer.com tab on demand (via
`chrome.scripting`), so it runs in the page's own context and the browser attaches your
session automatically. cartsmith never reads a cookie file or your auth token; it only reads
the non-secret cart key from `document.cookie`. If the cart endpoint changes, the popup falls
back to a Mass Entry blob + per-seller links.

## Current limitations (MVP)

- Uses the pure-JS **greedy** solver in-browser (fast, no WASM). The provably-optimal
  HiGHS-WASM solver — already used by the Node/CLI path — is a planned follow-up for the
  extension.
- Bare card names resolve across all Riftbound printings (cheapest wins); add a trailing
  `(SET) number` to a line to pin a specific printing.
- End-to-end cart-add needs verification in a real logged-in browser session.
