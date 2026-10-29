import assert from "node:assert/strict";
import test from "node:test";
import {
  auditConfigHash,
  createAuditReceiptId,
  imageAuditInputHash,
  sha256Text,
  type AuditBrandConfiguration,
} from "../src/lib/audit-receipts.js";

const brand: AuditBrandConfiguration = {
  id: "brand-test",
  brandColors: ["#ffffff", "#123456"],
  rules: [
    { ruleCode: "TERM-01", category: "TERMINOLOGY", title: "Avoid term", description: "Do not use the banned term.", pattern: "\\bforbidden\\b" },
    { ruleCode: "ACCESS-01", category: "ACCESSIBILITY", title: "Add alt text", description: "Alt text is required.", pattern: null },
  ],
  facts: [{ factCode: "FACT-01", claim: "Plans start at 499 per month.", sourceLabel: "Demo facts", sourceUrl: null }],
  assets: [],
};

test("text hashes are stable and sensitive to input changes", () => {
  assert.equal(sha256Text("copy"), sha256Text("copy"));
  assert.notEqual(sha256Text("copy"), sha256Text("copy "));
});

test("audit receipt IDs are unpredictable-looking unique hex strings", () => {
  const first = createAuditReceiptId();
  const second = createAuditReceiptId();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("text config hash reflects rules/facts but is independent of ordering", () => {
  const reversed = { ...brand, rules: [...brand.rules].reverse(), facts: [...brand.facts].reverse() };
  assert.equal(auditConfigHash(brand, "TEXT"), auditConfigHash(reversed, "TEXT"));
  assert.notEqual(auditConfigHash(brand, "TEXT"), auditConfigHash({ ...brand, facts: [{ ...brand.facts[0], claim: "Different approved claim." }] }, "TEXT"));
});

test("image config hash includes brand colors while text config hash excludes them", () => {
  const changedPalette = { ...brand, brandColors: ["#000000"] };
  assert.equal(auditConfigHash(brand, "TEXT"), auditConfigHash(changedPalette, "TEXT"));
  assert.notEqual(auditConfigHash(brand, "IMAGE"), auditConfigHash(changedPalette, "IMAGE"));
});

test("image input hash binds the image asset and trimmed alt text", () => {
  const asset = { secureUrl: "https://res.cloudinary.com/demo/image/upload/example.png", publicId: "test/example" };
  assert.equal(imageAuditInputHash(asset, " Banner alt "), imageAuditInputHash(asset, "Banner alt"));
  assert.notEqual(imageAuditInputHash(asset, "Banner alt"), imageAuditInputHash(asset, "Different alt"));
  assert.notEqual(imageAuditInputHash(asset, "Banner alt"), imageAuditInputHash({ ...asset, publicId: "test/other" }, "Banner alt"));
});
