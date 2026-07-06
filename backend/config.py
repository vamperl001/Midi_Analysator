"""
Umstellung SQLite -> Supabase (PostgreSQL).
- Voreingestellt: SQLite (lokal, für Entwicklung)
- Bei gesetzter SUPABASE_URL + SUPABASE_KEY: PostgreSQL via asyncpg
"""

import os
from pathlib import Path

DB_DIR = Path("/data")
DB_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = DB_DIR / "sessions.db"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")  # postgresql://user:pass@host:port/db

USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY) or bool(SUPABASE_DB_URL)
