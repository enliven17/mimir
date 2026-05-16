"use client";

/**
 * CCTP V2 bridge — pull USDC into Arc Testnet from any V2-supported chain.
 *
 * Flow (Fast Transfer mode, ~13–19s):
 *   1. Switch wallet to source chain (Base/Eth/Avalanche Sepolia)
 *   2. Approve USDC for TokenMessengerV2 (skipped if allowance is sufficient)
 *   3. depositForBurn on source chain
 *   4. Poll Circle's Iris attestation service
 *   5. Switch to Arc Testnet
 *   6. receiveMessage on Arc → user receives USDC
 *
 * No backend required: all calls go direct from the browser via wagmi/viem +
 * Circle's public Iris API. The "Circle stack" footprint is real on-chain.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits, type Hex } from "viem";
import {
  CCTP_CHAINS,
  TOKEN_MESSENGER_V2,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_V2,
  MESSAGE_TRANSMITTER_V2_ABI,
  ERC20_USDC_ABI,
  FINALITY_FAST,
  BYTES32_ZERO,
  addressToBytes32,
  pollIrisAttestation,
  type CctpChain,
} from "@/lib/cctp";
import GatewayBalanceWidget from "@/components/GatewayBalanceWidget";

type SourceKey = "ethSepolia" | "baseSepolia" | "avalancheFuji";

const SOURCES: SourceKey[] = ["baseSepolia", "ethSepolia", "avalancheFuji"];
const DEST: CctpChain = CCTP_CHAINS.arcTestnet;

type Phase = "idle" | "approving" | "burning" | "attesting" | "minting" | "done";

export default function BridgePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [sourceKey, setSourceKey] = useState<SourceKey>("baseSepolia");
  const [amount, setAmount]       = useState("5");
  const [phase, setPhase]         = useState<Phase>("idle");
  const [burnTxHash, setBurnTxHash]     = useState<Hex | null>(null);
  const [mintTxHash, setMintTxHash]     = useState<Hex | null>(null);
  const [irisMessage, setIrisMessage]   = useState<{ message: Hex; attestation: Hex } | null>(null);
  const [error, setError]               = useState<string | null>(null);

  const source = CCTP_CHAINS[sourceKey];
  const amountUnits = useMemo(() => {
    try { return parseUnits(amount || "0", 6); } catch { return 0n; }
  }, [amount]);

  const onSourceChain = chainId === source.chainId;
  const onDestChain   = chainId === DEST.chainId;

  // ── Balance + allowance reads (only when on source chain) ───────────────────
  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    chainId: source.chainId,
    address: source.usdc,
    abi:     ERC20_USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const balance = (balanceData as bigint | undefined) ?? 0n;

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    chainId: source.chainId,
    address: source.usdc,
    abi:     ERC20_USDC_ABI,
    functionName: "allowance",
    args: address ? [address, TOKEN_MESSENGER_V2] : undefined,
    query: { enabled: !!address },
  });
  const allowance = (allowanceData as bigint | undefined) ?? 0n;

  const needsApproval = allowance < amountUnits;

  // ── Wait for burn tx → poll Iris when burn lands ────────────────────────────
  const { data: burnReceipt } = useWaitForTransactionReceipt({
    hash:    burnTxHash ?? undefined,
    chainId: source.chainId,
  });

  useEffect(() => {
    if (!burnReceipt || phase !== "burning") return;
    setPhase("attesting");
    void (async () => {
      try {
        const msg = await pollIrisAttestation(source.domain, burnReceipt.transactionHash as Hex, {
          network: "testnet",
        });
        setIrisMessage({ message: msg.message, attestation: msg.attestation });
        setPhase("idle"); // user clicks "Switch to Arc & Mint"
      } catch (err: any) {
        setError(`Attestation failed: ${err?.message ?? err}`);
        setPhase("idle");
      }
    })();
  }, [burnReceipt, phase, source.domain]);

  // ── Step handlers ───────────────────────────────────────────────────────────
  async function handleSwitchToSource() {
    setError(null);
    try { switchChain({ chainId: source.chainId }); } catch (e: any) { setError(e?.message ?? "switch failed"); }
  }

  async function handleSwitchToArc() {
    setError(null);
    try { switchChain({ chainId: DEST.chainId }); } catch (e: any) { setError(e?.message ?? "switch failed"); }
  }

  async function handleApprove() {
    if (!address) return;
    setError(null);
    setPhase("approving");
    try {
      await writeContractAsync({
        chainId:      source.chainId,
        address:      source.usdc,
        abi:          ERC20_USDC_ABI,
        functionName: "approve",
        args:         [TOKEN_MESSENGER_V2, amountUnits],
      });
      await refetchAllowance();
      setPhase("idle");
    } catch (e: any) {
      setError(e?.message ?? "approve failed");
      setPhase("idle");
    }
  }

  async function handleBurn() {
    if (!address) return;
    if (amountUnits <= 0n) { setError("Enter a positive amount"); return; }
    if (balance < amountUnits) { setError("Insufficient USDC balance on source chain"); return; }
    setError(null);
    setPhase("burning");
    try {
      const tx = await writeContractAsync({
        chainId:      source.chainId,
        address:      TOKEN_MESSENGER_V2,
        abi:          TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurn",
        args: [
          amountUnits,
          DEST.domain,
          addressToBytes32(address),
          source.usdc,
          BYTES32_ZERO,                          // destinationCaller = permissionless
          amountUnits / 1000n,                   // maxFee = 0.1% slippage for Fast
          FINALITY_FAST,
        ],
      });
      setBurnTxHash(tx as Hex);
    } catch (e: any) {
      setError(e?.message ?? "burn failed");
      setPhase("idle");
    }
  }

  async function handleMint() {
    if (!irisMessage) return;
    setError(null);
    setPhase("minting");
    try {
      const tx = await writeContractAsync({
        chainId:      DEST.chainId,
        address:      MESSAGE_TRANSMITTER_V2,
        abi:          MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "receiveMessage",
        args:         [irisMessage.message, irisMessage.attestation],
      });
      setMintTxHash(tx as Hex);
      setPhase("done");
      void refetchBalance();
    } catch (e: any) {
      setError(e?.message ?? "mint failed");
      setPhase("idle");
    }
  }

  function reset() {
    setBurnTxHash(null);
    setMintTxHash(null);
    setIrisMessage(null);
    setPhase("idle");
    setError(null);
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500">Circle CCTP V2</p>
        <h1 className="text-3xl font-semibold">Bridge USDC to Arc</h1>
        <p className="text-zinc-400">
          Bring USDC from Base, Ethereum, or Avalanche Sepolia into Arc Testnet via
          Circle's native burn-and-mint protocol. Fast Transfer (~15s).
        </p>
      </header>

      <GatewayBalanceWidget />

      {/* Connection status */}
      {!isConnected ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <p className="text-zinc-300">Connect your wallet to start bridging.</p>
        </div>
      ) : (
        <>
          {/* Source chain selector */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-widest text-zinc-500">Source chain</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {SOURCES.map((k) => (
                  <button
                    key={k}
                    onClick={() => { setSourceKey(k); reset(); }}
                    className={`rounded-lg border p-3 text-sm transition ${
                      sourceKey === k
                        ? "border-blue-500 bg-blue-500/10 text-blue-300"
                        : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {CCTP_CHAINS[k].name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-zinc-500">Amount (USDC)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-800 bg-black/40 px-4 py-3 text-lg outline-none focus:border-blue-500"
              />
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>Balance on {source.name}: {(Number(balance) / 1e6).toFixed(2)} USDC</span>
                <span>Destination: {DEST.name}</span>
              </div>
            </div>
          </div>

          {/* Step buttons */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-3">
            {!onSourceChain && !irisMessage && (
              <button
                onClick={handleSwitchToSource}
                disabled={isSwitching}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {isSwitching ? "Switching…" : `Switch wallet to ${source.name}`}
              </button>
            )}

            {onSourceChain && needsApproval && !irisMessage && (
              <button
                onClick={handleApprove}
                disabled={phase === "approving"}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {phase === "approving" ? "Approving…" : `Approve ${amount} USDC`}
              </button>
            )}

            {onSourceChain && !needsApproval && !irisMessage && (
              <button
                onClick={handleBurn}
                disabled={phase === "burning" || phase === "attesting"}
                className="w-full rounded-lg bg-green-600 px-4 py-3 font-medium text-white transition hover:bg-green-500 disabled:opacity-50"
              >
                {phase === "burning" ? "Burning USDC on source…" :
                 phase === "attesting" ? "Waiting for Circle attestation (~15s)…" :
                 `Burn ${amount} USDC for Arc`}
              </button>
            )}

            {irisMessage && !onDestChain && phase !== "minting" && phase !== "done" && (
              <button
                onClick={handleSwitchToArc}
                disabled={isSwitching}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {isSwitching ? "Switching…" : "Switch wallet to Arc Testnet"}
              </button>
            )}

            {irisMessage && onDestChain && phase !== "done" && (
              <button
                onClick={handleMint}
                disabled={phase === "minting"}
                className="w-full rounded-lg bg-green-600 px-4 py-3 font-medium text-white transition hover:bg-green-500 disabled:opacity-50"
              >
                {phase === "minting" ? "Minting on Arc…" : `Mint ${amount} USDC on Arc`}
              </button>
            )}

            {phase === "done" && (
              <div className="space-y-2">
                <p className="text-green-400 font-medium">✓ Bridge complete!</p>
                <button
                  onClick={reset}
                  className="w-full rounded-lg border border-zinc-700 px-4 py-3 text-zinc-300 transition hover:border-zinc-500"
                >
                  Bridge another
                </button>
              </div>
            )}
          </div>

          {/* Tx hashes */}
          {(burnTxHash || mintTxHash) && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-3 text-sm">
              <p className="text-xs uppercase tracking-widest text-zinc-500">Transactions</p>
              {burnTxHash && (
                <a
                  href={`${source.explorerUrl}/tx/${burnTxHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="block break-all text-blue-400 hover:underline"
                >
                  Burn on {source.name}: {burnTxHash}
                </a>
              )}
              {irisMessage && !mintTxHash && (
                <p className="text-zinc-400">Attestation received from Circle Iris ✓</p>
              )}
              {mintTxHash && (
                <a
                  href={`${DEST.explorerUrl}/tx/${mintTxHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="block break-all text-blue-400 hover:underline"
                >
                  Mint on {DEST.name}: {mintTxHash}
                </a>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">
              {error}
            </div>
          )}
        </>
      )}

      <footer className="pt-4 text-xs text-zinc-600">
        Powered by{" "}
        <a href="https://developers.circle.com/cctp" target="_blank" rel="noopener noreferrer" className="underline">
          Circle CCTP V2
        </a>
        . Need testnet USDC? Use the{" "}
        <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="underline">
          Circle faucet
        </a>
        . <Link href="/" className="underline">Back to Mimir</Link>.
      </footer>
    </div>
  );
}
