import json
import os
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

DEMO_FIXTURE = Path(__file__).parent / "demo_materials.json"


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    # Serverless functions should not hold connections between invocations.
    if os.environ.get("VERCEL"):
        return create_engine(url, poolclass=NullPool)
    return create_engine(url, pool_pre_ping=True)


engine = make_engine(settings.resolved_database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


_initialized = False


def init_db() -> None:
    global _initialized
    from . import models  # noqa: F401  (registers tables)

    Base.metadata.create_all(engine)
    if settings.load_demo_data:
        load_demo_data()
    _initialized = True


def load_demo_data() -> int:
    """Insert the bundled demo structures if the materials table is empty."""
    from .models import Material

    with SessionLocal() as session:
        if session.scalar(select(func.count()).select_from(Material)):
            return 0
        rows = json.loads(DEMO_FIXTURE.read_text())
        session.add_all(Material(**row) for row in rows)
        try:
            session.commit()
        except IntegrityError:
            # Another cold-started instance loaded the demo data at the same time.
            session.rollback()
            return 0
        return len(rows)


def get_session() -> Iterator[Session]:
    # Serverless runtimes may skip ASGI lifespan events, so initialise on first use too.
    if not _initialized:
        init_db()
    with SessionLocal() as session:
        yield session
