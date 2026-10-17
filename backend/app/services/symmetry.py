import spglib


def crystal_system(number: int) -> str:
    for upper, name in (
        (2, "triclinic"),
        (15, "monoclinic"),
        (74, "orthorhombic"),
        (142, "tetragonal"),
        (167, "trigonal"),
        (194, "hexagonal"),
    ):
        if number <= upper:
            return name
    return "cubic"


def analyze(lattice: list[list[float]], frac: list[list[float]], species: list[str], symprec: float) -> dict | None:
    """Space group of a cell via spglib, or None if spglib cannot determine it."""
    kinds = {el: i + 1 for i, el in enumerate(dict.fromkeys(species))}
    cell = (lattice, frac, [kinds[el] for el in species])
    dataset = spglib.get_symmetry_dataset(cell, symprec=symprec)
    if dataset is None:
        return None
    get = (lambda k: getattr(dataset, k)) if hasattr(dataset, "number") else dataset.__getitem__
    number = int(get("number"))
    return {
        "spacegroup_symbol": get("international"),
        "spacegroup_number": number,
        "crystal_system": crystal_system(number),
        "point_group": get("pointgroup"),
    }
