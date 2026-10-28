import { Router, type Response } from "express";
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

const submissionDetails = {
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

    if (
      !nonEmptyString(title) ||
      title.trim().length > 160 ||
      typeof contentText !== "string" ||
      !contentText.trim() ||
      contentText.length > 20000 ||
      !nonEmptyString(brandProfileId) ||
      findings === null
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
            contentText,
            brandProfileId: brand.id,
            creatorId: req.authUser!.id,
          },
        });

        await tx.revision.create({
          data: {
            version: 1,
            contentText,
            submissionId: created.id,
            authorId: req.authUser!.id,
          },
        });

        for (const finding of findings) {
          await tx.finding.create({
            data: { ...finding, submissionId: created.id },
          });
        }

        return tx.submission.findUnique({
          where: { id: created.id },
          include: submissionDetails,
        });
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

    if (
      (title !== undefined &&
        (!nonEmptyString(title) || title.trim().length > 160)) ||
      (contentText !== undefined &&
        (typeof contentText !== "string" ||
          !contentText.trim() ||
          contentText.length > 20000)) ||
      (title === undefined && contentText === undefined)
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

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.submission.update({
          where: { id: current.id },
          data: {
            ...(typeof title === "string" ? { title: title.trim() } : {}),
            ...(typeof contentText === "string" ? { contentText } : {}),
          },
        });

        if (contentChanged) {
          const latestRevision = await tx.revision.findFirst({
            where: { submissionId: current.id },
            orderBy: { version: "desc" },
            select: { version: true },
          });

          await tx.revision.create({
            data: {
              version: (latestRevision?.version ?? 0) + 1,
              contentText: nextContent,
              submissionId: current.id,
              authorId: req.authUser!.id,
            },
          });
        }

        return tx.submission.findUnique({
          where: { id: result.id },
          include: submissionDetails,
        });
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
