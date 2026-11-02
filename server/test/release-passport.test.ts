import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  createReleasePassport,
  verifyReleasePassportHash,
  type ReleasePassportSnapshot,
} from "../src/lib/release-passport.js";

const snapshot: ReleasePassportSnapshot = {
  schemaVersion: 1,
  campaign: {
    submissionId: "submission-1",
    title: "Q4 launch",
    brandProfileId: "brand-1",
    brandName: "Northstar Workspace",
    contentHash: "a".repeat(64),
    imageInputHash: null,
  },
  audit: {
    text: { receiptId: "receipt-text", inputHash: "b".repeat(64), configHash: "c".repeat(64), resultHash: "d".repeat(64), semanticStatus: "completed" },
    image: null,
  },
  approval: {
    decision: "APPROVED",
    reviewerId: "reviewer-1",
    reviewerName: "Demo Reviewer",
    approvedAt: "2026-10-31T00:00:00.000Z",
  },
};

test("canonical JSON is independent of object key insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, x: false } }), canonicalJson({ a: { x: false, y: true }, z: 1 }));
});

test("release passport digest verifies the issued snapshot", () => {
  const passport = createReleasePassport(snapshot, "x".repeat(40));
  assert.match(passport.passportHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyReleasePassportHash(passport.snapshot, passport.passportHash, "x".repeat(40)), true);
});

test("release passport digest detects a modified snapshot", () => {
  const passport = createReleasePassport(snapshot, "x".repeat(40));
  const altered = {
    ...passport.snapshot,
    campaign: { ...passport.snapshot.campaign, title: "Changed after approval" },
  };
  assert.equal(verifyReleasePassportHash(altered, passport.passportHash, "x".repeat(40)), false);
});

test("release passport digest is bound to the signing secret", () => {
  const first = createReleasePassport(snapshot, "a".repeat(40));
  assert.equal(verifyReleasePassportHash(first.snapshot, first.passportHash, "b".repeat(40)), false);
});


test("release passport signature covers reviewer override reasons and linked findings", () => {
  const passport = createReleasePassport({
    ...snapshot,
    approval: {
      ...snapshot.approval,
      override: {
        reason: "The logo is visibly present in the lower-right corner of the artwork.",
        highRiskFindings: [{
          severity: "ERROR",
          category: "VISUAL",
          ruleCode: "VISUAL-01",
          title: "Required logo was not detected",
        }],
        warnings: [],
      },
    },
  }, "x".repeat(40));
  assert.equal(verifyReleasePassportHash(passport.snapshot, passport.passportHash, "x".repeat(40)), true);

  const altered = {
    ...passport.snapshot,
    approval: {
      ...passport.snapshot.approval,
      override: {
        ...passport.snapshot.approval.override!,
        reason: "A different reason was substituted after approval.",
      },
    },
  };
  assert.equal(verifyReleasePassportHash(altered, passport.passportHash, "x".repeat(40)), false);
});
