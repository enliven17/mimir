/**
 * Server side of x402 for Mimir — sell data/services per request over HTTP 402.
 *
 * Wraps Circle's Gateway middleware (@circle-fin/x402-batching/server), which
 * settles through Circle's hosted facilitator (no facilitator to run ourselves).
 * The middleware is Express-shaped; this module bridges it to Next.js App Router
 * route handlers via a thin req/res shim so a single helper protects any route.
 *
 * Usage in a route handler:
 *   const gate = await requirePayment(req, "$0.001");
 *   if (!gate.paid) return gate.response;          // 402 with payment requirements
 *   // ...produce the paid content...
 *   return json(data, { headers: gate.responseHeaders });  // carries X-PAYMENT-RESPONSE
 */

import "server-only";
import {
  createGatewayMiddleware,
  type GatewayMiddleware,
} from "@circle-fin/x402-batching/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { arcTestnet } from "./arc";
import { recordPayment, parsePriceUsd } from "./x402-revenue";

const ARC_CAIP2 = `eip155:${arcTestnet.id}`;
const DEFAULT_FACILITATOR = "https://gateway-api-testnet.circle.com";

// One middleware per seller address — lets each council persona earn into its
// OWN wallet (creator monetization) while the default seller handles the rest.
const cache = new Map<string, GatewayMiddleware>();

/**
 * Lazily build a Gateway middleware for a given seller. Defaults to
 * X402_SELLER_ADDRESS; pass `payTo` to route revenue elsewhere (e.g. a persona).
 */
export function getGateway(payTo?: string): GatewayMiddleware {
  const sellerAddress = payTo ?? process.env.X402_SELLER_ADDRESS;
  if (!sellerAddress) {
    throw new Error("X402_SELLER_ADDRESS is required to sell x402-paid resources");
  }
  const key = sellerAddress.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const mw = createGatewayMiddleware({
    sellerAddress,
    networks: [ARC_CAIP2],
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR,
    description: "Mimir paid resource",
  });
  cache.set(key, mw);
  return mw;
}

export type RequirePaymentResult =
  | { paid: true; payment: unknown; responseHeaders: Headers }
  | { paid: false; response: Response };

/**
 * Run the Gateway middleware against a Next request. Returns either a ready-to-
 * send 402 (with payment requirements) or a "paid" verdict — settlement happens
 * inline inside the middleware before it calls next().
 *
 * @param req   the Next Request
 * @param price dollar price string, e.g. "$0.001"
 */
export async function requirePayment(
  req: Request,
  price: string,
  opts?: { payTo?: string },
): Promise<RequirePaymentResult> {
  const mw = getGateway(opts?.payTo).require(price);

  // ── Express req shim ──
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const u = new URL(req.url);
  const shimReq: Record<string, unknown> = {
    method: req.method,
    url: u.pathname + u.search,
    originalUrl: u.pathname + u.search,
    path: u.pathname,
    headers,
    // some middlewares call .get(name)
    get: (name: string) => headers[name.toLowerCase()],
  };

  // ── Express res shim ──
  const outHeaders = new Headers();
  let statusCode = 200;
  let body: unknown;
  let ended = false;
  const res: Record<string, unknown> = {
    // Support BOTH `res.statusCode = 402` (property) and `res.status(402)` (method);
    // the Gateway middleware uses the property form.
    get statusCode() {
      return statusCode;
    },
    set statusCode(c: number) {
      statusCode = c;
    },
    setHeader: (k: string, v: unknown) => {
      outHeaders.set(k, String(v));
      return res;
    },
    getHeader: (k: string) => outHeaders.get(k),
    status: (c: number) => {
      statusCode = c;
      return res;
    },
    json: (d: unknown) => {
      body = d;
      ended = true;
      return res;
    },
    send: (d: unknown) => {
      body = d;
      ended = true;
      return res;
    },
    end: (d?: unknown) => {
      if (d !== undefined) body = d;
      ended = true;
      return res;
    },
  };

  // ── next() ──
  let nexted = false;
  let nextErr: unknown;
  const next = (err?: unknown) => {
    if (err) nextErr = err;
    else nexted = true;
  };

  await mw(shimReq as never, res as never, next as never);
  if (nextErr) throw nextErr;

  if (nexted) {
    // Payment verified + settled. Carry any X-PAYMENT-RESPONSE header forward.
    // Record it for the revenue dashboard (best-effort; never blocks serving).
    let payer: string | null = null;
    let txId: string | null = null;
    const settleHeader =
      outHeaders.get("x-payment-response") ?? outHeaders.get("payment-response");
    if (settleHeader) {
      try {
        const s = decodePaymentResponseHeader(settleHeader) as {
          payer?: string;
          transaction?: string;
        };
        payer = s.payer ?? null;
        txId = s.transaction ?? null;
      } catch {
        /* ignore decode errors */
      }
    }
    recordPayment({
      resource: u.pathname,
      priceUsd: parsePriceUsd(price),
      payer,
      seller: (opts?.payTo ?? process.env.X402_SELLER_ADDRESS ?? null)?.toLowerCase() ?? null,
      txId,
      at: Date.now(),
    });
    return {
      paid: true,
      payment: (shimReq as { payment?: unknown }).payment,
      responseHeaders: outHeaders,
    };
  }

  // Middleware wrote its own response (almost always the 402 challenge).
  if (!outHeaders.has("content-type")) outHeaders.set("content-type", "application/json");
  return {
    paid: false,
    response: new Response(
      typeof body === "string" ? body : JSON.stringify(body ?? {}),
      { status: ended ? statusCode : 402, headers: outHeaders },
    ),
  };
}

/** JSON Response helper that merges extra headers (e.g. X-PAYMENT-RESPONSE). */
export function json(data: unknown, init?: { status?: number; headers?: Headers }): Response {
  const headers = init?.headers ?? new Headers();
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { status: init?.status ?? 200, headers });
}
