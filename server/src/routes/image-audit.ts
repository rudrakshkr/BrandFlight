import { Router, type Request, type Response } from "express";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import sharp from "sharp";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { auditConfigHash, createAuditReceiptId, imageAuditInputHash } from "../lib/audit-receipts.js";
import { compareBrandLogo, type LogoVisualComparison } from "../lib/gemini.js";
import { requireAuth, requireRoles } from "../middleware/auth.js";

export const imageAuditRouter = Router();

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ALT_TEXT_LENGTH = 150;
const MIN_ALT_TEXT_LENGTH = 10;
const COLOR_DISTANCE_THRESHOLD = 75;

const MAX_REFERENCE_LOGO_BYTES = 5 * 1024 * 1024;

type ApprovedLogo = {
  id: string;
  name: string;
  format: string;
  secureUrl: string;
  publicId: string;
  expectedWordmark: string | null;
  description: string | null;
  isRequired: boolean;
};

async function downloadApprovedLogoReference(asset: ApprovedLogo): Promise<{ buffer: Buffer; mimeType: string }> {
  const url = new URL(asset.secureUrl);
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !url.pathname.includes("/image/upload/")) {
    throw new Error("The approved logo URL is not a trusted Cloudinary image URL.");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.body) throw new Error("Unable to fetch the approved logo reference.");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REFERENCE_LOGO_BYTES) throw new Error("The approved logo reference exceeds 5 MB.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_REFERENCE_LOGO_BYTES) {
        await reader.cancel();
        throw new Error("The approved logo reference exceeds 5 MB.");
      }
      chunks.push(value);
    }
  }
  const mimeByFormat: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
  const mimeType = mimeByFormat[asset.format];
  if (!mimeType) throw new Error("The approved logo format is unsupported for visual comparison.");
  return { buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), mimeType };
}

function notConfiguredLogoVerification() {
  return {
    outcome: "NOT_CONFIGURED" as const,
    confidence: "LOW" as const,
    logoDetected: false,
    wordmarkStatus: "NOT_CONFIGURED" as const,
    colorStatus: "NOT_CONFIGURED" as const,
    integrityStatus: "NOT_CONFIGURED" as const,
    summary: "No official logo reference is configured for this brand. Palette and alt-text checks can still run, but logo identity cannot be verified.",
    evidence: [] as string[],
    suggestions: ["A manager can upload the official primary logo in Brand Rulebook → Approved Brand Assets."],
    required: false,
    referenceLogo: null,
  };
}

function failedLogoVerification(asset: ApprovedLogo, message: string) {
  return {
    outcome: "NEEDS_REVIEW" as const,
    confidence: "LOW" as const,
    logoDetected: false,
    wordmarkStatus: "UNCLEAR" as const,
    colorStatus: "UNCLEAR" as const,
    integrityStatus: "UNCLEAR" as const,
    summary: message,
    evidence: [] as string[],
    suggestions: ["Retry the image audit or have a reviewer compare the campaign with the approved logo manually."],
    required: asset.isRequired,
    referenceLogo: { id: asset.id, name: asset.name, secureUrl: asset.secureUrl, expectedWordmark: asset.expectedWordmark, isRequired: asset.isRequired },
  };
}

async function uploadImageToCloudinary(buffer: Buffer) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary credentials are not configured.");
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return new Promise<{ secureUrl: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "brandflight/campaign-images",
        resource_type: "image",
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url || !result.public_id) {
          return reject(new Error("Cloudinary returned no asset URL or public ID."));
        }

        resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id,
        });
      },
    );

    stream.end(buffer);
  });
}

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
  if (altText.length > 1000) {
    return res.status(400).json({ error: "Image alt text must be 1,000 characters or fewer." });
  }

  const brand = await prisma.brandProfile.findUnique({
    where: { id: brandProfileId },
    include: {
      rules: { where: { isActive: true } },
      facts: { where: { isActive: true } },
      assets: { where: { assetType: "PRIMARY_LOGO" }, take: 1 },
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

  const palette = approvedColors
    .map((color) => ({ color, rgb: hexToRgb(color) }))
    .filter(
      (item): item is { color: string; rgb: [number, number, number] } =>
        item.rgb !== null,
    );

  // Report each dominant color's closest approved swatch. Previously, the image
  // passed this check if ANY one dominant color matched, often just the white
  // background of a logo/photo while its other colors were far from the palette.
  const colorAnalysis = dominantColors.map((color) => {
    const rgb = hexToRgb(color);
    if (!rgb || palette.length === 0) {
      return {
        color,
        nearestApprovedColor: null as string | null,
        distance: null as number | null,
        matchesPalette: false,
      };
    }

    const nearest = palette
      .map((approved) => ({
        color: approved.color,
        distance: colorDistance(rgb, approved.rgb),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return {
      color,
      nearestApprovedColor: nearest?.color ?? null,
      distance: nearest ? Math.round(nearest.distance) : null,
      matchesPalette: Boolean(nearest && nearest.distance <= COLOR_DISTANCE_THRESHOLD),
    };
  });

  const findings: ImageFinding[] = [];
  const offPaletteColors = colorAnalysis.filter((item) => !item.matchesPalette);

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
  } else if (offPaletteColors.length > 0) {
    findings.push({
      category: "VISUAL",
      severity: "WARNING",
      title: "Some dominant image colors differ from the brand palette",
      message: `${offPaletteColors.length} of ${colorAnalysis.length} extracted dominant colors are outside the configured RGB-distance tolerance (≤ ${COLOR_DISTANCE_THRESHOLD}). This is a palette similarity signal, not a full visual or accessibility assessment.`,
      evidence: offPaletteColors.map((item) => `${item.color} (nearest ${item.nearestApprovedColor ?? "no match"}, distance ${item.distance ?? "n/a"})`).join("; "),
      suggestion: `Review the flagged colors. If they are intentional, consider whether the approved palette should include them; otherwise adjust the image toward: ${approvedColors.join(", ")}.`,
      ruleCode: visualRuleCode,
      confidence: "Deterministic Match",
    });
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
  } else if (/^(?:image|photo|picture|graphic|banner|logo|logo image|product image|image file|photo image|company logo|brand logo)$/i.test(altText.replace(/\s+/g, " ").trim())) {
    findings.push({
      category: "ACCESSIBILITY",
      severity: "WARNING",
      title: "Alt text is too generic",
      message: "This label identifies the asset type but does not describe the meaningful content or purpose of the image.",
      evidence: altText,
      suggestion: "Describe what the image communicates. For a logo, identify the brand and any meaningful text shown in the image.",
      ruleCode: accessibilityRuleCode,
      confidence: "Deterministic Match",
    });
  }

  const configuredLogo = (brand.assets?.[0] ?? null) as ApprovedLogo | null;
  let logoVerification: ReturnType<typeof notConfiguredLogoVerification> | (LogoVisualComparison & {
    required: boolean;
    referenceLogo: { id: string; name: string; secureUrl: string; expectedWordmark: string | null; isRequired: boolean };
  }) = notConfiguredLogoVerification();

  if (configuredLogo) {
    try {
      const reference = await downloadApprovedLogoReference(configuredLogo);
      const campaignMimeType = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : "image/webp";
      const comparison = await compareBrandLogo(
        req.file.buffer,
        campaignMimeType,
        reference.buffer,
        reference.mimeType,
        configuredLogo.expectedWordmark,
        configuredLogo.description,
      );
      logoVerification = {
        ...comparison,
        required: configuredLogo.isRequired,
        referenceLogo: {
          id: configuredLogo.id,
          name: configuredLogo.name,
          secureUrl: configuredLogo.secureUrl,
          expectedWordmark: configuredLogo.expectedWordmark,
          isRequired: configuredLogo.isRequired,
        },
      };
    } catch (logoError) {
      const message = logoError instanceof Error
        ? `Logo comparison needs review: ${logoError.message}`
        : "Logo comparison could not be completed.";
      logoVerification = failedLogoVerification(configuredLogo, message);
    }

    const outcome = logoVerification.outcome;
    const mismatch = outcome === "MISMATCH" || (outcome === "NOT_DETECTED" && configuredLogo.isRequired);
    const shouldFlag = mismatch || outcome === "NEEDS_REVIEW";
    if (shouldFlag) {
      const severity: ImageFinding["severity"] = mismatch && configuredLogo.isRequired ? "ERROR" : "WARNING";
      findings.push({
        category: "VISUAL",
        severity,
        title: outcome === "NOT_DETECTED"
          ? "Required brand logo was not detected"
          : outcome === "MISMATCH"
            ? "Campaign logo may not match the approved reference"
            : "Brand logo needs manual review",
        message: logoVerification.summary,
        evidence: [
          `Reference: ${configuredLogo.name}`,
          `Expected wordmark: ${configuredLogo.expectedWordmark || "Not specified"}`,
          ...logoVerification.evidence,
        ].join("; ").slice(0, 2000),
        suggestion: logoVerification.suggestions.join(" ").slice(0, 2000) || "Compare the campaign logo with the official reference.",
        ruleCode: visualRuleCode,
        confidence: `Gemini visual comparison · ${logoVerification.confidence.toLowerCase()} confidence`,
      });
    }
  }

  const asset = await uploadImageToCloudinary(req.file.buffer);

  const auditResult = {
    asset: {
      secureUrl: asset.secureUrl,
      publicId: asset.publicId,
    },
    image: {
      name: req.file.originalname,
      format: metadata.format,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      dominantColors,
      approvedColors,
      colorAnalysis,
      altTextLength: altText.length,
    },
    totalFindings: findings.length,
    findings,
    logoVerification,
  };
  const auditReceipt = await prisma.auditReceipt.create({
    data: {
      id: createAuditReceiptId(),
      kind: "IMAGE",
      userId: req.authUser!.id,
      brandProfileId: brand.id,
      inputHash: imageAuditInputHash(asset, altText),
      configHash: auditConfigHash(brand, "IMAGE"),
      result: auditResult as unknown as Prisma.InputJsonValue,
    },
  });

  return res.json({ ...auditResult, auditReceiptId: auditReceipt.id });
}

imageAuditRouter.post("/", requireAuth, requireRoles("CREATOR"), (req, res) => {
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
