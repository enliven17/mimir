/**
 * Storage for verdict audit bundles, keyed by the hash committed on chain.
 *
 * Not `server-only`: the oracle worker writes here outside the Next runtime.
 * Content-addressed, so a write is idempotent and a row can never be edited
 * into something else without its key stopping matching the chain.
 */
import { query } from "../db";
import { sealBundle, type VerdictBundle } from "../verdict-bundle";

export async function saveVerdictBundle(bundle: VerdictBundle): Promise<`0x${string}`> {
  const { canonical, hash } = sealBundle(bundle);
  await query(
    `INSERT INTO verdict_bundles(hash, chain, claim_id, bundle, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING`,
    [hash, bundle.chain, bundle.claimId, canonical, Date.now()],
  );
  return hash;
}

/** The canonical JSON text stored under a hash, exactly as it was hashed. */
export async function getVerdictBundleText(hash: string): Promise<string | null> {
  const rows = await query("SELECT bundle FROM verdict_bundles WHERE hash = ?", [hash.toLowerCase()]);
  return rows[0] ? String(rows[0].bundle) : null;
}
