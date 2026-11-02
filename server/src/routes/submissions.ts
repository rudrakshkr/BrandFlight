import { Router, type Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { auditConfigHash, imageAuditInputHash, sha256Text } from "../lib/audit-receipts.js";
import { validateCreatorUpdateSummary, validateReviewDecision } from "../lib/review-validation.js";
import { evaluateReleaseGate, formatReviewerOverrideComment, getReleaseGateApprovalError } from "../lib/release-gate.js";
import { canonicalJson, createReleasePassport, verifyReleasePassportHash, type ReleasePassportSnapshot } from "../lib/release-passport.js";
import {
  requireAuth,
  requireRoles,
  type AuthenticatedUser,
} from "../middleware/auth.js";

export const submissionsRouter = Router();

const CATEGORIES = [
  "TONE",
  "TERMINOLOGY",
  "CLAIM",
  "VISUAL",
  "ACCESSIBILITY",
] as const;

const SEVERITIES = ["INFO", "WARNING", "ERROR"] as const;

type PersistedFinding = {
  category: (typeof CATEGORIES)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  message: string;
  evidence: string | null;
  suggestion: string | null;
  originalSpan: string | null;
  suggestedSpan: string | null;
  ruleCode: string | null;
  confidence: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseFindings(value: unknown): PersistedFinding[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;

  const findings: PersistedFinding[] = [];

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.category !== "string" ||
      !CATEGORIES.includes(item.category as (typeof CATEGORIES)[number]) ||
      typeof item.severity !== "string" ||
      !SEVERITIES.includes(item.severity as (typeof SEVERITIES)[number]) ||
      !nonEmptyString(item.title) ||
      !nonEmptyString(item.message)
    ) {
      return null;
    }

    const optionalText = (field: string) => {
      const entry = item[field];
      return typeof entry === "string" && entry.trim()
        ? entry.trim()
        : null;
    };

    findings.push({
      category: item.category as PersistedFinding["category"],
      severity: item.severity as PersistedFinding["severity"],
      title: item.title.trim(),
      message: item.message.trim(),
      evidence: optionalText("evidence"),
      suggestion: optionalText("suggestion"),
      originalSpan: optionalText("originalSpan"),
      suggestedSpan: optionalText("suggestedSpan"),
      ruleCode: optionalText("ruleCode"),
      confidence: optionalText("confidence"),
    });
  }

  return findings;
}

const SUBMISSION_TAGS = [
  "SOCIAL",
  "EMAIL",
  "BLOG",
  "LANDING_PAGE",
  "PAID_AD",
  "PRODUCT",
  "OTHER",
] as const;
type SubmissionTag = (typeof SUBMISSION_TAGS)[number];

function parseSubmissionTags(value: unknown): SubmissionTag[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > SUBMISSION_TAGS.length ||
    !value.every((tag) => typeof tag === "string" && SUBMISSION_TAGS.includes(tag as SubmissionTag))
  ) {
    return null;
  }
  return [...new Set(value as SubmissionTag[])];
}

type ImageAuditParseResult = {
  valid: boolean;
  present: boolean;
  value?: Prisma.InputJsonValue | null;
};

function parseImageAuditData(value: unknown): ImageAuditParseResult {
  if (value === undefined) return { valid: true, present: false };
  if (value === null) {
    return { valid: true, present: true, value: null };
  }

  if (
    !isRecord(value) ||
    !isRecord(value.image) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 20 ||
    !Number.isInteger(value.totalFindings) ||
    value.totalFindings !== value.findings.length
  ) {
    return { valid: false, present: true };
  }

  const image = value.image;
  const validDimension = (item: unknown) =>
    item === null || (typeof item === "number" && Number.isFinite(item) && item > 0);
  const validColors = (item: unknown) =>
    Array.isArray(item) &&
    item.length <= 20 &&
    item.every((color) => typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color));

  if (
    !nonEmptyString(image.name) ||
    image.name.length > 255 ||
    !nonEmptyString(image.format) ||
    image.format.length > 20 ||
    !validDimension(image.width) ||
    !validDimension(image.height) ||
    !validColors(image.dominantColors) ||
    !validColors(image.approvedColors) ||
    !Number.isInteger(image.altTextLength) ||
    (image.altTextLength as number) < 0 ||
    (image.altTextLength as number) > 1000
  ) {
    return { valid: false, present: true };
  }

  for (const item of value.findings) {
    if (
      !isRecord(item) ||
      (item.category !== "VISUAL" && item.category !== "ACCESSIBILITY") ||
      (item.severity !== "WARNING" && item.severity !== "ERROR") ||
      !nonEmptyString(item.title) ||
      !nonEmptyString(item.message)
    ) {
      return { valid: false, present: true };
    }
  }

  const serialized = JSON.stringify(value);
  if (serialized.length > 100_000) {
    return { valid: false, present: true };
  }

  return {
    valid: true,
    present: true,
    value: value as Prisma.InputJsonValue,
  };
}

type CloudinaryAsset = {
  present: boolean;
  valid: boolean;
  imageUrl: string | null;
  publicId: string | null;
};

function parseCloudinaryAsset(
  imageUrl: unknown,
  publicId: unknown,
  present: boolean,
): CloudinaryAsset {
  if (!present) {
    return { present: false, valid: true, imageUrl: null, publicId: null };
  }

  if (imageUrl === null && publicId === null) {
    return { present: true, valid: true, imageUrl: null, publicId: null };
  }

  const validUrl =
    typeof imageUrl === "string" &&
    /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/.+$/.test(imageUrl);

  const validPublicId =
    typeof publicId === "string" &&
    publicId.length > 0 &&
    publicId.length <= 512 &&
    /^[A-Za-z0-9_./-]+$/.test(publicId);

  if (!validUrl || !validPublicId) {
    return { present: true, valid: false, imageUrl: null, publicId: null };
  }

  return {
    present: true,
    valid: true,
    imageUrl: imageUrl as string,
    publicId: publicId as string,
  };
}

const submissionDetails = {
  brandProfile: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true, role: true } },
  reviewer: { select: { id: true, name: true, email: true, role: true } },
  findings: { orderBy: { createdAt: "asc" as const } },
  revisions: {
    orderBy: { version: "desc" as const },
    include: {
      author: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  },
  releasePassport: { select: { id: true, passportHash: true, issuedAt: true, snapshot: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: {
      author: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  },
};

async function loadAccessibleSubmission(
  id: string,
  user: AuthenticatedUser,
  res: Response,
) {
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: submissionDetails,
  });

  if (!submission) {
    res.status(404).json({ error: "Submission not found." });
    return null;
  }

  // Approved campaigns are shared workspace artifacts: every authenticated role may
  // inspect them and participate in their persistent discussion thread.
  if (submission.status === "APPROVED") {
    return submission;
  }

  if (
    user.role === "CREATOR" && submission.creatorId !== user.id
  ) {
    res.status(403).json({
      error: "Creators can only access their own submissions.",
    });
    return null;
  }

  if (
    user.role === "REVIEWER" &&
    submission.status !== "IN_REVIEW" &&
    submission.reviewerId !== user.id
  ) {
    res.status(403).json({
      error: "Reviewers can only access submissions awaiting review or assigned to them.",
    });
    return null;
  }

  return submission;
}

function handleError(res: Response, error: unknown, message: string) {
  console.error(message, error);

  if (isRecord(error) && error.code === "P2003") {
    return res.status(400).json({ error: "A referenced record does not exist." });
  }

  if (isRecord(error) && error.code === "P2025") {
    return res.status(404).json({ error: "Record not found." });
  }

  return res.status(500).json({ error: message });
}

async function loadAuditBrand(brandProfileId: string) {
  return prisma.brandProfile.findUnique({
    where: { id: brandProfileId },
    include: {
      rules: { where: { isActive: true } },
      facts: { where: { isActive: true } },
      assets: { where: { assetType: "PRIMARY_LOGO" }, take: 1 },
    },
  });
}

type AuditBrand = NonNullable<Awaited<ReturnType<typeof loadAuditBrand>>>;
type AuditReceiptRecord = {
  id: string;
  kind: string;
  userId: string;
  brandProfileId: string;
  inputHash: string;
  configHash: string;
  result: unknown;
};

function receiptMatches(
  receipt: AuditReceiptRecord | null,
  expected: {
    kind: "TEXT" | "IMAGE";
    userId: string;
    brandProfileId: string;
    inputHash: string;
    configHash: string;
  },
): receipt is AuditReceiptRecord {
  return Boolean(
    receipt &&
    receipt.kind === expected.kind &&
    receipt.userId === expected.userId &&
    receipt.brandProfileId === expected.brandProfileId &&
    receipt.inputHash === expected.inputHash &&
    receipt.configHash === expected.configHash,
  );
}

async function validateTextAuditReceipt(
  receiptId: unknown,
  userId: string,
  brandProfileId: string,
  contentText: string,
  brand: AuditBrand,
) {
  if (!nonEmptyString(receiptId)) return null;
  const receipt = await prisma.auditReceipt.findUnique({ where: { id: receiptId } });
  const structuralReceipt = receipt as AuditReceiptRecord | null;
  if (!receiptMatches(structuralReceipt, {
    kind: "TEXT",
    userId,
    brandProfileId,
    inputHash: sha256Text(contentText),
    configHash: auditConfigHash(brand, "TEXT"),
  })) return null;

  const validReceipt = structuralReceipt;
  if (!validReceipt || !isRecord(validReceipt.result)) return null;
  const findings = parseFindings(validReceipt.result.findings);
  if (!findings) return null;

  const semanticStatus: "completed" | "unavailable" =
    validReceipt.result.semanticStatus === "completed"
      ? "completed"
      : "unavailable";

  return {
    receiptId: validReceipt.id,
    findings,
    resultHash: sha256Text(canonicalJson(validReceipt.result)),
    semanticStatus,
  };
}

async function validateImageAuditReceipt(
  receiptId: unknown,
  userId: string,
  brandProfileId: string,
  imageUrl: string,
  imagePublicId: string,
  imageAltText: string | null,
  brand: AuditBrand,
) {
  if (!nonEmptyString(receiptId)) return null;
  const receipt = await prisma.auditReceipt.findUnique({ where: { id: receiptId } });
  const structuralReceipt = receipt as AuditReceiptRecord | null;
  const inputHash = imageAuditInputHash(
    { secureUrl: imageUrl, publicId: imagePublicId },
    imageAltText ?? "",
  );
  if (!receiptMatches(structuralReceipt, {
    kind: "IMAGE",
    userId,
    brandProfileId,
    inputHash,
    configHash: auditConfigHash(brand, "IMAGE"),
  })) return null;

  const validReceipt = structuralReceipt;
  if (!validReceipt) return null;
  const parsed = parseImageAuditData(validReceipt.result);
  if (!parsed.valid || !parsed.present || !parsed.value || !isRecord(validReceipt.result)) return null;
  const asset = isRecord(validReceipt.result.asset) ? validReceipt.result.asset : null;
  const image = isRecord(validReceipt.result.image) ? validReceipt.result.image : null;
  if (
    !asset || asset.secureUrl !== imageUrl || asset.publicId !== imagePublicId ||
    !image || !nonEmptyString(image.name)
  ) return null;

  return {
    receiptId: validReceipt.id,
    value: parsed.value,
    result: validReceipt.result,
    resultHash: sha256Text(canonicalJson(validReceipt.result)),
    imageName: image.name,
  };
}

// A creator sees their own submissions. Reviewers see their review queue.
// Managers can inspect all submissions.
submissionsRouter.get("/", requireAuth, async (req, res) => {
  const user = req.authUser!;

  try {
    const where =
      req.query.scope === "approved"
        ? { status: "APPROVED" as const }
        : user.role === "CREATOR"
          ? { creatorId: user.id }
          : user.role === "REVIEWER"
            ? {
                OR: [
                  { status: "IN_REVIEW" as const },
                  { reviewerId: user.id },
                ],
              }
            : {};

    const submissions = await prisma.submission.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        tags: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        brandProfile: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true, email: true } },
        releasePassport: { select: { id: true, passportHash: true, issuedAt: true } },
        _count: {
          select: { findings: true, comments: true, revisions: true },
        },
      },
    });

    return res.json({ submissions });
  } catch (error) {
    return handleError(res, error, "Unable to list submissions.");
  }
});

// Create a draft only from server-generated audit receipts.
submissionsRouter.post(
  "/",
  requireAuth,
  requireRoles("CREATOR"),
  async (req, res) => {
    const body: unknown = req.body;
    if (!isRecord(body)) {
      return res.status(400).json({ error: "A JSON object is required." });
    }

    const { title, contentText, brandProfileId } = body;
    const tags = parseSubmissionTags(body.tags);
    const textAuditReceiptId = body.textAuditReceiptId;
    const imageAuditReceiptId = body.imageAuditReceiptId;
    const imageNameInput = body.imageName;
    const imageAltTextInput = body.imageAltText;
    const hasCloudinaryAsset =
      Object.prototype.hasOwnProperty.call(body, "imageUrl") ||
      Object.prototype.hasOwnProperty.call(body, "imagePublicId");
    const imageAsset = parseCloudinaryAsset(
      body.imageUrl,
      body.imagePublicId,
      hasCloudinaryAsset,
    );

    if (
      !nonEmptyString(title) ||
      title.trim().length > 160 ||
      typeof contentText !== "string" ||
      !contentText.trim() ||
      contentText.length > 20000 ||
      !nonEmptyString(brandProfileId) ||
      tags === null ||
      !imageAsset.valid ||
      (imageNameInput !== undefined && imageNameInput !== null &&
        (typeof imageNameInput !== "string" || imageNameInput.length > 255)) ||
      (imageAltTextInput !== undefined && imageAltTextInput !== null &&
        (typeof imageAltTextInput !== "string" || imageAltTextInput.length > 1000))
    ) {
      return res.status(400).json({
        error: "Provide a valid draft title, campaign copy, brandProfileId, and valid optional image details.",
      });
    }

    try {
      const brand = await loadAuditBrand(brandProfileId);
      if (!brand) {
        return res.status(404).json({ error: "Brand profile not found." });
      }

      // Drafts may be saved while content is in progress. Only trust audit findings
      // when a server-issued receipt matches the exact content and current brand rules.
      const textAudit = await validateTextAuditReceipt(
        textAuditReceiptId,
        req.authUser!.id,
        brand.id,
        contentText,
        brand,
      );

      const hasImage = Boolean(imageAsset.imageUrl && imageAsset.publicId);
      let imageAuditData: Prisma.InputJsonValue | null = null;
      let storedImageName: string | null = null;
      let storedImageAltText: string | null = null;
      let storedImageUrl: string | null = null;
      let storedImagePublicId: string | null = null;
      let storedImageReceiptId: string | null = null;

      if (hasImage) {
        const normalizedAltText = typeof imageAltTextInput === "string" ? imageAltTextInput.trim() : "";
        // Keep the actual uploaded asset and creator-supplied metadata on the draft, even
        // if its latest audit has gone stale. Never persist findings without a valid receipt.
        storedImageName = typeof imageNameInput === "string" && imageNameInput.trim()
          ? imageNameInput.trim()
          : null;
        storedImageAltText = normalizedAltText || null;
        storedImageUrl = imageAsset.imageUrl!;
        storedImagePublicId = imageAsset.publicId!;

        const imageAudit = await validateImageAuditReceipt(
          imageAuditReceiptId,
          req.authUser!.id,
          brand.id,
          imageAsset.imageUrl!,
          imageAsset.publicId!,
          normalizedAltText || null,
          brand,
        );
        if (imageAudit) {
          const asset = isRecord(imageAudit.result.asset) ? imageAudit.result.asset : null;
          if (asset) {
            imageAuditData = imageAudit.value;
            storedImageName = imageAudit.imageName;
            storedImageUrl = asset.secureUrl as string;
            storedImagePublicId = asset.publicId as string;
            storedImageReceiptId = imageAudit.receiptId;
          }
        }
      } else if (imageAuditReceiptId !== undefined && imageAuditReceiptId !== null) {
        return res.status(400).json({ error: "An image audit receipt was supplied without a campaign image." });
      }

      const submission = await prisma.$transaction(async (tx) => {
        const created = await tx.submission.create({
          data: {
            title: title.trim(),
            tags: tags ?? [],
            contentText,
            imageName: storedImageName,
            imageAltText: storedImageAltText,
            imageUrl: storedImageUrl,
            imagePublicId: storedImagePublicId,
            imageAuditData: imageAuditData ?? Prisma.DbNull,
            textAuditReceiptId: textAudit?.receiptId ?? null,
            imageAuditReceiptId: storedImageReceiptId,
            brandProfileId: brand.id,
            creatorId: req.authUser!.id,
          },
        });

        await tx.revision.create({
          data: {
            version: 1,
            contentText,
            imageName: created.imageName,
            imageAltText: created.imageAltText,
            imageUrl: created.imageUrl,
            imagePublicId: created.imagePublicId,
            imageAuditData: imageAuditData ?? Prisma.DbNull,
            submissionId: created.id,
            authorId: req.authUser!.id,
          },
        });

        if (textAudit && textAudit.findings.length > 0) {
          await tx.finding.createMany({
            data: textAudit.findings.map((finding) => ({
              ...finding,
              submissionId: created.id,
            })),
          });
        }

        return tx.submission.findUnique({
          where: { id: created.id },
          include: submissionDetails,
        });
      }, {
        maxWait: 10_000,
        timeout: 20_000,
      });

      return res.status(201).json({ submission });
    } catch (error) {
      return handleError(res, error, "Unable to create submission.");
    }
  },
);

// Public, read-only verification for a release passport. Only summary metadata and hashes are exposed.
submissionsRouter.get("/passport/:passportId/verify", async (req, res) => {
  try {
    const passportId = getRouteParam(req.params.passportId);
    const passport = await prisma.releasePassport.findUnique({
      where: { id: passportId },
      include: {
        submission: {
          include: {
            brandProfile: {
              include: {
                rules: { where: { isActive: true } },
                facts: { where: { isActive: true } },
                assets: { where: { assetType: "PRIMARY_LOGO" }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!passport) return res.status(404).json({ valid: false, status: "NOT_FOUND" });

    const submission = passport.submission;
    const snapshot = passport.snapshot as unknown as ReleasePassportSnapshot;
    const brand = submission.brandProfile;
    const contentHash = sha256Text(submission.contentText);
    const currentImageInputHash = submission.imageUrl && submission.imagePublicId
      ? imageAuditInputHash(
          { secureUrl: submission.imageUrl, publicId: submission.imagePublicId },
          submission.imageAltText ?? "",
        )
      : null;
    const textReceipt = submission.textAuditReceiptId
      ? await prisma.auditReceipt.findUnique({ where: { id: submission.textAuditReceiptId } })
      : null;
    const imageReceipt = submission.imageAuditReceiptId
      ? await prisma.auditReceipt.findUnique({ where: { id: submission.imageAuditReceiptId } })
      : null;

    const textConfigHash = auditConfigHash(brand, "TEXT");
    const imageConfigHash = auditConfigHash(brand, "IMAGE");
    const snapshotShapeValid = Boolean(
      snapshot && snapshot.schemaVersion === 1 && snapshot.campaign && snapshot.audit &&
      snapshot.audit.text && snapshot.approval,
    );
    const passportSecret = process.env.RELEASE_PASSPORT_SECRET || process.env.JWT_SECRET || "";
    const passportIntegrityValid = snapshotShapeValid && passportSecret.length >= 32 &&
      verifyReleasePassportHash(snapshot, passport.passportHash, passportSecret);
    const textAuditValid = Boolean(
      snapshotShapeValid && textReceipt && textReceipt.kind === "TEXT" &&
      textReceipt.userId === submission.creatorId &&
      textReceipt.brandProfileId === submission.brandProfileId &&
      textReceipt.id === snapshot.audit.text.receiptId &&
      textReceipt.inputHash === snapshot.audit.text.inputHash &&
      textReceipt.inputHash === contentHash &&
      textReceipt.configHash === snapshot.audit.text.configHash &&
      textReceipt.configHash === textConfigHash &&
      sha256Text(canonicalJson(textReceipt.result)) === snapshot.audit.text.resultHash &&
      (textReceipt.result as Record<string, unknown>).semanticStatus === snapshot.audit.text.semanticStatus &&
      submission.textAuditReceiptId === snapshot.audit.text.receiptId,
    );
    const imageAuditValid = snapshotShapeValid && snapshot.audit.image === null
      ? !submission.imageUrl && !submission.imagePublicId && !submission.imageAuditReceiptId
      : Boolean(
          snapshotShapeValid && snapshot.audit.image && imageReceipt && currentImageInputHash &&
          imageReceipt.kind === "IMAGE" && imageReceipt.userId === submission.creatorId &&
          imageReceipt.brandProfileId === submission.brandProfileId &&
          imageReceipt.id === snapshot.audit.image.receiptId &&
          imageReceipt.inputHash === snapshot.audit.image.inputHash &&
          imageReceipt.inputHash === currentImageInputHash &&
          imageReceipt.configHash === snapshot.audit.image.configHash &&
          imageReceipt.configHash === imageConfigHash &&
          sha256Text(canonicalJson(imageReceipt.result)) === snapshot.audit.image.resultHash &&
          submission.imageAuditReceiptId === snapshot.audit.image.receiptId,
        );
    const campaignSnapshotValid = Boolean(
      snapshotShapeValid && snapshot.campaign.submissionId === submission.id &&
      snapshot.campaign.title === submission.title &&
      snapshot.campaign.brandProfileId === submission.brandProfileId &&
      snapshot.campaign.brandName === brand.name &&
      snapshot.campaign.contentHash === contentHash &&
      snapshot.campaign.imageInputHash === currentImageInputHash,
    );
    const approvalSnapshotValid = Boolean(
      snapshotShapeValid && snapshot.approval.decision === "APPROVED" &&
      submission.status === "APPROVED" && submission.reviewerId === snapshot.approval.reviewerId,
    );
    const valid = Boolean(
      passportIntegrityValid && textAuditValid && imageAuditValid &&
      campaignSnapshotValid && approvalSnapshotValid,
    );

    return res.json({
      valid,
      status: valid ? "VALID" : "INVALIDATED",
      passportId: passport.id,
      passportHash: passport.passportHash,
      issuedAt: passport.issuedAt,
      campaign: {
        title: snapshotShapeValid ? snapshot.campaign.title : submission.title,
        brandName: snapshotShapeValid ? snapshot.campaign.brandName : brand.name,
      },
      approval: snapshotShapeValid ? {
        reviewerName: snapshot.approval.reviewerName,
        approvedAt: snapshot.approval.approvedAt,
        decision: snapshot.approval.decision,
        override: snapshot.approval.override ?? null,
      } : null,
      checks: {
        passportSignature: passportIntegrityValid,
        campaignSnapshot: campaignSnapshotValid,
        textAuditReceipt: textAuditValid,
        imageAuditReceipt: snapshotShapeValid && snapshot.audit.image === null ? null : imageAuditValid,
        approvalState: approvalSnapshotValid,
      },
      audit: snapshotShapeValid ? {
        textSemanticStatus: snapshot.audit.text.semanticStatus,
        image: snapshot.audit.image ? "completed" : "not_applicable",
      } : null,
      message: valid
        ? "This release passport matches the approved campaign, audit receipts, and current brand rules."
        : "This release passport no longer matches the current campaign or brand configuration.",
    });
  } catch (error) {
    return handleError(res, error, "Unable to verify release passport.");
  }
});

// Read a submission with findings, comments, and revision history.
submissionsRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    const submission = await loadAccessibleSubmission(
      getRouteParam(req.params.id),
      req.authUser!,
      res,
    );

    if (!submission) return;
    return res.json({ submission });
  } catch (error) {
    return handleError(res, error, "Unable to load submission.");
  }
});

// Authenticated users who can access an approved campaign can retrieve its release passport.
submissionsRouter.get("/:id/passport", requireAuth, async (req, res) => {
  try {
    const submission = await loadAccessibleSubmission(
      getRouteParam(req.params.id),
      req.authUser!,
      res,
    );
    if (!submission) return;
    if (submission.status !== "APPROVED" || !submission.releasePassport) {
      return res.status(404).json({ error: "No release passport has been issued for this campaign." });
    }
    return res.json({ passport: submission.releasePassport });
  } catch (error) {
    return handleError(res, error, "Unable to load release passport.");
  }
});

// Creators can edit drafts/returned submissions. Audit findings and image results come from receipts.
submissionsRouter.patch(
  "/:id",
  requireAuth,
  requireRoles("CREATOR"),
  async (req, res) => {
    const body: unknown = req.body;
    if (!isRecord(body)) {
      return res.status(400).json({ error: "A JSON object is required." });
    }

    const { title, contentText } = body;
    const hasTags = Object.prototype.hasOwnProperty.call(body, "tags");
    const tags = hasTags ? parseSubmissionTags(body.tags) : undefined;
    const hasFindings = body.findings !== undefined;
    const hasTextAuditReceipt = Object.prototype.hasOwnProperty.call(body, "textAuditReceiptId");
    const hasImageAuditReceipt = Object.prototype.hasOwnProperty.call(body, "imageAuditReceiptId");
    const hasImageName = Object.prototype.hasOwnProperty.call(body, "imageName");
    const hasImageAltText = Object.prototype.hasOwnProperty.call(body, "imageAltText");
    const hasCloudinaryAsset =
      Object.prototype.hasOwnProperty.call(body, "imageUrl") ||
      Object.prototype.hasOwnProperty.call(body, "imagePublicId");
    const imageAsset = parseCloudinaryAsset(body.imageUrl, body.imagePublicId, hasCloudinaryAsset);
    const clientImageAudit = parseImageAuditData(body.imageAuditData);
    const imageNameInput = body.imageName;
    const imageAltTextInput = body.imageAltText;
    const hasImageFields = hasImageName || hasImageAltText || clientImageAudit.present || imageAsset.present;

    if (
      (title !== undefined && (!nonEmptyString(title) || title.trim().length > 160)) ||
      (contentText !== undefined && (typeof contentText !== "string" || !contentText.trim() || contentText.length > 20000)) ||
      (title === undefined && contentText === undefined && !hasFindings && !hasImageFields && !hasTags && !hasTextAuditReceipt && !hasImageAuditReceipt) ||
      (hasTags && tags === null) ||
      !clientImageAudit.valid ||
      !imageAsset.valid ||
      (hasImageName && imageNameInput !== null && imageNameInput !== undefined &&
        (typeof imageNameInput !== "string" || imageNameInput.length > 255)) ||
      (hasImageAltText && imageAltTextInput !== null && imageAltTextInput !== undefined &&
        (typeof imageAltTextInput !== "string" || imageAltTextInput.length > 1000))
    ) {
      return res.status(400).json({ error: "Invalid submission update." });
    }

    try {
      const current = await prisma.submission.findUnique({
        where: { id: getRouteParam(req.params.id) },
      });
      if (!current) return res.status(404).json({ error: "Submission not found." });
      if (current.creatorId !== req.authUser!.id) {
        return res.status(403).json({ error: "You do not own this submission." });
      }
      if (current.status !== "DRAFT" && current.status !== "CHANGES_REQUESTED") {
        return res.status(409).json({ error: "Only drafts or submissions returned for changes can be edited." });
      }

      const nextContent = typeof contentText === "string" ? contentText : current.contentText;
      const contentChanged = nextContent !== current.contentText;
      const nextImageNameInput = hasImageName
        ? (typeof imageNameInput === "string" && imageNameInput.trim() ? imageNameInput.trim() : null)
        : current.imageName;
      const nextImageAltText = hasImageAltText
        ? (typeof imageAltTextInput === "string" && imageAltTextInput.trim() ? imageAltTextInput.trim() : null)
        : current.imageAltText;
      const nextImageUrlInput = imageAsset.present ? imageAsset.imageUrl : current.imageUrl;
      const nextImagePublicIdInput = imageAsset.present ? imageAsset.publicId : current.imagePublicId;

      let nextTextAuditReceiptId = current.textAuditReceiptId;
      let trustedFindings: PersistedFinding[] | undefined;
      const needsTextReceipt = typeof contentText === "string" || hasFindings || hasTextAuditReceipt;
      if (needsTextReceipt) {
        const brand = await loadAuditBrand(current.brandProfileId);
        if (!brand) return res.status(404).json({ error: "Brand profile not found." });
        const selectedReceiptId = hasTextAuditReceipt ? body.textAuditReceiptId : current.textAuditReceiptId;
        const audit = await validateTextAuditReceipt(
          selectedReceiptId,
          req.authUser!.id,
          current.brandProfileId,
          nextContent,
          brand,
        );
        if (!audit) {
          // Keep the creator's work; clear stale receipt/findings so they cannot be
          // mistaken for an audit of this version. Submission remains blocked until re-audit.
          nextTextAuditReceiptId = null;
          trustedFindings = [];
        } else {
          nextTextAuditReceiptId = audit.receiptId;
          trustedFindings = audit.findings;
        }
      }

      let nextImageUrl = nextImageUrlInput;
      let nextImagePublicId = nextImagePublicIdInput;
      let nextImageName = nextImageNameInput;
      let nextImageAuditData: Prisma.InputJsonValue | Prisma.JsonValue | null = current.imageAuditData;
      let nextImageAuditReceiptId = current.imageAuditReceiptId;
      const needsImageReceipt = hasImageFields || hasImageAuditReceipt;

      if (needsImageReceipt) {
        const hasNextImage = Boolean(nextImageUrl && nextImagePublicId);
        if (!hasNextImage) {
          if (nextImageUrl || nextImagePublicId) {
            return res.status(400).json({ error: "Image URL and public ID must be supplied together." });
          }
          nextImageUrl = null;
          nextImagePublicId = null;
          nextImageName = null;
          nextImageAuditData = null;
          nextImageAuditReceiptId = null;
        } else {
          const brand = await loadAuditBrand(current.brandProfileId);
          if (!brand) return res.status(404).json({ error: "Brand profile not found." });
          const selectedImageReceiptId = hasImageAuditReceipt ? body.imageAuditReceiptId : current.imageAuditReceiptId;
          const audit = await validateImageAuditReceipt(
            selectedImageReceiptId,
            req.authUser!.id,
            current.brandProfileId,
            nextImageUrl!,
            nextImagePublicId!,
            nextImageAltText,
            brand,
          );
          if (!audit) {
            // Preserve the cloud-hosted image and alt text, but discard stale audit output.
            nextImageAuditData = null;
            nextImageAuditReceiptId = null;
          } else {
            const asset = isRecord(audit.result.asset) ? audit.result.asset : null;
            if (!asset) {
              nextImageAuditData = null;
              nextImageAuditReceiptId = null;
            } else {
              nextImageUrl = asset.secureUrl as string;
              nextImagePublicId = asset.publicId as string;
              nextImageName = audit.imageName;
              nextImageAuditData = audit.value;
              nextImageAuditReceiptId = audit.receiptId;
            }
          }
        }
      }

      const imageChanged =
        nextImageName !== current.imageName ||
        nextImageAltText !== current.imageAltText ||
        nextImageUrl !== current.imageUrl ||
        nextImagePublicId !== current.imagePublicId ||
        JSON.stringify(nextImageAuditData ?? null) !== JSON.stringify(current.imageAuditData ?? null);
      const snapshotChanged = contentChanged || imageChanged;

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.submission.update({
          where: { id: current.id },
          data: {
            ...(typeof title === "string" ? { title: title.trim() } : {}),
            ...(hasTags ? { tags: tags! } : {}),
            ...(typeof contentText === "string" ? { contentText } : {}),
            imageName: nextImageName,
            imageAltText: nextImageAltText,
            imageUrl: nextImageUrl,
            imagePublicId: nextImagePublicId,
            imageAuditData: nextImageAuditData === null ? Prisma.DbNull : nextImageAuditData as Prisma.InputJsonValue,
            textAuditReceiptId: nextTextAuditReceiptId,
            imageAuditReceiptId: nextImageAuditReceiptId,
          },
        });

        if (snapshotChanged) {
          const latestRevision = await tx.revision.findFirst({
            where: { submissionId: current.id },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          await tx.revision.create({
            data: {
              version: (latestRevision?.version ?? 0) + 1,
              contentText: nextContent,
              imageName: nextImageName,
              imageAltText: nextImageAltText,
              imageUrl: nextImageUrl,
              imagePublicId: nextImagePublicId,
              imageAuditData: nextImageAuditData === null ? Prisma.DbNull : nextImageAuditData as Prisma.InputJsonValue,
              submissionId: current.id,
              authorId: req.authUser!.id,
            },
          });
        }

        if (trustedFindings !== undefined) {
          await tx.finding.deleteMany({ where: { submissionId: current.id } });
          if (trustedFindings.length > 0) {
            await tx.finding.createMany({
              data: trustedFindings.map((finding) => ({ ...finding, submissionId: current.id })),
            });
          }
        }

        return tx.submission.findUnique({
          where: { id: result.id },
          include: submissionDetails,
        });
      }, { maxWait: 10_000, timeout: 20_000 });

      return res.json({ submission: updated });
    } catch (error) {
      return handleError(res, error, "Unable to update submission.");
    }
  },
);

// Submission is accepted only when its persisted audit receipts match current content, assets, and rules.
submissionsRouter.post(
  "/:id/submit",
  requireAuth,
  requireRoles("CREATOR"),
  async (req, res) => {
    const requestBody: unknown = req.body;
    const updateValidation = validateCreatorUpdateSummary(
      isRecord(requestBody) ? requestBody.changeSummary : undefined,
    );
    if (!updateValidation.valid) {
      return res.status(400).json({ error: updateValidation.error });
    }
    const changeSummary = updateValidation.summary;

    try {
      const current = await prisma.submission.findUnique({
        where: { id: getRouteParam(req.params.id) },
      });
      if (!current) return res.status(404).json({ error: "Submission not found." });
      if (current.creatorId !== req.authUser!.id) {
        return res.status(403).json({ error: "You do not own this submission." });
      }
      if (current.status !== "DRAFT" && current.status !== "CHANGES_REQUESTED") {
        return res.status(409).json({ error: "Only drafts or returned submissions can be submitted for review." });
      }

      const brand = await loadAuditBrand(current.brandProfileId);
      if (!brand) return res.status(404).json({ error: "Brand profile not found." });

      const textAudit = await validateTextAuditReceipt(
        current.textAuditReceiptId,
        current.creatorId,
        current.brandProfileId,
        current.contentText,
        brand,
      );
      if (!textAudit) {
        return res.status(409).json({
          error: "Submission blocked: the text audit is missing or stale. Open the draft and run Preflight Audit again.",
        });
      }
      if (textAudit.semanticStatus !== "completed") {
        return res.status(409).json({
          error: "Submission blocked: AI semantic review was unavailable during the last audit. Run Preflight Audit again when Gemini is available.",
        });
      }

      const hasImage = Boolean(current.imageUrl || current.imagePublicId);
      if (hasImage) {
        if (!current.imageUrl || !current.imagePublicId) {
          return res.status(409).json({ error: "Submission blocked: the campaign image asset is incomplete. Run Image Audit again." });
        }
        const imageAudit = await validateImageAuditReceipt(
          current.imageAuditReceiptId,
          current.creatorId,
          current.brandProfileId,
          current.imageUrl,
          current.imagePublicId,
          current.imageAltText,
          brand,
        );
        if (!imageAudit) {
          return res.status(409).json({
            error: "Submission blocked: the image audit is missing or stale. Re-run Image Audit for the current image and alt text.",
          });
        }
      }

      // Keep the status transition and creator's revision summary atomic. Receipt
      // validation and asset checks stay outside this short transaction.
      const submitResult = await prisma.$transaction(async (tx) => {
        const changed = await tx.submission.updateMany({
          where: {
            id: current.id,
            creatorId: current.creatorId,
            status: current.status,
            brandProfileId: current.brandProfileId,
            contentText: current.contentText,
            textAuditReceiptId: current.textAuditReceiptId,
            imageUrl: current.imageUrl,
            imagePublicId: current.imagePublicId,
            imageAltText: current.imageAltText,
            imageAuditReceiptId: current.imageAuditReceiptId,
          },
          data: { status: "IN_REVIEW" },
        });
        if (changed.count !== 1) return { conflict: true as const };

        await tx.comment.create({
          data: {
            body: `CREATOR UPDATE\n${changeSummary}`,
            submissionId: current.id,
            authorId: req.authUser!.id,
          },
        });
        return { conflict: false as const };
      }, { maxWait: 10_000, timeout: 20_000 });

      if (submitResult.conflict) {
        return res.status(409).json({ error: "The campaign changed while its audits were being verified. Run the audits again and submit the latest version." });
      }

      const submission = await prisma.submission.findUnique({
        where: { id: current.id },
        include: submissionDetails,
      });
      return res.json({ submission });
    } catch (error) {
      return handleError(res, error, "Unable to submit this campaign for review.");
    }
  },
);

// A reviewer or manager can approve or request changes on an in-review item.
submissionsRouter.post(
  "/:id/review",
  requireAuth,
  requireRoles("REVIEWER", "MANAGER"),
  async (req, res) => {
    const body: unknown = req.body;

    if (!isRecord(body)) {
      return res.status(400).json({ error: "A JSON object is required." });
    }

    const decision = validateReviewDecision(body.status, body.note);
    if (!decision.valid) {
      return res.status(400).json({ error: decision.error });
    }

    const { status, note } = decision;

    try {
      const current = await prisma.submission.findUnique({
        where: { id: getRouteParam(req.params.id) },
      });

      if (!current) {
        return res.status(404).json({ error: "Submission not found." });
      }

      if (current.status !== "IN_REVIEW") {
        return res.status(409).json({
          error: "Only submissions currently in review can be approved or returned.",
        });
      }

      let passportDraft: ReturnType<typeof createReleasePassport> | null = null;
      let approvalRequiresOverride = false;
      let approvalReleaseGate: ReturnType<typeof evaluateReleaseGate> | null = null;
      if (status === "APPROVED") {
        const brand = await loadAuditBrand(current.brandProfileId);
        if (!brand) return res.status(404).json({ error: "Brand profile not found." });

        const textAudit = await validateTextAuditReceipt(
          current.textAuditReceiptId,
          current.creatorId,
          current.brandProfileId,
          current.contentText,
          brand,
        );
        if (!textAudit) {
          return res.status(409).json({
            error: "Approval blocked: the text audit is missing or stale. Return the campaign for a fresh preflight audit before approval.",
          });
        }
        if (textAudit.semanticStatus !== "completed") {
          return res.status(409).json({
            error: "Approval blocked: the AI semantic audit was unavailable. Return the campaign for a fresh audit.",
          });
        }

        const hasImage = Boolean(current.imageUrl || current.imagePublicId);
        let imageSnapshot: ReleasePassportSnapshot["audit"]["image"] = null;
        let currentImageInputHash: string | null = null;
        let imageAuditResult: Awaited<ReturnType<typeof validateImageAuditReceipt>> = null;

        if (hasImage) {
          if (!current.imageUrl || !current.imagePublicId) {
            return res.status(409).json({
              error: "Approval blocked: the campaign image asset is incomplete.",
            });
          }

          imageAuditResult = await validateImageAuditReceipt(
            current.imageAuditReceiptId,
            current.creatorId,
            current.brandProfileId,
            current.imageUrl,
            current.imagePublicId,
            current.imageAltText,
            brand,
          );

          if (!imageAuditResult) {
            return res.status(409).json({
              error: "Approval blocked: the image audit is missing or stale. Return the campaign for a fresh image audit before approval.",
            });
          }

          currentImageInputHash = imageAuditInputHash(
            { secureUrl: current.imageUrl, publicId: current.imagePublicId },
            current.imageAltText ?? "",
          );

          imageSnapshot = {
            receiptId: imageAuditResult.receiptId,
            inputHash: currentImageInputHash,
            configHash: auditConfigHash(brand, "IMAGE"),
            resultHash: imageAuditResult.resultHash,
          };
        }

        // Findings are read from validated receipts, never from client-supplied data.
        const imageFindings =
          imageAuditResult &&
          isRecord(imageAuditResult.result) &&
          Array.isArray(imageAuditResult.result.findings)
            ? imageAuditResult.result.findings
            : [];

        const releaseGate = evaluateReleaseGate([
          ...textAudit.findings,
          ...imageFindings,
        ]);
        approvalReleaseGate = releaseGate;

        const gateError = getReleaseGateApprovalError(releaseGate, note);
        if (gateError) {
          return res.status(409).json({
            error: gateError,
            releaseGate,
          });
        }

        approvalRequiresOverride = releaseGate.status === "REQUIRES_OVERRIDE";

        const approvedAt = new Date().toISOString();
        const snapshot: ReleasePassportSnapshot = {
          schemaVersion: 1,
          campaign: {
            submissionId: current.id,
            title: current.title,
            brandProfileId: brand.id,
            brandName: brand.name,
            contentHash: sha256Text(current.contentText),
            imageInputHash: currentImageInputHash,
          },
          audit: {
            text: {
              receiptId: textAudit.receiptId,
              inputHash: sha256Text(current.contentText),
              configHash: auditConfigHash(brand, "TEXT"),
              resultHash: textAudit.resultHash,
              semanticStatus: textAudit.semanticStatus,
            },
            image: imageSnapshot,
          },
          approval: {
            decision: "APPROVED",
            reviewerId: req.authUser!.id,
            reviewerName: req.authUser!.name,
            approvedAt,
            ...(approvalRequiresOverride && approvalReleaseGate && note
              ? {
                  override: {
                    reason: note.trim(),
                    highRiskFindings: approvalReleaseGate.highRiskFindings,
                    warnings: approvalReleaseGate.warnings,
                  },
                }
              : {}),
          },
        };
        const passportSecret = process.env.RELEASE_PASSPORT_SECRET || process.env.JWT_SECRET || "";
        if (passportSecret.length < 32) {
          return res.status(500).json({ error: "Release passport signing is not configured. Set RELEASE_PASSPORT_SECRET or a strong JWT_SECRET." });
        }
        passportDraft = createReleasePassport(snapshot, passportSecret);
      }

      const reviewResult = await prisma.$transaction(async (tx) => {
        // Compare-and-set the state: only one reviewer can decide an IN_REVIEW
        // submission. A concurrent/replayed decision cannot overwrite the winner.
        const reviewTransition = await tx.submission.updateMany({
          where: { id: current.id, status: "IN_REVIEW" },
          data: {
            status,
            reviewerId: req.authUser!.id,
          },
        });

        if (reviewTransition.count !== 1) {
          return { conflict: true as const };
        }

        // Keep the review note atomic with the status transition.
        if (typeof note === "string" && note.trim()) {
          await tx.comment.create({
            data: {
              body: status === "CHANGES_REQUESTED"
                ? `CHANGE REQUEST\n${note.trim()}`
                : approvalRequiresOverride && approvalReleaseGate && note
                  ? formatReviewerOverrideComment(note, approvalReleaseGate)
                  : note.trim(),
              submissionId: current.id,
              authorId: req.authUser!.id,
            },
          });
        }

        if (passportDraft) {
          await tx.releasePassport.create({
            data: {
              submissionId: current.id,
              passportHash: passportDraft.passportHash,
              snapshot: passportDraft.snapshot as Prisma.InputJsonValue,
            },
          });
        }

        return { conflict: false as const };
      }, { maxWait: 10_000, timeout: 20_000 });

      if (reviewResult.conflict) {
        return res.status(409).json({
          error: "Review decision was already recorded. Refresh the queue to see the latest status.",
        });
      }

      // Fetch the response payload after commit so the interactive transaction
      // only covers the atomic status/comment/passport writes.
      const submission = await prisma.submission.findUnique({
        where: { id: current.id },
        include: submissionDetails,
      });
      return res.json({ submission });
    } catch (error) {
      return handleError(res, error, "Unable to record review decision.");
    }
  },
);

// Add a persistent comment to any submission the user can access.
submissionsRouter.post("/:id/comments", requireAuth, async (req, res) => {
  const body: unknown = req.body;
  if (!isRecord(body) || !nonEmptyString(body.body) || body.body.length > 2000) {
    return res.status(400).json({
      error: "Comment body is required and must be at most 2,000 characters.",
    });
  }
  const commentBody = body.body.trim();
  if (/^(?:REVIEWER OVERRIDE|CHANGE REQUEST|OVERRIDE DECISION)\b/i.test(commentBody)) {
    return res.status(400).json({
      error: "Review decision records are created only by the review workflow.",
    });
  }
  if (/^OVERRIDE REQUEST\b/i.test(commentBody) && req.authUser!.role !== "CREATOR") {
    return res.status(403).json({ error: "Only the campaign creator can submit an override request." });
  }

  try {
    const current = await loadAccessibleSubmission(
      getRouteParam(req.params.id),
      req.authUser!,
      res,
    );

    if (!current) return;

    const comment = await prisma.comment.create({
      data: {
        body: body.body.trim(),
        submissionId: current.id,
        authorId: req.authUser!.id,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    return res.status(201).json({ comment });
  } catch (error) {
    return handleError(res, error, "Unable to add comment.");
  }
});

// Reviewer/Manager acknowledgement of a creator override request. This is an
// auditable discussion decision, not a release-gate bypass.
submissionsRouter.post(
  "/:id/override-requests/:commentId/decision",
  requireAuth,
  requireRoles("REVIEWER", "MANAGER"),
  async (req, res) => {
    const body: unknown = req.body;
    if (!isRecord(body)) {
      return res.status(400).json({ error: "A JSON object is required." });
    }

    const decision = body.decision;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if ((decision !== "ACCEPTED" && decision !== "REJECTED") || note.length < 10 || note.length > 1000) {
      return res.status(400).json({ error: "Choose ACCEPTED or REJECTED and provide a decision note of 10–1,000 characters." });
    }

    try {
      const current = await loadAccessibleSubmission(
        getRouteParam(req.params.id),
        req.authUser!,
        res,
      );
      if (!current) return;

      const result = await prisma.$transaction(async (tx) => {
        const submission = await tx.submission.findUnique({
          where: { id: current.id },
          select: { status: true },
        });
        if (!submission || submission.status !== "IN_REVIEW") {
          return { kind: "not_in_review" as const };
        }

        const request = await tx.comment.findFirst({
          where: { id: getRouteParam(req.params.commentId), submissionId: current.id },
          include: { author: { select: { role: true } } },
        });
        if (
          !request ||
          !request.body.startsWith("OVERRIDE REQUEST\n") ||
          request.author.role !== "CREATOR" ||
          request.authorId !== current.creatorId
        ) {
          return { kind: "not_found" as const };
        }

        const decisionPrefix = `OVERRIDE DECISION\nRequest ID: ${request.id}\n`;
        const existingDecision = await tx.comment.findFirst({
          where: { submissionId: current.id, body: { startsWith: decisionPrefix } },
        });
        if (existingDecision) return { kind: "already_decided" as const };

        const comment = await tx.comment.create({
          data: {
            body: `${decisionPrefix}Decision: ${decision}\nDecision note: ${note}`,
            submissionId: current.id,
            authorId: req.authUser!.id,
          },
          include: {
            author: { select: { id: true, name: true, email: true, role: true } },
          },
        });
        return { kind: "created" as const, comment };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (result.kind === "not_in_review") {
        return res.status(409).json({ error: "Override requests can only be decided while the campaign is in review." });
      }
      if (result.kind === "not_found") {
        return res.status(404).json({ error: "Creator override request not found." });
      }
      if (result.kind === "already_decided") {
        return res.status(409).json({ error: "This override request already has a recorded decision." });
      }
      return res.status(201).json({ comment: result.comment });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        return res.status(409).json({ error: "This override request was decided concurrently. Refresh the campaign discussion." });
      }
      return handleError(res, error, "Unable to record override-request decision.");
    }
  },
);
