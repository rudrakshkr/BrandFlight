import assert from "node:assert/strict";
import test from "node:test";
import { validateReviewDecision } from "../src/lib/review-validation.js";

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

test("change requests require a non-empty reason", () => {
  for (const note of [undefined, "", "   "]) {
    const result = validateReviewDecision("CHANGES_REQUESTED", note);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.error, /reason is required/i);
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
