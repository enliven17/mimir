/**
 * POST /api/baskets/{id}/subscribe — follow, re-cap, or unfollow.
 *
 * Following is mirroring, never depositing. This route stores a signed intent
 * and a per-market ceiling; it never takes custody of anything, and it cannot
 * stake on the follower's behalf. Setting the cap to zero unfollows, which is
 * why a revocation is the same signature shape as a grant.
 */
import { followMessage } from "@/lib/baskets";
import { getBasket, getSubscription, setSubscription } from "@/lib/baskets-store";
import { verifyAgentSignature, normalizeAddress } from "@/lib/agents/signature";

export const dynamic = "force-dynamic";

/** A single signature must never authorise unbounded exposure. */
const MAX_PER_MARKET_CAP_USDC = 100;

interface Ctx {
  params: Promise<{ id: string }>;
}

function fail(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, reason, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "malformed_json", "body is not valid JSON");
  }

  const follower = normalizeAddress(body.follower);
  const signature = String(body.signature ?? "");
  const perMarketCapUsdc = Number(body.perMarketCapUsdc ?? 0);

  if (!follower) return fail(400, "bad_wallet", "follower must be an address");
  if (!Number.isFinite(perMarketCapUsdc) || perMarketCapUsdc < 0) {
    return fail(400, "bad_cap", "perMarketCapUsdc must be zero or positive");
  }
  if (perMarketCapUsdc > MAX_PER_MARKET_CAP_USDC) {
    return fail(400, "cap_too_high", `the per-market cap is limited to ${MAX_PER_MARKET_CAP_USDC} USDC`);
  }

  const basket = await getBasket(id).catch(() => null);
  if (!basket) return fail(404, "not_found", "no such basket");

  const signedOk = await verifyAgentSignature({
    address: follower,
    message: followMessage({ basketId: id, follower, perMarketCapUsdc }),
    signature,
  });
  if (!signedOk) {
    return fail(401, "bad_signature", "the follower signature does not match");
  }

  await setSubscription({ basketId: id, follower, perMarketCapUsdc, signature });
  const stored = await getSubscription(id, follower);

  return new Response(
    JSON.stringify({
      ok: true,
      following: perMarketCapUsdc > 0,
      perMarketCapUsdc: stored?.perMarketCapUsdc ?? perMarketCapUsdc,
      // Stated explicitly so nobody reads "following" as "funds moved".
      custody: "none: positions are staked from your own wallet with your own signature",
    }),
    { headers: { "content-type": "application/json" } },
  );
}
