import { useState, useMemo, type FormEvent, type ChangeEvent } from 'react'
import './App.css'
import type { ParseResponse } from './types'
import {
  aggregateByDay,
  aggregateByCategory,
  aggregateByBusiness,
  aggregateByLocation,
  aggregateByCardholder,
  aggregateByDescription,
  filterTransactions,
  emptyFilters,
  type Filters,
} from './utils/aggregations'
import {
  ExpensesByDayChart,
  ExpensesByCategoryChart,
  ExpensesByBusinessChart,
  ExpensesByLocationChart,
  ExpensesByCardholderChart,
} from './components/Charts'

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResponse | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [drilledBusiness, setDrilledBusiness] = useState('')

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setError(null)
      setResult(null)
      setFilters(emptyFilters)
      setDrilledBusiness('')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!file) {
      setError('Please select a PDF file')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('password', password)
    formData.append('bank', 'itau')

    try {
      const response = await fetch('http://localhost:8001/parse', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to parse statement')
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value)
  }

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    if (!result?.transactions) return []
    return filterTransactions(result.transactions, filters)
  }, [result?.transactions, filters])

  // Chart data based on filtered transactions
  const chartData = useMemo(() => {
    if (!filteredTransactions.length) return null

    return {
      byDay: aggregateByDay(filteredTransactions),
      byCategory: aggregateByCategory(filteredTransactions),
      byBusiness: aggregateByBusiness(filteredTransactions),
      byLocation: aggregateByLocation(filteredTransactions),
      byCardholder: aggregateByCardholder(filteredTransactions),
    }
  }, [filteredTransactions])

  // Drill-down data for business chart
  const businessDrillDownData = useMemo(() => {
    if (!drilledBusiness || !filteredTransactions.length) return undefined
    return aggregateByDescription(filteredTransactions, drilledBusiness)
  }, [filteredTransactions, drilledBusiness])

  // Cardholder totals for summary widget (always from all transactions)
  const cardholderTotals = useMemo(() => {
    if (!result?.transactions) return []
    return aggregateByCardholder(result.transactions)
  }, [result?.transactions])

  // Aggregates for filtered data
  const aggregates = useMemo(() => {
    const total = filteredTransactions.reduce((sum, t) => sum + t.amount, 0)
    return {
      total,
      count: filteredTransactions.length,
      totalCount: result?.transactions?.length || 0,
    }
  }, [filteredTransactions, result?.transactions])

  // Filter handlers
  const setFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
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
    if (filters.search) labels.push({ key: 'search', label: 'Search', value: filters.search })
    if (filters.dateFrom) labels.push({ key: 'dateFrom', label: 'From', value: filters.dateFrom })
    if (filters.dateTo) labels.push({ key: 'dateTo', label: 'To', value: filters.dateTo })
    return labels
  }, [filters])

  return (
    <div className="container">
      <h1>Statement Analyzer</h1>
      <p className="subtitle">Upload your Itau credit card statement to analyze expenses</p>

      <form onSubmit={handleSubmit} className="upload-form">
        <div className="form-group">
          <label htmlFor="file">PDF Statement</label>
          <input
            type="file"
            id="file"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={loading}
          />
          {file && <span className="file-name">{file.name}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="password">PDF Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter PDF password"
            disabled={loading}
          />
        </div>

        <button type="submit" disabled={loading || !file}>
          {loading ? 'Processing...' : 'Analyze Statement'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {result && result.success && (
        <div className="results">
          {/* Summary Header with Cardholder Breakdown */}
          <div className="summary-widget">
            <div className="summary-main">
              <h2>Summary</h2>
              <div className="total-badge large">
                <span className="label">Total</span>
                <span className="value">{formatCurrency(result.total)}</span>
              </div>
              <p className="transaction-count">
                {result.transaction_count} transactions
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

                <div className="chart-full-width">
                  <ExpensesByBusinessChart
                    data={chartData.byBusiness}
                    title="Top 15 Businesses"
                    drillDownData={businessDrillDownData}
                    onDrillDown={setDrilledBusiness}
                    drilledBusiness={drilledBusiness}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Transactions Table */}
          {filteredTransactions.length > 0 && (
            <div className="transactions-section">
              <h2>Transactions</h2>

              <div className="transactions-table-container">
                <table className="transactions-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Establishment</th>
                      <th>Category</th>
                      <th>Cardholder</th>
                      <th>Card</th>
                      <th>Installment</th>
                      <th className="amount">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((t, index) => (
                      <tr key={index} className={t.amount < 0 ? 'refund-row' : ''}>
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
                        <td className={`amount ${t.amount < 0 ? 'refund' : ''}`}>
                          {formatCurrency(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredTransactions.length === 0 && (
                  <p className="no-results">No transactions match the current filters</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
