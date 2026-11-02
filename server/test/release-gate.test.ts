import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateReleaseGate,
  formatReviewerOverrideComment,
  getReleaseGateApprovalError,
  MIN_REVIEWER_OVERRIDE_LENGTH,
} from "../src/lib/release-gate.js";

test("no findings produces a ready release gate", () => {
  const gate = evaluateReleaseGate([]);
  assert.equal(gate.status, "READY");
  assert.equal(getReleaseGateApprovalError(gate), null);
});

test("missing required alt text is a deterministic hard stop that a note cannot override", () => {
  const gate = evaluateReleaseGate([
    { severity: "ERROR", category: "ACCESSIBILITY", ruleCode: "ACCESSIBILITY-01", title: "Image alt text is missing" },
  ]);
  assert.equal(gate.status, "BLOCKED");
  assert.equal(gate.hardStops.length, 1);
  assert.match(getReleaseGateApprovalError(gate, "The image is decorative and has no meaningful content."), /cannot override this requirement/);
});

test("AI-detected high-risk findings require a meaningful human override, not an automatic veto", () => {
  const gate = evaluateReleaseGate([
    { severity: "ERROR", category: "VISUAL", ruleCode: "VISUAL-01", title: "Required logo was not detected" },
  ]);
  assert.equal(gate.status, "REQUIRES_OVERRIDE");
  assert.equal(gate.highRiskFindings.length, 1);
  assert.match(getReleaseGateApprovalError(gate) ?? "", /reviewer override reason/);
  assert.equal(
    getReleaseGateApprovalError(gate, "The logo is present in the lower-right corner of the artwork."),
    null,
  );
});

test("short override reasons are rejected", () => {
  const gate = evaluateReleaseGate([{ severity: "WARNING", title: "Contrast needs manual review" }]);
  assert.equal(MIN_REVIEWER_OVERRIDE_LENGTH, 10);
  assert.ok(getReleaseGateApprovalError(gate, "Too short"));
});

test("warnings require an explicit reviewer override reason", () => {
  const gate = evaluateReleaseGate([
    { severity: "WARNING", category: "ACCESSIBILITY", ruleCode: "ACCESSIBILITY-02", title: "Text contrast needs manual review" },
  ]);
  assert.equal(gate.status, "REQUIRES_OVERRIDE");
  assert.equal(gate.warnings.length, 1);
  assert.equal(
    getReleaseGateApprovalError(gate, "This background varies; I checked the exported design manually."),
    null,
  );
});

test("override activity binds the reason to the exact overridable findings", () => {
  const gate = evaluateReleaseGate([
    { severity: "ERROR", category: "VISUAL", ruleCode: "VISUAL-01", title: "Required logo was not detected" },
    { severity: "WARNING", category: "VISUAL", ruleCode: "VISUAL-01", title: "Palette differs" },
  ]);
  const comment = formatReviewerOverrideComment("The logo is present, and this alternate palette was approved.", gate);
  assert.match(comment, /Reason: The logo is present/);
  assert.match(comment, /VISUAL-01: Required logo was not detected/);
  assert.match(comment, /VISUAL-01: Palette differs/);
});

test("informational findings do not require an override", () => {
  const gate = evaluateReleaseGate([{ severity: "INFO", title: "Optional logo is not configured" }]);
  assert.equal(gate.status, "READY");
  assert.equal(getReleaseGateApprovalError(gate), null);
});

test("duplicate receipt findings are listed only once", () => {
  const gate = evaluateReleaseGate([
    { severity: "WARNING", category: "ACCESSIBILITY", ruleCode: "ACCESSIBILITY-02", title: "Text contrast needs manual review" },
    { severity: "WARNING", category: "ACCESSIBILITY", ruleCode: "ACCESSIBILITY-02", title: "Text contrast needs manual review" },
  ]);
  assert.equal(gate.warnings.length, 1);
});

test("a 10-character reviewer reason satisfies the override minimum", () => {
  const gate = evaluateReleaseGate([{ severity: "WARNING", title: "Contrast needs manual review" }]);
  assert.equal(getReleaseGateApprovalError(gate, "1234567890"), null);
});
