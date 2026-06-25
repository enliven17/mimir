"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

export type ListboxFieldOption = { value: string; label: string };

export type ListboxFieldProps = {
  /** id estable para accesibilidad (sin espacios) */
  id: string;
  label: string;
  value: string;
  options: ListboxFieldOption[];
  onChange: (value: string) => void;
  /** Si el botón necesita aria-label distinto del texto visible */
  ariaLabel?: string;
};

/**
 * Desplegable estilo Explorer (SORT BY): trigger tipo `input` + panel listbox con portal
 * para no quedar recortado bajo `overflow-hidden` (p. ej. GlassCard).
 */
export default function ListboxField({
  id,
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: ListboxFieldProps) {
  const reactId = useId();
  const baseId = `${id}-${reactId.replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: r.left,
      width: r.width,
    });
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollResize = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open, updatePos]);

  const listboxId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const triggerId = `${baseId}-trigger`;

  const panel =
    mounted &&
    typeof document !== "undefined" &&
    open &&
    pos &&
    createPortal(
      <motion.div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-labelledby={labelId}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 80,
        }}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="overflow-hidden rounded border border-white/[0.1] bg-pv-bg py-1 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.85)]"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={value === opt.value}
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            className={`flex w-full items-center px-4 py-2.5 text-left font-body text-sm transition-colors ${
              value === opt.value
                ? "bg-pv-emerald/[0.12] font-medium text-pv-emerald"
                : "text-pv-muted hover:bg-white/[0.05] hover:text-pv-text"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </motion.div>,
      document.body
    );

  return (
    <div ref={wrapRef} className="min-w-0 space-y-2">
      <label id={labelId} htmlFor={triggerId} className="block text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">
        {label}
      </label>
      <button
        type="button"
        id={triggerId}
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => setOpen((o) => !o)}
        className="input flex h-11 min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 bg-pv-bg py-0 pr-3 text-left font-body text-sm text-pv-text transition-[border-color,box-shadow] hover:border-white/[0.14]"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-pv-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {panel}
    </div>
  );
}
