import type { ImageTextContrastAnalysis } from './types/imageAudit'

interface Props {
  analysis?: ImageTextContrastAnalysis | null
}

const ROLE_LABELS: Record<string, string> = {
  BODY_TEXT: 'Body text',
  HEADING: 'Heading',
  CTA_TEXT: 'Call to action',
  CAPTION: 'Caption',
  UI_ELEMENT: 'UI element',
  UNKNOWN: 'Unclassified text',
}

function getManualReviewMessage(backgroundType: string): string {
  switch (backgroundType) {
    case 'VARIABLE':
      return 'The background varies around or behind this text. Check contrast in the source design.'
    case 'TRANSPARENT':
      return 'Transparency affects the final background colour. Check the exported artwork.'
    case 'PHOTO':
      return 'Text overlaps a photograph. Check contrast across the entire text area.'
    case 'GRADIENT':
      return 'Text overlaps a gradient. Check the lowest-contrast area.'
    case 'TEXTURED':
      return 'The textured background prevents reliable colour measurement. Check manually.'
    default:
      return 'Text and background colours could not be isolated reliably. Check this region manually.'
  }
}

export default function ImageTextContrastReport({ analysis }: Props) {
  if (!analysis) return null

  const hasLegacyEstimates = analysis.regions.some(
    (region) =>
      region.measurement !== 'PIXEL_SAMPLE' &&
      region.measurement !== 'MANUAL_REVIEW',
  )

  const passed = analysis.regions.filter(
    (region) => region.evaluation === 'PIXEL_PASS',
  ).length

  const failed = analysis.regions.filter(
    (region) => region.evaluation === 'PIXEL_FAIL',
  ).length

  const manual = analysis.regions.filter(
    (region) => !hasLegacyEstimates &&
      region.evaluation === 'MANUAL_REVIEW',
  ).length

  const statusLabel = hasLegacyEstimates
    ? 'Re-run audit'
    : failed > 0
      ? 'Needs attention'
      : manual > 0 || analysis.status === 'NEEDS_REVIEW'
        ? 'Manual review'
        : {
            ANALYZED: 'All checks passed',
            NO_TEXT_DETECTED: 'No text detected',
            NEEDS_REVIEW: 'Needs attention',
            UNAVAILABLE: 'Screening unavailable',
          }[analysis.status]

  const summary = hasLegacyEstimates
    ? 'This result predates pixel sampling. Run the image audit again.'
    : analysis.regions.length > 0
      ? `${analysis.regions.length} text region(s) · ${passed} passed · ${failed} below target · ${manual} need review`
      : analysis.status === 'NO_TEXT_DETECTED'
        ? 'No visible text was located.'
        : 'Text contrast could not be screened. Retry the image audit.'

  return (
    <section
      className={`bf-image-text-contrast-report status-${analysis.status.toLowerCase()}`}
      aria-label="Image text contrast analysis"
    >
      <div className="bf-image-text-contrast-heading">
        <div>
          <span className="bf-contrast-eyebrow">ACCESSIBILITY · IMAGE PREFLIGHT</span>
          <h3>Text contrast screening</h3>
          <p>{summary}</p>
        </div>

        <span className={`bf-image-text-contrast-status ${analysis.status.toLowerCase()}`}>
          {statusLabel}
        </span>
      </div>

      <p className="bf-image-text-contrast-method">
        Contrast colours are sampled from the uploaded artwork, not estimated by AI.
      </p>

      {analysis.regions.length > 0 && (
        <div className="bf-image-text-contrast-regions">
          {analysis.regions.map((region, index) => {
            const legacy = !region.measurement

            const verdict = legacy
              ? 'Re-run audit'
              : region.evaluation === 'PIXEL_PASS'
                ? 'Pass'
                : region.evaluation === 'PIXEL_FAIL'
                  ? 'Below target'
                  : 'Manual review'

            return (
              <article
                className={`bf-image-text-contrast-region ${
                  region.measurement
                    ? region.evaluation.toLowerCase()
                    : 'manual_review'
                }`}
                key={`${region.location}-${index}`}
              >
                <div className="bf-image-text-contrast-region-top">
                  <div>
                    <strong>{ROLE_LABELS[region.role] ?? 'Text region'}</strong>
                    <small>
                      {region.location || 'Unspecified location'} · {region.confidence.toLowerCase()} confidence
                    </small>
                  </div>

                  <span
                    className={`bf-image-text-contrast-verdict ${
                      region.measurement
                        ? region.evaluation.toLowerCase()
                        : 'manual_review'
                    }`}
                  >
                    {verdict}
                  </span>
                </div>

                {region.text && (
                  <p className="bf-image-text-contrast-excerpt">
                    “{region.text}”
                  </p>
                )}

                <div className="bf-image-text-colour-pair">
                  <span>
                    <i
                      style={{
                        backgroundColor: region.foregroundHex || '#E5E7EB',
                      }}
                    />
                    <small>Text</small>
                    <code>{region.foregroundHex || 'Unclear'}</code>
                  </span>

                  <span>
                    <i
                      style={{
                        backgroundColor: region.backgroundHex || '#E5E7EB',
                      }}
                    />
                    <small>Background</small>
                    <code>
                      {region.backgroundHex ||
                        region.backgroundType.toLowerCase()}
                    </code>
                  </span>

                  <strong>
                    {region.contrastRatio === null
                      ? '—'
                      : `${legacy ? 'AI est. ' : ''}${region.contrastRatio.toFixed(2)}:1`}
                  </strong>

                  <small>Target {region.targetRatio.toFixed(1)}:1</small>
                </div>

                {region.referencePair && (
                  <div className="bf-image-text-reference-pair">
                    <span>Brand-approved reference for this role</span>
                    <span>
                      <i style={{ backgroundColor: region.referencePair.foregroundHex }} aria-hidden="true" />
                      Text <code>{region.referencePair.foregroundHex}</code>
                    </span>
                    <span>
                      <i style={{ backgroundColor: region.referencePair.backgroundHex }} aria-hidden="true" />
                      Background <code>{region.referencePair.backgroundHex}</code>
                    </span>
                    <small>Reference only · not the measured colours in this image</small>
                  </div>
                )}

                {region.recommendedForeground && (
                  <p className="bf-image-text-contrast-recommendation">
                    Suggested text colour:{' '}
                    <code>{region.recommendedForeground}</code>
                  </p>
                )}

                {!legacy && region.evaluation === 'MANUAL_REVIEW' && (
                  <p className="bf-image-text-contrast-note">
                    {getManualReviewMessage(region.backgroundType)}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
