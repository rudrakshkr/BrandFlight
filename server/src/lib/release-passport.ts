import { createHmac, timingSafeEqual } from "node:crypto";

export type ReleasePassportSnapshot = {
  schemaVersion: 1;
  campaign: {
    submissionId: string;
    title: string;
    brandProfileId: string;
    brandName: string;
    contentHash: string;
    imageInputHash: string | null;
  };
  audit: {
    text: {
      receiptId: string;
      inputHash: string;
      configHash: string;
      resultHash: string;
      semanticStatus: "completed" | "unavailable";
    };
    image: {
      receiptId: string;
      inputHash: string;
      configHash: string;
      resultHash: string;
    } | null;
  };
  approval: {
    decision: "APPROVED";
    reviewerId: string;
    reviewerName: string;
    approvedAt: string;
  };
};

/** Stable JSON serialization so JSONB key ordering cannot change the digest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function createReleasePassport(snapshot: ReleasePassportSnapshot, signingSecret: string) {
  return {
    snapshot,
    passportHash: createHmac("sha256", signingSecret).update(canonicalJson(snapshot), "utf8").digest("hex"),
  };
}

export function verifyReleasePassportHash(
  snapshot: unknown,
  expectedHash: string,
  signingSecret: string,
): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = createHmac("sha256", signingSecret).update(canonicalJson(snapshot), "utf8").digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
