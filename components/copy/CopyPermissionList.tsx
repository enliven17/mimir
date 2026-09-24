"use client";

/**
 * The follower's own permissions. Loading and revoking each take a signature
 * over `followerProofMessage`, so nobody else can read a wallet's limits or
 * cancel its copies. Neither costs gas.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSignMessage } from "wagmi";
import { TriangleAlert } from "lucide-react";

import { followerProofMessage } from "@/lib/copy-trading";
import {
  listCopyPermissions,
  revokeCopyPermission,
  type CopyApiResult,
  type CopyPermissionView,
} from "@/lib/copy-client";
import { txErrorMessage } from "@/lib/tx-errors";
import CopyPermissionCard from "./CopyPermissionCard";

interface CopyPermissionListProps {
  address: string;
  onDisabled: () => void;
}

interface Loaded {
  permissions: CopyPermissionView[];
  at: number;
}

export default function CopyPermissionList({ address, onDisabled }: CopyPermissionListProps) {
  const t = useTranslations("copy");
  const { signMessageAsync } = useSignMessage();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Folds a failed API result into UI state; returns the data on success. */
  function unwrap<T>(result: CopyApiResult<T>): T | null {
    if (result.kind === "ok") return result.data;
    if (result.kind === "disabled") onDisabled();
    else setError(t("requestFailed", { message: result.message }));
    return null;
  }

  async function load() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const at = Date.now();
      const signature = await signMessageAsync({ message: followerProofMessage("list", address, at) });
      const data = unwrap(await listCopyPermissions(address, at, signature));
      if (data) setLoaded({ permissions: data.permissions ?? [], at: Date.now() });
    } catch (err) {
      setError(txErrorMessage(err, t("signatureFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    setNotice(null);
    setRevokingId(id);
    try {
      const at = Date.now();
      const signature = await signMessageAsync({
        message: followerProofMessage("revoke", address, at, id),
      });
      const data = unwrap(await revokeCopyPermission(id, address, at, signature));
      if (data) {
        setLoaded((prev) =>
          prev
            ? { ...prev, permissions: prev.permissions.map((p) => (p.id === id ? { ...p, active: false } : p)) }
            : prev,
        );
        setNotice(t("card.revoked", { id }));
      }
    } catch (err) {
      setError(txErrorMessage(err, t("signatureFailed")));
    } finally {
      setRevokingId(null);
    }
  }

  const busy = loading || revokingId !== null;

  return (
    <section aria-labelledby="copy-list-heading" className="card rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 id="copy-list-heading" className="font-display text-sm font-bold uppercase tracking-[0.14em] text-pv-text">
            {t("list.title")}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-pv-muted">{t("list.desc")}</p>
        </div>
        <button
          type="button"
          className="btn-compact-primary focus-ring min-h-[44px] w-full px-4 py-2 font-display text-xs uppercase tracking-[0.14em] sm:w-auto"
          onClick={() => void load()}
          disabled={busy}
          aria-busy={loading || undefined}
        >
          {loading ? t("list.signing") : loaded ? t("list.reload") : t("list.load")}
        </button>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {notice ? <p className="mt-4 text-xs text-pv-text">{notice}</p> : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-pv-danger/30 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      {loaded ? (
        loaded.permissions.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-white/[0.15] px-4 py-6 text-center text-xs text-pv-muted">
            {t("list.empty")}
          </p>
        ) : (
          <>
            <p className="sr-only" role="status">
              {t("list.count", { count: loaded.permissions.length })}
            </p>
            <ul className="mt-4 space-y-3">
              {loaded.permissions.map((p) => (
                <li key={p.id}>
                  <CopyPermissionCard
                    permission={p}
                    now={loaded.at}
                    revoking={revokingId === p.id}
                    locked={busy}
                    onRevoke={(id) => void revoke(id)}
                  />
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}
