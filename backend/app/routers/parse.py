from fastapi import APIRouter, HTTPException, UploadFile
from pymatgen.core import Molecule

from ..config import settings
from ..schemas import ParsedStructure
from ..services.structure import StructureParseError, parse_structure, summarize

router = APIRouter(prefix="/api", tags=["tools"])


@router.post("/parse", response_model=ParsedStructure)
async def parse_file(file: UploadFile) -> ParsedStructure:
    """Parse an uploaded structure file and return symmetry and lattice information."""
    raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File larger than {settings.max_upload_mb} MB")
    filename = file.filename or "upload"
    try:
        parsed = parse_structure(raw.decode("utf-8", errors="replace"), filename)
    except StructureParseError as exc:
        raise HTTPException(422, str(exc))

    if isinstance(parsed, Molecule):
        return ParsedStructure(
            filename=filename,
            periodic=False,
            formula_pretty=parsed.composition.reduced_formula,
            nsites=len(parsed),
            structure=parsed.as_dict(),
        )
    info = summarize(parsed)
    return ParsedStructure(filename=filename, periodic=True, **info)
