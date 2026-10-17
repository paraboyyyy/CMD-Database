from fastapi import APIRouter, HTTPException

from ..schemas import SymmetryRequest, SymmetryResult
from ..services.symmetry import analyze

router = APIRouter(prefix="/api", tags=["tools"])


@router.post("/symmetry", response_model=SymmetryResult)
def find_symmetry(cell: SymmetryRequest) -> dict:
    """Space group of a cell (spglib). The viewer sends the structure it parsed in the browser."""
    if len(cell.frac) != len(cell.species) or any(len(row) != 3 for row in [*cell.lattice, *cell.frac]):
        raise HTTPException(422, "lattice must be 3x3 and frac/species must have equal length")
    result = analyze(cell.lattice, cell.frac, cell.species, cell.symprec)
    if result is None:
        raise HTTPException(422, "Could not determine the space group (check the cell or try a larger symprec)")
    return result
