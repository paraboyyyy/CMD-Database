from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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


class SymmetryRequest(BaseModel):
    """A periodic cell: lattice rows a, b, c (Å), fractional coordinates and element symbols."""

    lattice: list[list[float]] = Field(min_length=3, max_length=3)
    frac: list[list[float]] = Field(min_length=1, max_length=20000)
    species: list[str]
    symprec: float = Field(0.01, gt=0, le=1)


class SymmetryResult(BaseModel):
    spacegroup_symbol: str
    spacegroup_number: int
    crystal_system: str
    point_group: str
