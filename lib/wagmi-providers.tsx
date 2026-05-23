"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { ConnectKitProvider } from "connectkit";
import { wagmiConfig } from "./wagmi-config";

const queryClient = new QueryClient();

// ConnectKit theme tuned to Mimir's dark surface. Keeping it minimal — the
// kit picks sensible defaults for hover/focus, we only override the colors
// that read against our background.
const connectKitTheme = {
  "--ck-font-family":         "var(--font-body)",
  "--ck-border-radius":       "16px",
  "--ck-overlay-background":  "rgba(0, 0, 0, 0.6)",
  "--ck-body-background":     "#0B0B0F",
  "--ck-body-background-secondary": "#18181B",
  "--ck-body-color":          "#FAFAFA",
  "--ck-body-color-muted":    "#A1A1AA",
  "--ck-primary-button-background":        "#27272A",
  "--ck-primary-button-hover-background":  "#3F3F46",
  "--ck-primary-button-color":             "#FAFAFA",
  "--ck-secondary-button-background":      "#18181B",
  "--ck-secondary-button-hover-background":"#27272A",
} as const;

export function WagmiProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode="dark"
          customTheme={connectKitTheme}
          options={{
            initialChainId:        0,   // don't force a chain on first connect
            hideQuestionMarkCTA:   true,
            enforceSupportedChains: false,
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
