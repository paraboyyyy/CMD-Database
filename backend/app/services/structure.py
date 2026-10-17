"""Structure parsing and analysis with pymatgen, used by the import scripts.

Not imported by the API at runtime: pymatgen is too large for serverless hosting.
"""

from __future__ import annotations

import warnings
from pathlib import PurePath

from pymatgen.core import Lattice, Molecule, Structure
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

from .formula import formula_key


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


def compact_structure_dict(structure: Structure) -> dict:
    """Structure.as_dict() without per-site properties, redundant labels and lattice
    parameters (stored in their own column), rounded to 1e-6. Still loads with
    Structure.from_dict(), and roughly halves the stored size."""
    d = structure.as_dict()
    d["lattice"] = {"matrix": [[round(v, 8) for v in row] for row in d["lattice"]["matrix"]], "pbc": d["lattice"]["pbc"]}
    d.pop("properties", None)
    for site in d["sites"]:
        site.pop("properties", None)
        if len(site["species"]) == 1 and site.get("label") == site["species"][0]["element"]:
            site.pop("label")
        site["abc"] = [round(v, 6) for v in site["abc"]]
        site["xyz"] = [round(v, 6) for v in site["xyz"]]
    return d


def analyze_symmetry(structure: Structure, symprec: float = 0.01) -> dict:
    try:
        sga = SpacegroupAnalyzer(structure, symprec=symprec)
        return {
            "spacegroup_symbol": sga.get_space_group_symbol(),
            "spacegroup_number": sga.get_space_group_number(),
            "crystal_system": sga.get_crystal_system(),
            "point_group": sga.get_point_group_symbol(),
        }
    except Exception:
        # Disordered or pathological cells: spglib can fail; store as P1.
        return {"spacegroup_symbol": "P1", "spacegroup_number": 1, "crystal_system": "triclinic", "point_group": "1"}


def summarize(structure: Structure, symprec: float = 0.01, symmetry: dict | None = None) -> dict:
    """Composition, symmetry and lattice fields for the materials table. Pass `symmetry`
    (spacegroup_symbol, spacegroup_number, crystal_system, point_group) to reuse values a
    source already computed instead of running spglib."""
    comp = structure.composition
    elements = sorted(el.symbol for el in comp.elements)
    if symmetry is None:
        symmetry = analyze_symmetry(structure, symprec)
    return {
        "formula_pretty": comp.reduced_formula,
        "formula_reduced": comp.reduced_formula,
        "formula_anonymous": comp.anonymized_formula,
        "formula_key": formula_key(comp.get_el_amt_dict()),
        "chemsys": "-".join(elements),
        "elements_key": "," + ",".join(elements) + ",",
        "elements": elements,
        "nelements": len(elements),
        "nsites": len(structure),
        **symmetry,
        "lattice": lattice_summary(structure.lattice),
        "volume": structure.volume,
        "density": float(structure.density),
        "structure": compact_structure_dict(structure),
    }
