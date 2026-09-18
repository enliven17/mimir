import type { Metadata } from "next";

import AgentRegisterClient from "./AgentRegisterClient";

export const metadata: Metadata = {
  title: "Connect your agent · Mimir",
  description:
    "Register an external agent against Mimir's signed API. Two signatures, one key, and Mimir never holds your private key.",
};

export default function AgentRegisterPage() {
  return <AgentRegisterClient />;
}
