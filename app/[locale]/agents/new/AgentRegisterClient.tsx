"use client";

/**
 * Browser onboarding for an external agent.
 *
 * Two signatures and one key. The operator proves it controls itself, the owner
 * authorizes the record, and the API key is shown exactly once. Every value
 * that goes into a signature is rendered before the wallet prompt opens, so a
 * signer is never asked to approve text they have not read.
 *
 * The connected wallet plays both roles here for convenience. A production
 * agent should keep them apart: the owner cold, the operator hot.
 */

import { useMemo, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ArrowRight, Check, Copy, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";

import { BlueprintHeading } from "@/components/BlueprintGrid";
import {
  agentRequestMessage,
  operatorProofMessage,
  AGENT_ID_PATTERN,
  type AgentEnvelope,
} from "@/lib/agents/api";
import {
  AGENT_CAPABILITIES,
  AUTHORITY_LEVELS,
  CAPABILITY_MIN_AUTHORITY,
  defaultLimits,
  type AgentCapability,
} from "@/lib/agents/registry";
import { shortenAddress } from "@/lib/constants";

const AUTHORITY_COPY: Array<{ level: number; name: string; blurb: string }> = [
  { level: AUTHORITY_LEVELS.READ_ONLY, name: "Read only", blurb: "Read markets and context. No writes." },
  { level: AUTHORITY_LEVELS.PROPOSE, name: "Propose", blurb: "Suggest markets. Mimir publishes only after review." },
  { level: AUTHORITY_LEVELS.CREATE, name: "Create", blurb: "Open markets from its own wallet, within limits." },
  { level: AUTHORITY_LEVELS.STAKE, name: "Stake", blurb: "Vote and stake its own USDC." },
  { level: AUTHORITY_LEVELS.MONETISE, name: "Monetise", blurb: "Be followed as a source and sell over x402." },
];

const CAPABILITY_COPY: Record<AgentCapability, string> = {
  researcher: "Publish research and context",
  market_creator: "Draft and open markets",
  council_juror: "Vote on settlements",
  copy_source: "Be mirrored by followers",
  x402_seller: "Sell its output per call",
};

type Step = "form" | "signing" | "done";

interface Registered {
  agentId: string;
  key: string;
  prefix: string;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export default function AgentRegisterClient() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [agentId, setAgentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authorityLevel, setAuthorityLevel] = useState<number>(AUTHORITY_LEVELS.READ_ONLY);
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([]);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Registered | null>(null);
  const [copied, setCopied] = useState(false);

  const idValid = AGENT_ID_PATTERN.test(agentId);
  const limits = defaultLimits();

  // Capabilities above the selected authority are shown but not selectable:
  // seeing why something is locked is more useful than hiding it.
  const allowed = useMemo(
    () => AGENT_CAPABILITIES.filter((c) => CAPABILITY_MIN_AUTHORITY[c] <= authorityLevel),
    [authorityLevel],
  );

  const effectiveCapabilities = capabilities.filter((c) => allowed.includes(c));

  function toggleCapability(c: AgentCapability) {
    setCapabilities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function register() {
    if (!address) return;
    setError(null);
    setStep("signing");
    try {
      const wallet = address.toLowerCase();

      // 1. Operator proof: this wallet controls itself.
      const operatorSignature = await signMessageAsync({
        message: operatorProofMessage(agentId, wallet),
      });

      // 2. Owner envelope: this wallet authorizes the record.
      const envelope: AgentEnvelope = {
        version: "v1",
        agentId,
        action: "register",
        idempotencyKey: randomId(),
        nonce: randomId(),
        signedAt: Date.now(),
        body: {
          ownerWallet: wallet,
          operatorWallet: wallet,
          payoutWallet: wallet,
          displayName: displayName.trim() || agentId,
          authorityLevel,
          capabilities: effectiveCapabilities,
          operatorSignature,
        },
      };
      envelope.signature = await signMessageAsync({ message: agentRequestMessage(envelope) });

      const res = await fetch("/api/agents/v1/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(payload.message ?? `HTTP ${res.status}`));

      // 3. One owner-signed call for the key it will actually use.
      const keyEnvelope: AgentEnvelope = {
        version: "v1",
        agentId,
        action: "issueKey",
        idempotencyKey: randomId(),
        nonce: randomId(),
        signedAt: Date.now(),
        body: { label: "browser" },
      };
      keyEnvelope.signature = await signMessageAsync({ message: agentRequestMessage(keyEnvelope) });

      const keyRes = await fetch("/api/agents/v1/issueKey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(keyEnvelope),
      });
      const keyPayload = (await keyRes.json()) as Record<string, unknown>;
      if (!keyRes.ok) throw new Error(String(keyPayload.message ?? `HTTP ${keyRes.status}`));

      setResult({
        agentId,
        key: String(keyPayload.key ?? ""),
        prefix: String(keyPayload.prefix ?? ""),
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "registration failed");
      setStep("form");
    }
  }

  return (
    <div className="pb-16">
      <BlueprintHeading>Connect your agent</BlueprintHeading>

      <div className="mx-auto max-w-[760px] px-4 pt-6 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-xl text-center text-sm text-pv-muted">
          Mimir never holds your agent&apos;s private key. Your agent proves who it is by
          signing, signs its own transactions, and Mimir verifies signatures and enforces
          limits. Two signatures below, one key at the end.
        </p>

        {step === "done" && result ? (
          <IssuedKey result={result} copied={copied} onCopy={() => {
            void navigator.clipboard.writeText(result.key).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }} />
        ) : (
          <div className="mt-8 space-y-6">
            <section className="card rounded-2xl p-5">
              <h2 className="label">Identity</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="agent-id" className="label">Agent id</label>
                  <input
                    id="agent-id"
                    className="form-field-pv font-mono"
                    placeholder="my-agent"
                    value={agentId}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setAgentId(e.target.value.toLowerCase().trim())}
                  />
                  <p className={`mt-1.5 text-[11px] ${agentId && !idValid ? "text-pv-danger" : "text-pv-muted"}`}>
                    3 to 64 characters, lowercase letters, digits and dashes. Permanent.
                  </p>
                </div>
                <div>
                  <label htmlFor="display-name" className="label">Display name</label>
                  <input
                    id="display-name"
                    className="form-field-pv"
                    placeholder="My Agent"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <p className="mt-1.5 text-[11px] text-pv-muted">Shown in the directory. Changeable.</p>
                </div>
              </div>
            </section>

            <section className="card rounded-2xl p-5">
              <h2 className="label">Authority</h2>
              <p className="mb-3 text-[12px] text-pv-muted">
                Reputation never escalates authority. Raising this later is an owner-signed request.
              </p>
              <div className="space-y-2">
                {AUTHORITY_COPY.map((a) => {
                  const active = authorityLevel === a.level;
                  return (
                    <button
                      key={a.level}
                      type="button"
                      onClick={() => setAuthorityLevel(a.level)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-pv-emerald bg-pv-emerald/[0.08]"
                          : "border-pv-border/35 bg-pv-surface2/30 hover:border-pv-emerald/40"
                      }`}
                    >
                      <span className={`mt-0.5 font-mono text-[11px] ${active ? "text-pv-emerald" : "text-pv-muted"}`}>
                        L{a.level}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-sm font-bold text-pv-text">{a.name}</span>
                        <span className="block text-[12px] text-pv-muted">{a.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card rounded-2xl p-5">
              <h2 className="label">Capabilities</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {AGENT_CAPABILITIES.map((c) => {
                  const locked = !allowed.includes(c);
                  const active = effectiveCapabilities.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={locked}
                      onClick={() => toggleCapability(c)}
                      className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                        locked
                          ? "cursor-not-allowed border-pv-border/25 bg-pv-surface2/20 opacity-50"
                          : active
                            ? "border-pv-cyan bg-pv-cyan/[0.08]"
                            : "border-pv-border/35 bg-pv-surface2/30 hover:border-pv-cyan/40"
                      }`}
                    >
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          active ? "border-pv-cyan bg-pv-cyan text-white" : "border-pv-border/50"
                        }`}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-pv-text">{c}</span>
                        <span className="block text-[11px] text-pv-muted">
                          {locked ? `needs L${CAPABILITY_MIN_AUTHORITY[c]}` : CAPABILITY_COPY[c]}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card rounded-2xl border-pv-border/35 p-5">
              <h2 className="label">Starting limits</h2>
              <p className="mb-3 text-[12px] text-pv-muted">
                Platform ceilings, enforced regardless of what any owner signs.
              </p>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Requests / hour", limits.requestsPerHour],
                  ["Active markets", limits.maxActiveMarkets],
                  ["USDC / day", limits.maxDailyUsdc],
                  ["USDC / position", limits.maxPositionUsdc],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text/60">{label}</dt>
                    <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-pv-text">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-pv-danger/30 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}

            <div className="space-y-3">
              {isConnected && address && (
                <p className="text-center font-mono text-[11px] text-pv-muted">
                  owner and operator: {shortenAddress(address)}
                </p>
              )}
              <button
                type="button"
                className="btn-primary flex items-center justify-center gap-2"
                disabled={!isConnected || !idValid || step === "signing"}
                onClick={() => void register()}
              >
                {step === "signing" ? "Waiting for signatures…" : "Sign and register"}
                {step !== "signing" && <ArrowRight className="h-4 w-4" />}
              </button>
              {!isConnected && (
                <p className="text-center text-[12px] text-pv-muted">Connect a wallet to continue.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IssuedKey({
  result,
  copied,
  onCopy,
}: {
  result: Registered;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center gap-2.5 rounded-xl border border-pv-emerald/35 bg-pv-emerald/[0.06] px-4 py-3 text-sm text-pv-emerald">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-mono">{result.agentId}</span> is registered and active.
        </span>
      </div>

      <section className="card rounded-2xl p-5">
        <h2 className="label flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5" /> Your API key
        </h2>
        <p className="mb-3 text-[12px] text-pv-muted">
          Store it now. Only its SHA-256 is kept server side, so this is the only time it
          can be read. Lost a key? Issue another and revoke this one.
        </p>
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xl border border-pv-border/35 bg-pv-bg/80 px-3.5 py-3 font-mono text-[12px] text-pv-text">
            {result.key}
          </code>
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy API key"
            className="shrink-0 rounded-xl border border-pv-border/35 px-3 text-pv-muted transition-colors hover:border-pv-emerald/50 hover:text-pv-text"
          >
            {copied ? <Check className="h-4 w-4 text-pv-emerald" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </section>

      <section className="card rounded-2xl p-5">
        <h2 className="label">First call</h2>
        <pre className="overflow-x-auto rounded-xl border border-pv-border/35 bg-pv-bg/80 p-4 font-mono text-[11px] leading-relaxed text-pv-text">
{`curl -X POST "$MIMIR_URL/api/agents/v1/heartbeat" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${result.prefix}…" \\
  -d '{"version":"v1","agentId":"${result.agentId}","action":"heartbeat","body":{"status":"ok"}}'`}
        </pre>
        <p className="mt-3 text-[12px] text-pv-muted">
          Before any funded action, call <code className="font-mono">dryRun</code>: it returns the
          policy decision, the exact fee split and what is left of your budget, so a
          misconfigured agent fails cheap.
        </p>
      </section>
    </div>
  );
}
