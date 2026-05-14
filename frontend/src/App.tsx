import { useState, useMemo, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import type { Transaction, StatementInfo, BatchUploadResponse, StatementsTransactionsResponse, LabelInfo, LabelScope } from './types'
import {
  aggregateByDay,
  aggregateByCategory,
  aggregateByBusiness,
  aggregateByLocation,
  aggregateByCardholder,
  aggregateByLabel,
  aggregateByDescription,
  analyzeInstallments,
  filterTransactions,
  extractBusinessKey,
  emptyFilters,
  type Filters,
  type InstallmentProjection,
} from './utils/aggregations'
import {
  ExpensesByDayChart,
  ExpensesByCategoryChart,
  ExpensesByBusinessChart,
  ExpensesByLocationChart,
  ExpensesByCardholderChart,
  ExpensesByLabelChart,
  LabelExpensesTable,
} from './components/Charts'
import { Classifier } from './components/Classifier'

type ViewMode = 'dashboard' | 'classifier'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// Installment Card Component
function InstallmentCard({
  projection,
  formatCurrency
}: {
  projection: InstallmentProjection
  formatCurrency: (value: number) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const isCurrentMonth = projection.monthOffset === 0

  return (
    <div className={`installment-card ${isCurrentMonth ? 'current' : ''}`}>
      <div className="installment-header" onClick={() => setExpanded(!expanded)}>
        <div className="installment-label">{projection.label}</div>
        <div className="installment-total">{formatCurrency(projection.total)}</div>
        <div className="installment-count">{projection.count} items</div>
        <span className="installment-expand">{expanded ? '−' : '+'}</span>
      </div>
      {expanded && (
        <div className="installment-details">
          {projection.items.map((item, index) => (
            <div key={index} className="installment-item">
              <span className="installment-establishment" title={item.establishment}>
                {item.establishment.length > 30 ? item.establishment.slice(0, 30) + '...' : item.establishment}
              </span>
              <span className="installment-info">
                {item.currentInstallment}/{item.totalInstallments}
              </span>
              <span className="installment-amount">{formatCurrency(item.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Label Popover Component - isolated to avoid re-rendering entire table on keystroke
function LabelPopover({
  transaction,
  labels,
  anchorRect,
  onClose,
  onAssign,
  onUnassign,
  onCreateAndAssign,
  onDeleteLabel,
}: {
  transaction: Transaction
  labels: LabelInfo[]
  anchorRect: DOMRect | null
  onClose: () => void
  onAssign: (labelId: number, scope: LabelScope, matchValue: string) => void
  onUnassign: (labelId: number, scope: LabelScope, matchValue: string) => void
  onCreateAndAssign: (name: string, scope: LabelScope, matchValue: string) => void
  onDeleteLabel: (id: number) => void
}) {
  const [newLabelName, setNewLabelName] = useState('')
  const [labelScope, setLabelScope] = useState<LabelScope>('business')

  // Position via portal + fixed coords so the popover escapes any scroll
  // container (the transactions table is overflow:auto).
  const POPOVER_WIDTH = 240
  const ESTIMATED_HEIGHT = 320
  const MARGIN = 8
  const positionStyle: React.CSSProperties = (() => {
    if (!anchorRect) return { left: 0, top: 0 }
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = anchorRect.left
    if (left + POPOVER_WIDTH + MARGIN > vw) {
      left = Math.max(MARGIN, vw - POPOVER_WIDTH - MARGIN)
    }
    const spaceBelow = vh - anchorRect.bottom
    const openUp = spaceBelow < ESTIMATED_HEIGHT && anchorRect.top > spaceBelow
    const top = openUp
      ? Math.max(MARGIN, anchorRect.top - ESTIMATED_HEIGHT - 4)
      : anchorRect.bottom + 4
    return { left, top }
  })()

  const getMatchValue = (scope: LabelScope): string => {
    if (scope === 'transaction') return String(transaction.id)
    if (scope === 'establishment') return transaction.establishment.trim().toLowerCase()
    return extractBusinessKey(transaction.establishment)
  }

  const handleCreate = () => {
    if (!newLabelName.trim()) return
    onCreateAndAssign(newLabelName.trim(), labelScope, getMatchValue(labelScope))
    setNewLabelName('')
  }

  return createPortal(
    <div className="label-popover" style={positionStyle} onClick={(e) => e.stopPropagation()}>
      <div className="label-popover-header">
        <span>Add Label</span>
        <button type="button" className="label-popover-close" onClick={onClose}>x</button>
      </div>
      <div className="label-popover-establishment" title={transaction.establishment}>{transaction.establishment}</div>
      <div className="label-scope-selector">
        <div className="scope-label">Apply to:</div>
        <div className="scope-options-row">
          <label className={`scope-option ${labelScope === 'business' ? 'active' : ''}`}>
            <input type="radio" name="scope" checked={labelScope === 'business'} onChange={() => setLabelScope('business')} />
            Business
          </label>
          <label className={`scope-option ${labelScope === 'establishment' ? 'active' : ''}`}>
            <input type="radio" name="scope" checked={labelScope === 'establishment'} onChange={() => setLabelScope('establishment')} />
            Name
          </label>
          <label className={`scope-option ${labelScope === 'transaction' ? 'active' : ''}`}>
            <input type="radio" name="scope" checked={labelScope === 'transaction'} onChange={() => setLabelScope('transaction')} />
            This only
          </label>
        </div>
      </div>
      <div className="label-options">
        {labels.map(label => {
          const isAssigned = transaction.labels && transaction.labels.some(l => l.id === label.id)
          const existingRule = transaction.labels?.find(l => l.id === label.id)
          return (
            <label key={label.id} className="label-option">
              <input
                type="checkbox"
                checked={isAssigned}
                onChange={() => {
                  if (isAssigned && existingRule) {
                    onUnassign(label.id, existingRule.scope, existingRule.match_value)
                  } else {
                    onAssign(label.id, labelScope, getMatchValue(labelScope))
                  }
                }}
              />
              <span>{label.name}</span>
              {isAssigned && existingRule && (
                <span className="label-scope-tag" title={`Scope: ${existingRule.scope}`}>
                  {existingRule.scope === 'transaction' ? 'T' : existingRule.scope === 'establishment' ? 'E' : 'B'}
                </span>
              )}
              <button
                type="button"
                className="label-delete-btn"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDeleteLabel(label.id)
                }}
                title="Delete label"
              >
                x
              </button>
            </label>
          )
        })}
      </div>
      <div className="label-create-inline">
        <input
          type="text"
          placeholder="New label..."
          value={newLabelName}
          onChange={(e) => setNewLabelName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
          }}
        />
        <button
          type="button"
          disabled={!newLabelName.trim()}
          onClick={handleCreate}
        >
          Add
        </button>
      </div>
    </div>,
    document.body,
  )
}

function App() {
  // Upload state
  const [files, setFiles] = useState<FileList | null>(null)
  const [password, setPassword] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadResults, setUploadResults] = useState<BatchUploadResponse | null>(null)

  // Statements state
  const [statements, setStatements] = useState<StatementInfo[]>([])
  const [selectedStatementIds, setSelectedStatementIds] = useState<number[]>([])
  const [loadingStatements, setLoadingStatements] = useState(true)

  // Transactions state
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalAmount, setTotalAmount] = useState(0)
  const [loadingTransactions, setLoadingTransactions] = useState(false)

  // Filter state
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [drilledBusiness, setDrilledBusiness] = useState('')

  // Sort state for transactions table
  const [sortColumn, setSortColumn] = useState<keyof Transaction | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Label state
  const [labels, setLabels] = useState<LabelInfo[]>([])
  const [labelPopoverTxId, setLabelPopoverTxId] = useState<number | null>(null)
  const [labelPopoverAnchor, setLabelPopoverAnchor] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (labelPopoverTxId === null) return
    const close = () => { setLabelPopoverTxId(null); setLabelPopoverAnchor(null) }
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null
      // Clicks on the trigger (+ button) are handled by its own onClick toggle;
      // ignore them here to avoid double-close fighting the open toggle.
      if (target && target.closest('.label-popover, .add-label-btn')) return
      close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [labelPopoverTxId])

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')

  // Fetch statements and labels on mount
  useEffect(() => {
    fetchStatements()
    fetchLabels()
  }, [])

  // Fetch transactions when selection changes
  useEffect(() => {
    if (selectedStatementIds.length > 0) {
      fetchTransactions(selectedStatementIds)
    } else {
      setTransactions([])
      setTotalAmount(0)
    }
  }, [selectedStatementIds])

  const fetchStatements = async () => {
    try {
      setLoadingStatements(true)
      const response = await fetch(`${API_BASE}/statements`)
      const data = await response.json()

      // Ensure data is an array
      if (!Array.isArray(data)) {
        console.error('Unexpected response from /statements:', data)
        setStatements([])
        return
      }

      setStatements(data)

      // Auto-select the latest statement if none are selected
      if (selectedStatementIds.length === 0 && data.length > 0) {
        setSelectedStatementIds([data[0].id])
      }
    } catch (err) {
      console.error('Failed to fetch statements:', err)
      setStatements([])
    } finally {
      setLoadingStatements(false)
    }
  }

  const fetchTransactions = async (ids: number[]) => {
    try {
      setLoadingTransactions(true)
      const response = await fetch(`${API_BASE}/statements/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids),
      })
      const data: StatementsTransactionsResponse = await response.json()
      setTransactions(data.transactions)
      setTotalAmount(data.total)
    } catch (err) {
      console.error('Failed to fetch transactions:', err)
    } finally {
      setLoadingTransactions(false)
    }
  }

  const fetchLabels = async () => {
    try {
      const response = await fetch(`${API_BASE}/labels`)
      const data = await response.json()
      setLabels(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to fetch labels:', err)
    }
  }

  const handleCreateLabel = async (name: string) => {
    try {
      await fetch(`${API_BASE}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      await fetchLabels()
    } catch (err) {
      console.error('Failed to create label:', err)
    }
  }

  // Update transaction labels locally instead of refetching everything.
  // This avoids a full network round-trip + re-render of all charts per label change.
  const updateLabelsLocally = (
    labelId: number,
    labelName: string,
    scope: LabelScope,
    matchValue: string,
    action: 'assign' | 'unassign',
  ) => {
    setTransactions(prev => prev.map(t => {
      const matches =
        (scope === 'transaction' && String(t.id) === matchValue) ||
        (scope === 'business' && extractBusinessKey(t.establishment) === matchValue) ||
        (scope === 'establishment' && t.establishment.trim().toLowerCase() === matchValue)

      if (!matches) return t

      if (action === 'assign') {
        if (t.labels?.some(l => l.id === labelId)) return t
        return {
          ...t,
          labels: [...(t.labels || []), { id: labelId, name: labelName, scope, match_value: matchValue }],
        }
      } else {
        const filtered = (t.labels || []).filter(
          l => !(l.id === labelId && l.scope === scope && l.match_value === matchValue)
        )
        if (filtered.length === (t.labels || []).length) return t
        return { ...t, labels: filtered }
      }
    }))
  }

  const handleDeleteLabel = async (id: number) => {
    try {
      await fetch(`${API_BASE}/labels/${id}`, { method: 'DELETE' })
      await fetchLabels()
      setTransactions(prev => prev.map(t => {
        if (!t.labels?.some(l => l.id === id)) return t
        return { ...t, labels: t.labels.filter(l => l.id !== id) }
      }))
    } catch (err) {
      console.error('Failed to delete label:', err)
    }
  }

  const handleAssignLabel = async (labelId: number, scope: LabelScope, matchValue: string) => {
    try {
      await fetch(`${API_BASE}/labels/${labelId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, match_value: matchValue }),
      })
      const label = labels.find(l => l.id === labelId)
      if (label) {
        updateLabelsLocally(labelId, label.name, scope, matchValue, 'assign')
      }
    } catch (err) {
      console.error('Failed to assign label:', err)
    }
  }

  const handleUnassignLabel = async (labelId: number, scope: LabelScope, matchValue: string) => {
    try {
      const params = new URLSearchParams({ scope, match_value: matchValue })
      await fetch(`${API_BASE}/labels/${labelId}/assign?${params}`, {
        method: 'DELETE',
      })
      const label = labels.find(l => l.id === labelId)
      if (label) {
        updateLabelsLocally(labelId, label.name, scope, matchValue, 'unassign')
      }
    } catch (err) {
      console.error('Failed to unassign label:', err)
    }
  }

  const handleCreateAndAssignLabel = async (name: string, scope: LabelScope, matchValue: string) => {
    try {
      await fetch(`${API_BASE}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const res = await fetch(`${API_BASE}/labels`)
      const allLabels: LabelInfo[] = await res.json()
      setLabels(allLabels)
      const created = allLabels.find(l => l.name === name)
      if (created) {
        await fetch(`${API_BASE}/labels/${created.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, match_value: matchValue }),
        })
        updateLabelsLocally(created.id, name, scope, matchValue, 'assign')
      }
    } catch (err) {
      console.error('Failed to create and assign label:', err)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(e.target.files)
      setUploadError(null)
      setUploadResults(null)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!files || files.length === 0) {
      setUploadError('Please select at least one PDF file')
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadResults(null)

    const formData = new FormData()
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i])
    }
    formData.append('password', password)
    formData.append('bank', 'itau')

    try {
      const response = await fetch(`${API_BASE}/statements/upload`, {
        method: 'POST',
        body: formData,
      })

      const data: BatchUploadResponse = await response.json()

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      setUploadResults(data)

      // Refresh statements list
      await fetchStatements()

      // Clear file input
      setFiles(null)
      const fileInput = document.getElementById('files') as HTMLInputElement
      if (fileInput) fileInput.value = ''

    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteStatement = async (id: number) => {
    if (!confirm('Are you sure you want to delete this statement?')) return

    try {
      await fetch(`${API_BASE}/statements/${id}`, { method: 'DELETE' })
      setSelectedStatementIds(prev => prev.filter(sid => sid !== id))
      await fetchStatements()
    } catch (err) {
      console.error('Failed to delete statement:', err)
    }
  }

  const toggleStatementSelection = (id: number) => {
    setSelectedStatementIds(prev =>
      prev.includes(id)
        ? prev.filter(sid => sid !== id)
        : [...prev, id]
    )
  }

  const selectAllStatements = () => {
    setSelectedStatementIds(statements.map(s => s.id))
  }

  const deselectAllStatements = () => {
    setSelectedStatementIds([])
  }

  const formatCurrency = (value: number) => currencyFormatter.format(value)

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const formatPeriod = (period: string) => {
    const [month, year] = period.split('/')
    const monthIndex = parseInt(month, 10) - 1
    if (monthIndex >= 0 && monthIndex < 12 && year) {
      return `${MONTH_NAMES[monthIndex]}/${year}`
    }
    return period
  }

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return filterTransactions(transactions, filters)
  }, [transactions, filters])

  // Sort filtered transactions
  const sortedTransactions = useMemo(() => {
    if (!sortColumn) return filteredTransactions

    return [...filteredTransactions].sort((a, b) => {
      let aVal = a[sortColumn]
      let bVal = b[sortColumn]

      // Handle null/undefined
      if (aVal == null) aVal = ''
      if (bVal == null) bVal = ''

      // Numeric comparison for amount
      if (sortColumn === 'amount') {
        const diff = (aVal as number) - (bVal as number)
        return sortDirection === 'asc' ? diff : -diff
      }

      // String comparison for other fields
      const aStr = String(aVal).toLowerCase()
      const bStr = String(bVal).toLowerCase()
      const comparison = aStr.localeCompare(bStr)
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [filteredTransactions, sortColumn, sortDirection])

  // Handle column header click for sorting
  const handleSort = (column: keyof Transaction) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to ascending (except amount which defaults to descending)
      setSortColumn(column)
      setSortDirection(column === 'amount' ? 'desc' : 'asc')
    }
  }

  // Sort indicator
  const getSortIndicator = (column: keyof Transaction) => {
    if (sortColumn !== column) return ' ↕'
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  // Chart data based on filtered transactions
  const chartData = useMemo(() => {
    if (!filteredTransactions.length) return null

    return {
      byDay: aggregateByDay(filteredTransactions),
      byCategory: aggregateByCategory(filteredTransactions),
      byBusiness: aggregateByBusiness(filteredTransactions),
      byLocation: aggregateByLocation(filteredTransactions),
      byCardholder: aggregateByCardholder(filteredTransactions),
      byLabel: aggregateByLabel(filteredTransactions),
    }
  }, [filteredTransactions])

  // Drill-down data for business chart
  const businessDrillDownData = useMemo(() => {
    if (!drilledBusiness || !filteredTransactions.length) return undefined
    return aggregateByDescription(filteredTransactions, drilledBusiness)
  }, [filteredTransactions, drilledBusiness])

  // Cardholder totals for summary widget
  const cardholderTotals = useMemo(() => {
    return aggregateByCardholder(transactions)
  }, [transactions])

  // Installment projections (based on all transactions, not filtered)
  const installmentProjections = useMemo(() => {
    return analyzeInstallments(transactions)
  }, [transactions])

  // Aggregates for filtered data
  const aggregates = useMemo(() => {
    const total = filteredTransactions.reduce((sum, t) => sum + t.amount, 0)
    return {
      total,
      count: filteredTransactions.length,
      totalCount: transactions.length,
    }
  }, [filteredTransactions, transactions])

  // Filter handlers
  const setFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    // Clear drill-down when business filter is cleared
    if (key === 'business' && !value) {
      setDrilledBusiness('')
    }
  }

  const clearFilters = () => {
    setFilters(emptyFilters)
    setDrilledBusiness('')
  }

  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  // Active filter labels for display
  const activeFilterLabels = useMemo(() => {
    const labels: { key: keyof Filters; label: string; value: string }[] = []
    if (filters.cardholder) labels.push({ key: 'cardholder', label: 'Cardholder', value: filters.cardholder })
    if (filters.category) labels.push({ key: 'category', label: 'Category', value: filters.category })
    if (filters.business) labels.push({ key: 'business', label: 'Business', value: filters.business })
    if (filters.location) labels.push({ key: 'location', label: 'Location', value: filters.location })
    if (filters.label) labels.push({ key: 'label', label: 'Label', value: filters.label })
    if (filters.search) labels.push({ key: 'search', label: 'Search', value: filters.search })
    if (filters.dateFrom) labels.push({ key: 'dateFrom', label: 'From', value: filters.dateFrom })
    if (filters.dateTo) labels.push({ key: 'dateTo', label: 'To', value: filters.dateTo })
    return labels
  }, [filters])

  return (
    <div className="app-layout">
      {/* Main Content */}
      <div className="main-content">
        <div className="container">
          <div className="app-header">
            <div>
              <h1>Statement Analyzer</h1>
              <p className="subtitle">Upload your Itau credit card statements to analyze expenses</p>
            </div>
            <div className="view-tabs">
              <button
                type="button"
                className={`view-tab ${viewMode === 'dashboard' ? 'active' : ''}`}
                onClick={() => setViewMode('dashboard')}
              >
                Dashboard
              </button>
              <button
                type="button"
                className={`view-tab ${viewMode === 'classifier' ? 'active' : ''}`}
                onClick={() => setViewMode('classifier')}
              >
                Classify
              </button>
            </div>
          </div>

          {viewMode === 'classifier' ? (
            <Classifier labels={labels} statementIds={selectedStatementIds} onLabelsChanged={fetchLabels} />
          ) : (
          <>
          <form onSubmit={handleSubmit} className="upload-form">
            <div className="form-group">
              <label htmlFor="files">PDF Statements (select multiple)</label>
              <input
                type="file"
                id="files"
                accept=".pdf"
                multiple
                onChange={handleFileChange}
                disabled={uploading}
              />
              {files && files.length > 0 && (
                <span className="file-name">
                  {files.length} file{files.length > 1 ? 's' : ''} selected
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="password">PDF Password (same for all files)</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter PDF password"
                disabled={uploading}
              />
            </div>

            <button type="submit" disabled={uploading || !files}>
              {uploading ? 'Uploading...' : 'Upload Statements'}
            </button>
          </form>

          {uploadError && <div className="error">{uploadError}</div>}

          {uploadResults && (
            <div className="upload-results">
              <h4>Upload Results</h4>
              <p>
                {uploadResults.total_uploaded} uploaded,{' '}
                {uploadResults.total_duplicates} duplicates,{' '}
                {uploadResults.total_errors} errors
              </p>
              {uploadResults.results.map((r, i) => (
                <div key={i} className={`upload-result ${r.success ? (r.is_duplicate ? 'duplicate' : 'success') : 'error'}`}>
                  <strong>{r.filename}</strong>: {r.message}
                </div>
              ))}
            </div>
          )}

          {/* Summary Widget */}
          {transactions.length > 0 && (
            <div className="results">
              <div className="summary-widget">
                <div className="summary-main">
                  <h2>Summary</h2>
                  <div className="total-badge large">
                    <span className="label">Total ({selectedStatementIds.length} statements)</span>
                    <span className="value">{formatCurrency(totalAmount)}</span>
                  </div>
                  <p className="transaction-count">
                    {transactions.length} transactions
                  </p>
                </div>

                <div className="summary-cardholders">
                  <h4>By Cardholder</h4>
                  <div className="cardholder-list">
                    {cardholderTotals.map((ch, index) => (
                      <div
                        key={index}
                        className={`cardholder-item ${filters.cardholder === ch.name ? 'active' : ''}`}
                        onClick={() => setFilter('cardholder', filters.cardholder === ch.name ? '' : ch.name)}
                      >
                        <span className="cardholder-name">{ch.name}</span>
                        <span className="cardholder-amount">{formatCurrency(ch.value)}</span>
                        <span className="cardholder-count">{ch.count} txns</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Data Visualization Section */}
              {chartData && (
                <div className="charts-section">
                  <div className="section-header">
                    <h2>Data Visualization</h2>

                    {/* Filter Controls */}
                    <div className="filter-controls">
                      <div className="search-box">
                        <input
                          type="text"
                          placeholder="Search establishment..."
                          value={filters.search}
                          onChange={(e) => setFilter('search', e.target.value)}
                        />
                      </div>
                      <div className="date-filters">
                        <input
                          type="text"
                          placeholder="From (DD/MM)"
                          value={filters.dateFrom}
                          onChange={(e) => setFilter('dateFrom', e.target.value)}
                          maxLength={5}
                        />
                        <input
                          type="text"
                          placeholder="To (DD/MM)"
                          value={filters.dateTo}
                          onChange={(e) => setFilter('dateTo', e.target.value)}
                          maxLength={5}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Active Filters Display */}
                  {hasActiveFilters && (
                    <div className="active-filters">
                      <span className="filter-label">Filtering by:</span>
                      {activeFilterLabels.map(({ key, label, value }) => (
                        <span key={key} className="filter-tag">
                          {label}: {value}
                          <button
                            type="button"
                            onClick={() => setFilter(key, '')}
                            className="remove-filter"
                          >
                            x
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={clearFilters} className="clear-all-filters">
                        Clear all
                      </button>
                    </div>
                  )}

                  {/* Filtered Stats */}
                  <div className="filtered-stats">
                    <span>
                      Showing <strong>{aggregates.count}</strong> of <strong>{aggregates.totalCount}</strong> transactions
                    </span>
                    <span className="filtered-total">
                      Filtered Total: <strong>{formatCurrency(aggregates.total)}</strong>
                    </span>
                  </div>

                  {/* Charts Grid */}
                  <div className="charts-grid">
                    <ExpensesByCardholderChart
                      data={chartData.byCardholder}
                      title="Expenses by Cardholder"
                      onSelect={(value) => setFilter('cardholder', value)}
                      selectedValue={filters.cardholder}
                    />

                    <ExpensesByDayChart
                      data={chartData.byDay}
                      title="Expenses by Day"
                    />

                    <ExpensesByCategoryChart
                      data={chartData.byCategory}
                      title="Expenses by Category"
                      onSelect={(value) => setFilter('category', value)}
                      selectedValue={filters.category}
                    />

                    <ExpensesByLocationChart
                      data={chartData.byLocation}
                      title="Expenses by Location"
                      onSelect={(value) => setFilter('location', value)}
                      selectedValue={filters.location}
                    />

                    <ExpensesByLabelChart
                      data={chartData.byLabel}
                      title="Expenses by Label"
                      onSelect={(value) => setFilter('label', value)}
                      selectedValue={filters.label}
                    />

                    <LabelExpensesTable
                      data={chartData.byLabel}
                      title="Labels"
                      onSelect={(value) => setFilter('label', value)}
                      selectedValue={filters.label}
                    />

                    <div className="chart-full-width">
                      <ExpensesByBusinessChart
                        data={chartData.byBusiness}
                        title="Top 25 Businesses"
                        drillDownData={businessDrillDownData}
                        onDrillDown={(business) => {
                          setDrilledBusiness(business)
                          setFilter('business', business)
                        }}
                        drilledBusiness={drilledBusiness}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Transactions Table */}
              {sortedTransactions.length > 0 && (
                <div className="transactions-section">
                  <h2>Transactions</h2>

                  <div className="transactions-table-container">
                    <table className="transactions-table">
                      <thead>
                        <tr>
                          <th className="sortable" onClick={() => handleSort('date')}>
                            Date{getSortIndicator('date')}
                          </th>
                          <th className="sortable" onClick={() => handleSort('establishment')}>
                            Establishment{getSortIndicator('establishment')}
                          </th>
                          <th className="sortable" onClick={() => handleSort('category')}>
                            Category{getSortIndicator('category')}
                          </th>
                          <th className="sortable" onClick={() => handleSort('cardholder')}>
                            Cardholder{getSortIndicator('cardholder')}
                          </th>
                          <th className="sortable" onClick={() => handleSort('card_last_digits')}>
                            Card{getSortIndicator('card_last_digits')}
                          </th>
                          <th className="sortable" onClick={() => handleSort('installment')}>
                            Installment{getSortIndicator('installment')}
                          </th>
                          <th>Labels</th>
                          <th className="sortable amount" onClick={() => handleSort('amount')}>
                            Amount{getSortIndicator('amount')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedTransactions.map((t) => (
                          <tr key={t.id} className={t.amount < 0 ? 'refund-row' : ''}>
                            <td className="date">{t.date || '-'}</td>
                            <td className="establishment" title={t.establishment}>
                              {t.establishment}
                            </td>
                            <td
                              className="category clickable"
                              onClick={() => t.category && setFilter('category', filters.category === t.category ? '' : t.category)}
                            >
                              {t.category || '-'}
                            </td>
                            <td
                              className="cardholder clickable"
                              onClick={() => t.cardholder && setFilter('cardholder', filters.cardholder === t.cardholder ? '' : t.cardholder)}
                            >
                              {t.cardholder || '-'}
                            </td>
                            <td className="card">****{t.card_last_digits || '????'}</td>
                            <td className="installment">{t.installment || '-'}</td>
                            <td className="labels-cell">
                              <div className="labels-cell-inner">
                                {t.labels && t.labels.map(l => (
                                  <span
                                    key={`${l.id}-${l.scope}`}
                                    className="label-badge"
                                    onClick={() => setFilter('label', filters.label === l.name ? '' : l.name)}
                                    title={`Scope: ${l.scope}`}
                                  >
                                    {l.name}
                                    <span className="label-scope-indicator">{l.scope === 'transaction' ? 'T' : l.scope === 'establishment' ? 'E' : 'B'}</span>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  className="add-label-btn"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (labelPopoverTxId === t.id) {
                                      setLabelPopoverTxId(null)
                                      setLabelPopoverAnchor(null)
                                    } else {
                                      setLabelPopoverAnchor(e.currentTarget.getBoundingClientRect())
                                      setLabelPopoverTxId(t.id)
                                    }
                                  }}
                                >
                                  +
                                </button>
                              </div>
                              {labelPopoverTxId === t.id && (
                                <LabelPopover
                                  transaction={t}
                                  labels={labels}
                                  anchorRect={labelPopoverAnchor}
                                  onClose={() => { setLabelPopoverTxId(null); setLabelPopoverAnchor(null) }}
                                  onAssign={handleAssignLabel}
                                  onUnassign={handleUnassignLabel}
                                  onCreateAndAssign={handleCreateAndAssignLabel}
                                  onDeleteLabel={handleDeleteLabel}
                                />
                              )}
                            </td>
                            <td className={`amount ${t.amount < 0 ? 'refund' : ''}`}>
                              {formatCurrency(t.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Installments Section */}
              {installmentProjections.length > 0 && (
                <div className="installments-section">
                  <h2>Installments Projection</h2>
                  <p className="installments-description">
                    Future payments based on current installment plans
                  </p>
                  <div className="installments-grid">
                    {installmentProjections.map((projection) => (
                      <InstallmentCard key={projection.monthOffset} projection={projection} formatCurrency={formatCurrency} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loadingStatements && statements.length === 0 && (
            <div className="empty-state">
              <p>No statements uploaded yet. Upload your first statement above.</p>
            </div>
          )}

          {loadingTransactions && (
            <div className="loading">Loading transactions...</div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Timeline Sidebar */}
      <div className="timeline-sidebar">
        <div className="sidebar-header">
          <h3>Statements</h3>
          <div className="sidebar-actions">
            <button type="button" onClick={selectAllStatements} className="sidebar-btn">
              All
            </button>
            <button type="button" onClick={deselectAllStatements} className="sidebar-btn">
              None
            </button>
          </div>
        </div>

        {loadingStatements ? (
          <div className="sidebar-loading">Loading...</div>
        ) : statements.length === 0 ? (
          <div className="sidebar-empty">No statements yet</div>
        ) : (
          <div className="timeline">
            {statements.map((statement) => (
              <div
                key={statement.id}
                className={`timeline-item ${selectedStatementIds.includes(statement.id) ? 'selected' : ''}`}
              >
                <div
                  className="timeline-content"
                  onClick={() => toggleStatementSelection(statement.id)}
                >
                  <div className="timeline-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedStatementIds.includes(statement.id)}
                      onChange={() => toggleStatementSelection(statement.id)}
                    />
                  </div>
                  <div className="timeline-details">
                    <div className="timeline-period">
                      {statement.period_start
                        ? formatPeriod(statement.period_start)
                        : 'Unknown period'}
                    </div>
                    <div className="timeline-filename" title={statement.filename}>
                      {statement.filename}
                    </div>
                    <div className="timeline-meta">
                      <span className="timeline-total">{formatCurrency(statement.total)}</span>
                      <span className="timeline-count">{statement.transaction_count} txns</span>
                    </div>
                    <div className="timeline-date">
                      Added {formatDate(statement.created_at)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="timeline-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteStatement(statement.id)
                  }}
                  title="Delete statement"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
