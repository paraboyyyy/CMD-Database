from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Material
from ..schemas import MaterialDetail, MaterialPage
from ..services.export import EXPORT_FORMATS, export
from ..services.formula import formula_key, parse_formula

router = APIRouter(prefix="/api/materials", tags=["materials"])

SORTABLE = {
    "id": Material.id,
    "formula": Material.formula_pretty,
    "nsites": Material.nsites,
    "density": Material.density,
    "spacegroup": Material.spacegroup_number,
    "band_gap": Material.band_gap,
    "energy_above_hull": Material.energy_above_hull,
}


def _split_elements(raw: str) -> list[str]:
    return sorted({s.strip() for s in raw.replace("-", ",").split(",") if s.strip()})


@router.get("", response_model=MaterialPage)
def search_materials(
    session: Annotated[Session, Depends(get_session)],
    q: Annotated[
        str | None, Query(description="Free text: a formula (Fe2O3), chemsys (Fe-O) or ID")
    ] = None,
    formula: str | None = None,
    elements: Annotated[str | None, Query(description="Must contain all, e.g. Li,Fe,O")] = None,
    exclude_elements: str | None = None,
    chemsys: Annotated[str | None, Query(description="Exactly these elements, e.g. Fe-O")] = None,
    spacegroup_number: Annotated[int | None, Query(ge=1, le=230)] = None,
    crystal_system: str | None = None,
    nelements_min: int | None = None,
    nelements_max: int | None = None,
    band_gap_min: float | None = None,
    band_gap_max: float | None = None,
    sort: Literal[tuple(SORTABLE)] = "id",  # type: ignore[valid-type]
    order: Literal["asc", "desc"] = "asc",
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MaterialPage:
    stmt = select(Material)

    if q:
        q = q.strip()
        if q.lower().startswith("cmd-"):
            stmt = stmt.where(Material.id == q.lower())
        elif "-" in q:
            chemsys = q
        else:
            formula = q

    if formula:
        try:
            key = formula_key(parse_formula(formula))
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        stmt = stmt.where(Material.formula_key == key)
    if chemsys:
        stmt = stmt.where(Material.chemsys == "-".join(_split_elements(chemsys)))
    for el in _split_elements(elements or ""):
        stmt = stmt.where(Material.elements_key.like(f"%,{el},%"))
    for el in _split_elements(exclude_elements or ""):
        stmt = stmt.where(Material.elements_key.not_like(f"%,{el},%"))
    if spacegroup_number is not None:
        stmt = stmt.where(Material.spacegroup_number == spacegroup_number)
    if crystal_system:
        stmt = stmt.where(Material.crystal_system == crystal_system.lower())
    if nelements_min is not None:
        stmt = stmt.where(Material.nelements >= nelements_min)
    if nelements_max is not None:
        stmt = stmt.where(Material.nelements <= nelements_max)
    if band_gap_min is not None:
        stmt = stmt.where(Material.band_gap >= band_gap_min)
    if band_gap_max is not None:
        stmt = stmt.where(Material.band_gap <= band_gap_max)

    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    col = SORTABLE[sort]
    # Sort IDs numerically ("cmd-10" after "cmd-9") by length first.
    order_by = [func.length(col), col] if sort == "id" else [col]
    if order == "desc":
        order_by = [c.desc() for c in order_by]
    items = session.scalars(stmt.order_by(*order_by).limit(limit).offset(offset)).all()
    return MaterialPage(total=total, limit=limit, offset=offset, items=items)


def _get(session: Session, material_id: str) -> Material:
    material = session.get(Material, material_id.lower())
    if material is None:
        raise HTTPException(404, f"Material {material_id} not found")
    return material


@router.get("/{material_id}", response_model=MaterialDetail)
def get_material(material_id: str, session: Annotated[Session, Depends(get_session)]):
    return _get(session, material_id)


@router.get("/{material_id}/download")
def download_material(
    material_id: str,
    session: Annotated[Session, Depends(get_session)],
    fmt: Literal["cif", "poscar", "xyz", "json"] = "cif",
):
    material = _get(session, material_id)
    media_type, ext = EXPORT_FORMATS[fmt]
    name = f"{material.id}_{material.formula_pretty}"
    return Response(
        export(material.structure, material.lattice, fmt, name),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{name}.{ext}"'},
    )
