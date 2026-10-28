import { Router, type Request, type Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const imageAuditRouter = Router();

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ALT_TEXT_LENGTH = 150;
const MIN_ALT_TEXT_LENGTH = 10;
const COLOR_DISTANCE_THRESHOLD = 75;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 1,
    fields: 2,
  },
});

type ImageFinding = {
  category: "VISUAL" | "ACCESSIBILITY";
  severity: "WARNING" | "ERROR";
  title: string;
  message: string;
  evidence: string;
  suggestion: string;
  ruleCode: string;
  confidence: string;
};

type ColorBin = {
  count: number;
  r: number;
  g: number;
  b: number;
};

function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;

  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2,
  );
}

async function extractDominantColors(buffer: Buffer): Promise<string[]> {
  const { data, info } = await sharp(buffer, {
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .flatten({ background: "#FFFFFF" })
    .resize({ width: 64, height: 64, fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bins = new Map<string, ColorBin>();

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;

    // Group nearby RGB values to reduce sensitivity to antialiasing and noise.
    const key = `${Math.floor(r / 32)}-${Math.floor(g / 32)}-${Math.floor(b / 32)}`;
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };

    bin.count += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }

  return [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bin) => {
      const channels = [bin.r, bin.g, bin.b].map((sum) =>
        Math.round(sum / bin.count)
          .toString(16)
          .padStart(2, "0"),
      );

      return `#${channels.join("")}`.toUpperCase();
    });
}

async function processImageAudit(req: Request, res: Response) {
  const brandProfileId = req.body?.brandProfileId;
  const altText = typeof req.body?.altText === "string"
    ? req.body.altText.trim()
    : "";

  if (typeof brandProfileId !== "string" || !brandProfileId.trim()) {
    return res.status(400).json({
      error: "brandProfileId is required.",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "Upload a PNG or JPEG image using the image field.",
    });
  }

  const brand = await prisma.brandProfile.findUnique({
    where: { id: brandProfileId },
    include: {
      rules: { where: { isActive: true } },
    },
  });

  if (!brand) {
    return res.status(404).json({ error: "Brand profile not found." });
  }

  const metadata = await sharp(req.file.buffer, {
    limitInputPixels: 40_000_000,
  }).metadata();

  if (metadata.format !== "png" && metadata.format !== "jpeg") {
    return res.status(415).json({
      error: "Unsupported image content. Upload a valid PNG or JPEG file.",
    });
  }

  const dominantColors = await extractDominantColors(req.file.buffer);
  const approvedColors = brand.brandColors
    .filter((color) => hexToRgb(color) !== null)
    .map((color) => color.toUpperCase());

  const visualRuleCode =
    brand.rules.find((rule) => rule.category === "VISUAL")?.ruleCode ??
    "VISUAL-01";

  const accessibilityRuleCode =
    brand.rules.find((rule) => rule.category === "ACCESSIBILITY")?.ruleCode ??
    "ACCESSIBILITY-01";

  const findings: ImageFinding[] = [];

  if (approvedColors.length === 0) {
    findings.push({
      category: "VISUAL",
      severity: "WARNING",
      title: "No approved brand palette configured",
      message: "The image was processed, but no valid brand colors are available for comparison.",
      evidence: dominantColors.join(", "),
      suggestion: "Add approved six-digit hex colors to the brand profile.",
      ruleCode: visualRuleCode,
      confidence: "Deterministic Match",
    });
  } else {
    const palette = approvedColors
      .map((color) => ({ color, rgb: hexToRgb(color) }))
      .filter(
        (item): item is { color: string; rgb: [number, number, number] } =>
          item.rgb !== null,
      );

    const matchesPalette = dominantColors.some((dominant) => {
      const rgb = hexToRgb(dominant);
      if (!rgb) return false;

      return palette.some(
        (approved) =>
          colorDistance(rgb, approved.rgb) <= COLOR_DISTANCE_THRESHOLD,
      );
    });

    if (!matchesPalette) {
      findings.push({
        category: "VISUAL",
        severity: "WARNING",
        title: "Dominant image colors differ from the brand palette",
        message:
          "None of the five extracted dominant colors is sufficiently close to an approved brand color.",
        evidence: dominantColors.join(", "),
        suggestion: `Review the image palette or use approved colors: ${approvedColors.join(", ")}.`,
        ruleCode: visualRuleCode,
        confidence: "Deterministic Match",
      });
    }
  }

  if (!altText) {
    findings.push({
      category: "ACCESSIBILITY",
      severity: "ERROR",
      title: "Image alt text is missing",
      message: "No alternative text was supplied for this campaign image.",
      evidence: req.file.originalname,
      suggestion: "Add concise alternative text describing the meaningful information in the image.",
      ruleCode: accessibilityRuleCode,
      confidence: "Deterministic Match",
    });
  } else if (altText.length < MIN_ALT_TEXT_LENGTH) {
    findings.push({
      category: "ACCESSIBILITY",
      severity: "WARNING",
      title: "Image alt text may be too short",
      message: `Alt text contains ${altText.length} characters; the configured minimum is ${MIN_ALT_TEXT_LENGTH}.`,
      evidence: altText,
      suggestion: "Describe the image's meaningful content in a little more detail.",
      ruleCode: accessibilityRuleCode,
      confidence: "Deterministic Match",
    });
  } else if (altText.length > MAX_ALT_TEXT_LENGTH) {
    findings.push({
      category: "ACCESSIBILITY",
      severity: "WARNING",
      title: "Image alt text is too long",
      message: `Alt text contains ${altText.length} characters; the configured maximum is ${MAX_ALT_TEXT_LENGTH}.`,
      evidence: altText,
      suggestion: "Shorten the description to its essential information.",
      ruleCode: accessibilityRuleCode,
      confidence: "Deterministic Match",
    });
  }

  return res.json({
    image: {
      name: req.file.originalname,
      format: metadata.format,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      dominantColors,
      approvedColors,
      altTextLength: altText.length,
    },
    totalFindings: findings.length,
    findings,
  });
}

imageAuditRouter.post("/", requireAuth, (req, res) => {
  upload.single("image")(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;

        return res.status(status).json({
          error:
            uploadError.code === "LIMIT_FILE_SIZE"
              ? "Image exceeds the 5 MB upload limit."
              : "Invalid upload. Submit one image of at most 5 MB.",
        });
      }

      return res.status(400).json({ error: "Unable to process the upload." });
    }

    void processImageAudit(req, res).catch((error: unknown) => {
      console.error("Image audit failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Unable to audit the image." });
      }
    });
  });
});
