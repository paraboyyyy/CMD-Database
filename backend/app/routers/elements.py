from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Material
from .materials import _split_elements

router = APIRouter(prefix="/api", tags=["materials"])


@router.get("/elements")
def element_counts(
    response: Response,
    session: Annotated[Session, Depends(get_session)],
    with_: Annotated[
        str | None, Query(alias="with", description="Only count materials containing all of these, e.g. Li,O")
    ] = None,
) -> dict:
    """Number of materials containing each element (optionally among materials that
    contain all `with` elements). Drives the periodic-table heatmap."""
    stmt = select(Material.elements_key)
    for el in _split_elements(with_ or ""):
        stmt = stmt.where(Material.elements_key.like(f"%,{el},%"))
    counts: Counter[str] = Counter()
    total = 0
    for key in session.scalars(stmt):
        counts.update(key.strip(",").split(","))
        total += 1
    # Counts change only when data is imported; let the CDN cache them.
    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=600, stale-while-revalidate=86400"
    return {"total": total, "counts": dict(counts)}
