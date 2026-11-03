export const OVERRIDE_REASON_CATEGORIES = [
  "RULE_UNCLEAR",
  "CHANNEL_EXCEPTION",
  "FALSE_POSITIVE",
] as const;

export type OverrideReasonCategory = (typeof OVERRIDE_REASON_CATEGORIES)[number];
export type OverrideDecisionOutcome = "ACCEPTED" | "REJECTED";

export interface OverrideRequestRecord {
  id: string;
  body: string;
  overrideReasonCategory: string | null;
}

export interface OverrideDecisionRecord {
  body: string;
}

export type OverrideInsightCategory = OverrideReasonCategory | "UNCATEGORIZED";

export interface OverrideInsightBucket {
  category: OverrideInsightCategory;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
}

export interface OverrideRuleInsight {
  ruleCode: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
}

export interface OverrideGovernanceInsights {
  totalRequests: number;
  pending: number;
  accepted: number;
  rejected: number;
  categories: OverrideInsightBucket[];
  topRules: OverrideRuleInsight[];
  recurringRuleThreshold: number;
}

const RECURRING_RULE_THRESHOLD = 3;

function parseDecision(body: string): { requestId: string; outcome: OverrideDecisionOutcome } | null {
  if (!/^OVERRIDE DECISION(?:\r?\n|$)/i.test(body)) return null;

  const requestId = body.match(/^Request ID:\s*([A-Za-z0-9_-]+)\s*$/im)?.[1];
  const outcome = body.match(/^Decision:\s*(ACCEPTED|REJECTED)\s*$/im)?.[1]?.toUpperCase();

  if (!requestId || (outcome !== "ACCEPTED" && outcome !== "REJECTED")) return null;
  return { requestId, outcome };
}

function parseRuleCodes(body: string): string[] {
  const line = body.match(/^Rule\(s\):\s*(.+)$/im)?.[1];
  if (!line) return [];

  const validCodes = line
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(code));

  return [...new Set(validCodes)];
}

function emptyBucket(category: OverrideInsightCategory): OverrideInsightBucket {
  return { category, total: 0, pending: 0, accepted: 0, rejected: 0 };
}

function emptyRuleInsight(ruleCode: string): OverrideRuleInsight {
  return { ruleCode, total: 0, pending: 0, accepted: 0, rejected: 0 };
}

/**
 * Builds manager-facing, aggregate governance signals from the structured
 * override category and the existing auditable decision comment format.
 * Free-text justifications and decision notes are deliberately not returned.
 */
export function buildOverrideGovernanceInsights(
  requests: readonly OverrideRequestRecord[],
  decisionComments: readonly OverrideDecisionRecord[],
): OverrideGovernanceInsights {
  const decisionsByRequestId = new Map<string, OverrideDecisionOutcome>();

  for (const comment of decisionComments) {
    const decision = parseDecision(comment.body);
    if (decision && !decisionsByRequestId.has(decision.requestId)) {
      decisionsByRequestId.set(decision.requestId, decision.outcome);
    }
  }

  const categories = new Map<OverrideInsightCategory, OverrideInsightBucket>();
  for (const category of [...OVERRIDE_REASON_CATEGORIES, "UNCATEGORIZED" as const]) {
    categories.set(category, emptyBucket(category));
  }
  const rules = new Map<string, OverrideRuleInsight>();

  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  let totalRequests = 0;

  for (const request of requests) {
    const category = OVERRIDE_REASON_CATEGORIES.includes(
      request.overrideReasonCategory as OverrideReasonCategory,
    )
      ? request.overrideReasonCategory as OverrideReasonCategory
      : "UNCATEGORIZED";
    const bucket = categories.get(category)!;
    const outcome = decisionsByRequestId.get(request.id) ?? "PENDING";

    totalRequests += 1;
    bucket.total += 1;

    if (outcome === "ACCEPTED") {
      accepted += 1;
      bucket.accepted += 1;
    } else if (outcome === "REJECTED") {
      rejected += 1;
      bucket.rejected += 1;
    } else {
      pending += 1;
      bucket.pending += 1;
    }

    for (const ruleCode of parseRuleCodes(request.body)) {
      const insight = rules.get(ruleCode) ?? emptyRuleInsight(ruleCode);
      insight.total += 1;
      if (outcome === "ACCEPTED") insight.accepted += 1;
      else if (outcome === "REJECTED") insight.rejected += 1;
      else insight.pending += 1;
      rules.set(ruleCode, insight);
    }
  }

  const topRules = [...rules.values()]
    .sort((a, b) => b.total - a.total || a.ruleCode.localeCompare(b.ruleCode))
    .slice(0, 6);

  return {
    totalRequests,
    pending,
    accepted,
    rejected,
    categories: [...categories.values()],
    topRules,
    recurringRuleThreshold: RECURRING_RULE_THRESHOLD,
  };
}
