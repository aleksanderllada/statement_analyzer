"""
FastAPI backend for credit card statement analysis.
"""

import re
import sys
from io import BytesIO
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from parsers import ItauParser
from backend import database as db

app = FastAPI(
    title="Statement Analyzer API",
    description="API for parsing and analyzing credit card statements",
    version="1.0.0",
)

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TransactionResponse(BaseModel):
    """Single transaction in the response."""
    date: str
    establishment: str
    amount: float
    cardholder: str
    card_last_digits: str
    category: str
    location: str
    installment: str


class CardSummary(BaseModel):
    """Summary for a single card."""
    cardholder: str
    card_last_digits: str
    total: float
    transaction_count: int


class ParseResponse(BaseModel):
    """Response from parsing a statement."""
    success: bool
    message: str
    transactions: list[TransactionResponse]
    summary: dict
    total: float
    transaction_count: int


class StatementInfo(BaseModel):
    """Statement metadata."""
    id: int
    filename: str
    bank: str
    period_start: Optional[str]
    period_end: Optional[str]
    total: float
    transaction_count: int
    created_at: str


class BatchUploadResult(BaseModel):
    """Result for a single file in batch upload."""
    filename: str
    success: bool
    message: str
    statement_id: Optional[int] = None
    is_duplicate: bool = False


class BatchUploadResponse(BaseModel):
    """Response from batch upload."""
    results: list[BatchUploadResult]
    total_uploaded: int
    total_duplicates: int
    total_errors: int


class LabelCreate(BaseModel):
    """Request to create a label."""
    name: str


class LabelAssign(BaseModel):
    """Request to assign a label to a match value with a given scope."""
    scope: str = "business"
    match_value: str


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Statement Analyzer API"}


@app.get("/banks")
async def list_banks():
    """List supported banks."""
    return {
        "banks": [
            {
                "id": "itau",
                "name": "Itaú Personnalité",
                "formats": ["pdf"],
                "requires_password": True,
            }
        ]
    }


@app.get("/statements", response_model=list[StatementInfo])
async def list_statements():
    """List all saved statements."""
    statements = db.list_statements()
    return [StatementInfo(**s) for s in statements]


@app.post("/statements/upload", response_model=BatchUploadResponse)
async def batch_upload_statements(
    files: list[UploadFile] = File(...),
    password: Optional[str] = Form(None),
    bank: str = Form("itau"),
):
    """
    Upload multiple statement PDFs in batch.

    Args:
        files: List of PDF files to parse and save
        password: PDF password (same for all files)
        bank: Bank identifier

    Returns:
        Results for each file uploaded
    """
    if bank != "itau":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported bank: {bank}. Currently only 'itau' is supported.",
        )

    results = []
    total_uploaded = 0
    total_duplicates = 0
    total_errors = 0

    parser = ItauParser()

    for file in files:
        filename = file.filename or "unknown.pdf"

        if not filename.lower().endswith(".pdf"):
            results.append(BatchUploadResult(
                filename=filename,
                success=False,
                message="Only PDF files are supported.",
            ))
            total_errors += 1
            continue

        try:
            content = await file.read()
            file_hash = db.compute_file_hash(content)

            # Check for duplicate
            existing = db.statement_exists(file_hash)
            if existing:
                results.append(BatchUploadResult(
                    filename=filename,
                    success=True,
                    message=f"Statement already exists (uploaded as {existing['filename']})",
                    statement_id=existing["id"],
                    is_duplicate=True,
                ))
                total_duplicates += 1
                continue

            # Parse the statement
            file_obj = BytesIO(content)

            if not parser.validate(file_obj):
                results.append(BatchUploadResult(
                    filename=filename,
                    success=False,
                    message="File does not appear to be a valid Itaú statement.",
                ))
                total_errors += 1
                continue

            file_obj.seek(0)
            df = parser.parse(file_obj, password=password)

            if df.empty:
                results.append(BatchUploadResult(
                    filename=filename,
                    success=False,
                    message="No transactions found in statement.",
                ))
                total_errors += 1
                continue

            # Convert to list of dicts for storage
            transactions = df.to_dict(orient="records")
            total = round(df["amount"].sum(), 2)

            # Extract period from filename (e.g. Fatura_VISA_100268625345_01-2026.pdf)
            period_match = re.search(r'(\d{2})-(\d{4})\.pdf$', filename, re.IGNORECASE)
            if period_match:
                month, year = period_match.group(1), period_match.group(2)
                period_start = f"{month}/{year}"
                period_end = f"{month}/{year}"
            else:
                period_start = None
                period_end = None

            # Save to database
            saved = db.save_statement(
                file_hash=file_hash,
                filename=filename,
                bank=bank,
                total=total,
                transaction_count=len(transactions),
                transactions=transactions,
                period_start=period_start,
                period_end=period_end,
            )

            results.append(BatchUploadResult(
                filename=filename,
                success=True,
                message=f"Successfully parsed {len(transactions)} transactions.",
                statement_id=saved["id"],
            ))
            total_uploaded += 1

        except ValueError as e:
            results.append(BatchUploadResult(
                filename=filename,
                success=False,
                message=str(e),
            ))
            total_errors += 1
        except Exception as e:
            results.append(BatchUploadResult(
                filename=filename,
                success=False,
                message=f"Error processing file: {str(e)}",
            ))
            total_errors += 1

    return BatchUploadResponse(
        results=results,
        total_uploaded=total_uploaded,
        total_duplicates=total_duplicates,
        total_errors=total_errors,
    )


@app.post("/statements/transactions")
async def get_statement_transactions(statement_ids: list[int]):
    """
    Get transactions for selected statements.

    Args:
        statement_ids: List of statement IDs to fetch transactions for

    Returns:
        Combined transactions from all selected statements
    """
    transactions = db.get_transactions_for_statements(statement_ids)

    # Calculate totals
    total = sum(t["amount"] for t in transactions)

    return {
        "transactions": transactions,
        "total": round(total, 2),
        "transaction_count": len(transactions),
    }


@app.get("/transactions/unlabeled")
async def get_next_unlabeled_transaction(
    skip: Optional[str] = None,
    statement_ids: Optional[str] = None,
):
    """
    Return the next unlabeled transaction (largest amount first) and the
    remaining count.

    `skip` — comma-separated transaction IDs to exclude.
    `statement_ids` — comma-separated statement IDs to scope to. If omitted or
    empty, scopes across all statements.
    """
    skip_ids: set[int] = set()
    if skip:
        for token in skip.split(","):
            token = token.strip()
            if token.isdigit():
                skip_ids.add(int(token))

    scoped_ids: list[int] = []
    if statement_ids:
        scoped_ids = [int(t.strip()) for t in statement_ids.split(",") if t.strip().isdigit()]
    else:
        scoped_ids = db.list_all_statement_ids()

    if not scoped_ids:
        return {"transaction": None, "remaining": 0}

    transactions = db.get_transactions_for_statements(scoped_ids)
    unlabeled = [t for t in transactions if not t.get("labels")]
    unlabeled.sort(key=lambda t: t.get("amount") or 0, reverse=True)

    next_tx = next((t for t in unlabeled if t["id"] not in skip_ids), None)
    return {
        "transaction": next_tx,
        "remaining": len(unlabeled),
    }


@app.delete("/statements/{statement_id}")
async def delete_statement(statement_id: int):
    """Delete a statement and its transactions."""
    if db.delete_statement(statement_id):
        return {"success": True, "message": "Statement deleted."}
    raise HTTPException(status_code=404, detail="Statement not found.")


@app.get("/labels")
async def list_labels():
    """List all labels."""
    return db.get_all_labels()


@app.post("/labels")
async def create_label(body: LabelCreate):
    """Create a new label."""
    try:
        label = db.create_label(body.name)
        return label
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/labels/{label_id}")
async def delete_label(label_id: int):
    """Delete a label and its rules."""
    if db.delete_label(label_id):
        return {"success": True}
    raise HTTPException(status_code=404, detail="Label not found.")


@app.post("/labels/{label_id}/assign")
async def assign_label(label_id: int, body: LabelAssign):
    """Assign a label with a given scope."""
    if body.scope not in ("transaction", "business", "establishment"):
        raise HTTPException(status_code=400, detail="Invalid scope.")
    db.assign_label(label_id, body.scope, body.match_value)
    return {"success": True}


@app.delete("/labels/{label_id}/assign")
async def unassign_label(label_id: int, scope: str, match_value: str):
    """Remove a label rule."""
    db.unassign_label(label_id, scope, match_value)
    return {"success": True}


@app.post("/parse", response_model=ParseResponse)
async def parse_statement(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    bank: str = Form("itau"),
):
    """
    Parse a credit card statement PDF.

    Args:
        file: The PDF file to parse
        password: PDF password (required for encrypted files)
        bank: Bank identifier (currently only 'itau' supported)

    Returns:
        Parsed transactions and summary
    """
    # Validate bank
    if bank != "itau":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported bank: {bank}. Currently only 'itau' is supported.",
        )

    # Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported.",
        )

    try:
        # Read file content
        content = await file.read()
        file_obj = BytesIO(content)

        # Parse with appropriate parser
        parser = ItauParser()

        # Validate file appears to be from the right bank
        if not parser.validate(file_obj):
            raise HTTPException(
                status_code=400,
                detail="File does not appear to be a valid Itaú statement.",
            )

        # Reset file position after validation
        file_obj.seek(0)

        # Parse the statement
        df = parser.parse(file_obj, password=password)

        if df.empty:
            return ParseResponse(
                success=True,
                message="No transactions found in statement.",
                transactions=[],
                summary={"cards": []},
                total=0,
                transaction_count=0,
            )

        # Convert DataFrame to list of transactions
        transactions = []
        for _, row in df.iterrows():
            transactions.append(
                TransactionResponse(
                    date=str(row.get("date", "")),
                    establishment=str(row.get("establishment", "")),
                    amount=float(row.get("amount", 0)),
                    cardholder=str(row.get("cardholder", "")),
                    card_last_digits=str(row.get("card_last_digits", "")),
                    category=str(row.get("category", "")),
                    location=str(row.get("location", "")),
                    installment=str(row.get("installment", "")),
                )
            )

        # Get summary by card
        summary = parser.get_summary_by_card(df)

        return ParseResponse(
            success=True,
            message=f"Successfully parsed {len(transactions)} transactions.",
            transactions=transactions,
            summary=summary,
            total=round(df["amount"].sum(), 2),
            transaction_count=len(transactions),
        )

    except ValueError as e:
        # Password errors, parsing errors
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing file: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
