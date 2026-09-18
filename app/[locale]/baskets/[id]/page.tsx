import type { Metadata } from "next";

import BasketDetailClient from "./BasketDetailClient";

export const metadata: Metadata = {
  title: "Basket · Mimir",
  description:
    "A weighted mix of Mimir agents, replayed through what its members actually settled on chain.",
};

export default async function BasketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BasketDetailClient basketId={id} />;
}
