/**
 * GET /api/council/roster — the council personas this deploy actually runs.
 *
 * Only personas whose wallet is provisioned are listed: an unprovisioned
 * persona cannot stake, so offering it as a basket member would promise a leg
 * that never trades.
 */
import { COUNCIL_PERSONAS, personaAddressEnv } from "@/agents/council/personas";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const personas = COUNCIL_PERSONAS.filter((p) => process.env[personaAddressEnv(p)]).map((p) => ({
    slug: p.slug,
    displayName: p.displayName,
    emoji: p.emoji,
    bio: p.bio,
    archetype: p.archetype,
    track: p.track ?? "classic",
    address: process.env[personaAddressEnv(p)]?.toLowerCase() ?? null,
  }));

  return new Response(JSON.stringify({ personas }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "s-maxage=60, stale-while-revalidate=300",
    },
  });
}
