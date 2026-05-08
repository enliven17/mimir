import { NextResponse } from "next/server";

import { createApiError } from "@/lib/server/api-validation";
import { getVsFeedSnapshot } from "@/lib/server/vs-index";
import { VS_CACHE_HEADERS } from "@/lib/server/vs-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refreshValue = searchParams.get("refresh");
    if (refreshValue && refreshValue !== "1") {
      return NextResponse.json(
        createApiError("invalid_parameter", "refresh must be 1 when provided"),
        {
          status: 400,
        }
      );
    }

    const shouldRefresh = refreshValue === "1";
    const { items, cache } = await getVsFeedSnapshot({ forceRefresh: shouldRefresh });

    return NextResponse.json(
      {
        items,
        count: items.length,
        cache,
      },
      {
        headers: VS_CACHE_HEADERS,
      }
    );
  } catch {
    return NextResponse.json(
      createApiError("internal_error", "Unable to load VS feed"),
      {
        status: 500,
      }
    );
  }
}
