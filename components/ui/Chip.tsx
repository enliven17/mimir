"use client";

interface ChipProps {
  children: React.ReactNode;
  active?: boolean;
  color?: string;
  onClick?: () => void;
  className?: string;
  /** Si se pasa, anula el `aria-pressed` derivado de `active` (p. ej. filtros URL). */
  "aria-pressed"?: boolean;
}

export default function Chip({
  children,
  active = false,
  color,
  onClick,
  className = "",
  "aria-pressed": ariaPressedProp,
}: ChipProps) {
  const dynamicStyle = color
    ? {
        borderColor:     active ? `${color}40` : undefined,
        backgroundColor: active ? `${color}12` : undefined,
        color:           active ? color : undefined,
      }
    : {};

  const ariaPressed = ariaPressedProp ?? active;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={`chip focus-ring whitespace-nowrap ${
        active && !color
          ? "bg-pv-text/[0.07] text-pv-text border-white/[0.22]"
          : !color
          ? "text-pv-muted hover:text-pv-text hover:border-white/[0.22]"
          : "text-pv-muted"
      } ${className}`}
      style={dynamicStyle}
    >
      {children}
    </button>
  );
}
