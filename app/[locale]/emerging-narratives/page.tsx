import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import EmergingNarrativesClient from "./EmergingNarrativesClient";

type EmergingNarrativesPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: EmergingNarrativesPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "emergingNarratives" });
  const tMeta = await getTranslations({ locale, namespace: "metadata" });
  const siteLine = tMeta("title");
  const brand = siteLine.split("—")[0]?.trim() ?? "PROVEN";
  const pageTitle = `${t("title")} · ${brand}`;

  return {
    title: pageTitle,
    description: t("lead"),
    openGraph: {
      title: pageTitle,
      description: t("lead"),
    },
  };
}

export default function EmergingNarrativesPage() {
  return <EmergingNarrativesClient />;
}

