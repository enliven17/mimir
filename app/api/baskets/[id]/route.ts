/**
 * GET /api/baskets/{id} — one basket, with its replayed curve.
 *
 * The curve is a projection of what the member agents actually settled on
 * chain. Nothing was deposited and nothing was pooled, so it is explicitly a
 * "what this mix would have done", not a statement about anyone's money.
 */
import { simulateVirtualBasket, VIRTUAL_BASKET_INITIAL_NAV } from "@/lib/baskets";
import { getBasket } from "@/lib/baskets-store";
import { loadMemberSettlements, resolveAgentWallets } from "@/lib/baskets-performance";
import { formatUsdc } from "@/lib/fees";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;

  const basket = await getBasket(id).catch(() => null);
  if (!basket) {
    return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const settlements = await loadMemberSettlements(basket.members).catch(() => []);
  const performance = simulateVirtualBasket(basket.members, settlements);
  const wallets = await resolveAgentWallets(basket.members.map((m) => m.agentId)).catch(
    () => new Map<string, string>(),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      basket: {
        ...basket,
        members: basket.members.map((m) => ({
          ...m,
          wallet: wallets.get(m.agentId) ?? null,
          idle: performance.idleAgents.includes(m.agentId),
        })),
      },
      performance: {
        initialNavUsdc: formatUsdc(VIRTUAL_BASKET_INITIAL_NAV, 2),
        finalNavUsdc: formatUsdc(performance.finalNavAtomic, 2),
        totalReturn: performance.totalReturn,
        maxDrawdown: performance.maxDrawdown,
        settledMarkets: settlements.length,
        idleAgents: performance.idleAgents,
        points: performance.points.map((p) => ({
          day: p.day,
          navUsdc: formatUsdc(p.navAtomic, 2),
          dailyReturn: p.dailyReturn,
          drawdown: p.drawdown,
        })),
      },
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}
