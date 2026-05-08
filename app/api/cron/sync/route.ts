import { NextResponse } from "next/server";

import { createApiError } from "@/lib/server/api-validation";
import { reconcileVsIndex } from "@/lib/server/vs-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret) {
    return false;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  return authHeader === `Bearer ${expectedSecret}`;
}

export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        createApiError("forbidden", "Invalid cron credentials"),
        { status: 403 }
      );
    }

    const summary = await reconcileVsIndex();

    return NextResponse.json(
      {
        synced: summary.synced,
        new: summary.new,
        stateChanges: summary.stateChanges,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return NextResponse.json(
      createApiError("internal_error", "Unable to reconcile VS index"),
      { status: 500 }
    );
  }
}
