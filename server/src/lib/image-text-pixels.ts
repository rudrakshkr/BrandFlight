import {
  contrastRatio,
} from "./wcag-contrast.js";
import type { NormalizedImageTextBounds, ImageTextConfidence, ImageTextPixelMeasurement } from "./image-text-contrast.js";

export interface RawRgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

type Rgb = [number, number, number];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1] ?? sorted[middle] ?? 0;
  const upper = sorted[middle] ?? lower;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}

function medianRgb(pixels: Rgb[]): Rgb {
  return [
    Math.round(median(pixels.map((pixel) => pixel[0]))),
    Math.round(median(pixels.map((pixel) => pixel[1]))),
    Math.round(median(pixels.map((pixel) => pixel[2]))),
  ];
}

function distance(first: Rgb, second: Rgb): number {
  return Math.sqrt(
    (first[0] - second[0]) ** 2 +
    (first[1] - second[1]) ** 2 +
    (first[2] - second[2]) ** 2,
  );
}

function distanceFromSegment(point: Rgb, start: Rgb, end: Rgb): number {
  const vector = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = vector.reduce((sum, channel) => sum + channel * channel, 0);
  if (lengthSquared === 0) return distance(point, start);
  const projection = (
    (point[0] - start[0]) * vector[0] +
    (point[1] - start[1]) * vector[1] +
    (point[2] - start[2]) * vector[2]
  ) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  const nearest: Rgb = [
    start[0] + vector[0] * t,
    start[1] + vector[1] * t,
    start[2] + vector[2] * t,
  ];
  return distance(point, nearest);
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function manual(note: string, backgroundType: ImageTextPixelMeasurement["backgroundType"] = "UNKNOWN", backgroundHex = ""): ImageTextPixelMeasurement {
  return {
    status: "MANUAL_REVIEW",
    foregroundHex: "",
    backgroundHex,
    backgroundType,
    note,
  };
}

function readPixel(image: RawRgbaImage, x: number, y: number): { rgb: Rgb; alpha: number } {
  const offset = (y * image.width + x) * image.channels;
  return {
    rgb: [
      image.data[offset] ?? 0,
      image.data[offset + 1] ?? 0,
      image.data[offset + 2] ?? 0,
    ],
    alpha: image.data[offset + 3] ?? 255,
  };
}

/**
 * Samples a model-located text rectangle from decoded image pixels.
 *
 * The bounds must include a narrow margin around the glyphs. The perimeter is
 * used to identify a uniform local backing surface; the inner area is used to
 * identify solid glyph-core pixels. Ambiguous or mixed regions fail closed.
 */
export function sampleImageTextRegionPixels(
  image: RawRgbaImage,
  bounds: NormalizedImageTextBounds | null,
  confidence: ImageTextConfidence,
): ImageTextPixelMeasurement {
  if (!bounds) return manual("The vision model did not provide a usable text-region bounding box.");
  if (confidence !== "HIGH") {
    return manual("The text-region location is not high confidence; pixel sampling was not used to make a contrast decision.");
  }
  if (
    !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
    image.width < 8 || image.height < 8 || image.channels < 4 ||
    image.data.length < image.width * image.height * image.channels
  ) {
    return manual("The uploaded image could not be decoded into a supported RGBA pixel buffer.");
  }

  const { left, top, right, bottom } = bounds;
  if (
    ![left, top, right, bottom].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000) ||
    right <= left || bottom <= top
  ) {
    return manual("The detected text-region bounds are invalid.");
  }

  const x0 = Math.max(0, Math.floor((left / 1000) * image.width));
  const y0 = Math.max(0, Math.floor((top / 1000) * image.height));
  const x1 = Math.min(image.width, Math.ceil((right / 1000) * image.width));
  const y1 = Math.min(image.height, Math.ceil((bottom / 1000) * image.height));
  const regionWidth = x1 - x0;
  const regionHeight = y1 - y0;
  if (regionWidth < 12 || regionHeight < 12) {
    return manual("The detected text region is too small for reliable local pixel sampling.");
  }

  // Sample the background from a separate halo outside the AI-located
  // text box. Its own perimeter can contain antialiased glyph pixels when
  // Gemini returns a tight rectangle.
  const borderX = Math.max(2, Math.floor(regionWidth * 0.05));
  const borderY = Math.max(2, Math.floor(regionHeight * 0.05));
  const haloX = Math.max(4, Math.ceil(regionWidth * 0.05));
  const haloY = Math.max(4, Math.ceil(regionHeight * 0.15));
  const haloX0 = Math.max(0, x0 - haloX);
  const haloY0 = Math.max(0, y0 - haloY);
  const haloX1 = Math.min(image.width, x1 + haloX);
  const haloY1 = Math.min(image.height, y1 + haloY);

  const sampleStep = Math.max(1, Math.floor(Math.sqrt((regionWidth * regionHeight) / 50000)));
  const backgroundPixels: Rgb[] = [];
  let transparentBackgroundPixels = 0;

  for (let y = haloY0; y < haloY1; y += sampleStep) {
    for (let x = haloX0; x < haloX1; x += sampleStep) {
      const insideTextBounds = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (insideTextBounds) continue;

      const pixel = readPixel(image, x, y);
      if (pixel.alpha < 250) transparentBackgroundPixels += 1;
      backgroundPixels.push(pixel.rgb);
    }
  }

  if (backgroundPixels.length < 20) {
    return manual("There are too few surrounding pixels to establish the local text background.");
  }
  if (transparentBackgroundPixels > 0) {
    return manual("The local backing surface contains transparency, so its displayed colour depends on the final compositing background.", "TRANSPARENT");
  }

  const samplingContext = [
    `Image=${image.width}x${image.height}px`,
    `Gemini bounds(0-1000)=L${left},T${top},R${right},B${bottom}`,
    `pixel bounds=[${x0},${y0},${x1},${y1})`,
    `region=${regionWidth}x${regionHeight}px`,
    `internal exclusion border=${borderX}x${borderY}px`,
    `external halo=${haloX}x${haloY}px`,
    `halo bounds=[${haloX0},${haloY0},${haloX1},${haloY1})`,
    `sample step=${sampleStep}px`,
  ].join("; ");

  const background = medianRgb(backgroundPixels);
  const backgroundNearMedianCount = backgroundPixels.filter((pixel) => distance(pixel, background) <= 18).length;
  const backgroundOutsideToleranceCount = backgroundPixels.length - backgroundNearMedianCount;
  const uniformBackgroundRatio = backgroundNearMedianCount / backgroundPixels.length;
  if (uniformBackgroundRatio < 0.94) {
    return manual(
      `The external background halo is not sufficiently uniform (${Math.round(uniformBackgroundRatio * 100)}% of sampled pixels are within 18 RGB levels of the median; at least 94% is required). ${samplingContext}; halo samples=${backgroundPixels.length}; within tolerance=${backgroundNearMedianCount}; outside tolerance=${backgroundOutsideToleranceCount}; median background=${toHex(background)}. The adjacent backing may vary or nearby artwork may enter the sampling halo. Use a solid backing surface or inspect the source design manually.`,
      "VARIABLE",
      toHex(background),
    );
  }

  const innerPixels: Rgb[] = [];
  for (let y = y0 + borderY; y < y1 - borderY; y += sampleStep) {
    for (let x = x0 + borderX; x < x1 - borderX; x += sampleStep) {
      const pixel = readPixel(image, x, y);
      if (pixel.alpha < 250) {
        return manual("The text or its local backing surface contains transparency.", "TRANSPARENT", toHex(background));
      }
      innerPixels.push(pixel.rgb);
    }
  }
  if (innerPixels.length < 12) {
    return manual("The text region has too few interior pixels for reliable sampling.", "SOLID", toHex(background));
  }

  // Check the non-ink pixels within the interior as well as the outer border.
  // This prevents a uniform perimeter from masking a photograph/gradient that
  // continues behind the text itself.
  const backgroundLikePixels = innerPixels.filter((pixel) => distance(pixel, background) <= 28);
  if (backgroundLikePixels.length < 20) {
    return manual("The backing surface cannot be separated reliably from the detected glyph pixels.", "VARIABLE", toHex(background));
  }
  const innerBackgroundNearMedianCount = backgroundLikePixels
    .filter((pixel) => distance(pixel, background) <= 18).length;
  const innerBackgroundOutsideToleranceCount = backgroundLikePixels.length - innerBackgroundNearMedianCount;
  const innerBackgroundUniformity = innerBackgroundNearMedianCount / backgroundLikePixels.length;
  if (innerBackgroundUniformity < 0.94) {
    return manual(
      `Pixels inside the text region do not share the same local backing colour as the external halo (${Math.round(innerBackgroundUniformity * 100)}% within tolerance). ${samplingContext}; inner pixels=${innerPixels.length}; background-like inner pixels=${backgroundLikePixels.length}; within tolerance=${innerBackgroundNearMedianCount}; outside tolerance=${innerBackgroundOutsideToleranceCount}; median background=${toHex(background)}. The background may vary behind the glyphs.`,
      "VARIABLE",
      toHex(background),
    );
  }

  // Ignore antialiased edge pixels and retain the strongest colour separation
  // from the sampled background to estimate the solid glyph-core colour.
  const candidates = innerPixels
    .map((rgb) => ({ rgb, separation: distance(rgb, background) }))
    .filter((pixel) => pixel.separation >= 28)
    .sort((first, second) => second.separation - first.separation);

  if (candidates.length < 6 || candidates.length > innerPixels.length * 0.5) {
    return manual(
      "A distinct, compact text-colour cluster could not be isolated from the local background. The system will not infer a contrast ratio.",
      "SOLID",
      toHex(background),
    );
  }

  const coreCount = Math.max(6, Math.ceil(candidates.length * 0.2));
  const corePixels = candidates.slice(0, coreCount).map((pixel) => pixel.rgb);
  const foreground = medianRgb(corePixels);
  // Antialiased glyph-edge pixels should lie approximately on the RGB segment
  // between the backing surface and the solid glyph colour. Pixels off that
  // segment indicate multicolour text or other artwork mixed into the region.
  const singleForegroundAxisRatio = candidates
    .filter((pixel) => distanceFromSegment(pixel.rgb, background, foreground) <= 22)
    .length / candidates.length;
  if (singleForegroundAxisRatio < 0.94) {
    return manual(
      "More than one foreground colour or an unrelated graphic was detected in this text region. A single contrast ratio would be misleading.",
      "SOLID",
      toHex(background),
    );
  }

  const uniformForegroundRatio = corePixels.filter((pixel) => distance(pixel, foreground) <= 28).length / corePixels.length;
  if (uniformForegroundRatio < 0.9) {
    return manual(
      "The detected glyph pixels contain multiple or varying foreground colours, so a single text colour cannot be measured reliably.",
      "SOLID",
      toHex(background),
    );
  }

  const ratio = contrastRatio(toHex(foreground), toHex(background));
  if (ratio === null) {
    return manual("The sampled foreground and background colours could not be converted into a contrast ratio.", "SOLID", toHex(background));
  }

  return {
    status: "MEASURED",
    foregroundHex: toHex(foreground),
    backgroundHex: toHex(background),
    backgroundType: "SOLID",
    note: `Foreground and background were sampled from the uploaded image pixels (external halo uniformity ${(uniformBackgroundRatio * 100).toFixed(0)}%, interior backing uniformity ${(innerBackgroundUniformity * 100).toFixed(0)}%). ${samplingContext}; halo samples=${backgroundPixels.length}; halo within tolerance=${backgroundNearMedianCount}; median background=${toHex(background)}. The text-region bounds were AI-located; review the image if the halo includes nearby artwork or a different backing surface.`,
  };
}

export function sampleAllImageTextRegions(
  image: RawRgbaImage,
  regions: Array<{ bounds: NormalizedImageTextBounds | null; confidence: ImageTextConfidence }>,
): ImageTextPixelMeasurement[] {
  return regions.slice(0, 20).map((region) =>
    sampleImageTextRegionPixels(image, region.bounds, region.confidence),
  );
}
