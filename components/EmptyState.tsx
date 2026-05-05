"use client";

import { motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import Button from "./ui/Button";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-16"
    >
      {/* rounded-full permitido para el ícono de estado */}
      <div className="w-16 h-16 rounded-full bg-pv-emerald/[0.1] border border-pv-emerald/[0.25] flex items-center justify-center mx-auto mb-5">
        <div className="font-display text-2xl font-bold text-pv-emerald">P</div>
      </div>
      <h3 className="font-display text-xl font-bold mb-2 tracking-tight">{title}</h3>
      <p className="text-sm text-pv-muted mb-6 max-w-[320px] sm:max-w-[280px] mx-auto">
        {description}
      </p>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="inline-block">
          <Button variant="primary" fullWidth={false} className="px-8">
            {actionLabel}
          </Button>
        </Link>
      )}
      {actionLabel && onAction && !actionHref && (
        <div className="flex justify-center">
          <Button
            variant="primary"
            fullWidth={false}
            className="px-8"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      )}
    </motion.div>
  );
}
