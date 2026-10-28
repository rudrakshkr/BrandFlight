import { Router, type Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
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

  if (user.role === "CREATOR" && submission.creatorId !== user.id) {
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

// A creator sees their own submissions. Reviewers see their review queue.
// Managers can inspect all submissions.
submissionsRouter.get("/", requireAuth, async (req, res) => {
  const user = req.authUser!;

  try {
    const where =
      user.role === "CREATOR"
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

// Create a draft, initial revision, and optional audit findings.
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
    const findings = parseFindings(body.findings);
    const tags = parseSubmissionTags(body.tags);
    const imageAudit = parseImageAuditData(body.imageAuditData);
    const imageName = body.imageName;
    const imageAltText = body.imageAltText;
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
      findings === null ||
      tags === null ||
      !imageAudit.valid ||
      !imageAsset.valid ||
      (imageName !== undefined && imageName !== null &&
        (typeof imageName !== "string" || imageName.length > 255)) ||
      (imageAltText !== undefined && imageAltText !== null &&
        (typeof imageAltText !== "string" || imageAltText.length > 1000))
    ) {
      return res.status(400).json({
        error: "Provide a title (up to 160 characters), content (up to 20,000 characters), brandProfileId, and at most 20 valid findings.",
      });
    }

    try {
      const brand = await prisma.brandProfile.findUnique({
        where: { id: brandProfileId },
        select: { id: true },
      });

      if (!brand) {
        return res.status(404).json({ error: "Brand profile not found." });
      }

      const submission = await prisma.$transaction(async (tx) => {
        const created = await tx.submission.create({
          data: {
            title: title.trim(),
            tags: tags ?? [],
            contentText,
            imageName: typeof imageName === "string" && imageName.trim()
              ? imageName.trim()
              : null,
            imageAltText: typeof imageAltText === "string" && imageAltText.trim()
              ? imageAltText.trim()
              : null,
            imageUrl: imageAsset.imageUrl,
            imagePublicId: imageAsset.publicId,
            ...(imageAudit.value
              ? { imageAuditData: imageAudit.value }
              : {}),
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
            ...(imageAudit.value
              ? { imageAuditData: imageAudit.value }
              : {}),
            submissionId: created.id,
            authorId: req.authUser!.id,
          },
        });

        if (findings.length > 0) {
          await tx.finding.createMany({
            data: findings.map((finding) => ({
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

// Creators can edit only their own draft or returned submission.
// A changed content version is recorded in the revision history.
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
    const findings = hasFindings
      ? parseFindings(body.findings)
      : undefined;
    const hasImageName = Object.prototype.hasOwnProperty.call(body, "imageName");
    const hasImageAltText = Object.prototype.hasOwnProperty.call(body, "imageAltText");
    const hasCloudinaryAsset =
      Object.prototype.hasOwnProperty.call(body, "imageUrl") ||
      Object.prototype.hasOwnProperty.call(body, "imagePublicId");
    const imageAsset = parseCloudinaryAsset(
      body.imageUrl,
      body.imagePublicId,
      hasCloudinaryAsset,
    );
    const imageAudit = parseImageAuditData(body.imageAuditData);
    const imageName = body.imageName;
    const imageAltText = body.imageAltText;
    const hasImageFields =
      hasImageName || hasImageAltText || imageAudit.present || imageAsset.present;

    if (
      (title !== undefined &&
        (!nonEmptyString(title) || title.trim().length > 160)) ||
      (contentText !== undefined &&
        (typeof contentText !== "string" ||
          !contentText.trim() ||
          contentText.length > 20000)) ||
      (title === undefined && contentText === undefined && !hasFindings && !hasImageFields && !hasTags) ||
      (hasTags && tags === null) ||
      (hasFindings && findings === null) ||
      !imageAudit.valid ||
      !imageAsset.valid ||
      (hasImageName && imageName !== null &&
        (typeof imageName !== "string" || imageName.length > 255)) ||
      (hasImageAltText && imageAltText !== null &&
        (typeof imageAltText !== "string" || imageAltText.length > 1000))
    ) {
      return res.status(400).json({ error: "Invalid submission update." });
    }

    try {
      const current = await prisma.submission.findUnique({
        where: { id: getRouteParam(req.params.id) },
      });

      if (!current) {
        return res.status(404).json({ error: "Submission not found." });
      }

      if (current.creatorId !== req.authUser!.id) {
        return res.status(403).json({ error: "You do not own this submission." });
      }

      if (
        current.status !== "DRAFT" &&
        current.status !== "CHANGES_REQUESTED"
      ) {
        return res.status(409).json({
          error: "Only drafts or submissions returned for changes can be edited.",
        });
      }

      const nextContent =
        typeof contentText === "string" ? contentText : current.contentText;
      const contentChanged = nextContent !== current.contentText;

      const nextImageName = hasImageName
        ? (typeof imageName === "string" && imageName.trim() ? imageName.trim() : null)
        : current.imageName;
      const nextImageAltText = hasImageAltText
        ? (typeof imageAltText === "string" && imageAltText.trim()
            ? imageAltText.trim()
            : null)
        : current.imageAltText;
      const nextImageUrl = imageAsset.present
        ? imageAsset.imageUrl
        : current.imageUrl;
      const nextImagePublicId = imageAsset.present
        ? imageAsset.publicId
        : current.imagePublicId;
      const imageAuditChanged = imageAudit.present &&
        JSON.stringify(current.imageAuditData ?? null) !==
        JSON.stringify(imageAudit.value ?? null);
      const nextImageAuditData = imageAudit.present
        ? imageAudit.value ?? null
        : current.imageAuditData;
      const imageChanged =
        nextImageName !== current.imageName ||
        nextImageAltText !== current.imageAltText ||
        nextImageUrl !== current.imageUrl ||
        nextImagePublicId !== current.imagePublicId ||
        imageAuditChanged;
      const snapshotChanged = contentChanged || imageChanged;

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.submission.update({
          where: { id: current.id },
          data: {
            ...(typeof title === "string" ? { title: title.trim() } : {}),
            ...(hasTags ? { tags: tags! } : {}),
            ...(typeof contentText === "string" ? { contentText } : {}),
            ...(hasImageName ? { imageName: nextImageName } : {}),
            ...(hasImageAltText ? { imageAltText: nextImageAltText } : {}),
            ...(imageAsset.present
              ? {
                  imageUrl: nextImageUrl,
                  imagePublicId: nextImagePublicId,
                }
              : {}),
            ...(imageAudit.present
              ? {
                  imageAuditData: imageAudit.value === null
                    ? Prisma.DbNull
                    : imageAudit.value!,
                }
              : {}),
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
              ...(nextImageAuditData
                ? { imageAuditData: nextImageAuditData as Prisma.InputJsonValue }
                : {}),
              submissionId: current.id,
              authorId: req.authUser!.id,
            },
          });
        }

        if (findings !== undefined && findings !== null) {
          await tx.finding.deleteMany({
            where: { submissionId: current.id },
          });

          if (findings.length > 0) {
            await tx.finding.createMany({
              data: findings.map((finding) => ({
                ...finding,
                submissionId: current.id,
              })),
            });
          }
        }

        return tx.submission.findUnique({
          where: { id: result.id },
          include: submissionDetails,
        });
      }, {
        maxWait: 10_000,
        timeout: 20_000,
      });

      return res.json({ submission: updated });
    } catch (error) {
      return handleError(res, error, "Unable to update submission.");
    }
  },
);

// Creator submits a draft or a returned revision for review.
submissionsRouter.post(
  "/:id/submit",
  requireAuth,
  requireRoles("CREATOR"),
  async (req, res) => {
    try {
      const current = await prisma.submission.findUnique({
        where: { id: getRouteParam(req.params.id) },
      });

      if (!current) {
        return res.status(404).json({ error: "Submission not found." });
      }

      if (current.creatorId !== req.authUser!.id) {
        return res.status(403).json({ error: "You do not own this submission." });
      }

      if (
        current.status !== "DRAFT" &&
        current.status !== "CHANGES_REQUESTED"
      ) {
        return res.status(409).json({
          error: "Only drafts or returned submissions can be submitted for review.",
        });
      }

      const submission = await prisma.submission.update({
        where: { id: current.id },
        data: { status: "IN_REVIEW" },
        include: submissionDetails,
      });

      return res.json({ submission });
    } catch (error) {
      return handleError(res, error, "Unable to submit for review.");
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

    const { status, note } = body;

    if (
      status !== "APPROVED" &&
      status !== "CHANGES_REQUESTED"
    ) {
      return res.status(400).json({
        error: "Status must be APPROVED or CHANGES_REQUESTED.",
      });
    }

    if (
      note !== undefined &&
      (typeof note !== "string" || note.length > 2000)
    ) {
      return res.status(400).json({ error: "Review note must be 2,000 characters or fewer." });
    }

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

      const submission = await prisma.$transaction(async (tx) => {
        const updated = await tx.submission.update({
          where: { id: current.id },
          data: {
            status,
            reviewerId: req.authUser!.id,
          },
        });

        if (typeof note === "string" && note.trim()) {
          await tx.comment.create({
            data: {
              body: note.trim(),
              submissionId: current.id,
              authorId: req.authUser!.id,
            },
          });
        }

        return tx.submission.findUnique({
          where: { id: updated.id },
          include: submissionDetails,
        });
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
