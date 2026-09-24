/**
 * POST /api/notifications/webhook   point a wallet's notifications at a URL
 *   body: { address, url, signedAt, signature }   (url "" removes it)
 *
 * The wallet signs webhookMessage(address, url, signedAt) from lib/notifications.
 * The response carries a secret, shown once: deliveries are signed with
 * `x-mimir-signature: sha256=HMAC(secret, rawBody)`. Agents subscribe the same
 * way with their operator wallet.
 */
import { NextResponse } from "next/server";

import { normalizeAddress, verifyAgentSignature } from "@/lib/agents/signature";
import { webhookMessage } from "@/lib/notifications";
import { checkUrl } from "@/lib/research/ssrf";
import { setWebhook } from "@/lib/server/notifications";

export const dynamic = "force-dynamic";

const MAX_SKEW_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body is not valid JSON" }, { status: 400 });
  }
  const address = normalizeAddress(body.address);
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const signedAt = Number(body.signedAt);
  if (!address) return NextResponse.json({ error: "address must be a wallet address" }, { status: 400 });
  if (url && (!url.startsWith("https://") || url.length > 2048 || checkUrl(url))) {
    return NextResponse.json({ error: "url must be a public https URL" }, { status: 400 });
  }
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > MAX_SKEW_MS) {
    return NextResponse.json({ error: "signedAt must be within 5 minutes of now" }, { status: 401 });
  }
  const ok = await verifyAgentSignature({
    address,
    message: webhookMessage(address, url, signedAt),
    signature: String(body.signature ?? ""),
  });
  if (!ok) return NextResponse.json({ error: "signature does not match" }, { status: 401 });

  const secret = await setWebhook(address, url);
  return NextResponse.json({ ok: true, url: url || null, secret });
}
