/**
 * GET /api/verify/{id}?chain=arc          verification report (JSON)
 * GET /api/verify/{id}?chain=arc&raw=1    the audit bundle, byte for byte as
 *                                          hashed: keccak256(file) must equal
 *                                          the claim's on-chain evidenceHash
 */
import { NextResponse } from "next/server";

import { parseChainParam } from "@/lib/server/api-validation";
import { verifyClaim } from "@/lib/server/verify";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const claimId = Number(id);
  if (!Number.isInteger(claimId) || claimId < 1) {
    return NextResponse.json({ error: "invalid claim id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const chain = parseChainParam(url.searchParams.get("chain"));
  if (!chain) return NextResponse.json({ error: "unknown chain" }, { status: 400 });

  let report;
  try {
    report = await verifyClaim(chain, claimId);
  } catch (err) {
    console.error("[verify] failed:", err);
    return NextResponse.json({ error: "verification unavailable" }, { status: 502 });
  }
  if (!report.found) return NextResponse.json({ error: "claim not found" }, { status: 404 });

  // A resolved claim's record never changes, so it caches well.
  const cache = report.resolved ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store";

  if (url.searchParams.get("raw") === "1") {
    if (!report.bundleText) return NextResponse.json({ error: "no bundle stored for this claim" }, { status: 404 });
    return new Response(report.bundleText, {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="mimir-${chain}-${claimId}-verdict.json"`,
        "cache-control": cache,
      },
    });
  }

  const { bundleText: _text, ...body } = report;
  return NextResponse.json(body, { headers: { "cache-control": cache } });
}
