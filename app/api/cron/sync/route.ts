import { NextResponse } from "next/server";

import { pruneAgentTables } from "@/lib/agents/store";
import { createApiError } from "@/lib/server/api-validation";
import { isCronAuthorized } from "@/lib/server/cron-auth";
import { reconcileVsIndex } from "@/lib/server/vs-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json(
        createApiError("forbidden", "Invalid cron credentials"),
        { status: 403 }
      );
    }

    const summary = await reconcileVsIndex();
    await pruneAgentTables().catch((err) => console.warn("[cron/sync] agent table prune failed:", err));

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
