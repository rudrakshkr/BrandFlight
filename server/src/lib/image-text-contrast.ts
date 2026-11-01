import {
  contrastRatio,
  recommendAccessibleForeground,
  type AccessibilityColorPair,
  type AccessibilityRole,
} from "./wcag-contrast.js";

export type ImageTextBackgroundType = "SOLID" | "VARIABLE" | "TRANSPARENT" | "UNKNOWN";
export type ImageTextConfidence = "HIGH" | "MEDIUM" | "LOW";
export type ImageTextRole = AccessibilityRole | "UNKNOWN";

export interface NormalizedImageTextBounds {
  /** Coordinates use a 0–1000 scale relative to the EXIF-oriented image. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DetectedImageTextRegion {
  text: string;
  role: ImageTextRole;
  textSize: "NORMAL" | "LARGE" | "UNKNOWN";
  confidence: ImageTextConfidence;
  location: string;
  note: string;
  bounds: NormalizedImageTextBounds | null;
}

export interface VisionImageTextResult {
  textDetected: boolean;
  regions: DetectedImageTextRegion[];
  summary: string;
}

export interface ImageTextPixelMeasurement {
  status: "MEASURED" | "MANUAL_REVIEW";
  foregroundHex: string;
  backgroundHex: string;
  backgroundType: ImageTextBackgroundType;
  note: string;
}

export interface ImageTextContrastRegion extends DetectedImageTextRegion {
  foregroundHex: string;
  backgroundHex: string;
  backgroundType: ImageTextBackgroundType;
  contrastRatio: number | null;
  targetRatio: number;
  evaluation: "PIXEL_PASS" | "PIXEL_FAIL" | "MANUAL_REVIEW";
  recommendedForeground: string | null;
  measurement: "PIXEL_SAMPLE" | "MANUAL_REVIEW";
  measurementNote: string;
}

export interface ImageTextContrastReport {
  status: "ANALYZED" | "NO_TEXT_DETECTED" | "NEEDS_REVIEW" | "UNAVAILABLE";
  standardsConfigured: boolean;
  summary: string;
  regions: ImageTextContrastRegion[];
}

// A small guard band prevents borderline samples from being promoted to a pass
// when image encoding, resampling, or the AI-located crop introduces uncertainty.
const PIXEL_PASS_SAFETY_MARGIN = 0.15;

export function buildImageTextContrastReport(
  vision: VisionImageTextResult,
  accessibilityPairs: AccessibilityColorPair[] | null,
  pixelMeasurements: ImageTextPixelMeasurement[],
): ImageTextContrastReport {
  if (!vision.textDetected && vision.regions.length === 0) {
    return {
      status: "NO_TEXT_DETECTED",
      standardsConfigured: Boolean(accessibilityPairs?.length),
      summary: "No clearly visible text was located by the vision model. This does not verify that the image is free of text or inaccessible content.",
      regions: [],
    };
  }

  const regions = vision.regions.slice(0, 20).map((region, index): ImageTextContrastRegion => {
    // AI determines text role and approximate size. Treat unknown size as normal text,
    // which applies the stricter 4.5:1 threshold.
    const targetRatio = region.textSize === "LARGE" ? 3 : 4.5;
    const measurement = pixelMeasurements[index] ?? {
      status: "MANUAL_REVIEW" as const,
      foregroundHex: "",
      backgroundHex: "",
      backgroundType: "UNKNOWN" as const,
      note: "No pixel measurement was returned for this detected text region.",
    };
    const contrast = measurement.status === "MEASURED"
      ? contrastRatio(measurement.foregroundHex, measurement.backgroundHex)
      : null;
    const evaluation: ImageTextContrastRegion["evaluation"] =
      measurement.status !== "MEASURED" || contrast === null
        ? "MANUAL_REVIEW"
        : contrast < targetRatio
          ? "PIXEL_FAIL"
          : contrast >= targetRatio + PIXEL_PASS_SAFETY_MARGIN
            ? "PIXEL_PASS"
            : "MANUAL_REVIEW";
    const recommendedForeground = evaluation === "PIXEL_FAIL"
      ? recommendAccessibleForeground(
          measurement.foregroundHex,
          measurement.backgroundHex,
          targetRatio + PIXEL_PASS_SAFETY_MARGIN,
        )
      : null;

    return {
      ...region,
      foregroundHex: measurement.foregroundHex,
      backgroundHex: measurement.backgroundHex,
      backgroundType: measurement.backgroundType,
      contrastRatio: contrast === null ? null : Math.round(contrast * 100) / 100,
      targetRatio,
      evaluation,
      recommendedForeground,
      measurement: measurement.status === "MEASURED" ? "PIXEL_SAMPLE" : "MANUAL_REVIEW",
      measurementNote: evaluation === "MANUAL_REVIEW" && measurement.status === "MEASURED" && contrast !== null
        ? `${measurement.note} The measured ratio is within ${PIXEL_PASS_SAFETY_MARGIN.toFixed(2)} of the target, so the system requires manual confirmation rather than granting a pass.`
        : measurement.note,
    };
  });

  const failed = regions.filter((region) => region.evaluation === "PIXEL_FAIL").length;
  const manual = regions.filter((region) => region.evaluation === "MANUAL_REVIEW").length;
  const passed = regions.filter((region) => region.evaluation === "PIXEL_PASS").length;
  const status = manual > 0 || failed > 0 || regions.length === 0 ? "NEEDS_REVIEW" : "ANALYZED";
  const summary = [
    `${regions.length} visible text region(s) located.`,
    `${passed} pixel-sampled pair(s) meet the screening target.`,
    `${failed} pixel-sampled pair(s) are below the target.`,
    `${manual} region(s) require manual review because reliable local pixel samples were unavailable.`,
  ].join(" ");

  return {
    status,
    standardsConfigured: Boolean(accessibilityPairs?.length),
    summary: vision.summary.trim() ? `${vision.summary.trim()} ${summary}` : summary,
    regions,
  };
}
