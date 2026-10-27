import { useState, useEffect, useCallback, useMemo, type FormEvent, type ReactNode } from 'react'
import './App.css'
import RulebookPanel, { type BrandProfileData } from './RulebookPanel'

type RuleCategory = 'TONE' | 'TERMINOLOGY' | 'CLAIM' | 'VISUAL' | 'ACCESSIBILITY'
type FindingSeverity = 'INFO' | 'WARNING' | 'ERROR'
type ActiveView = 'workspace' | 'rulebook'
type CategoryFilter = 'ALL' | 'OPEN' | 'CLAIM' | 'TERMINOLOGY' | 'TONE'

interface RawAuditFinding {
  category: RuleCategory
  severity: FindingSeverity
  title: string
  message: string
  evidence: string
  suggestion: string
  ruleCode: string
  confidence: string
}

interface ConsolidatedFinding {
  id: string
  category: RuleCategory
  severity: FindingSeverity
  title: string
  message: string
  suggestion: string
  ruleCodes: string[]
  evidences: string[]
  confidences: string[]
  mergedCount: number
}

interface AuditApiResponse {
  brand: {
    id: string
    name: string
  }
  totalFindings: number
  findings: RawAuditFinding[]
  semanticStatus: 'completed' | 'unavailable'
}

interface SampleDraft {
  id: string
  label: string
  title: string
  channel: string
  content: string
}

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  'http://localhost:3000'

const BRAND_PROFILE_ID = 'brandflight-demo'

const SEEDED_BRAND_PROFILE = {
  id: 'brandflight-demo',
  name: 'Northstar Workspace',
  description: 'B2B SaaS workspace brand profile configured in PostgreSQL.',
  brandColors: ['#0F172A', '#2563EB', '#FFFFFF'],
  rules: [
    {
      ruleCode: 'TONE-01',
      category: 'TONE' as const,
      engine: 'Gemini Semantic Evaluation',
      title: 'Clear and confident tone',
      description: 'Use clear, professional language. Avoid exaggerated promises.',
      pattern: null,
    },
    {
      ruleCode: 'TERM-01',
      category: 'TERMINOLOGY' as const,
      engine: 'Deterministic Regex Match',
      title: 'Avoid banned promotional terms',
      description: 'Flag unsupported guarantees and superlatives.',
      pattern: '\\b(revolutionary|guarantee(?:s|d|ing)?|number one)\\b',
    },
    {
      ruleCode: 'CLAIM-01',
      category: 'CLAIM' as const,
      engine: 'Deterministic Fact Comparison + Gemini Semantic Evaluation',
      title: 'Substantiate promotional claims',
      description:
        'Numerical performance claims and guarantees must be supported by approved facts.',
      pattern: null,
    },
  ],
  facts: [
    {
      factCode: 'FACT-01',
      claim: 'Standard onboarding takes approximately 10 minutes.',
      sourceLabel: 'Approved product facts',
    },
    {
      factCode: 'FACT-02',
      claim: 'Plans start at ₹499 per month.',
      sourceLabel: 'Approved product facts',
    },
    {
      factCode: 'FACT-03',
      claim: 'The free trial lasts 7 days.',
      sourceLabel: 'Approved product facts',
    },
  ],
}

const SAMPLE_DRAFTS: SampleDraft[] = [
  {
    id: 'sample-1',
    label: 'Launch announcement (has violations)',
    title: 'Q4 Northstar 3.0 Product Launch Copy',
    channel: 'Landing page hero',
    content:
      'Northstar Workspace is the number one, revolutionary platform for modern teams. We guarantee a 95% productivity boost in your first week! Standard setup takes 2 minutes, plans start at ₹199 per month, and our free trial lasts 30 days.',
  },
  {
    id: 'sample-2',
    label: 'Sponsored social ad (partial drift)',
    title: 'LinkedIn Campaign — Onboarding & Trial',
    channel: 'Sponsored post',
    content:
      'Switch to Northstar Workspace today. Standard onboarding takes approximately 10 minutes and plans start at ₹499 per month. Start your 14 days free trial with guaranteed results for every department.',
  },
  {
    id: 'sample-3',
    label: 'Compliant product overview',
    title: 'Northstar Workspace — Enterprise Overview',
    channel: 'Website overview',
    content:
      'Northstar Workspace helps engineering and operations teams coordinate projects in one structured workspace. Standard onboarding takes approximately 10 minutes, plans start at ₹499 per month, and the free trial lasts 7 days.',
  },
]

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
}

/**
 * Consolidates findings when their evidence overlaps, while keeping separate
 * claims distinct even when they occur in the same sentence.
 */
function consolidateFindings(
  rawFindings: RawAuditFinding[],
): ConsolidatedFinding[] {
  const groups: ConsolidatedFinding[] = []

  for (const item of rawFindings) {
    const trimmedEvidence = item.evidence.trim()
    const lowerEv = trimmedEvidence.toLowerCase()

    const existingGroup = groups.find((group) => {
      if (group.category !== item.category) return false

      // 1. Direct substring overlap (e.g., "95%" inside "We guarantee a 95% productivity boost...")
      const hasSubstringOverlap = group.evidences.some((ev) => {
        const gEv = ev.toLowerCase()
        return gEv.includes(lowerEv) || lowerEv.includes(gEv)
      })
      if (hasSubstringOverlap) return true

      return false
    })

    if (!existingGroup) {
      groups.push({
        id: `${item.category}-${item.ruleCode}-${trimmedEvidence}`,
        category: item.category,
        severity: item.severity,
        title: item.title,
        message: item.message,
        suggestion: item.suggestion,
        ruleCodes: [item.ruleCode],
        evidences: trimmedEvidence ? [trimmedEvidence] : [],
        confidences: [item.confidence],
        mergedCount: 1,
      })
    } else {
      existingGroup.mergedCount += 1

      if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[existingGroup.severity]) {
        existingGroup.severity = item.severity
      }

      // Prefer a more specific semantic explanation over a generic deterministic message
      const isExistingGeneric =
        existingGroup.title === 'Unverified numerical claim' ||
        existingGroup.message.startsWith('Content matched rule')
      const isIncomingSpecific =
        item.title !== 'Unverified numerical claim' &&
        !item.message.startsWith('Content matched rule')

      if (isExistingGeneric && isIncomingSpecific) {
        existingGroup.title = item.title
        existingGroup.message = item.message
        existingGroup.suggestion = item.suggestion
      }

      if (!existingGroup.ruleCodes.includes(item.ruleCode)) {
        existingGroup.ruleCodes.push(item.ruleCode)
      }

      if (
        trimmedEvidence &&
        !existingGroup.evidences.some((e) => e.toLowerCase() === lowerEv)
      ) {
        existingGroup.evidences.push(trimmedEvidence)
      }

      if (!existingGroup.confidences.includes(item.confidence)) {
        existingGroup.confidences.push(item.confidence)
      }
    }
  }

  return groups
}

function renderHighlightedText(text: string, evidences: string[]): ReactNode {
  const unique = Array.from(
    new Set(evidences.map((e) => e.trim()).filter((e) => e.length > 0)),
  ).sort((a, b) => b.length - a.length)

  if (unique.length === 0) return text

  const escaped = unique.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, idx) => {
    const matched = unique.some((u) => u.toLowerCase() === part.toLowerCase())
    if (matched) {
      return (
        <mark key={idx} className="bf-highlight-mark">
          {part}
        </mark>
      )
    }
    return <span key={idx}>{part}</span>
  })
}

/* BrandFlight's custom flight-path mark: content streams converge on a checked route. */
function BrandFlightMark(): ReactNode {
  return (
    <svg
      className="bf-logo-symbol"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 22.5h5.2c1.7 0 2.9-.6 4.1-1.8l5.7-5.7c1.1-1.1 2.2-1.7 3.9-1.7H27"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.5 7.5H27v6.5"
        stroke="#F8FAFC"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 15.5h4.1c1.4 0 2.5-.5 3.5-1.5l2.1-2.1"
        stroke="#F8FAFC"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.88"
      />
      <circle cx="5.2" cy="22.5" r="1.65" fill="currentColor" />
    </svg>
  )
}

export function App() {
  const [activeView, setActiveView] = useState<ActiveView>('workspace')
  const [brandProfile, setBrandProfile] = useState<BrandProfileData | null>(null)
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLE_DRAFTS[0].id)
  const [draftTitle, setDraftTitle] = useState<string>(SAMPLE_DRAFTS[0].title)
  const [draftChannel, setDraftChannel] = useState<string>(SAMPLE_DRAFTS[0].channel)
  const [content, setContent] = useState<string>(SAMPLE_DRAFTS[0].content)
  const [showInlineMap, setShowInlineMap] = useState<boolean>(true)
  const [showFactsDrawer, setShowFactsDrawer] = useState<boolean>(true)

  const [apiHealth, setApiHealth] = useState<'checking' | 'online' | 'offline'>('checking')
  const [isAuditing, setIsAuditing] = useState<boolean>(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditResult, setAuditResult] = useState<AuditApiResponse | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL')

  const [resolvedGroups, setResolvedGroups] = useState<Record<string, string>>({})
  const [reviewerNote, setReviewerNote] = useState<string>('')
  const [sessionDecision, setSessionDecision] = useState<{
    status: 'NONE' | 'APPROVED' | 'CHANGES_REQUESTED'
    note: string
    timestamp: string | null
  }>({
    status: 'NONE',
    note: '',
    timestamp: null,
  })

  useEffect(() => {
    let ignore = false
    async function checkApi() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/health`)
        if (!ignore) setApiHealth(res.ok ? 'online' : 'offline')
      } catch {
        if (!ignore) setApiHealth('offline')
      }
    }
    void checkApi()
    return () => {
      ignore = true
    }
  }, [])

  const runBackendAudit = useCallback(async (textToAudit: string) => {
    if (!textToAudit.trim()) {
      setAuditError('Enter draft copy before running a preflight audit.')
      return
    }

    setIsAuditing(true)
    setAuditError(null)
    setResolvedGroups({})
    setSessionDecision({ status: 'NONE', note: '', timestamp: null })

    try {
      const response = await fetch(`${API_BASE_URL}/api/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandProfileId: BRAND_PROFILE_ID,
          content: textToAudit,
        }),
      })

      const data: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          typeof data === 'object' &&
          data !== null &&
          'error' in data &&
          typeof (data as { error: unknown }).error === 'string'
            ? (data as { error: string }).error
            : `Server returned HTTP ${response.status}`
        throw new Error(message)
      }

      setAuditResult(data as AuditApiResponse)
      setApiHealth('online')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach backend API.'
      setAuditError(
        `${message} — Verify the server is running on ${API_BASE_URL} and seeded.`,
      )
      setApiHealth('offline')
    } finally {
      setIsAuditing(false)
    }
  }, [])

  useEffect(() => {
    void runBackendAudit(SAMPLE_DRAFTS[0].content)
  }, [runBackendAudit])

  const consolidatedFindings = useMemo(
    () => consolidateFindings(auditResult?.findings ?? []),
    [auditResult],
  )

  const openConsolidatedCount = useMemo(
    () => consolidatedFindings.filter((g) => !resolvedGroups[g.id]).length,
    [consolidatedFindings, resolvedGroups],
  )

  const activeEvidences = useMemo(
    () =>
      consolidatedFindings
        .filter((g) => !resolvedGroups[g.id])
        .flatMap((g) => g.evidences),
    [consolidatedFindings, resolvedGroups],
  )

  const filteredFindings = useMemo(() => {
    return consolidatedFindings.filter((group) => {
      if (categoryFilter === 'ALL') return true
      if (categoryFilter === 'OPEN') return !resolvedGroups[group.id]
      return group.category === categoryFilter
    })
  }, [consolidatedFindings, categoryFilter, resolvedGroups])

  const handleSelectScenario = (sample: SampleDraft) => {
    setSelectedSampleId(sample.id)
    setDraftTitle(sample.title)
    setDraftChannel(sample.channel)
    setContent(sample.content)
    setCategoryFilter('ALL')
    void runBackendAudit(sample.content)
  }

  const handleAuditSubmit = (e: FormEvent) => {
    e.preventDefault()
    void runBackendAudit(content)
  }

  const handleFocusEvidence = (evidence: string) => {
    const textarea = document.getElementById('bf-editor-input') as HTMLTextAreaElement | null
    if (!textarea || !evidence) return
    const index = content.toLowerCase().indexOf(evidence.toLowerCase())
    if (index >= 0) {
      textarea.focus()
      textarea.setSelectionRange(index, index + evidence.length)
    }
  }

  const handleTagEvidenceInEditor = (group: ConsolidatedFinding) => {
    const primaryEvidence = group.evidences[0]
    if (!primaryEvidence || !content.includes(primaryEvidence)) return
    setContent((prev) => prev.replace(primaryEvidence, `[REVISE: ${primaryEvidence}]`))
    setResolvedGroups((prev) => ({
      ...prev,
      [group.id]: 'Tagged in draft',
    }))
  }

  const handleToggleResolved = (groupId: string, label: string) => {
    setResolvedGroups((prev) => {
      const next = { ...prev }
      if (next[groupId]) {
        delete next[groupId]
      } else {
        next[groupId] = label
      }
      return next
    })
  }

  const handleDecision = (status: 'APPROVED' | 'CHANGES_REQUESTED') => {
    setSessionDecision({
      status,
      note:
        reviewerNote.trim() ||
        (status === 'APPROVED'
          ? 'Approved for publication after preflight review.'
          : 'Revisions requested to align claims and terminology with brand guidelines.'),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    })
  }

  return (
    <div className="bf-layout">
      {/* 1. Redesigned B2B SaaS Header */}
      <header className="bf-header">
        <div className="bf-header-container">
          <div className="bf-header-left">
            <div className="bf-brand-lockup" aria-label="BrandFlight Content Preflight">
              <span className="bf-logo-mark">
                <BrandFlightMark />
              </span>
              <span className="bf-brand-copy">
                <span className="bf-wordmark">BrandFlight</span>
                <span className="bf-product-Descriptor">Content Preflight</span>
              </span>
            </div>
          </div>

          <nav className="bf-header-nav" aria-label="Primary navigation">
            <button
              type="button"
              className={`bf-nav-link ${activeView === 'workspace' ? 'active' : ''}`}
              onClick={() => setActiveView('workspace')}
            >
              Audit Workspace
            </button>
            <button
              type="button"
              className={`bf-nav-link ${activeView === 'rulebook' ? 'active' : ''}`}
              onClick={() => setActiveView('rulebook')}
            >
              Brand Rulebook &amp; Facts
            </button>
          </nav>

          <div className="bf-header-right">
            <span className="bf-brand-context">
              Brand: <strong>{brandProfile?.name ?? auditResult?.brand.name ?? SEEDED_BRAND_PROFILE.name}</strong>
            </span>
            <span className="bf-header-divider" aria-hidden="true" />
            <span className="bf-api-indicator" title={`Endpoint: ${API_BASE_URL}/api/audit`}>
              <span className={`bf-status-dot ${apiHealth}`} />
              {apiHealth === 'online'
                ? 'API Connected'
                : apiHealth === 'offline'
                  ? 'API Offline'
                  : 'Checking API...'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="bf-main">
        {activeView === 'workspace' ? (
          <>
            {/* Page Heading & Preset Selector */}
            <section className="bf-page-bar">
              <div>
                <h1 className="bf-page-title">Pre-Publication Content Audit</h1>
                <p className="bf-page-subtitle">
                  Verify draft copy against approved product facts, terminology rules, and tone
                  guidelines before publishing.
                </p>
              </div>

              <div className="bf-scenario-picker">
                <span className="bf-scenario-label">Sample drafts:</span>
                {SAMPLE_DRAFTS.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className={`bf-scenario-btn ${
                      selectedSampleId === sample.id ? 'active' : ''
                    }`}
                    onClick={() => handleSelectScenario(sample)}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </section>

            {/* 5. Sticky Two-Column Audit Workspace */}
            <div className="bf-workspace">
              {/* LEFT STICKY PANE: Editor + Compact Reference */}
              <div className="bf-left-sticky">
                <form className="bf-card" onSubmit={handleAuditSubmit}>
                  <div className="bf-card-header">
                    <h2 className="bf-section-title">Draft Content</h2>
                    <span className="bf-section-meta">
                      {content.trim() ? content.trim().split(/\s+/).length : 0} words
                    </span>
                  </div>

                  <div className="bf-card-body">
                    <div className="bf-field-row">
                      <div className="bf-field">
                        <label className="bf-label" htmlFor="bf-title-input">
                          Campaign title
                        </label>
                        <input
                          id="bf-title-input"
                          type="text"
                          className="bf-input"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                        />
                      </div>

                      <div className="bf-field">
                        <label className="bf-label" htmlFor="bf-channel-input">
                          Channel
                        </label>
                        <input
                          id="bf-channel-input"
                          type="text"
                          className="bf-input"
                          value={draftChannel}
                          onChange={(e) => setDraftChannel(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="bf-field">
                      <div className="bf-field-top">
                        <label className="bf-label" htmlFor="bf-editor-input">
                          Copy to evaluate
                        </label>
                        <span className="bf-counter">{content.length} characters</span>
                      </div>
                      <textarea
                        id="bf-editor-input"
                        className="bf-textarea"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="Paste or write marketing content to check against brand guidelines..."
                      />
                    </div>

                    {activeEvidences.length > 0 && (
                      <div className="bf-field">
                        <div className="bf-field-top">
                          <span className="bf-label">
                            Highlighted spans ({activeEvidences.length} flagged)
                          </span>
                          <button
                            type="button"
                            className="bf-btn-text"
                            onClick={() => setShowInlineMap((prev) => !prev)}
                          >
                            {showInlineMap ? 'Hide preview' : 'Show preview'}
                          </button>
                        </div>
                        {showInlineMap && (
                          <div className="bf-evidence-preview">
                            {renderHighlightedText(content, activeEvidences)}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="bf-editor-actions">
                      <button
                        type="button"
                        className="bf-btn-secondary"
                        disabled={isAuditing}
                        onClick={() => {
                          const sample =
                            SAMPLE_DRAFTS.find((s) => s.id === selectedSampleId) ?? SAMPLE_DRAFTS[0]
                          setDraftTitle(sample.title)
                          setDraftChannel(sample.channel)
                          setContent(sample.content)
                        }}
                      >
                        Reset draft
                      </button>

                      <button
                        type="submit"
                        className="bf-btn-primary"
                        disabled={isAuditing || !content.trim()}
                      >
                        {isAuditing ? 'Running audit...' : 'Run Preflight Audit'}
                      </button>
                    </div>
                  </div>
                </form>

                {/* Compact Approved Facts Drawer */}
                <div className="bf-card">
                  <div className="bf-card-header">
                    <h2 className="bf-section-title">Approved Product Facts</h2>
                    <button
                      type="button"
                      className="bf-btn-text"
                      onClick={() => setShowFactsDrawer((prev) => !prev)}
                    >
                      {showFactsDrawer ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                  {showFactsDrawer && (
                    <div className="bf-card-body">
                      <div className="bf-compact-facts">
                        {(brandProfile?.facts ?? SEEDED_BRAND_PROFILE.facts).map((fact) => (
                          <div key={fact.factCode} className="bf-compact-fact-item">
                            <span className="bf-rule-tag">{fact.factCode}</span>
                            <span>{fact.claim}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANE: Consolidated Findings & Human Decision */}
              <div className="bf-right-Pane">
                <div className="bf-card">
                  <div className="bf-card-header">
                    <div>
                      <h2 className="bf-section-title">Audit Findings</h2>
                    </div>
                    {auditResult && (
                      <div className="bf-metrics-inline">
                        <span>
                          <strong>{openConsolidatedCount}</strong> open
                        </span>
                        <span>•</span>
                        <span>
                          <strong>{consolidatedFindings.length}</strong> consolidated{' '}
                          {consolidatedFindings.length === 1 ? 'issue' : 'issues'}
                          {auditResult.totalFindings > consolidatedFindings.length
                            ? ` (from ${auditResult.totalFindings} checks)`
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="bf-card-body">
                    {isAuditing && (
                      <div className="bf-status-banner info">
                        <div className="bf-banner-body">
                          <div className="bf-banner-heading">Running preflight audit...</div>
                          <div>
                            Checking terminology patterns, numerical claims against approved facts,
                            and Gemini semantic compliance.
                          </div>
                        </div>
                      </div>
                    )}

                    {!isAuditing && auditError && (
                      <div className="bf-status-banner error">
                        <div className="bf-banner-body">
                          <div className="bf-banner-heading">Audit request failed</div>
                          <div>{auditError}</div>
                        </div>
                      </div>
                    )}

                    {!isAuditing && !auditError && auditResult && (
                      <>
                        {auditResult.semanticStatus === 'completed' ? (
                          <div className="bf-status-banner success">
                            <div className="bf-banner-body">
                              <div className="bf-banner-heading">
                                <span>Deterministic and AI semantic checks completed</span>
                              </div>
                              <div>
                                Overlapping rule and fact checks have been consolidated by claim.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="bf-status-banner warn">
                            <div className="bf-banner-body">
                              <div className="bf-banner-heading">
                                <span>
                                  Deterministic audit completed — AI semantic check unavailable
                                </span>
                              </div>
                              <div>
                                Terminology rules and numerical fact checks ran on the server, but
                                Gemini semantic evaluation was unavailable. Verify{' '}
                                <code>GEMINI_API_KEY</code> and <code>GEMINI_MODEL</code> in{' '}
                                <code>server/.env</code>.
                              </div>
                            </div>
                          </div>
                        )}

                        {consolidatedFindings.length > 0 && (
                          <div className="bf-audit-toolbar">
                            <div className="bf-filter-group">
                              {(
                                [
                                  { id: 'ALL', label: `All (${consolidatedFindings.length})` },
                                  { id: 'OPEN', label: `Open (${openConsolidatedCount})` },
                                  {
                                    id: 'CLAIM',
                                    label: `Claims (${
                                      consolidatedFindings.filter((f) => f.category === 'CLAIM')
                                        .length
                                    })`,
                                  },
                                  {
                                    id: 'TERMINOLOGY',
                                    label: `Terminology (${
                                      consolidatedFindings.filter(
                                        (f) => f.category === 'TERMINOLOGY',
                                      ).length
                                    })`,
                                  },
                                  {
                                    id: 'TONE',
                                    label: `Tone (${
                                      consolidatedFindings.filter((f) => f.category === 'TONE')
                                        .length
                                    })`,
                                  },
                                ] as const
                              ).map((tab) => (
                                <button
                                  key={tab.id}
                                  type="button"
                                  className={`bf-filter-tab ${
                                    categoryFilter === tab.id ? 'active' : ''
                                  }`}
                                  onClick={() => setCategoryFilter(tab.id)}
                                >
                                  {tab.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {filteredFindings.length === 0 ? (
                          <div className="bf-empty-state">
                            <strong style={{ color: 'var(--text-heading)' }}>
                              {consolidatedFindings.length === 0
                                ? 'No compliance issues detected'
                                : 'No findings in this filter'}
                            </strong>
                            <p style={{ marginTop: '4px', fontSize: '13px' }}>
                              {consolidatedFindings.length === 0
                                ? 'This draft aligns with the configured brand rules and approved product facts.'
                                : 'Select another filter tab above to view remaining findings.'}
                            </p>
                          </div>
                        ) : (
                          <div className="bf-findings-list">
                            {filteredFindings.map((group) => {
                              const resolvedNote = resolvedGroups[group.id]
                              const isResolved = Boolean(resolvedNote)

                              return (
                                <div
                                  key={group.id}
                                  className={`bf-finding-card severity-${group.severity} ${
                                    isResolved ? 'resolved' : ''
                                  }`}
                                >
                                  <div className="bf-finding-meta">
                                    <div className="bf-finding-tags">
                                      {group.ruleCodes.map((code) => (
                                        <span key={code} className="bf-rule-tag">
                                          {code}
                                        </span>
                                      ))}
                                      <span
                                        className={`bf-severity-indicator bf-severity-${group.severity}`}
                                      >
                                        {group.category.charAt(0) +
                                          group.category.slice(1).toLowerCase()}{' '}
                                        •{' '}
                                        {group.severity.charAt(0) +
                                          group.severity.slice(1).toLowerCase()}
                                      </span>
                                      {isResolved && (
                                        <span className="bf-resolved-indicator">
                                          {resolvedNote}
                                        </span>
                                      )}
                                    </div>

                                    <span className="bf-source-meta">
                                      {group.mergedCount > 1
                                        ? `Consolidated (${group.mergedCount} checks)`
                                        : group.confidences[0]}
                                    </span>
                                  </div>

                                  <h3 className="bf-finding-title">{group.title}</h3>
                                  <p className="bf-finding-desc">{group.message}</p>

                                  <div className="bf-evidence-container">
                                    <div className="bf-evidence-row">
                                      <span className="bf-evidence-label">
                                        {group.evidences.length > 1
                                          ? 'Matched evidence:'
                                          : 'Flagged text:'}
                                      </span>
                                      <div className="bf-evidence-chips">
                                        {group.evidences.map((ev) => (
                                          <button
                                            key={ev}
                                            type="button"
                                            className="bf-evidence-chip"
                                            title="Click to highlight in editor"
                                            onClick={() => handleFocusEvidence(ev)}
                                          >
                                            &ldquo;{ev}&rdquo;
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="bf-evidence-row">
                                      <span className="bf-evidence-label">Guidance:</span>
                                      <span style={{ flex: 1, color: 'var(--text-heading)' }}>
                                        {group.suggestion}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="bf-finding-actions">
                                    <button
                                      type="button"
                                      className="bf-btn-action primary"
                                      onClick={() =>
                                        handleFocusEvidence(group.evidences[0] ?? '')
                                      }
                                    >
                                      Locate in editor
                                    </button>

                                    {!isResolved ? (
                                      <>
                                        <button
                                          type="button"
                                          className="bf-btn-action"
                                          onClick={() => handleTagEvidenceInEditor(group)}
                                        >
                                          Mark span in draft
                                        </button>
                                        <button
                                          type="button"
                                          className="bf-btn-action"
                                          onClick={() =>
                                            handleToggleResolved(group.id, 'Acknowledged')
                                          }
                                        >
                                          Acknowledge
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        className="bf-btn-action"
                                        onClick={() => handleToggleResolved(group.id, '')}
                                      >
                                        Reopen issue
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Human Review Decision Card */}
                <div className="bf-card">
                  <div className="bf-card-header">
                    <h2 className="bf-section-title">Reviewer Sign-Off</h2>
                    <span className="bf-section-meta">Session preview (non-persistent)</span>
                  </div>

                  <div className="bf-card-body">
                    <div className="bf-field">
                      <label className="bf-label" htmlFor="bf-reviewer-note">
                        Review note
                      </label>
                      <input
                        id="bf-reviewer-note"
                        type="text"
                        className="bf-input"
                        value={reviewerNote}
                        onChange={(e) => setReviewerNote(e.target.value)}
                        placeholder="Add optional context for approval or requested revisions..."
                      />
                    </div>

                    <div className="bf-decision-row">
                      <button
                        type="button"
                        className="bf-btn-approve"
                        onClick={() => handleDecision('APPROVED')}
                      >
                        Approve for Publication
                      </button>
                      <button
                        type="button"
                        className="bf-btn-request-changes"
                        onClick={() => handleDecision('CHANGES_REQUESTED')}
                      >
                        Request Revisions
                      </button>
                    </div>

                    {sessionDecision.status !== 'NONE' && (
                      <div
                        className={`bf-status-banner ${
                          sessionDecision.status === 'APPROVED' ? 'success' : 'warn'
                        }`}
                      >
                        <div className="bf-banner-body">
                          <div className="bf-banner-heading">
                            <span>
                              {sessionDecision.status === 'APPROVED'
                                ? 'Approved for publication'
                                : 'Revisions requested'}
                            </span>
                            <span>{sessionDecision.timestamp}</span>
                          </div>
                          <div>
                            {sessionDecision.note} ({openConsolidatedCount} open{' '}
                            {openConsolidatedCount === 1 ? 'finding' : 'findings'} remaining)
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <RulebookPanel
            apiBaseUrl={API_BASE_URL}
            brandProfileId={BRAND_PROFILE_ID}
            onBrandLoaded={setBrandProfile}
            onBack={() => setActiveView('workspace')}
          />
        )}
      </main>
    </div>
  )
}

export default App