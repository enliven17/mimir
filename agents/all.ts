/**
 * Single-process worker entrypoint.
 *
 * Every agent module starts its own poll loop at import time, so importing is
 * all that is needed. One Node heap instead of three: `concurrently` ran three
 * full processes with three copies of viem, the ABI and the LLM client, which
 * is what pushed the container into its memory ceiling.
 *
 * A fatal error in any agent still calls process.exit(1) from inside that
 * module, which takes the whole fleet down and lets the platform restart it.
 * That is deliberate: a half-alive fleet is harder to reason about than a
 * restarted one.
 */
import "./oracle/index";
import "./market-creator/index";
import "./council/index";

const shutdown = (signal: string) => {
  console.log(`[workers] ${signal} received, exiting`);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("[workers] oracle + market-creator + council running in one process");
