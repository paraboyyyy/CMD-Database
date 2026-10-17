"""Write well-known crystal structures to data/samples/ and backend/app/demo_materials.json.

The API loads demo_materials.json into an empty database on startup, so a fresh deploy is
never empty.

Lattice parameters and Wyckoff positions are standard experimental values from the
crystallographic literature. No computed properties (band gap, energies) are attached:
import real data with import_mp.py or import_files.py for that.

    python -m scripts.seed_samples        # from backend/: regenerate the files
    python -m scripts.seed_samples --db   # also upsert into the configured database
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pymatgen.core import Lattice, Structure
from pymatgen.io.cif import CifWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import DEMO_FIXTURE, SessionLocal, init_db  # noqa: E402
from app.services.ingest import add_material  # noqa: E402
from app.services.structure import summarize  # noqa: E402

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "data" / "samples"


def cubic(sg, a, species, coords):
    return Structure.from_spacegroup(sg, Lattice.cubic(a), species, coords)


def hexagonal(sg, a, c, species, coords):
    return Structure.from_spacegroup(sg, Lattice.hexagonal(a, c), species, coords)


# name -> (structure, expected number of sites in the conventional cell)
SAMPLES: dict[str, tuple[Structure, int]] = {
    "Si_diamond": (cubic("Fd-3m", 5.431, ["Si"], [[0, 0, 0]]), 8),
    "C_diamond": (cubic("Fd-3m", 3.567, ["C"], [[0, 0, 0]]), 8),
    "Cu_fcc": (cubic("Fm-3m", 3.615, ["Cu"], [[0, 0, 0]]), 4),
    "Fe_bcc": (cubic("Im-3m", 2.8665, ["Fe"], [[0, 0, 0]]), 2),
    "NaCl_rocksalt": (cubic("Fm-3m", 5.640, ["Na", "Cl"], [[0, 0, 0], [0.5, 0.5, 0.5]]), 8),
    "MgO_rocksalt": (cubic("Fm-3m", 4.212, ["Mg", "O"], [[0, 0, 0], [0.5, 0.5, 0.5]]), 8),
    "GaAs_zincblende": (cubic("F-43m", 5.653, ["Ga", "As"], [[0, 0, 0], [0.25, 0.25, 0.25]]), 8),
    "CaF2_fluorite": (cubic("Fm-3m", 5.463, ["Ca", "F"], [[0, 0, 0], [0.25, 0.25, 0.25]]), 12),
    "CsCl": (cubic("Pm-3m", 4.123, ["Cs", "Cl"], [[0, 0, 0], [0.5, 0.5, 0.5]]), 2),
    "SrTiO3_perovskite": (
        cubic("Pm-3m", 3.905, ["Sr", "Ti", "O"], [[0, 0, 0], [0.5, 0.5, 0.5], [0.5, 0.5, 0]]),
        5,
    ),
    "TiO2_rutile": (
        Structure.from_spacegroup(
            "P4_2/mnm", Lattice.tetragonal(4.594, 2.959), ["Ti", "O"],
            [[0, 0, 0], [0.3048, 0.3048, 0]],
        ),
        6,
    ),
    "ZnO_wurtzite": (
        hexagonal("P6_3mc", 3.250, 5.207, ["Zn", "O"], [[1 / 3, 2 / 3, 0], [1 / 3, 2 / 3, 0.382]]),
        4,
    ),
    "Mg_hcp": (hexagonal("P6_3/mmc", 3.209, 5.211, ["Mg"], [[1 / 3, 2 / 3, 0.25]]), 2),
    "C_graphite": (
        hexagonal("P6_3/mmc", 2.464, 6.711, ["C", "C"], [[0, 0, 0.25], [1 / 3, 2 / 3, 0.25]]),
        4,
    ),
    "MoS2_2H": (
        hexagonal("P6_3/mmc", 3.160, 12.294, ["Mo", "S"], [[1 / 3, 2 / 3, 0.25], [1 / 3, 2 / 3, 0.621]]),
        6,
    ),
    "Al2O3_corundum": (
        hexagonal("R-3c", 4.759, 12.991, ["Al", "O"], [[0, 0, 0.3523], [0.3064, 0, 0.25]]),
        30,
    ),
    "LiCoO2": (
        hexagonal("R-3m", 2.816, 14.05, ["Li", "Co", "O"], [[0, 0, 0], [0, 0, 0.5], [0, 0, 0.2396]]),
        12,
    ),
}

WATER_XYZ = """3
water molecule
O   0.000000   0.000000   0.117300
H   0.000000   0.757200  -0.469200
H   0.000000  -0.757200  -0.469200
"""

BENZENE_XYZ = """12
benzene
C   0.000000   1.396792   0.000000
C   1.209657   0.698396   0.000000
C   1.209657  -0.698396   0.000000
C   0.000000  -1.396792   0.000000
C  -1.209657  -0.698396   0.000000
C  -1.209657   0.698396   0.000000
H   0.000000   2.484212   0.000000
H   2.151390   1.242106   0.000000
H   2.151390  -1.242106   0.000000
H   0.000000  -2.484212   0.000000
H  -2.151390  -1.242106   0.000000
H  -2.151390   1.242106   0.000000
"""


NOTE = "Built from experimental lattice parameters (demo data)."


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate demo structures.")
    parser.add_argument("--db", action="store_true", help="Also upsert them into CMD_DATABASE_URL")
    args = parser.parse_args()

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    fixture = []
    for n, (name, (structure, expected)) in enumerate(SAMPLES.items(), start=1):
        if len(structure) != expected:
            raise SystemExit(f"{name}: expected {expected} sites, got {len(structure)}")
        CifWriter(structure, symprec=0.01).write_file(SAMPLES_DIR / f"{name}.cif")
        fixture.append(
            {"id": f"cmd-{n}", **summarize(structure), "extra": {"note": NOTE}, "source": "sample", "source_id": name}
        )
    (SAMPLES_DIR / "water.xyz").write_text(WATER_XYZ)
    (SAMPLES_DIR / "benzene.xyz").write_text(BENZENE_XYZ)
    DEMO_FIXTURE.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
    print(f"Wrote {len(SAMPLES)} samples to {SAMPLES_DIR} and {DEMO_FIXTURE.name}")

    if args.db:
        settings.load_demo_data = False
        init_db()
        with SessionLocal() as session:
            for name, (structure, _) in SAMPLES.items():
                material = add_material(session, structure, source="sample", source_id=name, extra={"note": NOTE})
                print(f"{material.id:8s} {material.formula_pretty:8s} {material.spacegroup_symbol}")
            session.commit()


if __name__ == "__main__":
    main()
