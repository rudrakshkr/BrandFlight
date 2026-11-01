import { useMemo } from 'react'

type SavedRevision = {
  id: string
  version: number
  contentText: string
  imageAltText: string | null
  imageUrl: string | null
  imagePublicId: string | null
}

type DiffPart = { type: 'same' | 'added' | 'removed'; text: string }

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? []
}

function buildWordDiff(previousText: string, currentText: string): {
  parts: DiffPart[]
  added: number
  removed: number
  limited: boolean
} {
  const previous = tokenize(previousText)
  const current = tokenize(currentText)
  const maxTokens = 850
  if (previous.length > maxTokens || current.length > maxTokens) {
    return { parts: [], added: 0, removed: 0, limited: true }
  }

  const width = current.length + 1
  const table = new Uint16Array((previous.length + 1) * width)
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = current.length - 1; j >= 0; j -= 1) {
      const cell = i * width + j
      table[cell] = previous[i] === current[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }

  const operations: DiffPart[] = []
  const push = (type: DiffPart['type'], text: string) => {
    const last = operations[operations.length - 1]
    if (last?.type === type) last.text += text
    else operations.push({ type, text })
  }

  let i = 0
  let j = 0
  while (i < previous.length && j < current.length) {
    if (previous[i] === current[j]) {
      push('same', current[j]); i += 1; j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push('removed', previous[i]); i += 1
    } else {
      push('added', current[j]); j += 1
    }
  }
  while (i < previous.length) { push('removed', previous[i]); i += 1 }
  while (j < current.length) { push('added', current[j]); j += 1 }

  const countWords = (text: string) => (text.match(/[^\s]+/g) ?? []).length
  return {
    parts: operations,
    added: operations.filter((part) => part.type === 'added').reduce((sum, part) => sum + countWords(part.text), 0),
    removed: operations.filter((part) => part.type === 'removed').reduce((sum, part) => sum + countWords(part.text), 0),
    limited: false,
  }
}

interface Props {
  revisions: SavedRevision[]
  currentContent: string
  currentImageUrl: string | null
  currentImagePublicId: string | null
  currentImageAltText: string | null
}

export default function CampaignChangeIntelligence({
  revisions,
  currentContent,
  currentImageUrl,
  currentImagePublicId,
  currentImageAltText,
}: Props) {
  const previous = revisions[1]
  const latest = revisions[0]
  const previousContent = previous?.contentText

  const diff = useMemo(
    () => previousContent !== undefined
      ? buildWordDiff(previousContent, currentContent)
      : null,
    [previousContent, currentContent],
  )

  if (!latest || !previous) {
    return (
      <section className="bf-review-section bf-change-intelligence">
        <div className="bf-change-heading">
          <div>
            <span className="bf-change-eyebrow">CAMPAIGN CHANGE INTELLIGENCE</span>
            <h3>Revision comparison</h3>
          </div>
          <span className="bf-change-version">{latest ? `v${latest.version}` : 'No revisions'}</span>
        </div>
        <p className="bf-change-empty">A comparison will appear after the campaign has at least two saved revisions.</p>
      </section>
    )
  }

  const imageChanged = previous.imageUrl !== currentImageUrl ||
    previous.imagePublicId !== currentImagePublicId ||
    previous.imageAltText !== currentImageAltText

  return (
    <section className="bf-review-section bf-change-intelligence">
      <div className="bf-change-heading">
        <div>
          <span className="bf-change-eyebrow">CAMPAIGN CHANGE INTELLIGENCE</span>
          <h3>What changed since v{previous.version}?</h3>
        </div>
        <span className="bf-change-version">v{previous.version} → v{latest.version}</span>
      </div>

      {diff?.limited ? (
        <p className="bf-change-empty">This campaign is too large for the inline comparison preview. Revision snapshots are still retained.</p>
      ) : diff ? (
        <>
          <div className="bf-change-metrics">
            <span className="bf-change-added">+{diff.added} words added</span>
            <span className="bf-change-removed">−{diff.removed} words removed</span>
            {imageChanged && <span className="bf-change-image">Image or alt text changed</span>}
          </div>
          <div className="bf-change-diff" aria-label="Word-level revision comparison">
            {diff.parts.map((part, index) => part.type === 'added'
              ? <ins key={`${part.type}-${index}`}>{part.text}</ins>
              : part.type === 'removed'
                ? <del key={`${part.type}-${index}`}>{part.text}</del>
                : <span key={`${part.type}-${index}`}>{part.text}</span>)}
          </div>
        </>
      ) : null}
      <p className="bf-change-footnote">Compared from saved revision snapshots. Re-run preflight after edits; this diff does not itself determine compliance.</p>
    </section>
  )
}
