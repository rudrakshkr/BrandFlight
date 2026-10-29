import { useState, useEffect, useCallback, useMemo, useRef, type SubmitEvent, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import type { ImageAuditData as ImageAuditApiResponse } from './types/imageAudit'
import RulebookPanel, { type BrandProfileData } from './RulebookPanel'
import SavedSubmissionsPanel, { type SubmissionDetail } from './SavedSubmissionsPanel'
import ReviewQueuePanel from './ReviewQueuePanel'
import ManagerDashboard from './ManagerDashboard'
import ApprovedCampaignsPanel from './ApprovedCampaignsPanel'

type RuleCategory = 'TONE' | 'TERMINOLOGY' | 'CLAIM' | 'VISUAL' | 'ACCESSIBILITY'
type FindingSeverity = 'INFO' | 'WARNING' | 'ERROR'
type ActiveView = 'workspace' | 'image' | 'rulebook' | 'submissions' | 'review' | 'manager' | 'approved'

const ROUTE_BY_VIEW: Record<ActiveView, string> = {
  workspace: '/audit/text',
  image: '/audit/image',
  rulebook: '/rulebook',
  submissions: '/submissions',
  review: '/review',
  manager: '/manager',
  approved: '/approved-campaigns',
}

const VIEW_BY_PATH: Record<string, ActiveView> = {
  '/': 'workspace',
  '/login': 'workspace',
  '/audit/text': 'workspace',
  '/audit/image': 'image',
  '/rulebook': 'rulebook',
  '/submissions': 'submissions',
  '/review': 'review',
  '/manager': 'manager',
  '/approved-campaigns': 'approved',
}
type AuthRole = 'CREATOR' | 'REVIEWER' | 'MANAGER'

interface AuthUser {
  id: string
  name: string
  email: string
  role: AuthRole
}

interface AuthSession {
  token: string
  user: AuthUser
}
type CategoryFilter = 'ALL' | 'CLAIM' | 'TERMINOLOGY' | 'TONE'

interface RawAuditFinding {
  category: RuleCategory
  severity: FindingSeverity
  title: string
  message: string
  evidence: string
  suggestion: string
  originalSpan?: string | null
  suggestedSpan?: string | null
  ruleCode: string
  confidence: string
}

interface FindingMatch {
  evidence: string
  originalSpan: string | null
  suggestedSpan: string | null
  suggestion: string
  confidence: string
  ruleCodes: string[]
}

interface ConsolidatedFinding {
  id: string
  category: RuleCategory
  severity: FindingSeverity
  title: string
  message: string
  suggestion: string
  originalSpan: string | null
  suggestedSpan: string | null
  ruleCodes: string[]
  evidences: string[]
  confidences: string[]
  matches: FindingMatch[]
  mergedCount: number
}

interface AuditApiResponse {
  auditReceiptId?: string
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

function imageAuditSnapshot(data: ImageAuditApiResponse | null | undefined) {
  if (!data) return null

  return {
    asset: data.asset,
    image: {
      name: data.image.name,
      format: data.image.format,
      width: data.image.width,
      height: data.image.height,
      dominantColors: data.image.dominantColors,
      approvedColors: data.image.approvedColors,
      colorAnalysis: data.image.colorAnalysis,
      altTextLength: data.image.altTextLength,
    },
    totalFindings: data.totalFindings,
    logoVerification: data.logoVerification ?? null,
    findings: data.findings.map((finding) => ({
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      message: finding.message,
      evidence: finding.evidence,
      suggestion: finding.suggestion,
      ruleCode: finding.ruleCode,
      confidence: finding.confidence,
    })),
  }
}

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  'http://localhost:3000'

const DEMO_ACCESS_ENABLED = import.meta.env.DEV ||
  (import.meta.env.VITE_DEMO_MODE as string | undefined)?.trim().toLowerCase() === 'true'

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
    const lowerEvidence = trimmedEvidence.toLowerCase()

    // Prefer grouping every occurrence produced by the same rule. If two rules
    // flag overlapping text, retain the earlier evidence-consolidation behavior.
    const existingGroup = groups.find((group) =>
      group.category === item.category && group.ruleCodes.includes(item.ruleCode),
    ) ?? groups.find((group) => {
      if (group.category !== item.category) return false
      return group.evidences.some((evidence) => {
        const lower = evidence.toLowerCase()
        return lower.includes(lowerEvidence) || lowerEvidence.includes(lower)
      })
    })

    const incomingMatch: FindingMatch = {
      evidence: trimmedEvidence,
      originalSpan: item.originalSpan?.trim() || null,
      suggestedSpan: item.suggestedSpan?.trim() || null,
      suggestion: item.suggestion,
      confidence: item.confidence,
      ruleCodes: [item.ruleCode],
    }

    if (!existingGroup) {
      groups.push({
        id: `${item.category}-${item.ruleCode}-${trimmedEvidence}`,
        category: item.category,
        severity: item.severity,
        title: item.title,
        message: item.message,
        suggestion: item.suggestion,
        originalSpan: item.originalSpan?.trim() || null,
        suggestedSpan: item.suggestedSpan?.trim() || null,
        ruleCodes: [item.ruleCode],
        evidences: trimmedEvidence ? [trimmedEvidence] : [],
        confidences: [item.confidence],
        matches: trimmedEvidence ? [incomingMatch] : [],
        mergedCount: 1,
      })
      continue
    }

    existingGroup.mergedCount += 1
    if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[existingGroup.severity]) {
      existingGroup.severity = item.severity
    }

    const existingIsGeneric =
      existingGroup.title === 'Unverified numerical claim' ||
      existingGroup.message.startsWith('Content matched rule')
    const incomingIsSpecific =
      item.title !== 'Unverified numerical claim' &&
      !item.message.startsWith('Content matched rule')
    if (existingIsGeneric && incomingIsSpecific) {
      existingGroup.title = item.title
      existingGroup.message = item.message
      existingGroup.suggestion = item.suggestion
    }

    const exactMatch = existingGroup.matches.find(
      (match) => match.evidence.toLowerCase() === lowerEvidence,
    )
    if (exactMatch) {
      if (!exactMatch.ruleCodes.includes(item.ruleCode)) exactMatch.ruleCodes.push(item.ruleCode)
      if (!exactMatch.originalSpan && incomingMatch.originalSpan) exactMatch.originalSpan = incomingMatch.originalSpan
      if (!exactMatch.suggestedSpan && incomingMatch.suggestedSpan) exactMatch.suggestedSpan = incomingMatch.suggestedSpan
      if ((!exactMatch.suggestion || exactMatch.suggestion.length < item.suggestion.length) && item.suggestion) {
        exactMatch.suggestion = item.suggestion
      }
      if (!exactMatch.confidence) exactMatch.confidence = item.confidence
    } else if (trimmedEvidence) {
      existingGroup.matches.push(incomingMatch)
    }

    if (!existingGroup.originalSpan && incomingMatch.originalSpan) existingGroup.originalSpan = incomingMatch.originalSpan
    if (!existingGroup.suggestedSpan && incomingMatch.suggestedSpan) existingGroup.suggestedSpan = incomingMatch.suggestedSpan
    if (!existingGroup.ruleCodes.includes(item.ruleCode)) existingGroup.ruleCodes.push(item.ruleCode)
    if (trimmedEvidence && !existingGroup.evidences.some((evidence) => evidence.toLowerCase() === lowerEvidence)) {
      existingGroup.evidences.push(trimmedEvidence)
    }
    if (!existingGroup.confidences.includes(item.confidence)) existingGroup.confidences.push(item.confidence)
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
  const location = useLocation()
  const navigate = useNavigate()
  const routePath = location.pathname.replace(/\/+$/, '') || '/'
  const submissionEditorMatch = routePath.match(/^\/submissions\/([^/]+)\/edit$/)
  let routeSubmissionId: string | null = null

  try {
    routeSubmissionId = submissionEditorMatch
      ? decodeURIComponent(submissionEditorMatch[1])
      : null
  } catch {
    routeSubmissionId = null
  }

  const requestedEditorView = new URLSearchParams(location.search).get('view')
  const activeView = routeSubmissionId
    ? requestedEditorView === 'image' ? 'image' : 'workspace'
    : VIEW_BY_PATH[routePath]
  const setActiveView = useCallback((view: ActiveView) => {
    if (routeSubmissionId && (view === 'workspace' || view === 'image')) {
      const editorPath = `/submissions/${encodeURIComponent(routeSubmissionId)}/edit`
      navigate(view === 'image' ? `${editorPath}?view=image` : editorPath)
      return
    }
    navigate(ROUTE_BY_VIEW[view])
  }, [navigate, routeSubmissionId])

  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [pendingManagerSubmissionId, setPendingManagerSubmissionId] = useState<string | null>(null)
  const handleManagerOpenSubmission = useCallback((submissionId: string) => {
    setPendingManagerSubmissionId(submissionId)
    setActiveView('review')
  }, [setActiveView])
  const handleInitialReviewSelectionHandled = useCallback(() => setPendingManagerSubmissionId(null), [])
  const [authChecking, setAuthChecking] = useState(
    () => Boolean(window.sessionStorage.getItem('brandflight_token')),
  )
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [demoLoginBusyRole, setDemoLoginBusyRole] = useState<AuthRole | null>(null)
  const [demoLoginError, setDemoLoginError] = useState<string | null>(null)
  const [editingSubmissionId, setEditingSubmissionId] = useState<string | null>(null)
  const [submissionComments, setSubmissionComments] = useState<SubmissionDetail['comments']>([])
  const [routeDraftLoadedId, setRouteDraftLoadedId] = useState<string | null>(null)
  const [brandProfile, setBrandProfile] = useState<BrandProfileData | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const imageObjectUrlRef = useRef<string | null>(null)
  const [imageAltText, setImageAltText] = useState('')
  const [isImageAuditing, setIsImageAuditing] = useState(false)
  const [imageAuditError, setImageAuditError] = useState<string | null>(null)
  const [imageAuditResult, setImageAuditResult] =
    useState<ImageAuditApiResponse | null>(null)
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLE_DRAFTS[0].id)
  const [draftTitle, setDraftTitle] = useState<string>(SAMPLE_DRAFTS[0].title)
  const [draftChannel, setDraftChannel] = useState<string>(SAMPLE_DRAFTS[0].channel)
  const [content, setContent] = useState<string>(SAMPLE_DRAFTS[0].content)
  const [showInlineMap, setShowInlineMap] = useState<boolean>(true)
  const [showFactsDrawer, setShowFactsDrawer] = useState<boolean>(true)

  const [apiHealth, setApiHealth] = useState<'checking' | 'online' | 'offline'>('checking')
  const [isAuditing, setIsAuditing] = useState<boolean>(false)
  const [refineBusy, setRefineBusy] = useState(false)
  const [refineError, setRefineError] = useState<string | null>(null)
  const [refineMessage, setRefineMessage] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditResult, setAuditResult] = useState<AuditApiResponse | null>(null)
  const [auditRestoredFromSubmission, setAuditRestoredFromSubmission] = useState(false)
  const [auditedContent, setAuditedContent] = useState<string | null>(null)
  const [saveDraftBusy, setSaveDraftBusy] = useState(false)
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null)
  const [saveDraftMessage, setSaveDraftMessage] = useState<string | null>(null)
  const [savedSubmissionsNudge, setSavedSubmissionsNudge] = useState(false)
  const saveInProgressRef = useRef(false)
  const lastSavedDraftKeyRef = useRef<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL')
  const [guidanceCopyFeedback, setGuidanceCopyFeedback] = useState<{
    groupId: string
    message: string
    isError: boolean
  } | null>(null)
  const [auditedImageAltText, setAuditedImageAltText] = useState<string | null>(null)
  const [overrideTarget, setOverrideTarget] = useState<{ groupId: string; title: string; ruleCodes: string[]; evidences: string[] } | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideBusy, setOverrideBusy] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  useEffect(() => {
    if (!saveDraftMessage) return
    const timeoutId = window.setTimeout(() => setSaveDraftMessage(null), 6000)
    return () => window.clearTimeout(timeoutId)
  }, [saveDraftMessage])

  useEffect(() => {
    const token = window.sessionStorage.getItem('brandflight_token')

    if (!token) return

    const sessionToken: string = token

    let cancelled = false

    async function restoreSession() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        })

        if (!response.ok) {
          throw new Error('Session expired')
        }

        const data = (await response.json()) as { user: AuthUser }

        if (!cancelled) {
          setAuthSession({ token: sessionToken, user: data.user })
        }
      } catch {
        window.sessionStorage.removeItem('brandflight_token')
      } finally {
        if (!cancelled) {
          setAuthChecking(false)
        }
      }
    }

    void restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (authChecking) return

    if (!authSession) {
      if (routePath !== '/login') {
        navigate('/login', { replace: true })
      }
      return
    }

    const roleHomePath =
      authSession.user.role === 'CREATOR'
        ? ROUTE_BY_VIEW.workspace
        : authSession.user.role === 'REVIEWER'
          ? ROUTE_BY_VIEW.review
          : ROUTE_BY_VIEW.manager

    if (routePath === '/' || routePath === '/login') {
      navigate(roleHomePath, { replace: true })
      return
    }

    if (routeSubmissionId && authSession.user.role !== 'CREATOR') {
      navigate(roleHomePath, { replace: true })
      return
    }

    if (!activeView) return

    const canAccessView =
      activeView === 'approved' ||
      (authSession.user.role === 'CREATOR'
        ? activeView === 'workspace' ||
          activeView === 'image' ||
          activeView === 'submissions'
        : authSession.user.role === 'REVIEWER'
          ? activeView === 'review'
          : activeView === 'manager' ||
            activeView === 'review' ||
            activeView === 'rulebook')

    if (!canAccessView) {
      navigate(roleHomePath, { replace: true })
    }
  }, [authChecking, authSession, activeView, navigate, routePath, routeSubmissionId])

  useEffect(() => {
    if (
      authChecking ||
      !authSession ||
      authSession.user.role !== 'CREATOR' ||
      !routeSubmissionId ||
      routeDraftLoadedId === routeSubmissionId
    ) {
      return
    }

    let cancelled = false

    async function restoreDraftFromUrl() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/submissions/${encodeURIComponent(routeSubmissionId!)}`,
          { headers: { Authorization: `Bearer ${authSession!.token}` } },
        )

        const data = (await response.json().catch(() => null)) as {
          submission?: SubmissionDetail
          error?: string
        } | null

        if (!response.ok || !data?.submission) {
          throw new Error(
            data?.error ?? `Unable to load this draft (HTTP ${response.status}).`,
          )
        }

        const submission = data.submission

        if (
          submission.status !== 'DRAFT' &&
          submission.status !== 'CHANGES_REQUESTED'
        ) {
          navigate('/submissions', { replace: true })
          return
        }

        const restoredFindings: RawAuditFinding[] = submission.findings.map((finding) => ({
          category: finding.category,
          severity: finding.severity,
          title: finding.title,
          message: finding.message,
          evidence: finding.evidence ?? '',
          suggestion: finding.suggestion ?? '',
          originalSpan: finding.originalSpan ?? null,
          suggestedSpan: finding.suggestedSpan ?? null,
          ruleCode: finding.ruleCode ?? '',
          confidence: finding.confidence ?? '',
        }))

        const restoredSnapshotKey = JSON.stringify({
          title: submission.title.trim(),
          content: submission.contentText,
          findings: restoredFindings,
          textAuditReceiptId: submission.textAuditReceiptId ?? null,
          imageAuditReceiptId: submission.imageAuditReceiptId ?? null,
          imageName: submission.imageName ?? null,
          imageAssetId: submission.imagePublicId ?? null,
          imageAltText: submission.imageAltText ?? null,
          imageAudit: imageAuditSnapshot(submission.imageAuditData),
        })

        if (cancelled) return

        setEditingSubmissionId(submission.id)

        setSubmissionComments(submission.comments ?? [])
        lastSavedDraftKeyRef.current = restoredSnapshotKey
        setSelectedSampleId('')
        setDraftTitle(submission.title)
        setDraftChannel('Website')
        setContent(submission.contentText)
        setImageFile(null)
        setImageAltText(submission.imageAltText ?? '')
        setAuditedImageAltText(
          submission.imageAuditData ? (submission.imageAltText ?? '') : null,
        )
        setImageAuditResult(
          submission.imageAuditData
            ? {
                ...submission.imageAuditData,
                auditReceiptId: submission.imageAuditReceiptId ?? undefined,
                asset: submission.imageUrl && submission.imagePublicId
                  ? { secureUrl: submission.imageUrl, publicId: submission.imagePublicId }
                  : submission.imageAuditData.asset,
              }
            : null,
        )
        setImagePreviewUrl(
          submission.imageUrl ?? submission.imageAuditData?.asset?.secureUrl ?? null,
        )
        setImageAuditError(null)
        setCategoryFilter('ALL')
        setAuditError(null)
        setAuditResult({
          brand: submission.brandProfile,
          totalFindings: restoredFindings.length,
          findings: restoredFindings,
          semanticStatus: 'unavailable',
          auditReceiptId: submission.textAuditReceiptId ?? undefined,
        })
        setAuditedContent(submission.contentText)
        setAuditRestoredFromSubmission(true)
        setSaveDraftError(null)
        setSaveDraftMessage(null)
        setRouteDraftLoadedId(submission.id)
      } catch (error) {
        if (cancelled) return
        console.error('Unable to restore draft from URL:', error)
        navigate('/submissions', { replace: true })
      }
    }

    void restoreDraftFromUrl()

    return () => {
      cancelled = true
    }
  }, [
    authChecking,
    authSession,
    routeSubmissionId,
    routeDraftLoadedId,
    navigate,
  ])

  /* BrandFlight save toast waits for editor route */
  useEffect(() => {
    if (!routeSubmissionId || routeDraftLoadedId !== routeSubmissionId) return
    const timeoutId = window.setTimeout(() => {
      const pendingMessage = window.sessionStorage.getItem('brandflight_pending_save_toast')
      if (!pendingMessage) return
      window.sessionStorage.removeItem('brandflight_pending_save_toast')
      setSaveDraftMessage(pendingMessage)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [routeSubmissionId, routeDraftLoadedId])

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

    setAuditedContent(null)
    setAuditRestoredFromSubmission(false)
    setIsAuditing(true)
    setAuditError(null)
    setGuidanceCopyFeedback(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${window.sessionStorage.getItem('brandflight_token') ?? ''}`,
        },
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
      setAuditedContent(textToAudit)
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

  const handleImageAuditSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!imageFile) {
      setImageAuditError('Choose a PNG or JPEG image first.')
      return
    }

    setIsImageAuditing(true)
    setImageAuditError(null)
    setImageAuditResult(null)
    setAuditedImageAltText(null)

    try {
      const formData = new FormData()
      formData.append('brandProfileId', BRAND_PROFILE_ID)
      formData.append('altText', imageAltText.trim())
      formData.append('image', imageFile)

      const response = await fetch(`${API_BASE_URL}/api/audit/image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.sessionStorage.getItem('brandflight_token') ?? ''}`,
        },
        body: formData,
      })

      const data: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          typeof data === 'object' &&
          data !== null &&
          'error' in data &&
          typeof data.error === 'string'
            ? data.error
            : `Image audit failed with HTTP ${response.status}`

        throw new Error(message)
      }

      setImageAuditResult(data as ImageAuditApiResponse)
      setImageAltText(imageAltText.trim())
      setAuditedImageAltText(imageAltText.trim())
    } catch (err) {
      setImageAuditError(
        err instanceof Error ? err.message : 'Unable to audit this image.',
      )
    } finally {
      setIsImageAuditing(false)
    }
  }

  const consolidatedFindings = useMemo(
    () => consolidateFindings(auditResult?.findings ?? []),
    [auditResult],
  )

  const reviewerComments = submissionComments.filter(
    (comment) => comment.author?.role === 'REVIEWER' || comment.author?.role === 'MANAGER',
  )

  const hasOverrideRequest = (group: ConsolidatedFinding, match?: FindingMatch) => submissionComments.some((comment) => {
    const body = comment.body ?? ''
    if (!body.startsWith('OVERRIDE REQUEST')) return false
    const ruleLine = body.split('\n').find((line) => line.startsWith('Rule(s): ')) ?? ''
    const requestedRules = ruleLine.slice('Rule(s): '.length).split(',').map((code) => code.trim())
    const evidenceLine = body.split('\n').find((line) => line.startsWith('Flagged evidence: ')) ?? ''
    const requestedEvidence = evidenceLine.slice('Flagged evidence: '.length).split(' / ').map((value) => value.trim().toLowerCase()).filter(Boolean)
    const targetRules = match?.ruleCodes ?? group.ruleCodes
    const hasRule = targetRules.some((code) => requestedRules.includes(code))
    if (!hasRule) return false
    if (match) return requestedEvidence.includes(match.evidence.trim().toLowerCase())
    return group.evidences.some((evidence) => requestedEvidence.includes(evidence.trim().toLowerCase()))
  })

  const activeEvidences = useMemo(
    () => consolidatedFindings.flatMap((group) => group.evidences),
    [consolidatedFindings],
  )

  const filteredFindings = useMemo(() => {
    return consolidatedFindings.filter((group) => {
      if (categoryFilter === 'ALL') return true
      return group.category === categoryFilter
    })
  }, [consolidatedFindings, categoryFilter])

  const handleSelectScenario = (sample: SampleDraft) => {
    setEditingSubmissionId(null)
    lastSavedDraftKeyRef.current = null
    setSaveDraftError(null)
    setSaveDraftMessage(null)
    setSelectedSampleId(sample.id)
    setDraftTitle(sample.title)
    setDraftChannel(sample.channel)
    setContent(sample.content)
    setCategoryFilter('ALL')
    void runBackendAudit(sample.content)
  }

  const handleAuditSubmit = (e: SubmitEvent) => {
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

  const occurrenceFeedbackId = (group: ConsolidatedFinding, match?: FindingMatch) =>
    `${group.id}::${match?.evidence ?? group.evidences[0] ?? ''}`

  const handleCopyGuidance = async (group: ConsolidatedFinding, match?: FindingMatch) => {
    const guidance = (match?.suggestion || group.suggestion).trim()
    const feedbackId = occurrenceFeedbackId(group, match)
    if (!guidance) {
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'No guidance is available to copy for this finding.', isError: true })
      return
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser context.')
      await navigator.clipboard.writeText(guidance)
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'Guidance copied. Edit the flagged copy, then re-run Preflight Audit.', isError: false })
    } catch {
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'Clipboard access failed. Select and copy the guidance text above.', isError: true })
    }
  }

  const handleApplySuggestion = (group: ConsolidatedFinding, match?: FindingMatch) => {
    const selectedMatch = match ?? group.matches[0]
    if (!selectedMatch) return
    const originalSpan = selectedMatch.originalSpan?.trim()
    const suggestedSpan = selectedMatch.suggestedSpan?.trim()
    const feedbackId = occurrenceFeedbackId(group, selectedMatch)

    if (!originalSpan || !suggestedSpan) {
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'This finding has guidance but no safe direct replacement. Edit the copy manually.', isError: true })
      return
    }
    if (auditedContent !== content) {
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'Run Preflight Audit on the current copy before applying a suggestion from these findings.', isError: true })
      return
    }

    const start = content.indexOf(originalSpan)
    if (start < 0) {
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'The original phrase is no longer present. Run Preflight Audit again.', isError: true })
      return
    }
    if (content.indexOf(originalSpan, start + originalSpan.length) >= 0) {
      setGuidanceCopyFeedback({ groupId: feedbackId, message: 'This phrase appears more than once. Use Locate in editor and edit the intended occurrence manually.', isError: true })
      return
    }

    const nextContent = `${content.slice(0, start)}${suggestedSpan}${content.slice(start + originalSpan.length)}`
    setContent(nextContent)
    setAuditResult((current) => {
      if (!current) return current
      const targetEvidence = selectedMatch.evidence.trim().toLowerCase()
      const remaining = current.findings.filter((finding) =>
        finding.category !== group.category || finding.evidence.trim().toLowerCase() !== targetEvidence || !selectedMatch.ruleCodes.includes(finding.ruleCode),
      )
      return { ...current, findings: remaining, totalFindings: remaining.length }
    })
    setAuditRestoredFromSubmission(false)
    setSaveDraftError(null)
    setSaveDraftMessage(null)
    setRefineMessage(null)
    setGuidanceCopyFeedback({ groupId: feedbackId, message: 'Suggestion applied to the editor. Only this phrase was cleared from the active list; run Preflight Audit again before saving.', isError: false })
  }

  const handleOpenOverrideRequest = (group: ConsolidatedFinding, match?: FindingMatch) => {
    if (hasOverrideRequest(group, match)) {
      setGuidanceCopyFeedback({ groupId: occurrenceFeedbackId(group, match), message: 'An override request for this phrase is already saved in the campaign discussion.', isError: false })
      return
    }
    if (!editingSubmissionId || !authSession || authSession.user.role !== 'CREATOR') {
      setGuidanceCopyFeedback({ groupId: occurrenceFeedbackId(group, match), message: 'Save this campaign as a draft first. The override request will be attached to that campaign discussion.', isError: true })
      return
    }
    const evidence = match?.evidence ? [match.evidence] : group.evidences
    const ruleCodes = match?.ruleCodes ?? group.ruleCodes
    setOverrideTarget({
      groupId: occurrenceFeedbackId(group, match),
      title: group.title,
      ruleCodes,
      evidences: evidence,
    })
    setOverrideReason('')
    setOverrideError(null)
  }

  const handleSubmitOverrideRequest = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!overrideTarget || !editingSubmissionId || !authSession) return
    const justification = overrideReason.trim()
    if (justification.length < 15 || justification.length > 2000) {
      setOverrideError('Provide a justification of 15–2,000 characters.')
      return
    }

    setOverrideBusy(true)
    setOverrideError(null)
    const body = [
      'OVERRIDE REQUEST',
      `Rule(s): ${overrideTarget.ruleCodes.join(', ')}`,
      `Finding: ${overrideTarget.title}`,
      `Flagged evidence: ${overrideTarget.evidences.join(' / ') || 'Not available'}`,
      `Creator justification: ${justification}`,
    ].join('\n')

    try {
      const response = await fetch(`${API_BASE_URL}/api/submissions/${encodeURIComponent(editingSubmissionId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession.token}` },
        body: JSON.stringify({ body }),
      })
      const data = (await response.json().catch(() => null)) as {
        comment?: SubmissionDetail['comments'][number]
        error?: string
      } | null
      if (!response.ok || !data?.comment) throw new Error(data?.error ?? `Unable to submit override request (HTTP ${response.status}).`)
      setSubmissionComments((previous) => [...previous, data.comment!])
      setGuidanceCopyFeedback({
        groupId: overrideTarget.groupId,
        message: 'Override request saved to the campaign discussion for reviewer/manager consideration. The finding remains active until the copy is changed and re-audited.',
        isError: false,
      })
      setOverrideTarget(null)
      setOverrideReason('')
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : 'Unable to submit override request.')
    } finally {
      setOverrideBusy(false)
    }
  }

  const handleRefineCopy = async () => {
    if (refineBusy || isAuditing || !content.trim()) return
    if (!authSession || authSession.user.role !== 'CREATOR') {
      setRefineError('Sign in with a Creator account to refine campaign copy.')
      setRefineMessage(null)
      return
    }
    setRefineBusy(true)
    setRefineError(null)
    setRefineMessage(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/audit/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession.token}` },
        body: JSON.stringify({ brandProfileId: BRAND_PROFILE_ID, content }),
      })
      const data = await response.json().catch(() => null) as { refinedContent?: string; error?: string } | null
      if (!response.ok || typeof data?.refinedContent !== 'string' || !data.refinedContent.trim()) {
        throw new Error(data?.error ?? `Could not refine copy (HTTP ${response.status}).`)
      }
      if (data.refinedContent.trim() === content.trim()) {
        setRefineMessage('No text changes were suggested. Run Preflight Audit to verify the current copy.')
        return
      }
      setContent(data.refinedContent.trim())
      setAuditResult(null)
      setAuditedContent(null)
      setAuditError(null)
      setAuditRestoredFromSubmission(false)
      setGuidanceCopyFeedback(null)
      setSaveDraftError(null)
      setSaveDraftMessage(null)
      setRefineMessage('Copy refined. Review the wording, then run Preflight Audit before saving or submitting.')
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : 'Could not refine copy.')
    } finally {
      setRefineBusy(false)
    }
  }



  const handleLogin = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginBusy(true)
    setLoginError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      })

      const data = (await response.json().catch(() => null)) as {
        token?: string
        user?: AuthUser
        error?: string
      } | null

      if (!response.ok || !data?.token || !data.user) {
        throw new Error(data?.error ?? 'Login failed. Check your credentials.')
      }

      window.sessionStorage.setItem('brandflight_token', data.token)
      setAuthSession({ token: data.token, user: data.user })
      setLoginPassword('')
      navigate(
        ROUTE_BY_VIEW[
          data.user.role === 'CREATOR'
            ? 'workspace'
            : data.user.role === 'REVIEWER'
              ? 'review'
              : 'manager'
        ],
        { replace: true },
      )
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Unable to log in.',
      )
    } finally {
      setLoginBusy(false)
    }
  }

  const handleDemoLogin = async (role: AuthRole) => {
    if (demoLoginBusyRole !== null || loginBusy) return
    setDemoLoginBusyRole(role)
    setLoginError(null)
    setDemoLoginError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/demo-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = (await response.json().catch(() => null)) as {
        token?: string
        user?: AuthUser
        error?: string
      } | null

      if (!response.ok || !data?.token || !data.user || data.user.role !== role) {
        throw new Error(data?.error ?? 'Unable to enter this demo role.')
      }

      window.sessionStorage.setItem('brandflight_token', data.token)
      setAuthSession({ token: data.token, user: data.user })
      setLoginPassword('')
      setPendingManagerSubmissionId(null)
      setLoginError(null)
      setDemoLoginError(null)
      const roleHomePath = role === 'CREATOR'
        ? ROUTE_BY_VIEW.workspace
        : role === 'REVIEWER'
          ? ROUTE_BY_VIEW.review
          : ROUTE_BY_VIEW.manager
      navigate(roleHomePath, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to enter this demo role.'
      if (authSession) setDemoLoginError(message)
      else setLoginError(message)
    } finally {
      setDemoLoginBusyRole(null)
    }
  }

  const handleLogout = () => {
    window.sessionStorage.removeItem('brandflight_token')
    setAuthSession(null)
    setLoginPassword('')
    setLoginError(null)
    navigate('/login', { replace: true })
  }

  if (authChecking) {
    return (
      <div className="bf-auth-screen">
        <div className="bf-auth-card">
          <span className="bf-auth-kicker">BRANDFLIGHT</span>
          <h1>Checking session</h1>
          <p>Verifying your sign-in…</p>
        </div>
      </div>
    )
  }

  if (!authSession) {
    return (
      <div className="bf-auth-screen">
        <form className="bf-auth-card" onSubmit={handleLogin}>
          <span className="bf-auth-kicker">CONTENT PREFLIGHT</span>
          <h1 className="bf-auth-title">Welcome to BrandFlight</h1>
          <p className="bf-auth-subtitle">
            Sign in to review campaign content against your brand rules.
          </p>

          {DEMO_ACCESS_ENABLED && (
            <section className="bf-demo-access" aria-labelledby="bf-demo-access-title">
              <div className="bf-demo-access-heading">
                <h2 id="bf-demo-access-title">Explore the demo</h2>
                <p>Choose a role to enter directly. No password required.</p>
              </div>
              <div className="bf-demo-role-grid">
                <button
                  type="button"
                  className="bf-demo-role-button creator"
                  onClick={() => void handleDemoLogin('CREATOR')}
                  disabled={loginBusy || demoLoginBusyRole !== null}
                >
                  <span className="bf-demo-role-mark" aria-hidden="true">CR</span>
                  <span className="bf-demo-role-copy"><strong>Creator</strong><small>Draft and audit campaign content</small></span>
                  <span className="bf-demo-role-arrow" aria-hidden="true">{demoLoginBusyRole === 'CREATOR' ? 'Opening…' : '→'}</span>
                </button>
                <button
                  type="button"
                  className="bf-demo-role-button reviewer"
                  onClick={() => void handleDemoLogin('REVIEWER')}
                  disabled={loginBusy || demoLoginBusyRole !== null}
                >
                  <span className="bf-demo-role-mark" aria-hidden="true">RV</span>
                  <span className="bf-demo-role-copy"><strong>Reviewer</strong><small>Review submissions and add comments</small></span>
                  <span className="bf-demo-role-arrow" aria-hidden="true">{demoLoginBusyRole === 'REVIEWER' ? 'Opening…' : '→'}</span>
                </button>
                <button
                  type="button"
                  className="bf-demo-role-button manager"
                  onClick={() => void handleDemoLogin('MANAGER')}
                  disabled={loginBusy || demoLoginBusyRole !== null}
                >
                  <span className="bf-demo-role-mark" aria-hidden="true">MG</span>
                  <span className="bf-demo-role-copy"><strong>Manager</strong><small>Manage the workspace and brand rules</small></span>
                  <span className="bf-demo-role-arrow" aria-hidden="true">{demoLoginBusyRole === 'MANAGER' ? 'Opening…' : '→'}</span>
                </button>
              </div>
            </section>
          )}

          {loginError && (
            <p className="bf-auth-error" role="alert">
              {loginError}
            </p>
          )}

          <details className="bf-auth-credentials" open={!DEMO_ACCESS_ENABLED}>
            <summary>Sign in with an account</summary>
            <div className="bf-auth-credential-fields">
          <label className="bf-auth-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="bf-auth-input"
            type="email"
            autoComplete="username"
            value={loginEmail}
            onChange={(event) => setLoginEmail(event.target.value)}
            required
          />

          <label className="bf-auth-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="bf-auth-input"
            type="password"
            autoComplete="current-password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            required
          />

          <button
            className="bf-auth-submit"
            type="submit"
            disabled={loginBusy || demoLoginBusyRole !== null}
          >
            {loginBusy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="bf-auth-footnote">
            Use the credentials provided for your BrandFlight account.
          </p>
            </div>
          </details>
        </form>
      </div>
    )
  }

  const handleSaveDraft = async () => {
    if (saveInProgressRef.current) return;
    setSaveDraftError(null)
    setSaveDraftMessage(null)

    if (!authSession || authSession.user.role !== 'CREATOR') {
      setSaveDraftError('Sign in with a Creator account to save drafts.')
      return
    }

    if (!draftTitle.trim() || draftTitle.trim().length > 160) {
      setSaveDraftError('Enter a title between 1 and 160 characters.')
      return
    }

    if (!content.trim()) {
      setSaveDraftError('Enter campaign copy before saving.')
      return
    }

    const hasFreshTextAudit = Boolean(
      auditResult && auditedContent === content && auditResult.auditReceiptId,
    )
    const findingsToSave = hasFreshTextAudit && auditResult ? auditResult.findings : []

    if (findingsToSave.length > 20) {
      setSaveDraftError('This audited draft has more than 20 findings. The API currently allows up to 20.');
      return
    }

    if (imageFile && !imageAuditResult) {
      setSaveDraftError(
        'Run the image audit before saving the newly selected image.',
      )
      return
    }

    if (imageAuditResult && (
      !imageAuditResult.asset?.secureUrl || !imageAuditResult.asset?.publicId
    )) {
      setSaveDraftError(
        'The image audit did not return a saved Cloudinary image. Run the image audit again before saving.',
      )
      return
    }


    const hasFreshImageAudit = Boolean(
      imageAuditResult && auditedImageAltText === imageAltText && imageAuditResult.auditReceiptId &&
      imageAuditResult.asset?.secureUrl && imageAuditResult.asset?.publicId,
    )
    const snapshotKey = JSON.stringify({
      title: draftTitle.trim(),
      content,
      findings: findingsToSave,
      textAuditReceiptId: hasFreshTextAudit ? auditResult?.auditReceiptId ?? null : null,
      imageAuditReceiptId: hasFreshImageAudit ? imageAuditResult?.auditReceiptId ?? null : null,
      imageName: imageAuditResult?.image.name ?? null,
      imageAssetId: imageAuditResult?.asset?.publicId ?? null,
      imageAltText: imageAuditResult ? imageAltText.trim() || null : null,
      imageAudit: hasFreshImageAudit ? imageAuditSnapshot(imageAuditResult) : null,
    })

    if (lastSavedDraftKeyRef.current === snapshotKey) {
      setSavedSubmissionsNudge(true)
      setSaveDraftMessage('This draft is already saved. Open Saved Submissions to continue.')
      return
    }

    saveInProgressRef.current = true
    setSaveDraftBusy(true)

    const isUpdating = editingSubmissionId !== null
    const endpoint = isUpdating
      ? `${API_BASE_URL}/api/submissions/${editingSubmissionId}`
      : `${API_BASE_URL}/api/submissions`

    try {
      const response = await fetch(endpoint, {
        method: isUpdating ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.token}`,
        },
        body: JSON.stringify({
          title: draftTitle.trim(),
          contentText: content,
          brandProfileId: BRAND_PROFILE_ID,
          findings: findingsToSave,
          textAuditReceiptId: hasFreshTextAudit ? auditResult?.auditReceiptId ?? null : null,
          imageAuditReceiptId: hasFreshImageAudit ? imageAuditResult?.auditReceiptId ?? null : null,
          ...(imageAuditResult
            ? {
                imageName: imageAuditResult.image.name,
                imageAltText: imageAltText.trim() || null,
                imageAuditData: hasFreshImageAudit ? imageAuditSnapshot(imageAuditResult) : null,
                imageUrl: imageAuditResult.asset?.secureUrl ?? null,
                imagePublicId: imageAuditResult.asset?.publicId ?? null,
              }
            : {}),
        }),
      })

      const data = (await response.json().catch(() => null)) as {
        submission?: {
          id: string
          title: string
          status: string
          textAuditReceiptId?: string | null
          imageAuditReceiptId?: string | null
          imageUrl?: string | null
        }
        error?: string
      } | null

      if (!response.ok || !data?.submission) {
        throw new Error(data?.error ?? `Save failed (HTTP ${response.status}).`)
      }

      lastSavedDraftKeyRef.current = snapshotKey
      if (!isUpdating) {
        setEditingSubmissionId(data.submission.id)
        setRouteDraftLoadedId(data.submission.id)
      }
      // Server receipt IDs tell us whether the saved audit matched the live brand config.
      const serverHasFreshTextAudit = Boolean(
        hasFreshTextAudit && data.submission.textAuditReceiptId === auditResult?.auditReceiptId,
      )
      const imageIsAttached = Boolean(imageAuditResult?.asset?.secureUrl || data.submission.imageUrl)
      const serverHasFreshImageAudit = !imageIsAttached || Boolean(
        hasFreshImageAudit && data.submission.imageAuditReceiptId === imageAuditResult?.auditReceiptId,
      )
      const auditsNeedRefresh = !serverHasFreshTextAudit || !serverHasFreshImageAudit
      setSavedSubmissionsNudge(true)
      const saveToastMessage = auditsNeedRefresh
        ? `Draft ${isUpdating ? 'updated' : 'saved'}, but an audit needs refreshing. Open Saved Submissions to continue.`
        : isUpdating
          ? 'Draft updated. Open Saved Submissions to continue or submit it for review.'
          : 'Draft saved. Open Saved Submissions to submit it for review.'
      window.sessionStorage.setItem('brandflight_pending_save_toast', saveToastMessage)
      const targetEditPath = `/submissions/${encodeURIComponent(data.submission.id)}/edit`
      if (location.pathname === targetEditPath) {
        window.sessionStorage.removeItem('brandflight_pending_save_toast')
        setSaveDraftMessage(saveToastMessage)
      } else {
        navigate(targetEditPath)
      }
    } catch (error) {
      setSaveDraftError(
        error instanceof Error ? error.message : 'Unable to save this draft.',
      )
    } finally {
      saveInProgressRef.current = false
      setSaveDraftBusy(false)
    }
  }

  const handleOpenSavedDraft = (submission: SubmissionDetail) => {
    if (submission.status !== 'DRAFT' && submission.status !== 'CHANGES_REQUESTED') {
      return
    }

    const restoredFindings: RawAuditFinding[] = submission.findings.map((finding) => ({
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      message: finding.message,
      evidence: finding.evidence ?? '',
      suggestion: finding.suggestion ?? '',
      originalSpan: finding.originalSpan ?? null,
      suggestedSpan: finding.suggestedSpan ?? null,
      ruleCode: finding.ruleCode ?? '',
      confidence: finding.confidence ?? '',
    }))

    const restoredSnapshotKey = JSON.stringify({
      title: submission.title.trim(),
      content: submission.contentText,
      findings: restoredFindings,
      textAuditReceiptId: submission.textAuditReceiptId ?? null,
      imageAuditReceiptId: submission.imageAuditReceiptId ?? null,
      imageName: submission.imageName ?? null,
      imageAltText: submission.imageAltText ?? null,
      imageAudit: imageAuditSnapshot(submission.imageAuditData),
    })

    setEditingSubmissionId(submission.id)

    setSubmissionComments(submission.comments ?? [])
    lastSavedDraftKeyRef.current = restoredSnapshotKey
    setSelectedSampleId('')
    setDraftTitle(submission.title)
    setContent(submission.contentText)
    setImageFile(null)
    setImageAltText(submission.imageAltText ?? '')
    setAuditedImageAltText(
      submission.imageAuditData ? (submission.imageAltText ?? '') : null,
    )
    setImageAuditResult(submission.imageAuditData
      ? {
          ...submission.imageAuditData,
          auditReceiptId: submission.imageAuditReceiptId ?? undefined,
          asset: submission.imageUrl && submission.imagePublicId
            ? { secureUrl: submission.imageUrl, publicId: submission.imagePublicId }
            : submission.imageAuditData.asset,
        }
      : null)
        setImagePreviewUrl(
          submission.imageUrl ?? submission.imageAuditData?.asset?.secureUrl ?? null,
        )
    setImageAuditError(null)
    setCategoryFilter('ALL')
    setAuditError(null)
    setAuditResult({
      brand: submission.brandProfile,
      totalFindings: restoredFindings.length,
      findings: restoredFindings,
      semanticStatus: 'unavailable',
      auditReceiptId: submission.textAuditReceiptId ?? undefined,
    })
    setAuditedContent(submission.contentText)
    setAuditRestoredFromSubmission(true)
    setSaveDraftError(null)
    setSaveDraftMessage(null)
    setRouteDraftLoadedId(submission.id)
    navigate(`/submissions/${encodeURIComponent(submission.id)}/edit`)
  }

  const handleStartNewDraft = () => {
    setEditingSubmissionId(null)
    setSubmissionComments([])
    lastSavedDraftKeyRef.current = null
    setSelectedSampleId('')
    setDraftTitle('Untitled campaign')
    setDraftChannel('Website')
    setContent('')
    setImageFile(null)
    setImageAltText('')
    setImageAuditResult(null)
    setAuditedImageAltText(null)
    setImageAuditError(null)
    setAuditResult(null)
    setAuditedContent(null)
    setAuditRestoredFromSubmission(false)
    setSaveDraftError(null)
    setSaveDraftMessage(null)
    setActiveView('workspace')
  }

  if (!activeView) {
    return (
      <div className="bf-auth-screen">
        <div className="bf-auth-card">
          <span className="bf-auth-kicker">BRANDFLIGHT</span>
          <h1 className="bf-auth-title">Page not found</h1>
          <p className="bf-auth-subtitle">
            This BrandFlight URL does not match a known feature.
          </p>
          <button
            className="bf-auth-submit"
            type="button"
            onClick={() => setActiveView('workspace')}
          >
            Return to Text Audit
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bf-layout">
      {/* 1. Redesigned B2B SaaS Header */}
      <header className="bf-header">
        <div className="bf-header-container">
          <div className="bf-header-topline">
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
              <span className="bf-header-divider" aria-hidden="true" />
              <div className="bf-auth-user">
                <span className="bf-auth-user-name">
                  {authSession.user.name}
                </span>
                <span className="bf-auth-user-role">
                  {authSession.user.role}
                </span>
              </div>

              {DEMO_ACCESS_ENABLED && (
                <label className="bf-demo-role-switcher">
                  <span>Demo role</span>
                  <select
                    aria-label="Switch demo role"
                    value={authSession.user.role}
                    disabled={demoLoginBusyRole !== null}
                    onChange={(event) => void handleDemoLogin(event.target.value as AuthRole)}
                  >
                    <option value="CREATOR">Creator</option>
                    <option value="REVIEWER">Reviewer</option>
                    <option value="MANAGER">Manager</option>
                  </select>
                </label>
              )}
              {demoLoginError && DEMO_ACCESS_ENABLED && (
                <span className="bf-demo-switch-error" role="alert">{demoLoginError}</span>
              )}

              <button
                type="button"
                className="bf-nav-link bf-header-signout"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </div>
          </div>

          <nav className="bf-header-nav" aria-label="Primary navigation">
            {authSession.user.role === 'CREATOR' && (
              <>
                <button
                  type="button"
                  className={`bf-nav-link ${activeView === 'workspace' ? 'active' : ''}`}
                  onClick={() => setActiveView('workspace')}
                >
                  Audit Workspace
                </button>
                <button
                  type="button"
                  className={`bf-nav-link ${activeView === 'image' ? 'active' : ''}`}
                  onClick={() => setActiveView('image')}
                >
                  Image Audit
                </button>
                <button
                  type="button"
                  className={`bf-nav-link ${activeView === 'submissions' ? 'active' : ''} ${savedSubmissionsNudge && activeView !== 'submissions' ? 'bf-nav-link-next' : ''}`}
                  onClick={() => { setActiveView('submissions'); setSavedSubmissionsNudge(false) }}
                >
                  <span>Saved Submissions</span>
                  {savedSubmissionsNudge && activeView !== 'submissions' && (
                    <span className="bf-nav-next-badge">NEXT</span>
                  )}
                </button>
              </>
            )}

            {authSession.user.role === 'REVIEWER' && (
              <button
                type="button"
                className={`bf-nav-link ${activeView === 'review' ? 'active' : ''}`}
                onClick={() => setActiveView('review')}
              >
                Review Queue
              </button>
            )}

            {authSession.user.role === 'MANAGER' && (
              <>
                <button
                  type="button"
                  className={`bf-nav-link ${activeView === 'manager' ? 'active' : ''}`}
                  onClick={() => setActiveView('manager')}
                >
                  Manager Console
                </button>
                <button
                  type="button"
                  className={`bf-nav-link ${activeView === 'review' ? 'active' : ''}`}
                  onClick={() => setActiveView('review')}
                >
                  Review Queue
                </button>
                <button
                  type="button"
                  className={`bf-nav-link ${activeView === 'rulebook' ? 'active' : ''}`}
                  onClick={() => setActiveView('rulebook')}
                >
                  Brand Rulebook &amp; Facts
                </button>
              </>
            )}
            <button
              type="button"
              className={`bf-nav-link ${activeView === 'approved' ? 'active' : ''}`}
              onClick={() => setActiveView('approved')}
            >
              Approved Campaigns
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="bf-main">
        {activeView === 'workspace' || activeView === 'image' ? (
          <>
            {/* Page Heading & Preset Selector */}
            <section className="bf-page-bar">
              <div>
                <h1 className="bf-page-title">
                  {activeView === 'image'
                    ? 'Campaign Image & Alt-Text Audit'
                    : 'Pre-Publication Content Audit'}
                </h1>
                <p className="bf-page-subtitle">
                  {activeView === 'image'
                    ? 'Check campaign image colors against the approved brand palette and verify meaningful alt text.'
                    : 'Verify draft copy against approved product facts, terminology rules, and tone guidelines before publishing.'}
                </p>
                {routeSubmissionId && (
                  <button
                    type="button"
                    className="bf-btn-secondary"
                    style={{ marginTop: '12px' }}
                    onClick={() => navigate('/submissions', { replace: true })}
                  >
                    ← Back to Saved Submissions
                  </button>
                )}
              </div>

              {activeView === 'workspace' && !routeSubmissionId && !editingSubmissionId && (
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
              )}
            </section>

            <section className="bf-campaign-bundle" aria-label="Campaign bundle workflow">
              <div className="bf-campaign-bundle-intro">
                <span className="bf-campaign-bundle-eyebrow">ONE CAMPAIGN · TWO AUDITS</span>
                <h2>Campaign bundle</h2>
                <p>
                  Save text and image checks together in one submission. Reviewers and managers
                  can then inspect the copy, image preview, alt text, palette checks, and findings
                  from the same Review Queue record.
                </p>
                <p className="bf-campaign-bundle-note">
                  Switching tabs keeps the current workspace state. Save the draft, then open Saved
                  Submissions and choose Submit for Review. Unsaved changes are not persisted.
                </p>
              </div>
              <div className="bf-campaign-bundle-statuses">
                <div className="bf-campaign-status-item">
                  <span>Copy audit</span>
                  <strong className={auditResult && auditedContent === content ? 'is-ready' : 'is-pending'}>
                    {auditResult && auditedContent === content ? 'Ready to save' : 'Run audit'}
                  </strong>
                </div>
                <div className="bf-campaign-status-item">
                  <span>Image audit</span>
                  <strong
                    className={
                      imageAuditResult && auditedImageAltText === imageAltText
                        ? 'is-ready'
                        : imageFile || imageAuditResult
                          ? 'is-pending'
                          : ''
                    }
                  >
                    {imageAuditResult
                      ? auditedImageAltText === imageAltText
                        ? 'Ready to save'
                        : 'Alt text changed · re-audit'
                      : imageFile
                        ? 'Audit selected image'
                        : imagePreviewUrl
                          ? 'Image attached · no audit result'
                          : 'Optional · not added'}
                  </strong>
                </div>
                <div className="bf-campaign-status-item">
                  <span>Submission</span>
                  <strong>{editingSubmissionId ? 'Existing draft' : 'New · not saved'}</strong>
                </div>
              </div>
              <div className="bf-campaign-bundle-actions">
                <button
                  type="button"
                  className={activeView === 'image' ? 'bf-btn-secondary' : 'bf-btn-primary bf-campaign-open-image-button'}
                  title={activeView === 'image' ? 'Return to campaign copy' : 'Audit the campaign image and alt text'}
                  onClick={() => setActiveView(activeView === 'image' ? 'workspace' : 'image')}
                >
                  {activeView === 'image' ? '← Return to Text Audit' : 'Open Image Audit →'}
                </button>
              </div>
            </section>

            {/* 5. Sticky Two-Column Audit Workspace */}
            <div className={`bf-workspace ${activeView === 'image' ? 'bf-workspace-image-only' : ''}`} >
              {/* LEFT STICKY PANE: Editor + Compact Reference */}
              <div className="bf-left-sticky">
                {activeView === 'workspace' && (
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
                        onChange={(e) => {
                          setContent(e.target.value)
                          setGuidanceCopyFeedback(null)
                        }}
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
                          setEditingSubmissionId(null)
                          lastSavedDraftKeyRef.current = null
                          setSaveDraftError(null)
                          setSaveDraftMessage(null)
                          setDraftTitle(sample.title)
                          setDraftChannel(sample.channel)
                          setContent(sample.content)
                        }}
                      >
                        Reset draft
                      </button>

                      <button
                        type="button"
                        className="bf-btn-secondary"
                        onClick={handleSaveDraft}
                        disabled={
                          saveDraftBusy ||
                          isAuditing ||
                          refineBusy ||
                          !content.trim() ||
                          !auditResult ||
                          auditedContent !== content ||
                          authSession?.user.role !== 'CREATOR'
                        }
                      >
                        {saveDraftBusy ? 'Saving…' : 'Save Draft'}
                      </button>

                      <button
                        type="button"
                        className="bf-btn-secondary bf-refine-copy-button"
                        disabled={refineBusy || isAuditing || !content.trim() || authSession?.user.role !== 'CREATOR'}
                        onClick={() => void handleRefineCopy()}
                        title="Ask Gemini to refine the copy against the active brand rules and approved facts. A fresh audit is still required."
                      >
                        {refineBusy ? 'Refining copy…' : 'Refine copy'}
                      </button>

                      <button
                        type="submit"
                        className="bf-btn-primary"
                        disabled={isAuditing || refineBusy || !content.trim()}
                      >
                        {isAuditing ? 'Running audit...' : 'Run Preflight Audit'}
                      </button>
                    </div>

                    {refineError && <p className="bf-refine-copy-note error" role="alert">{refineError}</p>}
                    {refineMessage && <p className="bf-refine-copy-note" role="status">{refineMessage}</p>}

                    {saveDraftError && (
                      <p className="bf-save-feedback error" role="alert">
                        {saveDraftError}
                      </p>
                    )}


                  </div>
                </form>
                )}

{activeView === 'image' && (
                  <>
                {/* Campaign image and alt-text audit */}
                <form className="bf-card bf-image-audit-form" onSubmit={handleImageAuditSubmit}>
                  <div className="bf-card-header">
                    <div>
                      <h2 className="bf-section-title">Campaign Image Audit</h2>
                      <p className="bf-section-meta">PNG or JPEG · maximum 5 MB</p>
                    </div>
                  </div>

                  <div className="bf-card-body">
                    <div className="bf-field">
                      <label className="bf-label" htmlFor="bf-image-file">
                        Campaign image
                      </label>
                      <input
                        id="bf-image-file"
                        className="bf-image-file-input"
                        type="file"
                        disabled={isImageAuditing}
                        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                        aria-label="Choose a campaign image"
                        onChange={(event) => {
                          const selectedFile = event.currentTarget.files?.[0] ?? null
                          setImageFile(selectedFile)
                          setImageAuditResult(null)
                          setAuditedImageAltText(null)
                          setImageAuditError(null)

                          if (imageObjectUrlRef.current) {
                            URL.revokeObjectURL(imageObjectUrlRef.current)
                            imageObjectUrlRef.current = null
                          }

                          if (selectedFile) {
                            const url = URL.createObjectURL(selectedFile)
                            imageObjectUrlRef.current = url
                            setImagePreviewUrl(url)
                          } else {
                            setImagePreviewUrl(null)
                          }
                        }}
                      />
                      <label
                        htmlFor="bf-image-file"
                        className={`bf-image-preview-bar${imagePreviewUrl ? ' has-image' : ''}`}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            document.getElementById('bf-image-file')?.click()
                          }
                        }}
                      >
                        {imagePreviewUrl ? (
                          <>
                            <img
                              className="bf-image-preview-thumb"
                              src={imagePreviewUrl}
                              alt={imageAltText.trim() || imageAuditResult?.image.name || 'Campaign image preview'}
                            />
                            <span className="bf-image-preview-details">
                              <span className="bf-image-preview-eyebrow">
                                {imageFile ? 'NEW IMAGE SELECTED' : 'SAVED CAMPAIGN IMAGE'}
                              </span>
                              <strong className="bf-image-preview-name">
                                {imageFile?.name || imageAuditResult?.image.name || 'Campaign image'}
                              </strong>
                              <span className="bf-image-preview-help">
                                {imageFile
                                  ? `${(imageFile.size / (1024 * 1024)).toFixed(2)} MB · Audit again before saving`
                                  : 'Saved image · Click to replace'}
                              </span>
                            </span>
                            <span className="bf-image-change-pill">Change image</span>
                          </>
                        ) : (
                          <>
                            <span className="bf-image-upload-mark" aria-hidden="true">↥</span>
                            <span className="bf-image-preview-details">
                              <strong className="bf-image-preview-name">Add a campaign image</strong>
                              <span className="bf-image-preview-help">PNG or JPEG · Up to 5 MB</span>
                            </span>
                            <span className="bf-image-change-pill">Browse files</span>
                          </>
                        )}
                      </label>
                      <p className="bf-section-meta">
                        Click the preview to replace the image. A replacement must be audited before saving.
                      </p>
                    </div>

                    <div className="bf-field">
                      <label className="bf-label" htmlFor="bf-image-alt-text">
                        Image alt text
                      </label>
                      <textarea
                        id="bf-image-alt-text"
                        className="bf-textarea"
                        rows={3}
                        value={imageAltText}
                        disabled={isImageAuditing}
                        onChange={(event) => setImageAltText(event.target.value)}
                        placeholder="Describe the meaningful content of the campaign image..."
                      />
                      <p className="bf-section-meta">
                        Leave empty to test missing-alt-text detection.
                      </p>
                    </div>

                    <div className="bf-editor-actions bf-image-editor-actions">
                      <button
                        type="submit"
                        className="bf-btn-primary"
                        disabled={isImageAuditing || !imageFile}
                      >
                        {isImageAuditing ? 'Auditing image…' : 'Audit Image & Alt Text'}
                      </button>
                      <button
                        type="button"
                        className="bf-btn-secondary"
                        onClick={handleSaveDraft}
                        disabled={saveDraftBusy || isAuditing || isImageAuditing || authSession.user.role !== 'CREATOR'}
                      >
                        {saveDraftBusy ? 'Saving…' : 'Save Campaign Draft'}
                      </button>
                    </div>
                    <p className="bf-section-meta bf-image-save-help">
                      Save work in progress at any time. Run fresh Preflight and Image Audits before submitting for review. A newly selected image must be uploaded through Image Audit before it can be attached.
                    </p>
                    {saveDraftError && (
                      <p className="bf-save-feedback error" role="alert">{saveDraftError}</p>
                    )}


                    {!isImageAuditing && !imageAuditError && !imageAuditResult && (
                      <div className="bf-audit-empty-banner" role="status">
                        <span className="bf-audit-empty-icon" aria-hidden="true">▧</span>
                        <div className="bf-audit-empty-copy">
                          <strong>Ready to inspect your campaign image</strong>
                          <p>
                            {imageFile
                              ? 'Click Audit Image & Alt Text to check palette alignment and accessibility.'
                              : 'Choose a PNG or JPEG image, add meaningful alt text, then click Audit Image & Alt Text. Results will appear here.'}
                          </p>
                        </div>
                      </div>
                    )}

                    {isImageAuditing && (
                      <div className="bf-status-banner info" role="status">
                        <div className="bf-banner-body">
                          <div className="bf-banner-heading">Processing campaign image…</div>
                          <div>Extracting dominant colors and checking alternative text.</div>
                        </div>
                      </div>
                    )}

                    {imageAuditError && (
                      <div className="bf-status-banner error" role="alert">
                        <div className="bf-banner-body">
                          <div className="bf-banner-heading">Image audit failed</div>
                          <div>{imageAuditError}</div>
                        </div>
                      </div>
                    )}

                    {imageAuditResult && (
                      <div className="bf-image-audit-results">
                        <div
                          className={`bf-status-banner ${
                            imageAuditResult.totalFindings > 0 ? 'warn' : 'success'
                          }`}
                          role="status"
                        >
                          <div className="bf-banner-body">
                            <div className="bf-banner-heading">
                              {!imageAuditResult.image.colorAnalysis
                                ? 'Saved image audit restored — re-run to compare each dominant color'
                                : imageAuditResult.totalFindings === 0
                                  ? 'Image checks completed — no configured issues found'
                                  : `Review ${imageAuditResult.totalFindings} image finding(s)`}
                            </div>
                            <div>
                              {imageAuditResult.image.name}
                              {imageAuditResult.image.width && imageAuditResult.image.height
                                ? ` · ${imageAuditResult.image.width} × ${imageAuditResult.image.height}px`
                                : ''}
                              {' · '}Alt text: {imageAuditResult.image.altTextLength} characters
                            </div>
                          </div>
                        </div>

                        <div className="bf-image-audit-metrics" aria-label="Image audit summary">
                          <div className="bf-image-audit-metric">
                            <span>Palette check</span>
                            <strong className={imageAuditResult.image.approvedColors.length === 0 ? 'needs-review' : imageAuditResult.image.colorAnalysis?.some((item) => !item.matchesPalette) ? 'needs-review' : imageAuditResult.image.colorAnalysis ? 'passed' : 'needs-review'}>
                              {imageAuditResult.image.approvedColors.length === 0
                                ? 'Not configured'
                                : !imageAuditResult.image.colorAnalysis
                                  ? 'Re-audit needed'
                                  : imageAuditResult.image.colorAnalysis.some((item) => !item.matchesPalette)
                                    ? 'Review colors'
                                    : 'Within tolerance'}
                            </strong>
                            <small>
                              {imageAuditResult.image.colorAnalysis
                                ? `${imageAuditResult.image.colorAnalysis.filter((item) => item.matchesPalette).length} of ${imageAuditResult.image.colorAnalysis.length} dominant colors matched`
                                : 'Per-color results require a fresh audit'}
                            </small>
                          </div>
                          <div className="bf-image-audit-metric">
                            <span>Alt-text check</span>
                            <strong className={imageAuditResult.findings.some((finding) => finding.category === 'ACCESSIBILITY') ? 'needs-review' : 'passed'}>
                              {imageAuditResult.findings.some((finding) => finding.category === 'ACCESSIBILITY') ? 'Needs review' : 'Basic checks passed'}
                            </strong>
                            <small>Presence, configured length, and generic-label checks; review meaning in context.</small>
                          </div>
                          <div className="bf-image-audit-metric">
                            <span>Findings</span>
                            <strong className={imageAuditResult.totalFindings > 0 ? 'needs-review' : 'passed'}>{imageAuditResult.totalFindings}</strong>
                            <small>Rule-based checks only; not a full WCAG or image-understanding audit</small>
                          </div>
                        </div>

                        {imageAuditResult.logoVerification && (
                          <section className={`bf-logo-verification-card outcome-${imageAuditResult.logoVerification.outcome.toLowerCase()}`} aria-label="Brand logo verification">
                            <div className="bf-logo-verification-heading">
                              <div><span className="bf-logo-verification-eyebrow">OFFICIAL BRAND ASSET</span><h3>Logo verification</h3></div>
                              <span className={`bf-logo-verification-badge outcome-${imageAuditResult.logoVerification.outcome.toLowerCase()}`}>
                                {imageAuditResult.logoVerification.outcome === 'NOT_CONFIGURED' ? 'Not configured' : imageAuditResult.logoVerification.outcome.replace(/_/g, ' ')}
                              </span>
                            </div>
                            {imageAuditResult.logoVerification.referenceLogo && (
                              <div className="bf-logo-reference-row">
                                <img src={imageAuditResult.logoVerification.referenceLogo.secureUrl} alt={`Approved reference: ${imageAuditResult.logoVerification.referenceLogo.name}`} />
                                <div><strong>{imageAuditResult.logoVerification.referenceLogo.name}</strong><p>{imageAuditResult.logoVerification.referenceLogo.expectedWordmark ? `Expected wordmark: ${imageAuditResult.logoVerification.referenceLogo.expectedWordmark}` : 'No expected wordmark configured'}</p><small>{imageAuditResult.logoVerification.required ? 'Logo required' : 'Logo optional'} · {imageAuditResult.logoVerification.confidence.toLowerCase()} confidence</small></div>
                              </div>
                            )}
                            <p className="bf-logo-verification-summary">{imageAuditResult.logoVerification.summary}</p>
                            <div className="bf-logo-check-grid">
                              <span><small>Logo detected</small><strong>{imageAuditResult.logoVerification.outcome === 'NOT_CONFIGURED' ? 'Not checked' : imageAuditResult.logoVerification.outcome === 'NEEDS_REVIEW' ? 'Needs review' : imageAuditResult.logoVerification.logoDetected ? 'Yes' : 'No'}</strong></span>
                              <span><small>Wordmark</small><strong>{imageAuditResult.logoVerification.wordmarkStatus.replace(/_/g, ' ')}</strong></span>
                              <span><small>Logo colors</small><strong>{imageAuditResult.logoVerification.colorStatus.replace(/_/g, ' ')}</strong></span>
                              <span><small>Integrity</small><strong>{imageAuditResult.logoVerification.integrityStatus.replace(/_/g, ' ')}</strong></span>
                            </div>
                            {imageAuditResult.logoVerification.evidence.length > 0 && <ul className="bf-logo-verification-list">{imageAuditResult.logoVerification.evidence.map((item, index) => <li key={`logo-evidence-${index}`}>{item}</li>)}</ul>}
                            {imageAuditResult.logoVerification.suggestions.length > 0 && <ul className="bf-logo-verification-list suggestions">{imageAuditResult.logoVerification.suggestions.map((item, index) => <li key={`logo-suggestion-${index}`}>{item}</li>)}</ul>}
                          </section>
                        )}

                        <div className="bf-field">
                          <span className="bf-label">Dominant colors compared with the approved palette</span>
                          <p className="bf-image-audit-help">The five most common extracted colors are compared with the nearest approved brand color. A match means RGB distance is within the current tolerance; it does not prove overall brand compliance.</p>
                          {imageAuditResult.image.colorAnalysis ? (
                            <div className="bf-color-audit-list">
                              {imageAuditResult.image.colorAnalysis.map((item) => (
                                <div className={`bf-color-audit-item ${!item.nearestApprovedColor ? 'is-no-palette' : item.matchesPalette ? 'is-match' : 'is-off-palette'}`} key={item.color}>
                                  <span className="bf-swatch-color" style={{ backgroundColor: item.color }} />
                                  <div className="bf-color-audit-copy">
                                    <strong>{item.color}</strong>
                                    <span>{!item.nearestApprovedColor ? 'No approved palette configured' : item.matchesPalette ? 'Within palette tolerance' : 'Outside palette tolerance'}</span>
                                  </div>
                                  <div className="bf-color-audit-nearest">
                                    <small>Nearest approved</small>
                                    <strong>{item.nearestApprovedColor ?? 'No palette'}</strong>
                                    {item.distance !== null && <small>RGB distance: {item.distance}</small>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="bf-image-audit-legacy-note" role="status">
                              This is a previously saved audit without per-color comparison results. Run Image Audit again to evaluate each dominant color.
                              <div className="bf-swatch-list" style={{ marginTop: '8px' }}>
                                {imageAuditResult.image.dominantColors.map((color) => (
                                  <div className="bf-swatch-item" key={color}>
                                    <span className="bf-swatch-color" style={{ backgroundColor: color }} />
                                    <code>{color}</code>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="bf-field">
                          <span className="bf-label">Approved brand palette</span>
                          <div className="bf-swatch-list" style={{ marginTop: '8px' }}>
                            {imageAuditResult.image.approvedColors.length > 0 ? (
                              imageAuditResult.image.approvedColors.map((color) => (
                                <div className="bf-swatch-item" key={color}>
                                  <span
                                    className="bf-swatch-color"
                                    style={{ backgroundColor: color }}
                                  />
                                  <code>{color}</code>
                                </div>
                              ))
                            ) : (
                              <span className="bf-section-meta">
                                No valid approved colors configured.
                              </span>
                            )}
                          </div>
                        </div>

                        {imageAuditResult.findings.map((finding, index) => (
                          <article
                            className={`bf-finding-card severity-${finding.severity}`}
                            key={`${finding.ruleCode}-${finding.title}-${index}`}
                          >
                            <div className="bf-finding-meta">
                              <div className="bf-finding-tags">
                                <span className="bf-rule-tag">{finding.ruleCode}</span>
                                <span
                                  className={`bf-severity-indicator bf-severity-${finding.severity}`}
                                >
                                  {finding.category} · {finding.severity}
                                </span>
                              </div>
                              <span className="bf-source-meta">{finding.confidence}</span>
                            </div>
                            <h3 className="bf-finding-title">{finding.title}</h3>
                            <p className="bf-finding-desc">{finding.message}</p>
                            <div className="bf-evidence-container">
                              <div className="bf-evidence-row">
                                <span className="bf-evidence-label">Evidence:</span>
                                <span>{finding.evidence}</span>
                              </div>
                              <div className="bf-evidence-row">
                                <span className="bf-evidence-label">Guidance:</span>
                                <span>{finding.suggestion}</span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </form>
                  </>
                )}

                {/* Compact Approved Facts Drawer */}
                {activeView === 'workspace' && (
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
                )}
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
                          <strong>{consolidatedFindings.length}</strong> consolidated{' '}
                          {consolidatedFindings.length === 1 ? 'issue' : 'issues'}
                        </span>
                        <span>•</span>
                        <span>
                          <strong>{auditResult.totalFindings}</strong> total checks
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="bf-card-body">
                    {!isAuditing && !auditError && !auditResult && (
                      <div className="bf-audit-empty-banner" role="status">
                        <span className="bf-audit-empty-icon" aria-hidden="true">✦</span>
                        <div className="bf-audit-empty-copy">
                          <strong>Ready for preflight</strong>
                          <p>
                            Run <b>Preflight Audit</b> to check terminology, claims, approved
                            product facts, and tone. Your findings and suggested fixes will appear here.
                          </p>
                        </div>
                      </div>
                    )}

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
                        {auditRestoredFromSubmission ? (
                          <div className="bf-status-banner success">
                            <div className="bf-banner-body">
                              <div className="bf-banner-heading">
                                <span>Saved audit findings restored</span>
                              </div>
                              <div>
                                Showing the findings saved with this draft. No new audit was run.
                              </div>
                            </div>
                          </div>
                        ) : auditResult.semanticStatus === 'completed' ? (
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

                        {guidanceCopyFeedback?.message.startsWith('Suggestion applied') && (
                          <div className="bf-suggestion-applied-note" role="status">
                            <span className="bf-suggestion-applied-mark" aria-hidden="true">✓</span>
                            <span>{guidanceCopyFeedback.message} The finding was removed from active issues. Run Preflight Audit again before saving.</span>
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
                            {filteredFindings.map((group) => (
                              <article key={group.id} className={`bf-finding-card severity-${group.severity}`}>
                                <div className="bf-finding-meta">
                                  <div className="bf-finding-tags">
                                    {group.ruleCodes.map((code) => <span key={code} className="bf-rule-tag">{code}</span>)}
                                    <span className={`bf-severity-indicator bf-severity-${group.severity}`}>
                                      {group.category.charAt(0) + group.category.slice(1).toLowerCase()} • {group.severity.charAt(0) + group.severity.slice(1).toLowerCase()}
                                    </span>
                                  </div>
                                  <span className="bf-source-meta">
                                    {group.matches.length > 1 ? `${group.matches.length} flagged phrases` : group.matches[0]?.confidence ?? group.confidences[0]}
                                  </span>
                                </div>

                                <h3 className="bf-finding-title">{group.title}</h3>
                                <p className="bf-finding-desc">{group.message}</p>

                                <div className="bf-finding-occurrences">
                                  {group.matches.map((match) => {
                                    const feedbackId = occurrenceFeedbackId(group, match)
                                    const overrideRequested = hasOverrideRequest(group, match)
                                    const feedback = guidanceCopyFeedback?.groupId === feedbackId ? guidanceCopyFeedback : null
                                    return (
                                      <section className="bf-finding-occurrence" key={`${group.id}-${match.evidence}`}>
                                        <div className="bf-evidence-container">
                                          <div className="bf-evidence-row">
                                            <span className="bf-evidence-label">Flagged text:</span>
                                            <div className="bf-evidence-chips">
                                              <button type="button" className="bf-evidence-chip" title="Highlight this exact phrase in the editor" onClick={() => handleFocusEvidence(match.evidence)}>
                                                &ldquo;{match.evidence}&rdquo;
                                              </button>
                                              <span className="bf-source-meta">{match.confidence}</span>
                                            </div>
                                          </div>
                                          <div className="bf-evidence-row">
                                            <span className="bf-evidence-label">Guidance:</span>
                                            <span style={{ flex: 1, color: 'var(--text-heading)' }}>{match.suggestion || group.suggestion}</span>
                                          </div>
                                        </div>

                                        <div className="bf-finding-actions">
                                          <button type="button" className="bf-btn-action primary" onClick={() => handleFocusEvidence(match.evidence)}>Locate in editor</button>
                                          {match.originalSpan?.trim() && match.suggestedSpan?.trim() && (
                                            <button type="button" className="bf-btn-action primary" disabled={auditedContent !== content || refineBusy} title={auditedContent !== content ? 'Run Preflight Audit again before applying this suggestion.' : 'Replace this exact flagged phrase in the editor.'} onClick={() => handleApplySuggestion(group, match)}>Apply suggestion</button>
                                          )}
                                          <button type="button" className="bf-btn-action" onClick={() => void handleCopyGuidance(group, match)}>
                                            {feedback?.message.startsWith('Guidance copied') && !feedback.isError ? 'Guidance copied' : 'Copy guidance'}
                                          </button>
                                          {overrideRequested ? (
                                            <span className="bf-override-request-status" role="status">Override requested</span>
                                          ) : (
                                            <button type="button" className="bf-btn-action" onClick={() => handleOpenOverrideRequest(group, match)} title={!editingSubmissionId ? 'Save this campaign as a draft first.' : 'Ask a reviewer or manager to consider an exception for this phrase.'}>Request override</button>
                                          )}
                                        </div>
                                        {feedback && (
                                          <p className={`bf-guidance-copy-feedback${feedback.isError ? ' error' : ''}`} role={feedback.isError ? 'alert' : 'status'}>
                                            {feedback.message}
                                          </p>
                                        )}
                                      </section>
                                    )
                                  })}
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Persisted feedback from the real review workflow */}
                {routeSubmissionId && reviewerComments.length > 0 && (
<div className="bf-card bf-creator-feedback">
                  <div className="bf-card-header">
                    <div>
                      <h2 className="bf-section-title">Reviewer Feedback</h2>
                      <p className="bf-section-meta">
                        Comments from the Review Queue. These notes are saved with this submission.
                      </p>
                    </div>
                    {reviewerComments.length > 0 && (
                      <span className="bf-feedback-count">
                        {reviewerComments.length} {reviewerComments.length === 1 ? 'note' : 'notes'}
                      </span>
                    )}
                  </div>

                  <div className="bf-card-body">
                    {reviewerComments.length > 0 ? (
                      <div className="bf-creator-feedback-list">
                        {reviewerComments.map((comment) => (
                          <article className="bf-creator-feedback-item" key={comment.id}>
                            <div className="bf-creator-feedback-heading">
                              <strong>{comment.author?.name ?? 'Reviewer'}</strong>
                              <span className="bf-creator-feedback-role">
                                {comment.author?.role ?? 'REVIEWER'}
                              </span>
                            </div>
                            <p className="bf-creator-feedback-note">{comment.body}</p>
                            <time
                              className="bf-creator-feedback-time"
                              dateTime={comment.createdAt}
                            >
                              {new Date(comment.createdAt).toLocaleString()}
                            </time>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="bf-creator-feedback-empty">
                        <span className="bf-creator-feedback-empty-mark" aria-hidden="true">✓</span>
                        <div>
                          <strong>No reviewer feedback yet</strong>
                          <p>
                            When a reviewer requests changes or leaves a note, it will appear here.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )}
              </div>
            </div>
          </>
        ) : activeView === 'rulebook' ? (
          <RulebookPanel
            apiBaseUrl={API_BASE_URL}
            brandProfileId={BRAND_PROFILE_ID}
            onBrandLoaded={setBrandProfile}
          />
        ) : activeView === 'manager' && authSession.user.role === 'MANAGER' ? (
          <ManagerDashboard
            apiBaseUrl={API_BASE_URL}
            token={authSession.token}
            onOpenReviewQueue={() => setActiveView('review')}
            onOpenRulebook={() => setActiveView('rulebook')}
            onOpenSubmission={handleManagerOpenSubmission}
          />
        ) : activeView === 'submissions' && authSession.user.role === 'CREATOR' ? (
          <SavedSubmissionsPanel
            apiBaseUrl={API_BASE_URL}
            token={authSession.token}
            onOpenDraft={handleOpenSavedDraft}
            onNewDraft={handleStartNewDraft}
          />
        ) : activeView === 'approved' ? (
          <ApprovedCampaignsPanel
            apiBaseUrl={API_BASE_URL}
            token={authSession.token}
          />
        ) : (
          <ReviewQueuePanel
            apiBaseUrl={API_BASE_URL}
            token={authSession.token}
            initialSubmissionId={pendingManagerSubmissionId}
            onInitialSelectionHandled={handleInitialReviewSelectionHandled}
          />
        )}
      </main>
      {saveDraftMessage && (
        <div className="bf-toast bf-toast-success" role="status" aria-live="polite">
          <span className="bf-toast-icon" aria-hidden="true">✓</span>
          <div className="bf-toast-copy">
            <strong>{saveDraftMessage.startsWith('This draft is already saved') ? 'Already saved' : saveDraftMessage.startsWith('Draft updated') ? 'Draft updated' : 'Draft saved'}</strong>
            <p>{saveDraftMessage}</p>
          </div>
          <button type="button" className="bf-toast-dismiss" aria-label="Dismiss notification" onClick={() => setSaveDraftMessage(null)}>×</button>
        </div>
      )}
      {overrideTarget && (
        <div className="bf-override-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !overrideBusy) setOverrideTarget(null) }}>
          <section className="bf-override-dialog" role="dialog" aria-modal="true" aria-labelledby="bf-override-title">
            <div className="bf-override-dialog-header">
              <span className="bf-override-eyebrow">BRAND GOVERNANCE</span>
              <h2 id="bf-override-title">Request an override</h2>
              <p>This asks a reviewer or manager to consider an exception. It does not clear the finding or bypass the audit.</p>
            </div>
            <div className="bf-override-context">
              <strong>{overrideTarget.title}</strong>
              <span>Rule(s): {overrideTarget.ruleCodes.join(', ')}</span>
              {overrideTarget.evidences.length > 0 && <p>Flagged evidence: {overrideTarget.evidences.join(' / ')}</p>}
            </div>
            <form className="bf-override-form" onSubmit={(event) => void handleSubmitOverrideRequest(event)}>
              <label htmlFor="bf-override-reason">Why should this finding be reviewed for an exception?</label>
              <textarea id="bf-override-reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} minLength={15} maxLength={2000} rows={5} required placeholder="Explain the campaign context, why the rule may not apply, and any supporting evidence." disabled={overrideBusy} />
              <p className="bf-override-help">The request will be saved in this campaign's discussion and visible to reviewers/managers.</p>
              {overrideError && <p className="bf-override-error" role="alert">{overrideError}</p>}
              <div className="bf-override-actions">
                <button type="button" className="bf-btn-secondary" onClick={() => setOverrideTarget(null)} disabled={overrideBusy}>Cancel</button>
                <button type="submit" className="bf-btn-primary" disabled={overrideBusy || overrideReason.trim().length < 15}>{overrideBusy ? 'Sending request…' : 'Send override request'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      <Outlet />
    </div>
  )
}

export default App