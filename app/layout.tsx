import "./globals.css";
import { fontDisplay, fontBody, fontMono } from "@/lib/fonts";
import { WalletProvider } from "@/lib/wallet";
import { XmtpProvider } from "@/lib/xmtp/XmtpProvider";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";
import { WagmiProviders } from "@/lib/wagmi-providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}
    >
      <body className="overflow-x-hidden">
        <NextTopLoader
          color="#22D3EE"
          height={2}
          showSpinner={false}
          shadow={false}
        />
        <WagmiProviders>
          <WalletProvider>
            <XmtpProvider>
              {children}
            </XmtpProvider>
            <Toaster
              position="bottom-center"
              theme="dark"
              toastOptions={{
                style: {
                  background: "#18181B",
                  border: "1px solid #27272A",
                  color: "#FAFAFA",
                  borderRadius: 16,
                  fontFamily: "var(--font-body)",
                },
              }}
            />
          </WalletProvider>
        </WagmiProviders>
      </body>
    </html>
  );
}
