import sqlite3
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import contextmanager

DATABASE_PATH = Path(__file__).parent.parent / "data" / "statements.db"


def get_db_path() -> Path:
    """Get database path, creating directory if needed."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return DATABASE_PATH


@contextmanager
def get_connection():
    """Context manager for database connections."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the database schema."""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS statements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_hash TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                bank TEXT NOT NULL,
                period_start TEXT,
                period_end TEXT,
                total REAL NOT NULL,
                transaction_count INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                statement_id INTEGER NOT NULL,
                date TEXT,
                establishment TEXT NOT NULL,
                amount REAL NOT NULL,
                cardholder TEXT,
                card_last_digits TEXT,
                category TEXT,
                location TEXT,
                installment TEXT,
                FOREIGN KEY (statement_id) REFERENCES statements(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_statement
            ON transactions(statement_id);

            CREATE INDEX IF NOT EXISTS idx_statements_hash
            ON statements(file_hash);

            CREATE TABLE IF NOT EXISTS labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS label_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
                scope TEXT NOT NULL DEFAULT 'business' CHECK(scope IN ('transaction', 'business', 'establishment')),
                match_value TEXT NOT NULL,
                UNIQUE(label_id, scope, match_value)
            );

            CREATE INDEX IF NOT EXISTS idx_label_rules_match
            ON label_rules(scope, match_value);
        """)


def _migrate_label_rules(conn):
    """Migrate label_rules from old schema (business_key) to new schema (scope + match_value)."""
    cursor = conn.execute("PRAGMA table_info(label_rules)")
    columns = {row["name"] for row in cursor.fetchall()}
    if "business_key" in columns and "scope" not in columns:
        conn.execute("ALTER TABLE label_rules RENAME TO label_rules_old")
        conn.execute("""
            CREATE TABLE label_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
                scope TEXT NOT NULL DEFAULT 'business' CHECK(scope IN ('transaction', 'business', 'establishment')),
                match_value TEXT NOT NULL,
                UNIQUE(label_id, scope, match_value)
            )
        """)
        conn.execute("""
            INSERT INTO label_rules (label_id, scope, match_value)
            SELECT label_id, 'business', business_key FROM label_rules_old
        """)
        conn.execute("DROP TABLE label_rules_old")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_label_rules_match ON label_rules(scope, match_value)")


def compute_business_key(establishment: str) -> str:
    """Extract business key from establishment name."""
    if '*' in establishment:
        return establishment.split('*')[0].strip().lower()
    return establishment.strip().lower()


def compute_establishment_key(establishment: str) -> str:
    """Get lowercased full establishment name for exact matching."""
    return establishment.strip().lower()


def compute_file_hash(file_content: bytes) -> str:
    """Compute SHA-256 hash of file content."""
    return hashlib.sha256(file_content).hexdigest()


def statement_exists(file_hash: str) -> Optional[dict]:
    """Check if a statement with this hash already exists."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM statements WHERE file_hash = ?",
            (file_hash,)
        ).fetchone()
        return dict(row) if row else None


def save_statement(
    file_hash: str,
    filename: str,
    bank: str,
    total: float,
    transaction_count: int,
    transactions: list[dict],
    period_start: str = None,
    period_end: str = None,
) -> dict:
    """Save a new statement and its transactions."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO statements (file_hash, filename, bank, period_start, period_end, total, transaction_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (file_hash, filename, bank, period_start, period_end, total, transaction_count, datetime.now().isoformat())
        )
        statement_id = cursor.lastrowid

        # Insert transactions
        for t in transactions:
            conn.execute(
                """
                INSERT INTO transactions (statement_id, date, establishment, amount, cardholder, card_last_digits, category, location, installment)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    statement_id,
                    t.get("date"),
                    t.get("establishment"),
                    t.get("amount"),
                    t.get("cardholder"),
                    t.get("card_last_digits"),
                    t.get("category"),
                    t.get("location"),
                    t.get("installment"),
                )
            )

        return {
            "id": statement_id,
            "file_hash": file_hash,
            "filename": filename,
            "bank": bank,
            "total": total,
            "transaction_count": transaction_count,
        }


def list_statements() -> list[dict]:
    """List all statements ordered by period (newest first)."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, filename, bank, period_start, period_end, total, transaction_count, created_at
            FROM statements
            ORDER BY
                substr(period_start, 4, 4) DESC,
                substr(period_start, 1, 2) DESC,
                filename ASC
            """
        ).fetchall()
        return [dict(row) for row in rows]


def get_transactions_for_statements(statement_ids: list[int]) -> list[dict]:
    """Get all transactions for the given statement IDs, enriched with labels."""
    if not statement_ids:
        return []

    placeholders = ",".join("?" * len(statement_ids))
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT t.*, s.filename as statement_filename
            FROM transactions t
            JOIN statements s ON t.statement_id = s.id
            WHERE t.statement_id IN ({placeholders})
            ORDER BY t.date, t.id
            """,
            statement_ids
        ).fetchall()
        transactions = [dict(row) for row in rows]

    # Compute keys for each transaction
    transaction_ids = set()
    business_keys = set()
    establishment_keys = set()
    for t in transactions:
        transaction_ids.add(str(t["id"]))
        t["business_key"] = compute_business_key(t["establishment"])
        business_keys.add(t["business_key"])
        t["establishment_key"] = compute_establishment_key(t["establishment"])
        establishment_keys.add(t["establishment_key"])

    # Get labels for all scopes
    label_map = get_label_mappings(
        transaction_ids=list(transaction_ids),
        business_keys=list(business_keys),
        establishment_keys=list(establishment_keys),
    )

    # Merge labels from all scopes, most specific wins for dedup
    for t in transactions:
        labels: dict[int, dict] = {}
        for l in label_map.get(("transaction", str(t["id"])), []):
            labels[l["id"]] = l
        for l in label_map.get(("establishment", t["establishment_key"]), []):
            if l["id"] not in labels:
                labels[l["id"]] = l
        for l in label_map.get(("business", t["business_key"]), []):
            if l["id"] not in labels:
                labels[l["id"]] = l
        t["labels"] = list(labels.values())

    return transactions


def list_all_statement_ids() -> list[int]:
    """Return all statement IDs."""
    with get_connection() as conn:
        rows = conn.execute("SELECT id FROM statements").fetchall()
        return [row["id"] for row in rows]


def delete_statement(statement_id: int) -> bool:
    """Delete a statement and its transactions."""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM statements WHERE id = ?",
            (statement_id,)
        )
        return cursor.rowcount > 0


def get_all_labels() -> list[dict]:
    """Get all labels."""
    with get_connection() as conn:
        rows = conn.execute("SELECT id, name, created_at FROM labels ORDER BY name").fetchall()
        return [dict(row) for row in rows]


def create_label(name: str) -> dict:
    """Create a new label."""
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO labels (name) VALUES (?)",
            (name,)
        )
        row = conn.execute(
            "SELECT id, name, created_at FROM labels WHERE id = ?",
            (cursor.lastrowid,)
        ).fetchone()
        return dict(row)


def delete_label(label_id: int) -> bool:
    """Delete a label (cascades to rules)."""
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM labels WHERE id = ?", (label_id,))
        return cursor.rowcount > 0


def assign_label(label_id: int, scope: str, match_value: str) -> None:
    """Create a label rule."""
    with get_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO label_rules (label_id, scope, match_value) VALUES (?, ?, ?)",
            (label_id, scope, match_value)
        )


def unassign_label(label_id: int, scope: str, match_value: str) -> None:
    """Remove a label rule."""
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM label_rules WHERE label_id = ? AND scope = ? AND match_value = ?",
            (label_id, scope, match_value)
        )


def get_label_mappings(
    transaction_ids: list[str],
    business_keys: list[str],
    establishment_keys: list[str],
) -> dict[tuple[str, str], list[dict]]:
    """Get label mappings for all scopes. Returns dict keyed by (scope, match_value)."""
    conditions = []
    params: list[str] = []

    if transaction_ids:
        ph = ",".join("?" * len(transaction_ids))
        conditions.append(f"(lr.scope = 'transaction' AND lr.match_value IN ({ph}))")
        params.extend(transaction_ids)

    if business_keys:
        ph = ",".join("?" * len(business_keys))
        conditions.append(f"(lr.scope = 'business' AND lr.match_value IN ({ph}))")
        params.extend(business_keys)

    if establishment_keys:
        ph = ",".join("?" * len(establishment_keys))
        conditions.append(f"(lr.scope = 'establishment' AND lr.match_value IN ({ph}))")
        params.extend(establishment_keys)

    if not conditions:
        return {}

    where = " OR ".join(conditions)
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT lr.scope, lr.match_value, l.id, l.name
            FROM label_rules lr
            JOIN labels l ON lr.label_id = l.id
            WHERE {where}
            ORDER BY l.name
            """,
            params
        ).fetchall()

    result: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        key = (row["scope"], row["match_value"])
        if key not in result:
            result[key] = []
        result[key].append({
            "id": row["id"],
            "name": row["name"],
            "scope": row["scope"],
            "match_value": row["match_value"],
        })
    return result


# Initialize database and run migrations on module import
def _startup():
    # First, create base tables (without label_rules, which may need migration)
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS statements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_hash TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                bank TEXT NOT NULL,
                period_start TEXT,
                period_end TEXT,
                total REAL NOT NULL,
                transaction_count INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                statement_id INTEGER NOT NULL,
                date TEXT,
                establishment TEXT NOT NULL,
                amount REAL NOT NULL,
                cardholder TEXT,
                card_last_digits TEXT,
                category TEXT,
                location TEXT,
                installment TEXT,
                FOREIGN KEY (statement_id) REFERENCES statements(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_statement ON transactions(statement_id);
            CREATE INDEX IF NOT EXISTS idx_statements_hash ON statements(file_hash);
            CREATE TABLE IF NOT EXISTS labels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT DEFAULT (datetime('now'))
            );
        """)
    # Migrate label_rules if old schema exists
    with get_connection() as conn:
        _migrate_label_rules(conn)
    # Now create label_rules with new schema if it doesn't exist yet
    init_db()
    # Backfill statement periods from filenames
    _backfill_statement_periods()

def _backfill_statement_periods():
    """Extract period from filenames for statements missing period data."""
    import re
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, filename FROM statements WHERE period_start IS NULL OR length(period_start) <= 5"
        ).fetchall()
        for row in rows:
            match = re.search(r'(\d{2})-(\d{4})\.pdf$', row["filename"], re.IGNORECASE)
            if match:
                month, year = match.group(1), match.group(2)
                period = f"{month}/{year}"
                conn.execute(
                    "UPDATE statements SET period_start = ?, period_end = ? WHERE id = ?",
                    (period, period, row["id"])
                )

_startup()
