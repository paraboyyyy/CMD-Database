"""Structure builder: expand symmetry-inequivalent sites with a space group's operations."""

from functools import lru_cache
from math import cos, radians, sin, sqrt
from typing import Annotated

import numpy as np
import spglib
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from ..services.formula import SYMBOLS
from ..services.symmetry import analyze, crystal_system

router = APIRouter(prefix="/api", tags=["builder"])

MAX_ATOMS = 2000
DUPLICATE_TOL = 0.02  # Å: images closer than this are the same atom
OVERLAP_TOL = 0.5  # Å: atoms from different sites closer than this are reported


@lru_cache
def spacegroup_settings() -> list[dict]:
    groups: dict[int, dict] = {}
    for hall in range(1, 531):
        t = spglib.get_spacegroup_type(hall)
        group = groups.setdefault(
            t.number,
            {"number": t.number, "symbol": t.international_short, "crystal_system": crystal_system(t.number), "settings": []},
        )
        group["settings"].append({"hall": hall, "choice": t.choice, "symbol": t.international_full})
    return [groups[n] for n in sorted(groups)]


@router.get("/spacegroups")
def list_spacegroups(response: Response) -> list[dict]:
    """All 230 space groups with their settings (Hall numbers). The first setting is the default."""
    response.headers["Cache-Control"] = "public, max-age=86400, s-maxage=604800"
    return spacegroup_settings()


class LatticeIn(BaseModel):
    a: float = Field(gt=0.1, le=200)
    b: float = Field(gt=0.1, le=200)
    c: float = Field(gt=0.1, le=200)
    alpha: float = Field(gt=0, lt=180)
    beta: float = Field(gt=0, lt=180)
    gamma: float = Field(gt=0, lt=180)


class SiteIn(BaseModel):
    element: str
    frac: Annotated[list[float], Field(min_length=3, max_length=3)]


class BuildRequest(BaseModel):
    hall: int = Field(1, ge=1, le=530, description="Hall number of the space-group setting (1 = P1)")
    lattice: LatticeIn
    sites: list[SiteIn] = Field(min_length=1, max_length=500)


def lattice_matrix(p: LatticeIn) -> np.ndarray:
    """Rows a, b, c with a along x and b in the xy plane (same convention as the frontend)."""
    ca, cb, cg, sg = cos(radians(p.alpha)), cos(radians(p.beta)), cos(radians(p.gamma)), sin(radians(p.gamma))
    cx = p.c * cb
    cy = p.c * (ca - cb * cg) / sg
    cz2 = p.c**2 - cx**2 - cy**2
    if cz2 <= 1e-8:
        raise HTTPException(422, "These cell angles do not form a valid 3D cell")
    return np.array([[p.a, 0, 0], [p.b * cg, p.b * sg, 0], [cx, cy, sqrt(cz2)]])


def _periodic_distance(f1: np.ndarray, f2: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    d = f2 - f1
    d -= np.round(d)
    return np.linalg.norm(d @ matrix, axis=-1)


@router.post("/build")
def build(req: BuildRequest) -> dict:
    """Generate all atoms of the cell from symmetry-inequivalent sites, then report the symmetry
    spglib finds in the result (which can be higher if the sites sit on special positions)."""
    for site in req.sites:
        if site.element not in SYMBOLS:
            raise HTTPException(422, f"Unknown element: {site.element}")
    matrix = lattice_matrix(req.lattice)
    ops = spglib.get_symmetry_from_database(req.hall)
    rotations, translations = np.array(ops["rotations"]), np.array(ops["translations"])

    atoms: list[dict] = []
    positions = np.zeros((0, 3))
    multiplicities: list[int] = []
    overlaps: list[str] = []
    for index, site in enumerate(req.sites):
        images = (rotations @ np.array(site.frac)) + translations
        images = images - np.floor(images)
        images[np.isclose(images, 1.0, atol=1e-8)] = 0.0
        kept: list[np.ndarray] = []
        for img in images:
            if kept and _periodic_distance(np.array(kept), img, matrix).min() < DUPLICATE_TOL:
                continue
            kept.append(img)
        for img in kept:
            if len(positions):
                near = _periodic_distance(positions, img, matrix)
                j = int(near.argmin())
                if near[j] < OVERLAP_TOL:
                    overlaps.append(f"{site.element} (site {index + 1}) is {near[j]:.2f} Å from {atoms[j]['element']}")
            atoms.append({"element": site.element, "frac": [round(float(x), 8) for x in img], "site": index})
            positions = np.vstack([positions, img])
        multiplicities.append(len(kept))
        if len(atoms) > MAX_ATOMS:
            raise HTTPException(422, f"More than {MAX_ATOMS} atoms; use a smaller cell or fewer sites")

    t = spglib.get_spacegroup_type(req.hall)
    detected = analyze(matrix.tolist(), [a["frac"] for a in atoms], [a["element"] for a in atoms], 0.01)
    return {
        "spacegroup": {"number": t.number, "symbol": t.international_short, "choice": t.choice},
        "lattice": matrix.tolist(),
        "atoms": atoms,
        "multiplicities": multiplicities,
        "detected": detected,
        "warnings": overlaps[:20],
    }
