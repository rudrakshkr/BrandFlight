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
  asset?: { secureUrl: string; publicId: string }
  image: {
    name: string
    format: string
    width: number | null
    height: number | null
    dominantColors: string[]
    approvedColors: string[]
    altTextLength: number
  }
  totalFindings: number
  findings: ImageAuditFinding[]
}
