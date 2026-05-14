export type LabelScope = 'transaction' | 'business' | 'establishment'

export interface Label {
  id: number
  name: string
  scope: LabelScope
  match_value: string
}

export interface LabelInfo {
  id: number
  name: string
  created_at: string
}

export interface Transaction {
  id: number
  date: string
  establishment: string
  amount: number
  cardholder: string
  card_last_digits: string
  category: string
  location: string
  installment: string
  labels: Label[]
}

export interface CardSummary {
  cardholder: string
  card_last_digits: string
  total: number
  transaction_count: number
}

export interface ParseResponse {
  success: boolean
  message: string
  transactions: Transaction[]
  summary: {
    cards: CardSummary[]
    total: number
    transaction_count: number
  }
  total: number
  transaction_count: number
}

export interface StatementInfo {
  id: number
  filename: string
  bank: string
  period_start: string | null
  period_end: string | null
  total: number
  transaction_count: number
  created_at: string
}

export interface BatchUploadResult {
  filename: string
  success: boolean
  message: string
  statement_id: number | null
  is_duplicate: boolean
}

export interface BatchUploadResponse {
  results: BatchUploadResult[]
  total_uploaded: number
  total_duplicates: number
  total_errors: number
}

export interface StatementsTransactionsResponse {
  transactions: Transaction[]
  total: number
  transaction_count: number
}
