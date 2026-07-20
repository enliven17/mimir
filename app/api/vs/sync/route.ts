import { NextResponse } from "next/server";

import {
  createApiError,
  parseInviteKey,
  parsePositiveIntegerParam,
} from "@/lib/server/api-validation";
import { triggerPostWriteRefresh } from "@/lib/server/vs-index";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Each call triggers RPC-heavy on-chain reconciliation, so cap it per IP to
// blunt cost-amplification.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

type RefreshBody = {
  claimId?: number;
  inviteKey?: string | null;
};

export async function POST(request: Request) {
  const limited = rateLimit(`vs-sync:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      createApiError("rate_limited", "Too many requests, slow down"),
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } }
    );
  }

  try {
    const payload = (await request.json()) as RefreshBody;
    const claimId = parsePositiveIntegerParam(
      payload.claimId == null ? undefined : String(payload.claimId)
    );

    if (!claimId) {
      return NextResponse.json(
        createApiError("invalid_parameter", "Invalid claim id"),
        { status: 400 }
      );
    }

    const inviteKey = parseInviteKey(payload.inviteKey ?? null);
    if (inviteKey === null) {
      return NextResponse.json(
        createApiError("invalid_parameter", "Invalid invite key"),
        { status: 400 }
      );
    }

    const claim = await triggerPostWriteRefresh({
      claimId,
      inviteKey,
    });

    return NextResponse.json(
      {
        indexed: Boolean(claim),
      },
      {
        status: claim ? 200 : 202,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      createApiError("internal_error", "Unable to refresh VS index"),
      { status: 500 }
    );
  }
}
