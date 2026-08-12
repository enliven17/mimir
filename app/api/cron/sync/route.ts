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
  return authHeader === expectedSecret;
}

export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) {
      console.warn("[cron/sync] Unauthorized access attempt");
      return NextResponse.json(
        createApiError("forbidden", "Invalid cron credentials"),
        { status: 403 }
      );
    }

    const startTime = Date.now();
    console.log("[cron/sync] Starting reconciliation...");

    const summary = await reconcileVsIndex();

    const elapsed = Date.now() - startTime;
    console.log(
      `[cron/sync] Reconciliation complete: synced=${summary.synced}, new=${summary.new}, stateChanges=${summary.stateChanges}, elapsed=${elapsed}ms`
    );

    return NextResponse.json(
      {
        synced: summary.synced,
        new: summary.new,
        stateChanges: summary.stateChanges,
        elapsed,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[cron/sync] Reconciliation failed: ${errorMsg}`);
    return NextResponse.json(
      createApiError("internal_error", "Unable to reconcile VS index"),
      { status: 500 }
    );
  }
}
