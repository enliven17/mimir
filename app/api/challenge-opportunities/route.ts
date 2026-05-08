import { NextResponse } from "next/server";

import type { ApiErrorShape } from "@/lib/server/api-validation";
import { createApiError } from "@/lib/server/api-validation";
import { getChallengeOpportunities } from "@/lib/server/challenge-opportunities";

export const dynamic = "force-dynamic";

function getStatusForMessage(message: string) {
  if (/not configured|not enabled/i.test(message)) {
    return 503;
  }

  if (/valid source URL|not supported|did not produce|readable text|Unable to fetch source|must be an HTML or text page/i.test(message)) {
    return 400;
  }

  return 500;
}

export async function GET(request: Request) {
  if (process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS !== "1") {
    return NextResponse.json(
      createApiError("feature_disabled", "Challenge opportunities are not enabled"),
      { status: 404 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") === "es" ? "es" : "en";
    const limitValue = searchParams.get("limit");
    const limit =
      limitValue && limitValue.trim().length > 0
        ? Number.parseInt(limitValue, 10)
        : undefined;

    if (limitValue && (!Number.isFinite(limit) || Number.isNaN(limit!))) {
      return NextResponse.json(
        createApiError("invalid_parameter", "limit must be a valid integer"),
        { status: 400 }
      );
    }

    const result = await getChallengeOpportunities({
      locale,
      limit,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "s-maxage=600, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load challenge opportunities";

    return NextResponse.json(
      createApiError("challenge_opportunities_error", message) as ApiErrorShape,
      { status: getStatusForMessage(message) }
    );
  }
}
