import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";

export const brandsRouter = Router();

type RuleCategory =
  | "TONE"
  | "TERMINOLOGY"
  | "CLAIM"
  | "VISUAL"
  | "ACCESSIBILITY";

const RULE_CATEGORIES: RuleCategory[] = [
  "TONE",
  "TERMINOLOGY",
  "CLAIM",
  "VISUAL",
  "ACCESSIBILITY",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseRule(value: unknown) {
  if (!isRecord(value)) return null;

  const { ruleCode, category, title, description, pattern, isActive } = value;

  if (
    !nonEmptyString(ruleCode) ||
    !nonEmptyString(title) ||
    !nonEmptyString(description) ||
    typeof category !== "string" ||
    !RULE_CATEGORIES.includes(category as RuleCategory)
  ) {
    return null;
  }

  let normalizedPattern: string | null = null;

  if (pattern !== undefined && pattern !== null && pattern !== "") {
    if (typeof pattern !== "string") return null;

    try {
      new RegExp(pattern);
    } catch {
      return null;
    }

    normalizedPattern = pattern;
  }

  if (isActive !== undefined && typeof isActive !== "boolean") return null;

  return {
    ruleCode: ruleCode.trim(),
    category: category as RuleCategory,
    title: title.trim(),
    description: description.trim(),
    pattern: normalizedPattern,
    isActive: typeof isActive === "boolean" ? isActive : true,
  };
}

function parseFact(value: unknown) {
  if (!isRecord(value)) return null;

  const { factCode, claim, sourceLabel, sourceUrl } = value;

  if (!nonEmptyString(factCode) || !nonEmptyString(claim)) return null;

  if (
    sourceLabel !== undefined &&
    sourceLabel !== null &&
    typeof sourceLabel !== "string"
  ) {
    return null;
  }

  if (
    sourceUrl !== undefined &&
    sourceUrl !== null &&
    typeof sourceUrl !== "string"
  ) {
    return null;
  }

  return {
    factCode: factCode.trim(),
    claim: claim.trim(),
    sourceLabel: nonEmptyString(sourceLabel)
      ? sourceLabel.trim()
      : "Approved product facts",
    sourceUrl:
      typeof sourceUrl === "string" && sourceUrl.trim()
        ? sourceUrl.trim()
        : null,
  };
}

function parseColors(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    !value.every(
      (item) =>
        typeof item === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(item),
    )
  ) {
    return null;
  }

  return [...new Set(value.map((color: string) => color.toUpperCase()))];
}

function databaseError(res: Response, error: unknown, message: string) {
  console.error(message, error);

  if (isRecord(error) && error.code === "P2002") {
    return res.status(409).json({
      error: "That rule code or fact code already exists for this brand.",
    });
  }

  if (isRecord(error) && error.code === "P2025") {
    return res.status(404).json({ error: "Record not found." });
  }

  return res.status(500).json({ error });
}

async function requireBrand(brandProfileId: string) {
  return prisma.brandProfile.findUnique({
    where: { id: brandProfileId },
  });
}

// Read the brand, active rules, and active facts.
brandsRouter.get("/:brandProfileId", async (req, res) => {
  try {
    const brand = await prisma.brandProfile.findUnique({
      where: { id: req.params.brandProfileId },
      include: {
        rules: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
        facts: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!brand) {
      return res.status(404).json({ error: "Brand profile not found." });
    }

    return res.json(brand);
  } catch (error) {
    return databaseError(res, error, "Unable to load brand profile:");
  }
});

// Update brand name, description, and color palette.
brandsRouter.patch("/:brandProfileId", async (req, res) => {
  const body: unknown = req.body;

  if (!isRecord(body)) {
    return res.status(400).json({ error: "A JSON object is required." });
  }

  const data: {
    name?: string;
    description?: string | null;
    brandColors?: string[];
  } = {};

  if ("name" in body) {
    if (!nonEmptyString(body.name)) {
      return res.status(400).json({ error: "Brand name cannot be empty." });
    }
    data.name = body.name.trim();
  }

  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      return res.status(400).json({ error: "Invalid brand description." });
    }
    data.description = body.description;
  }

  if ("brandColors" in body) {
    const colors = parseColors(body.brandColors);
    if (!colors) {
      return res.status(400).json({
        error: "Brand colors must be an array of hexadecimal colors, such as #0F766E.",
      });
    }
    data.brandColors = colors;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No valid brand fields supplied." });
  }

  try {
    const brand = await prisma.brandProfile.update({
      where: { id: req.params.brandProfileId },
      data,
    });

    return res.json(brand);
  } catch (error) {
    return databaseError(res, error, "Unable to update brand profile:");
  }
});

// Create a rule.
brandsRouter.post("/:brandProfileId/rules", async (req, res) => {
  const rule = parseRule(req.body);

  if (!rule) {
    return res.status(400).json({
      error: "Provide a rule code, valid category, title, description, and valid optional regex pattern.",
    });
  }

  try {
    const brand = await requireBrand(req.params.brandProfileId);
    if (!brand) {
      return res.status(404).json({ error: "Brand profile not found." });
    }

    const created = await prisma.brandRule.create({
      data: { ...rule, brandProfileId: brand.id },
    });

    return res.status(201).json(created);
  } catch (error) {
    return databaseError(res, error, "Unable to create rule:");
  }
});

// Update an existing rule.
brandsRouter.put("/:brandProfileId/rules/:ruleId", async (req, res) => {
  const rule = parseRule(req.body);

  if (!rule) {
    return res.status(400).json({ error: "Invalid rule data." });
  }

  try {
    const existing = await prisma.brandRule.findFirst({
      where: {
        id: req.params.ruleId,
        brandProfileId: req.params.brandProfileId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Rule not found." });
    }

    const updated = await prisma.brandRule.update({
      where: { id: existing.id },
      data: rule,
    });

    return res.json(updated);
  } catch (error) {
    return databaseError(res, error, "Unable to update rule:");
  }
});

// Delete a rule.
brandsRouter.delete("/:brandProfileId/rules/:ruleId", async (req, res) => {
  try {
    const existing = await prisma.brandRule.findFirst({
      where: {
        id: req.params.ruleId,
        brandProfileId: req.params.brandProfileId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Rule not found." });
    }

    await prisma.brandRule.delete({ where: { id: existing.id } });
    return res.status(204).end();
  } catch (error) {
    return databaseError(res, error, "Unable to delete rule:");
  }
});

// Create an approved fact.
brandsRouter.post("/:brandProfileId/facts", async (req, res) => {
  const fact = parseFact(req.body);

  if (!fact) {
    return res.status(400).json({
      error: "Provide a fact code and claim, with an optional source label and URL.",
    });
  }

  try {
    const brand = await requireBrand(req.params.brandProfileId);
    if (!brand) {
      return res.status(404).json({ error: "Brand profile not found." });
    }

    const created = await prisma.approvedFact.create({
      data: { ...fact, brandProfileId: brand.id },
    });

    return res.status(201).json(created);
  } catch (error) {
    return databaseError(res, error, "Unable to create approved fact:");
  }
});

// Update an approved fact.
brandsRouter.put("/:brandProfileId/facts/:factId", async (req, res) => {
  const fact = parseFact(req.body);

  if (!fact) {
    return res.status(400).json({ error: "Invalid approved fact data." });
  }

  try {
    const existing = await prisma.approvedFact.findFirst({
      where: {
        id: req.params.factId,
        brandProfileId: req.params.brandProfileId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Approved fact not found." });
    }

    const updated = await prisma.approvedFact.update({
      where: { id: existing.id },
      data: fact,
    });

    return res.json(updated);
  } catch (error) {
    return databaseError(res, error, "Unable to update approved fact:");
  }
});

// Delete an approved fact.
brandsRouter.delete("/:brandProfileId/facts/:factId", async (req, res) => {
  try {
    const existing = await prisma.approvedFact.findFirst({
      where: {
        id: req.params.factId,
        brandProfileId: req.params.brandProfileId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Approved fact not found." });
    }

    await prisma.approvedFact.delete({ where: { id: existing.id } });
    return res.status(204).end();
  } catch (error) {
    return databaseError(res, error, "Unable to delete approved fact:");
  }
});

// Import a JSON rulebook. Existing codes are updated; omitted records are kept.
brandsRouter.post("/:brandProfileId/import", async (req, res) => {
  const body: unknown = req.body;

  if (
    !isRecord(body) ||
    !Array.isArray(body.rules) ||
    !Array.isArray(body.facts) ||
    body.rules.length > 100 ||
    body.facts.length > 100
  ) {
    return res.status(400).json({
      error: "Import JSON must contain rules and facts arrays, each with at most 100 items.",
    });
  }

  const rules = body.rules.map(parseRule);
  const facts = body.facts.map(parseFact);

  if (rules.some((rule) => rule === null) || facts.some((fact) => fact === null)) {
    return res.status(400).json({
      error: "Import contains an invalid rule or fact. Check required fields and regex patterns.",
    });
  }

  if (
    "name" in body &&
    !nonEmptyString(body.name)
  ) {
    return res.status(400).json({ error: "Imported brand name cannot be empty." });
  }

  if (
    "description" in body &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return res.status(400).json({ error: "Invalid imported description." });
  }

  let brandColors: string[] | undefined;

  if ("brandColors" in body) {
    const colors = parseColors(body.brandColors);
    if (!colors) {
      return res.status(400).json({ error: "Invalid imported brand colors." });
    }
    brandColors = colors;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const profileData: {
        name?: string;
        description?: string | null;
        brandColors?: string[];
      } = {};

      if (typeof body.name === "string") profileData.name = body.name.trim();
      if ("description" in body) {
        profileData.description = body.description as string | null;
      }
      if (brandColors !== undefined) profileData.brandColors = brandColors;

      const brand = await tx.brandProfile.update({
        where: { id: req.params.brandProfileId },
        data: profileData,
      });

      const importedRules = [];
      for (const rule of rules) {
        importedRules.push(
          await tx.brandRule.upsert({
            where: {
              brandProfileId_ruleCode: {
                brandProfileId: brand.id,
                ruleCode: rule!.ruleCode,
              },
            },
            update: rule!,
            create: { ...rule!, brandProfileId: brand.id },
          }),
        );
      }

      const importedFacts = [];
      for (const fact of facts) {
        importedFacts.push(
          await tx.approvedFact.upsert({
            where: {
              brandProfileId_factCode: {
                brandProfileId: brand.id,
                factCode: fact!.factCode,
              },
            },
            update: fact!,
            create: { ...fact!, brandProfileId: brand.id },
          }),
        );
      }

      return { brand, rules: importedRules, facts: importedFacts };
    });

    return res.json({
      brand: result.brand,
      importedRules: result.rules.length,
      importedFacts: result.facts.length,
      mode: "merge",
    });
  } catch (error) {
    return databaseError(res, error, "Unable to import rulebook:");
  }
});
