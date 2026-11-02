import type {
  ImageTextContrastAnalysis,
  ImageTextContrastRegion,
} from '../types/imageAudit'

type FindingCopyInput = {
  ruleCode: string | null
  message: string
  evidence?: string | null
  suggestion?: string | null
}

export interface ReadableImageFindingCopy {
  summary: string
  whatFound: string
  whatToDo: string
}

function getRegionForFinding(
  finding: FindingCopyInput,
  analysis?: ImageTextContrastAnalysis | null,
): ImageTextContrastRegion | undefined {
  const regions = analysis?.regions ?? []
  if (regions.length === 0) return undefined

  const evidence = finding.evidence ?? ''
  const visibleText = evidence.match(/Visible text:\s*"([^"]+)"/i)?.[1]
  const location = evidence.match(/Region:\s*([^;]+)/i)?.[1]?.trim()

  if (visibleText) {
    const normalizedText = visibleText.trim().toLocaleLowerCase()
    const normalizedLocation = location?.toLocaleLowerCase()
    const match = regions.find((region) =>
      region.text.trim().toLocaleLowerCase() === normalizedText &&
      (!normalizedLocation || region.location.trim().toLocaleLowerCase() === normalizedLocation),
    )
    if (match) return match
    return undefined
  }

  if (location) {
    const normalizedLocation = location.toLocaleLowerCase()
    return regions.find((region) => region.location.trim().toLocaleLowerCase() === normalizedLocation)
  }

  // Without evidence that identifies a specific region, only use a region
  // when the analysis contains exactly one. Never attribute another region's
  // measured result to this finding.
  return regions.length === 1 ? regions[0] : undefined
}

function locationLabel(region: ImageTextContrastRegion): string {
  return region.location ? ` in the ${region.location} area` : ''
}

function quoteText(region: ImageTextContrastRegion): string {
  return region.text.trim() ? `“${region.text.trim()}”` : 'This text'
}

function manualReviewCopy(region: ImageTextContrastRegion): ReadableImageFindingCopy {
  const text = quoteText(region)
  const location = locationLabel(region)
  const ratio = region.contrastRatio
  const target = region.targetRatio.toFixed(1)

  if (region.measurement === 'PIXEL_SAMPLE' && ratio !== null) {
    return {
      summary: 'Text contrast needs a manual check',
      whatFound: `${text}${location} measured ${ratio.toFixed(2)}:1, close to the ${target}:1 target. The result is borderline, so it has not been automatically passed.`,
      whatToDo: 'Increase the difference between the text and its background slightly, or have a reviewer check the final exported image before approval.',
    }
  }

  const explanations: Record<string, { found: string; action: string }> = {
    VARIABLE: {
      found: `The background behind ${text}${location} changes across the text, so one reliable contrast measurement is not possible.`,
      action: 'Place the text on a solid, consistent background, or check the lowest-contrast part of the design manually.',
    },
    TRANSPARENT: {
      found: `The background behind ${text}${location} includes transparency, so its final colour depends on where the artwork is placed.`,
      action: 'Check the text against the final background after export. Add a solid backing or adjust the text colour if needed.',
    },
    PHOTO: {
      found: `${text}${location} sits over a photograph, where the background colour changes across the text.`,
      action: 'Check the entire text area. A subtle overlay or solid text backing can make the contrast more consistent.',
    },
    GRADIENT: {
      found: `${text}${location} sits over a gradient, so contrast can vary from one part of the text to another.`,
      action: 'Check the least-contrasting part of the gradient and adjust the text colour or background there.',
    },
    TEXTURED: {
      found: `The textured background behind ${text}${location} makes a reliable contrast measurement difficult.`,
      action: 'Use a simpler backing area or inspect the text against the final exported image manually.',
    },
    SOLID: {
      found: `BrandFlight could not confidently separate the text and background colours${location}.`,
      action: 'Inspect the text and its immediate background in the source design, then run the image audit again.',
    },
    UNKNOWN: {
      found: `BrandFlight could not confidently identify the background behind ${text}${location}.`,
      action: 'Check the actual text and background in the source design. Use a solid backing if the colours are difficult to distinguish.',
    },
  }

  const explanation = explanations[region.backgroundType] ?? explanations.UNKNOWN!
  return {
    summary: 'Text contrast needs a manual check',
    whatFound: explanation.found,
    whatToDo: explanation.action,
  }
}

export function getReadableImageFindingCopy(
  finding: FindingCopyInput,
  analysis?: ImageTextContrastAnalysis | null,
): ReadableImageFindingCopy {
  if (finding.ruleCode !== 'ACCESSIBILITY-02') {
    return {
      summary: finding.message,
      whatFound: finding.evidence ?? 'No additional evidence was supplied.',
      whatToDo: finding.suggestion ?? 'Review this finding and inspect the campaign before approval.',
    }
  }

  const region = getRegionForFinding(finding, analysis)
  if (!region) {
    return {
      summary: 'Text contrast could not be checked automatically',
      whatFound: analysis?.status === 'UNAVAILABLE'
        ? 'The image contrast check did not complete, so BrandFlight could not confirm whether the text is readable.'
        : 'BrandFlight could not match this finding to a measured text area.',
      whatToDo: 'Inspect the text against its actual background in the exported design, or run the image audit again.',
    }
  }

  if (region.evaluation === 'PIXEL_FAIL' && region.contrastRatio !== null) {
    const recommendation = region.recommendedForeground
      ? ` Try ${region.recommendedForeground} as the text colour.`
      : ' Change the text colour or place it on a more contrasting background.'

    return {
      summary: `Text contrast is below the ${region.targetRatio.toFixed(1)}:1 target`,
      whatFound: `${quoteText(region)}${locationLabel(region)} measured ${region.contrastRatio.toFixed(2)}:1, below the required ${region.targetRatio.toFixed(1)}:1 for this text size.`,
      whatToDo: `${recommendation} Run Image Audit again after making the change.`,
    }
  }

  return manualReviewCopy(region)
}
