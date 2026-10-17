from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# JSONB on Postgres, plain JSON elsewhere (SQLite for local dev and tests).
JSONType = JSON().with_variant(JSONB(), "postgresql")


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)

    formula_pretty: Mapped[str] = mapped_column(String(128), index=True)
    formula_reduced: Mapped[str] = mapped_column(String(128), index=True)
    formula_anonymous: Mapped[str] = mapped_column(String(128), index=True)
    # Order-independent reduced formula (services/formula.py), the target of formula search.
    formula_key: Mapped[str] = mapped_column(String(128), index=True)
    # Sorted element symbols joined by "-", e.g. "Fe-O". Exact-match chemical system search.
    chemsys: Mapped[str] = mapped_column(String(256), index=True)
    # Same symbols wrapped in commas, e.g. ",Fe,O,", so "contains element X" is a portable LIKE.
    elements_key: Mapped[str] = mapped_column(String(256), index=True)
    elements: Mapped[list[str]] = mapped_column(JSONType)
    nelements: Mapped[int] = mapped_column(Integer, index=True)
    nsites: Mapped[int] = mapped_column(Integer, index=True)

    spacegroup_symbol: Mapped[str] = mapped_column(String(32), index=True)
    spacegroup_number: Mapped[int] = mapped_column(Integer, index=True)
    crystal_system: Mapped[str] = mapped_column(String(16), index=True)
    point_group: Mapped[str] = mapped_column(String(16))

    lattice: Mapped[dict] = mapped_column(JSONType)
    volume: Mapped[float] = mapped_column(Float)
    density: Mapped[float] = mapped_column(Float, index=True)
    structure: Mapped[dict] = mapped_column(JSONType)

    band_gap: Mapped[float | None] = mapped_column(Float, index=True, nullable=True)
    formation_energy_per_atom: Mapped[float | None] = mapped_column(Float, nullable=True)
    energy_above_hull: Mapped[float | None] = mapped_column(Float, index=True, nullable=True)
    extra: Mapped[dict] = mapped_column(JSONType, default=dict)

    source: Mapped[str] = mapped_column(String(64), index=True)
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
