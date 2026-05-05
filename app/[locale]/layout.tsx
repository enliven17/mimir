import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import HtmlLang from "@/components/HtmlLang";
import SkipToContentLink from "../../components/SkipToContentLink";
import ScrollToTopOnLoad from "../../components/ScrollToTopOnLoad";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <HtmlLang locale={locale} />
      <SkipToContentLink />
      <ScrollToTopOnLoad />
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto min-w-0 max-w-[1200px] px-4 pb-8 pt-[calc(3.5rem+env(safe-area-inset-top)+1rem)] sm:px-6 sm:pb-8 sm:pt-[calc(3.5rem+env(safe-area-inset-top)+1.5rem)] lg:px-8"
      >
        {children}
      </main>
      <Footer />
    </NextIntlClientProvider>
  );
}
