import type { Transaction } from '../types'

export interface AggregatedData {
  name: string
  value: number
  count: number
  [key: string]: string | number
}

export interface InstallmentProjection {
  monthOffset: number // 0 = current, 1 = next month, etc.
  label: string
  total: number
  count: number
  items: {
    establishment: string
    currentInstallment: number
    totalInstallments: number
    amount: number
  }[]
}

export interface Filters {
  search: string
  cardholder: string
  category: string
  location: string
  business: string
  label: string
  dateFrom: string
  dateTo: string
}

export const emptyFilters: Filters = {
  search: '',
  cardholder: '',
  category: '',
  location: '',
  business: '',
  label: '',
  dateFrom: '',
  dateTo: '',
}

/**
 * Extract business name from establishment, handling * separator
 * e.g., "IFD*RESTAURANTE X" -> "IFD"
 *       "RAPPI*LOJA Y" -> "RAPPI"
 *       "UBER" -> "UBER"
 */
export function extractBusinessName(establishment: string): string {
  if (establishment.includes('*')) {
    return establishment.split('*')[0].trim()
  }
  return establishment.trim()
}

/**
 * Extract description from establishment (the part after *)
 * e.g., "IFD*RESTAURANTE X" -> "RESTAURANTE X"
 *       "RAPPI*LOJA Y" -> "LOJA Y"
 *       "UBER" -> "UBER" (no separator, return full name)
 */
export function extractDescription(establishment: string): string {
  if (establishment.includes('*')) {
    return establishment.split('*').slice(1).join('*').trim()
  }
  return establishment.trim()
}

/**
 * Extract business key (lowercased business name) for label matching
 */
export function extractBusinessKey(establishment: string): string {
  return extractBusinessName(establishment).toLowerCase()
}

/**
 * Normalize location case to Title Case
 * e.g., "SAO PAULO" -> "Sao Paulo", "sao paulo" -> "Sao Paulo"
 */
export function normalizeLocationCase(location: string): string {
  if (!location) return location
  return location
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Filter transactions based on active filters
 */
export function filterTransactions(transactions: Transaction[], filters: Filters): Transaction[] {
  return transactions.filter(t => {
    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      const establishment = t.establishment.toLowerCase()
      const business = extractBusinessName(t.establishment).toLowerCase()
      if (!establishment.includes(searchLower) && !business.includes(searchLower)) {
        return false
      }
    }

    // Cardholder filter
    if (filters.cardholder && t.cardholder !== filters.cardholder) {
      return false
    }

    // Category filter
    if (filters.category) {
      // Handle "Sem categoria" filter - match empty/null categories
      if (filters.category === 'Sem categoria') {
        if (t.category && t.category.trim() !== '') {
          return false
        }
      } else if (t.category !== filters.category) {
        return false
      }
    }

    // Location filter (with case normalization)
    if (filters.location) {
      // Handle "Sem localizacao" filter - match empty/null locations
      if (filters.location === 'Sem localizacao') {
        if (t.location && t.location.trim() !== '') {
          return false
        }
      } else {
        const normalizedLocation = t.location ? normalizeLocationCase(t.location) : ''
        if (normalizedLocation !== filters.location) {
          return false
        }
      }
    }

    // Label filter
    if (filters.label) {
      if (filters.label === 'Sem label') {
        if (t.labels && t.labels.length > 0) {
          return false
        }
      } else {
        if (!t.labels || !t.labels.some(l => l.name === filters.label)) {
          return false
        }
      }
    }

    // Business filter
    if (filters.business) {
      const business = extractBusinessName(t.establishment)
      if (business !== filters.business) {
        return false
      }
    }

    // Date filters (DD/MM format)
    if (filters.dateFrom && t.date) {
      const [dayFrom, monthFrom] = filters.dateFrom.split('/').map(Number)
      const [day, month] = t.date.split('/').map(Number)
      if (month < monthFrom || (month === monthFrom && day < dayFrom)) {
        return false
      }
    }

    if (filters.dateTo && t.date) {
      const [dayTo, monthTo] = filters.dateTo.split('/').map(Number)
      const [day, month] = t.date.split('/').map(Number)
      if (month > monthTo || (month === monthTo && day > dayTo)) {
        return false
      }
    }

    return true
  })
}

/**
 * Aggregate transactions by day (DD/MM)
 */
export function aggregateByDay(transactions: Transaction[]): AggregatedData[] {
  const byDay = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    if (!t.date) continue
    const existing = byDay.get(t.date) || { value: 0, count: 0 }
    byDay.set(t.date, {
      value: existing.value + t.amount,
      count: existing.count + 1,
    })
  }

  // Sort by date (DD/MM)
  return Array.from(byDay.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => {
      const [dayA, monthA] = a.name.split('/').map(Number)
      const [dayB, monthB] = b.name.split('/').map(Number)
      if (monthA !== monthB) return monthA - monthB
      return dayA - dayB
    })
}

/**
 * Aggregate transactions by category
 */
export function aggregateByCategory(transactions: Transaction[]): AggregatedData[] {
  const byCategory = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    const category = t.category || 'Sem categoria'
    const existing = byCategory.get(category) || { value: 0, count: 0 }
    byCategory.set(category, {
      value: existing.value + t.amount,
      count: existing.count + 1,
    })
  }

  // Sort by value descending
  return Array.from(byCategory.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Aggregate transactions by business (using * separator logic)
 */
export function aggregateByBusiness(transactions: Transaction[]): AggregatedData[] {
  const byBusiness = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    const business = extractBusinessName(t.establishment)
    const existing = byBusiness.get(business) || { value: 0, count: 0 }
    byBusiness.set(business, {
      value: existing.value + t.amount,
      count: existing.count + 1,
    })
  }

  // Sort by value descending
  return Array.from(byBusiness.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Aggregate transactions by location/town
 */
export function aggregateByLocation(transactions: Transaction[]): AggregatedData[] {
  const byLocation = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    const rawLocation = t.location || ''
    const location = rawLocation ? normalizeLocationCase(rawLocation) : 'Sem localizacao'
    const existing = byLocation.get(location) || { value: 0, count: 0 }
    byLocation.set(location, {
      value: existing.value + t.amount,
      count: existing.count + 1,
    })
  }

  // Sort by value descending
  return Array.from(byLocation.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Aggregate transactions by cardholder
 */
export function aggregateByCardholder(transactions: Transaction[]): AggregatedData[] {
  const byCardholder = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    const cardholder = t.cardholder || 'Desconhecido'
    const existing = byCardholder.get(cardholder) || { value: 0, count: 0 }
    byCardholder.set(cardholder, {
      value: existing.value + t.amount,
      count: existing.count + 1,
    })
  }

  // Sort by value descending
  return Array.from(byCardholder.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Aggregate transactions by label
 * Transactions with multiple labels contribute to each label's total.
 * Unlabeled transactions go under "Sem label".
 */
export function aggregateByLabel(transactions: Transaction[]): AggregatedData[] {
  const byLabel = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    if (!t.labels || t.labels.length === 0) {
      const existing = byLabel.get('Sem label') || { value: 0, count: 0 }
      byLabel.set('Sem label', {
        value: existing.value + t.amount,
        count: existing.count + 1,
      })
    } else {
      for (const label of t.labels) {
        const existing = byLabel.get(label.name) || { value: 0, count: 0 }
        byLabel.set(label.name, {
          value: existing.value + t.amount,
          count: existing.count + 1,
        })
      }
    }
  }

  return Array.from(byLabel.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Aggregate transactions by description (after *) for a specific business
 * Used for drill-down view when a business is selected
 */
export function aggregateByDescription(transactions: Transaction[], businessName: string): AggregatedData[] {
  const byDescription = new Map<string, { value: number; count: number }>()

  for (const t of transactions) {
    const business = extractBusinessName(t.establishment)
    if (business !== businessName) continue

    const description = extractDescription(t.establishment)
    const existing = byDescription.get(description) || { value: 0, count: 0 }
    byDescription.set(description, {
      value: existing.value + t.amount,
      count: existing.count + 1,
    })
  }

  // Sort by value descending
  return Array.from(byDescription.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Parse installment string (e.g., "06/12") into current and total
 */
function parseInstallment(installment: string): { current: number; total: number } | null {
  if (!installment || !installment.includes('/')) return null
  const parts = installment.split('/')
  if (parts.length !== 2) return null
  const current = parseInt(parts[0], 10)
  const total = parseInt(parts[1], 10)
  if (isNaN(current) || isNaN(total)) return null
  return { current, total }
}

/**
 * Analyze installments and project future payments
 * Returns projections for current month and upcoming months
 */
export function analyzeInstallments(transactions: Transaction[]): InstallmentProjection[] {
  const monthLabels = [
    'This month',
    'Next month',
    'In 2 months',
    'In 3 months',
    'In 4 months',
    'In 5 months',
    'In 6 months',
    'In 7 months',
    'In 8 months',
    'In 9 months',
    'In 10 months',
    'In 11 months',
    'In 12 months',
  ]

  // Map: monthOffset -> items
  const projectionMap = new Map<number, InstallmentProjection['items']>()

  for (const t of transactions) {
    const parsed = parseInstallment(t.installment)
    if (!parsed) continue

    const { current, total } = parsed
    const remainingPayments = total - current + 1 // Including current month

    // For each remaining payment (including current)
    for (let i = 0; i < remainingPayments; i++) {
      const items = projectionMap.get(i) || []
      items.push({
        establishment: t.establishment,
        currentInstallment: current + i,
        totalInstallments: total,
        amount: t.amount,
      })
      projectionMap.set(i, items)
    }
  }

  // Convert to array and calculate totals
  const projections: InstallmentProjection[] = []

  for (let monthOffset = 0; monthOffset < 13; monthOffset++) {
    const items = projectionMap.get(monthOffset) || []
    if (items.length === 0 && monthOffset > 0) continue // Skip empty future months

    projections.push({
      monthOffset,
      label: monthLabels[monthOffset] || `In ${monthOffset} months`,
      total: items.reduce((sum, item) => sum + item.amount, 0),
      count: items.length,
      items: items.sort((a, b) => b.amount - a.amount),
    })
  }

  return projections
}
