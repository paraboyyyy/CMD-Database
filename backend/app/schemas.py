from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LatticeOut(BaseModel):
    a: float
    b: float
    c: float
    alpha: float
    beta: float
    gamma: float
    matrix: list[list[float]]


class MaterialSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    formula_pretty: str
    chemsys: str
    elements: list[str]
    nsites: int
    spacegroup_symbol: str
    spacegroup_number: int
    crystal_system: str
    density: float
    volume: float
    band_gap: float | None
    energy_above_hull: float | None
    source: str


class MaterialDetail(MaterialSummary):
    formula_reduced: str
    formula_anonymous: str
    nelements: int
    point_group: str
    lattice: LatticeOut
    structure: dict
    formation_energy_per_atom: float | None
    extra: dict
    source_id: str | None
    created_at: datetime


class MaterialPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[MaterialSummary]


class ParsedStructure(BaseModel):
    """Result of parsing an uploaded file. `periodic` is False for .xyz molecules."""

    filename: str
    periodic: bool
    formula_pretty: str
    nsites: int
    spacegroup_symbol: str | None = None
    spacegroup_number: int | None = None
    crystal_system: str | None = None
    lattice: LatticeOut | None = None
    density: float | None = None
    structure: dict
