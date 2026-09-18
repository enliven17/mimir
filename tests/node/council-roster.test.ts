import test from "node:test";
import assert from "node:assert/strict";

import {
  COUNCIL_PERSONAS,
  CLASSIC_PERSONAS,
  personasForTrack,
  personaAddressEnv,
  personaWalletIdEnv,
  getPersonaBySlug,
} from "../../agents/council/personas";
import { PHILOSOPHER_PERSONAS } from "../../agents/council/philosophers";

test("the roster is both juries, classic first", () => {
  assert.equal(CLASSIC_PERSONAS.length, 10);
  assert.equal(PHILOSOPHER_PERSONAS.length, 10);
  assert.equal(COUNCIL_PERSONAS.length, 20);
  assert.equal(COUNCIL_PERSONAS[0].slug, CLASSIC_PERSONAS[0].slug);
  assert.equal(COUNCIL_PERSONAS[10].slug, PHILOSOPHER_PERSONAS[0].slug);
});

test("slugs are unique across both tracks", () => {
  const slugs = COUNCIL_PERSONAS.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("env var names derived from slugs are unique and well-formed", () => {
  const names = COUNCIL_PERSONAS.map(personaAddressEnv);
  assert.equal(new Set(names).size, names.length, "two personas must not share a wallet env");
  for (const p of COUNCIL_PERSONAS) {
    assert.match(personaAddressEnv(p), /^CIRCLE_COUNCIL_[A-Z0-9_]+_ADDRESS$/);
    assert.match(personaWalletIdEnv(p), /^CIRCLE_COUNCIL_[A-Z0-9_]+_WALLET_ID$/);
  }
});

test("track filtering splits the roster exactly", () => {
  assert.equal(personasForTrack("classic").length, 10);
  assert.equal(personasForTrack("philosopher").length, 10);
  for (const p of personasForTrack("philosopher")) assert.equal(p.track, "philosopher");
  // The classic roster predates the field, so an unset track must mean classic.
  for (const p of personasForTrack("classic")) assert.equal(p.track ?? "classic", "classic");
});

test("every persona is resolvable by slug", () => {
  for (const p of COUNCIL_PERSONAS) {
    assert.equal(getPersonaBySlug(p.slug)?.displayName, p.displayName);
  }
  assert.equal(getPersonaBySlug("nobody"), null);
});

test("every philosopher carries the pieces the runner needs", () => {
  for (const p of PHILOSOPHER_PERSONAS) {
    assert.ok(p.promptBias && p.promptBias.length > 40, `${p.slug} needs a real prompt bias`);
    assert.match(p.promptBias!, /abstain|low confidence/i, `${p.slug} must be told when to abstain`);
    assert.ok(p.bio.length > 0 && p.longBio.length > 0, `${p.slug} needs copy for the UI`);
    assert.ok(
      p.minConfidence !== undefined && p.minConfidence >= 60 && p.minConfidence <= 95,
      `${p.slug} has an implausible confidence floor`,
    );
    assert.ok(p.stakeUsdc !== undefined && p.stakeUsdc > 0, `${p.slug} needs a stake size`);
    for (const key of ["border", "bg", "text", "chip"] as const) {
      assert.ok(p.accent[key].length > 0, `${p.slug} is missing accent.${key}`);
    }
  }
});

test("no persona invents evidence", () => {
  for (const p of COUNCIL_PERSONAS) {
    if (!p.promptBias) continue;
    assert.match(p.promptBias, /never invent/i, `${p.slug} must be told not to invent evidence`);
  }
});
