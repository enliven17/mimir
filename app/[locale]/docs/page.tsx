"use client";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";

/* ───────────────────────────────────────────────────────────────────────────
 * Inline SVG diagrams — hand-drawn in the project's blush palette so they
 * inherit the visual language without pulling in Mermaid. Each one is
 * responsive via `viewBox`; tweak only the box/text positions when copy
 * changes.
 *
 * Palette tokens used here mirror tailwind.config.ts > theme.extend.colors.pv:
 *   bg       #FCF8F8
 *   surface  #FBEFEF
 *   surface2 #F9DFDF
 *   border   #F5AFAF
 *   text     #2A1818
 *   muted    #7A5050
 *   accent   #D85F5F   (the "pv-emerald" alias, recoloured to rose)
 * ───────────────────────────────────────────────────────────────────────── */

const C = {
  bg:      "#FCF8F8",
  surface: "#FBEFEF",
  surf2:   "#F9DFDF",
  border:  "#F5AFAF",
  text:    "#2A1818",
  muted:   "#7A5050",
  accent:  "#D85F5F",
};

/* ── 1. Architecture diagram ─────────────────────────────────────────────── */
function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 880 360" className="h-auto w-full" role="img" aria-label="Mimir architecture diagram">
      <defs>
        <marker id="arrow-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Users */}
      <g>
        <rect x="20" y="150" width="130" height="64" rx="14" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="85" y="178" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Users</text>
        <text x="85" y="196" textAnchor="middle" fontSize="10" fill={C.muted}>MetaMask / Coinbase</text>
      </g>

      {/* Frontend (Vercel) */}
      <g>
        <rect x="210" y="40" width="220" height="120" rx="16" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="320" y="68" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">VERCEL · FRONTEND</text>
        <text x="320" y="96" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>Next.js 16 app</text>
        <text x="320" y="118" textAnchor="middle" fontSize="11" fill={C.muted}>/explorer · /bridge · /vs/[id]</text>
        <text x="320" y="138" textAnchor="middle" fontSize="11" fill={C.muted}>+ /api routes</text>
      </g>

      {/* Workers (Railway) */}
      <g>
        <rect x="210" y="200" width="220" height="120" rx="16" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="320" y="228" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">RAILWAY · WORKERS</text>
        <text x="320" y="252" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>oracle · creator · council</text>
        <text x="320" y="272" textAnchor="middle" fontSize="11" fill={C.muted}>12 agents, all W3S-signed</text>
        <text x="320" y="290" textAnchor="middle" fontSize="11" fill={C.muted}>poll, evaluate, stake, settle</text>
      </g>

      {/* Arc */}
      <g>
        <rect x="490" y="40" width="200" height="120" rx="16" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="590" y="68" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">ARC TESTNET</text>
        <text x="590" y="96" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>Mimir.sol</text>
        <text x="590" y="118" textAnchor="middle" fontSize="11" fill={C.muted}>native USDC stakes</text>
        <text x="590" y="138" textAnchor="middle" fontSize="11" fill={C.muted}>~$0.01 fees, sub-sec finality</text>
      </g>

      {/* Neon + LLM */}
      <g>
        <rect x="490" y="200" width="200" height="55" rx="12" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="590" y="222" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">NEON POSTGRES</text>
        <text x="590" y="240" textAnchor="middle" fontSize="11" fill={C.text}>read-index cache</text>
        <rect x="490" y="265" width="200" height="55" rx="12" fill={C.surface} stroke={C.border} strokeWidth="1.5" />
        <text x="590" y="287" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">LLM PROVIDER</text>
        <text x="590" y="305" textAnchor="middle" fontSize="11" fill={C.text}>Gemini · Anthropic</text>
      </g>

      {/* Circle stack callout */}
      <g>
        <rect x="730" y="100" width="130" height="160" rx="14" fill={C.bg} stroke={C.border} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x="795" y="124" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">CIRCLE STACK</text>
        <text x="795" y="148" textAnchor="middle" fontSize="11" fill={C.text}>USDC</text>
        <text x="795" y="170" textAnchor="middle" fontSize="11" fill={C.text}>W3S</text>
        <text x="795" y="192" textAnchor="middle" fontSize="11" fill={C.text}>CCTP V2</text>
        <text x="795" y="214" textAnchor="middle" fontSize="11" fill={C.text}>Gateway</text>
        <text x="795" y="236" textAnchor="middle" fontSize="11" fill={C.text}>App Kit</text>
      </g>

      {/* Arrows */}
      <line x1="150" y1="182" x2="208" y2="100" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="150" y1="182" x2="208" y2="260" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="100" x2="488" y2="100" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="260" x2="488" y2="100" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="260" x2="488" y2="230" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="280" x2="488" y2="293" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-a)" />
      <line x1="430" y1="120" x2="488" y2="225" stroke={C.accent} strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}

/* ── 2. Claim lifecycle (horizontal stepper) ─────────────────────────────── */
function LifecycleDiagram() {
  const steps = [
    { tag: "01", title: "Create",   note: "Stake side A in USDC" },
    { tag: "02", title: "Challenge",note: "Side B stakes the other side" },
    { tag: "03", title: "Wait",     note: "Deadline passes" },
    { tag: "04", title: "Read",     note: "Oracle fetches evidence" },
    { tag: "05", title: "Evaluate", note: "LLM returns verdict + confidence" },
    { tag: "06", title: "Resolve",  note: "Atomic on-chain payout" },
  ];
  const W = 1100;
  const H = 220;
  const padX = 60;
  const innerW = W - padX * 2;
  const stepW = innerW / steps.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Claim lifecycle">
      {/* Spine */}
      <line x1={padX} y1={H / 2} x2={W - padX} y2={H / 2} stroke={C.border} strokeWidth="2" />

      {steps.map((step, i) => {
        const cx = padX + stepW * i + stepW / 2;
        return (
          <g key={step.tag}>
            <circle cx={cx} cy={H / 2} r="14" fill={C.bg} stroke={C.accent} strokeWidth="2" />
            <text x={cx} y={H / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent}>{step.tag}</text>
            <text x={cx} y={H / 2 - 36} textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>{step.title}</text>
            <text x={cx} y={H / 2 + 50} textAnchor="middle" fontSize="11" fill={C.muted}>{step.note}</text>
          </g>
        );
      })}

      {/* Tag at each end of the spine */}
      <text x={padX} y={H / 2 - 60} fontSize="10" fontWeight="700" letterSpacing="2" fill={C.muted}>CREATOR</text>
      <text x={W - padX} y={H / 2 - 60} textAnchor="end" fontSize="10" fontWeight="700" letterSpacing="2" fill={C.muted}>ORACLE</text>
    </svg>
  );
}

/* ── 3. Oracle agent loop ────────────────────────────────────────────────── */
function AgentLoopDiagram() {
  return (
    <svg viewBox="0 0 880 360" className="h-auto w-full" role="img" aria-label="Oracle agent loop">
      <defs>
        <marker id="arrow-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Poll loop center */}
      <g>
        <circle cx="200" cy="180" r="80" fill={C.surface} stroke={C.border} strokeWidth="1.8" />
        <text x="200" y="172" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Poll loop</text>
        <text x="200" y="192" textAnchor="middle" fontSize="11" fill={C.muted}>every 60s</text>
      </g>

      {/* Settler branch */}
      <g>
        <rect x="380" y="60" width="260" height="100" rx="14" fill={C.surf2} stroke={C.accent} strokeWidth="1.6" />
        <text x="510" y="86" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">ROLE A · SETTLER</text>
        <text x="510" y="110" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>state = ACTIVE &amp; deadline passed</text>
        <text x="510" y="132" textAnchor="middle" fontSize="11" fill={C.muted}>fetch evidence → LLM → resolveClaim()</text>
      </g>

      {/* Challenger branch */}
      <g>
        <rect x="380" y="200" width="260" height="120" rx="14" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="510" y="226" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">ROLE B · CHALLENGER  (opt-in)</text>
        <text x="510" y="250" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>state = OPEN &amp; deadline in future</text>
        <text x="510" y="272" textAnchor="middle" fontSize="11" fill={C.muted}>early LLM read → confidence ≥ 80%</text>
        <text x="510" y="290" textAnchor="middle" fontSize="11" fill={C.muted}>Kelly-sized stake (≤ 25% bankroll)</text>
        <text x="510" y="308" textAnchor="middle" fontSize="11" fill={C.muted}>requires AUTO_CHALLENGE=1</text>
      </g>

      {/* Outcome */}
      <g>
        <rect x="680" y="120" width="180" height="120" rx="14" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="770" y="146" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">ON-CHAIN</text>
        <text x="770" y="172" textAnchor="middle" fontSize="14" fontWeight="700" fill={C.text}>USDC payout</text>
        <text x="770" y="194" textAnchor="middle" fontSize="11" fill={C.muted}>evidence hash committed</text>
        <text x="770" y="212" textAnchor="middle" fontSize="11" fill={C.muted}>confidence stored</text>
      </g>

      {/* Arrows from poll into branches */}
      <line x1="280" y1="160" x2="378" y2="110" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
      <line x1="280" y1="200" x2="378" y2="260" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
      <line x1="640" y1="110" x2="680" y2="170" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
      <line x1="640" y1="260" x2="680" y2="200" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-b)" />
    </svg>
  );
}

/* ── 4. CCTP V2 bridge flow ──────────────────────────────────────────────── */
function BridgeDiagram() {
  return (
    <svg viewBox="0 0 940 240" className="h-auto w-full" role="img" aria-label="CCTP V2 bridge flow">
      <defs>
        <marker id="arrow-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Source chain */}
      <g>
        <rect x="20" y="60" width="220" height="120" rx="16" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="130" y="86" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">SOURCE CHAIN</text>
        <text x="130" y="110" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>Base · Eth · Avalanche</text>
        <text x="130" y="138" textAnchor="middle" fontSize="11" fill={C.muted}>approve(USDC)</text>
        <text x="130" y="156" textAnchor="middle" fontSize="11" fill={C.muted}>depositForBurn(...)</text>
      </g>

      {/* Iris */}
      <g>
        <rect x="370" y="60" width="200" height="120" rx="16" fill={C.bg} stroke={C.accent} strokeWidth="1.8" strokeDasharray="5 3" />
        <text x="470" y="86" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">CIRCLE IRIS</text>
        <text x="470" y="110" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>attestation service</text>
        <text x="470" y="138" textAnchor="middle" fontSize="11" fill={C.muted}>watches burn events</text>
        <text x="470" y="156" textAnchor="middle" fontSize="11" fill={C.muted}>~13–19s for Fast Transfer</text>
      </g>

      {/* Arc */}
      <g>
        <rect x="700" y="60" width="220" height="120" rx="16" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="810" y="86" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">ARC TESTNET</text>
        <text x="810" y="110" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>receiveMessage(...)</text>
        <text x="810" y="138" textAnchor="middle" fontSize="11" fill={C.muted}>mints native USDC</text>
        <text x="810" y="156" textAnchor="middle" fontSize="11" fill={C.muted}>permissionless tx</text>
      </g>

      <line x1="240" y1="120" x2="368" y2="120" stroke={C.accent} strokeWidth="1.6" markerEnd="url(#arrow-c)" />
      <line x1="570" y1="120" x2="698" y2="120" stroke={C.accent} strokeWidth="1.6" markerEnd="url(#arrow-c)" />

      <text x="304" y="108" textAnchor="middle" fontSize="11" fontWeight="600" fill={C.muted}>burn tx hash</text>
      <text x="634" y="108" textAnchor="middle" fontSize="11" fontWeight="600" fill={C.muted}>message + signature</text>
    </svg>
  );
}

/* ── 5. x402 nanopayment flow ────────────────────────────────────────────── */
function NanopaymentDiagram() {
  return (
    <svg viewBox="0 0 1080 240" className="h-auto w-full" role="img" aria-label="x402 nanopayment flow">
      <defs>
        <marker id="arrow-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* Payer · oracle */}
      <g>
        <rect x="20" y="70" width="180" height="100" rx="16" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="110" y="96" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.accent} letterSpacing="2">PAYER · ORACLE</text>
        <text x="110" y="120" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>W3S signs</text>
        <text x="110" y="142" textAnchor="middle" fontSize="11" fill={C.muted}>no local key</text>
      </g>

      {/* Paid endpoint */}
      <g>
        <rect x="248" y="70" width="190" height="100" rx="16" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="343" y="96" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted} letterSpacing="2">HTTP 402</text>
        <text x="343" y="118" textAnchor="middle" fontSize="12" fontWeight="700" fill={C.text}>/api/premium/price</text>
        <text x="343" y="140" textAnchor="middle" fontSize="11" fill={C.muted}>quote $0.001 USDC</text>
      </g>

      {/* Circle Gateway facilitator */}
      <g>
        <rect x="486" y="70" width="200" height="100" rx="16" fill={C.bg} stroke={C.accent} strokeWidth="1.8" strokeDasharray="5 3" />
        <text x="586" y="96" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.accent} letterSpacing="2">CIRCLE GATEWAY</text>
        <text x="586" y="118" textAnchor="middle" fontSize="12" fontWeight="700" fill={C.text}>facilitator</text>
        <text x="586" y="140" textAnchor="middle" fontSize="11" fill={C.muted}>verify + settle</text>
      </g>

      {/* Settled on Arc */}
      <g>
        <rect x="734" y="70" width="150" height="100" rx="16" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="809" y="96" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.accent} letterSpacing="2">ARC TESTNET</text>
        <text x="809" y="118" textAnchor="middle" fontSize="12" fontWeight="700" fill={C.text}>settled</text>
        <text x="809" y="140" textAnchor="middle" fontSize="11" fill={C.muted}>sub-cent USDC</text>
      </g>

      {/* Neon → /revenue */}
      <g>
        <rect x="932" y="70" width="130" height="100" rx="16" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="997" y="96" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted} letterSpacing="2">NEON</text>
        <text x="997" y="118" textAnchor="middle" fontSize="12" fontWeight="700" fill={C.text}>x402_payments</text>
        <text x="997" y="140" textAnchor="middle" fontSize="11" fill={C.muted}>→ /revenue</text>
      </g>

      <line x1="200" y1="120" x2="246" y2="120" stroke={C.accent} strokeWidth="1.6" markerEnd="url(#arrow-d)" />
      <line x1="438" y1="120" x2="484" y2="120" stroke={C.accent} strokeWidth="1.6" markerEnd="url(#arrow-d)" />
      <line x1="686" y1="120" x2="732" y2="120" stroke={C.accent} strokeWidth="1.6" markerEnd="url(#arrow-d)" />
      <line x1="884" y1="120" x2="930" y2="120" stroke={C.accent} strokeWidth="1.6" markerEnd="url(#arrow-d)" />

      <text x="223" y="108" textAnchor="middle" fontSize="10" fontWeight="600" fill={C.muted}>request</text>
      <text x="461" y="108" textAnchor="middle" fontSize="10" fontWeight="600" fill={C.muted}>pay</text>
      <text x="709" y="108" textAnchor="middle" fontSize="10" fontWeight="600" fill={C.muted}>onchain</text>
      <text x="907" y="108" textAnchor="middle" fontSize="10" fontWeight="600" fill={C.muted}>record</text>
    </svg>
  );
}

/* ── 6. Council-as-jury settlement ───────────────────────────────────────── */
function JuryDiagram() {
  return (
    <svg viewBox="0 0 900 420" className="h-auto w-full" role="img" aria-label="Council-as-jury settlement flow">
      <defs>
        <marker id="arrow-e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={C.accent} />
        </marker>
      </defs>

      {/* 1 deadline */}
      <g>
        <rect x="30" y="40" width="200" height="70" rx="14" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="130" y="68" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">01 · TRIGGER</text>
        <text x="130" y="90" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>deadline reached</text>
      </g>

      {/* 2 fetch evidence */}
      <g>
        <rect x="30" y="150" width="200" height="70" rx="14" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="130" y="178" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">02 · READ</text>
        <text x="130" y="200" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>oracle fetches evidence</text>
      </g>

      {/* 3 buy votes */}
      <g>
        <rect x="300" y="120" width="280" height="130" rx="16" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="440" y="148" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">03 · BUY N VERDICTS (x402)</text>
        <text x="440" y="172" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>GET /api/council/vote</text>
        <text x="440" y="194" textAnchor="middle" fontSize="11" fill={C.muted}>$0.001 → each persona&apos;s wallet</text>
        <text x="440" y="214" textAnchor="middle" fontSize="11" fill={C.muted}>rule-based abstain · specialists in-category</text>
        <text x="440" y="234" textAnchor="middle" fontSize="11" fill={C.muted}>quorum = 3 decisive votes (default)</text>
      </g>

      {/* Groq fallback note */}
      <g>
        <rect x="630" y="50" width="240" height="64" rx="12" fill={C.bg} stroke={C.border} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x="750" y="74" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted} letterSpacing="2">LLM FALLBACK</text>
        <text x="750" y="96" textAnchor="middle" fontSize="11" fill={C.text}>Groq (Llama) on Gemini 429</text>
      </g>

      {/* 4 tally */}
      <g>
        <rect x="650" y="135" width="220" height="100" rx="14" fill={C.surface} stroke={C.border} strokeWidth="1.6" />
        <text x="760" y="162" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.muted} letterSpacing="2">04 · TALLY</text>
        <text x="760" y="188" textAnchor="middle" fontSize="18" fontWeight="700" fill={C.text}>7 – 2</text>
        <text x="760" y="210" textAnchor="middle" fontSize="11" fill={C.muted}>consensus → evidenceHash</text>
      </g>

      {/* solo fallback */}
      <g>
        <rect x="300" y="290" width="280" height="64" rx="12" fill={C.bg} stroke={C.border} strokeWidth="1.5" strokeDasharray="4 3" />
        <text x="440" y="314" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.muted} letterSpacing="2">BELOW QUORUM</text>
        <text x="440" y="336" textAnchor="middle" fontSize="11" fill={C.text}>fall back to solo oracle verdict</text>
      </g>

      {/* 5 resolveClaim */}
      <g>
        <rect x="630" y="280" width="240" height="100" rx="14" fill={C.surf2} stroke={C.accent} strokeWidth="1.8" />
        <text x="750" y="307" textAnchor="middle" fontSize="11" fontWeight="700" fill={C.accent} letterSpacing="2">05 · ON-CHAIN</text>
        <text x="750" y="333" textAnchor="middle" fontSize="13" fontWeight="700" fill={C.text}>resolveClaim()</text>
        <text x="750" y="353" textAnchor="middle" fontSize="11" fill={C.muted}>verdict + evidenceHash</text>
        <text x="750" y="371" textAnchor="middle" fontSize="11" fill={C.muted}>→ payout</text>
      </g>

      {/* Arrows */}
      <line x1="130" y1="110" x2="130" y2="148" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-e)" />
      <line x1="230" y1="185" x2="298" y2="185" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-e)" />
      <line x1="580" y1="185" x2="648" y2="185" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-e)" />
      <line x1="760" y1="235" x2="760" y2="278" stroke={C.accent} strokeWidth="1.5" markerEnd="url(#arrow-e)" />
      <line x1="440" y1="250" x2="440" y2="288" stroke={C.accent} strokeWidth="1.5" strokeDasharray="3 3" markerEnd="url(#arrow-e)" />
      <line x1="580" y1="322" x2="628" y2="322" stroke={C.accent} strokeWidth="1.5" strokeDasharray="3 3" markerEnd="url(#arrow-e)" />
      <line x1="690" y1="114" x2="700" y2="133" stroke={C.accent} strokeWidth="1.3" strokeDasharray="3 3" />
    </svg>
  );
}

/* ── Section primitives ──────────────────────────────────────────────────── */
function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-6">
      <header className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald">{eyebrow}</p>
        <h2 className="text-2xl font-bold tracking-tight text-pv-text sm:text-3xl">{title}</h2>
      </header>
      <div className="space-y-5 text-[15px] leading-relaxed text-pv-text/85">{children}</div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-pv-border/40 bg-pv-surface/70 p-5">
      <h3 className="mb-2 font-bold tracking-tight text-pv-text">{title}</h3>
      <div className="text-sm leading-relaxed text-pv-text/80">{children}</div>
    </div>
  );
}

function DiagramFrame({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <figure className="my-4 rounded-2xl border border-pv-border/40 bg-pv-surface/40 p-5 sm:p-7">
      <div className="overflow-x-auto">{children}</div>
      <figcaption className="mt-3 text-center text-xs text-pv-muted">{caption}</figcaption>
    </figure>
  );
}

function TocLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="block border-l-2 border-pv-border/40 py-1 pl-3 text-sm text-pv-text/80 transition-colors hover:border-pv-emerald hover:text-pv-text"
    >
      {label}
    </a>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function DocsPage() {
  return (
    <div className="pb-10">
      <BlueprintHeading>How Mimir works</BlueprintHeading>
      <article className="mx-auto max-w-4xl space-y-14 px-4 pt-6 sm:px-6 lg:px-8">
      <header>
        <p className="mx-auto max-w-2xl text-center text-base leading-relaxed text-pv-text/75 sm:text-lg">
          Mimir is an AI-settled claim market on Arc — Circle&apos;s stablecoin-native L1.
          Two parties stake USDC on opposite sides of a verifiable question; when the
          deadline passes, an off-chain AI oracle reads the agreed-upon evidence
          source, returns a verdict, and the smart contract pays out the winning side
          atomically. No committees, no manual disputes.
        </p>
      </header>

      {/* TOC */}
      <nav aria-label="Table of contents" className="rounded-2xl border border-pv-border/30 bg-pv-surface/40 p-5">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">Contents</p>
        <div className="grid gap-1 sm:grid-cols-2">
          <TocLink href="#what" label="1. What Mimir is" />
          <TocLink href="#why-arc" label="2. Why USDC on Arc" />
          <TocLink href="#architecture" label="3. Architecture" />
          <TocLink href="#lifecycle" label="4. The claim lifecycle" />
          <TocLink href="#agents" label="5. The agents" />
          <TocLink href="#circle" label="6. The Circle stack" />
          <TocLink href="#lepton" label="7. What's new since Arc (Lepton)" />
          <TocLink href="#contract" label="8. Smart contract terms" />
          <TocLink href="#play" label="9. How to play" />
          <TocLink href="#faq" label="10. FAQ" />
        </div>
      </nav>

      <Section id="what" eyebrow="01" title="What Mimir is">
        <p>
          A claim in Mimir is a single, verifiable question with a deadline and a
          designated resolution source — for example,{" "}
          <em>&ldquo;Will BTC close above $100,000 on 2026-05-25 according to CoinGecko?&rdquo;</em>
        </p>
        <p>
          Anyone creates a claim by staking USDC on one side. Another party (or an
          autonomous agent) challenges by staking the other side. At the deadline the
          oracle fetches the evidence URL, asks an LLM to evaluate the outcome against
          the settlement rule, and submits the verdict on chain. The contract pays out
          the winning side in the same transaction.
        </p>
        <p>
          What ships on chain: the question, both positions, the resolution URL, both
          stakes, the verdict, the confidence number, and the keccak256 hash of the
          raw evidence the oracle actually saw. The hash means anyone can re-fetch
          the URL, hash it themselves, and verify the oracle isn&apos;t lying about
          its input.
        </p>
      </Section>

      <Section id="why-arc" eyebrow="02" title="Why USDC on Arc">
        <p>
          Arc is Circle&apos;s EVM L1 with USDC as the native gas token. That property
          changes the economics of a stake-and-settle market enough to be worth
          calling out:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="No ERC-20 approval dance">
            Stakes use <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">msg.value</code>.
            One signature opens or accepts a claim — no separate <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">approve()</code> tx,
            no allowance to manage.
          </Card>
          <Card title="Predictable, sub-cent fees">
            Gas is denominated in USDC, not a volatile native token. A settlement
            tx costs roughly $0.01 regardless of network congestion.
          </Card>
          <Card title="Sub-second deterministic finality">
            The oracle can settle and pay out inside a single user-visible moment,
            instead of leaving funds in limbo through a long confirmation window.
          </Card>
          <Card title="Stablecoin-native semantics">
            Treasury operations &mdash; agent funding, payouts, balance reads &mdash;
            all happen in the same unit users see in the UI.
          </Card>
        </div>
      </Section>

      <Section id="architecture" eyebrow="03" title="Architecture">
        <p>
          Three independent tiers, each running where it fits best:
        </p>
        <DiagramFrame caption="Top to bottom: user wallets → Next.js frontend (Vercel) and worker agents (Railway) → Arc contract + ancillary services (Neon read-index, LLM provider, the Circle stack).">
          <ArchitectureDiagram />
        </DiagramFrame>
        <ul className="list-disc space-y-2 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">Frontend (Vercel).</strong> Next.js App
            Router with serverless API routes. Reads come straight from Arc RPC;
            writes are user-signed via wagmi/viem.
          </li>
          <li>
            <strong className="text-pv-text">Workers (Railway).</strong> Three
            long-lived Node processes: the oracle (settler), the market-creator,
            and the ten-persona Mimir Council. Vercel functions time out before
            a polling cycle can finish — Railway is the right home.
          </li>
          <li>
            <strong className="text-pv-text">Data (Neon Postgres).</strong> A
            denormalised read-index of on-chain state for the explorer / dashboard
            feeds. Optional — the contract remains source of truth, and pages that
            don&apos;t need feeds (bridge, stats, claim detail) work without it.
          </li>
        </ul>
      </Section>

      <Section id="lifecycle" eyebrow="04" title="The claim lifecycle">
        <DiagramFrame caption="Six discrete steps from open to settled. Steps 04–06 are entirely automated by the oracle agent.">
          <LifecycleDiagram />
        </DiagramFrame>
        <p>
          A few details matter for trust:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">Evidence hash on chain.</strong>{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">keccak256(raw evidence)</code>{" "}
            lands in contract storage. Anyone can re-fetch the URL, hash it, and
            verify what the oracle actually saw.
          </li>
          <li>
            <strong className="text-pv-text">Confidence is first-class.</strong>{" "}
            The LLM returns a 0–100 number that ships with the verdict. The product
            surfaces it as confident vs. contested.
          </li>
          <li>
            <strong className="text-pv-text">Refund the ambiguous.</strong>{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">DRAW</code> and{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">UNRESOLVABLE</code>{" "}
            are real verdicts that return stakes. Better inconclusive and refunded
            than wrong and paid out.
          </li>
          <li>
            <strong className="text-pv-text">Oracle-only resolution.</strong>{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">resolveClaim</code>{" "}
            is gated by a single address — a Circle-managed wallet held by the
            agent. No human can quietly re-route payouts.
          </li>
        </ul>
      </Section>

      <Section id="agents" eyebrow="05" title="The agents">
        <p>
          Twelve background processes run continuously: the oracle, the
          market-creator, and ten council personas. None of them holds a local
          private key — every agent signs through Circle&apos;s Programmable
          Wallets.
        </p>
        <DiagramFrame caption="Oracle decision tree. The poll loop reads every claim once a minute; ACTIVE+expired claims go to the settler, OPEN+live claims go to the optional Kelly-sized challenger. The council follows the same shape, one persona at a time.">
          <AgentLoopDiagram />
        </DiagramFrame>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card title="Oracle agent">
            Reads expired ACTIVE claims, fetches the evidence URL, asks the LLM for
            a verdict + confidence + one-sentence explanation, and submits{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">resolveClaim</code>{" "}
            on chain. With{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">AUTO_CHALLENGE=1</code>{" "}
            it also stakes the contrarian side on OPEN claims it&apos;s highly
            confident about, sized by the Kelly criterion and capped at 25% of its
            bankroll.
          </Card>
          <Card title="Market-creator agent">
            Polls trusted public sources (CoinGecko, ESPN, OpenWeather) every six
            hours, asks the LLM to draft 1&ndash;5 verifiable claim candidates,
            scores each for quality, and creates the highest-scoring ones on chain
            with its own creator-side stake. Opening a claim is an economic
            commitment, not a free tweet.
          </Card>
          <Card title="The Mimir Council (×10)">
            Ten AI personas — optimist, pessimist, contrarian, statistician,
            whale-watcher, crypto maxi, sports pundit, weatherman, doomer, yapper —
            each with its own W3S wallet and its own way of reading a market.
            Two are pure rule-based (no LLM); three are category specialists; the
            rest run the oracle&apos;s evaluation prompt with a personality prefix.
            They only call{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">challengeClaim</code>;
            settlement stays with the oracle. See{" "}
            <Link href="/council" className="text-pv-emerald underline-offset-2 hover:underline">
              /council
            </Link>
            {" "}for the full roster.
          </Card>
        </div>
      </Section>

      <Section id="circle" eyebrow="06" title="The Circle stack">
        <p>
          Mimir uses Circle&apos;s developer platform end-to-end. Each piece earns
          its keep:
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="USDC (native)">
            Arc&apos;s gas token. Stakes use <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">msg.value</code>,
            settlement pays USDC directly, no wrapper contracts.
          </Card>
          <Card title="W3S Programmable Wallets">
            The oracle and market-creator addresses are Circle-managed. Every
            contract execution goes through{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">executeContract(...)</code>{" "}
            — no private key ever sits in a worker process.
          </Card>
          <Card title="CCTP V2 (Fast Transfer)">
            The bridge page burns USDC on Base / Ethereum / Avalanche Sepolia,
            polls Iris for an attestation, and lets the user mint native USDC on
            Arc. End-to-end in ~15 seconds.
          </Card>
          <Card title="Gateway">
            A server-side proxy hits <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">POST /v1/balances</code>{" "}
            to return a wallet&apos;s USDC balance across every CCTP V2 domain in
            one round-trip, rendered as the &ldquo;unified balance&rdquo; widget.
          </Card>
        </div>
        <DiagramFrame caption="CCTP V2 bridge flow. The mint on Arc is permissionless — the user submits it themselves once Iris returns the signed message.">
          <BridgeDiagram />
        </DiagramFrame>
      </Section>

      <Section id="lepton" eyebrow="07" title="What's new since Arc (Lepton nanopayments)">
        <p>
          After the Arc / Agora hackathon, Mimir grew an economic layer of its own.
          Agents stopped being purely operational and became market participants —
          they pay each other sub-cent amounts for data and verdicts, sell their own
          outputs, and every settled cent is recorded and shown live. This is the
          &ldquo;Lepton&rdquo; era: nanopayments over HTTP 402, settled on Arc through
          Circle Gateway, signed entirely through W3S.
        </p>

        <Card title="Agents as paying + selling economic actors (x402)">
          Agents pay-per-request over the HTTP <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">402 Payment Required</code>{" "}
          status in sub-cent USDC, settled through Circle Gateway and signed via W3S —
          there is no local private key anywhere in the loop. Paid endpoints today:{" "}
          <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">GET /api/premium/price</code> ($0.001),{" "}
          <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">POST /api/oracle</code> ($0.005), and{" "}
          <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">GET /api/council/reasoning</code> ($0.001, paid
          directly to each persona&apos;s own wallet). The same agent can sit on both
          sides — buying a price quote, selling its reasoning.
        </Card>

        <DiagramFrame caption="x402 nanopayment flow. The payer (oracle) signs through W3S with no local key; the paid endpoint quotes a sub-cent price, Circle Gateway acts as facilitator, the transfer settles on Arc, and the receipt is recorded to Neon and shown live at /revenue.">
          <NanopaymentDiagram />
        </DiagramFrame>

        <Card title="Council-as-jury settlement">
          At settlement the oracle no longer decides alone. It <em>buys</em> each
          eligible council persona&apos;s verdict via an x402 nanopayment —{" "}
          <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">$0.001</code> straight to that persona&apos;s
          wallet through{" "}
          <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">GET /api/council/vote</code> — tallies the
          votes into the on-chain verdict, and commits the consensus tally into the
          claim&apos;s{" "}
          <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">evidenceHash</code>. A quorum (default three
          decisive votes) is required; below quorum it falls back to a solo oracle
          verdict. Rule-based personas abstain, and category specialists only vote
          inside their own category.
        </Card>

        <DiagramFrame caption="Council-as-jury settlement. At the deadline the oracle reads evidence, buys N persona verdicts over x402 ($0.001 → each persona wallet), tallies them (e.g. 7–2), and commits the consensus to evidenceHash before resolveClaim() pays out. Groq (Llama) backs the council through Gemini 429 windows; below quorum the oracle resolves solo.">
          <JuryDiagram />
        </DiagramFrame>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Subscription pass">
            One{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">POST /api/council/subscribe</code>{" "}
            nanopayment ($0.01) returns an HMAC-signed pass that unlocks a time-boxed
            window of free council reads — the recurring-access tier on top of the
            per-read x402 model.
          </Card>
          <Card title="Durable revenue ledger">
            Every settled nanopayment is recorded to Neon (the{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">x402_payments</code> table) and shown live
            at <Link href="/revenue" className="text-pv-emerald underline-offset-2 hover:underline">/revenue</Link>.
            Each receipt links to the paying agent&apos;s on-chain account and to the
            Circle Gateway Wallet settlement contract on ArcScan.
          </Card>
          <Card title="Gateway deposit via W3S">
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">approve</code> +{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">deposit</code> into Circle&apos;s Gateway
            Wallet, signed entirely through W3S — enabling gasless, batched payments
            with no local private key.
          </Card>
          <Card title="Pull-payment safety (contract v2)">
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">resolveClaim</code> payouts are pushed, but
            a failed push parks the amount in{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">pendingWithdrawals</code> (claimable via{" "}
            <code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">withdraw()</code>) instead of reverting the
            whole settlement — so one uncooperative recipient can&apos;t freeze
            everyone else&apos;s payout.
          </Card>
          <Card title="Multi-category markets">
            The market-creator now opens claims for crypto (CoinGecko), World Cup
            soccer and NBA (ESPN), stocks (stockanalysis.com), and weather — not just
            crypto.
          </Card>
          <Card title="Resilient LLM">
            Groq (Llama) is an always-on fallback so the council keeps voting through
            Gemini rate-limit (<code className="rounded bg-pv-surface2 px-1.5 py-0.5 text-xs">429</code>) windows.
          </Card>
        </div>

        <div className="rounded-2xl border border-pv-border/40 bg-pv-surface/70 p-5">
          <h3 className="mb-2 font-bold tracking-tight text-pv-text">Contracts</h3>
          <ul className="space-y-2 text-sm leading-relaxed text-pv-text/80">
            <li>
              <strong className="text-pv-text">v2 (live).</strong>{" "}
              <a
                className="break-all font-mono text-xs text-pv-emerald underline-offset-2 hover:underline"
                href="https://testnet.arcscan.app/address/0x50036154a3bc51f2e7d604a2fbc596f02bb555a1"
                target="_blank"
                rel="noreferrer"
              >
                0x50036154a3bc51f2e7d604a2fbc596f02bb555a1
              </a>
            </li>
            <li>
              <strong className="text-pv-text">v1 (legacy, immutable — 181 claims / 104 resolved).</strong>{" "}
              <a
                className="break-all font-mono text-xs text-pv-emerald underline-offset-2 hover:underline"
                href="https://testnet.arcscan.app/address/0x8c7016b1124983fb00dc022d88e3de997cdb5873"
                target="_blank"
                rel="noreferrer"
              >
                0x8c7016b1124983fb00dc022d88e3de997cdb5873
              </a>
            </li>
          </ul>
        </div>
      </Section>

      <Section id="contract" eyebrow="08" title="Smart contract terms">
        <p>
          A few terms that show up in the UI and on chain:
        </p>
        <div className="overflow-hidden rounded-2xl border border-pv-border/40">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-pv-surface/60 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                <th className="px-4 py-3">Term</th>
                <th className="px-4 py-3">What it means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pv-border/30">
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">creator</td><td className="px-4 py-3 align-top text-pv-text/85">The address that opened the claim and staked side A.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">challengerStake</td><td className="px-4 py-3 align-top text-pv-text/85">Sum of all side-B stakes (pool mode) or single counter-stake (1v1).</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">oddsMode</td><td className="px-4 py-3 align-top text-pv-text/85"><code className="rounded bg-pv-surface2 px-1 text-xs">pool</code> = pari-mutuel, <code className="rounded bg-pv-surface2 px-1 text-xs">fixed</code> = creator-backed multipliers.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">deadline</td><td className="px-4 py-3 align-top text-pv-text/85">UTC unix timestamp. After this the oracle can settle.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">winnerSide</td><td className="px-4 py-3 align-top text-pv-text/85"><code className="rounded bg-pv-surface2 px-1 text-xs">CREATOR</code>, <code className="rounded bg-pv-surface2 px-1 text-xs">CHALLENGERS</code>, <code className="rounded bg-pv-surface2 px-1 text-xs">DRAW</code> (refund), or <code className="rounded bg-pv-surface2 px-1 text-xs">UNRESOLVABLE</code> (refund).</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">evidenceHash</td><td className="px-4 py-3 align-top text-pv-text/85"><code className="rounded bg-pv-surface2 px-1 text-xs">keccak256</code> of the raw bytes the oracle fetched from the resolution URL.</td></tr>
              <tr><td className="px-4 py-3 align-top font-mono text-xs text-pv-emerald">confidence</td><td className="px-4 py-3 align-top text-pv-text/85">0–100. The LLM&apos;s self-assessed certainty for that verdict.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="play" eyebrow="09" title="How to play">
        <ol className="list-decimal space-y-3 pl-5 text-pv-text/85">
          <li>
            <strong className="text-pv-text">Get testnet USDC.</strong>{" "}
            <a className="text-pv-emerald underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com</a>{" "}
            on Arc Testnet, or use the <Link href="/bridge" className="text-pv-emerald underline">bridge</Link>{" "}
            to pull USDC over from Base/Eth/Avax Sepolia via CCTP V2.
          </li>
          <li>
            <strong className="text-pv-text">Connect your wallet.</strong>{" "}
            The site auto-switches you to Arc Testnet on connect and adds the
            chain if your wallet doesn&apos;t know it.
          </li>
          <li>
            <strong className="text-pv-text">Either create a claim or challenge one.</strong>{" "}
            Browse the <Link href="/explorer" className="text-pv-emerald underline">explorer</Link>{" "}
            for open markets, or open your own with{" "}
            <Link href="/vs/create" className="text-pv-emerald underline">/vs/create</Link>.
            Stake at least 2 USDC.
          </li>
          <li>
            <strong className="text-pv-text">Wait.</strong>{" "}
            At the deadline the oracle does its thing. You don&apos;t need to
            click anything — the contract pays out automatically.
          </li>
          <li>
            <strong className="text-pv-text">Check the receipt.</strong>{" "}
            The settlement card shows the verdict, the explanation, the evidence
            hash, and the on-chain tx.
          </li>
        </ol>
      </Section>

      <Section id="faq" eyebrow="10" title="FAQ">
        <div className="space-y-5">
          <Card title="Do I need MetaMask?">
            Any injected EVM wallet works (MetaMask, Coinbase Wallet, Rabby,
            Phantom EVM, etc.) plus WalletConnect. The frontend uses wagmi v3.
          </Card>
          <Card title="What if the LLM is wrong?">
            The verdict ships with a confidence number, the evidence URL, and a
            keccak256 hash of the raw page bytes. Anyone can verify the oracle
            wasn&apos;t hallucinating. Truly ambiguous claims resolve as{" "}
            <code className="rounded bg-pv-surface2 px-1 text-xs">UNRESOLVABLE</code>{" "}
            and refund — the protocol prefers refunding ambiguity to fabricating
            certainty.
          </Card>
          <Card title="Can the oracle be replaced?">
            The contract&apos;s <code className="rounded bg-pv-surface2 px-1 text-xs">oracle</code> address
            is set at deploy and changeable only by the owner. The deploy script
            transfers ownership to the market-creator W3S wallet immediately
            after deploy.
          </Card>
          <Card title="Is the agent betting against me?">
            Only with <code className="rounded bg-pv-surface2 px-1 text-xs">AUTO_CHALLENGE=1</code>{" "}
            enabled, and only when its own confidence on the contrarian side is
            ≥ 80%. Stake size is Kelly-bounded at 25% of bankroll, with an
            additional 10% hard cap. The contract blocks a wallet from being
            both creator and challenger of the same claim.
          </Card>
          <Card title="Mainnet?">
            Arc is testnet-only as of writing. The codebase is chain-config
            driven (see <code className="rounded bg-pv-surface2 px-1 text-xs">lib/arc.ts</code>) —
            a mainnet redeploy is mostly a single chain definition swap.
          </Card>
        </div>
      </Section>

      <footer className="border-t border-pv-border/30 pt-8 text-sm text-pv-muted">
        Got a question that isn&apos;t answered here?{" "}
        <a className="text-pv-emerald underline" href="https://github.com/enliven17/mimir/issues" target="_blank" rel="noreferrer">
          Open an issue on GitHub
        </a>
        .
      </footer>
      </article>
    </div>
  );
}
