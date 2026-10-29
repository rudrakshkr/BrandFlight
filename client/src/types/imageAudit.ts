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
