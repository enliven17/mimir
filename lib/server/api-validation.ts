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
