import { claimKey, type ChainKey } from "./chains";

const STORAGE_KEY = "proven.privateInviteKeys";

/**
 * Arc entries keep the bare id they were always stored under; other chains
 * use claimKey (`base:12`) because ids repeat across chains.
 */
function entryKey(vsId: number, chain: ChainKey): string {
  return chain === "arc" ? String(vsId) : claimKey(chain, vsId);
}

type PrivateInviteMap = Record<string, string>;

function readInviteMap(): PrivateInviteMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as PrivateInviteMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Failed to read stored private invite keys", error);
    return {};
  }
}

function writeInviteMap(value: PrivateInviteMap) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("Failed to persist private invite key", error);
  }
}

export function rememberPrivateInviteKey(vsId: number, inviteKey: string, chain: ChainKey = "arc") {
  if (!inviteKey) {
    return;
  }

  const current = readInviteMap();
  current[entryKey(vsId, chain)] = inviteKey;
  writeInviteMap(current);
}

export function getStoredPrivateInviteKey(vsId: number, chain: ChainKey = "arc") {
  const current = readInviteMap();
  return current[entryKey(vsId, chain)] ?? "";
}

export function generatePrivateInviteKey() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}
