import { refreshVSIndex } from "../lib/server/vs-cache";
import { enabledChains } from "../lib/chains";

async function main() {
  const chains = enabledChains();
  if (chains.length === 0) {
    throw new Error(
      "Set NEXT_PUBLIC_CONTRACT_ADDRESS (and/or the Base/Arbitrum ones) before warming the VS index"
    );
  }

  const snapshot = await refreshVSIndex();

  console.log(
    `Warmed VS index for ${snapshot.items.length} items across ${chains.map((c) => c.name).join(", ")}`
  );
  console.log(`Snapshot time: ${new Date().toISOString()}`);
}

main().catch((error) => {
  console.error("Failed to warm VS index:", error);
  process.exit(1);
});
