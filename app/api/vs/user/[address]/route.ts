import { NextRequest, NextResponse } from "next/server";

import {
  createApiError,
  parseAddressParam,
} from "@/lib/server/api-validation";
import { getUserVsSnapshot } from "@/lib/server/vs-index";
import { VS_CACHE_HEADERS } from "@/lib/server/vs-cache";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address: rawAddress } = await params;
    const address = parseAddressParam(rawAddress);
    if (!address) {
      return NextResponse.json(
        createApiError("invalid_parameter", "Invalid address"),
        {
          status: 400,
        }
      );
    }

    const refreshValue = new URL(request.url).searchParams.get("refresh");
    if (refreshValue && refreshValue !== "1") {
      return NextResponse.json(
        createApiError("invalid_parameter", "refresh must be 1 when provided"),
        {
          status: 400,
        }
      );
    }

    const { items, cache } = await getUserVsSnapshot(address, {
      forceRefresh: refreshValue === "1",
    });

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
      createApiError("internal_error", "Unable to load user VS"),
      {
        status: 500,
      }
    );
  }
}
