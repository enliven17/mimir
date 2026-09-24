import "server-only";

/**
 * Persistence for baskets and their followers.
 *
 * A subscription is a signed intent, not a deposit: the row records the cap a
 * follower approved and the signature that approved it. Setting the cap to zero
 * is how you unfollow, so a revocation is the same shape as a grant and can be
 * audited the same way.
 */
import { query } from "@/lib/db";
import { validateBasket, type BasketDefinition, type BasketMember } from "@/lib/baskets";

export interface BasketRow extends BasketDefinition {
  followers: number;
}

function parseMembers(raw: unknown): BasketMember[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]")) as BasketMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toRow(r: Record<string, unknown>): BasketRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    thesis: String(r.thesis ?? ""),
    creatorWallet: String(r.creator_wallet ?? ""),
    members: parseMembers(r.members_json),
    createdAt: Number(r.created_at ?? 0),
    followers: Number(r.followers ?? 0),
  };
}

const WITH_FOLLOWERS = `
  SELECT b.*, COALESCE(f.n, 0) AS followers
    FROM baskets b
    LEFT JOIN (
      SELECT basket_id, COUNT(*) AS n
        FROM basket_subscriptions
       WHERE per_market_cap_usdc > 0
       GROUP BY basket_id
    ) f ON f.basket_id = b.id
`;

export async function listBaskets(limit = 100): Promise<BasketRow[]> {
  const rows = await query(`${WITH_FOLLOWERS} ORDER BY followers DESC, b.created_at DESC LIMIT ?`, [
    limit,
  ]);
  return rows.map(toRow);
}

export async function getBasket(id: string): Promise<BasketRow | null> {
  const rows = await query(`${WITH_FOLLOWERS} WHERE b.id = ?`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function createBasket(input: {
  id: string;
  name: string;
  thesis: string;
  creatorWallet: string;
  members: BasketMember[];
}): Promise<BasketRow> {
  // Validated again here, not only at the route: a basket that reaches storage
  // invalid would produce a curve nobody can reproduce.
  validateBasket(input);

  const existing = await getBasket(input.id);
  if (existing) throw new Error("basket_exists");

  await query(
    `INSERT INTO baskets(id, name, thesis, creator_wallet, members_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.name.trim(),
      input.thesis.trim(),
      input.creatorWallet.toLowerCase(),
      JSON.stringify(input.members),
      Date.now(),
    ],
  );
  const created = await getBasket(input.id);
  if (!created) throw new Error("basket insert did not persist");
  return created;
}

/** Follow, change the cap, or unfollow (cap 0). One row per follower per basket. */
export async function setSubscription(args: {
  basketId: string;
  follower: string;
  perMarketCapUsdc: number;
  signature: string;
  /** The signature's own timestamp; stored so an older one is refused later. */
  signedAt: number;
}): Promise<void> {
  await query(
    `INSERT INTO basket_subscriptions(basket_id, follower, per_market_cap_usdc, signature, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (basket_id, follower)
     DO UPDATE SET per_market_cap_usdc = EXCLUDED.per_market_cap_usdc,
                   signature = EXCLUDED.signature,
                   updated_at = EXCLUDED.updated_at`,
    [
      args.basketId,
      args.follower.toLowerCase(),
      args.perMarketCapUsdc,
      args.signature,
      args.signedAt,
    ],
  );
}

export async function getSubscription(
  basketId: string,
  follower: string,
): Promise<{ perMarketCapUsdc: number; updatedAt: number } | null> {
  const rows = await query(
    "SELECT per_market_cap_usdc, updated_at FROM basket_subscriptions WHERE basket_id = ? AND follower = ?",
    [basketId, follower.toLowerCase()],
  );
  if (!rows[0]) return null;
  return {
    perMarketCapUsdc: Number(rows[0].per_market_cap_usdc ?? 0),
    updatedAt: Number(rows[0].updated_at ?? 0),
  };
}
