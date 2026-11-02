import assert from "node:assert/strict";
import test from "node:test";
import { validateCreatorUpdateSummary, validateReviewDecision } from "../src/lib/review-validation.js";

test("approval may omit a note", () => {
  assert.deepEqual(validateReviewDecision("APPROVED", undefined), {
    valid: true,
    status: "APPROVED",
  });
});

test("approval trims and retains an optional note", () => {
  assert.deepEqual(validateReviewDecision("APPROVED", "  Looks good.  "), {
    valid: true,
    status: "APPROVED",
    note: "Looks good.",
  });
});

test("change requests require at least 10 characters of actionable feedback", () => {
  for (const note of [undefined, "", "   ", "Too short"]) {
    const result = validateReviewDecision("CHANGES_REQUESTED", note);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.error, /at least 10 characters/i);
  }
});

test("change requests accept a trimmed reason", () => {
  assert.deepEqual(validateReviewDecision("CHANGES_REQUESTED", "  Add the approved source for the claim.  "), {
    valid: true,
    status: "CHANGES_REQUESTED",
    note: "Add the approved source for the claim.",
  });
});

test("invalid statuses, non-string notes, and oversized notes are rejected", () => {
  assert.equal(validateReviewDecision("DRAFT", "note").valid, false);
  assert.equal(validateReviewDecision("APPROVED", 42).valid, false);
  assert.equal(validateReviewDecision("APPROVED", "x".repeat(2001)).valid, false);
});

test("creator update summaries require 10 to 1,000 characters and are trimmed", () => {
  assert.deepEqual(validateCreatorUpdateSummary("  Updated the headline and fixed the claim.  "), {
    valid: true,
    summary: "Updated the headline and fixed the claim.",
  });
  assert.equal(validateCreatorUpdateSummary("123456789").valid, false);
  assert.equal(validateCreatorUpdateSummary("x".repeat(1001)).valid, false);
});
