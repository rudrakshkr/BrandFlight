import assert from "node:assert/strict";
import test from "node:test";
import { findUnverifiedNumericClaims } from "../src/lib/numeric-claims.js";
import { findPiiRanges } from "../src/lib/pii-masking.js";

test("ignores numeric fragments inside detected PII while retaining genuine numeric claims", () => {
  const content = [
    "Email demo99@example.com.",
    "Phone +91 98765 43210.",
    "UPI demo123@okaxis.",
    "PAN ABCDE1234F.",
    "Aadhaar 2345 6789 0123.",
    "Card 4111 1111 1111 1111.",
    "Plans start at ₹499 per month, onboarding takes 10 minutes, and trial lasts 7 days.",
    "Our performance improves by 95%.",
  ].join(" ");
  const claims = findUnverifiedNumericClaims(
    content,
    [
      "Plans start at ₹499 per month.",
      "Onboarding takes 10 minutes.",
      "The trial lasts 7 days.",
    ],
    findPiiRanges(content),
  );

  assert.deepEqual(claims, ["95%"]);
});

test("does not suppress genuine unsupported numerical claims adjacent to PII", () => {
  const content = "Call 98765 43210. Results improve by 95% in 2 days.";
  const claims = findUnverifiedNumericClaims(content, [], findPiiRanges(content));

  assert.deepEqual(claims, ["95%", "2 days"]);
});

test("preserves the existing approved-fact matching and duplicate suppression", () => {
  const content = "Plans are ₹499. A second plan also costs ₹499; the trial is 14 days.";
  assert.deepEqual(
    findUnverifiedNumericClaims(content, ["Plans start at ₹499 per month."]),
    ["14 days"],
  );
});
