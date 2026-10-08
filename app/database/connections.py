import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg2
from psycopg.conninfo import make_conninfo
from psycopg2.extras import RealDictCursor

from dotenv import load_dotenv

load_dotenv()


def database_conninfo() -> str:
    """
    The one PostgreSQL connection string for the whole app
    (psycopg2 queries and the LangGraph checkpointer both use it).

    1. DATABASE_URL if set, e.g. Render's Internal Database URL.
       postgres:// and postgresql:// are both accepted by libpq.
    2. Otherwise the POSTGRES_* variables (local development).

    Fails fast with a clear message instead of letting libpq fall back to a
    local socket and time out.
    """

    url = os.getenv("DATABASE_URL", "").strip()

    if url:
        return url

    if not os.getenv("POSTGRES_HOST") or not os.getenv("POSTGRES_DB"):
        raise RuntimeError(
            "Database is not configured. Set DATABASE_URL "
            "(or POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD)."
        )

    return make_conninfo(
        host=os.getenv("POSTGRES_HOST"),
        port=os.getenv("POSTGRES_PORT"),
        dbname=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )


def get_connections():
    return psycopg2.connect(database_conninfo())


@contextmanager
def get_cursor() -> Iterator[RealDictCursor]:
    """
    One transaction per block:
    COMMIT on success, ROLLBACK on any error, always close.
    Rows are returned as dicts.
    """

    conn = get_connections()
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    try:
        yield cursor
        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        cursor.close()
        conn.close()
