"""Import materials from the Materials Project (https://next-gen.materialsproject.org).

Requires `pip install mp-api` and an API key from your Materials Project dashboard.
Materials Project data is licensed CC BY 4.0: keep the attribution shown in the UI.

    export MP_API_KEY=...
    python -m scripts.import_mp --chemsys Li-Fe-O
    python -m scripts.import_mp --elements Si --max 200
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, init_db  # noqa: E402
from app.services.ingest import add_material  # noqa: E402

FIELDS = [
    "material_id",
    "structure",
    "band_gap",
    "formation_energy_per_atom",
    "energy_above_hull",
    "is_stable",
    "is_metal",
    "is_magnetic",
    "total_magnetization",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--chemsys", help="e.g. Li-Fe-O (exactly these elements)")
    group.add_argument("--elements", help="e.g. Li,O (contains at least these)")
    group.add_argument("--ids", help="e.g. mp-149,mp-22862")
    parser.add_argument("--max", type=int, default=100, help="Maximum number of entries")
    parser.add_argument("--stable-only", action="store_true")
    args = parser.parse_args()

    api_key = os.environ.get("MP_API_KEY")
    if not api_key:
        raise SystemExit("Set MP_API_KEY (get one at https://next-gen.materialsproject.org/api)")
    try:
        from mp_api.client import MPRester
    except ImportError:
        raise SystemExit("Install the client first: pip install mp-api")

    query: dict = {"fields": FIELDS}
    if args.chemsys:
        query["chemsys"] = args.chemsys
    elif args.elements:
        query["elements"] = [e.strip() for e in args.elements.split(",")]
    else:
        query["material_ids"] = [i.strip() for i in args.ids.split(",")]
    if args.stable_only:
        query["is_stable"] = True

    with MPRester(api_key) as mpr:
        docs = mpr.materials.summary.search(**query, num_chunks=None)

    init_db()
    with SessionLocal() as session:
        for doc in docs[: args.max]:
            material = add_material(
                session,
                doc.structure,
                source="materials_project",
                source_id=str(doc.material_id),
                band_gap=doc.band_gap,
                formation_energy_per_atom=doc.formation_energy_per_atom,
                energy_above_hull=doc.energy_above_hull,
                extra={
                    "is_stable": doc.is_stable,
                    "is_metal": doc.is_metal,
                    "is_magnetic": doc.is_magnetic,
                    "total_magnetization": doc.total_magnetization,
                    "license": "CC BY 4.0, Materials Project",
                },
            )
            print(f"{material.id:10s} {doc.material_id!s:12s} {material.formula_pretty}")
        session.commit()
    print(f"Imported {min(len(docs), args.max)} of {len(docs)} matches")


if __name__ == "__main__":
    main()
