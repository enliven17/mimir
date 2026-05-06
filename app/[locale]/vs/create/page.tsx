"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { motion } from "framer-motion";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useWallet } from "@/lib/wallet";
import {
  createClaim,
  createRematch,
  getVS,
  type CreateClaimParams,
  type VSData,
} from "@/lib/contract";
import { getExplorerTxUrl } from "@/lib/arc";
const getExplorerUrl = () => "https://testnet.arcscan.app";
import { removePendingVS, savePendingVS, type PendingVS } from "@/lib/pending-vs";
import { acquireTxLock } from "@/lib/tx-lock";
import {
  CATEGORIES,
  CATEGORY_GUIDANCE,
  DEADLINE_PRESET_IDS,
  DEADLINE_PRESET_SECONDS,
  MIN_STAKE,
  PREFILLS,
  getShareUrl,
  normalizeCategoryId,
  normalizeResolutionSource,
} from "@/lib/constants";
import type {
  SourceClaimDraftCandidate,
  SourceClaimDraftResponse,
} from "@/lib/claimDrafts";
import {
  generatePrivateInviteKey,
  rememberPrivateInviteKey,
} from "@/lib/private-links";
import {
  clearCreateMockSnapshot,
  MOCK_CONSENSUS_TX_HASH,
  MOCK_CREATE_DEMO_QUERY,
  MOCK_CREATED_VS_ID,
  MOCK_DEMO_CREATOR_ADDRESS,
  MOCK_WALLET_TX_HASH,
  writeCreateMockSnapshot,
} from "@/lib/mockVsCreate";
import { toast } from "sonner";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { GlassCard, Button, Input, ListboxField } from "@/components/ui";
import ClaimStrengthCard from "@/components/ClaimStrengthCard";
import CreateChallengeTicket from "@/components/vs/CreateChallengeTicket";
import CreateMockFundingOverlay, {
  type CreateMockOverlayPhase,
} from "@/components/vs/CreateMockFundingOverlay";
import Confetti from "@/components/Confetti";
import { sealStamp } from "@/lib/animations/rituals";
import {
  Check,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  Eye,
  FileEdit,
  FlaskConical,
  GitBranch,
  Link2,
  SlidersHorizontal,
  User,
  Users,
  Wand2,
  Zap,
} from "lucide-react";

const MARKET_TYPES = ["binary", "moneyline", "custom"] as const;

function normalizeSupportedMarketType(value: string): (typeof MARKET_TYPES)[number] {
  return MARKET_TYPES.includes(value as (typeof MARKET_TYPES)[number])
    ? (value as (typeof MARKET_TYPES)[number])
    : "binary";
}

const VISIBILITY_TOGGLE_OPTIONS = [
  { key: "public" as const, labelKey: "visibilityPublic" as const },
  { key: "private" as const, labelKey: "visibilityPrivate" as const },
];

const STAKE_PRESET_AMOUNTS = [MIN_STAKE, 5, 10, 25] as const;
const SOURCE_DRAFTS_ENABLED = process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS === "1";
const CLAIM_MODERATION_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_CLAIM_MODERATION === "1";

function isPresetStakeAmount(value: number): boolean {
  return (STAKE_PRESET_AMOUNTS as readonly number[]).includes(value);
}

type ChallengeExampleRow = {
  question: string;
  creator: string;
  opponent: string;
};

function parseChallengeExamples(raw: unknown): ChallengeExampleRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ChallengeExampleRow[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      "question" in item &&
      "creator" in item &&
      "opponent" in item
    ) {
      const row = item as Record<string, unknown>;
      if (
        typeof row.question === "string" &&
        typeof row.creator === "string" &&
        typeof row.opponent === "string"
      ) {
        out.push({
          question: row.question,
          creator: row.creator,
          opponent: row.opponent,
        });
      }
    }
  }
  return out;
}

function formatLocalDateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatLocalTimeInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
}

function normalizeQuestionForOutcomeDraft(value: string): string {
  return value
    .replace(/[¿¡]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[?!]+$/g, "")
    .trim();
}

function capitalizeDraftText(value: string): string {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function inferDoSupport(subject: string): "do" | "does" {
  const normalized = subject.trim().toLowerCase();
  if (!normalized) {
    return "does";
  }
  if (/^(i|you|we|they)$/i.test(normalized)) {
    return "do";
  }
  if (/\band\b/.test(normalized)) {
    return "do";
  }
  return "does";
}

function toThirdPersonSingular(verb: string): string {
  if (!verb) {
    return verb;
  }
  const lower = verb.toLowerCase();
  if (/(s|sh|ch|x|z|o)$/.test(lower)) {
    return `${verb}es`;
  }
  if (/[bcdfghjklmnpqrstvwxyz]y$/.test(lower)) {
    return `${verb.slice(0, -1)}ies`;
  }
  return `${verb}s`;
}

function splitSubjectAndPredicate(clause: string): { subject: string; predicate: string } | null {
  const tokens = clause.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  if (/^(it|there|he|she|they|we|you|i)$/i.test(tokens[0] ?? "")) {
    return {
      subject: tokens[0]!,
      predicate: tokens.slice(1).join(" "),
    };
  }

  let subjectEnd = 1;
  if (/^(the|a|an|el|la|los|las|un|una)$/i.test(tokens[0] ?? "") && tokens.length >= 3) {
    subjectEnd = 2;
  }

  while (subjectEnd < tokens.length - 1) {
    const token = tokens[subjectEnd] ?? "";
    if (/^[A-Z0-9]/.test(token) || /^(of|the|de|del|la|el|los|las|and|y)$/i.test(token)) {
      subjectEnd += 1;
      continue;
    }
    break;
  }

  return {
    subject: tokens.slice(0, subjectEnd).join(" "),
    predicate: tokens.slice(subjectEnd).join(" "),
  };
}

function buildAuxiliaryOutcomePair(
  clause: string,
  auxiliary: string
): { creator: string; opponent: string } | null {
  const split = splitSubjectAndPredicate(clause);
  if (!split) {
    return null;
  }

  const subject = capitalizeDraftText(split.subject);
  const predicate = split.predicate.trim();
  if (!predicate) {
    return null;
  }

  return {
    creator: `${subject} ${auxiliary} ${predicate}`,
    opponent: `${subject} ${auxiliary} not ${predicate}`,
  };
}

function buildWeatherOutcomePair(clause: string): { creator: string; opponent: string } | null {
  const normalized = clause
    .trim()
    .replace(/^it\s+/i, "")
    .replace(/^there\s+(?:will\s+be\s+)?/i, "");
  const weatherMatch = normalized.match(
    /^(rain|snow|hail|drizzle|showers?|thunderstorms?|storm|fog|wind)\b(.*)$/i
  );
  if (!weatherMatch) {
    return null;
  }

  const phenomenon = weatherMatch[1]!.toLowerCase();
  const tail = weatherMatch[2]!.trim();
  const suffix = tail ? ` ${tail}` : "";
  return {
    creator: `${capitalizeDraftText(phenomenon)}${suffix}`,
    opponent: `No ${phenomenon}${suffix}`,
  };
}

const EVENT_VERB_NOUNS: Record<string, string> = {
  announce: "announcement",
  publish: "publication",
  release: "release",
  launch: "launch",
  list: "listing",
  approve: "approval",
  confirm: "confirmation",
  unveil: "announcement",
  file: "filing",
  report: "report",
};

const EVENT_NOUN_HINTS = [
  "announcement",
  "release",
  "launch",
  "listing",
  "approval",
  "report",
  "filing",
  "publication",
  "post",
  "update",
] as const;

function splitTemporalTail(value: string): { core: string; tail: string } {
  const match = value.match(
    /\s+(before|by|on|at|during|this|next|after|ahead of)\b[\s\S]*$/i
  );
  if (!match || typeof match.index !== "number") {
    return { core: value.trim(), tail: "" };
  }

  return {
    core: value.slice(0, match.index).trim(),
    tail: value.slice(match.index).trim(),
  };
}

function trimLeadingArticle(value: string): string {
  return value.replace(/^(a|an|the)\s+/i, "").trim();
}

function buildEventOutcomePair(clause: string): { creator: string; opponent: string } | null {
  const split = splitSubjectAndPredicate(clause);
  if (!split) {
    return null;
  }

  const subject = capitalizeDraftText(split.subject);
  const predicate = split.predicate.trim();
  if (!predicate) {
    return null;
  }

  const [verb = "", ...restWords] = predicate.split(/\s+/);
  const eventNoun = EVENT_VERB_NOUNS[verb.toLowerCase()];
  if (!eventNoun) {
    return null;
  }

  const rest = restWords.join(" ").trim();
  if (!rest) {
    return null;
  }

  const { core, tail } = splitTemporalTail(rest);
  const cleanCore = trimLeadingArticle(core);
  const creator = `${subject} ${toThirdPersonSingular(verb)} ${rest}`;

  const alreadyHasEventNoun = EVENT_NOUN_HINTS.some((hint) =>
    cleanCore.toLowerCase().includes(hint)
  );
  const opponentCore = alreadyHasEventNoun
    ? cleanCore
    : `${cleanCore} ${eventNoun}`.trim();
  const opponent = `No ${opponentCore}${tail ? ` ${tail}` : ""}`;

  return {
    creator,
    opponent,
  };
}

function buildBareVerbOutcomePair(clause: string): { creator: string; opponent: string } | null {
  const split = splitSubjectAndPredicate(clause);
  if (!split) {
    return null;
  }

  const subject = capitalizeDraftText(split.subject);
  const predicate = split.predicate.trim();
  if (!predicate) {
    return null;
  }

  const [verb = "", ...restWords] = predicate.split(/\s+/);
  if (!verb) {
    return null;
  }

  const rest = restWords.join(" ").trim();
  const doSupport = inferDoSupport(split.subject);
  const positiveVerb = doSupport === "does" ? toThirdPersonSingular(verb) : verb;
  const suffix = rest ? ` ${rest}` : "";
  return {
    creator: `${subject} ${positiveVerb}${suffix}`,
    opponent: `${subject} ${doSupport} not ${verb}${suffix}`,
  };
}

function draftOutcomeSidesFromQuestion(
  question: string,
  locale: string
): { creator: string; opponent: string } | null {
  const normalized = normalizeQuestionForOutcomeDraft(question);
  if (!normalized) {
    return null;
  }

  const statementMatch = normalized.match(
    /^(.+?)\s+(will|is|are|can|has|have)\s+(.+)$/i
  );
  if (statementMatch) {
    const [, subject = "", auxiliary = "", predicate = ""] = statementMatch;
    const clause = `${subject.trim()} ${predicate.trim()}`.trim();
    const weatherDraft = buildWeatherOutcomePair(clause);
    if (weatherDraft) {
      return weatherDraft;
    }
    if (auxiliary.toLowerCase() === "will") {
      const eventDraft = buildEventOutcomePair(clause);
      if (eventDraft) {
        return eventDraft;
      }
      const bareVerbDraft = buildBareVerbOutcomePair(clause);
      if (bareVerbDraft) {
        return bareVerbDraft;
      }
    }
    return {
      creator: `${capitalizeDraftText(subject.trim())} ${auxiliary.toLowerCase()} ${predicate.trim()}`,
      opponent: `${capitalizeDraftText(subject.trim())} ${auxiliary.toLowerCase()} not ${predicate.trim()}`,
    };
  }

  const leadingAuxiliaryMatch = normalized.match(/^(will|is|are|can|has|have)\s+(.+)$/i);
  if (leadingAuxiliaryMatch) {
    const [, auxiliary = "", clause = ""] = leadingAuxiliaryMatch;
    const weatherDraft = buildWeatherOutcomePair(clause.trim());
    if (weatherDraft) {
      return weatherDraft;
    }
    if (auxiliary.toLowerCase() === "will") {
      const eventDraft = buildEventOutcomePair(clause.trim());
      if (eventDraft) {
        return eventDraft;
      }
      const bareVerbDraft = buildBareVerbOutcomePair(clause.trim());
      if (bareVerbDraft) {
        return bareVerbDraft;
      }
    }
    const drafted = buildAuxiliaryOutcomePair(clause.trim(), auxiliary.toLowerCase());
    if (drafted) {
      return drafted;
    }
  }

  const yesPrefix = locale.startsWith("es") ? "Si - " : "Yes - ";
  const noPrefix = "No - ";
  const normalizedStatement = capitalizeDraftText(normalized);
  return {
    creator: `${yesPrefix}${normalizedStatement}`,
    opponent: `${noPrefix}${normalizedStatement}`,
  };
}

export default function CreatePage() {
  const router = useRouter();
  const pathname = usePathname();
  const { address, isConnected, connect } = useWallet();
  const t = useTranslations("create");
  const tc = useTranslations("common");
  const tQuality = useTranslations("quality");
  const tCat = useTranslations("categories");
  const tVsDetail = useTranslations("vsDetail");
  const locale = useLocale();
  const DEADLINE_PRESETS = useMemo(
    () =>
      DEADLINE_PRESET_IDS.map((id) => ({
        id,
        seconds: DEADLINE_PRESET_SECONDS[id],
        label: t(`presets.${id}`),
      })),
    [t],
  );
  const messages = useMessages();
  const challengeFieldUid = useId().replace(/:/g, "");
  const challengeQuestionHeadingId = `create-challenge-heading-${challengeFieldUid}`;
  const challengeQuestionFieldId = `create-challenge-q-${challengeFieldUid}`;
  const [challengePlaceholder, setChallengePlaceholder] = useState("");
  const [creatorPosPlaceholder, setCreatorPosPlaceholder] = useState("");
  const [opponentPosPlaceholder, setOpponentPosPlaceholder] = useState("");

  const [question, setQuestion] = useState("");
  const [creatorPos, setCreatorPos] = useState("");
  const [opponentPos, setOpponentPos] = useState("");
  const [url, setUrl] = useState("");
  const [deadlinePreset, setDeadlinePreset] = useState<number | null>(null);
  const [customDeadlineDate, setCustomDeadlineDate] = useState("");
  const [customDeadlineTime, setCustomDeadlineTime] = useState("");
  /** Solo en cliente: evita hydration mismatch (servidor vs zona horaria local). */
  const [minCustomDeadlineDate, setMinCustomDeadlineDate] = useState<
    string | undefined
  >(undefined);
  const [stake, setStake] = useState(5);
  const [customStakeDraft, setCustomStakeDraft] = useState("");
  const [customStakeFocused, setCustomStakeFocused] = useState(false);
  const [category, setCategory] = useState("custom");
  const [marketType, setMarketType] = useState<string>("binary");
  const [settlementRule, setSettlementRule] = useState("");
  const [, setMaxChallengers] = useState(1);
  /** Texto del 4º slot (custom); vacío cuando el valor coincide con preset 1/2/5 para mostrar placeholder "–". */
  const [, setMaxChallengersSlotDraft] = useState("");
  const [visibility, setVisibility] =
    useState<CreateClaimParams["visibility"]>("public");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sourceDraftOpen, setSourceDraftOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingParent, setLoadingParent] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const [createdPending, setCreatedPending] = useState(false);
  const [createdTxHash, setCreatedTxHash] = useState("");
  const [createdExplorerTxHash, setCreatedExplorerTxHash] = useState("");
  const [createdInviteKey, setCreatedInviteKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSealStamp, setShowSealStamp] = useState(false);
  const [draftResult, setDraftResult] = useState<SourceClaimDraftResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [lastDraftedUrl, setLastDraftedUrl] = useState("");
  const [sourceSeedUrl, setSourceSeedUrl] = useState("");
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationMessageKey, setModerationMessageKey] = useState("");
  const [moderationDecision, setModerationDecision] = useState<
    "allow" | "review" | "block" | ""
  >("");
  const [moderationCodes, setModerationCodes] = useState<string[]>([]);
  const [moderationConfidence, setModerationConfidence] = useState<number>(0);
  const [moderationCheckedAtMs, setModerationCheckedAtMs] = useState(0);
  const [moderationCooldownUntilMs, setModerationCooldownUntilMs] = useState(0);
  const [moderationAttempted, setModerationAttempted] = useState(false);
  const lastModerationKeyRef = useRef("");
  const [isApplyingDraft, startApplyingDraft] = useTransition();
  const [rematchSource, setRematchSource] = useState<VSData | null>(null);
  const [hydratedFromRematch, setHydratedFromRematch] = useState(false);
  const [rematchId, setRematchId] = useState<number | null>(null);
  const [isCreateDemoUrl, setIsCreateDemoUrl] = useState(false);
  const [mockOverlayPhase, setMockOverlayPhase] =
    useState<CreateMockOverlayPhase>("closed");
  const mockFlowTimersRef = useRef<number[]>([]);
  /** `/vs/create?demo=1`: flujo sin wallet ni contrato (no compatible con rematch). */
  const isCreateDemoSession = isCreateDemoUrl && rematchId === null;
  const ticketWalletAddress =
    isCreateDemoSession && !address ? MOCK_DEMO_CREATOR_ADDRESS : address;
  /** Evita mismatch de hidratación: fechas relativas y `min` del input dependen de zona horaria y del reloj del cliente. */
  const categoryGuidance =
    CATEGORY_GUIDANCE[category as keyof typeof CATEGORY_GUIDANCE] ??
    CATEGORY_GUIDANCE.custom;
  const guidanceKey =
    category in CATEGORY_GUIDANCE ? category : "custom";
  const recommendedSettlementTemplate = t(
    `guidance.${guidanceKey}.settlementTemplate`,
  );
  const settlementMatchesRecommended =
    settlementRule.trim() === recommendedSettlementTemplate.trim();
  const ticketSettlementPreview =
    settlementRule.trim() || recommendedSettlementTemplate;
  const ticketDraftId = useMemo(() => {
    const s = `${question}|${creatorPos}|${stake}|${marketType}|pool`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const n = Math.abs(h);
    const part = (n % 0xffff).toString(16).toUpperCase().padStart(4, "0");
    const suffix = String.fromCharCode(65 + (n % 26));
    return `PRV-${part}-${suffix}`;
  }, [question, creatorPos, stake, marketType]);
  const verificationQuestionHint = t(
    `guidance.${guidanceKey}.questionHint`,
  );
  const isOneToMany = false;
  const isPrivate = visibility === "private";
  const presetStakeHighlight =
    isPresetStakeAmount(stake) &&
    !customStakeFocused &&
    customStakeDraft.trim() === "";
  const customDeadline = useMemo(() => {
    if (!customDeadlineDate || !customDeadlineTime) {
      return "";
    }
    return `${customDeadlineDate}T${customDeadlineTime}`;
  }, [customDeadlineDate, customDeadlineTime]);

  useEffect(() => {
    setMinCustomDeadlineDate(formatLocalDateInputValue(new Date()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const q = new URL(window.location.href).searchParams;
    setIsCreateDemoUrl(q.get(MOCK_CREATE_DEMO_QUERY) === "1");
  }, []);

  useEffect(() => {
    return () => {
      mockFlowTimersRef.current.forEach((id) => window.clearTimeout(id));
      mockFlowTimersRef.current = [];
    };
  }, []);

  /**
   * Al pasar del formulario largo a la vista de éxito, la página se acorta pero el
   * `scrollY` se mantiene: se ve el contenido “desde abajo” y luego un salto al subir.
   * `useLayoutEffect` aplica antes del pintado; `router.replace(..., { scroll: false })`
   * evita un segundo ajuste del App Router.
   */
  useLayoutEffect(() => {
    if (created === null) {
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [created]);

  /** `min` en type="date" no puede calcularse en SSR: servidor vs navegador = distinto día calendario → hydration mismatch. */
  const [customDateInputMin, setCustomDateInputMin] = useState<
    string | undefined
  >(undefined);
  useLayoutEffect(() => {
    setCustomDateInputMin(formatLocalDateInputValue(new Date()));
  }, []);

  function applyDeadlinePreset(seconds: number) {
    const presetDate = new Date(Date.now() + seconds * 1000);
    setDeadlinePreset(seconds);
    setCustomDeadlineDate(formatLocalDateInputValue(presetDate));
    setCustomDeadlineTime(formatLocalTimeInputValue(presetDate));
  }

  useEffect(() => {
    if (isPresetStakeAmount(stake)) {
      setCustomStakeDraft("");
    } else {
      setCustomStakeDraft(String(stake));
    }
  }, [stake]);

  const normalizedSourceUrl = useMemo(() => normalizeResolutionSource(url), [url]);
  useEffect(() => {
    if (!lastDraftedUrl) {
      return;
    }

    if (!normalizedSourceUrl || normalizedSourceUrl !== lastDraftedUrl) {
      setDraftResult(null);
      setDraftError("");
    }
  }, [lastDraftedUrl, normalizedSourceUrl]);
  const requiresExplicitSettlementRule =
    category === "custom" || marketType !== "binary";
  const questionNeedsWork =
    question.trim().length > 0 && question.trim().length < 24;
  const sourceNeedsWork =
    url.trim().length > 0 && normalizedSourceUrl.length === 0;
  const settlementNeedsWork =
    requiresExplicitSettlementRule &&
    settlementRule.trim().length < 16;
  const claimStrengthInput = useMemo(
    () => {
      const deadlineTs = customDeadline
        ? Math.floor(new Date(customDeadline).getTime() / 1000)
        : 0;

      return {
        question,
        creator_position: creatorPos,
        opponent_position: opponentPos,
        resolution_url: url,
        settlement_rule: settlementRule,
        category,
        deadline: Number.isFinite(deadlineTs) ? deadlineTs : 0,
      };
    },
    [category, creatorPos, customDeadline, opponentPos, question, settlementRule, url]
  );

  function autofillOutcomeSidesFromQuestion() {
    const drafted = draftOutcomeSidesFromQuestion(question, locale);
    if (!drafted) {
      toast.error(t("outcomeAutofillNeedsQuestion"));
      return;
    }

    setCreatorPos(drafted.creator);
    setOpponentPos(drafted.opponent);
    toast.success(t("outcomeAutofillApplied"));
  }

  const moderationKey = useMemo(() => {
    const parts = [
      question.trim(),
      creatorPos.trim(),
      opponentPos.trim(),
      category.trim(),
      settlementRule.trim(),
      normalizedSourceUrl.trim(),
    ];
    return parts.join("|");
  }, [
    category,
    creatorPos,
    normalizedSourceUrl,
    opponentPos,
    question,
    settlementRule,
  ]);

  const moderationInputReady = useMemo(() => {
    return (
      question.trim().length > 0 &&
      creatorPos.trim().length > 0 &&
      opponentPos.trim().length > 0 &&
      category.trim().length > 0 &&
      settlementRule.trim().length > 0 &&
      normalizedSourceUrl.trim().length > 0
    );
  }, [category, creatorPos, normalizedSourceUrl, opponentPos, question, settlementRule]);

  const isModerationApproved = useMemo(() => {
    if (!CLAIM_MODERATION_ENABLED) {
      return true;
    }
    return moderationDecision === "allow";
  }, [moderationDecision]);

  useEffect(() => {
    if (!CLAIM_MODERATION_ENABLED) {
      return;
    }
    if (!moderationAttempted) {
      return;
    }
    if (moderationLoading) {
      return;
    }
    if (!lastModerationKeyRef.current) {
      return;
    }
    if (moderationKey === lastModerationKeyRef.current) {
      return;
    }
    setModerationLoading(false);
    setModerationDecision("");
    setModerationMessageKey("");
    setModerationCodes([]);
    setModerationConfidence(0);
    setModerationCheckedAtMs(0);
    setModerationCooldownUntilMs(0);
    setModerationAttempted(false);
  }, [moderationAttempted, moderationKey, moderationLoading]);

  useEffect(() => {
    if (!CLAIM_MODERATION_ENABLED) {
      return;
    }
    if (!moderationCooldownUntilMs || Date.now() >= moderationCooldownUntilMs) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const remaining = moderationCooldownUntilMs - Date.now();
      if (remaining <= 0) {
        window.clearInterval(intervalId);
        setModerationMessageKey("rate_limited:0");
        return;
      }
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      setModerationMessageKey(`rate_limited:${seconds}`);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [moderationCooldownUntilMs]);

  const lastRecommendedTemplateRef = useRef(recommendedSettlementTemplate);
  const initializedRecommendedTemplateRef = useRef(false);

  useEffect(() => {
    const previousTemplate = lastRecommendedTemplateRef.current.trim();
    const nextTemplate = recommendedSettlementTemplate.trim();

    if (!initializedRecommendedTemplateRef.current) {
      initializedRecommendedTemplateRef.current = true;
      lastRecommendedTemplateRef.current = nextTemplate;
      return;
    }

    setSettlementRule((current) => {
      const trimmed = current.trim();
      if (!trimmed || trimmed === previousTemplate) {
        return nextTemplate;
      }
      return current;
    });

    lastRecommendedTemplateRef.current = nextTemplate;
  }, [recommendedSettlementTemplate]);

  useLayoutEffect(() => {
    const raw = (
      messages.create as { challengeQuestionExamples?: unknown }
    ).challengeQuestionExamples;
    const list = parseChallengeExamples(raw);
    if (list.length === 0) {
      setChallengePlaceholder("");
      setCreatorPosPlaceholder("");
      setOpponentPosPlaceholder("");
      return;
    }
    const picked = list[Math.floor(Math.random() * list.length)]!;
    setChallengePlaceholder(picked.question);
    setCreatorPosPlaceholder(picked.creator);
    setOpponentPosPlaceholder(picked.opponent);
  }, [locale, messages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const searchParams = new URL(window.location.href).searchParams;
    const rawRematchId = Number(searchParams.get("rematch") ?? "");
    const rawSourceUrl = searchParams.get("source") ?? "";
    setRematchId(Number.isInteger(rawRematchId) && rawRematchId > 0 ? rawRematchId : null);
    const normalizedSourceSeed = normalizeResolutionSource(rawSourceUrl);
    if (normalizedSourceSeed) {
      setUrl(normalizedSourceSeed);
      setSourceSeedUrl(normalizedSourceSeed);
      setSourceDraftOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!rematchId || hydratedFromRematch) {
      return;
    }

    let cancelled = false;
    const currentRematchId = rematchId;

    async function loadRematchSource() {
      setLoadingParent(true);
      const source = await getVS(currentRematchId);
      if (cancelled) {
        return;
      }

      if (!source) {
        toast.error(t("rematchNotFound"));
        setLoadingParent(false);
        return;
      }

      setRematchSource(source);
      setQuestion(source.question);
      setCreatorPos(source.creator_position);
      setOpponentPos(source.counter_position ?? source.opponent_position);
      setUrl(source.resolution_url);
      setStake(source.creator_stake ?? source.stake_amount);
      const normalizedRematchMarketType = normalizeSupportedMarketType(
        source.market_type ?? "binary"
      );
      setCategory(normalizeCategoryId(source.category || "custom"));
      setMarketType(normalizedRematchMarketType);
      setSettlementRule(source.settlement_rule ?? "");
      setVisibility(source.is_private ? "private" : "public");
      setMaxChallengers(1);
      setMaxChallengersSlotDraft("");
      setAdvancedOpen(
        normalizedRematchMarketType !== "binary" ||
          Boolean(source.settlement_rule)
      );
      setHydratedFromRematch(true);
      setLoadingParent(false);
    }

    loadRematchSource();

    return () => {
      cancelled = true;
    };
  }, [hydratedFromRematch, rematchId, t]);

  useEffect(() => {
    if (!created || !createdPending || created < 0) {
      return;
    }

    const createdId = created;
    let cancelled = false;

    async function syncCreatedClaim() {
      const liveClaim = await getVS(createdId, {
        inviteKey: createdInviteKey,
        viewerAddress: address ?? undefined,
      }).catch(() => null);

      if (cancelled || !liveClaim) {
        return;
      }

      removePendingVS(createdId);
      setCreatedPending(false);
      setShowSealStamp(true);
      toast.success(
        rematchId ? t("createSuccessHeadlineRematch") : t("createSuccessHeadline"),
      );
      setTimeout(() => setShowSealStamp(false), 4000);
      setShowSealStamp(true);
      toast.success(rematchId ? t("rematchCreatedAndFunded") : t("vsCreatedAndFunded"));
      setTimeout(() => setShowSealStamp(false), 4000);
    }

    void syncCreatedClaim();
    const intervalId = setInterval(syncCreatedClaim, 8000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [address, created, createdInviteKey, createdPending, rematchId, t]);

  function prefill(catId: string) {
    const normalizedCategory = normalizeCategoryId(catId);
    setCategory(normalizedCategory);
    const prefillValues = PREFILLS[normalizedCategory];
    if (prefillValues) {
      setQuestion(prefillValues.q);
      setCreatorPos(prefillValues.a);
      setOpponentPos(prefillValues.b);
      setUrl(prefillValues.u);
    }
  }

  const requestSourceDrafts = useCallback(async (sourceUrl: string) => {
    setDraftLoading(true);
    setDraftError("");
    setDraftResult(null);

    try {
      const response = await fetch("/api/claim-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: sourceUrl,
          locale,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | SourceClaimDraftResponse
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        const errorMessage =
          payload && "error" in payload ? payload.error?.message : undefined;
        throw new Error(errorMessage || t("sourceDraftFailed"));
      }

      const result = payload as SourceClaimDraftResponse;
      setDraftResult(result);
      setLastDraftedUrl(result.sourceUrl);
      toast.success(t("sourceDraftReady", { count: result.candidates.length }));
    } catch (err: any) {
      const message = err?.message || t("sourceDraftFailed");
      setDraftError(message);
      toast.error(message);
    } finally {
      setDraftLoading(false);
    }
  }, [locale, t]);

  async function handleGenerateFromSource() {
    if (!normalizedSourceUrl) {
      toast.error(t("sourceDraftInvalidUrl"));
      return;
    }

    await requestSourceDrafts(normalizedSourceUrl);
  }

  function applySourceDraft(candidate: SourceClaimDraftCandidate) {
    startApplyingDraft(() => {
      setQuestion(candidate.claimText);
      setCreatorPos(candidate.sideA);
      setOpponentPos(candidate.sideB);
      setUrl(candidate.primaryResolutionSource);
      setCategory(normalizeCategoryId(candidate.category));
      setMarketType("binary");
      setSettlementRule(candidate.settlementRule);
      setMaxChallengers(1);
      setMaxChallengersSlotDraft("");
      setAdvancedOpen(Boolean(candidate.settlementRule.trim()));
      setDeadlinePreset(null);

      const suggestedDeadline = new Date(candidate.deadlineAt);
      if (Number.isFinite(suggestedDeadline.getTime())) {
        setCustomDeadlineDate(formatLocalDateInputValue(suggestedDeadline));
        setCustomDeadlineTime(formatLocalTimeInputValue(suggestedDeadline));
      }

      setLastDraftedUrl(candidate.primaryResolutionSource);
    });

    toast.success(t("sourceDraftApplied"));
  }

  useEffect(() => {
    if (!SOURCE_DRAFTS_ENABLED || !sourceSeedUrl) {
      return;
    }

    void requestSourceDrafts(sourceSeedUrl);
    setSourceSeedUrl("");
  }, [requestSourceDrafts, sourceSeedUrl]);

  const runClaimModeration = useCallback(async (): Promise<boolean> => {
    if (!CLAIM_MODERATION_ENABLED) {
      return true;
    }

    if (!moderationInputReady) {
      setModerationLoading(false);
      setModerationMessageKey("");
      setModerationDecision("");
      setModerationCodes([]);
      setModerationConfidence(0);
      setModerationCheckedAtMs(0);
      setModerationAttempted(false);
      lastModerationKeyRef.current = "";
      return true;
    }

    if (moderationCooldownUntilMs && Date.now() < moderationCooldownUntilMs) {
      const seconds = Math.max(
        1,
        Math.ceil((moderationCooldownUntilMs - Date.now()) / 1000)
      );
      setModerationDecision("review");
      setModerationMessageKey(`rate_limited:${seconds}`);
      return false;
    }

    if (moderationKey === lastModerationKeyRef.current && moderationDecision) {
      return moderationDecision === "allow";
    }

    setModerationLoading(true);
    setModerationMessageKey("");
    setModerationCodes([]);
    setModerationConfidence(0);
    setModerationCheckedAtMs(0);
    setModerationAttempted(true);

    try {
      const response = await fetch("/api/claim-moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          input: {
            question,
            creator_position: creatorPos,
            opponent_position: opponentPos,
            category,
            settlement_rule: settlementRule.trim(),
            resolution_url: normalizedSourceUrl,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            decision?: "allow" | "review" | "block";
            violationCodes?: string[];
          confidence?: number;
          }
        | { error?: { message?: string } }
        | null;

      if (response.status === 429) {
        const retryAfter = Number.parseInt(
          response.headers.get("retry-after") || "",
          10
        );
        const seconds =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 35;
        setModerationDecision("review");
        setModerationCooldownUntilMs(Date.now() + seconds * 1000);
        setModerationMessageKey(`rate_limited:${seconds}`);
        lastModerationKeyRef.current = moderationKey;
        return false;
      }

      if (!response.ok) {
        toast.error(t("moderationCheckFailed"));
        setModerationDecision("");
        lastModerationKeyRef.current = "";
        return false;
      }

      const decision =
        payload && "decision" in payload ? payload.decision ?? "review" : "review";
      const codes =
        payload && "violationCodes" in payload && Array.isArray(payload.violationCodes)
          ? payload.violationCodes
          : [];
      const confidence =
        payload && "confidence" in payload && typeof payload.confidence === "number"
          ? payload.confidence
          : 0;
      const topCode = typeof codes[0] === "string" ? codes[0] : "";

      lastModerationKeyRef.current = moderationKey;
      setModerationDecision(decision);
      setModerationCodes(codes as string[]);
      setModerationConfidence(confidence);
      setModerationCheckedAtMs(Date.now());
      const msgKey =
        decision === "review"
          ? topCode || "review"
          : decision === "block"
            ? topCode || "other_policy"
            : "";
      setModerationMessageKey(msgKey);

      const codeLabels = (codes as string[])
        .map((code) => {
          try {
            return tQuality(`moderationBlockedByCode.${code}` as never);
          } catch {
            return code;
          }
        })
        .filter(Boolean);
      const codesLabel =
        codeLabels.length > 0 ? ` (${codeLabels.join(", ")})` : "";

      if (decision === "block") {
        toast.error(t("moderationBlocked", { codesLabel }));
        return false;
      }
      if (decision === "review") {
        toast.error(t("moderationNeedsReview", { codesLabel }));
        return false;
      }
      return true;
    } catch {
      toast.error(t("moderationCheckFailed"));
      lastModerationKeyRef.current = "";
      setModerationDecision("");
      return false;
    } finally {
      setModerationLoading(false);
    }
  }, [
    category,
    creatorPos,
    locale,
    moderationCooldownUntilMs,
    moderationDecision,
    moderationCodes,
    moderationConfidence,
    moderationCheckedAtMs,
    moderationInputReady,
    moderationKey,
    normalizedSourceUrl,
    opponentPos,
    question,
    settlementRule,
    t,
    tQuality,
  ]);

  async function handleSubmit() {
    if (!question || !creatorPos || !opponentPos) {
      toast.error(t("fillAllFields"));
      return;
    }

    const isDemoCreate = isCreateDemoSession;

    if (!isDemoCreate && (!isConnected || !address)) {
      toast.error(t("connectWalletFirst"));
      return;
    }

    if (!Number.isFinite(stake) || stake < MIN_STAKE) {
      toast.error(t("invalidStakeMin", { amount: MIN_STAKE }));
      return;
    }

    if (!customDeadline) {
      toast.error(t("completeExactDeadline"));
      return;
    }

    const deadlineTimestamp = Math.floor(new Date(customDeadline).getTime() / 1000);

    if (!Number.isFinite(deadlineTimestamp) || deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
      toast.error(t("invalidDeadline"));
      return;
    }

    const normalizedMarketType = normalizeSupportedMarketType(marketType);
    const normalizedOddsMode = "pool";

    if (!normalizedSourceUrl) {
      toast.error(t("sourceRequired"));
      return;
    }

    if (requiresExplicitSettlementRule && settlementRule.trim().length < 16) {
      toast.error(t("settlementRuleRequired"));
      return;
    }

    const normalizedMaxChallengers = 1;
    const inviteKey = isPrivate ? generatePrivateInviteKey() : "";
    const params: CreateClaimParams = {
      question,
      creator_position: creatorPos,
      counter_position: opponentPos,
      resolution_url: normalizedSourceUrl,
      deadline: deadlineTimestamp,
      stake_amount: stake,
      category,
      market_type: normalizedMarketType,
      odds_mode: normalizedOddsMode,
      challenger_payout_bps: 0,
      handicap_line: "",
      settlement_rule: settlementRule.trim(),
      max_challengers: normalizedMaxChallengers,
      visibility,
      invite_key: inviteKey,
    };

    if (CLAIM_MODERATION_ENABLED) {
      const moderationOk = await runClaimModeration();
      if (!moderationOk) {
        return;
      }
    }

    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = acquireTxLock(address ?? MOCK_DEMO_CREATOR_ADDRESS);
    } catch (lockErr: any) {
      toast.error(lockErr.message);
      return;
    }

    if (isDemoCreate) {
      mockFlowTimersRef.current.forEach((id) => window.clearTimeout(id));
      mockFlowTimersRef.current = [];

      const creatorAddr = address ?? MOCK_DEMO_CREATOR_ADDRESS;
      setMockOverlayPhase("loading");

      const tLoad = window.setTimeout(() => {
        setMockOverlayPhase("success");
      }, 1500);
      mockFlowTimersRef.current.push(tLoad);

      const tDone = window.setTimeout(() => {
        writeCreateMockSnapshot({
          version: 1,
          vsId: MOCK_CREATED_VS_ID,
          inviteKey,
          creator: creatorAddr,
          vs: {
            question,
            creator_position: creatorPos,
            opponent_position: opponentPos,
            resolution_url: normalizedSourceUrl,
            stake_amount: stake,
            deadline: deadlineTimestamp,
            created_at: Math.floor(Date.now() / 1000),
            category,
            market_type: normalizedMarketType,
            odds_mode: normalizedOddsMode,
            max_challengers: normalizedMaxChallengers,
            is_private: isPrivate,
            settlement_rule: settlementRule.trim(),
            handicap_line: "",
            challenger_payout_bps: 0,
          },
        });
        setCreated(MOCK_CREATED_VS_ID);
        setCreatedPending(false);
        setCreatedTxHash(MOCK_WALLET_TX_HASH);
        setCreatedExplorerTxHash(MOCK_CONSENSUS_TX_HASH);
        setCreatedInviteKey(inviteKey);
        if (inviteKey) {
          rememberPrivateInviteKey(MOCK_CREATED_VS_ID, inviteKey);
        }
        setMockOverlayPhase("closed");
        mockFlowTimersRef.current = [];
        toast.success(t("createSuccessHeadline"));
        setShowSealStamp(true);
        window.setTimeout(() => setShowSealStamp(false), 4000);
        router.replace(pathname, { scroll: false });
      }, 2300);
      mockFlowTimersRef.current.push(tDone);
      return;
    }

    setLoading(true);

    try {
      const result =
        rematchId
          ? await createRematch(address!, rematchId, params)
          : await createClaim(address!, params);

      toast.success(
        result.pending
          ? t("submittedPending")
          : rematchId
            ? t("createSuccessHeadlineRematch")
            : t("createSuccessHeadline"),
      );
      if (result.claimId) {
        setCreated(result.claimId);
        setCreatedPending(Boolean(result.pending));
        setCreatedTxHash(result.txHash || "");
        setCreatedExplorerTxHash(result.explorerTxHash || "");
        setCreatedInviteKey(inviteKey);
        if (inviteKey) {
          rememberPrivateInviteKey(result.claimId, inviteKey);
        }

        // Store optimistic VS so it appears in lists before consensus
        savePendingVS({
          id: result.claimId,
          creator: address!,
          opponent: "0x0000000000000000000000000000000000000000",
          question,
          creator_position: creatorPos,
          opponent_position: opponentPos,
          resolution_url: normalizedSourceUrl,
          stake_amount: stake,
          deadline: deadlineTimestamp,
          state: "open",
          winner: "0x0000000000000000000000000000000000000000",
          resolution_summary: "",
          created_at: Math.floor(Date.now() / 1000),
          category,
          pending: true,
          createdAtMs: Date.now(),
          txHash: result.txHash || "",
        } satisfies PendingVS);
      } else {
        router.push("/dashboard");
      }
      if (!result.pending) {
        setShowSealStamp(true);
        setTimeout(() => setShowSealStamp(false), 4000);
      }
    } catch (err: any) {
      toast.error(err.message || t("errorCreating"));
    } finally {
      releaseLock?.();
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!created) {
      return;
    }
    await navigator.clipboard.writeText(getShareUrl(created, createdInviteKey));
    setCopied(true);
    toast.success(t("linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  }

  if (created) {
    const shareUrl = getShareUrl(created, createdInviteKey);
    const isMockSuccess = created < 0;

    return (
      <>
        <PageTransition>
          <div className="mx-auto w-full max-w-lg px-4 pb-6 pt-4 sm:px-6 sm:pb-12 sm:pt-8 md:max-w-xl">
            <AnimatedItem>
              <div className="space-y-6 sm:space-y-10">
                <header className="text-center">
                  {/* Seal stamp — "ISSUED" lock-in animation */}
                  <motion.div
                    variants={sealStamp}
                    initial="hidden"
                    animate="visible"
                    className="mx-auto mb-5 inline-flex items-center justify-center rounded-xl border-[3px] border-pv-emerald bg-pv-emerald/[0.05] px-8 py-2 font-display text-lg font-bold uppercase tracking-widest text-pv-emerald shadow-glow-emerald sm:text-xl"
                  >
                    ISSUED
                  </motion.div>
                  <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald/90">
                    {isMockSuccess
                      ? t("mockSuccessBadge")
                      : createdPending
                        ? t("createSuccessBadgePending")
                        : t("createSuccessBadgeLive")}
                  </p>
                  <h1 className="font-display text-2xl font-bold tracking-tight text-pv-text sm:text-3xl">
                    {createdPending
                      ? t("pendingTitle")
                      : rematchId
                        ? t("createSuccessHeadlineRematch")
                        : t("createSuccessHeadline")}
                  </h1>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                    {createdPending
                      ? t("pendingHint")
                      : createdInviteKey
                        ? t("sendThisPrivateLink")
                        : t("sendThisLink")}
                  </p>
                </header>

                <GlassCard
                  glass
                  noPad
                  glow="none"
                  className="!rounded-2xl border border-white/[0.12]"
                >
                  <div className="space-y-3 p-5 sm:p-6">
                    <label
                      className="block text-left text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted"
                      htmlFor="create-success-share-url"
                    >
                      {t("inviteLinkLabel")}
                    </label>
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch sm:gap-3">
                      <input
                        id="create-success-share-url"
                        readOnly
                        value={shareUrl}
                        className="form-field-pv min-h-[3rem] flex-1 break-all font-mono text-[11px] leading-snug sm:min-h-0 sm:text-xs"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        fullWidth={false}
                        onClick={copyLink}
                        className="w-full shrink-0 rounded-xl py-3.5 font-display text-xs font-bold uppercase tracking-widest sm:w-auto sm:min-w-[8.5rem]"
                      >
                        {copied ? (
                          <Check className="size-4 shrink-0" aria-hidden />
                        ) : (
                          <Copy className="size-4 shrink-0" aria-hidden />
                        )}
                        {copied ? tc("copied") : tc("copy")}
                      </Button>
                    </div>
                  </div>
                </GlassCard>

                <div>
                  <p className="mb-3 text-center font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-pv-muted/75">
                    {t("shareVia")}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(`Challenge me on PROVEN: ${shareUrl}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chip inline-flex min-h-[44px] items-center justify-center px-4 text-xs font-semibold uppercase tracking-wide text-pv-muted transition-colors hover:border-pv-emerald/35 hover:text-pv-emerald"
                    >
                      WhatsApp
                    </a>
                    <a
                      href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chip inline-flex min-h-[44px] items-center justify-center px-4 text-xs font-semibold uppercase tracking-wide text-pv-muted transition-colors hover:border-pv-emerald/35 hover:text-pv-emerald"
                    >
                      Telegram
                    </a>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.08] bg-pv-bg/35 px-4 py-3.5 sm:px-5">
                  <div className="space-y-2 text-left text-xs text-pv-muted">
                    {isMockSuccess && (
                      <p className="text-[11px] leading-relaxed text-pv-muted/90">
                        {t("mockTxDisclaimer")}
                      </p>
                    )}
                    {(createdPending || isMockSuccess) && createdTxHash && (
                      <p className="font-mono leading-relaxed">
                        {t("walletTx")}:{" "}
                        {isMockSuccess ? (
                          <span className="text-pv-text/90">
                            {createdTxHash.slice(0, 10)}…
                            {createdTxHash.slice(-8)}
                          </span>
                        ) : (
                          <a
                            href={getExplorerTxUrl(createdTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pv-emerald underline-offset-2 transition-colors hover:underline"
                          >
                            {createdTxHash.slice(0, 10)}…
                            {createdTxHash.slice(-8)}
                          </a>
                        )}
                      </p>
                    )}
                    {createdExplorerTxHash &&
                      (!createdPending ||
                        createdExplorerTxHash !== createdTxHash) && (
                        <p className="font-mono leading-relaxed">
                          {createdPending ? t("consensusTx") : "Tx"}:{" "}
                          {isMockSuccess ? (
                            <span className="text-pv-text/90">
                              {createdExplorerTxHash.slice(0, 10)}…
                              {createdExplorerTxHash.slice(-8)}
                            </span>
                          ) : (
                            <a
                              href={getExplorerTxUrl(createdExplorerTxHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-pv-emerald underline-offset-2 transition-colors hover:underline"
                            >
                              {createdExplorerTxHash.slice(0, 10)}…
                              {createdExplorerTxHash.slice(-8)}
                            </a>
                          )}
                        </p>
                      )}
                    {isMockSuccess ? (
                      <p className="text-[11px] leading-relaxed text-pv-muted/85">
                        {t("mockExplorerNote")}
                      </p>
                    ) : (
                      <p>
                        <a
                          href={getExplorerUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-pv-emerald underline-offset-2 transition-colors hover:underline"
                        >
                          {t("openExplorer")}
                        </a>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center sm:gap-4">
                  <Button
                    variant="ghost"
                    fullWidth
                    className="rounded-xl py-3.5 font-display text-xs font-bold uppercase tracking-widest sm:w-auto sm:min-w-[10rem] sm:px-8"
                    onClick={() => {
                      clearCreateMockSnapshot();
                      setCreated(null);
                      setCreatedPending(false);
                      setCreatedTxHash("");
                      setQuestion("");
                      setCreatorPos("");
                      setOpponentPos("");
                      setUrl("");
                      setSettlementRule("");
                      setVisibility("public");
                      setCreatedExplorerTxHash("");
                      setCreatedInviteKey("");
                    }}
                  >
                    {t("createAnother")}
                  </Button>
                  <Link href={`/vs/${created}`} className="block sm:inline-block">
                    <Button
                      variant="primary"
                      fullWidth
                      className="rounded-xl py-3.5 font-display text-xs font-bold uppercase tracking-widest sm:w-auto sm:min-w-[10rem] sm:px-8"
                    >
                      {t("viewVS")}
                    </Button>
                  </Link>
                </div>
              </div>
            </AnimatedItem>
          </div>
        </PageTransition>
      </>
    );
  }

  const isFormMockBusy = mockOverlayPhase !== "closed";

  return (
    <>
      <CreateMockFundingOverlay
        phase={mockOverlayPhase}
        titleLoading={t("mockOverlayFunding")}
        hintLoading={t("mockOverlayFundingHint")}
        titleSuccess={t("createSuccessHeadline")}
        subtitleSuccess={t("mockOverlaySuccessHint")}
      />
      <PageTransition>
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 sm:px-6">
        <AnimatedItem>
          <div className="mb-8 w-full sm:mb-10">
          {rematchId && (
            <GlassCard className="mb-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-pv-emerald/[0.12] border border-pv-emerald/[0.22] flex items-center justify-center text-pv-emerald shrink-0">
                  <GitBranch size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">
                    {t("rematchEyebrow")}
                  </div>
                  <p className="text-sm font-semibold mt-1">
                    {t("rematchFrom", { id: rematchId })}
                  </p>
                  <p className="text-sm text-pv-muted mt-1">
                    {loadingParent
                      ? t("rematchLoading")
                      : rematchSource
                      ? t("rematchHint")
                      : t("rematchPending")}
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:gap-6">
            <h1 className="min-w-0 font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
              <span className="block">{t("pageTitleBefore")}</span>
              <span className="mt-1 block text-pv-emerald sm:mt-1.5">
                {t("pageTitleAccent")}
              </span>
            </h1>
            <div
              className="h-px w-full bg-white/[0.12] sm:min-h-px sm:min-w-[2rem] sm:flex-1"
              aria-hidden
            />
          </div>
          </div>
        </AnimatedItem>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start lg:gap-10">
          <div className="flex flex-col gap-5 lg:col-span-8">
      {SOURCE_DRAFTS_ENABLED && (
        <AnimatedItem>
          <GlassCard
            glass
            noPad
            glow="none"
            className="!rounded-2xl border border-white/[0.12] w-full overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setSourceDraftOpen((value) => !value)}
              aria-expanded={sourceDraftOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/[0.02] sm:px-8 sm:py-6"
            >
              <div className="flex min-w-0 gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <Wand2 size={16} strokeWidth={2} />
                </span>
                <div className="min-w-0 space-y-1">
                  <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                    {t("sourceDraftTitle")}
                  </h3>
                  <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                    {t("sourceDraftHint")}
                  </p>
                </div>
              </div>
              <ChevronDown
                size={20}
                className={`shrink-0 text-pv-muted transition-transform duration-200 ease-out ${
                  sourceDraftOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>

            <motion.div
              initial={false}
              animate={{
                height: sourceDraftOpen ? "auto" : 0,
                opacity: sourceDraftOpen ? 1 : 0,
              }}
              transition={{
                height: {
                  duration: 0.34,
                  ease: [0.25, 0.46, 0.45, 0.94],
                },
                opacity: {
                  duration: 0.22,
                  ease: [0.25, 0.1, 0.25, 1],
                },
              }}
              className={`overflow-hidden ${!sourceDraftOpen ? "pointer-events-none" : ""}`}
              aria-hidden={!sourceDraftOpen}
            >
              <div className="space-y-5 border-t border-white/[0.08] px-6 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-6">
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                    {t("sourceDraftInputLabel")}
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <input
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("verificationUrlPlaceholder")}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      className="form-field-pv min-h-[3.25rem] flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      fullWidth={false}
                      onClick={handleGenerateFromSource}
                      loading={draftLoading}
                      disabled={!normalizedSourceUrl || draftLoading}
                      className="w-full shrink-0 self-start rounded-xl px-5 py-3 font-display text-[11px] font-bold uppercase tracking-[0.16em] transition-[background-color,border-color,color,box-shadow,transform,filter] duration-200 ease-out sm:w-auto sm:self-center !border-white/[0.22] !bg-white/[0.06] !text-pv-text/90 enabled:hover:-translate-y-px enabled:hover:!border-transparent enabled:hover:!bg-pv-emerald enabled:hover:!text-pv-bg enabled:hover:!brightness-[1.06] enabled:hover:!shadow-[0_6px_20px_-4px_rgba(78,222,163,0.32)] enabled:active:translate-y-0 enabled:active:scale-[0.98] enabled:active:!shadow-none focus-visible:!outline-none enabled:focus-visible:!ring-2 enabled:focus-visible:!ring-pv-emerald/40 enabled:focus-visible:!ring-offset-2 enabled:focus-visible:!ring-offset-pv-bg disabled:hover:!translate-y-0 disabled:hover:!border-white/[0.22] disabled:hover:!bg-white/[0.06] disabled:hover:!text-pv-text/90 disabled:hover:!brightness-100 disabled:hover:!shadow-none"
                    >
                      {draftLoading ? t("sourceDraftGenerating") : t("sourceDraftGenerate")}
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-pv-muted">
                    {t("sourceDraftInputHint")}
                  </p>
                </div>

                {draftError ? (
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.08] px-4 py-3 text-sm text-amber-200">
                    {draftError}
                  </div>
                ) : null}

                {draftResult ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-white/[0.08] bg-pv-bg/60 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-pv-emerald/20 bg-pv-emerald/[0.1] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">
                          {t(`sourceDraftSourceTypes.${draftResult.sourceType}`)}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                          {t("sourceDraftSummaryLabel")}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-pv-text/90">
                        {draftResult.sourceSummary}
                      </p>
                    </div>

                    <div className="grid gap-4">
                      {draftResult.candidates.map((candidate, index) => {
                        const draftDeadline = new Date(candidate.deadlineAt);
                        const hasDeadline = Number.isFinite(draftDeadline.getTime());

                        return (
                          <div
                            key={`${candidate.claimText}-${index}`}
                            className="rounded-2xl border border-white/[0.08] bg-pv-surface2 p-4 sm:p-5"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-pv-cyan/25 bg-pv-cyan/[0.1] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-cyan">
                                    {tCat(normalizeCategoryId(candidate.category))}
                                  </span>
                                  <span className="rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                                    {candidate.confidenceScore}/100
                                  </span>
                                </div>
                                <h3 className="mt-3 font-display text-xl font-bold tracking-tight text-pv-text">
                                  {candidate.claimText}
                                </h3>
                              </div>
                              <Button
                                variant="primary"
                                fullWidth={false}
                                onClick={() => applySourceDraft(candidate)}
                                disabled={isApplyingDraft}
                                className="rounded-xl px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em]"
                              >
                                {t("sourceDraftUse")}
                              </Button>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-xl border border-white/[0.08] bg-pv-bg/60 p-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                                  {t("sourceDraftSideA")}
                                </div>
                                <div className="mt-2 text-sm font-medium text-pv-text/90">
                                  {candidate.sideA}
                                </div>
                              </div>
                              <div className="rounded-xl border border-white/[0.08] bg-pv-bg/60 p-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                                  {t("sourceDraftSideB")}
                                </div>
                                <div className="mt-2 text-sm font-medium text-pv-text/90">
                                  {candidate.sideB}
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                              <div className="rounded-xl border border-white/[0.08] bg-pv-bg/60 p-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                                  {t("sourceDraftDeadline")}
                                </div>
                                <div className="mt-2 text-sm font-medium text-pv-text/90">
                                  {hasDeadline
                                    ? `${draftDeadline.toLocaleString(locale === "en" ? "en-US" : "es-AR", {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })} (${candidate.timezone})`
                                    : candidate.deadlineAt}
                                </div>
                              </div>
                              <div className="rounded-xl border border-white/[0.08] bg-pv-bg/60 p-3">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                                  {t("sourceDraftPrimarySource")}
                                </div>
                                <div className="mt-2 break-all text-sm font-medium text-pv-text/90">
                                  {candidate.primaryResolutionSource}
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 rounded-xl border border-white/[0.08] bg-pv-bg/60 p-3">
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                                {t("sourceDraftSettlementRule")}
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-pv-text/90">
                                {candidate.settlementRule}
                              </p>
                            </div>

                            {candidate.ambiguityFlags.length > 0 ? (
                              <div className="mt-4 flex flex-wrap gap-2">
                                {candidate.ambiguityFlags.map((flag) => (
                                  <span
                                    key={flag}
                                    className="rounded-full border border-amber-400/20 bg-amber-400/[0.08] px-2.5 py-1 text-[10px] font-medium text-amber-200"
                                  >
                                    {flag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </GlassCard>
        </AnimatedItem>
      )}
      <AnimatedItem>
        <GlassCard
          glass
          noPad
          glow="none"
          className="!rounded-2xl border border-white/[0.12] w-full"
        >
          <div className="space-y-6 p-6 sm:p-8">
            <div className="mb-2 flex items-center gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                aria-hidden
              >
                <FileEdit size={18} strokeWidth={2} />
              </span>
              <h2
                id={challengeQuestionHeadingId}
                className="font-display text-base font-bold uppercase tracking-[0.16em] text-pv-text sm:text-lg sm:tracking-[0.18em]"
              >
                {t("challengeSectionTitle")}
              </h2>
            </div>
            {/* Claim canvas — the visual centerpiece */}
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl pointer-events-none bg-gradient-to-br from-pv-cyan/[0.03] via-transparent to-pv-fuch/[0.03]" />
              <textarea
                id={challengeQuestionFieldId}
                rows={5}
                className="min-h-[160px] w-full resize-none rounded-2xl border border-white/[0.12] bg-pv-bg/40 p-6 sm:p-8 font-display text-xl leading-snug tracking-tight text-pv-text outline-none transition-all placeholder:text-pv-muted/30 focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/30 focus:shadow-glow-emerald sm:text-2xl md:text-[26px]"
                placeholder={challengePlaceholder}
                aria-labelledby={challengeQuestionHeadingId}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p
                className={`min-w-0 flex-1 text-xs leading-relaxed ${
                  questionNeedsWork ? "text-amber-300" : "text-pv-muted"
                }`}
              >
                {questionNeedsWork
                  ? t("qualitySpecificity")
                  : verificationQuestionHint.trim() || t("questionStrengthHint")}
              </p>
              <button
                type="button"
                onClick={autofillOutcomeSidesFromQuestion}
                disabled={question.trim().length === 0}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-pv-text/90 transition-colors hover:border-white/[0.16] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/[0.1] disabled:hover:bg-white/[0.04] sm:max-w-[min(100%,15rem)]"
                aria-label={t("outcomeAutofillAction")}
                title={t("outcomeAutofillHint")}
              >
                <Wand2
                  className="size-3.5 shrink-0 text-pv-emerald/90"
                  aria-hidden
                />
                <span>{t("outcomeAutofillAction")}</span>
              </button>
            </div>

            {/* Opposition split — Side A (cyan/left) vs Side B (fuchsia/right) */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-0">
              {/* Side A — Creator / Cyan */}
              <div className="relative flex flex-col gap-4 md:pr-4 md:border-r md:border-white/[0.06]">
                <div className="absolute inset-0 pointer-events-none rounded-xl opacity-60" style={{ background: creatorPos ? "radial-gradient(ellipse 80% 60% at 0% 50%, rgba(93,230,255,0.06), transparent 70%)" : "none" }} />
                <div className="relative flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-cyan/10 text-pv-cyan"
                    aria-hidden
                  >
                    <User size={16} strokeWidth={2} />
                  </span>
                  <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-cyan sm:tracking-[0.2em]">
                    {t("ibet")}
                  </span>
                </div>
                <input
                  type="text"
                  className="relative w-full rounded-xl border border-pv-cyan/[0.15] bg-pv-bg/90 px-4 py-3.5 font-body text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/55 focus:border-pv-cyan/40 focus:ring-1 focus:ring-pv-cyan/20 focus:shadow-glow"
                  placeholder={creatorPosPlaceholder}
                  value={creatorPos}
                  onChange={(event) => setCreatorPos(event.target.value)}
                  autoComplete="off"
                  aria-label={t("ibet")}
                />
              </div>
              {/* Side B — Opponent / Fuchsia */}
              <div className="relative flex flex-col gap-4 md:pl-4">
                <div className="absolute inset-0 pointer-events-none rounded-xl opacity-60" style={{ background: opponentPos ? "radial-gradient(ellipse 80% 60% at 100% 50%, rgba(248,172,255,0.06), transparent 70%)" : "none" }} />
                <div className="relative flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-fuch/10 text-pv-fuch"
                    aria-hidden
                  >
                    <Users size={16} strokeWidth={2} />
                  </span>
                  <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-fuch sm:tracking-[0.2em]">
                    {isOneToMany ? t("challengerSideBets") : t("rivalBets")}
                  </span>
                </div>
                <input
                  type="text"
                  className="relative w-full rounded-xl border border-pv-fuch/[0.15] bg-pv-bg/90 px-4 py-3.5 font-body text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/55 focus:border-pv-fuch/40 focus:ring-1 focus:ring-pv-fuch/20 focus:shadow-glow-fuch"
                  placeholder={opponentPosPlaceholder}
                  value={opponentPos}
                  onChange={(event) => setOpponentPos(event.target.value)}
                  autoComplete="off"
                  aria-label={
                    isOneToMany ? t("challengerSideBets") : t("rivalBets")
                  }
                />
              </div>
            </div>
          </div>
          </GlassCard>
        </AnimatedItem>

      <AnimatedItem>
        <GlassCard
          glass
          noPad
          glow="none"
          className="!rounded-2xl border border-white/[0.12] w-full"
          role="group"
          aria-label={t("visibility")}
        >
          <div className="flex flex-col items-stretch justify-between gap-6 p-6 sm:p-8 md:flex-row md:items-center">
            <div className="min-w-0 space-y-2.5">
              <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <Eye size={16} strokeWidth={2} />
                </span>
                {t("visibility")}
              </h3>
              <p className="max-w-xl text-xs leading-relaxed text-pv-muted">
                {isPrivate ? t("visibilityPrivateHint") : t("visibilityPublicHint")}
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row md:w-auto">
              {VISIBILITY_TOGGLE_OPTIONS.map(({ key, labelKey }) => {
                const selected = visibility === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setVisibility(key)}
                    aria-pressed={selected}
                    className={`flex-1 rounded-lg px-6 py-2.5 font-display text-[11px] font-bold uppercase tracking-[0.18em] transition-[color,background-color,border-color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/40 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg sm:tracking-[0.2em] md:flex-none md:min-w-[9.5rem] ${
                      selected
                        ? "bg-pv-emerald text-pv-bg shadow-[0_0_22px_-6px_rgba(78,222,163,0.35)] hover:brightness-[1.05] active:scale-[0.98]"
                        : "border border-white/[0.12] bg-pv-surface text-pv-muted hover:border-white/[0.2] hover:text-pv-text active:scale-[0.98]"
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </GlassCard>
      </AnimatedItem>

        <AnimatedItem>
          <GlassCard
            glass
            noPad
            glow="none"
            className="!rounded-2xl border border-white/[0.12] w-full"
          >
            <div className="space-y-3 p-6 sm:p-8">
              <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <Coins size={16} strokeWidth={2} />
                </span>
                {t("stakeSectionTitle")}
              </h3>
              <div className="grid grid-cols-5 gap-2">
                {STAKE_PRESET_AMOUNTS.map((amount) => (
                  <motion.button
                    key={amount}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setStake(amount)}
                    aria-pressed={
                      stake === amount && presetStakeHighlight
                    }
                    className={`min-w-0 rounded-lg border px-1.5 py-2 font-display text-[11px] font-bold leading-tight transition-[border-color,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg sm:px-2 sm:py-2.5 sm:text-xs ${
                      stake === amount && presetStakeHighlight
                        ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(78,222,163,0.3)]"
                        : "border border-white/[0.12] bg-pv-surface text-pv-muted hover:border-pv-emerald/35 hover:text-pv-emerald"
                    }`}
                  >
                    {amount} GEN
                  </motion.button>
                ))}
                <div
                  className={`flex min-h-[2.75rem] w-full min-w-0 items-center justify-center rounded-lg border px-1.5 py-1.5 transition-[border-color,background-color,color,box-shadow] sm:min-h-[3.25rem] sm:px-2 sm:py-2 ${
                    customStakeFocused || !isPresetStakeAmount(stake)
                      ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(78,222,163,0.3)]"
                      : "border border-white/[0.12] bg-pv-surface text-pv-muted"
                  }`}
                >
                  <div className="inline-flex max-w-full items-center justify-center gap-0.5 sm:gap-1">
                    <input
                      type="number"
                      min={MIN_STAKE}
                      step={1}
                      inputMode="numeric"
                      aria-label={t("stakeCustomAmount")}
                      className={`max-w-full shrink-0 bg-transparent font-display text-[11px] font-bold tabular-nums text-inherit outline-none placeholder:text-pv-muted/50 focus:outline-none sm:text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                        customStakeDraft.trim() !== ""
                          ? "text-right"
                          : "text-center"
                      }`}
                      style={{
                        width: customStakeDraft.trim()
                          ? `${Math.max(2, customStakeDraft.length + 0.5)}ch`
                          : "min(100%, 11ch)",
                      }}
                      placeholder={t("stakeCustomPlaceholder")}
                      value={customStakeDraft}
                      onChange={(event) => setCustomStakeDraft(event.target.value)}
                      onFocus={() => setCustomStakeFocused(true)}
                      onBlur={() => {
                        setCustomStakeFocused(false);
                        const raw = customStakeDraft.trim();
                        if (raw === "") {
                          if (!isPresetStakeAmount(stake)) {
                            setStake(MIN_STAKE);
                          }
                          return;
                        }
                        const n = Math.floor(Number(raw));
                        if (!Number.isFinite(n) || n < MIN_STAKE) {
                          if (isPresetStakeAmount(stake)) {
                            setCustomStakeDraft("");
                          } else {
                            setCustomStakeDraft(String(stake));
                          }
                          return;
                        }
                        setStake(n);
                      }}
                    />
                    {customStakeDraft.trim() !== "" && (
                      <span
                        className="shrink-0 font-display text-[10px] font-bold leading-none tracking-tight text-inherit sm:text-[11px]"
                        aria-hidden
                      >
                        GEN
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </AnimatedItem>

        <AnimatedItem>
          <GlassCard
            glass
            noPad
            glow="none"
            className="!rounded-2xl border border-white/[0.12] w-full"
            role="group"
            aria-label={t("deadline")}
          >
            <div className="space-y-4 p-6 sm:p-8">
              <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <Clock size={16} strokeWidth={2} />
                </span>
                {t("deadline")}
              </h3>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {DEADLINE_PRESETS.map((preset) => {
                  const selected = deadlinePreset === preset.seconds;
                  return (
                    <motion.button
                      key={preset.id}
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      onClick={() => applyDeadlinePreset(preset.seconds)}
                      aria-pressed={selected}
                      className={`min-w-0 rounded-lg border px-1.5 py-2 font-display text-[11px] font-bold leading-tight transition-[border-color,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg sm:px-2 sm:py-2.5 sm:text-xs ${
                        selected
                          ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(78,222,163,0.3)]"
                          : "border border-white/[0.12] bg-pv-surface text-pv-muted hover:border-pv-emerald/35 hover:text-pv-emerald"
                      }`}
                    >
                      {preset.label}
                    </motion.button>
                  );
                })}
              </div>

              <GlassCard className="p-4 sm:p-5">
                <p className="label mb-3">{t("orChooseExactDate")}</p>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <Input
                    type="date"
                    label={`${t("exactDate")} *`}
                    min={customDateInputMin}
                    value={customDeadlineDate}
                    onChange={(event) => {
                      setDeadlinePreset(null);
                      setCustomDeadlineDate(event.target.value);
                    }}
                    className="text-sm [color-scheme:dark]"
                  />
                  <Input
                    type="time"
                    label={`${t("exactTime")} *`}
                    value={customDeadlineTime}
                    onChange={(event) => {
                      setDeadlinePreset(null);
                      setCustomDeadlineTime(event.target.value);
                    }}
                    disabled={!customDeadlineDate}
                    className="text-sm [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </GlassCard>
            </div>
          </GlassCard>
        </AnimatedItem>

        <AnimatedItem>
          <GlassCard
            glass
            noPad
            glow="none"
            className="!rounded-2xl border border-white/[0.12] w-full"
            role="group"
            aria-label={t("verificationSourceSectionTitle")}
          >
            <div className="space-y-4 p-6 sm:p-8">
              <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <Link2 size={16} strokeWidth={2} />
                </span>
                {t("verificationSourceSectionTitle")}
              </h3>

              <label className="sr-only" htmlFor="create-verification-url">
                {t("verificationSource")}
              </label>
              <input
                id="create-verification-url"
                type="text"
                name="verificationSource"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("verificationUrlPlaceholder")}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="form-field-pv min-h-[3.25rem] font-mono text-xs"
              />
              <p
                className={`text-xs leading-relaxed ${
                  sourceNeedsWork ? "text-amber-300" : "text-pv-muted"
                }`}
              >
                {sourceNeedsWork ? t("qualitySource") : t("sourceStrengthHint")}
              </p>

              <div className="space-y-3 rounded-xl border border-white/[0.08] bg-pv-bg/70 p-4 sm:p-5">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald/85">
                  {t("verificationGuidanceTitle")}
                </h4>
                <p className="text-sm leading-relaxed text-pv-muted">
                  {t(`guidance.${guidanceKey}.sourceHint`)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {categoryGuidance.sourceExamples.map((example: string) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setUrl(example)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[10px] font-medium text-pv-muted/70 transition-colors hover:border-white/[0.14] hover:text-pv-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/30 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg"
                    >
                      {example}
                    </button>
                  ))}
                </div>
                {verificationQuestionHint.trim() !== "" && (
                  <p className="text-xs leading-relaxed text-pv-muted/85">
                    {verificationQuestionHint}
                  </p>
                )}
              </div>
            </div>
          </GlassCard>
        </AnimatedItem>

        <AnimatedItem>
          <GlassCard
            glass
            noPad
            glow="none"
            className="!rounded-2xl border border-white/[0.12] w-full overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setAdvancedOpen((value) => !value)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/[0.02] sm:px-8 sm:py-6"
            >
              <div className="flex min-w-0 gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <SlidersHorizontal size={16} strokeWidth={2} />
                </span>
                <div className="min-w-0 space-y-1">
                  <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                    {t("advancedToggle")}
                  </h3>
                  <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                    {t("advancedHint")}
                  </p>
                </div>
              </div>
              <ChevronDown
                size={20}
                className={`shrink-0 text-pv-muted transition-transform duration-200 ease-out ${
                  advancedOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>

            <motion.div
              initial={false}
              animate={{
                height: advancedOpen ? "auto" : 0,
                opacity: advancedOpen ? 1 : 0,
              }}
              transition={{
                height: {
                  duration: 0.34,
                  ease: [0.25, 0.46, 0.45, 0.94],
                },
                opacity: {
                  duration: 0.22,
                  ease: [0.25, 0.1, 0.25, 1],
                },
              }}
              className={`overflow-hidden ${!advancedOpen ? "pointer-events-none" : ""}`}
              aria-hidden={!advancedOpen}
            >
              <div className="space-y-8 border-t border-white/[0.08] px-6 pb-6 pt-6 sm:px-8 sm:pb-8">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
                  <ListboxField
                    id="create-market-type"
                    label={t("marketType") ?? ""}
                    value={marketType}
                    options={MARKET_TYPES.map((value) => ({
                      value,
                      label: t(`marketTypes.${value}`) ?? value,
                    }))}
                    onChange={setMarketType}
                  />

                  <ListboxField
                    id="create-category"
                    label={t("category") ?? ""}
                    value={category}
                    options={CATEGORIES.map((entry) => ({
                      value: entry.id,
                      label: tCat(entry.id),
                    }))}
                    onChange={(value) => setCategory(normalizeCategoryId(value))}
                  />
                </div>

                <div className="space-y-3">
                  <label
                    htmlFor="settlement-rule-textarea"
                    className="block text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted"
                  >
                    {t("settlementRule")}
                  </label>
                  <textarea
                    id="settlement-rule-textarea"
                    rows={4}
                    className="form-field-pv min-h-[100px] w-full resize-none"
                    placeholder={t("settlementPlaceholder")}
                    value={settlementRule}
                    onChange={(event) => setSettlementRule(event.target.value)}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <p className="min-w-0 flex-1 text-left text-[11px] leading-relaxed text-pv-muted">
                      {t("settlementRuleHint")}{" "}
                      <span
                        className={
                          settlementNeedsWork ? "text-amber-300" : undefined
                        }
                      >
                        {settlementNeedsWork
                          ? t("qualitySettlement")
                          : t("settlementStrengthHint")}
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled={settlementMatchesRecommended}
                      onClick={() =>
                        setSettlementRule(recommendedSettlementTemplate)
                      }
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-pv-text/90 transition-colors hover:border-white/[0.16] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/[0.1] disabled:hover:bg-white/[0.04] sm:max-w-[min(100%,14rem)] sm:self-auto"
                      aria-label={t("useRecommendedRule")}
                    >
                      <Wand2
                        className="size-3.5 shrink-0 text-pv-emerald/90"
                        aria-hidden
                      />
                      <span>{t("useRecommendedRule")}</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </GlassCard>
        </AnimatedItem>

            {isCreateDemoSession && (
              <AnimatedItem>
                <GlassCard
                  glass
                  glow="none"
                  noPad
                  className="!rounded-2xl !border-2 !border-dashed !border-white/[0.18] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
                >
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-4">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] text-pv-muted"
                        aria-hidden
                      >
                        <FlaskConical size={18} strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                          <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                            {tVsDetail("sampleModeTitle")}
                          </h3>
                          <span className="inline-flex shrink-0 rounded border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-pv-muted sm:text-[10px] sm:tracking-[0.22em]">
                            {tVsDetail("sampleModeDemoBadge")}
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-pv-muted sm:text-xs">
                          {t("mockModeBanner")}
                        </p>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </AnimatedItem>
            )}

          </div>

          <aside className="lg:col-span-4 text-pv-text">
            <AnimatedItem>
              <div className="flex flex-col gap-6 lg:sticky lg:top-24">
                <CreateChallengeTicket
                  draftId={ticketDraftId}
                  marketTypeLabel={t(`marketTypes.${marketType}`)}
                  oddsModeLabel={t("oddsModes.pool")}
                  formatLabel={t("headToHeadSummary")}
                  visibilityLabel={
                    isPrivate ? t("visibilityPrivate") : t("visibilityPublic")
                  }
                  settlementPreview={ticketSettlementPreview}
                  stakeAmount={stake}
                  walletAddress={ticketWalletAddress ?? undefined}
                />
                <ClaimStrengthCard
                  input={claimStrengthInput}
                  moderation={
                    CLAIM_MODERATION_ENABLED
                      ? {
                          status: moderationLoading
                            ? "checking"
                            : moderationAttempted &&
                                moderationInputReady &&
                                !isModerationApproved
                              ? "blocked"
                              : moderationDecision === "allow"
                                ? "allowed"
                                : "idle",
                          message:
                            moderationAttempted &&
                            moderationInputReady &&
                            !isModerationApproved
                              ? moderationMessageKey
                              : undefined,
                          violationCodes: moderationCodes,
                          checkedAtMs: moderationCheckedAtMs || undefined,
                        }
                      : undefined
                  }
                />
                {CLAIM_MODERATION_ENABLED ? (
                  <div className="relative overflow-hidden rounded-2xl border border-white/[0.10] bg-gradient-to-br from-white/[0.04] via-white/[0.015] to-transparent px-3 py-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:px-4">
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-row flex-wrap items-center justify-center gap-5 sm:gap-8">
                      <Button
                        variant="ghost"
                        fullWidth={false}
                        onClick={() => void runClaimModeration()}
                        disabled={!moderationInputReady || moderationLoading}
                        loading={moderationLoading}
                        className="shrink-0 rounded-lg px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] !border-white/[0.10] !bg-white/[0.03] !text-pv-muted/95 enabled:hover:!border-white/[0.14] enabled:hover:!bg-white/[0.05] enabled:hover:!text-pv-text/85 disabled:!opacity-50"
                      >
                        {t("moderationRunCheck")}
                      </Button>
                      <div className="min-w-0 shrink-0 text-center">
                        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-pv-muted/90">
                          {tQuality("moderationConfidenceHeading")}
                        </div>
                        <div className="mt-1 font-mono text-xl font-semibold tabular-nums leading-none text-pv-text/90">
                          {moderationCheckedAtMs ? (
                            <>
                              {Math.max(
                                0,
                                Math.min(100, Math.round(moderationConfidence))
                              )}
                              <span className="text-base font-medium text-pv-muted/70">
                                /100
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-pv-muted/75">—</span>
                              <span className="text-base font-medium text-pv-muted/70">
                                /100
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                {isConnected || isCreateDemoSession ? (
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    loading={
                      loading ||
                      mockOverlayPhase === "loading" ||
                      moderationLoading
                    }
                    disabled={isFormMockBusy || moderationLoading}
                    className="rounded-2xl py-5 font-display text-sm font-bold uppercase tracking-widest"
                  >
                    {mockOverlayPhase === "loading" || loading ? (
                      mockOverlayPhase === "loading"
                        ? t("mockOverlayFunding")
                        : t("funding")
                    ) : (
                      <>
                        <span>
                          {rematchId
                            ? t("createRematchAndFund", { amount: stake })
                            : t("createAndFund", { amount: stake })}
                        </span>
                        <Zap className="size-5 shrink-0" aria-hidden />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={connect}
                    className="rounded-2xl py-5 font-display text-sm font-bold uppercase tracking-widest"
                  >
                    {t("connectWallet")}
                  </Button>
                )}
                <p className="text-center text-[9px] font-bold uppercase tracking-widest text-pv-muted/55 leading-snug">
                  {t("ticketSignatureNote")}
                </p>
              </div>
            </AnimatedItem>
          </aside>
        </div>
      </div>
    </PageTransition>
    </>
  );
}
