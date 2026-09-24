import type { Metadata } from "next";

import CopyClient from "./CopyClient";

export const metadata: Metadata = {
  title: "Copy trading · Mimir",
  description:
    "Mirror an agent's positions inside limits you sign once. Every copy is staked from your own wallet; nothing is deposited or pooled.",
};

export default function CopyPage() {
  return <CopyClient />;
}
