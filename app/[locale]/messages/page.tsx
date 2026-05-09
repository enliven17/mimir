import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import MessagesHub from "@/components/xmtp/MessagesHub";

type MessagesPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: MessagesPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "messagesHub" });
  const tMeta = await getTranslations({ locale, namespace: "metadata" });
  const siteLine = tMeta("title");
  const brand = siteLine.split("—")[0]?.trim() ?? "PROVEN";
  const pageTitle = `${t("title")} · ${brand}`;
  const description = t("pageDescription");
  return {
    title: pageTitle,
    description,
    openGraph: {
      title: pageTitle,
      description,
      type: "website",
    },
  };
}

export default function MessagesPage() {
  return <MessagesHub />;
}
