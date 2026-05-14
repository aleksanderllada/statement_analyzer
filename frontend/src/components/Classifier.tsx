import { useState, useEffect, type MouseEvent } from 'react'
import type { Transaction, LabelInfo, LabelScope } from '../types'
import { extractBusinessKey } from '../utils/aggregations'

const API_BASE = 'http://localhost:8001'

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

interface ContextMenu {
  x: number
  y: number
  labelId: number
}

interface Staged {
  labelId: number
  scope: LabelScope
}

interface Props {
  labels: LabelInfo[]
  statementIds: number[]
  onLabelsChanged: () => Promise<void> | void
}

export function Classifier({ labels, statementIds, onLabelsChanged }: Props) {
  const [transaction, setTransaction] = useState<Transaction | null>(null)
  const [remaining, setRemaining] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [newLabelName, setNewLabelName] = useState('')
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set())
  const [staged, setStaged] = useState<Staged[]>([])

  const fetchNext = async (skipSet: Set<number> = skippedIds, ids: number[] = statementIds) => {
    if (ids.length === 0) {
      setTransaction(null)
      setRemaining(0)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (skipSet.size > 0) qs.set('skip', [...skipSet].join(','))
      qs.set('statement_ids', ids.join(','))
      const res = await fetch(`${API_BASE}/transactions/unlabeled?${qs}`)
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} — restart the backend?`)
      }
      const data = await res.json()
      setTransaction(data.transaction ?? null)
      setRemaining(data.remaining ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setTransaction(null)
      setRemaining(0)
    } finally {
      setLoading(false)
    }
  }

  // Re-fetch whenever the selected statements change. Reset skip+staged too —
  // they're scoped to the previous selection.
  useEffect(() => {
    setSkippedIds(new Set())
    setStaged([])
    fetchNext(new Set(), statementIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementIds.join(',')])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  const matchValueFor = (scope: LabelScope, tx: Transaction): string => {
    if (scope === 'transaction') return String(tx.id)
    if (scope === 'establishment') return tx.establishment.trim().toLowerCase()
    return extractBusinessKey(tx.establishment)
  }

  const postAssign = async (labelId: number, scope: LabelScope, tx: Transaction) => {
    const matchValue = matchValueFor(scope, tx)
    await fetch(`${API_BASE}/labels/${labelId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, match_value: matchValue }),
    })
  }

  const commitAndAdvance = async (toCommit: Staged[]) => {
    if (!transaction || toCommit.length === 0) return
    const tx = transaction
    try {
      await Promise.all(toCommit.map(s => postAssign(s.labelId, s.scope, tx)))
      setStaged([])
      await fetchNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign')
    }
  }

  // Stage a label pick. Triggers advance on either:
  //   (a) clicking an already-staged label (commits whatever is staged)
  //   (b) staging a second distinct label (commits both)
  const stageLabel = (labelId: number, scope: LabelScope) => {
    const existingIdx = staged.findIndex(s => s.labelId === labelId)
    if (existingIdx !== -1) {
      // case (a): treat the new click's scope as the final scope for that label
      const updated = staged.map((s, i) => i === existingIdx ? { labelId, scope } : s)
      commitAndAdvance(updated)
      return
    }
    const next = [...staged, { labelId, scope }]
    if (next.length >= 2) {
      // case (b): second distinct label commits both
      commitAndAdvance(next)
    } else {
      setStaged(next)
    }
  }

  const handleLabelClick = (labelId: number) => {
    stageLabel(labelId, 'business')
  }

  const handleLabelContextMenu = (e: MouseEvent, labelId: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, labelId })
  }

  const handleSkip = () => {
    if (!transaction) return
    const next = new Set(skippedIds)
    next.add(transaction.id)
    setSkippedIds(next)
    setStaged([])
    fetchNext(next)
  }

  const handleReset = () => {
    const empty = new Set<number>()
    setSkippedIds(empty)
    setStaged([])
    fetchNext(empty)
  }

  const handleCreateLabel = async () => {
    const name = newLabelName.trim()
    if (!name || !transaction) return
    try {
      const res = await fetch(`${API_BASE}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const created: LabelInfo = await res.json()
      await onLabelsChanged()
      setNewLabelName('')
      if (created?.id) {
        stageLabel(created.id, 'business')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create label')
    }
  }

  if (loading && !transaction) {
    return <div className="classifier-screen"><div className="classifier-loading">Loading...</div></div>
  }

  if (!transaction) {
    if (error) {
      return (
        <div className="classifier-screen">
          <div className="classifier-done">
            <h2>Failed to load</h2>
            <p>{error}</p>
            <button type="button" onClick={handleReset}>Retry</button>
          </div>
        </div>
      )
    }
    if (statementIds.length === 0) {
      return (
        <div className="classifier-screen">
          <div className="classifier-done">
            <h2>No statements selected</h2>
            <p>Select one or more statements in the sidebar to start classifying.</p>
          </div>
        </div>
      )
    }
    const allSkipped = remaining > 0 && skippedIds.size >= remaining
    return (
      <div className="classifier-screen">
        <div className="classifier-done">
          <h2>{allSkipped ? 'All remaining were skipped' : 'All transactions classified'}</h2>
          <p>
            {allSkipped
              ? `${remaining} unlabeled remain, all skipped in this session.`
              : 'No unlabeled transactions remain.'}
          </p>
          <button type="button" onClick={handleReset}>
            {allSkipped ? 'Reset skipped' : 'Refresh'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="classifier-screen">
      <div className="classifier-header">
        <h2>Classify Transactions</h2>
        <div className="classifier-progress">{remaining} remaining</div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="classifier-card">
        <div className="classifier-establishment">{transaction.establishment}</div>
        <div className="classifier-amount">{currencyFormatter.format(transaction.amount)}</div>
        <div className="classifier-meta">
          <span><strong>Date:</strong> {transaction.date || '-'}</span>
          <span><strong>Cardholder:</strong> {transaction.cardholder || '-'}</span>
          <span><strong>Card:</strong> ****{transaction.card_last_digits || '????'}</span>
          <span><strong>Category:</strong> {transaction.category || '-'}</span>
          {transaction.location && <span><strong>Location:</strong> {transaction.location}</span>}
          {transaction.installment && <span><strong>Installment:</strong> {transaction.installment}</span>}
        </div>
        <div className="classifier-business-key">
          Business key: <code>{extractBusinessKey(transaction.establishment)}</code>
        </div>
      </div>

      <div className="classifier-instructions">
        Pick up to 2 labels. Click again on a selected label, or pick a second, to advance.
        Click = <strong>Business</strong> scope · right-click for more options.
      </div>

      <div className="classifier-labels">
        {labels.length === 0 ? (
          <div className="classifier-no-labels">No labels yet — create one below.</div>
        ) : (
          labels.map(label => {
            const stagedEntry = staged.find(s => s.labelId === label.id)
            const isStaged = !!stagedEntry
            const scopeTag = stagedEntry
              ? (stagedEntry.scope === 'transaction' ? 'T' : stagedEntry.scope === 'establishment' ? 'E' : 'B')
              : null
            return (
              <button
                key={label.id}
                type="button"
                className={`classifier-label-chip ${isStaged ? 'staged' : ''}`}
                onClick={() => handleLabelClick(label.id)}
                onContextMenu={(e) => handleLabelContextMenu(e, label.id)}
                title="Click = Business · right-click for more options"
              >
                {label.name}
                {scopeTag && <span className="classifier-chip-scope">{scopeTag}</span>}
              </button>
            )
          })
        )}
      </div>

      <div className="classifier-actions">
        <div className="classifier-new-label">
          <input
            type="text"
            placeholder="New label name..."
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateLabel() }}
          />
          <button type="button" disabled={!newLabelName.trim()} onClick={handleCreateLabel}>
            Create & apply
          </button>
        </div>
        <button type="button" className="classifier-skip" onClick={handleSkip}>
          Skip
        </button>
      </div>

      {contextMenu && (
        <div
          className="classifier-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => { stageLabel(contextMenu.labelId, 'establishment'); setContextMenu(null) }}
          >
            Name
            <span className="classifier-context-hint">exact establishment</span>
          </button>
          <button
            type="button"
            onClick={() => { stageLabel(contextMenu.labelId, 'transaction'); setContextMenu(null) }}
          >
            This only
            <span className="classifier-context-hint">single transaction</span>
          </button>
        </div>
      )}
    </div>
  )
}
