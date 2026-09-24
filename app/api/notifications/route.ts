/**
 * GET /api/notifications?address=0x…   a wallet's latest notifications
 *
 * Public on purpose: every event here (a challenge, a settlement) is already
 * public on chain; this is a feed of it, not new information.
 */
import { NextResponse } from "next/server";

import { parseAddressParam } from "@/lib/server/api-validation";
import { listNotifications } from "@/lib/server/notifications";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = parseAddressParam(new URL(req.url).searchParams.get("address") ?? undefined);
  if (!address) return NextResponse.json({ error: "address must be a wallet address" }, { status: 400 });
  const items = await listNotifications(address).catch(() => []);
  return NextResponse.json({ items }, { headers: { "cache-control": "private, max-age=20" } });
}
