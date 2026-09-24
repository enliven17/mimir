"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { getPendingWithdrawals, withdrawPending } from "@/lib/contract";
import { getChain, type ChainKey } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import { useWallet } from "@/lib/wallet";
import { txErrorMessage } from "@/lib/tx-errors";

/**
 * Withdraw payouts parked in the escrow. Settlement pushes winnings straight
 * to the wallet; only a failed push parks them, so this stays disabled until
 * there is something to pull.
 */
export default function WithdrawPendingButton({ className }: { className: string }) {
  const t = useTranslations("dashboard");
  const { address } = useWallet();
  const [pending, setPending] = useState<Array<{ chain: ChainKey; usdc: number }>>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return setPending([]);
    setPending(await getPendingWithdrawals(address as `0x${string}`).catch(() => []));
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const total = pending.reduce((sum, p) => sum + p.usdc, 0);

  const withdraw = async () => {
    setBusy(true);
    try {
      for (const { chain, usdc } of pending) {
        const result = await withdrawPending(chain);
        toast.success(t("holdings.withdrawDone", { amount: formatUsdc(usdc), chain: getChain(chain).name }), {
          description: result.pending ? t("holdings.withdrawPendingConfirm") : undefined,
        });
      }
    } catch (err) {
      toast.error(txErrorMessage(err));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const disabled = busy || total <= 0;
  return (
    <button
      type="button"
      className={`${className} ${disabled ? "cursor-not-allowed opacity-90" : "cursor-pointer hover:border-pv-emerald/50 hover:text-pv-text"}`}
      disabled={disabled}
      onClick={withdraw}
      title={total > 0 ? t("holdings.withdrawAvailable", { amount: formatUsdc(total) }) : t("holdings.withdrawNone")}
    >
      <img
        src="/icons/wallet.svg"
        alt=""
        width={22}
        height={22}
        className="h-[22px] w-[22px] shrink-0 object-contain opacity-90 [filter:invert(1)]"
        aria-hidden
      />
      <span>
        {t("holdings.actionWithdraw")}
        {total > 0 ? ` · ${formatUsdc(total)}` : ""}
      </span>
    </button>
  );
}
