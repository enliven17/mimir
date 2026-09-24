import { moderateClaim } from "@/lib/server/claim-moderation";
import { handleClaimModerationPost } from "@/lib/server/claim-moderation-route-handler";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // One flooding client used to exhaust the shared Gemini quota and trip the
  // global cooldown for everyone; now it hits its own limit first.
  if (!(await allowRequest("claim-moderation", clientIp(request), 20, 60_000))) {
    return tooManyRequests(60);
  }
  return handleClaimModerationPost({ request, moderateClaim });
}
