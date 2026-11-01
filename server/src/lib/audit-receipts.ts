import { createHash, randomBytes } from "node:crypto";

export const IMAGE_AUDIT_ALGORITHM_VERSION = "image-audit-v5-pixel-text-contrast";

export type AuditBrandConfiguration = {
  id: string;
  brandColors: string[];
  rules: Array<{
    ruleCode: string;
    category: string;
    title: string;
    description: string;
    pattern: string | null;
  }>;
  facts: Array<{
    factCode: string;
    claim: string;
    sourceLabel: string;
    sourceUrl: string | null;
  }>;
  accessibilityPairs?: unknown;
  assets?: Array<{
    assetType: string;
    name: string;
    format: string;
    secureUrl: string;
    publicId: string;
    expectedWordmark: string | null;
    description: string | null;
    isRequired: boolean;
  }>;
};

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createAuditReceiptId(): string {
  // Unpredictable, server-generated receipt ID; only IDs stored by the API are valid.
  return randomBytes(32).toString("hex");
}

export function auditConfigHash(
  brand: AuditBrandConfiguration,
  kind: "TEXT" | "IMAGE",
): string {
  const rules = brand.rules
    .map((rule) => ({
      ruleCode: rule.ruleCode,
      category: rule.category,
      title: rule.title,
      description: rule.description,
      pattern: rule.pattern,
    }))
    .sort((a, b) => a.ruleCode.localeCompare(b.ruleCode));
  const facts = brand.facts
    .map((fact) => ({
      factCode: fact.factCode,
      claim: fact.claim,
      sourceLabel: fact.sourceLabel,
      sourceUrl: fact.sourceUrl,
    }))
    .sort((a, b) => a.factCode.localeCompare(b.factCode));

  // Text audits depend on rules/facts; image audits depend on brand colors and visual/accessibility rules.
  const approvedAssets = (brand.assets ?? []).map((asset) => ({
    assetType: asset.assetType,
    name: asset.name,
    format: asset.format,
    secureUrl: asset.secureUrl,
    publicId: asset.publicId,
    expectedWordmark: asset.expectedWordmark,
    description: asset.description,
    isRequired: asset.isRequired,
  })).sort((a, b) => a.assetType.localeCompare(b.assetType));
  const accessibilityPairs = Array.isArray(brand.accessibilityPairs)
    ? brand.accessibilityPairs.flatMap((value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
        const pair = value as Record<string, unknown>;
        if (typeof pair.role !== "string" || typeof pair.foreground !== "string" || typeof pair.background !== "string") return [];
        return [{ role: pair.role, foreground: pair.foreground.toUpperCase(), background: pair.background.toUpperCase() }];
      }).sort((a, b) => a.role.localeCompare(b.role))
    : [];

  const configuration = kind === "TEXT"
    ? { kind, brandProfileId: brand.id, rules, facts }
    : {
        kind,
        algorithmVersion: IMAGE_AUDIT_ALGORITHM_VERSION,
        brandProfileId: brand.id,
        brandColors: [...brand.brandColors].map((color) => color.toUpperCase()).sort(),
        accessibilityPairs,
        rules: rules.filter((rule) => rule.category === "VISUAL" || rule.category === "ACCESSIBILITY"),
        assets: approvedAssets,
      };

  return sha256Text(JSON.stringify(configuration));
}

export function imageAuditInputHash(
  asset: { secureUrl: string; publicId: string },
  altText: string,
): string {
  return sha256Text(JSON.stringify({
    secureUrl: asset.secureUrl,
    publicId: asset.publicId,
    altText: altText.trim(),
  }));
}
