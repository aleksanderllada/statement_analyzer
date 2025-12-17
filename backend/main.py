"""
FastAPI backend for credit card statement analysis.
"""

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
