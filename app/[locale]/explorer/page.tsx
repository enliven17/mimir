import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import ExploreClient from "./ExploreClient";

type ExplorePageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: ExplorePageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "explore" });
  const tMeta = await getTranslations({ locale, namespace: "metadata" });
  const siteLine = tMeta("title");
  const brand = siteLine.split("—")[0]?.trim() ?? "PROVEN";
  const pageTitle = `${t("title")} · ${brand}`;
  return {
    title: pageTitle,
    description: t("subtitle"),
    openGraph: {
      title: pageTitle,
      description: t("subtitle"),
    },
  };
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreLoading />}>
      <ExploreClient />
    </Suspense>
  );
}
function ExploreLoading() {
  return (
    <div className="animate-pulse space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-40 rounded bg-pv-surface2" />
      <div className="h-10 w-full max-w-2xl rounded bg-pv-surface2 sm:h-12" />
      <div className="h-11 w-full max-w-2xl rounded bg-pv-surface2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-52 rounded border border-white/[0.06] bg-pv-surface2/80" />
        <div className="h-52 rounded border border-white/[0.06] bg-pv-surface2/80" />
        <div className="h-52 rounded border border-white/[0.06] bg-pv-surface2/80" />
      </div>
    </div>
  );
}

