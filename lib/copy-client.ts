/**
 * Browser calls to `/api/copy/permissions` and `/api/agents/registry`.
 *
 * Every response is folded into one `CopyApiResult` so the page can tell the
 * three things apart that matter to a user: it worked, the feature is off on
 * this deployment, or the server refused with a reason worth showing.
 */

import type { CopyPermission } from "./copy-trading";

export interface CopyExecutionView {
  claimId: number;
  chain: string;
  executed: boolean;
  skipReason: string | null;
  stakeUsdc: number;
  txHash: string | null;
  at: number;
}

/** What GET returns per permission: the signature is stripped, the audit trail added. */
export type CopyPermissionView = Omit<CopyPermission, "signature"> & {
  recent: CopyExecutionView[];
};

export interface RegistryAgentView {
  agentId: string;
  displayName: string;
  status?: string;
}

export type CopyApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "disabled" }
  | { kind: "error"; status: number; reason: string; message: string };

const PERMISSIONS_URL = "/api/copy/permissions";

async function request<T>(url: string, init?: RequestInit): Promise<CopyApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch (err) {
    return { kind: "error", status: 0, reason: "network", message: err instanceof Error ? err.message : "network error" };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 404 && body.reason === "feature_disabled") return { kind: "disabled" };
  if (!res.ok) {
    return {
      kind: "error",
      status: res.status,
      reason: String(body.reason ?? "http_error"),
      message: String(body.message ?? `HTTP ${res.status}`),
    };
  }
  return { kind: "ok", data: body as T };
}

/**
 * Whether the copy endpoints are switched on, without asking for a signature.
 *
 * The route checks the feature flag before it looks at any parameter, so a bare
 * GET answers 404 feature_disabled when off and 400 bad_wallet when on.
 */
export async function probeCopyTrading(): Promise<"enabled" | "disabled" | "unknown"> {
  const result = await request<unknown>(PERMISSIONS_URL);
  if (result.kind === "disabled") return "disabled";
  if (result.kind === "error" && result.status === 0) return "unknown";
  return "enabled";
}

export function listCopyPermissions(follower: string, at: number, signature: string) {
  const q = new URLSearchParams({ follower, at: String(at), signature });
  return request<{ permissions?: CopyPermissionView[] }>(`${PERMISSIONS_URL}?${q}`);
}

export function revokeCopyPermission(id: string, follower: string, at: number, signature: string) {
  const q = new URLSearchParams({ id, follower, at: String(at), signature });
  return request<{ ok: true; revoked: string }>(`${PERMISSIONS_URL}?${q}`, { method: "DELETE" });
}

export function grantCopyPermission(body: Record<string, unknown>) {
  return request<{ ok: true; id: string; expiresAt: number }>(PERMISSIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listRegistryAgents(): Promise<RegistryAgentView[]> {
  const result = await request<{ agents?: RegistryAgentView[] }>("/api/agents/registry");
  if (result.kind !== "ok") return [];
  // The registry already hides revoked agents; this is belt and braces.
  return (result.data.agents ?? []).filter((a) => a.status !== "revoked");
}
