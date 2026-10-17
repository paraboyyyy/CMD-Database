"""Structure parsing, symmetry analysis and format conversion (pymatgen + spglib)."""

from __future__ import annotations

import warnings
from pathlib import PurePath

from pymatgen.core import Lattice, Molecule, Structure
from pymatgen.io.cif import CifWriter
from pymatgen.io.vasp import Poscar
from pymatgen.io.xyz import XYZ
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

EXPORT_FORMATS = {
    "cif": ("text/plain", "cif"),
    "poscar": ("text/plain", "vasp"),
    "xyz": ("text/plain", "xyz"),
    "json": ("application/json", "json"),
}


class StructureParseError(ValueError):
    pass


def _guess_format(filename: str) -> str:
    name = PurePath(filename).name.lower()
    suffix = PurePath(name).suffix
    if suffix == ".cif" or name.endswith(".mcif"):
        return "cif"
    if suffix == ".xyz":
        return "xyz"
    if suffix == ".json":
        return "json"
    if suffix in {".vasp", ".poscar"} or name.startswith(("poscar", "contcar")):
        return "poscar"
    raise StructureParseError(
        f"Unsupported file '{filename}'. Use .cif, .vasp/POSCAR/CONTCAR, .xyz or pymatgen .json."
    )


def parse_structure(text: str, filename: str) -> Structure | Molecule:
    """Parse file contents into a pymatgen Structure (periodic) or Molecule (.xyz)."""
    fmt = _guess_format(filename)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if fmt == "xyz":
                return Molecule.from_str(text, fmt="xyz")
            return Structure.from_str(text, fmt=fmt)
    except Exception as exc:  # pymatgen raises many different exception types
        raise StructureParseError(f"Could not parse {filename} as {fmt}: {exc}") from exc


def lattice_summary(lattice: Lattice) -> dict:
    return {
        "a": lattice.a,
        "b": lattice.b,
        "c": lattice.c,
        "alpha": lattice.alpha,
        "beta": lattice.beta,
        "gamma": lattice.gamma,
        "matrix": lattice.matrix.tolist(),
    }


def summarize(structure: Structure, symprec: float = 0.01) -> dict:
    """Composition, symmetry and lattice fields shared by the DB model and the parse API."""
    comp = structure.composition
    elements = sorted(el.symbol for el in comp.elements)
    try:
        sga = SpacegroupAnalyzer(structure, symprec=symprec)
        symmetry = {
            "spacegroup_symbol": sga.get_space_group_symbol(),
            "spacegroup_number": sga.get_space_group_number(),
            "crystal_system": sga.get_crystal_system(),
            "point_group": sga.get_point_group_symbol(),
        }
    except Exception:
        # Disordered or pathological cells: spglib can fail; store as P1.
        symmetry = {
            "spacegroup_symbol": "P1",
            "spacegroup_number": 1,
            "crystal_system": "triclinic",
            "point_group": "1",
        }
    return {
        "formula_pretty": comp.reduced_formula,
        "formula_reduced": comp.reduced_formula,
        "formula_anonymous": comp.anonymized_formula,
        "chemsys": "-".join(elements),
        "elements_key": "," + ",".join(elements) + ",",
        "elements": elements,
        "nelements": len(elements),
        "nsites": len(structure),
        **symmetry,
        "lattice": lattice_summary(structure.lattice),
        "volume": structure.volume,
        "density": float(structure.density),
        "structure": structure.as_dict(),
    }


def export(structure: Structure, fmt: str) -> str:
    if fmt == "cif":
        return str(CifWriter(structure, symprec=0.01))
    if fmt == "poscar":
        return Poscar(structure).get_str()
    if fmt == "xyz":
        return str(XYZ(Molecule(structure.species, structure.cart_coords)))
    if fmt == "json":
        return structure.to_json()
    raise ValueError(f"Unknown format {fmt}")
