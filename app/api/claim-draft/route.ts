import { NextResponse } from "next/server";

import { generateClaimDrafts } from "@/lib/server/source-claim-generator";
import { createApiError } from "@/lib/server/api-validation";

export const dynamic = "force-dynamic";

type ClaimDraftRequestBody = {
  url?: unknown;
  locale?: unknown;
};

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS !== "1") {
    return NextResponse.json(
      createApiError("feature_disabled", "Source drafting is not enabled"),
      { status: 404 }
    );
  }

  try {
    const body = (await request.json()) as ClaimDraftRequestBody;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const locale = typeof body.locale === "string" ? body.locale.trim() : "en";

    if (!url) {
      return NextResponse.json(
        createApiError("invalid_request", "url is required"),
        { status: 400 }
      );
    }

    const result = await generateClaimDrafts({ sourceUrl: url, locale });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to draft claim suggestions";
    const status =
      /not configured|not enabled/i.test(message)
        ? 503
        : /valid source URL|not supported|did not produce|readable text|Unable to fetch source|must be an HTML or text page/i.test(
              message
            )
          ? 400
          : 500;

    return NextResponse.json(
      createApiError("claim_draft_error", message),
      { status }
    );
  }
}

