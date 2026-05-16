/**
 * Circle W3S (Programmable Wallets) signer for Mimir agents.
 *
 * Replaces raw private-key signing for oracle + market-creator agents.
 * The agents own no keys locally — Circle holds them, we authenticate via:
 *   - CIRCLE_API_KEY (bearer)
 *   - CIRCLE_ENTITY_SECRET → encrypted per-request with Circle's RSA pubkey
 *
 * Flow for a contract write:
 *   1. POST /v1/w3s/developer/transactions/contractExecution → transactionId
 *   2. Poll GET /v1/w3s/transactions/:id until state ∈ {CONFIRMED, FAILED, …}
 *   3. Return txHash
 *
 * Reads stay on Arc RPC via viem (publicClient).
 */

import { publicEncrypt, constants, createPublicKey, randomUUID } from "node:crypto";
import type { AbiFunction, AbiParameter, Hex } from "viem";

const CIRCLE_BASE = "https://api.circle.com/v1/w3s";

let cachedPublicKey: string | null = null;
let cachedPublicKeyAt = 0;
const PUBLIC_KEY_TTL_MS = 5 * 60 * 1000;

function getApiKey(): string {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("CIRCLE_API_KEY missing");
  return key;
}

function getEntitySecret(): string {
  const secret = process.env.CIRCLE_ENTITY_SECRET;
  if (!secret) throw new Error("CIRCLE_ENTITY_SECRET missing");
  return secret;
}

async function fetchCirclePublicKey(): Promise<string> {
  const now = Date.now();
  if (cachedPublicKey && now - cachedPublicKeyAt < PUBLIC_KEY_TTL_MS) return cachedPublicKey;
  const res = await fetch(`${CIRCLE_BASE}/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${getApiKey()}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Circle publicKey fetch: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data?: { publicKey?: string } };
  if (!json?.data?.publicKey) throw new Error("Missing publicKey in Circle response");
  cachedPublicKey = json.data.publicKey;
  cachedPublicKeyAt = now;
  return cachedPublicKey;
}

async function encryptEntitySecret(): Promise<string> {
  const pem = await fetchCirclePublicKey();
  const key = createPublicKey({ key: pem, format: "pem" });
  const buf = Buffer.from(getEntitySecret(), "hex");
  const cipher = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    buf,
  );
  return cipher.toString("base64");
}

async function circleFetch<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CIRCLE_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

// ── Transaction submission ────────────────────────────────────────────────────

interface ContractExecResponse {
  data: { id: string; state: string };
}

interface TransactionResponse {
  data: {
    transaction: {
      id: string;
      state: string;
      txHash?: string;
      errorReason?: string;
      blockchain: string;
    };
  };
}

export interface ExecuteContractArgs {
  walletId: string;
  contractAddress: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  amount?: string;
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  refId?: string;
}

const TERMINAL_OK = new Set(["COMPLETE", "CONFIRMED"]);
const TERMINAL_BAD = new Set(["FAILED", "CANCELLED", "DENIED"]);

/**
 * Submit a contract execution via W3S and wait until the on-chain tx is confirmed.
 * Returns the tx hash. Throws on terminal failure or timeout.
 */
export async function executeContract(args: ExecuteContractArgs): Promise<Hex> {
  const ciphertext = await encryptEntitySecret();

  const body: Record<string, unknown> = {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: ciphertext,
    walletId: args.walletId,
    contractAddress: args.contractAddress,
    abiFunctionSignature: args.abiFunctionSignature,
    abiParameters: args.abiParameters,
    feeLevel: args.feeLevel ?? "MEDIUM",
  };
  if (args.amount) body.amount = args.amount;
  if (args.refId) body.refId = args.refId;

  const resp = await circleFetch<ContractExecResponse>(
    "POST",
    "/developer/transactions/contractExecution",
    body,
  );
  return await waitForTxHash(resp.data.id);
}

async function waitForTxHash(transactionId: string, timeoutMs = 90_000): Promise<Hex> {
  const start = Date.now();
  let delay = 1500;
  while (Date.now() - start < timeoutMs) {
    const resp = await circleFetch<TransactionResponse>("GET", `/transactions/${transactionId}`);
    const t = resp.data.transaction;
    if (TERMINAL_OK.has(t.state) && t.txHash) return t.txHash as Hex;
    if (TERMINAL_BAD.has(t.state)) {
      throw new Error(`W3S tx ${transactionId} ${t.state}: ${t.errorReason ?? "unknown"}`);
    }
    await sleep(delay);
    delay = Math.min(delay + 500, 5000);
  }
  throw new Error(`W3S tx ${transactionId} did not confirm within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a viem-style ABI function (from MIMIR_ABI) into Circle's expected
 * `abiFunctionSignature` string, e.g. "resolveClaim(uint256,uint8,string,uint8,bytes32)".
 */
export function buildAbiFunctionSignature(
  fnName: string,
  abi: ReadonlyArray<unknown>,
): string {
  const fn = abi.find(
    (item): item is AbiFunction =>
      typeof item === "object" && item !== null && (item as AbiFunction).type === "function" && (item as AbiFunction).name === fnName,
  );
  if (!fn) throw new Error(`Function ${fnName} not found in ABI`);
  const types = (fn.inputs as AbiParameter[]).map((i) => i.type).join(",");
  return `${fnName}(${types})`;
}

/**
 * Convert JS args to Circle's `abiParameters` array.
 * Circle expects primitive types as strings for uint/bytes/address; objects pass through.
 */
export function toCircleAbiParameters(args: readonly unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === "bigint") return a.toString();
    if (typeof a === "number") return a.toString();
    return a;
  });
}

// ── Wallet info ───────────────────────────────────────────────────────────────

interface WalletInfoResponse {
  data: { wallet: { id: string; address: string; blockchain: string; state: string } };
}

export async function getWalletInfo(walletId: string) {
  const resp = await circleFetch<WalletInfoResponse>("GET", `/wallets/${walletId}`);
  return resp.data.wallet;
}

export function getOracleWalletId(): string {
  const id = process.env.CIRCLE_ORACLE_WALLET_ID;
  if (!id) throw new Error("CIRCLE_ORACLE_WALLET_ID missing");
  return id;
}

export function getOracleAddress(): `0x${string}` {
  const addr = process.env.CIRCLE_ORACLE_ADDRESS;
  if (!addr) throw new Error("CIRCLE_ORACLE_ADDRESS missing");
  return addr as `0x${string}`;
}

export function getMarketCreatorWalletId(): string {
  const id = process.env.CIRCLE_CREATOR_WALLET_ID;
  if (!id) throw new Error("CIRCLE_CREATOR_WALLET_ID missing");
  return id;
}

export function getMarketCreatorAddress(): `0x${string}` {
  const addr = process.env.CIRCLE_CREATOR_ADDRESS;
  if (!addr) throw new Error("CIRCLE_CREATOR_ADDRESS missing");
  return addr as `0x${string}`;
}
