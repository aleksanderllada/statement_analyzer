import type { Transaction } from '../types'

export interface AggregatedData {
  name: string
  value: number
  count: number
  [key: string]: string | number
}

export interface Filters {
  search: string
  cardholder: string
  category: string
  location: string
  business: string
  dateFrom: string
  dateTo: string
}

export const emptyFilters: Filters = {
  search: '',
  cardholder: '',
  category: '',
  location: '',
  business: '',
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
    if (filters.category && t.category !== filters.category) {
      return false
    }

    // Location filter (with case normalization)
    if (filters.location) {
      const normalizedLocation = t.location ? normalizeLocationCase(t.location) : ''
      if (normalizedLocation !== filters.location) {
        return false
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
