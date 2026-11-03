import assert from "node:assert/strict";
import test from "node:test";
import { buildOverrideGovernanceInsights } from "../src/lib/governance-insights.js";

test("aggregates override reason categories, request outcomes and referenced rules", () => {
  const insights = buildOverrideGovernanceInsights(
    [
      {
        id: "request-1",
        overrideReasonCategory: "RULE_UNCLEAR",
        body: "OVERRIDE REQUEST\nRule(s): TERM-01, CLAIM-02\nCreator justification: Context is documented.",
      },
      {
        id: "request-2",
        overrideReasonCategory: "RULE_UNCLEAR",
        body: "OVERRIDE REQUEST\nRule(s): TERM-01\nCreator justification: This is a channel-specific use.",
      },
      {
        id: "request-3",
        overrideReasonCategory: "CHANNEL_EXCEPTION",
        body: "OVERRIDE REQUEST\nRule(s): CLAIM-02\nCreator justification: The placement changes context.",
      },
      {
        id: "request-4",
        overrideReasonCategory: "FALSE_POSITIVE",
        body: "OVERRIDE REQUEST\nCreator justification: No rule code was included.",
      },
    ],
    [
      { body: "OVERRIDE DECISION\nRequest ID: request-1\nDecision: ACCEPTED\nDecision note: Context supported." },
      { body: "OVERRIDE DECISION\nRequest ID: request-2\nDecision: REJECTED\nDecision note: Rule still applies." },
      { body: "OVERRIDE DECISION\nRequest ID: unknown-request\nDecision: ACCEPTED" },
    ],
  );

  assert.equal(insights.totalRequests, 4);
  assert.equal(insights.pending, 2);
  assert.equal(insights.accepted, 1);
  assert.equal(insights.rejected, 1);

  assert.deepEqual(insights.categories, [
    { category: "RULE_UNCLEAR", total: 2, pending: 0, accepted: 1, rejected: 1 },
    { category: "CHANNEL_EXCEPTION", total: 1, pending: 1, accepted: 0, rejected: 0 },
    { category: "FALSE_POSITIVE", total: 1, pending: 1, accepted: 0, rejected: 0 },
    { category: "UNCATEGORIZED", total: 0, pending: 0, accepted: 0, rejected: 0 },
  ]);

  assert.deepEqual(insights.topRules, [
    { ruleCode: "CLAIM-02", total: 2, pending: 1, accepted: 1, rejected: 0 },
    { ruleCode: "TERM-01", total: 2, pending: 0, accepted: 1, rejected: 1 },
  ]);
  assert.equal(insights.recurringRuleThreshold, 3);
});

test("keeps legacy requests uncategorized and ignores malformed decisions and rule-code text", () => {
  const insights = buildOverrideGovernanceInsights(
    [
      {
        id: "request-1",
        overrideReasonCategory: "RULE_UNCLEAR",
        body: "OVERRIDE REQUEST\nRule(s): TERM-01, not a rule code, <script>\nCreator justification: The request has enough detail.",
      },
      {
        id: "request-2",
        overrideReasonCategory: null,
        body: "OVERRIDE REQUEST\nRule(s): CLAIM-01",
      },
      {
        id: "request-3",
        overrideReasonCategory: "UNKNOWN",
        body: "OVERRIDE REQUEST\nRule(s): CLAIM-02",
      },
    ],
    [
      { body: "OVERRIDE DECISION\nRequest ID: request-1\nDecision: MAYBE" },
      { body: "This is ordinary discussion text." },
    ],
  );

  assert.equal(insights.totalRequests, 3);
  assert.equal(insights.pending, 3);
  assert.equal(insights.accepted, 0);
  assert.equal(insights.rejected, 0);
  assert.equal(insights.categories.find((item) => item.category === "UNCATEGORIZED")?.total, 2);
  assert.deepEqual(insights.topRules, [
    { ruleCode: "CLAIM-01", total: 1, pending: 1, accepted: 0, rejected: 0 },
    { ruleCode: "CLAIM-02", total: 1, pending: 1, accepted: 0, rejected: 0 },
    { ruleCode: "TERM-01", total: 1, pending: 1, accepted: 0, rejected: 0 },
  ]);
});
