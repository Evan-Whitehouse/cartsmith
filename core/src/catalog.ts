import { postJson, withRetry, type HttpOptions } from "./http.js";

const SEARCH_URL = "https://mp-search-api.tcgplayer.com/v1/search/request?q={q}&isList=false";

export interface ProductCandidate {
  productId: number;
  productName: string;
  productLineName: string;
  setName?: string;
  rarity?: string;
  lowestPrice?: number;
}

interface SearchResponse {
  results: Array<{ results: ProductCandidate[] }>;
}

/** Search the marketplace catalog by card name. Public endpoint, no credentials. */
export async function searchProducts(
  name: string,
  http: HttpOptions = {},
  size = 48,
): Promise<ProductCandidate[]> {
  const body = {
    algorithm: "sales_synonym_v2",
    from: 0,
    size,
    filters: { term: {}, range: {}, match: {} },
    listingSearch: {
      context: { cart: {} },
      filters: {
        term: { sellerStatus: "Live", channelId: 0 },
        range: { quantity: { gte: 1 } },
        exclude: { channelExclusion: 0 },
      },
    },
    context: { cart: {}, shippingCountry: "US" },
    settings: { useFuzzySearch: true, didYouMean: {} },
    sort: {},
  };
  const url = SEARCH_URL.replace("{q}", encodeURIComponent(name));
  const data = await withRetry(() => postJson<SearchResponse>(url, body, http));
  return data.results?.[0]?.results ?? [];
}
