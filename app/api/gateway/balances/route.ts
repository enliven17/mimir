/**
 * Circle Gateway — unified USDC balance proxy
 *
 * GET /api/gateway/balances?address=0x...
 *
 * Wraps Circle's `POST /v1/balances` with our CIRCLE_API_KEY so the browser
 * never sees the key. Returns the user's USDC balance across every CCTP V2
 * domain (Arc Testnet, Eth Sepolia, Base Sepolia, Avalanche Fuji, etc).
 *
 * Note: Gateway tracks balances *deposited into Gateway custody*, not raw
 * on-chain balances. If a user has never deposited, all domains return 0 —
 * that's by design; the value of Gateway is one-deposit / mint-anywhere.
 */

import { NextRequest, NextResponse } from "next/server";

const CIRCLE_GATEWAY = "https://gateway-api-sandbox.circle.com/v1/balances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CircleBalance {
  domain:  number;
  balance: string; // micro-USDC (6 decimals)
}

interface CircleBalancesResponse {
  token?:    string;
  balances?: Array<{
    depositor: string;
    domain:    number;
    balance:   string;
  }>;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Valid `address` query param required" }, { status: 400 });
  }

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "CIRCLE_API_KEY not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(CIRCLE_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token:   "USDC",
        sources: [{ depositor: address }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Gateway upstream ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 },
      );
    }

    const json = (await res.json()) as CircleBalancesResponse;
    const balances: CircleBalance[] = (json.balances ?? []).map((b) => ({
      domain:  b.domain,
      balance: b.balance,
    }));

    const totalMicro = balances.reduce((acc, b) => acc + BigInt(b.balance ?? "0"), 0n);

    return NextResponse.json({
      address,
      totalUsdc: Number(totalMicro) / 1_000_000,
      perDomain: balances,
    }, {
      headers: { "Cache-Control": "private, max-age=15" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Gateway proxy failed", detail: err?.message ?? "unknown" },
      { status: 500 },
    );
  }
}
