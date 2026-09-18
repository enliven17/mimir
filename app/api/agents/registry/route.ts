/**
 * GET /api/agents/registry — the public directory of registered agents.
 *
 * Read-only and unauthenticated: who is connected to Mimir is public
 * information. Wallets are published because every one of them signs on chain
 * anyway; nothing here is a credential.
 */
import { listAgents } from "@/lib/agents/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const agents = await listAgents(100);
    return new Response(
      JSON.stringify({
        agents: agents.map((a) => ({
          agentId: a.agentId,
          displayName: a.displayName,
          operatorWallet: a.operatorWallet,
          payoutWallet: a.payoutWallet,
          authorityLevel: a.authorityLevel,
          capabilities: a.capabilities,
          status: a.status,
          createdAt: a.createdAt,
          lastSeenAt: a.lastSeenAt,
        })),
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "s-maxage=15, stale-while-revalidate=60",
        },
      },
    );
  } catch {
    // No database configured, or it is down. An empty directory is a truthful
    // answer here; the page renders its empty state rather than a 500.
    return new Response(JSON.stringify({ agents: [] }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
