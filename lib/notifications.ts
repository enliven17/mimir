/**
 * Notification events derived from index changes. Pure: the read index calls
 * claimEvents(before, after) when it refreshes a claim, and
 * lib/server/notifications.ts stores and delivers what comes back.
 */

export type NotificationKind = "challenged" | "resolved";

export interface NotificationEvent {
  recipient: string;
  chain: string;
  claimId: number;
  kind: NotificationKind;
  /** Distinguishes repeats of a kind on one claim (the 2nd vs 3rd challenge). */
  dedupe: string;
  payload: Record<string, unknown>;
}

export interface ClaimSnapshot {
  id: number;
  chain?: string;
  creator: string;
  question: string;
  state: string;
  challenger_count: number;
  winner_side?: string;
  resolution_summary?: string;
  confidence?: number;
  challengers?: Array<{ address: string; stake: number }>;
}

/**
 * Events a change from `before` to `after` should produce. Nothing for a claim
 * seen for the first time: its creator already knows it exists.
 */
export function claimEvents(
  before: Pick<ClaimSnapshot, "state" | "challenger_count"> | null,
  after: ClaimSnapshot,
): NotificationEvent[] {
  if (!before) return [];
  const chain = after.chain ?? "arc";
  const base = { chain, claimId: after.id };
  const question = after.question.slice(0, 140);
  const events: NotificationEvent[] = [];

  if (after.challenger_count > before.challenger_count) {
    const latest = after.challengers?.[after.challengers.length - 1];
    events.push({
      ...base,
      recipient: after.creator.toLowerCase(),
      kind: "challenged",
      dedupe: `count:${after.challenger_count}`,
      payload: { question, challenger: latest?.address ?? null, stake: latest?.stake ?? null, challengers: after.challenger_count },
    });
  }

  if (before.state !== "resolved" && after.state === "resolved") {
    const participants = new Set([after.creator, ...(after.challengers ?? []).map((c) => c.address)].map((a) => a.toLowerCase()));
    for (const recipient of participants) {
      events.push({
        ...base,
        recipient,
        kind: "resolved",
        dedupe: "resolved",
        payload: {
          question,
          winnerSide: after.winner_side ?? "",
          confidence: after.confidence ?? 0,
          summary: (after.resolution_summary ?? "").slice(0, 280),
          youWon: after.winner_side === "creator"
            ? recipient === after.creator.toLowerCase()
            : after.winner_side === "challengers"
              ? recipient !== after.creator.toLowerCase()
              : null,
        },
      });
    }
  }
  return events;
}

/** What a wallet signs to point its notifications at a webhook (url "" removes it). */
export function webhookMessage(address: string, url: string, signedAt: number): string {
  return ["Mimir notifications webhook", `address: ${address.toLowerCase()}`, `url: ${url || "(remove)"}`, `signedAt: ${signedAt}`].join("\n");
}
