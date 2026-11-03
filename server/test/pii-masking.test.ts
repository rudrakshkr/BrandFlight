import assert from "node:assert/strict";
import test from "node:test";
import { createPiiMaskingSession } from "../src/lib/pii-masking.js";

test("masks and restores common email, Indian phone, Aadhaar and PAN patterns", () => {
  const session = createPiiMaskingSession();
  const original = "Email help@example.com; call +91 98765 43210; PAN ABCDE1234F; Aadhaar 2345 6789 0123.";
  const masked = session.mask(original);

  assert.equal(masked.includes("help@example.com"), false);
  assert.equal(masked.includes("98765 43210"), false);
  assert.equal(masked.includes("ABCDE1234F"), false);
  assert.equal(masked.includes("2345 6789 0123"), false);
  assert.match(masked, /\[\[BFPII_[A-F0-9]+_EMAIL_\d{4}\]\]/);
  assert.equal(session.restore(masked), original);
  assert.equal(session.summary().totalUniqueValues, 4);
});

test("masks only Luhn-valid payment card numbers", () => {
  const session = createPiiMaskingSession();
  const valid = "Card 4111 1111 1111 1111";
  const invalid = "Reference 4111 1111 1111 1112";
  const maskedValid = session.mask(valid);
  const maskedInvalid = session.mask(invalid);

  assert.equal(maskedValid.includes("4111 1111 1111 1111"), false);
  assert.equal(session.restore(maskedValid), valid);
  assert.equal(maskedInvalid, invalid);
  assert.equal(session.summary().totalUniqueValues, 1);
});

test("reuses a token for the same sensitive value across prompt fields", () => {
  const session = createPiiMaskingSession();
  const first = session.mask("Contact help@example.com");
  const second = session.mask("Approved contact: help@example.com");
  const token = first.match(/\[\[BFPII_[A-F0-9]+_EMAIL_\d{4}\]\]/)?.[0];

  assert.ok(token);
  assert.equal(second.includes(token), true);
  assert.equal(session.summary().totalUniqueValues, 1);
  assert.equal(session.summary().categories[0]?.count, 1);
  assert.equal(session.restore(second), "Approved contact: help@example.com");
});

test("does not mask common marketing metrics, prices or durations", () => {
  const session = createPiiMaskingSession();
  const copy = "Plans start at ₹499, results vary, and onboarding takes 10 minutes. The trial lasts 7 days and the target is 95%.";

  assert.equal(session.mask(copy), copy);
  assert.deepEqual(session.summary(), {
    masked: false,
    totalUniqueValues: 0,
    categories: [],
  });
});

test("summary reports types and counts without exposing the sensitive values", () => {
  const session = createPiiMaskingSession();
  session.mask("mail help@example.com and support@example.com; phone 9876543210; UPI demo@okaxis");
  const serialized = JSON.stringify(session.summary());

  assert.equal(session.summary().totalUniqueValues, 4);
  assert.equal(serialized.includes("help@example.com"), false);
  assert.equal(serialized.includes("9876543210"), false);
  assert.equal(serialized.includes("demo@okaxis"), false);
  assert.deepEqual(session.summary().categories, [
    { type: "EMAIL", count: 2 },
    { type: "UPI_ID", count: 1 },
    { type: "INDIAN_PHONE", count: 1 },
  ]);
});

test("fails closed when an unknown request-scoped placeholder is returned", () => {
  const session = createPiiMaskingSession();
  const masked = session.mask("Contact help@example.com");
  const knownToken = masked.match(/\[\[BFPII_[A-F0-9]+_EMAIL_\d{4}\]\]/)?.[0];
  assert.ok(knownToken);
  const unknownToken = knownToken.replace("EMAIL_0001", "EMAIL_9999");

  assert.throws(
    () => session.restore(`Model output ${unknownToken}`),
    /unknown sensitive-data placeholder/i,
  );
});
