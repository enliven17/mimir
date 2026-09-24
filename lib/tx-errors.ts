/**
 * One readable line for a failed wallet transaction.
 *
 * viem errors carry a multi-paragraph `message` (request body, docs links,
 * version) that is useless in a toast. The short message is on the error or
 * somewhere down its cause chain; a user rejecting the prompt is not a failure
 * worth a stack trace at all.
 */
export function txErrorMessage(err: unknown, fallback = "Transaction failed. Please try again."): string {
  const chain: Array<Record<string, unknown>> = [];
  let cur: unknown = err;
  for (let depth = 0; cur && typeof cur === "object" && depth < 8; depth++) {
    chain.push(cur as Record<string, unknown>);
    cur = (cur as { cause?: unknown }).cause;
  }

  const rejected = chain.some(
    (e) =>
      e.name === "UserRejectedRequestError" ||
      e.code === 4001 ||
      /user (rejected|denied)|rejected the request/i.test(String(e.shortMessage ?? e.message ?? "")),
  );
  if (rejected) return "You rejected the request in your wallet.";

  if (chain.some((e) => /insufficient funds/i.test(String(e.shortMessage ?? e.message ?? "")))) {
    return "Not enough funds in your wallet for this transaction and its gas.";
  }

  for (const e of chain) {
    const reason = e.reason ?? (e.data as { errorName?: string } | undefined)?.errorName;
    if (typeof reason === "string" && reason) return `Transaction reverted: ${reason}`;
  }
  for (const e of chain) {
    if (typeof e.shortMessage === "string" && e.shortMessage) return e.shortMessage;
  }
  const first = chain[0]?.message;
  if (typeof first === "string" && first) return first.split("\n")[0].slice(0, 200);
  return fallback;
}
