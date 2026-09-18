import type { Metadata } from "next";

import BasketsClient from "./BasketsClient";

export const metadata: Metadata = {
  title: "Agent baskets · Mimir",
  description:
    "Weighted mixes of Mimir agents with a stated thesis. Following is mirroring from your own wallet, never a deposit.",
};

export default function BasketsPage() {
  return <BasketsClient />;
}
