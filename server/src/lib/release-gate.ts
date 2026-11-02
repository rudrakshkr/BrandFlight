export type ReleaseGateStatus = "READY" | "REQUIRES_OVERRIDE" | "BLOCKED";

export type ReleaseGateFindingSummary =
  | { severity: "ERROR"; category: string; ruleCode: string; title: string }
  | { severity: "WARNING"; category: string; ruleCode: string; title: string };

export interface ReleaseGateReport {
  status: ReleaseGateStatus;
  hardStops: Extract<ReleaseGateFindingSummary, { severity: "ERROR" }>[];
  highRiskFindings: Extract<ReleaseGateFindingSummary, { severity: "ERROR" }>[];
  warnings: Extract<ReleaseGateFindingSummary, { severity: "WARNING" }>[];
}

export const MIN_REVIEWER_OVERRIDE_LENGTH = 10;

/**
 * AI findings are risk signals, not automatic vetoes: visual classifiers can
 * miss or misidentify content, so reviewers may accept those findings with a
 * reason. Missing required alt text is a deterministic hard stop. Receipt
 * integrity, stale inputs, incomplete image assets and unavailable required
 * audits are independently hard-stopped by the review route.
 */
export function evaluateReleaseGate(findings: readonly unknown[]): ReleaseGateReport {
  const hardStops: Extract<ReleaseGateFindingSummary, { severity: "ERROR" }>[] = [];
  const highRiskFindings: Extract<ReleaseGateFindingSummary, { severity: "ERROR" }>[] = [];
  const warnings: Extract<ReleaseGateFindingSummary, { severity: "WARNING" }>[] = [];
  const seen = new Set<string>();

  for (const item of findings) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const finding = item as Record<string, unknown>;
    if (finding.severity !== "ERROR" && finding.severity !== "WARNING") continue;

    const summary = {
      severity: finding.severity,
      category: typeof finding.category === "string" ? finding.category.slice(0, 80) : "GENERAL",
      ruleCode: typeof finding.ruleCode === "string" ? finding.ruleCode.slice(0, 80) : "",
      title: typeof finding.title === "string" && finding.title.trim()
        ? finding.title.trim().slice(0, 240)
        : "Untitled preflight finding",
    } as ReleaseGateFindingSummary;

    const key = [summary.severity, summary.category, summary.ruleCode, summary.title.toLowerCase()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      summary.severity === "ERROR" &&
      summary.category === "ACCESSIBILITY" &&
      summary.title.toLowerCase() === "image alt text is missing"
    ) {
      hardStops.push(summary);
    } else if (summary.severity === "ERROR") {
      highRiskFindings.push(summary);
    } else {
      warnings.push(summary);
    }
  }

  return {
    status: hardStops.length > 0
      ? "BLOCKED"
      : highRiskFindings.length > 0 || warnings.length > 0
        ? "REQUIRES_OVERRIDE"
        : "READY",
    hardStops,
    highRiskFindings,
    warnings,
  };
}

export function getReleaseGateApprovalError(
  gate: ReleaseGateReport,
  reviewerNote?: string,
): string | null {
  if (gate.status === "BLOCKED") {
    return "Approval blocked: required image alt text is missing. Add meaningful alt text and run Image Audit again. A reviewer note cannot override this requirement.";
  }

  if (
    gate.status === "REQUIRES_OVERRIDE" &&
    (typeof reviewerNote !== "string" || reviewerNote.trim().length < MIN_REVIEWER_OVERRIDE_LENGTH)
  ) {
    const findingCount = gate.highRiskFindings.length + gate.warnings.length;
    return `Approval requires a reviewer override reason of at least ${MIN_REVIEWER_OVERRIDE_LENGTH} characters because ${findingCount} finding(s) remain. Explain why each listed finding is acceptable or does not apply.`;
  }
  return null;
}

/** Store the reason and the exact receipt findings it applies to in one durable record. */
export function formatReviewerOverrideComment(
  reviewerNote: string,
  gate: ReleaseGateReport,
): string {
  const lines = ["REVIEWER OVERRIDE", `Reason: ${reviewerNote.trim()}`];
  if (gate.highRiskFindings.length > 0) {
    lines.push("", "High-risk findings acknowledged:");
    for (const finding of gate.highRiskFindings) {
      lines.push(`- ${finding.category}${finding.ruleCode ? ` · ${finding.ruleCode}` : ""}: ${finding.title}`);
    }
  }
  if (gate.warnings.length > 0) {
    lines.push("", "Warnings acknowledged:");
    for (const finding of gate.warnings) {
      lines.push(`- ${finding.category}${finding.ruleCode ? ` · ${finding.ruleCode}` : ""}: ${finding.title}`);
    }
  }
  return lines.join("\n");
}
