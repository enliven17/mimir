interface AvatarProps {
  side: "creator" | "opponent";
  size?: number;
}

export default function Avatar({ side, size = 48 }: AvatarProps) {
  const isCreator  = side === "creator";
  const colorClass = isCreator
    ? "border-pv-cyan/40 bg-pv-cyan/10"
    : "border-pv-fuch/40 bg-pv-fuch/10";
  const dotClass   = isCreator ? "bg-pv-cyan" : "bg-pv-fuch";
  const glowClass  = isCreator
    ? "shadow-[0_0_12px_rgba(93,230,255,0.4)]"
    : "shadow-[0_0_12px_rgba(248,172,255,0.4)]";

  return (
    <div
      className={`rounded border-2 flex items-center justify-center ${colorClass}`}
      style={{ width: size, height: size }}
    >
      <div
        className={`rounded ${dotClass} ${glowClass}`}
        style={{ width: size * 0.35, height: size * 0.35 }}
      />
    </div>
  );
}
