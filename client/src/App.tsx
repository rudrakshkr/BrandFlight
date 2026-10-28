import { useState, useEffect, useCallback, useMemo, useRef, type SubmitEvent, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import type { ImageAuditData as ImageAuditApiResponse } from './types/imageAudit'
import RulebookPanel, { type BrandProfileData } from './RulebookPanel'
import SavedSubmissionsPanel, { type SubmissionDetail } from './SavedSubmissionsPanel'
import ReviewQueuePanel from './ReviewQueuePanel'

type RuleCategory = 'TONE' | 'TERMINOLOGY' | 'CLAIM' | 'VISUAL' | 'ACCESSIBILITY'
type FindingSeverity = 'INFO' | 'WARNING' | 'ERROR'
type ActiveView = 'workspace' | 'image' | 'rulebook' | 'submissions' | 'review'

const ROUTE_BY_VIEW: Record<ActiveView, string> = {
  workspace: '/audit/text',
  image: '/audit/image',
  rulebook: '/rulebook',
  submissions: '/submissions',
  review: '/review',
}

const VIEW_BY_PATH: Record<string, ActiveView> = {
  '/': 'workspace',
  '/login': 'workspace',
  '/audit/text': 'workspace',
  '/audit/image': 'image',
  '/rulebook': 'rulebook',
  '/submissions': 'submissions',
  '/review': 'review',
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
      altTextLength: data.image.altTextLength,
    },
    totalFindings: data.totalFindings,
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

  const activeView = routeSubmissionId
    ? 'workspace'
    : VIEW_BY_PATH[routePath]
  const setActiveView = useCallback((view: ActiveView) => {
    navigate(ROUTE_BY_VIEW[view])
  }, [navigate])

  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const [authChecking, setAuthChecking] = useState(
    () => Boolean(window.sessionStorage.getItem('brandflight_token')),
  )
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [editingSubmissionId, setEditingSubmissionId] = useState<string | null>(null)
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
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditResult, setAuditResult] = useState<AuditApiResponse | null>(null)
  const [auditRestoredFromSubmission, setAuditRestoredFromSubmission] = useState(false)
  const [auditedContent, setAuditedContent] = useState<string | null>(null)
  const [saveDraftBusy, setSaveDraftBusy] = useState(false)
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null)
  const [saveDraftMessage, setSaveDraftMessage] = useState<string | null>(null)
  const saveInProgressRef = useRef(false)
  const lastSavedDraftKeyRef = useRef<string | null>(null)
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

    if (routePath === '/' || routePath === '/login') {
      navigate('/audit/text', { replace: true })
      return
    }

    if (routeSubmissionId && authSession.user.role !== 'CREATOR') {
      navigate('/audit/text', { replace: true })
      return
    }

    if (!activeView) return

    if (
      activeView === 'submissions' &&
      authSession.user.role !== 'CREATOR'
    ) {
      navigate('/audit/text', { replace: true })
      return
    }

    if (
      activeView === 'review' &&
      authSession.user.role === 'CREATOR'
    ) {
      navigate('/audit/text', { replace: true })
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
          ruleCode: finding.ruleCode ?? '',
          confidence: finding.confidence ?? '',
        }))

        const restoredSnapshotKey = JSON.stringify({
          title: submission.title.trim(),
          content: submission.contentText,
          findings: restoredFindings,
          imageName: submission.imageName ?? null,
          imageAssetId: submission.imagePublicId ?? null,
          imageAltText: submission.imageAltText ?? null,
          imageAudit: imageAuditSnapshot(submission.imageAuditData),
        })

        if (cancelled) return

        setEditingSubmissionId(submission.id)
        lastSavedDraftKeyRef.current = restoredSnapshotKey
        setSelectedSampleId('')
        setDraftTitle(submission.title)
        setDraftChannel('Website')
        setContent(submission.contentText)
        setImageFile(null)
        setImageAltText(submission.imageAltText ?? '')
        setImageAuditResult(
          submission.imageAuditData
            ? {
                ...submission.imageAuditData,
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
        setResolvedGroups({})
        setAuditError(null)
        setAuditResult({
          brand: submission.brandProfile,
          totalFindings: restoredFindings.length,
          findings: restoredFindings,
          semanticStatus: 'unavailable',
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
    setResolvedGroups({})
    setSessionDecision({ status: 'NONE', note: '', timestamp: null })

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

    try {
      const formData = new FormData()
      formData.append('brandProfileId', BRAND_PROFILE_ID)
      formData.append('altText', imageAltText)
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
      setActiveView('workspace')
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Unable to log in.',
      )
    } finally {
      setLoginBusy(false)
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

          {loginError && (
            <p className="bf-auth-error" role="alert">
              {loginError}
            </p>
          )}

          <button
            className="bf-auth-submit"
            type="submit"
            disabled={loginBusy}
          >
            {loginBusy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="bf-auth-footnote">
            Use one of the configured BrandFlight demo accounts.
          </p>
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

    if (!auditResult || auditedContent !== content) {
      setSaveDraftError(
        'Run Preflight Audit on the current copy before saving.',
      )
      return
    }

    if (auditResult.findings.length > 20) {
      setSaveDraftError(
        'This draft has more than 20 findings. The API currently allows up to 20.',
      )
      return
    }

    if (imageFile && !imageAuditResult) {
      setSaveDraftError(
        'Run the image audit before saving the newly selected image.',
      )
      return
    }

    if (
      imageAuditResult &&
      imageAuditResult.image.altTextLength !== imageAltText.length
    ) {
      setSaveDraftError(
        'The alt text changed after its image audit. Re-select the image and run the image audit again before saving.',
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

    const snapshotKey = JSON.stringify({
      title: draftTitle.trim(),
      content,
      findings: auditResult.findings,
      imageName: imageAuditResult?.image.name ?? null,
      imageAssetId: imageAuditResult?.asset?.publicId ?? null,
      imageAltText: imageAuditResult ? imageAltText : null,
      imageAudit: imageAuditSnapshot(imageAuditResult),
    })

    if (lastSavedDraftKeyRef.current === snapshotKey) {
      setSaveDraftMessage('This exact draft has already been saved.')
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
          findings: auditResult.findings,
          ...(imageAuditResult
            ? {
                imageName: imageAuditResult.image.name,
                imageAltText: imageAltText.trim() || null,
                imageAuditData: imageAuditSnapshot(imageAuditResult),
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
        navigate(`/submissions/${encodeURIComponent(data.submission.id)}/edit`)
      }
      setSaveDraftMessage(
        `Draft ${isUpdating ? 'updated' : 'saved'} successfully. Status: ${data.submission.status}. ID: ${data.submission.id}`,
      )
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
      ruleCode: finding.ruleCode ?? '',
      confidence: finding.confidence ?? '',
    }))

    const restoredSnapshotKey = JSON.stringify({
      title: submission.title.trim(),
      content: submission.contentText,
      findings: restoredFindings,
      imageName: submission.imageName ?? null,
      imageAltText: submission.imageAltText ?? null,
      imageAudit: imageAuditSnapshot(submission.imageAuditData),
    })

    setEditingSubmissionId(submission.id)
    lastSavedDraftKeyRef.current = restoredSnapshotKey
    setSelectedSampleId('')
    setDraftTitle(submission.title)
    setContent(submission.contentText)
    setImageFile(null)
    setImageAltText(submission.imageAltText ?? '')
    setImageAuditResult(submission.imageAuditData ?? null)
        setImagePreviewUrl(
          submission.imageUrl ?? submission.imageAuditData?.asset?.secureUrl ?? null,
        )
    setImageAuditError(null)
    setCategoryFilter('ALL')
    setResolvedGroups({})
    setAuditError(null)
    setAuditResult({
      brand: submission.brandProfile,
      totalFindings: restoredFindings.length,
      findings: restoredFindings,
      semanticStatus: 'unavailable',
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
    lastSavedDraftKeyRef.current = null
    setSelectedSampleId('')
    setDraftTitle('Untitled campaign')
    setDraftChannel('Website')
    setContent('')
    setImageFile(null)
    setImageAltText('')
    setImageAuditResult(null)
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
              className={`bf-nav-link ${activeView === 'image' ? 'active' : ''}`}
              onClick={() => setActiveView('image')}
            >
              Image Audit
            </button>
            <button
              type="button"
              className={`bf-nav-link ${activeView === 'rulebook' ? 'active' : ''}`}
              onClick={() => setActiveView('rulebook')}
            >
              Brand Rulebook &amp; Facts
            </button>
            {authSession.user.role === 'CREATOR' ? (
              <button
                type="button"
                className={`bf-nav-link ${activeView === 'submissions' ? 'active' : ''}`}
                onClick={() => setActiveView('submissions')}
              >
                Saved Submissions
              </button>
            ) : (
              <button
                type="button"
                className={`bf-nav-link ${activeView === 'review' ? 'active' : ''}`}
                onClick={() => setActiveView('review')}
              >
                Review Queue
              </button>
            )}
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
            <span className="bf-header-divider" aria-hidden="true" />
            <div className="bf-auth-user">
              <span className="bf-auth-user-name">
                {authSession.user.name}
              </span>
              <span className="bf-auth-user-role">
                {authSession.user.role}
              </span>
            </div>

            <button
              type="button"
              className="bf-nav-link"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
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

              {activeView === 'workspace' && (
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
                          !content.trim() ||
                          !auditResult ||
                          auditedContent !== content ||
                          authSession?.user.role !== 'CREATOR'
                        }
                      >
                        {saveDraftBusy ? 'Saving…' : 'Save Draft'}
                      </button>

                      <button
                        type="submit"
                        className="bf-btn-primary"
                        disabled={isAuditing || !content.trim()}
                      >
                        {isAuditing ? 'Running audit...' : 'Run Preflight Audit'}
                      </button>
                    </div>

                    {saveDraftError && (
                      <p className="bf-save-feedback error" role="alert">
                        {saveDraftError}
                      </p>
                    )}

                    {saveDraftMessage && (
                      <p className="bf-save-feedback success" role="status">
                        {saveDraftMessage}
                      </p>
                    )}
                  </div>
                </form>
                )}

                {/* Campaign image and alt-text audit */}
                <form className="bf-card" onSubmit={handleImageAuditSubmit}>
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
                        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                        aria-label="Choose a campaign image"
                        onChange={(event) => {
                          const selectedFile = event.currentTarget.files?.[0] ?? null
                          setImageFile(selectedFile)
                          setImageAuditResult(null)
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
                        onChange={(event) => setImageAltText(event.target.value)}
                        placeholder="Describe the meaningful content of the campaign image..."
                      />
                      <p className="bf-section-meta">
                        Leave empty to test missing-alt-text detection.
                      </p>
                    </div>

                    <div className="bf-editor-actions">
                      <button
                        type="submit"
                        className="bf-btn-primary"
                        disabled={isImageAuditing || !imageFile}
                      >
                        {isImageAuditing ? 'Auditing image…' : 'Audit Image & Alt Text'}
                      </button>
                    </div>

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
                              {imageAuditResult.totalFindings === 0
                                ? 'No image or alt-text issues detected'
                                : `${imageAuditResult.totalFindings} image finding(s)`}
                            </div>
                            <div>
                              {imageAuditResult.image.name}
                              {imageAuditResult.image.width && imageAuditResult.image.height
                                ? ` · ${imageAuditResult.image.width} × ${imageAuditResult.image.height}px`
                                : ''}
                              {' · '}
                              Alt text: {imageAuditResult.image.altTextLength} characters
                            </div>
                          </div>
                        </div>

                        <div className="bf-field">
                          <span className="bf-label">Extracted dominant colors</span>
                          <div className="bf-swatch-list" style={{ marginTop: '8px' }}>
                            {imageAuditResult.image.dominantColors.map((color) => (
                              <div className="bf-swatch-item" key={color}>
                                <span
                                  className="bf-swatch-color"
                                  style={{ backgroundColor: color }}
                                />
                                <code>{color}</code>
                              </div>
                            ))}
                          </div>
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
        ) : activeView === 'rulebook' ? (
          <RulebookPanel
            apiBaseUrl={API_BASE_URL}
            brandProfileId={BRAND_PROFILE_ID}
            onBrandLoaded={setBrandProfile}
            onBack={() => setActiveView('workspace')}
          />
        ) : activeView === 'submissions' && authSession.user.role === 'CREATOR' ? (
          <SavedSubmissionsPanel
            apiBaseUrl={API_BASE_URL}
            token={authSession.token}
            onOpenDraft={handleOpenSavedDraft}
            onNewDraft={handleStartNewDraft}
          />
        ) : (
          <ReviewQueuePanel
            apiBaseUrl={API_BASE_URL}
            token={authSession.token}
          />
        )}
      </main>
      <Outlet />
    </div>
  )
}

export default App