import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalize,
  bodyHash,
  agentRequestMessage,
  operatorProofMessage,
  validateAgentRequestEnvelope,
  AgentEnvelopeError,
  AGENT_REQUEST_MAX_SKEW_MS,
  AGENT_API_ACTIONS,
  OWNER_SIGNED_ACTIONS,
} from "../../lib/agents/api";
import {
  generateApiKey,
  hashApiKey,
  apiKeyPrefix,
  hashesMatch,
  parseApiKeyHeader,
} from "../../lib/agents/api-keys";

const NOW = 1_700_000_000_000;

function envelope(over: Record<string, unknown> = {}) {
  return {
    version: "v1",
    agentId: "my-agent",
    action: "heartbeat",
    nonce: "abc",
    signedAt: NOW,
    body: { status: "ok" },
    ...over,
  };
}

test("canonicalization is key-order independent", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.equal(bodyHash({ b: 1, a: 2 }), bodyHash({ a: 2, b: 1 }));
});

test("canonicalization is not value-order independent for arrays", () => {
  assert.notEqual(canonicalize([1, 2]), canonicalize([2, 1]));
});

test("nested objects canonicalize recursively", () => {
  assert.equal(canonicalize({ a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1}}');
});

test("undefined and null bodies hash the same as an empty object", () => {
  assert.equal(bodyHash(undefined), bodyHash({}));
  assert.equal(bodyHash(null), bodyHash({}));
});

test("the signed message pins every field that matters", () => {
  const base = envelope();
  const message = agentRequestMessage(base as never);
  assert.match(message, /^Mimir Agent API request\n/);
  assert.match(message, /agent: my-agent/);
  assert.match(message, /action: heartbeat/);
  assert.match(message, new RegExp(`bodyHash: ${bodyHash(base.body)}`));

  // Changing the body after signing changes the hash, so the signature breaks.
  const tampered = agentRequestMessage({ ...base, body: { status: "evil" } } as never);
  assert.notEqual(message, tampered);
});

test("the operator proof names the agent and the wallet", () => {
  assert.equal(
    operatorProofMessage("my-agent", "0xAbC0000000000000000000000000000000000001"),
    "Mimir agent operator proof\nagent: my-agent\noperator: 0xabc0000000000000000000000000000000000001",
  );
});

test("a well-formed envelope validates", () => {
  const env = validateAgentRequestEnvelope(envelope(), { action: "heartbeat", now: NOW });
  assert.equal(env.agentId, "my-agent");
  assert.equal(env.action, "heartbeat");
});

test("a missing body defaults to an empty object rather than failing", () => {
  const env = validateAgentRequestEnvelope(
    { version: "v1", agentId: "my-agent", action: "heartbeat" },
    { action: "heartbeat", now: NOW },
  );
  assert.deepEqual(env.body, {});
});

test("structural rejections carry an explicit reason", () => {
  const cases: Array<[Record<string, unknown>, string, string]> = [
    [envelope({ version: "v2" }), "heartbeat", "bad_version"],
    [envelope(), "teleport", "unknown_action"],
    [envelope({ action: "revoke" }), "heartbeat", "action_mismatch"],
    [envelope({ agentId: "AB" }), "heartbeat", "bad_agent_id"],
    [envelope({ agentId: "-starts-with-dash" }), "heartbeat", "bad_agent_id"],
    [envelope({ body: [] }), "heartbeat", "bad_body"],
    [envelope({ nonce: "" }), "heartbeat", "bad_nonce"],
    [envelope({ nonce: "x".repeat(129) }), "heartbeat", "bad_nonce"],
    [envelope({ signedAt: "soon" }), "heartbeat", "bad_signed_at"],
    [envelope({ action: undefined }), "heartbeat", "missing_action"],
    [envelope({ sig: "0x00" }), "heartbeat", "unknown_field"],
  ];
  for (const [raw, action, reason] of cases) {
    try {
      validateAgentRequestEnvelope(raw, { action, now: NOW });
      assert.fail(`expected ${reason}`);
    } catch (err) {
      assert.ok(err instanceof AgentEnvelopeError, `${reason} threw the wrong error type`);
      assert.equal((err as AgentEnvelopeError).reason, reason);
    }
  }
});

test("an envelope outside the skew window is refused in both directions", () => {
  for (const drift of [AGENT_REQUEST_MAX_SKEW_MS + 1, -(AGENT_REQUEST_MAX_SKEW_MS + 1)]) {
    assert.throws(
      () => validateAgentRequestEnvelope(envelope({ signedAt: NOW + drift }), { action: "heartbeat", now: NOW }),
      (err: unknown) => (err as AgentEnvelopeError).reason === "stale_envelope",
    );
  }
  assert.doesNotThrow(() =>
    validateAgentRequestEnvelope(envelope({ signedAt: NOW - AGENT_REQUEST_MAX_SKEW_MS }), {
      action: "heartbeat",
      now: NOW,
    }),
  );
});

test("every owner-gated action is a real action", () => {
  for (const action of OWNER_SIGNED_ACTIONS) {
    assert.ok((AGENT_API_ACTIONS as readonly string[]).includes(action), action);
  }
});

test("keys are random, hashed and never recoverable from what is stored", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.notEqual(a, b);
  assert.match(a, /^mk_live_/);
  assert.match(generateApiKey("test"), /^mk_test_/);

  const hash = hashApiKey(a);
  assert.equal(hash.length, 64);
  assert.equal(hashApiKey(a), hash, "hashing is deterministic");
  assert.notEqual(hashApiKey(b), hash);
  assert.equal(hash.includes(a), false, "the key must not be embedded in its hash");
  assert.ok(a.startsWith(apiKeyPrefix(a)));
  assert.ok(apiKeyPrefix(a).length < a.length, "the stored prefix must not be the whole key");
});

test("hash comparison rejects mismatched and differently sized inputs", () => {
  const hash = hashApiKey("mk_live_whatever");
  assert.equal(hashesMatch(hash, hash), true);
  assert.equal(hashesMatch(hash, hashApiKey("other")), false);
  assert.equal(hashesMatch(hash, "short"), false);
});

test("only a bearer header carrying a Mimir key is accepted", () => {
  const key = generateApiKey();
  assert.equal(parseApiKeyHeader(`Bearer ${key}`), key);
  assert.equal(parseApiKeyHeader(`bearer ${key}`), key);
  assert.equal(parseApiKeyHeader(key), null, "a bare key is not a bearer header");
  assert.equal(parseApiKeyHeader("Bearer sk_live_somethingelse"), null);
  assert.equal(parseApiKeyHeader(null), null);
  assert.equal(parseApiKeyHeader(""), null);
});
