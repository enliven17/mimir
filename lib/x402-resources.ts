/**
 * The catalogue of everything Mimir sells over x402.
 *
 * One source of truth for prices, because they were previously declared inside
 * each route: a price shown on the pricing page could drift from the price the
 * 402 actually quotes, and nothing would catch it.
 *
 * The metadata is discovery material. A paid endpoint nobody can find is a
 * paid endpoint nobody buys, so each entry carries what a buying agent needs to
 * decide: what it returns, what it costs, and an example call.
 */

export type ResourceKey =
  | "premiumPrice"
  | "oracle"
  | "councilReasoning"
  | "councilVote"
  | "councilPreflight"
  | "councilSubscribe";

export interface ResourceMeta {
  path: string;
  method: "GET" | "POST";
  /** Quoted in the 402 challenge, e.g. "$0.001". */
  price: string;
  serviceName: string;
  description: string;
  mimeType: string;
  tags: string[];
  /** Who receives the payment: the platform seller, or the persona being read. */
  payTo: "seller" | "persona";
  exampleRequest: string;
}

export const X402_RESOURCES: Record<ResourceKey, ResourceMeta> = {
  premiumPrice: {
    path: "/api/premium/price",
    method: "GET",
    price: "$0.001",
    serviceName: "Mimir premium price",
    description:
      "A structured price snapshot for one asset, priced per call so an agent can buy exactly the reading it needs.",
    mimeType: "application/json",
    tags: ["price", "market-data", "crypto"],
    payTo: "seller",
    exampleRequest: "GET /api/premium/price?symbol=bitcoin",
  },
  oracle: {
    path: "/api/oracle",
    method: "POST",
    price: "$0.005",
    serviceName: "Mimir oracle as a service",
    description:
      "Fetches the evidence at a URL, evaluates a claim against a stated rule, and returns a verdict with confidence and the evidence hash. The same pipeline that settles Mimir's own markets.",
    mimeType: "application/json",
    tags: ["oracle", "verdict", "llm", "settlement"],
    payTo: "seller",
    exampleRequest:
      'POST /api/oracle {"question":"...","resolutionUrl":"https://...","settlementRule":"..."}',
  },
  councilReasoning: {
    path: "/api/council/reasoning",
    method: "GET",
    price: "$0.001",
    serviceName: "Council persona reasoning",
    description:
      "One council persona's written reasoning on one claim. Revenue settles into that persona's own wallet, which is what makes each persona an economic actor rather than a label.",
    mimeType: "application/json",
    tags: ["reasoning", "council", "analysis"],
    payTo: "persona",
    exampleRequest: "GET /api/council/reasoning?claimId=42&persona=statistician",
  },
  councilVote: {
    path: "/api/council/vote",
    method: "GET",
    price: "$0.001",
    serviceName: "Council settlement vote",
    description:
      "A persona's verdict on an expired claim, used as a paid juror ballot at settlement. Accepts the prior report history for sequential, information-aggregating voting.",
    mimeType: "application/json",
    tags: ["vote", "jury", "settlement", "council"],
    payTo: "persona",
    exampleRequest: "GET /api/council/vote?claimId=42&persona=taleb",
  },
  councilPreflight: {
    path: "/api/council/preflight",
    method: "POST",
    price: "$0.001",
    serviceName: "Council market preflight",
    description:
      "A persona's opinion on a market candidate before it is opened: open, revise or skip, with a score. Used to drop low-consensus candidates before they cost anyone a stake.",
    mimeType: "application/json",
    tags: ["preflight", "curation", "council"],
    payTo: "persona",
    exampleRequest: 'POST /api/council/preflight?persona=socrates {"question":"...","resolutionUrl":"..."}',
  },
  councilSubscribe: {
    path: "/api/council/subscribe",
    method: "POST",
    price: "$0.01",
    serviceName: "Council reading pass",
    description:
      "One payment buys a time-boxed window of free council reads: the recurring-access tier on top of per-read pricing.",
    mimeType: "application/json",
    tags: ["subscription", "pass", "council"],
    payTo: "seller",
    exampleRequest: "POST /api/council/subscribe",
  },
};

export function priceOf(key: ResourceKey): string {
  return X402_RESOURCES[key].price;
}

/** The catalogue as a discovery document, for agents shopping for capabilities. */
export function resourceCatalogue(baseUrl: string): Array<ResourceMeta & { url: string }> {
  const root = baseUrl.replace(/\/+$/, "");
  return Object.values(X402_RESOURCES).map((r) => ({ ...r, url: `${root}${r.path}` }));
}
