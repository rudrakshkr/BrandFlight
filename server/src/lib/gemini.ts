import { GoogleGenAI } from "@google/genai";
import "dotenv/config"

type AuditRule = {
  ruleCode: string;
  category: string;
  title: string;
  description: string;
};

type ApprovedFact = {
  factCode: string;
  claim: string;
};

export type SemanticFinding = {
  category: "TONE" | "CLAIM";
  severity: "INFO" | "WARNING" | "ERROR";
  title: string;
  message: string;
  evidence: string;
  suggestion: string;
  ruleCode: string;
  confidence: string;
};

const apiKey = process.env.GEMINI_API_KEY;

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function runSemanticAudit(
  content: string,
  rules: AuditRule[],
  facts: ApprovedFact[],
): Promise<SemanticFinding[]> {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const allowedCodes = new Set([
    ...rules.map((rule) => rule.ruleCode),
    ...facts.map((fact) => fact.factCode),
  ]);

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    contents: JSON.stringify({
      task: "Review marketing content against the supplied brand rules and approved facts.",
      content,
      rules,
      approvedFacts: facts,
    }),
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          findings: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                category: {
                  type: "STRING",
                  enum: ["TONE", "CLAIM"],
                },
                severity: {
                  type: "STRING",
                  enum: ["INFO", "WARNING", "ERROR"],
                },
                title: { type: "STRING" },
                message: { type: "STRING" },
                evidence: { type: "STRING" },
                suggestion: { type: "STRING" },
                ruleCode: { type: "STRING" },
                confidence: { type: "STRING" },
              },
              required: [
                "category",
                "severity",
                "title",
                "message",
                "evidence",
                "suggestion",
                "ruleCode",
                "confidence",
              ],
            },
          },
        },
        required: ["findings"],
      },
      systemInstruction: `
        You are BrandFlight, a brand-governance auditor.

        1. Check tone and messaging against the supplied rules.
        2. Check factual and promotional claims against approved facts.
        3. Never invent brand rules, approved facts, or rule identifiers.
        4. Use only ruleCode or factCode values provided in the input.
        5. The evidence field must be an exact substring copied from the content.
        6. If a claim cannot be verified, say it needs human review;
        do not automatically declare it false.
        7. Suggest corrections that preserve the creator's intent.
        8. Return an empty findings array when no meaningful issue exists.
        9. Return JSON matching the required schema, without markdown.
        `,
    },
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty response.");
  }

  const parsed: unknown = JSON.parse(response.text);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("findings" in parsed) ||
    !Array.isArray(parsed.findings)
  ) {
    throw new Error("Gemini returned an invalid findings structure.");
  }

  return parsed.findings.filter(
    (item): item is SemanticFinding =>
      typeof item === "object" &&
      item !== null &&
      "category" in item &&
      (item.category === "TONE" || item.category === "CLAIM") &&
      "severity" in item &&
      ["INFO", "WARNING", "ERROR"].includes(String(item.severity)) &&
      "title" in item &&
      typeof item.title === "string" &&
      "message" in item &&
      typeof item.message === "string" &&
      "evidence" in item &&
      typeof item.evidence === "string" &&
      item.evidence.length > 0 &&
      content.includes(item.evidence) &&
      "suggestion" in item &&
      typeof item.suggestion === "string" &&
      "ruleCode" in item &&
      typeof item.ruleCode === "string" &&
      allowedCodes.has(item.ruleCode) &&
      "confidence" in item &&
      typeof item.confidence === "string",
  );
}