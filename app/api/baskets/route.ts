/**
 * GET  /api/baskets — the basket directory.
 * POST /api/baskets — compose a basket.
 *
 * Creating a basket costs nothing and moves nothing, but it is still signed:
 * a basket carries its composer's name, and an unsigned one would let anyone
 * publish a thesis under someone else's wallet.
 */
import { validateBasket, composeMessage, InvalidBasketError, type BasketMember } from "@/lib/baskets";
import { createBasket, listBaskets } from "@/lib/baskets-store";
import { verifyAgentSignature, normalizeAddress } from "@/lib/agents/signature";

export const dynamic = "force-dynamic";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

function fail(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, reason, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(): Promise<Response> {
  try {
    const baskets = await listBaskets();
    return new Response(JSON.stringify({ baskets }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "s-maxage=15, stale-while-revalidate=60",
      },
    });
  } catch {
    // No database configured: an empty directory is truthful, a 500 is not.
    return new Response(JSON.stringify({ baskets: [] }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "malformed_json", "body is not valid JSON");
  }

  const id = String(body.id ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const thesis = String(body.thesis ?? "").trim();
  const creatorWallet = normalizeAddress(body.creatorWallet);
  const signature = String(body.signature ?? "");
  const members = Array.isArray(body.members) ? (body.members as BasketMember[]) : [];

  if (!ID_PATTERN.test(id)) {
    return fail(400, "bad_id", "id must be 3-64 chars of [a-z0-9-], starting alphanumeric");
  }
  if (!creatorWallet) {
    return fail(400, "bad_wallet", "creatorWallet must be an address");
  }

  try {
    validateBasket({ name, thesis, members });
  } catch (err) {
    if (err instanceof InvalidBasketError) return fail(400, err.reason, err.message);
    throw err;
  }

  const signedOk = await verifyAgentSignature({
    address: creatorWallet,
    message: composeMessage(id, name, members),
    signature,
  });
  if (!signedOk) {
    return fail(401, "bad_signature", "the composer signature does not match");
  }

  try {
    const basket = await createBasket({ id, name, thesis, creatorWallet, members });
    return new Response(JSON.stringify({ ok: true, basket }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "basket_exists") {
      return fail(409, "basket_exists", "that basket id is taken");
    }
    if (err instanceof InvalidBasketError) return fail(400, err.reason, err.message);
    console.error("[baskets] create failed:", err);
    return fail(500, "internal_error", "the basket could not be stored");
  }
}
