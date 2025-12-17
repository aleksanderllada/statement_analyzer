# Itaú Credit Card Statement Analyzer

Web application for extracting and analyzing transaction data from password-protected Itaú Personnalité credit card PDF statements.

## Quick Start

```bash
# Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start backend (terminal 1)
uvicorn backend.main:app --port 8001

# Start frontend (terminal 2)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Project Structure

```
statement_analyzer/
├── CLAUDE.md                 # This file
├── requirements.txt          # Python dependencies
├── parsers/
│   ├── __init__.py          # Module exports
│   ├── base.py              # Abstract StatementParser class & Transaction dataclass
│   └── itau.py              # ItauParser implementation
├── backend/
│   └── main.py              # FastAPI server
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx          # React app with file upload & results table
│       ├── App.css          # Component styling
│       └── index.css        # Base styling
├── statement_parser.py       # Standalone script (legacy)
└── venv/                     # Virtual environment
```

## Architecture

### Parser Classes

The parser system uses an abstract base class for extensibility:

```python
from parsers import ItauParser

parser = ItauParser()
with open("statement.pdf", "rb") as f:
    df = parser.parse(f, password="12345")
    summary = parser.get_summary_by_card(df)
```

**Base Class (`parsers/base.py`):**
- `StatementParser` - Abstract base class defining the parser interface
- `Transaction` - Dataclass for transaction data

**ItauParser (`parsers/itau.py`):**
- `parse(file, password)` - Returns DataFrame of transactions
- `validate(file)` - Checks if file is a valid Itaú statement
- `get_summary_by_card(df)` - Groups spending by card
- `get_summary_by_category(df)` - Groups spending by category

### Backend API

FastAPI server running on port 8001.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| GET | `/banks` | List supported banks |
| POST | `/parse` | Parse a statement PDF |

**POST /parse**

```bash
curl -X POST "http://localhost:8001/parse" \
  -F "file=@statement.pdf" \
  -F "password=12345" \
  -F "bank=itau"
```

Response:
```json
{
  "success": true,
  "message": "Successfully parsed 218 transactions.",
  "transactions": [...],
  "summary": {
    "cards": [
      {
        "cardholder": "JOHN DOE",
        "card_last_digits": "9373",
        "total": 3575.12,
        "transaction_count": 45
      }
    ],
    "total": 30919.69,
    "transaction_count": 218
  },
  "total": 30919.69,
  "transaction_count": 218
}
```

### Frontend

React + TypeScript + Vite application running on port 5173.

Features:
- PDF file upload with drag-and-drop
- Password input for encrypted statements
- Summary table showing expenses by card
- Brazilian currency formatting (R$)

## Implementation Details

### PDF Text Extraction

Uses PyMuPDF (`fitz`) to extract text from password-protected PDFs. The Itaú statement has a multi-column layout that gets linearized during extraction, producing text in this sequential pattern:

```
DD/MM              <- transaction date
ESTABLISHMENT      <- merchant name (may include installment suffix)
AMOUNT             <- value in Brazilian format (1.234,56)
```

Categories appear in a separate block at the bottom of each page:
```
CATEGORY .LOCATION
```

### Transaction Parsing Cases

The parser handles three transaction formats:

1. **Standard**: `DATE → ESTABLISHMENT → AMOUNT` (3 lines)
2. **Separate installment**: `DATE → ESTABLISHMENT → INSTALLMENT → AMOUNT` (4 lines)
3. **Wrapped name**: `DATE → EST_PART1 → EST_PART2+INSTALLMENT → AMOUNT` (4 lines)

Installments like `06/12` at the end of establishment names mean "installment 6 of 12".

### Cardholder Assignment Algorithm

1. Extract all card totals from the document (e.g., "Lançamentos no cartão (final 9373): 3.575,12")
2. Process transactions in order, maintaining a running sum
3. When running sum matches a card's total (±R$0.50), switch to next card
4. This works because transactions are grouped by card in the PDF

### Category Assignment

Categories appear in the same order as transactions but in a separate text block. The parser:
1. Collects all categories in order
2. Assigns category[i] to transaction[i]

**Caveat**: Wrapped establishment names create alignment issues, leaving ~50 transactions without categories.

## Known Caveats & Limitations

### 1. Multi-Column PDF Layout
The PDF has a two-column layout on some pages. PyMuPDF extracts left-to-right, which can interleave:
- Current month transactions with future installments
- Transaction data with category data

**Mitigation**: The parser stops at "próximas faturas" and filters consecutive installment duplicates.

### 2. Category Misalignment
When establishment names wrap to multiple lines, the category count doesn't match transaction count. About 50 transactions may have empty categories.

**Impact**: Category-based analysis is ~80% complete. Transactions are still correct.

### 3. International Transactions
The PDF shows international transactions twice:
- With merchant names (XERO, CLOUDFLARE) in regular transaction flow
- With city names (DENVER, SAN FRANCISCO) in "Lançamentos internacionais" section

**Solution**: We only parse merchant names. The city-based section is informational only.

### 4. IOF Tax
International transaction tax (IOF) appears separately as "Repasse de IOF em R$". It's added as a single line item with category "IMPOSTOS".

### 5. Encrypted PDF Validation
Encrypted PDFs cannot be validated before providing the password. The `validate()` method returns `true` for encrypted files, deferring validation to the parse step.

### 6. Date Format
Dates are DD/MM only (no year). The year must be inferred from the statement period or filename.

### 7. Negative Amounts
Refunds appear as negative amounts (e.g., "- 391,25"). The parser handles these correctly.

## Output Schema

| Column | Type | Description |
|--------|------|-------------|
| `date` | str | Transaction date (DD/MM) |
| `establishment` | str | Merchant name |
| `amount` | float | Value in R$ (negative for refunds) |
| `cardholder` | str | Card owner name |
| `card_last_digits` | str | Last 4 digits of card |
| `category` | str | Spending category (may be empty) |
| `location` | str | City (may be empty) |
| `installment` | str | Format "XX/YY" or empty |

## Categories (Portuguese)

- ALIMENTAÇÃO - Food & restaurants
- DIVERSOS - Miscellaneous
- EDUCAÇÃO - Education
- HOBBY - Hobbies & entertainment
- IMPOSTOS - Taxes (IOF)
- MORADIA - Housing
- SAÚDE - Health & pharmacy
- TURISMO E ENTRETENIM - Travel & entertainment
- VEÍCULOS - Transportation/Uber
- VESTUÁRIO - Clothing

## Testing

The parser was validated against a December 2025 statement:
- **218 transactions** parsed
- **R$ 30,919.69** total (matches PDF exactly)
- 5 cardholders across multiple cards

## Adding New Banks

To support a new bank:

1. Create `parsers/newbank.py`:
```python
from .base import StatementParser, Transaction

class NewBankParser(StatementParser):
    BANK_NAME = "New Bank"
    SUPPORTED_FORMATS = ["pdf"]

    def parse(self, file, password=None):
        # Implementation
        pass

    def validate(self, file):
        # Implementation
        pass
```

2. Export in `parsers/__init__.py`:
```python
from .newbank import NewBankParser
__all__ = ["StatementParser", "ItauParser", "NewBankParser"]
```

3. Add bank to `backend/main.py` parse endpoint.

## Dependencies

**Python (requirements.txt):**
```
pymupdf>=1.24.0      # PDF parsing with encryption support
pandas>=2.0.0        # Data manipulation
fastapi>=0.109.0     # Web framework
uvicorn>=0.27.0      # ASGI server
python-multipart>=0.0.6  # File upload support
```

**Frontend (package.json):**
- React 18
- TypeScript
- Vite

## Common Issues

### "Invalid PDF password"
The password is typically the CPF (Brazilian tax ID) or a numeric code. Check your bank app for the statement password.

### Empty DataFrame
Ensure the PDF is an Itaú Personnalité statement. Other Itaú products (Uniclass, etc.) may have different formats.

### Missing transactions
Check if transactions fall after "Compras parceladas - próximas faturas" section - these are future charges, not current.

### Port already in use
The backend defaults to port 8001. If unavailable, change in `backend/main.py` and update `frontend/src/App.tsx` to match.

### CORS errors
Ensure the backend CORS middleware includes your frontend URL (localhost:5173 or localhost:3000).
