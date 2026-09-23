import { NextResponse } from "next/server";

import {
  createApiError,
  parseChainParam,
  parseInviteKey,
  parsePositiveIntegerParam,
} from "@/lib/server/api-validation";
import { triggerPostWriteRefresh } from "@/lib/server/vs-index";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RefreshBody = {
  claimId?: number;
  inviteKey?: string | null;
  chain?: string;
};

export async function POST(request: Request) {
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

    const chain = parseChainParam(payload.chain);
    if (!chain) {
      return NextResponse.json(
        createApiError("invalid_parameter", "Unknown chain"),
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
      chain,
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
