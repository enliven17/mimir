import { Space_Grotesk, Inter, Space_Mono } from "next/font/google";

export const fontDisplay = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const fontBody = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const fontMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "700"],
  display: "swap",
  fallback: ["monospace"],
});
