from pymatgen.core import Structure
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Material
from .structure import summarize

ID_PREFIX = "cmd-"


def next_id(session: Session) -> str:
    ids = session.scalars(select(Material.id).where(Material.id.like(f"{ID_PREFIX}%"))).all()
    n = max((int(i.removeprefix(ID_PREFIX)) for i in ids if i.removeprefix(ID_PREFIX).isdigit()), default=0)
    return f"{ID_PREFIX}{n + 1}"


def find_existing(session: Session, source: str, source_id: str | None) -> Material | None:
    if source_id is None:
        return None
    return session.scalar(
        select(Material).where(Material.source == source, Material.source_id == source_id)
    )


def add_material(
    session: Session,
    structure: Structure,
    *,
    source: str,
    source_id: str | None = None,
    band_gap: float | None = None,
    formation_energy_per_atom: float | None = None,
    energy_above_hull: float | None = None,
    extra: dict | None = None,
) -> Material:
    """Insert a structure, or update it in place if (source, source_id) already exists."""
    fields = summarize(structure)
    fields.update(
        band_gap=band_gap,
        formation_energy_per_atom=formation_energy_per_atom,
        energy_above_hull=energy_above_hull,
        extra=extra or {},
        source=source,
        source_id=source_id,
    )
    material = find_existing(session, source, source_id)
    if material is None:
        material = Material(id=next_id(session), **fields)
        session.add(material)
    else:
        for key, value in fields.items():
            setattr(material, key, value)
    session.flush()
    return material


def count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Material)) or 0
