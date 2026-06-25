"use client";

import { usePathname } from "@/i18n/navigation";

// Global blueprint rails: a left/right rule framing the content column on every
// page except home (which draws its own per-section borders). The negative top
// margin cancels the layout's navbar offset so the rails run all the way up to
// the navbar; the padding then pushes the page content clear of it.
export default function PageFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return <>{children}</>;
  return (
    <div className="-mt-[calc(3.5rem+env(safe-area-inset-top))] min-h-screen border-x border-pv-border/25 pt-[calc(5rem+env(safe-area-inset-top))]">
      {children}
    </div>
  );
}
