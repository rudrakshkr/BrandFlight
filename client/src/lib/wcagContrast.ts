export type ContrastThreshold = 3 | 4.5 | 7

export interface ContrastRecommendation {
  color: string
  ratio: number
  adjustment: 'darker' | 'lighter'
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

function mixHex(from: string, to: string, amount: number): string {
  const source = parseHex(from)
  const target = parseHex(to)
  if (!source || !target) return from

  const channels = source.map((channel, index) =>
    Math.round(channel + ((target[index] ?? channel) - channel) * amount),
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function findSmallestAdjustment(
  foreground: string,
  background: string,
  endpoint: '#000000' | '#FFFFFF',
  minimumRatio: number,
): ContrastRecommendation | null {
  const endpointRatio = contrastRatio(endpoint, background)
  if (endpointRatio === null || endpointRatio < minimumRatio) return null

  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (low + high) / 2
    const candidate = mixHex(foreground, endpoint, middle)
    const ratio = contrastRatio(candidate, background) ?? 0

    if (ratio >= minimumRatio) high = middle
    else low = middle
  }

  const color = mixHex(foreground, endpoint, high)
  const ratio = contrastRatio(color, background) ?? endpointRatio
  return {
    color,
    ratio,
    adjustment: endpoint === '#000000' ? 'darker' : 'lighter',
  }
}

/**
 * Finds the smallest RGB interpolation from the current foreground toward
 * black or white that reaches the requested WCAG contrast ratio.
 * The background is held constant; the saved brand palette is never mutated.
 */
export function recommendAccessibleForeground(
  foreground: string,
  background: string,
  minimumRatio: ContrastThreshold = 4.5,
): ContrastRecommendation | null {
  const normalizedForeground = normalizeHex(foreground)
  if (!isHexColor(normalizedForeground) || !isHexColor(background)) return null

  const currentRatio = contrastRatio(normalizedForeground, background)
  if (currentRatio === null) return null
  if (currentRatio >= minimumRatio) {
    return {
      color: normalizedForeground,
      ratio: currentRatio,
      adjustment: 'darker',
    }
  }

  const candidates = [
    findSmallestAdjustment(normalizedForeground, background, '#000000', minimumRatio),
    findSmallestAdjustment(normalizedForeground, background, '#FFFFFF', minimumRatio),
  ].filter((candidate): candidate is ContrastRecommendation => candidate !== null)

  if (candidates.length === 0) return null

  const original = parseHex(normalizedForeground)!
  return candidates.sort((first, second) => {
    const firstRgb = parseHex(first.color)!
    const secondRgb = parseHex(second.color)!
    const firstDistance = firstRgb.reduce((sum, channel, index) => sum + (channel - (original[index] ?? channel)) ** 2, 0)
    const secondDistance = secondRgb.reduce((sum, channel, index) => sum + (channel - (original[index] ?? channel)) ** 2, 0)
    return firstDistance - secondDistance
  })[0] ?? null
}
