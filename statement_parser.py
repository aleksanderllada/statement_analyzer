"""
Itaú Credit Card Statement Parser

Extracts transaction data from password-protected Itaú PDF statements.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # pymupdf
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
    installment: str = ""  # e.g., "03/06" means installment 3 of 6


def open_pdf(pdf_path: str | Path, password: str) -> fitz.Document:
    """Open a password-protected PDF file."""
    doc = fitz.open(pdf_path)
    if doc.is_encrypted:
        if not doc.authenticate(password):
            raise ValueError("Invalid PDF password")
    return doc


def extract_text_by_page(doc: fitz.Document) -> list[str]:
    """Extract text from each page of the PDF."""
    return [page.get_text() for page in doc]


def extract_cardholder_totals(text: str) -> dict:
    """Extract all cardholder totals from the full document text."""
    cardholder_totals = {}
    total_pattern = re.compile(r"Lançamentos no cartão \(final (\d{4})\)")
    lines = text.split("\n")

    for i, line in enumerate(lines):
        total_match = total_pattern.search(line)
        if total_match:
            card_digits = total_match.group(1)
            # Next non-empty line should be the total
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


def parse_transactions_from_text(text: str) -> tuple[list[Transaction], list[str]]:
    """
    Parse transactions from text in sequential format.

    Returns:
        - List of transactions
        - List of categories (in order they appear)
    """
    lines = text.split("\n")
    transactions = []
    categories = []

    # Patterns
    date_pattern = re.compile(r"^(\d{2}/\d{2})$")
    amount_pattern = re.compile(r"^([-]?\s*[\d.,]+)$")
    category_pattern = re.compile(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]+)\s*\.([\w\s]*)?$")
    installment_pattern = re.compile(r"(\d{2}/\d{2})$")  # Installment at end like 06/06

    i = 0

    while i < len(lines):
        line = lines[i].strip()

        if not line:
            i += 1
            continue

        # Stop parsing transactions when we hit future installments section
        if "próximas faturas" in line.lower():
            break

        # Skip headers and known non-transaction lines
        if line in ["Continua...", "DATA", "ESTABELECIMENTO", "VALOR EM R$",
                    "Lançamentos: compras e saques", "Lançamentos internacionais"] or \
           line.startswith("Lançamentos no cartão"):
            i += 1
            continue

        # Check for category line (CATEGORY .LOCATION format)
        cat_match = category_pattern.match(line)
        if cat_match and not date_pattern.match(line):
            category = cat_match.group(1).strip()
            location = cat_match.group(2).strip() if cat_match.group(2) else ""
            categories.append((category, location))
            i += 1
            continue

        # Check for date line (starts a transaction)
        date_match = date_pattern.match(line)
        if date_match:
            current_date = date_match.group(1)

            # Next line should be establishment
            if i + 1 < len(lines):
                est_line = lines[i + 1].strip()
                installment = ""
                lines_consumed = 2  # date + establishment

                # Check for installment info at the end of establishment line
                inst_match = installment_pattern.search(est_line)
                if inst_match and len(est_line) > 5:
                    potential_inst = inst_match.group(1)
                    est_without_inst = est_line[:inst_match.start()].strip()
                    if est_without_inst:
                        installment = potential_inst
                        est_line = est_without_inst

                # Check if next line (i+2) is an amount or needs special handling
                if i + 2 < len(lines):
                    next_line = lines[i + 2].strip()

                    # Case 1: next line is amount (normal case)
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

                    # Case 2: next line is installment (separate line), then amount
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

                    # Case 3: establishment name wrapped to next line
                    # Pattern: EST_PART1 (short) + EST_PART2 (with * or installment) + AMOUNT
                    elif len(est_line) < 15 and not amount_pattern.match(next_line):
                        # This might be a wrapped establishment name
                        combined_est = est_line + " " + next_line
                        # Check for installment at end
                        inst_match = installment_pattern.search(combined_est)
                        if inst_match:
                            installment = inst_match.group(1)
                            combined_est = combined_est[:inst_match.start()].strip()

                        # Check if line after that is amount
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

    # Note: International transactions are already included in regular transactions
    # with merchant names. The "Lançamentos internacionais" section in the PDF
    # only shows the location (city) - we don't need to parse it separately.

    # Add IOF for international transactions if present
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


def assign_cardholders_and_categories(
    transactions: list[Transaction],
    categories: list[tuple[str, str]],
    cardholder_totals: dict,
    text: str
) -> list[Transaction]:
    """
    Assign cardholders and categories to transactions.

    Categories appear in the same order as transactions.
    Cardholder assignment is based on totals matching running sums.
    """
    # Find cardholder names from text - more specific pattern
    cardholder_pattern = re.compile(r"([A-Z][A-Z ]+)\s*\(final\s*(\d{4})\)")
    cardholders = {}
    for match in cardholder_pattern.finditer(text):
        name = match.group(1).strip()
        digits = match.group(2)
        # Skip if name contains newlines or is too short
        if "\n" not in name and len(name) > 3:
            if digits not in cardholders:
                cardholders[digits] = name

    # Assign categories (they appear in same order as transactions)
    for i, trans in enumerate(transactions):
        if i < len(categories):
            trans.category, trans.location = categories[i]

    # Assign cardholders based on cumulative totals matching cardholder totals
    if cardholder_totals and cardholders:
        card_order = list(cardholder_totals.keys())
        current_card_idx = 0
        running_sum = 0.0

        for trans in transactions:
            if current_card_idx >= len(card_order):
                # Assign to last known cardholder if we run out
                if card_order:
                    trans.card_last_digits = card_order[-1]
                    trans.cardholder = cardholders.get(card_order[-1], "")
                continue

            current_digits = card_order[current_card_idx]
            expected_total = cardholder_totals[current_digits]

            trans.card_last_digits = current_digits
            trans.cardholder = cardholders.get(current_digits, "")

            running_sum += trans.amount

            # Check if we've reached this cardholder's total (with tolerance)
            if abs(running_sum - expected_total) < 0.5:
                current_card_idx += 1
                running_sum = 0.0

    return transactions


def remove_future_installments(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove future installment entries that were picked up due to PDF column layout.

    When there are duplicate (date, establishment, amount) entries with consecutive
    installment numbers (e.g., 03/04 and 04/04), the higher one is a future charge.
    """
    if df.empty or 'installment' not in df.columns:
        return df

    def parse_installment(inst):
        """Parse installment string like '03/04' into (current, total)."""
        if pd.isna(inst) or inst == '':
            return (0, 0)
        try:
            parts = str(inst).split('/')
            return (int(parts[0]), int(parts[1]))
        except (ValueError, IndexError):
            return (0, 0)

    # Find duplicates by date, establishment, amount
    dup_mask = df.duplicated(subset=['date', 'establishment', 'amount'], keep=False)
    dups = df[dup_mask].copy()
    non_dups = df[~dup_mask].copy()

    if dups.empty:
        return df

    # For each duplicate group, keep only the lower installment number
    keep_indices = []
    for _, group in dups.groupby(['date', 'establishment', 'amount']):
        if len(group) == 2:
            inst1 = parse_installment(group.iloc[0]['installment'])
            inst2 = parse_installment(group.iloc[1]['installment'])

            # If installments are consecutive (same total, current differs by 1)
            if inst1[1] == inst2[1] and abs(inst1[0] - inst2[0]) == 1:
                # Keep the lower installment number (current month)
                if inst1[0] < inst2[0]:
                    keep_indices.append(group.index[0])
                else:
                    keep_indices.append(group.index[1])
            else:
                # Not consecutive installments, keep both (legitimate duplicates)
                keep_indices.extend(group.index.tolist())
        else:
            # More than 2 duplicates, keep all for now
            keep_indices.extend(group.index.tolist())

    filtered_dups = dups.loc[keep_indices]
    result = pd.concat([non_dups, filtered_dups]).sort_index()
    return result


def parse_statement(pdf_path: str | Path, password: str) -> pd.DataFrame:
    """
    Main entry point: parse a credit card statement PDF.

    Args:
        pdf_path: Path to the PDF file
        password: PDF password

    Returns:
        DataFrame with parsed transactions
    """
    doc = open_pdf(pdf_path, password)

    # Collect all text first, then parse
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"
    doc.close()

    # Extract cardholder totals from whole document (they appear after section breaks)
    cardholder_totals = extract_cardholder_totals(full_text)

    # Parse transactions (stops at "próximas faturas" section)
    transactions, categories = parse_transactions_from_text(full_text)

    # Assign cardholders and categories
    transactions = assign_cardholders_and_categories(
        transactions, categories, cardholder_totals, full_text
    )

    df = pd.DataFrame([t.__dict__ for t in transactions])

    # Remove future installments that were picked up due to PDF layout
    df = remove_future_installments(df)

    return df


if __name__ == "__main__":
    # Test with sample file
    pdf_path = "Fatura_MASTERCARD_100261673164_12-2025.pdf"
    password = "10484"

    print("Parsing statement...")
    df = parse_statement(pdf_path, password)

    print(f"\nFound {len(df)} transactions")

    if len(df) > 0:
        print("\n--- Sample Transactions ---")
        pd.set_option('display.max_columns', None)
        pd.set_option('display.width', None)
        print(df.head(15).to_string())

        print(f"\n--- Summary ---")
        print(f"Total: R$ {df['amount'].sum():,.2f}")

        if df['cardholder'].any():
            print(f"\nBy cardholder:")
            print(df.groupby(['cardholder', 'card_last_digits'])['amount'].agg(['sum', 'count']))

        if df['category'].any():
            print(f"\nBy category:")
            print(df.groupby('category')['amount'].agg(['sum', 'count']).sort_values('sum', ascending=False).head(10))

        # Save to CSV
        df.to_csv('transactions.csv', index=False)
        print("\nSaved to transactions.csv")
    else:
        print("No transactions found!")
