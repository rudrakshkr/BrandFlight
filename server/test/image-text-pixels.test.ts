import assert from "node:assert/strict";
import test from "node:test";
import {
  sampleImageTextRegionPixels,
  type RawRgbaImage,
} from "../src/lib/image-text-pixels.js";

const bounds = { left: 100, top: 100, right: 900, bottom: 900 };

function makeImage(
  foreground: [number, number, number] = [138, 138, 138],
  background: (x: number, y: number) => [number, number, number] = () => [255, 255, 255],
): RawRgbaImage {
  const width = 200;
  const height = 80;
  const channels = 4;
  const data = new Uint8Array(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bg = background(x, y);
      const offset = (y * width + x) * channels;
      data[offset] = bg[0];
      data[offset + 1] = bg[1];
      data[offset + 2] = bg[2];
      data[offset + 3] = 255;
    }
  }

  // Several thin strokes imitate glyph cores, leaving ample clean background
  // around the text rectangle for the local backing-surface sample.
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

test("pixel sampler measures the actual glyph and solid background colours", () => {
  const result = sampleImageTextRegionPixels(makeImage(), bounds, "HIGH");
  assert.equal(result.status, "MEASURED");
  assert.equal(result.foregroundHex, "#8A8A8A");
  assert.equal(result.backgroundHex, "#FFFFFF");
  assert.equal(result.backgroundType, "SOLID");
});

test("variable backgrounds fail closed and never produce a contrast measurement", () => {
  const gradient = makeImage([138, 138, 138], (x) => {
    const value = Math.round(220 + (x / 199) * 35);
    return [value, value, value];
  });
  const result = sampleImageTextRegionPixels(gradient, bounds, "HIGH");
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(result.backgroundType, "VARIABLE");
});

test("transparent backing pixels require manual review", () => {
  const image = makeImage();
  image.data[(8 * image.width + 20) * image.channels + 3] = 0;
  const result = sampleImageTextRegionPixels(image, bounds, "HIGH");
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(result.backgroundType, "TRANSPARENT");
});

test("missing bounds or uncertain text location require manual review", () => {
  const image = makeImage();
  assert.equal(sampleImageTextRegionPixels(image, null, "HIGH").status, "MANUAL_REVIEW");
  assert.equal(sampleImageTextRegionPixels(image, bounds, "MEDIUM").status, "MANUAL_REVIEW");
});

test("foreground with multiple colours is not collapsed into a single contrast ratio", () => {
  const image = makeImage([20, 60, 120]);
  const second = [220, 40, 40];
  // Recolour the right half of the glyph strokes to create multicolour text.
  for (let y = 28; y < 48; y += 1) {
    for (let x = 116; x < 128; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      image.data[offset] = second[0]!;
      image.data[offset + 1] = second[1]!;
      image.data[offset + 2] = second[2]!;
    }
  }
  const result = sampleImageTextRegionPixels(image, bounds, "HIGH");
  assert.equal(result.status, "MANUAL_REVIEW");
});

test("very subtle foreground/background differences route to manual review, not an assumed pass", () => {
  const image = makeImage([245, 245, 245]);
  const result = sampleImageTextRegionPixels(image, bounds, "HIGH");
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(result.backgroundType, "SOLID");
});


test("a uniform outer border cannot hide a variable background behind the glyphs", () => {
  const image = makeImage([138, 138, 138], (x, y) => {
    // Keep the sampled perimeter flat, but vary the backing surface in the
    // inner text area where the foreground glyphs are located.
    if (x >= 45 && x < 155 && y >= 18 && y < 62) {
      const value = 230 + ((x * 7 + y * 11) % 26);
      return [value, value, value];
    }
    return [255, 255, 255];
  });
  // Restore glyph cores after painting the variable backing surface.
  const strokes: Array<[number, number, number, number]> = [
    [52, 28, 4, 20], [52, 28, 12, 4], [52, 36, 10, 4], [52, 44, 12, 4],
    [72, 28, 4, 20], [72, 28, 12, 4], [80, 36, 4, 8], [72, 44, 12, 4],
    [94, 28, 4, 20], [94, 28, 12, 4], [102, 36, 4, 8], [94, 44, 12, 4],
    [116, 28, 4, 20], [124, 28, 4, 20], [116, 28, 12, 4], [116, 44, 12, 4],
  ];
  for (const [sx, sy, sw, sh] of strokes) {
    for (let y = sy; y < sy + sh; y += 1) {
      for (let x = sx; x < sx + sw; x += 1) {
        const offset = (y * image.width + x) * image.channels;
        image.data[offset] = 138;
        image.data[offset + 1] = 138;
        image.data[offset + 2] = 138;
      }
    }
  }
  const result = sampleImageTextRegionPixels(image, bounds, "HIGH");
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(result.backgroundType, "VARIABLE");
});
