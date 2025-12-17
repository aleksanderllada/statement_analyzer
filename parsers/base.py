"""
Base class for credit card statement parsers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import pandas as pd


@dataclass
class Transaction:
    """Represents a single credit card transaction."""
    date: str
    establishment: str
    amount: float
    cardholder: str = ""
    card_last_digits: str = ""
    category: str = ""
    location: str = ""
    installment: str = ""


class StatementParser(ABC):
    """
    Abstract base class for credit card statement parsers.

    Each bank should have its own parser implementation that inherits from this class.
    """

    # Subclasses should define these
    BANK_NAME: str = "Unknown"
    SUPPORTED_FORMATS: list[str] = ["pdf"]

    @abstractmethod
    def parse(self, file: BinaryIO, password: str | None = None) -> pd.DataFrame:
        """
        Parse a statement file and return transactions as a DataFrame.

        Args:
            file: File-like object containing the statement
            password: Optional password for encrypted files

        Returns:
            DataFrame with columns: date, establishment, amount, cardholder,
            card_last_digits, category, location, installment
        """
        pass

    @abstractmethod
    def validate(self, file: BinaryIO) -> bool:
        """
        Check if the file appears to be a valid statement for this parser.

        Args:
            file: File-like object to validate

        Returns:
            True if the file appears to be valid for this parser
        """
        pass

    def get_summary_by_card(self, df: pd.DataFrame) -> dict:
        """
        Get spending summary grouped by card.

        Args:
            df: DataFrame with parsed transactions

        Returns:
            Dict with card summaries
        """
        if df.empty:
            return {"cards": [], "total": 0}

        summary = df.groupby(['cardholder', 'card_last_digits']).agg(
            total=('amount', 'sum'),
            count=('amount', 'count')
        ).reset_index()

        cards = []
        for _, row in summary.iterrows():
            cards.append({
                "cardholder": row['cardholder'],
                "card_last_digits": str(row['card_last_digits']),
                "total": round(row['total'], 2),
                "transaction_count": int(row['count'])
            })

        return {
            "cards": cards,
            "total": round(df['amount'].sum(), 2),
            "transaction_count": len(df)
        }

    def get_summary_by_category(self, df: pd.DataFrame) -> dict:
        """
        Get spending summary grouped by category.

        Args:
            df: DataFrame with parsed transactions

        Returns:
            Dict with category summaries
        """
        if df.empty:
            return {"categories": [], "total": 0}

        # Filter out empty categories
        df_with_cat = df[df['category'].notna() & (df['category'] != '')]

        summary = df_with_cat.groupby('category').agg(
            total=('amount', 'sum'),
            count=('amount', 'count')
        ).reset_index().sort_values('total', ascending=False)

        categories = []
        for _, row in summary.iterrows():
            categories.append({
                "category": row['category'],
                "total": round(row['total'], 2),
                "transaction_count": int(row['count'])
            })

        return {
            "categories": categories,
            "total": round(df['amount'].sum(), 2),
            "categorized_total": round(df_with_cat['amount'].sum(), 2)
        }
