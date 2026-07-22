import { postJson, withRetry, type HttpOptions } from "./http.js";

const LISTINGS_URL = "https://mp-search-api.tcgplayer.com/v1/product/{pid}/listings";
const PAGE_SIZE = 50; // server hard-caps page size at 50

/** One raw listing as returned by mp-search-api (only the fields we use are typed). */
export interface RawListing {
  listingId: number;
  productId: number;
  productConditionId: number; // = the SKU the cart endpoint wants
  sellerKey: string;
  sellerName: string;
  sellerId: string;
  price: number;
  shippingPrice: number;
  sellerShippingPrice: number;
  quantity: number;
  condition: string;
  printing: string;
  language: string;
  /** "standard" or "custom" (photo listings with custom titles, e.g. wrong-language cards). */
  listingType?: string;
  directProduct?: boolean;
  goldSeller?: boolean;
  sellerRating?: number;
  sellerSales?: string;
}

export interface ListingQuery {
  conditions?: string[]; // e.g. ["Near Mint", "Lightly Played"]
  languages?: string[]; // e.g. ["English"]
  printing?: string[]; // e.g. ["Normal"] / ["Foil"]
  shippingCountry?: string; // e.g. "US"
  /** Max listings to pull per product (bounds work for cheap high-supply commons). */
  maxPerProduct?: number;
}

interface ListingsResponse {
  results: Array<{ totalResults: number; results: RawListing[] }>;
}

/** Fetch live listings for one product, paginated and cheapest-first. No credentials. */
export async function fetchListings(
  productId: number,
  q: ListingQuery = {},
  http: HttpOptions = {},
): Promise<RawListing[]> {
  const term: Record<string, unknown> = {
    sellerStatus: "Live",
    channelId: 0,
    language: q.languages ?? ["English"],
  };
  if (q.conditions) term.condition = q.conditions;
  if (q.printing) term.printing = q.printing;

  const cap = q.maxPerProduct ?? 300;
  const url = LISTINGS_URL.replace("{pid}", String(productId));
  const rows: RawListing[] = [];
  let from = 0;
  for (;;) {
    const body = {
      filters: { term, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } },
      from,
      size: PAGE_SIZE,
      sort: { field: "price+shipping", order: "asc" },
      context: { shippingCountry: q.shippingCountry ?? "US", cart: {} },
      aggregations: [],
    };
    const page = await withRetry(() => postJson<ListingsResponse>(url, body, http));
    const res = page.results?.[0];
    if (!res) break;
    const got = res.results ?? [];
    rows.push(...got);
    from += got.length;
    if (got.length === 0 || from >= res.totalResults || from >= cap) break;
  }
  // Custom (photo) listings can't be added via the standard cart endpoint and are often not
  // the plain card they're filed under (wrong language, altered, etc.) — never buy them.
  return rows.filter((l) => l.listingType !== "custom");
}
