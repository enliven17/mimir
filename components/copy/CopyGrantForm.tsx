"use client";

/**
 * Grant a copy permission.
 *
 * The preview is `copyPermissionMessage(draft)` for the very draft that gets
 * POSTed, so what the follower reads here, what the wallet shows, and what the
 * server re-derives and verifies are one string (see `lib/copy-form.ts`).
 */

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useSignMessage } from "wagmi";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { copyPermissionMessage, worstCaseCopySpend } from "@/lib/copy-trading";
import {
  COPY_CATEGORIES,
  DEFAULT_COPY_FORM,
  buildCopyDraft,
  copyDraftError,
  copyGrantBody,
  dateInputValue,
  suggestCopyId,
  type CopyCategory,
  type CopyFormValues,
} from "@/lib/copy-form";
import { grantCopyPermission, listRegistryAgents, type RegistryAgentView } from "@/lib/copy-client";
import { formatUsdc } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";

type NumericField =
  | "maxPerPositionUsdc"
  | "maxDailyUsdc"
  | "maxWeeklyUsdc"
  | "maxOpenExposureUsdc"
  | "maxRealizedLossUsdc"
  | "minClaimQuality"
  | "minPayoutRatio";

const newSuffix = () => Math.random().toString(36).slice(2, 6);

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[11px] text-pv-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface CopyGrantFormProps {
  address: string;
  onDisabled: () => void;
}

export default function CopyGrantForm({ address, onDisabled }: CopyGrantFormProps) {
  const t = useTranslations("copy");
  const format = useFormatter();
  const { signMessageAsync } = useSignMessage();
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const [agents, setAgents] = useState<RegistryAgentView[] | null>(null);
  const [values, setValues] = useState<CopyFormValues>(() => ({
    ...DEFAULT_COPY_FORM,
    expiresOn: dateInputValue(Date.now(), 30),
  }));
  const [idTouched, setIdTouched] = useState(false);
  const [suffix, setSuffix] = useState(newSuffix);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listRegistryAgents().then((list) => {
      if (!cancelled) setAgents(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends keyof CopyFormValues>(key: K, value: CopyFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const toggleCategory = (c: CopyCategory) =>
    setValues((prev) => ({
      ...prev,
      allowedCategories: prev.allowedCategories.includes(c)
        ? prev.allowedCategories.filter((x) => x !== c)
        : [...prev.allowedCategories, c],
    }));

  const autoId =
    values.signalAgentId || values.executionAgentId
      ? suggestCopyId(values.signalAgentId, values.executionAgentId, suffix)
      : "";
  const effectiveValues = { ...values, id: idTouched ? values.id : autoId };
  const draft = buildCopyDraft(effectiveValues, address);
  const draftError = copyDraftError(draft);
  const message = copyPermissionMessage(draft);
  const worstCase = worstCaseCopySpend({ ...draft, signature: "", createdAt: 0 });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (draftError || busy) return;
    setSubmitError(null);
    setNotice(null);
    setBusy(true);
    try {
      const signature = await signMessageAsync({ message });
      const result = await grantCopyPermission(copyGrantBody(draft, signature));
      if (result.kind === "disabled") {
        onDisabled();
      } else if (result.kind === "error") {
        setSubmitError(t("requestFailed", { message: result.message }));
      } else {
        setNotice(
          t("grant.granted", {
            id: result.data.id,
            date: format.dateTime(new Date(result.data.expiresAt), { dateStyle: "medium" }),
          }),
        );
        setSuffix(newSuffix());
        setIdTouched(false);
      }
    } catch (err) {
      setSubmitError(txErrorMessage(err, t("signatureFailed")));
    } finally {
      setBusy(false);
    }
  }

  const agentPicker = (key: "signalAgentId" | "executionAgentId") => {
    const id = fid(key);
    const common = {
      id,
      value: values[key],
      required: true,
      "aria-describedby": `${id}-hint`,
    };
    if (agents && agents.length === 0) {
      return (
        <input
          {...common}
          className="form-field-pv font-mono"
          placeholder={t("grant.agentIdPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set(key, e.target.value.trim())}
        />
      );
    }
    return (
      <select
        {...common}
        className="select-field-pv"
        disabled={agents === null}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">{agents === null ? t("grant.agentsLoading") : t("grant.selectAgent")}</option>
        {(agents ?? []).map((a) => (
          <option key={a.agentId} value={a.agentId}>
            {a.displayName && a.displayName !== a.agentId ? `${a.displayName} (${a.agentId})` : a.agentId}
          </option>
        ))}
      </select>
    );
  };

  const numberInput = (key: NumericField, label: string, hint?: string, step = "any") => {
    const id = fid(key);
    return (
      <Field id={id} label={label} hint={hint}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          required
          className="form-field-pv font-mono tabular-nums"
          value={values[key]}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => set(key, e.target.value)}
        />
      </Field>
    );
  };

  return (
    <section aria-labelledby="copy-grant-heading" className="card rounded-2xl p-4 sm:p-5">
      <h2 id="copy-grant-heading" className="font-display text-sm font-bold uppercase tracking-[0.14em] text-pv-text">
        {t("grant.title")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t("grant.desc")}</p>

      <form className="mt-5 space-y-6" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-3">{t("grant.agentsTitle")}</legend>
          <Field id={fid("signalAgentId")} label={t("grant.signalAgent")} hint={t("grant.signalAgentHint")}>
            {agentPicker("signalAgentId")}
          </Field>
          <Field id={fid("executionAgentId")} label={t("grant.executionAgent")} hint={t("grant.executionAgentHint")}>
            {agentPicker("executionAgentId")}
          </Field>
          {agents && agents.length === 0 ? (
            <p className="text-[11px] text-pv-muted sm:col-span-2">{t("grant.noAgents")}</p>
          ) : null}
          <div className="sm:col-span-2">
            <Field id={fid("id")} label={t("grant.id")} hint={t("grant.idHint")}>
              <div className="flex gap-2">
                <input
                  id={fid("id")}
                  className="form-field-pv min-w-0 flex-1 font-mono"
                  value={effectiveValues.id}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${fid("id")}-hint`}
                  onChange={(e) => {
                    setIdTouched(true);
                    set("id", e.target.value.toLowerCase().trim());
                  }}
                />
                <button
                  type="button"
                  className="focus-ring inline-flex size-[3.125rem] shrink-0 items-center justify-center rounded-xl border border-white/[0.12] text-pv-muted transition-colors hover:border-pv-emerald/50 hover:text-pv-text"
                  aria-label={t("grant.regenerate")}
                  title={t("grant.regenerate")}
                  onClick={() => {
                    setSuffix(newSuffix());
                    setIdTouched(false);
                  }}
                >
                  <RefreshCw className="size-4" aria-hidden />
                </button>
              </div>
            </Field>
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:grid-cols-3">
          <legend className="label mb-3">{t("grant.capsTitle")}</legend>
          {numberInput("maxPerPositionUsdc", t("grant.perPosition"))}
          {numberInput("maxDailyUsdc", t("grant.perDay"))}
          {numberInput("maxWeeklyUsdc", t("grant.perWeek"))}
          {numberInput("maxOpenExposureUsdc", t("grant.openExposure"))}
          {numberInput("maxRealizedLossUsdc", t("grant.lossStop"))}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="label mb-3">{t("grant.filtersTitle")}</legend>
          <fieldset aria-describedby={`${fid("cats")}-hint`}>
            <legend className="mb-2 text-xs font-semibold text-pv-text">{t("grant.categoriesLegend")}</legend>
            <div className="flex flex-wrap gap-2">
              {COPY_CATEGORIES.map((c) => {
                const checked = values.allowedCategories.includes(c);
                return (
                  <label
                    key={c}
                    className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors focus-within:ring-1 focus-within:ring-pv-emerald/60 ${
                      checked ? "border-pv-emerald/70 bg-pv-emerald/20 text-pv-text" : "border-white/[0.12] text-pv-muted hover:text-pv-text"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-pv-emerald"
                      checked={checked}
                      onChange={() => toggleCategory(c)}
                    />
                    {t(`categories.${c}`)}
                  </label>
                );
              })}
            </div>
            <p id={`${fid("cats")}-hint`} className="mt-1.5 text-[11px] text-pv-muted">
              {t("grant.categoriesHint")}
            </p>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {numberInput("minClaimQuality", t("grant.minQuality"), t("grant.minQualityHint"), "1")}
            {numberInput("minPayoutRatio", t("grant.minPayout"), t("grant.minPayoutHint"), "0.05")}
            <Field id={fid("expiresOn")} label={t("grant.expiresOn")}>
              <input
                id={fid("expiresOn")}
                type="date"
                required
                min={dateInputValue(Date.now(), 0)}
                className="form-field-pv font-mono [color-scheme:dark]"
                value={values.expiresOn}
                onChange={(e) => set("expiresOn", e.target.value)}
              />
            </Field>
          </div>
        </fieldset>

        <section aria-labelledby={fid("preview")} className="space-y-2">
          <h3 id={fid("preview")} className="label mb-0">
            {t("grant.previewTitle")}
          </h3>
          <p className="text-[11px] text-pv-muted">{t("grant.previewHint")}</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.12] bg-pv-bg/90 p-3 font-mono text-[11px] leading-relaxed text-pv-text sm:text-xs">
            {message}
          </pre>
          {!draftError ? (
            <p className="text-[11px] text-pv-muted">{t("grant.worstCase", { amount: formatUsdc(worstCase) })}</p>
          ) : null}
        </section>

        {/* Not a live region: it changes on every keystroke. */}
        {draftError ? (
          <p id={fid("draft-error")} className="flex items-start gap-2 text-xs text-pv-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{t("grant.fixFirst", { error: draftError })}</span>
          </p>
        ) : null}

        <div aria-live="polite" className="empty:hidden">
          {notice ? <p className="text-sm text-pv-text">{notice}</p> : null}
        </div>

        {submitError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-pv-danger/30 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{submitError}</span>
          </div>
        ) : null}

        <button
          type="submit"
          className="btn-primary focus-ring flex items-center justify-center gap-2"
          disabled={Boolean(draftError) || busy}
          aria-busy={busy || undefined}
          aria-describedby={draftError ? fid("draft-error") : undefined}
        >
          {busy ? t("grant.signing") : t("grant.sign")}
        </button>
      </form>
    </section>
  );
}
