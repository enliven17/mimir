"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { ChainKey } from "@/lib/chains";
import {
  disputeResolution,
  finalizeResolution,
  getDisputeStatus,
  refundExpired,
  type DisputeStatus,
} from "@/lib/contract";
import { formatUsdc } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";
import { useWallet } from "@/lib/wallet";

const SIDE: Record<number, string> = { 1: "Creator wins", 2: "Challengers win", 3: "Draw", 4: "Unresolvable (refund)" };
const PROPOSED = 4;
const DISPUTED = 5;
const ACTIVE = 1;
const GRACE_S = 7 * 24 * 3600;

/**
 * The optimistic-resolution controls for MimirV3 claims: the proposed verdict
 * and its dispute deadline, a dispute button for participants, finalize once
 * the window closes, and the timeout refund. Renders nothing on v2 chains or
 * for claims with nothing to act on.
 */
export default function DisputePanel({ claimId, chain, onChanged }: { claimId: number; chain: ChainKey; onChanged?: () => void }) {
  const { address } = useWallet();
  const [status, setStatus] = useState<DisputeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    setStatus(await getDisputeStatus(chain, claimId, address).catch(() => null));
    setNow(Math.floor(Date.now() / 1000));
  }, [chain, claimId, address]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!status || !status.supported) return null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const p = status.proposal;
  const closesAt = p ? p.proposedAt + status.disputeWindow : 0;
  const windowOpen = status.state === PROPOSED && now < closesAt;
  const refundableAt = status.state === ACTIVE ? status.deadline + GRACE_S : 0;
  const button = "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60";

  if (status.state === PROPOSED && p) {
    return (
      <section className="rounded-xl border border-amber-400/30 bg-amber-400/[0.05] p-4 sm:p-5" aria-label="Proposed verdict">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-amber-100/80">Proposed verdict</p>
        <p className="mt-2 font-display text-lg font-bold text-pv-text">{SIDE[p.winnerSide] ?? "Unknown"} · {p.confidence}%</p>
        {p.summary ? <p className="mt-1 text-sm text-pv-text/85">{p.summary}</p> : null}
        <p className="mt-2 text-xs text-pv-muted">
          {windowOpen
            ? `Disputable until ${new Date(closesAt * 1000).toLocaleString()}. Nothing is paid out before then.`
            : "The dispute window has closed; anyone can finalize the payout."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {windowOpen && status.isParticipant ? (
            <button
              type="button"
              disabled={busy}
              className={`${button} border-amber-300/40 text-amber-100 hover:bg-amber-400/[0.1]`}
              onClick={() => run("Dispute filed: the arbiter will review it.", () => disputeResolution(chain, claimId, status.bondUsdc))}
            >
              Dispute (bond {formatUsdc(status.bondUsdc)})
            </button>
          ) : null}
          {!windowOpen ? (
            <button
              type="button"
              disabled={busy}
              className={`${button} border-pv-emerald/50 text-pv-text hover:bg-pv-emerald/[0.1]`}
              onClick={() => run("Finalized: payouts sent.", () => finalizeResolution(chain, claimId))}
            >
              Finalize payout
            </button>
          ) : null}
        </div>
        {windowOpen && status.isParticipant ? (
          <p className="mt-2 text-xs text-pv-muted">The bond comes back if the arbiter changes the verdict and goes to the platform if it does not.</p>
        ) : null}
      </section>
    );
  }

  if (status.state === DISPUTED) {
    return (
      <section className="rounded-xl border border-white/[0.12] bg-pv-surface/50 p-4 sm:p-5" aria-label="Disputed verdict">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-pv-muted">Disputed</p>
        <p className="mt-2 text-sm text-pv-text/90">
          A participant disputed the proposed verdict{p ? ` (${SIDE[p.winnerSide] ?? "?"})` : ""}. The arbiter will rule; if it never does,
          everyone can be refunded seven days after the dispute.
        </p>
      </section>
    );
  }

  if (status.state === ACTIVE && now >= refundableAt) {
    return (
      <section className="rounded-xl border border-white/[0.12] bg-pv-surface/50 p-4 sm:p-5" aria-label="Unresolved claim">
        <p className="text-sm text-pv-text/90">The oracle did not settle this claim within seven days of its deadline. Anyone can refund every stake.</p>
        <button
          type="button"
          disabled={busy}
          className={`${button} mt-3 border-pv-emerald/50 text-pv-text hover:bg-pv-emerald/[0.1]`}
          onClick={() => run("Refunded: every stake was returned.", () => refundExpired(chain, claimId))}
        >
          Refund everyone
        </button>
      </section>
    );
  }
  return null;
}
