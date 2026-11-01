import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImageTextContrastReport,
  type VisionImageTextResult,
  type ImageTextPixelMeasurement,
} from "../src/lib/image-text-contrast.js";
import {
  sampleImageTextRegionPixels,
  type RawRgbaImage,
} from "../src/lib/image-text-pixels.js";
import { contrastRatio } from "../src/lib/wcag-contrast.js";
import type { AccessibilityColorPair } from "../src/lib/wcag-contrast.js";

const standards: AccessibilityColorPair[] = [
  { role: "BODY_TEXT", foreground: "#17262A", background: "#FFFFFF" },
  { role: "HEADING", foreground: "#115E59", background: "#EAF5F1" },
  { role: "CTA_TEXT", foreground: "#FFFFFF", background: "#115E59" },
  { role: "CAPTION", foreground: "#354442", background: "#FFFFFF" },
  { role: "UI_ELEMENT", foreground: "#115E59", background: "#FFFFFF" },
];

const bounds = { left: 100, top: 100, right: 900, bottom: 900 };

function makeImage(foreground: [number, number, number]): RawRgbaImage {
  const width = 200;
  const height = 80;
  const channels = 4;
  const data = new Uint8Array(width * height * channels);
  for (let offset = 0; offset < data.length; offset += channels) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  const strokes: Array<[number, number, number, number]> = [
    [52, 28, 4, 20], [52, 28, 12, 4], [52, 36, 10, 4], [52, 44, 12, 4],
    [72, 28, 4, 20], [72, 28, 12, 4], [80, 36, 4, 8], [72, 44, 12, 4],
    [94, 28, 4, 20], [94, 28, 12, 4], [102, 36, 4, 8], [94, 44, 12, 4],
    [116, 28, 4, 20], [124, 28, 4, 20], [116, 28, 12, 4], [116, 44, 12, 4],
  ];
  for (const [sx, sy, sw, sh] of strokes) {
    for (let y = sy; y < sy + sh; y += 1) {
      for (let x = sx; x < sx + sw; x += 1) {
        const offset = (y * width + x) * channels;
        data[offset] = foreground[0];
        data[offset + 1] = foreground[1];
        data[offset + 2] = foreground[2];
      }
    }
  }
  return { data, width, height, channels };
}


function makeSingleLinePaddedImage(foreground: [number, number, number]): RawRgbaImage {
  const width = 1200;
  const height = 630;
  const channels = 4;
  const data = new Uint8Array(width * height * channels);
  for (let offset = 0; offset < data.length; offset += channels) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }

  // A compact, single-line glyph pattern centred in the image. The supplied
  // box has roughly 8–13% padding, mirroring the live Gemini locator contract.
  for (let index = 0; index < 26; index += 1) {
    const x = 406 + index * 14;
    const y = 308;
    const strokes: Array<[number, number, number, number]> = [
      [0, 0, 3, 22], [0, 0, 9, 3], [0, 9, 7, 3], [0, 19, 9, 3],
      [6, 3, 3, 4], [6, 13, 3, 6],
    ];
    for (const [dx, dy, strokeWidth, strokeHeight] of strokes) {
      for (let py = y + dy; py < y + dy + strokeHeight; py += 1) {
        for (let px = x + dx; px < x + dx + strokeWidth; px += 1) {
          const offset = (py * width + px) * channels;
          data[offset] = foreground[0];
          data[offset + 1] = foreground[1];
          data[offset + 2] = foreground[2];
        }
      }
    }
  }
  return { data, width, height, channels };
}

function vision(overrides: Partial<VisionImageTextResult> = {}): VisionImageTextResult {
  return {
    textDetected: true,
    summary: "A text region was located.",
    regions: [{
      text: "Your next idea starts here",
      role: "BODY_TEXT",
      textSize: "NORMAL",
      confidence: "HIGH",
      location: "center",
      note: "",
      bounds,
    }],
    ...overrides,
  };
}

test("solid text is evaluated from sampled pixels, not Gemini colour estimates", () => {
  const measurement = sampleImageTextRegionPixels(makeImage([23, 38, 42]), bounds, "HIGH");
  const report = buildImageTextContrastReport(vision(), standards, [measurement]);
  const region = report.regions[0]!;
  assert.equal(region.measurement, "PIXEL_SAMPLE");
  assert.equal(region.evaluation, "PIXEL_PASS");
  assert.equal(region.foregroundHex, "#17262A");
  assert.equal(region.backgroundHex, "#FFFFFF");
  assert.ok((region.contrastRatio ?? 0) >= 4.5);
  assert.equal(report.status, "ANALYZED");
});

test("the reported #8A8A8A on white test fixture fails using sampled pixels", () => {
  const measurement = sampleImageTextRegionPixels(makeImage([138, 138, 138]), bounds, "HIGH");
  const report = buildImageTextContrastReport(vision(), standards, [measurement]);
  const region = report.regions[0]!;
  assert.equal(region.measurement, "PIXEL_SAMPLE");
  assert.equal(region.foregroundHex, "#8A8A8A");
  assert.equal(region.backgroundHex, "#FFFFFF");
  assert.ok(Math.abs((region.contrastRatio ?? 0) - (contrastRatio("#8A8A8A", "#FFFFFF") ?? 0)) < 0.01);
  assert.equal(region.evaluation, "PIXEL_FAIL");
  assert.ok(region.recommendedForeground);
  assert.ok((contrastRatio(region.recommendedForeground!, "#FFFFFF") ?? 0) >= 4.65);
  assert.equal(report.status, "NEEDS_REVIEW");
});

test("single-line centered text with the requested 10–15% box padding is not mistaken for a variable background", () => {
  const paddedBounds = { left: 307, top: 483, right: 689, bottom: 530 };
  const measurement = sampleImageTextRegionPixels(
    makeSingleLinePaddedImage([138, 138, 138]),
    paddedBounds,
    "HIGH",
  );
  assert.equal(measurement.status, "MEASURED", measurement.note);
  assert.equal(measurement.foregroundHex, "#8A8A8A");
  assert.equal(measurement.backgroundHex, "#FFFFFF");
  const measuredRatio = contrastRatio(measurement.foregroundHex, measurement.backgroundHex) ?? 0;
  assert.ok(Math.abs(measuredRatio - (contrastRatio("#8A8A8A", "#FFFFFF") ?? 0)) < 0.01);
  assert.ok(measuredRatio < 4.5);
});

test("a manual pixel result cannot be converted into a pass by model-supplied values", () => {
  const manual: ImageTextPixelMeasurement = {
    status: "MANUAL_REVIEW",
    foregroundHex: "",
    backgroundHex: "#FFFFFF",
    backgroundType: "VARIABLE",
    note: "Local background is variable.",
  };
  const report = buildImageTextContrastReport(vision(), standards, [manual]);
  assert.equal(report.regions[0]?.evaluation, "MANUAL_REVIEW");
  assert.equal(report.regions[0]?.contrastRatio, null);
  assert.equal(report.regions[0]?.foregroundHex, "");
});

test("unknown text size uses the stricter normal-text threshold", () => {
  const measurement = sampleImageTextRegionPixels(makeImage([119, 119, 119]), bounds, "HIGH");
  const unknownSize = buildImageTextContrastReport(vision({
    regions: [{ ...vision().regions[0]!, textSize: "UNKNOWN" }],
  }), standards, [measurement]);
  assert.equal(unknownSize.regions[0]?.targetRatio, 4.5);
  assert.equal(unknownSize.regions[0]?.evaluation, "PIXEL_FAIL");
});

test("large text uses the large-text threshold only when explicitly classified large", () => {
  const measurement = sampleImageTextRegionPixels(makeImage([119, 119, 119]), bounds, "HIGH");
  const large = buildImageTextContrastReport(vision({
    regions: [{ ...vision().regions[0]!, textSize: "LARGE" }],
  }), standards, [measurement]);
  assert.equal(large.regions[0]?.targetRatio, 3);
  assert.equal(large.regions[0]?.evaluation, "PIXEL_PASS");
});

test("no located text is represented distinctly from a completed measurement", () => {
  const report = buildImageTextContrastReport({
    textDetected: false,
    regions: [],
    summary: "No text was located.",
  }, standards, []);
  assert.equal(report.status, "NO_TEXT_DETECTED");
  assert.equal(report.regions.length, 0);
});

test("a text region without a matching pixel result fails closed", () => {
  const report = buildImageTextContrastReport(vision(), standards, []);
  assert.equal(report.regions[0]?.evaluation, "MANUAL_REVIEW");
  assert.equal(report.regions[0]?.contrastRatio, null);
});


test("a measured ratio only marginally above target is sent for manual confirmation", () => {
  const measurement = sampleImageTextRegionPixels(makeImage([118, 118, 118]), bounds, "HIGH");
  const report = buildImageTextContrastReport(vision(), standards, [measurement]);
  const region = report.regions[0]!;
  assert.ok((region.contrastRatio ?? 0) >= region.targetRatio);
  assert.ok((region.contrastRatio ?? 0) < region.targetRatio + 0.15);
  assert.equal(region.evaluation, "MANUAL_REVIEW");
});
