from pymatgen.core import Structure
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from ..models import Material
from .structure import summarize

ID_PREFIX = "cmd-"


def max_id_number(session: Session) -> int:
    number = cast(func.substr(Material.id, len(ID_PREFIX) + 1), Integer)
    return session.scalar(select(func.max(number)).where(Material.id.like(f"{ID_PREFIX}%"))) or 0


class Ingester:
    """Upserts structures from one source. Existing IDs are loaded once and new IDs are
    counted locally, so importing tens of thousands of entries needs no per-row lookups."""

    def __init__(self, session: Session, source: str):
        self.session = session
        self.source = source
        rows = session.execute(
            select(Material.source_id, Material.id).where(Material.source == source)
        ).all()
        self.existing: dict[str, str] = {source_id: id_ for source_id, id_ in rows if source_id}
        self._next = max_id_number(session) + 1

    def upsert(
        self,
        structure: Structure,
        source_id: str | None = None,
        *,
        symmetry: dict | None = None,
        band_gap: float | None = None,
        formation_energy_per_atom: float | None = None,
        energy_above_hull: float | None = None,
        extra: dict | None = None,
    ) -> Material:
        """Insert a structure, or update it in place if this source_id was imported before."""
        fields = summarize(structure, symmetry=symmetry)
        fields.update(
            band_gap=band_gap,
            formation_energy_per_atom=formation_energy_per_atom,
            energy_above_hull=energy_above_hull,
            extra=extra or {},
            source=self.source,
            source_id=source_id,
        )
        existing_id = self.existing.get(source_id) if source_id else None
        if existing_id is None:
            material = Material(id=f"{ID_PREFIX}{self._next}", **fields)
            self._next += 1
            self.session.add(material)
            if source_id:
                self.existing[source_id] = material.id
        else:
            material = self.session.get(Material, existing_id)
            for key, value in fields.items():
                setattr(material, key, value)
        return material


def add_material(session: Session, structure: Structure, *, source: str, source_id: str | None = None, **props) -> Material:
    """Single-structure convenience wrapper around Ingester."""
    material = Ingester(session, source).upsert(structure, source_id, **props)
    session.flush()
    return material


def count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Material)) or 0
