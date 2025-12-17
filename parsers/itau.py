"""
Itaú Personnalité credit card statement parser.
"""

import re
from io import BytesIO
from typing import BinaryIO

import fitz  # pymupdf
import pandas as pd

from .base import StatementParser, Transaction


class ItauParser(StatementParser):
    """
    Parser for Itaú Personnalité credit card statements.

    Handles password-protected PDFs and extracts transactions including:
    - Multiple cardholders
    - Installment purchases
    - Categories and locations
    - International transactions (IOF)
    """

    BANK_NAME = "Itaú Personnalité"
    SUPPORTED_FORMATS = ["pdf"]

    def parse(self, file: BinaryIO, password: str | None = None) -> pd.DataFrame:
        """
        Parse an Itaú statement PDF.

        Args:
            file: File-like object containing the PDF
            password: PDF password (usually CPF or numeric code)

        Returns:
            DataFrame with parsed transactions
        """
        # Read file content
        content = file.read()
        file.seek(0)  # Reset for potential re-use

        # Open PDF
        doc = fitz.open(stream=content, filetype="pdf")

        if doc.is_encrypted:
            if not password:
                raise ValueError("PDF is encrypted. Please provide a password.")
            if not doc.authenticate(password):
                raise ValueError("Invalid PDF password.")

        # Extract all text
        full_text = ""
        for page in doc:
            full_text += page.get_text() + "\n"
        doc.close()

        # Extract cardholder totals
        cardholder_totals = self._extract_cardholder_totals(full_text)

        # Parse transactions
        transactions, categories = self._parse_transactions(full_text)

        # Assign cardholders and categories
        transactions = self._assign_cardholders_and_categories(
            transactions, categories, cardholder_totals, full_text
        )

        # Convert to DataFrame
        df = pd.DataFrame([t.__dict__ for t in transactions])

        # Remove future installments
        df = self._remove_future_installments(df)

        return df

    def validate(self, file: BinaryIO) -> bool:
        """
        Check if the file appears to be an Itaú statement.

        Args:
            file: File-like object to validate

        Returns:
            True if the file appears to be an Itaú statement
        """
        try:
            content = file.read()
            file.seek(0)

            doc = fitz.open(stream=content, filetype="pdf")

            # If encrypted, we can't validate content - assume valid
            # Actual validation will happen during parsing
            if doc.is_encrypted:
                doc.close()
                return True

            # Check first page for Itaú markers
            if len(doc) > 0:
                first_page_text = doc[0].get_text().lower()
                doc.close()

                return any(marker in first_page_text for marker in [
                    "itaú",
                    "itau",
                    "personnalité",
                    "personnalite"
                ])

            doc.close()
            return False

        except Exception:
            return False

    def _extract_cardholder_totals(self, text: str) -> dict:
        """Extract card totals from text."""
        cardholder_totals = {}
        total_pattern = re.compile(r"Lançamentos no cartão \(final (\d{4})\)")
        lines = text.split("\n")

        for i, line in enumerate(lines):
            total_match = total_pattern.search(line)
            if total_match:
                card_digits = total_match.group(1)
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines):
                    total_str = lines[j].strip().replace(".", "").replace(",", ".")
                    try:
                        cardholder_totals[card_digits] = float(total_str)
                    except ValueError:
                        pass

        return cardholder_totals

    def _parse_transactions(self, text: str) -> tuple[list[Transaction], list[tuple]]:
        """Parse transactions from text."""
        lines = text.split("\n")
        transactions = []
        categories = []

        # Patterns
        date_pattern = re.compile(r"^(\d{2}/\d{2})$")
        amount_pattern = re.compile(r"^([-]?\s*[\d.,]+)$")
        category_pattern = re.compile(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]+)\s*\.([\w\s]*)?$")
        installment_pattern = re.compile(r"(\d{2}/\d{2})$")

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            if not line:
                i += 1
                continue

            # Stop at future installments section
            if "próximas faturas" in line.lower():
                break

            # Skip headers
            if line in ["Continua...", "DATA", "ESTABELECIMENTO", "VALOR EM R$",
                        "Lançamentos: compras e saques", "Lançamentos internacionais"] or \
               line.startswith("Lançamentos no cartão"):
                i += 1
                continue

            # Check for category
            cat_match = category_pattern.match(line)
            if cat_match and not date_pattern.match(line):
                category = cat_match.group(1).strip()
                location = cat_match.group(2).strip() if cat_match.group(2) else ""
                categories.append((category, location))
                i += 1
                continue

            # Check for transaction date
            date_match = date_pattern.match(line)
            if date_match:
                current_date = date_match.group(1)

                if i + 1 < len(lines):
                    est_line = lines[i + 1].strip()
                    installment = ""

                    # Check for installment at end
                    inst_match = installment_pattern.search(est_line)
                    if inst_match and len(est_line) > 5:
                        potential_inst = inst_match.group(1)
                        est_without_inst = est_line[:inst_match.start()].strip()
                        if est_without_inst:
                            installment = potential_inst
                            est_line = est_without_inst

                    if i + 2 < len(lines):
                        next_line = lines[i + 2].strip()

                        # Case 1: Normal transaction
                        amount_match = amount_pattern.match(next_line)
                        if amount_match and not date_pattern.match(next_line):
                            amount_str = next_line.replace(" ", "").replace(".", "").replace(",", ".")
                            try:
                                amount = float(amount_str)
                                transactions.append(Transaction(
                                    date=current_date,
                                    establishment=est_line,
                                    amount=amount,
                                    installment=installment,
                                ))
                                i += 3
                                continue
                            except ValueError:
                                pass

                        # Case 2: Separate installment line
                        elif date_pattern.match(next_line) and i + 3 < len(lines):
                            potential_installment = next_line
                            amount_line = lines[i + 3].strip()
                            amount_match = amount_pattern.match(amount_line)
                            if amount_match:
                                amount_str = amount_line.replace(" ", "").replace(".", "").replace(",", ".")
                                try:
                                    amount = float(amount_str)
                                    transactions.append(Transaction(
                                        date=current_date,
                                        establishment=est_line,
                                        amount=amount,
                                        installment=potential_installment,
                                    ))
                                    i += 4
                                    continue
                                except ValueError:
                                    pass

                        # Case 3: Wrapped establishment name
                        elif len(est_line) < 15 and not amount_pattern.match(next_line):
                            combined_est = est_line + " " + next_line
                            inst_match = installment_pattern.search(combined_est)
                            if inst_match:
                                installment = inst_match.group(1)
                                combined_est = combined_est[:inst_match.start()].strip()

                            if i + 3 < len(lines):
                                amount_line = lines[i + 3].strip()
                                amount_match = amount_pattern.match(amount_line)
                                if amount_match:
                                    amount_str = amount_line.replace(" ", "").replace(".", "").replace(",", ".")
                                    try:
                                        amount = float(amount_str)
                                        transactions.append(Transaction(
                                            date=current_date,
                                            establishment=combined_est,
                                            amount=amount,
                                            installment=installment,
                                        ))
                                        i += 4
                                        continue
                                    except ValueError:
                                        pass

                i += 1
                continue

            i += 1

        # Add IOF if present
        iof_match = re.search(r"Repasse de IOF em R\$\s*([\d.,]+)", text)
        if iof_match:
            iof_amount = float(iof_match.group(1).replace(".", "").replace(",", "."))
            if iof_amount > 0:
                transactions.append(Transaction(
                    date="",
                    establishment="IOF (Imposto sobre Operações Financeiras)",
                    amount=iof_amount,
                    category="IMPOSTOS",
                    location="",
                    installment="",
                ))

        return transactions, categories

    def _assign_cardholders_and_categories(
        self,
        transactions: list[Transaction],
        categories: list[tuple],
        cardholder_totals: dict,
        text: str
    ) -> list[Transaction]:
        """Assign cardholders and categories to transactions."""
        # Find cardholder names
        cardholder_pattern = re.compile(r"([A-Z][A-Z ]+)\s*\(final\s*(\d{4})\)")
        cardholders = {}
        for match in cardholder_pattern.finditer(text):
            name = match.group(1).strip()
            digits = match.group(2)
            if "\n" not in name and len(name) > 3:
                if digits not in cardholders:
                    cardholders[digits] = name

        # Assign categories
        for i, trans in enumerate(transactions):
            if i < len(categories):
                trans.category, trans.location = categories[i]

        # Assign cardholders based on running totals
        if cardholder_totals and cardholders:
            card_order = list(cardholder_totals.keys())
            current_card_idx = 0
            running_sum = 0.0

            for trans in transactions:
                if current_card_idx >= len(card_order):
                    if card_order:
                        trans.card_last_digits = card_order[-1]
                        trans.cardholder = cardholders.get(card_order[-1], "")
                    continue

                current_digits = card_order[current_card_idx]
                expected_total = cardholder_totals[current_digits]

                trans.card_last_digits = current_digits
                trans.cardholder = cardholders.get(current_digits, "")

                running_sum += trans.amount

                if abs(running_sum - expected_total) < 0.5:
                    current_card_idx += 1
                    running_sum = 0.0

        return transactions

    def _remove_future_installments(self, df: pd.DataFrame) -> pd.DataFrame:
        """Remove future installment duplicates."""
        if df.empty or 'installment' not in df.columns:
            return df

        def parse_installment(inst):
            if pd.isna(inst) or inst == '':
                return (0, 0)
            try:
                parts = str(inst).split('/')
                return (int(parts[0]), int(parts[1]))
            except (ValueError, IndexError):
                return (0, 0)

        dup_mask = df.duplicated(subset=['date', 'establishment', 'amount'], keep=False)
        dups = df[dup_mask].copy()
        non_dups = df[~dup_mask].copy()

        if dups.empty:
            return df

        keep_indices = []
        for _, group in dups.groupby(['date', 'establishment', 'amount']):
            if len(group) == 2:
                inst1 = parse_installment(group.iloc[0]['installment'])
                inst2 = parse_installment(group.iloc[1]['installment'])

                if inst1[1] == inst2[1] and abs(inst1[0] - inst2[0]) == 1:
                    if inst1[0] < inst2[0]:
                        keep_indices.append(group.index[0])
                    else:
                        keep_indices.append(group.index[1])
                else:
                    keep_indices.extend(group.index.tolist())
            else:
                keep_indices.extend(group.index.tolist())

        filtered_dups = dups.loc[keep_indices]
        result = pd.concat([non_dups, filtered_dups]).sort_index()
        return result
