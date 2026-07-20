import { NextResponse } from "next/server";

import { generateClaimDrafts } from "@/lib/server/source-claim-generator";
import { createApiError } from "@/lib/server/api-validation";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// This route does a server-side fetch + an LLM call per request, so it's both a
// cost-amplification and an SSRF fan-out target. Cap it per IP.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

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

  const limited = rateLimit(`claim-draft:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      createApiError("rate_limited", "Too many requests, slow down"),
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } }
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

    // Only surface curated 4xx/503 messages; a 500 means an unexpected internal
    // error whose text may leak internals, so return a generic message.
    return NextResponse.json(
      createApiError("claim_draft_error", status === 500 ? "Unable to draft claim suggestions" : message),
      { status }
    );
  }
}

