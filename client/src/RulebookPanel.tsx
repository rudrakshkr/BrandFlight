import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'

export type RuleCategory =
  | 'TONE'
  | 'TERMINOLOGY'
  | 'CLAIM'
  | 'VISUAL'
  | 'ACCESSIBILITY'

export interface RulebookRule {
  id: string
  ruleCode: string
  category: RuleCategory
  title: string
  description: string
  pattern: string | null
  isActive: boolean
}

export interface ApprovedFact {
  id: string
  factCode: string
  claim: string
  sourceLabel: string
  sourceUrl: string | null
  isActive: boolean
}

export interface ApprovedBrandAsset {
  id: string
  assetType: string
  name: string
  format: string
  secureUrl: string
  publicId: string
  expectedWordmark: string | null
  description: string | null
  isRequired: boolean
}

export interface BrandProfileData {
  id: string
  name: string
  description: string | null
  brandColors: string[]
  rules: RulebookRule[]
  facts: ApprovedFact[]
  assets: ApprovedBrandAsset[]
}

interface RulebookPanelProps {
  apiBaseUrl: string
  brandProfileId: string
  onBrandLoaded: (brand: BrandProfileData) => void
}

interface RuleDraft {
  ruleCode: string
  category: RuleCategory
  title: string
  description: string
  pattern: string
}

interface FactDraft {
  factCode: string
  claim: string
  sourceLabel: string
  sourceUrl: string
}

const CATEGORIES: RuleCategory[] = [
  'TONE',
  'TERMINOLOGY',
  'CLAIM',
  'VISUAL',
  'ACCESSIBILITY',
]

const EMPTY_RULE: RuleDraft = {
  ruleCode: '',
  category: 'TERMINOLOGY',
  title: '',
  description: '',
  pattern: '',
}

const EMPTY_FACT: FactDraft = {
  factCode: '',
  claim: '',
  sourceLabel: 'Approved product facts',
  sourceUrl: '',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

async function apiRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  const token = window.sessionStorage.getItem('brandflight_token')

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers,
  })

  const data: unknown =
    response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : `Request failed with HTTP ${response.status}`

    throw new Error(message)
  }

  return data as T
}

export default function RulebookPanel({
  apiBaseUrl,
  brandProfileId,
  onBrandLoaded,
}: RulebookPanelProps) {
  const basePath = `/api/brands/${encodeURIComponent(brandProfileId)}`

  const [brand, setBrand] = useState<BrandProfileData | null>(null)
  const [brandName, setBrandName] = useState('')
  const [description, setDescription] = useState('')
  const [colorsText, setColorsText] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoWordmark, setLogoWordmark] = useState('')
  const [logoDescription, setLogoDescription] = useState('')
  const [logoRequired, setLogoRequired] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)

  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(EMPTY_RULE)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)

  const [factDraft, setFactDraft] = useState<FactDraft>(EMPTY_FACT)
  const [editingFactId, setEditingFactId] = useState<string | null>(null)

  const [importText, setImportText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadBrand = useCallback(async (): Promise<BrandProfileData | null> => {
    setIsLoading(true)
    setError('')

    try {
      const result = await apiRequest<BrandProfileData>(
        apiBaseUrl,
        basePath,
      )

      setBrand(result)
      setBrandName(result.name)
      setDescription(result.description ?? '')
      setColorsText(result.brandColors.join(', '))
      const primaryLogo = (result.assets ?? []).find((asset) => asset.assetType === 'PRIMARY_LOGO')
      setLogoWordmark(primaryLogo?.expectedWordmark ?? '')
      setLogoDescription(primaryLogo?.description ?? '')
      setLogoRequired(primaryLogo?.isRequired ?? false)
      onBrandLoaded(result)

      return result
    } catch (err) {
      setError(errorMessage(err))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [apiBaseUrl, basePath, onBrandLoaded])

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadBrand()
    }, 0)

    return () => window.clearTimeout(timerId)
  }, [loadBrand])

  const refreshAfterMutation = async (message: string) => {
    const refreshed = await loadBrand()

    if (refreshed) {
      setNotice(message)
      setError('')
    }
  }

  const handleSaveBrand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsBusy(true)
    setError('')
    setNotice('')

    try {
      const brandColors = colorsText
        .split(/[,\n]/)
        .map((color) => color.trim())
        .filter(Boolean)

      await apiRequest<BrandProfileData>(apiBaseUrl, basePath, {
        method: 'PATCH',
        body: JSON.stringify({
          name: brandName.trim(),
          description: description.trim() || null,
          brandColors,
        }),
      })

      await refreshAfterMutation('Brand profile and palette saved.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsBusy(false)
    }
  }

  const primaryLogo = brand?.assets?.find((asset) => asset.assetType === 'PRIMARY_LOGO') ?? null

  const handleSaveLogo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLogoBusy(true)
    setError('')
    setNotice('')
    try {
      if (logoFile) {
        const form = new FormData()
        form.append('logo', logoFile)
        form.append('expectedWordmark', logoWordmark.trim())
        form.append('description', logoDescription.trim())
        form.append('isRequired', String(logoRequired))
        await apiRequest<ApprovedBrandAsset>(apiBaseUrl, `${basePath}/assets/logo`, {
          method: 'POST',
          body: form,
        })
        setLogoFile(null)
        await refreshAfterMutation('Official brand logo uploaded and saved.')
      } else if (primaryLogo) {
        await apiRequest<ApprovedBrandAsset>(apiBaseUrl, `${basePath}/assets/logo`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedWordmark: logoWordmark.trim() || null,
            description: logoDescription.trim() || null,
            isRequired: logoRequired,
          }),
        })
        await refreshAfterMutation('Approved logo settings saved.')
      } else {
        setError('Choose the official logo image before saving.')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLogoBusy(false)
    }
  }

  const handleRemoveLogo = async () => {
    if (!primaryLogo || !window.confirm('Remove the approved logo reference? Future image audits will not be able to verify logo identity.')) return
    setLogoBusy(true)
    setError('')
    setNotice('')
    try {
      await apiRequest(apiBaseUrl, `${basePath}/assets/logo`, { method: 'DELETE' })
      setLogoFile(null)
      setLogoWordmark('')
      setLogoDescription('')
      setLogoRequired(false)
      await refreshAfterMutation('Approved logo reference removed.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLogoBusy(false)
    }
  }

  const handleSaveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsBusy(true)
    setError('')
    setNotice('')

    try {
      const payload = {
        ...ruleDraft,
        ruleCode: ruleDraft.ruleCode.trim(),
        title: ruleDraft.title.trim(),
        description: ruleDraft.description.trim(),
        pattern: ruleDraft.pattern.trim() || null,
        isActive: true,
      }

      await apiRequest(
        apiBaseUrl,
        editingRuleId
          ? `${basePath}/rules/${encodeURIComponent(editingRuleId)}`
          : `${basePath}/rules`,
        {
          method: editingRuleId ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      )

      await refreshAfterMutation(editingRuleId ? 'Rule updated.' : 'Rule created.')
      setRuleDraft(EMPTY_RULE)
      setEditingRuleId(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsBusy(false)
    }
  }

  const handleEditRule = (rule: RulebookRule) => {
    setEditingRuleId(rule.id)
    setRuleDraft({
      ruleCode: rule.ruleCode,
      category: rule.category,
      title: rule.title,
      description: rule.description,
      pattern: rule.pattern ?? '',
    })
    setError('')
    setNotice('')
  }

  const handleDeleteRule = async (rule: RulebookRule) => {
    if (!window.confirm(`Delete rule ${rule.ruleCode}? This cannot be undone.`)) return

    setIsBusy(true)
    setError('')
    setNotice('')

    try {
      await apiRequest(
        apiBaseUrl,
        `${basePath}/rules/${encodeURIComponent(rule.id)}`,
        { method: 'DELETE' },
      )

      await refreshAfterMutation(`Rule ${rule.ruleCode} deleted.`)

      if (editingRuleId === rule.id) {
        setEditingRuleId(null)
        setRuleDraft(EMPTY_RULE)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsBusy(false)
    }
  }

  const handleSaveFact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsBusy(true)
    setError('')
    setNotice('')

    try {
      const payload = {
        ...factDraft,
        factCode: factDraft.factCode.trim(),
        claim: factDraft.claim.trim(),
        sourceLabel: factDraft.sourceLabel.trim() || 'Approved product facts',
        sourceUrl: factDraft.sourceUrl.trim() || null,
      }

      await apiRequest(
        apiBaseUrl,
        editingFactId
          ? `${basePath}/facts/${encodeURIComponent(editingFactId)}`
          : `${basePath}/facts`,
        {
          method: editingFactId ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      )

      await refreshAfterMutation(
        editingFactId ? 'Approved fact updated.' : 'Approved fact created.',
      )

      setFactDraft(EMPTY_FACT)
      setEditingFactId(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsBusy(false)
    }
  }

  const handleEditFact = (fact: ApprovedFact) => {
    setEditingFactId(fact.id)
    setFactDraft({
      factCode: fact.factCode,
      claim: fact.claim,
      sourceLabel: fact.sourceLabel,
      sourceUrl: fact.sourceUrl ?? '',
    })
    setError('')
    setNotice('')
  }

  const handleDeleteFact = async (fact: ApprovedFact) => {
    if (!window.confirm(`Delete approved fact ${fact.factCode}? This cannot be undone.`)) return

    setIsBusy(true)
    setError('')
    setNotice('')

    try {
      await apiRequest(
        apiBaseUrl,
        `${basePath}/facts/${encodeURIComponent(fact.id)}`,
        { method: 'DELETE' },
      )

      await refreshAfterMutation(`Fact ${fact.factCode} deleted.`)

      if (editingFactId === fact.id) {
        setEditingFactId(null)
        setFactDraft(EMPTY_FACT)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsBusy(false)
    }
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]

    if (!file) return

    setError('')
    setNotice('')

    try {
      setImportText(await file.text())
    } catch {
      setError('Unable to read the selected JSON file.')
    } finally {
      input.value = ''
    }
  }

  const handleImport = async () => {
    setIsBusy(true)
    setError('')
    setNotice('')

    try {
      const parsed: unknown = JSON.parse(importText)

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('The import must be a JSON object.')
      }

      const result = await apiRequest<{
        importedRules: number
        importedFacts: number
        mode: string
      }>(apiBaseUrl, `${basePath}/import`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      })

      await refreshAfterMutation(
        `Imported ${result.importedRules} rule(s) and ${result.importedFacts} fact(s). Existing codes were updated; other records were kept.`,
      )

      setImportText('')
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'The JSON is invalid. Check commas, quotes, and brackets.'
          : errorMessage(err),
      )
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="bf-rulebook-page">
      <div className="bf-card">
        <div className="bf-card-header">
          <div>
            <h1 className="bf-section-title" style={{ fontSize: '17px' }}>
              {brand?.name ?? 'Brand'} — Brand Rulebook &amp; Approved Facts
            </h1>
            <p className="bf-section-meta" style={{ marginTop: '3px' }}>
              Rules, verified claims and brand colors stored in PostgreSQL.
            </p>
          </div>

        </div>

        <div className="bf-card-body">
          {error && (
            <div className="bf-rulebook-feedback error" role="alert">
              {error}
            </div>
          )}

          {notice && (
            <div className="bf-rulebook-feedback success" role="status">
              {notice}
            </div>
          )}

          {isLoading && !brand ? (
            <div className="bf-empty-state">Loading brand configuration from PostgreSQL…</div>
          ) : !brand ? (
            <div className="bf-empty-state">
              <p>Unable to load the Rulebook.</p>
              <button
                type="button"
                className="bf-btn-secondary"
                onClick={() => void loadBrand()}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <section className="bf-rulebook-section">
                <div className="bf-rulebook-section-heading">
                  <div>
                    <h2 className="bf-section-title">Brand Profile</h2>
                    <p className="bf-section-meta">
                      Update the brand identity and approved hex palette.
                    </p>
                  </div>
                </div>

                <form className="bf-rulebook-form" onSubmit={handleSaveBrand}>
                  <div className="bf-rulebook-form-grid">
                    <div className="bf-field">
                      <label className="bf-label" htmlFor="bf-brand-name">
                        Brand name
                      </label>
                      <input
                        id="bf-brand-name"
                        className="bf-input"
                        value={brandName}
                        onChange={(event) => setBrandName(event.target.value)}
                        required
                      />
                    </div>

                    <div className="bf-field">
                      <label className="bf-label" htmlFor="bf-brand-description">
                        Description
                      </label>
                      <input
                        id="bf-brand-description"
                        className="bf-input"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>

                    <div className="bf-field bf-rulebook-full-width">
                      <label className="bf-label" htmlFor="bf-brand-colors">
                        Brand colors (comma-separated hex values)
                      </label>
                      <input
                        id="bf-brand-colors"
                        className="bf-input"
                        value={colorsText}
                        onChange={(event) => setColorsText(event.target.value)}
                        placeholder="#17262A, #0F766E, #FFFFFF"
                      />
                      <p className="bf-section-meta">
                        Use six-digit hexadecimal colors, e.g. #0F766E.
                      </p>
                    </div>
                  </div>

                  <div className="bf-rulebook-swatches">
                    {brand.brandColors.map((color) => (
                      <div className="bf-swatch-item" key={color}>
                        <span
                          className="bf-swatch-color"
                          style={{ backgroundColor: color }}
                        />
                        <code>{color}</code>
                      </div>
                    ))}
                  </div>

                  <div className="bf-editor-actions">
                    <button className="bf-btn-primary" type="submit" disabled={isBusy}>
                      Save Brand Profile
                    </button>
                  </div>
                </form>
              </section>

              <section className="bf-rulebook-section bf-brand-assets-section">
                <div className="bf-rulebook-section-heading">
                  <div>
                    <h2 className="bf-section-title">Approved Brand Assets</h2>
                    <p className="bf-section-meta">Upload the official logo so campaign images can be checked against the real reference, not just the brand palette.</p>
                  </div>
                  {primaryLogo && <span className="bf-brand-asset-status">Official reference saved</span>}
                </div>

                <div className="bf-brand-asset-layout">
                  <div className="bf-brand-asset-preview">
                    {primaryLogo ? (
                      <img src={primaryLogo.secureUrl} alt={`Approved ${brand.name} logo reference`} />
                    ) : (
                      <div className="bf-brand-asset-placeholder"><span aria-hidden="true">◈</span><strong>No official logo yet</strong><small>Upload a transparent PNG when possible.</small></div>
                    )}
                    {primaryLogo && <div className="bf-brand-asset-file"><strong>{primaryLogo.name}</strong><span>{primaryLogo.format.toUpperCase()} · Primary logo</span></div>}
                  </div>

                  <form className="bf-rulebook-form bf-brand-asset-form" onSubmit={(event) => void handleSaveLogo(event)}>
                    <div className="bf-field bf-rulebook-full-width">
                      <label className="bf-label" htmlFor="bf-primary-logo-file">Official logo file</label>
                      <input id="bf-primary-logo-file" className="bf-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} />
                      <p className="bf-section-meta">PNG, JPEG or WebP · max 5 MB. Selecting a new file replaces the current reference.</p>
                    </div>
                    <div className="bf-field bf-rulebook-full-width">
                      <label className="bf-label" htmlFor="bf-primary-logo-wordmark">Expected wordmark (optional)</label>
                      <input id="bf-primary-logo-wordmark" className="bf-input" value={logoWordmark} onChange={(event) => setLogoWordmark(event.target.value)} maxLength={120} placeholder="e.g. PahariKnits" />
                      <p className="bf-section-meta">Used to check visible spelling when the campaign image makes the text legible.</p>
                    </div>
                    <div className="bf-field bf-rulebook-full-width">
                      <label className="bf-label" htmlFor="bf-primary-logo-description">Logo usage notes (optional)</label>
                      <textarea id="bf-primary-logo-description" className="bf-input bf-rulebook-textarea" value={logoDescription} onChange={(event) => setLogoDescription(event.target.value)} maxLength={1000} placeholder="e.g. Use the navy-and-teal mark; do not stretch or recolor." />
                    </div>
                    <label className="bf-brand-asset-required">
                      <input type="checkbox" checked={logoRequired} onChange={(event) => setLogoRequired(event.target.checked)} />
                      <span><strong>Logo required on campaign images</strong><small>If enabled, missing or mismatched logos are flagged more strongly.</small></span>
                    </label>
                    <div className="bf-editor-actions bf-brand-asset-actions">
                      <button className="bf-btn-primary" type="submit" disabled={logoBusy || (!logoFile && !primaryLogo)}>{logoBusy ? 'Saving logo…' : logoFile ? 'Upload and save logo' : 'Save logo settings'}</button>
                      {primaryLogo && <button className="bf-btn-secondary" type="button" onClick={() => void handleRemoveLogo()} disabled={logoBusy}>Remove reference</button>}
                    </div>
                  </form>
                </div>
              </section>

              <section className="bf-rulebook-section">
                <div className="bf-rulebook-section-heading">
                  <div>
                    <h2 className="bf-section-title">Governance Rules</h2>
                    <p className="bf-section-meta">
                      {brand.rules.length} active rule(s). Optional regex patterns drive deterministic matching.
                    </p>
                  </div>
                </div>

                <div className="bf-rulebook-management">
                  <form className="bf-rulebook-form" onSubmit={handleSaveRule}>
                    <h3 className="bf-rulebook-form-title">
                      {editingRuleId ? 'Edit Rule' : 'Add Rule'}
                    </h3>

                    <div className="bf-rulebook-form-grid">
                      <div className="bf-field">
                        <label className="bf-label" htmlFor="bf-rule-code">Rule code</label>
                        <input
                          id="bf-rule-code"
                          className="bf-input"
                          value={ruleDraft.ruleCode}
                          onChange={(event) =>
                            setRuleDraft({ ...ruleDraft, ruleCode: event.target.value })
                          }
                          required
                          disabled={Boolean(editingRuleId)}
                          placeholder="TERM-02"
                        />
                      </div>

                      <div className="bf-field">
                        <label className="bf-label" htmlFor="bf-rule-category">Category</label>
                        <select
                          id="bf-rule-category"
                          className="bf-input"
                          value={ruleDraft.category}
                          onChange={(event) =>
                            setRuleDraft({
                              ...ruleDraft,
                              category: event.target.value as RuleCategory,
                            })
                          }
                        >
                          {CATEGORIES.map((category) => (
                            <option value={category} key={category}>{category}</option>
                          ))}
                        </select>
                      </div>

                      <div className="bf-field bf-rulebook-full-width">
                        <label className="bf-label" htmlFor="bf-rule-title">Title</label>
                        <input
                          id="bf-rule-title"
                          className="bf-input"
                          value={ruleDraft.title}
                          onChange={(event) =>
                            setRuleDraft({ ...ruleDraft, title: event.target.value })
                          }
                          required
                        />
                      </div>

                      <div className="bf-field bf-rulebook-full-width">
                        <label className="bf-label" htmlFor="bf-rule-description">Description / guidance</label>
                        <textarea
                          id="bf-rule-description"
                          className="bf-textarea bf-rulebook-textarea"
                          value={ruleDraft.description}
                          onChange={(event) =>
                            setRuleDraft({ ...ruleDraft, description: event.target.value })
                          }
                          required
                        />
                      </div>

                      <div className="bf-field bf-rulebook-full-width">
                        <label className="bf-label" htmlFor="bf-rule-pattern">
                          Regex pattern (optional)
                        </label>
                        <input
                          id="bf-rule-pattern"
                          className="bf-input"
                          value={ruleDraft.pattern}
                          onChange={(event) =>
                            setRuleDraft({ ...ruleDraft, pattern: event.target.value })
                          }
                          placeholder={String.raw`\b(example|phrase)\b`}
                        />
                        <p className="bf-section-meta">
                          Invalid patterns will be rejected by the API.
                        </p>
                      </div>
                    </div>

                    <div className="bf-editor-actions">
                      <button type="submit" className="bf-btn-primary" disabled={isBusy}>
                        {isBusy ? 'Saving…' : editingRuleId ? 'Save Rule' : 'Add Rule'}
                      </button>
                      {editingRuleId && (
                        <button
                          type="button"
                          className="bf-btn-secondary"
                          onClick={() => {
                            setEditingRuleId(null)
                            setRuleDraft(EMPTY_RULE)
                          }}
                          disabled={isBusy}
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>
                  </form>

                  <div className="bf-rulebook-record-list">
                    {brand.rules.map((rule) => (
                      <article className="bf-rule-box" key={rule.id}>
                        <div className="bf-finding-meta">
                          <span className="bf-rule-tag">{rule.ruleCode}</span>
                          <span className="bf-source-meta">{rule.category}</span>
                        </div>
                        <h3 className="bf-finding-title">{rule.title}</h3>
                        <p className="bf-finding-desc">{rule.description}</p>
                        {rule.pattern && (
                          <code className="bf-rulebook-pattern">{rule.pattern}</code>
                        )}
                        <div className="bf-rulebook-item-actions">
                          <button
                            className="bf-btn-secondary"
                            type="button"
                            onClick={() => handleEditRule(rule)}
                            disabled={isBusy}
                          >
                            Edit
                          </button>
                          <button
                            className="bf-btn-secondary"
                            type="button"
                            onClick={() => void handleDeleteRule(rule)}
                            disabled={isBusy}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>

              <section className="bf-rulebook-section">
                <div className="bf-rulebook-section-heading">
                  <div>
                    <h2 className="bf-section-title">Approved Product Facts</h2>
                    <p className="bf-section-meta">
                      {brand.facts.length} active fact(s) used to ground claim verification.
                    </p>
                  </div>
                </div>

                <div className="bf-rulebook-management">
                  <form className="bf-rulebook-form" onSubmit={handleSaveFact}>
                    <h3 className="bf-rulebook-form-title">
                      {editingFactId ? 'Edit Approved Fact' : 'Add Approved Fact'}
                    </h3>

                    <div className="bf-rulebook-form-grid">
                      <div className="bf-field">
                        <label className="bf-label" htmlFor="bf-fact-code">Fact code</label>
                        <input
                          id="bf-fact-code"
                          className="bf-input"
                          value={factDraft.factCode}
                          onChange={(event) =>
                            setFactDraft({ ...factDraft, factCode: event.target.value })
                          }
                          required
                          disabled={Boolean(editingFactId)}
                          placeholder="FACT-04"
                        />
                      </div>

                      <div className="bf-field">
                        <label className="bf-label" htmlFor="bf-fact-source">Source label</label>
                        <input
                          id="bf-fact-source"
                          className="bf-input"
                          value={factDraft.sourceLabel}
                          onChange={(event) =>
                            setFactDraft({ ...factDraft, sourceLabel: event.target.value })
                          }
                        />
                      </div>

                      <div className="bf-field bf-rulebook-full-width">
                        <label className="bf-label" htmlFor="bf-fact-claim">Approved claim / fact</label>
                        <textarea
                          id="bf-fact-claim"
                          className="bf-textarea bf-rulebook-textarea"
                          value={factDraft.claim}
                          onChange={(event) =>
                            setFactDraft({ ...factDraft, claim: event.target.value })
                          }
                          required
                        />
                      </div>

                      <div className="bf-field bf-rulebook-full-width">
                        <label className="bf-label" htmlFor="bf-fact-url">Source URL (optional)</label>
                        <input
                          id="bf-fact-url"
                          className="bf-input"
                          type="url"
                          value={factDraft.sourceUrl}
                          onChange={(event) =>
                            setFactDraft({ ...factDraft, sourceUrl: event.target.value })
                          }
                          placeholder="https://example.com/product-facts"
                        />
                      </div>
                    </div>

                    <div className="bf-editor-actions">
                      <button type="submit" className="bf-btn-primary" disabled={isBusy}>
                        {isBusy ? 'Saving…' : editingFactId ? 'Save Fact' : 'Add Fact'}
                      </button>
                      {editingFactId && (
                        <button
                          type="button"
                          className="bf-btn-secondary"
                          onClick={() => {
                            setEditingFactId(null)
                            setFactDraft(EMPTY_FACT)
                          }}
                          disabled={isBusy}
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>
                  </form>

                  <div className="bf-rulebook-record-list">
                    {brand.facts.map((fact) => (
                      <article className="bf-rule-box" key={fact.id}>
                        <div className="bf-finding-meta">
                          <span className="bf-rule-tag">{fact.factCode}</span>
                          <span className="bf-source-meta">{fact.sourceLabel}</span>
                        </div>
                        <p className="bf-finding-title" style={{ fontWeight: 500 }}>
                          {fact.claim}
                        </p>
                        {fact.sourceUrl && (
                          <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
                            Open source
                          </a>
                        )}
                        <div className="bf-rulebook-item-actions">
                          <button
                            className="bf-btn-secondary"
                            type="button"
                            onClick={() => handleEditFact(fact)}
                            disabled={isBusy}
                          >
                            Edit
                          </button>
                          <button
                            className="bf-btn-secondary"
                            type="button"
                            onClick={() => void handleDeleteFact(fact)}
                            disabled={isBusy}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>

              <section className="bf-rulebook-section">
                <div className="bf-rulebook-section-heading">
                  <div>
                    <h2 className="bf-section-title">Import Rulebook JSON</h2>
                    <p className="bf-section-meta">
                      Import a JSON file or paste JSON below. Records are merged by code; omitted rules and facts are preserved.
                    </p>
                  </div>
                </div>

                <div className="bf-field">
                  <label className="bf-label" htmlFor="bf-import-file">
                    Choose JSON file
                  </label>
                  <input
                    id="bf-import-file"
                    type="file"
                    accept=".json,application/json"
                    className="bf-input"
                    onChange={(event) => void handleImportFile(event)}
                  />
                </div>

                <div className="bf-field">
                  <label className="bf-label" htmlFor="bf-import-json">
                    Rulebook JSON
                  </label>
                  <textarea
                    id="bf-import-json"
                    className="bf-textarea bf-rulebook-json"
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                    placeholder={JSON.stringify({
                      name: 'Northstar Workspace',
                      description: 'Brand profile description',
                      brandColors: ['#17262A', '#0F766E', '#FFFFFF'],
                      rules: [{
                        ruleCode: 'TERM-02',
                        category: 'TERMINOLOGY',
                        title: 'Avoid an unwanted phrase',
                        description: 'Flag the unwanted phrase.',
                        pattern: '\\\\b(example)\\\\b',
                      }],
                      facts: [{
                        factCode: 'FACT-04',
                        claim: 'An approved product claim.',
                        sourceLabel: 'Product documentation',
                        sourceUrl: 'https://example.com/facts',
                      }],
                    }, null, 2)}
                    rows={10}
                  />
                </div>

                <div className="bf-editor-actions">
                  <button
                    type="button"
                    className="bf-btn-primary"
                    disabled={isBusy || !importText.trim()}
                    onClick={() => void handleImport()}
                  >
                    {isBusy ? 'Importing…' : 'Import JSON'}
                  </button>
                  <button
                    type="button"
                    className="bf-btn-secondary"
                    disabled={isBusy || !importText}
                    onClick={() => setImportText('')}
                  >
                    Clear JSON
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
