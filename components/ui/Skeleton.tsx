interface SkeletonProps {
  className?: string;
  lines?: number;
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-4 rounded-lg bg-pv-surface2 animate-shimmer ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

export default function Skeleton({ className = "", lines = 1 }: SkeletonProps) {
  if (lines === 1) {
    return <SkeletonLine className={className} />;
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          className={i === lines - 1 ? "w-3/4" : "w-full"}
        />
      ))}
    </div>
  );
}

export function VSCardSkeleton() {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex justify-between">
        <SkeletonLine className="w-20 h-5" />
        <SkeletonLine className="w-12 h-5" />
      </div>
      <SkeletonLine className="w-full h-6" />
      <SkeletonLine className="w-3/4 h-6" />
      <div className="flex gap-3">
        <SkeletonLine className="flex-1 h-16" />
        <SkeletonLine className="flex-1 h-16" />
      </div>
    </div>
  );
}

/** Matches ArenaCard layout (LIVE ARENA) for loading grids. */
export function ArenaCardSkeleton() {
  return (
    <div className="card relative flex h-full flex-col gap-6 overflow-hidden border-white/[0.12] bg-pv-surface p-6 sm:gap-8 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SkeletonLine className="h-6 w-20" />
        <SkeletonLine className="h-6 w-24" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonLine className="h-7 w-full" />
        <SkeletonLine className="h-7 w-[85%]" />
        <SkeletonLine className="mt-2 h-4 w-full" />
      </div>
      <div className="mt-auto space-y-4 border-t border-white/[0.1] pt-6">
        <SkeletonLine className="h-3 w-28" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex -space-x-2.5">
            <SkeletonLine className="h-8 w-8 rounded-full" />
            <SkeletonLine className="h-8 w-8 rounded-full" />
            <SkeletonLine className="h-8 w-8 rounded-full" />
          </div>
          <SkeletonLine className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}
