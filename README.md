# cartsmith

Buy a Riftbound (League of Legends TCG) deck for the least money. Paste your deck list and
cartsmith finds the cheapest way to buy every card across a **small number of TCGPlayer
sellers** (fewer packages = less shipping and less hassle) — then adds that exact cart for
you in one click.

TCGPlayer's own cart optimizer minimizes item price but scatters an order across many
sellers (20+ packages is common). cartsmith optimizes **price *and* package count together**
as an integer program, so you get a near-minimal bill in a handful of shipments.

## Install (Chrome)

There's no Web Store listing — you build it locally (takes about a minute) and load it as an
unpacked extension.

**Prerequisites:** [git](https://git-scm.com) and [Node.js](https://nodejs.org) 18 or newer
(which includes npm).

1. Build it:

   ```sh
   git clone https://github.com/Evan-Whitehouse/cartsmith.git
   cd cartsmith
   npm install
   npm run build
   ```

   This produces the extension in `extension/dist/`.

2. Open `chrome://extensions` in Chrome and switch on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the `extension/dist` folder.
4. Log in to [tcgplayer.com](https://www.tcgplayer.com) in a tab, click the cartsmith icon
   in the toolbar, paste your Riftbound deck list (`3 Fiora - Peerless` … one card per
   line), and hit **Optimize cart**. Review the plan, then **Add to TCGplayer cart**.

Keep the cloned folder around — Chrome loads the extension from it. To update later:
`git pull && npm run build`, then press the reload icon on the cartsmith card in
`chrome://extensions`.

## Status

Early development. The pieces:

- **`core/`** — the engine (TypeScript): deck-list parser, TCGPlayer catalog resolution,
  live-listing fetch, and the cart optimizer. Runs in the browser and in Node.
- **`extension/`** — the primary product: an MV3 browser extension (Chrome + Firefox) that
  does the whole loop in your browser and adds the optimized cart with one click.

## How it adds to your cart (and why it's safe)

The extension runs inside your already-logged-in tcgplayer.com session. When it adds items,
the **browser** attaches your login automatically — cartsmith never reads, stores, or
transmits your cookies, password, or session token. It stops at your cart; you review and
check out yourself. No account credentials ever leave your browser.

## Disclaimer

cartsmith uses TCGPlayer's undocumented internal endpoints (the same ones the website calls),
because TCGPlayer has no public buyer/cart API. This may break without notice and may be
against TCGPlayer's Terms of Service; use it at your own risk and be gentle with their
servers (cartsmith rate-limits and caches by default). Not affiliated with or endorsed by
TCGPlayer/eBay. Prices and availability are provided by TCGPlayer and change constantly.

## License

MIT — see [LICENSE](LICENSE).
