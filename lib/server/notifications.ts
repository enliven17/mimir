import { createHmac, randomBytes } from "node:crypto";

import { query } from "@/lib/db";
import type { NotificationEvent } from "@/lib/notifications";
import { assertHopAllowed } from "@/lib/research/gateway";

export interface StoredNotification {
  id: number;
  chain: string;
  claimId: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/**
 * Store events (idempotently: the unique key drops repeats when a claim is
 * refreshed twice) and push the new ones to any webhook their recipient set.
 */
export async function recordNotifications(events: NotificationEvent[], now = Date.now()): Promise<void> {
  for (const e of events) {
    const inserted = await query(
      `INSERT INTO notifications(recipient, chain, claim_id, kind, dedupe, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (recipient, chain, claim_id, kind, dedupe) DO NOTHING
       RETURNING id`,
      [e.recipient, e.chain, e.claimId, e.kind, e.dedupe, JSON.stringify(e.payload), now],
    );
    if (inserted.length > 0) await deliverWebhook(e, now).catch(() => undefined);
  }
}

export async function listNotifications(recipient: string, limit = 30): Promise<StoredNotification[]> {
  const rows = await query(
    "SELECT id, chain, claim_id, kind, payload, created_at FROM notifications WHERE recipient = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    [recipient.toLowerCase(), Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.payload)) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    return {
      id: Number(r.id),
      chain: String(r.chain),
      claimId: Number(r.claim_id),
      kind: String(r.kind),
      payload,
      createdAt: Number(r.created_at),
    };
  });
}

/** Set (or with url "" remove) a wallet's webhook. Returns the new signing secret. */
export async function setWebhook(address: string, url: string, now = Date.now()): Promise<string | null> {
  if (!url) {
    await query("DELETE FROM notification_webhooks WHERE address = ?", [address.toLowerCase()]);
    return null;
  }
  const secret = randomBytes(24).toString("base64url");
  await query(
    `INSERT INTO notification_webhooks(address, url, secret, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (address) DO UPDATE SET url = excluded.url, secret = excluded.secret, created_at = excluded.created_at`,
    [address.toLowerCase(), url, secret, now],
  );
  return secret;
}

/**
 * POST the event with `x-mimir-signature: sha256=<hmac>` over the raw body,
 * keyed by the secret handed out at subscription. Best-effort, 5s budget,
 * no redirects, public hosts only.
 */
async function deliverWebhook(e: NotificationEvent, now: number): Promise<void> {
  const rows = await query("SELECT url, secret FROM notification_webhooks WHERE address = ?", [e.recipient]);
  if (!rows[0]) return;
  const url = String(rows[0].url);
  const secret = String(rows[0].secret);
  // ponytail: checked once before the POST; the evidence gateway's socket-level
  // pinning is GET-only. Webhook hosts are chosen by their own owner.
  await assertHopAllowed(url);
  const body = JSON.stringify({ event: e.kind, chain: e.chain, claimId: e.claimId, recipient: e.recipient, payload: e.payload, at: now });
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
}
