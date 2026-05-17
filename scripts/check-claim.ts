/** Quick read of claim #1 state on Arc. Run: npx tsx --env-file=.env.local scripts/check-claim.ts */
import { createArcPublicClient, getContractAddress } from "../lib/arc";
import { MIMIR_ABI, STATE } from "../lib/mimir-abi";

async function main(): Promise<void> {
  const id = Number(process.argv[2] ?? "1");
  const client = createArcPublicClient();
  const addr   = getContractAddress();
  const claim  = await client.readContract({
    address: addr, abi: MIMIR_ABI, functionName: "getClaim", args: [BigInt(id)],
  }) as readonly any[];
  const now = Math.floor(Date.now() / 1000);
  const dl  = Number(claim[8]);
  const state = Number(claim[9]);
  const stateName = Object.entries(STATE).find(([, v]) => v === state)?.[0] ?? `unknown(${state})`;

  console.log(`Claim #${id}`);
  console.log(`  question: ${claim[1]}`);
  console.log(`  state   : ${stateName}`);
  console.log(`  deadline: ${new Date(dl * 1000).toISOString()}  (in ${dl - now}s)`);
  console.log(`  expired : ${now > dl}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
