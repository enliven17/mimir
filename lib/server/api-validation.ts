import { enabledChainKeys, isChainKey, type ChainKey } from "@/lib/chains";
import { isAddress } from "viem";

export const INVITE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type ApiErrorShape = {
  error: {
    code: string;
    message: string;
  };
};

export function createApiError(code: string, message: string): ApiErrorShape {
  return {
    error: {
      code,
      message,
    },
  };
}

export function parsePositiveIntegerParam(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function parseAddressParam(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !isAddress(trimmed)) {
    return null;
  }

  return trimmed;
}

export function parseInviteKey(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  if (!INVITE_KEY_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * `?chain=` / body `chain`. Absent means Arc, so pre-multichain links and
 * clients keep working. Returns null for a name that is not a deployed chain,
 * which callers turn into a 400 rather than silently reading Arc.
 */
export function parseChainParam(value: unknown): ChainKey | null {
  if (value == null || value === "") return "arc";
  const key = isChainKey(value) ? value : null;
  return key && enabledChainKeys().includes(key) ? key : null;
}
