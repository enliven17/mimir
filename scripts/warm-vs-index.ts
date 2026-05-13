import { CONTRACT_ADDRESS } from "../lib/contract";
import { refreshVSIndex } from "../lib/server/vs-cache";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
    throw new Error(
      "Set NEXT_PUBLIC_CONTRACT_ADDRESS before warming the VS index"
    );
  }

  const snapshot = await refreshVSIndex();

  console.log(
    `Warmed VS index for ${snapshot.items.length} items from ${snapshot.contractAddress}`
  );
  console.log(`Snapshot time: ${new Date(snapshot.syncedAt).toISOString()}`);
}

main().catch((error) => {
  console.error("Failed to warm VS index:", error);
  process.exit(1);
});
