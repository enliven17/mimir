"use client";

/**
 * Gateway unified USDC balance widget.
 *
 * Calls our /api/gateway/balances proxy with the connected wallet address
 * and displays the user's USDC custodied across every CCTP V2 domain.
 *
 * Note: Gateway balances are deposits into Circle's Gateway custody — they
 * do NOT include raw on-chain USDC in the user's wallet. If everything is
 * zero, the user hasn't used Gateway yet; the CTA points them to the docs.
 */

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { CCTP_CHAINS, getChainByDomain } from "@/lib/cctp";

interface GatewayBalanceResponse {
  address:   string;
  totalUsdc: number;
  perDomain: Array<{ domain: number; balance: string }>;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: GatewayBalanceResponse }
  | { kind: "error"; message: string };

export default function GatewayBalanceWidget() {
  const { address, isConnected } = useAccount();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!isConnected || !address) { setState({ kind: "idle" }); return; }
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/gateway/balances?address=${address}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as GatewayBalanceResponse;
      })
      .then((data) => { if (!cancelled) setState({ kind: "ready", data }); })
      .catch((e: any) => { if (!cancelled) setState({ kind: "error", message: e?.message ?? "load failed" }); });
    return () => { cancelled = true; };
  }, [address, isConnected]);

  if (!isConnected) return null;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-zinc-500">Circle Gateway</p>
          <h2 className="text-sm font-medium text-zinc-300">Unified USDC balance</h2>
        </div>
        {state.kind === "ready" && (
          <p className="text-2xl font-semibold tabular-nums">
            ${state.data.totalUsdc.toFixed(2)}
          </p>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        {state.kind === "loading" && (
          <p className="text-xs text-zinc-500">Loading from Gateway…</p>
        )}
        {state.kind === "error" && (
          <p className="text-xs text-red-400">Error: {state.message}</p>
        )}
        {state.kind === "ready" && state.data.perDomain.length === 0 && (
          <div className="space-y-2 text-xs text-zinc-500">
            <p>No Gateway deposits yet for this address.</p>
            <p>
              Deposit USDC into Gateway on any chain, then mint to Arc instantly via attestation.{" "}
              <a
                href="https://developers.circle.com/gateway"
                target="_blank" rel="noopener noreferrer"
                className="text-blue-400 underline"
              >
                Learn how
              </a>
            </p>
          </div>
        )}
        {state.kind === "ready" && state.data.perDomain.length > 0 && (
          <ul className="divide-y divide-zinc-800/60">
            {state.data.perDomain.map((b) => {
              const chain = getChainByDomain(b.domain);
              const usdc = Number(b.balance) / 1_000_000;
              return (
                <li key={b.domain} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-zinc-300">{chain?.name ?? `Domain ${b.domain}`}</span>
                  <span className="tabular-nums text-zinc-100">{usdc.toFixed(2)} USDC</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
