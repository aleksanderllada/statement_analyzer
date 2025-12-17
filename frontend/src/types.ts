export interface Transaction {
  date: string
  establishment: string
  amount: number
  cardholder: string
  card_last_digits: string
  category: string
  location: string
  installment: string
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
