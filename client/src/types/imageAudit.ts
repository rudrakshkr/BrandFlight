export interface ImageAuditFinding {
  category: 'VISUAL' | 'ACCESSIBILITY'
  severity: 'WARNING' | 'ERROR'
  title: string
  message: string
  evidence: string
  suggestion: string
  ruleCode: string
  confidence: string
}

export interface ImageAuditData {
  auditReceiptId?: string
  asset?: { secureUrl: string; publicId: string }
  image: {
    name: string
    format: string
    width: number | null
    height: number | null
    dominantColors: string[]
    approvedColors: string[]
    colorAnalysis?: Array<{
      color: string
      nearestApprovedColor: string | null
      distance: number | null
      matchesPalette: boolean
    }>
    textContrastAnalysis?: ImageTextContrastAnalysis
    altTextLength: number
  }
  totalFindings: number
  findings: ImageAuditFinding[]
  logoVerification?: LogoVerification | null
}


export type LogoVerificationOutcome = 'MATCH' | 'MISMATCH' | 'NOT_DETECTED' | 'NEEDS_REVIEW' | 'NOT_CONFIGURED'

export interface LogoVerification {
  outcome: LogoVerificationOutcome
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  logoDetected: boolean
  wordmarkStatus: 'MATCH' | 'MISMATCH' | 'UNCLEAR' | 'NOT_VISIBLE' | 'NOT_CONFIGURED'
  colorStatus: 'MATCH' | 'MISMATCH' | 'UNCLEAR' | 'NOT_CONFIGURED'
  integrityStatus: 'MATCH' | 'MISMATCH' | 'UNCLEAR' | 'NOT_CONFIGURED'
  summary: string
  evidence: string[]
  suggestions: string[]
  required: boolean
  referenceLogo: {
    id: string
    name: string
    secureUrl: string
    expectedWordmark: string | null
    isRequired: boolean
  } | null
}

export interface ImageTextContrastRegion {
  text: string
  role: 'BODY_TEXT' | 'HEADING' | 'CTA_TEXT' | 'CAPTION' | 'UI_ELEMENT' | 'UNKNOWN'
  foregroundHex: string
  backgroundHex: string
  backgroundType: 'SOLID' | 'VARIABLE' | 'TRANSPARENT' | 'UNKNOWN' | 'PHOTO' | 'GRADIENT' | 'TEXTURED'
  textSize: 'NORMAL' | 'LARGE' | 'UNKNOWN'
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  location: string
  note: string
  bounds?: { left: number; top: number; right: number; bottom: number } | null
  contrastRatio: number | null
  targetRatio: number
  evaluation: 'PIXEL_PASS' | 'PIXEL_FAIL' | 'MANUAL_REVIEW' | 'ESTIMATED_PASS' | 'ESTIMATED_FAIL'
  recommendedForeground: string | null
  referencePair?: { foregroundHex: string; backgroundHex: string } | null
  measurement?: 'PIXEL_SAMPLE' | 'MANUAL_REVIEW'
  measurementNote?: string
}

export interface ImageTextContrastAnalysis {
  status: 'ANALYZED' | 'NO_TEXT_DETECTED' | 'NEEDS_REVIEW' | 'UNAVAILABLE'
  standardsConfigured: boolean
  summary: string
  regions: ImageTextContrastRegion[]
}
