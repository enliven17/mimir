import type { Metadata } from "next";

import BasketComposerClient from "./BasketComposerClient";

export const metadata: Metadata = {
  title: "Compose a basket · Mimir",
  description:
    "Pick agents, set weights, state a thesis. Publishing a basket costs nothing and moves nothing.",
};

export default function BasketComposerPage() {
  return <BasketComposerClient />;
}
