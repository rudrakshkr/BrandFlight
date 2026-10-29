import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";
import { refineMarketingCopy, runSemanticAudit } from "./lib/gemini.js";
import { brandsRouter } from "./routes/brands.js";
import { authRouter } from "./routes/auth.js";
import { submissionsRouter } from "./routes/submissions.js";
import { imageAuditRouter } from "./routes/image-audit.js";
import { requireAuth, requireRoles } from "./middleware/auth.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "BrandFlight API" });
});

app.use("/api/brands", brandsRouter);
app.use("/api/auth", authRouter);
app.use("/api/submissions", submissionsRouter);
app.use("/api/audit/image", imageAuditRouter);

app.post("/api/audit/refine", requireAuth, requireRoles("CREATOR"), async (req, res) => {
  const body: unknown = req.body;
  if (
    typeof body !== "object" || body === null || Array.isArray(body) ||
    !("brandProfileId" in body) || typeof body.brandProfileId !== "string" || !body.brandProfileId.trim() ||
    !("content" in body) || typeof body.content !== "string" || !body.content.trim() || body.content.length > 20000
  ) {
    return res.status(400).json({ error: "brandProfileId and content (up to 20,000 characters) are required." });
  }

  const payload = body as { brandProfileId: string; content: string };
  try {
    const brand = await prisma.brandProfile.findUnique({
      where: { id: payload.brandProfileId },
      include: { rules: { where: { isActive: true } }, facts: { where: { isActive: true } } },
    });
    if (!brand) return res.status(404).json({ error: "Brand profile not found." });

    const refinedContent = await refineMarketingCopy(
      payload.content,
      brand.rules.map(({ ruleCode, category, title, description }) => ({ ruleCode, category, title, description })),
      brand.facts.map(({ factCode, claim }) => ({ factCode, claim })),
    );
    return res.json({ brand: { id: brand.id, name: brand.name }, refinedContent });
  } catch (error) {
    console.error("Copy refinement failed:", error);
    return res.status(502).json({ error: "Unable to refine copy. Check the Gemini configuration and try again." });
  }
});

app.post("/api/audit", requireAuth, async (req, res) => {
  const { brandProfileId, content } = req.body ?? {};

  if (
    typeof brandProfileId !== "string" ||
    typeof content !== "string" ||
    !brandProfileId.trim() ||
    !content.trim()
  ) {
    return res.status(400).json({
      error: "brandProfileId and content are required.",
    });
  }

  try {
    const brand = await prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
      include: {
        rules: { where: { isActive: true } },
        facts: { where: { isActive: true } },
      },
    });

    if (!brand) {
      return res.status(404).json({ error: "Brand profile not found." });
    }

    const findings: Array<Record<string, string>> = [];

    // Check terminology against configured rules.
    for (const rule of brand.rules) {
      if (!rule.pattern || findings.length >= 20) continue;

      try {
        const regex = new RegExp(rule.pattern, "gi");
        const matches = content.match(regex) ?? [];

        for (const match of [...new Set(matches)]) {
          if (findings.length >= 20) break;

          findings.push({
            category: rule.category,
            severity: "WARNING",
            title: rule.title,
            message: `Content matched rule ${rule.ruleCode}: ${rule.description}`,
            evidence: match,
            originalSpan: match,
            suggestedSpan: "",
            suggestion: `Review or replace "${match}" with appropriate wording.`,
            ruleCode: rule.ruleCode,
            confidence: "Deterministic Match",
          });
        }
      } catch {
        console.error(`Invalid regex configured for rule ${rule.ruleCode}`);
      }
    }

    // Compare numerical expressions against approved fact expressions.
    const extractNumbers = (text: string) =>
      text.match(
        /(?:₹|\$)?\s*\d+(?:[.,]\d+)?\s*(?:%|percent|days?|hours?|minutes?|months?|years?)?/gi,
      ) ?? [];

    const normalize = (value: string) =>
      value.replace(/\s+/g, "").toLowerCase();

    const approvedNumbers = new Set(
      brand.facts.flatMap((fact) =>
        extractNumbers(fact.claim).map(normalize),
      ),
    );

    const seen = new Set<string>();

    for (const raw of extractNumbers(content)) {
      const claim = raw.trim();
      const key = normalize(claim);

      if (approvedNumbers.has(key) || seen.has(key)) continue;
      seen.add(key);

      if (findings.length >= 20) break;

      findings.push({
        category: "CLAIM",
        severity: "WARNING",
        title: "Unverified numerical claim",
        message:
          "This numerical expression did not match an approved fact expression. Verify it before publication.",
        evidence: claim,
        originalSpan: claim,
        suggestedSpan: "",
        suggestion: "Check the approved product facts before using this claim.",
        ruleCode: "CLAIM-01",
        confidence: "Needs Human Review",
      });
    }

    let semanticStatus: "completed" | "unavailable" = "completed";

    try {
      const semanticFindings = await runSemanticAudit(
        content,
        brand.rules.map(({ ruleCode, category, title, description }) => ({
          ruleCode,
          category,
          title,
          description,
        })),
        brand.facts.map(({ factCode, claim }) => ({
          factCode,
          claim,
        })),
      );

      for (const finding of semanticFindings) {
        const duplicate = findings.some(
          (existing) =>
            existing.category === finding.category &&
            existing.ruleCode === finding.ruleCode &&
            existing.evidence?.toLowerCase() === finding.evidence.toLowerCase(),
        );

        if (!duplicate && findings.length < 20) {
          findings.push(finding);
        }
      }
    } catch (error) {
      console.error("Gemini audit failed:", error);
      semanticStatus = "unavailable";
    }

    return res.json({
      brand: { id: brand.id, name: brand.name },
      totalFindings: findings.length,
      findings,
      semanticStatus
    });
  } catch (error) {
    console.error("Audit failed:", error);
    return res.status(500).json({ error: "Unable to audit content." });
  }
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`BrandFlight API running on port ${port}`);
});