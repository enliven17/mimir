import { NextResponse } from "next/server";

import { createApiError } from "@/lib/server/api-validation";
import { refreshChallengeOpportunitiesIndex } from "@/lib/server/challenge-opportunities";

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

    if (process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS !== "1") {
      return NextResponse.json(
        createApiError("feature_disabled", "Challenge opportunities are not enabled"),
        { status: 404 }
      );
    }

    const summary = await refreshChallengeOpportunitiesIndex();

    return NextResponse.json(
      {
        generatedAt: new Date(summary.generatedAt).toISOString(),
        locales: summary.locales,
        countsByLocale: summary.countsByLocale,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to refresh challenge opportunities";

    return NextResponse.json(
      createApiError("internal_error", message),
      { status: /not configured/i.test(message) ? 503 : 500 }
    );
  }
}
