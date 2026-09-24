"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { vsPath, type ChainKey } from "@/lib/chains";
import { useWallet } from "@/lib/wallet";

interface Item {
  id: number;
  chain: string;
  claimId: number;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

const POLL_MS = 60_000;
const seenKey = (address: string) => `mimir.notifications.seen.${address.toLowerCase()}`;

function readSeen(address: string): number {
  try {
    return Number(localStorage.getItem(seenKey(address)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function describe(item: Item): string {
  const q = String(item.payload.question ?? `claim #${item.claimId}`);
  if (item.kind === "challenged") return `New challenger on “${q}”`;
  if (item.kind === "resolved") {
    const won = item.payload.youWon;
    return won === true ? `You won “${q}”` : won === false ? `Settled against you: “${q}”` : `Refunded: “${q}”`;
  }
  return q;
}

/** In-app notifications for the connected wallet: challenges on your claims and settlements. */
export default function NotificationBell() {
  const { address, isConnected } = useWallet();
  const [items, setItems] = useState<Item[]>([]);
  const [seen, setSeen] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/notifications?address=${address}`);
      if (res.ok) setItems(((await res.json()) as { items: Item[] }).items ?? []);
    } catch {
      /* try again next poll */
    }
  }, [address]);

  useEffect(() => {
    if (!isConnected || !address) {
      setItems([]);
      return;
    }
    setSeen(readSeen(address));
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [address, isConnected, load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!isConnected || !address) return null;
  const unread = items.filter((i) => i.createdAt > seen).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items.length > 0) {
      const newest = Math.max(...items.map((i) => i.createdAt));
      setSeen(newest);
      try {
        localStorage.setItem(seenKey(address), String(newest));
      } catch {
        /* per-browser convenience only */
      }
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="chip relative flex h-8 w-8 items-center justify-center p-0 text-pv-muted hover:text-pv-text focus-ring"
      >
        <Bell size={15} aria-hidden />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-pv-emerald px-1 text-center font-mono text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-pv-border/50 bg-pv-surface shadow-xl">
          <p className="border-b border-pv-border/40 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-pv-muted">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-pv-muted">Nothing yet. Challenges on your claims and settlements show up here.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="border-b border-pv-border/20 last:border-0">
                  <Link
                    href={vsPath(item.claimId, item.chain as ChainKey)}
                    onClick={() => setOpen(false)}
                    className={`block px-4 py-3 text-sm hover:bg-white/[0.04] ${item.createdAt > seen ? "text-pv-text" : "text-pv-text/75"}`}
                  >
                    {describe(item)}
                    <span className="mt-0.5 block font-mono text-[10px] text-pv-muted">{new Date(item.createdAt).toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
