export type ContrastThreshold = 3 | 4.5 | 7

export interface PaletteSwatchRecommendation {
  color: string
  ratio: number
}

function parseHex(hex: string): [number, number, number] | null {
  const normalized = hex.trim()
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return null

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

export function isHexColor(value: string): boolean {
  return parseHex(value) !== null
}

export function normalizeHex(value: string): string {
  return value.trim().toUpperCase()
}

function linearize(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const [red, green, blue] = rgb.map(linearize)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(foreground: string, background: string): number | null {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  if (foregroundLuminance === null || backgroundLuminance === null) return null

  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function toOklab(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex)
  if (!rgb) return null

  const [red, green, blue] = rgb.map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })

  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue

  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)

  return [
    0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot,
  ]
}

function oklabDistance(first: [number, number, number], second: [number, number, number]): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  )
}

/**
 * Selects the closest colour from the supplied approved palette that meets
 * the requested contrast ratio against the chosen background. Distance is
 * measured in OKLab, a perceptual colour space, rather than raw RGB values.
 * The input palette is never changed and no unapproved colour is generated.
 */
export function recommendClosestPaletteSwatch(
  foreground: string,
  background: string,
  palette: readonly string[],
  minimumRatio: ContrastThreshold = 4.5,
): PaletteSwatchRecommendation | null {
  const normalizedForeground = normalizeHex(foreground)
  const normalizedBackground = normalizeHex(background)
  if (!isHexColor(normalizedForeground) || !isHexColor(normalizedBackground)) return null

  const origin = toOklab(normalizedForeground)
  if (!origin) return null

  const candidates = [...new Set(palette.filter(isHexColor).map(normalizeHex))]
    .map((color) => {
      const ratio = contrastRatio(color, normalizedBackground)
      const lab = toOklab(color)
      return ratio !== null && lab
        ? { color, ratio, distance: oklabDistance(origin, lab) }
        : null
    })
    .filter((candidate): candidate is { color: string; ratio: number; distance: number } =>
      candidate !== null && candidate.ratio + 1e-9 >= minimumRatio,
    )
    .sort((first, second) => first.distance - second.distance)

  const closest = candidates[0]
  return closest ? { color: closest.color, ratio: closest.ratio } : null
}
