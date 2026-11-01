import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastRatio,
  parseAccessibilityColorPairs,
  recommendAccessibleForeground,
  type AccessibilityColorPair,
} from "../src/lib/wcag-contrast.js";

const validPairs: AccessibilityColorPair[] = [
  { role: "BODY_TEXT", foreground: "#17262A", background: "#FFFFFF" },
  { role: "HEADING", foreground: "#115E59", background: "#EAF5F1" },
  { role: "CTA_TEXT", foreground: "#FFFFFF", background: "#115E59" },
  { role: "CAPTION", foreground: "#354442", background: "#FFFFFF" },
  { role: "UI_ELEMENT", foreground: "#115E59", background: "#FFFFFF" },
];

test("contrast ratio uses WCAG relative luminance reference values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.ok(Math.abs((contrastRatio("#777777", "#FFFFFF") ?? 0) - 4.478) < 0.002);
  assert.equal(contrastRatio("bad", "#FFFFFF"), null);
});

test("role colour pairs require all five known roles and compliant ratios", () => {
  const parsed = parseAccessibilityColorPairs(validPairs);
  assert.equal(parsed?.length, 5);
  assert.equal(parseAccessibilityColorPairs(validPairs.slice(1)), null);
  assert.equal(parseAccessibilityColorPairs([...validPairs.slice(0, 4), { ...validPairs[4], role: "CTA_TEXT" }]), null);
  assert.equal(parseAccessibilityColorPairs([...validPairs.slice(0, 4), { ...validPairs[4], foreground: "#FFFFFF", background: "#FDFDFD" }]), null);
});

test("accessible foreground recommendation reaches the requested minimum", () => {
  const recommendation = recommendAccessibleForeground("#777777", "#FFFFFF", 4.5);
  assert.ok(recommendation);
  assert.ok((contrastRatio(recommendation!, "#FFFFFF") ?? 0) >= 4.5);
  assert.equal(recommendAccessibleForeground("#777777", "bad", 4.5), null);
});
