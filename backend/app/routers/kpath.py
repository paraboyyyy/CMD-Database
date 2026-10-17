"""High-symmetry k-paths for band structures (seekpath, Hinuma et al. 2017)."""

from math import pi

import numpy as np
import seekpath
from fastapi import APIRouter, HTTPException

from ..schemas import SymmetryRequest

router = APIRouter(prefix="/api", tags=["tools"])


def _label(name: str) -> str:
    return "G" if name == "GAMMA" else name.replace("_", "")


@router.post("/kpath")
def kpath(cell: SymmetryRequest) -> dict:
    """Recommended band-structure path for a cell. Points are given in fractional coordinates of
    the reciprocal lattice of the cell that was sent (not seekpath's standardized cell), so they
    can be used directly with that cell."""
    if len(cell.frac) != len(cell.species):
        raise HTTPException(422, "frac and species must have equal length")
    kinds = {el: i + 1 for i, el in enumerate(dict.fromkeys(cell.species))}
    A = np.array(cell.lattice, dtype=float)
    try:
        r = seekpath.get_path((A, cell.frac, [kinds[e] for e in cell.species]), with_time_reversal=True, symprec=cell.symprec)
    except Exception as exc:  # seekpath/spglib raise several error types for odd cells
        raise HTTPException(422, f"Could not determine a k-path: {exc}")

    B_std = np.array(r["reciprocal_primitive_lattice"])  # rows, includes 2π
    R = np.array(r["rotation_matrix"])  # v_standardized = R · v_input

    def to_input_frac(f_std: list[float]) -> list[float]:
        k_cart = (np.array(f_std) @ B_std) @ R  # back to the input orientation (row vector)
        return [round(float(x), 8) + 0.0 for x in k_cart @ A.T / (2 * pi)]

    points = {_label(k): to_input_frac(v) for k, v in r["point_coords"].items()}
    B_in = 2 * pi * np.linalg.inv(A).T
    segments = []
    for start, end in r["path"]:
        a, b = _label(start), _label(end)
        length = float(np.linalg.norm((np.array(points[b]) - np.array(points[a])) @ B_in))
        segments.append({"from": a, "to": b, "length": round(length, 6)})
    return {
        "bravais_lattice": r["bravais_lattice_extended"],
        "spacegroup": r["spacegroup_international"],
        "points": points,
        "segments": segments,
    }
