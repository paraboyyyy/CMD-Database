"""Import materials from the Materials Project (https://next-gen.materialsproject.org).

Requires `pip install mp-api` and an API key from your Materials Project dashboard.
Materials Project data is licensed CC BY 4.0: keep the attribution shown in the UI.

IDs are listed first, then full documents are downloaded and committed in batches, so
large imports (--all) use little memory and can be resumed: entries already in the
database are skipped unless --update is given.

    export MP_API_KEY=...
    python -m scripts.import_mp --chemsys Li-Fe-O
    python -m scripts.import_mp --elements Si --max 200
    python -m scripts.import_mp --all --stable-only --max 0
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.services.ingest import Ingester, count  # noqa: E402

SOURCE = "materials_project"
FIELDS = [
    "material_id",
    "structure",
    "symmetry",
    "band_gap",
    "formation_energy_per_atom",
    "energy_above_hull",
    "is_stable",
    "is_metal",
    "is_magnetic",
    "total_magnetization",
]


def symmetry_of(doc) -> dict | None:
    """Reuse Materials Project's own symmetry analysis instead of re-running spglib."""
    sym = doc.symmetry
    if sym is None or sym.number is None:
        return None
    crystal_system = getattr(sym.crystal_system, "value", sym.crystal_system)
    return {
        "spacegroup_symbol": sym.symbol,
        "spacegroup_number": int(sym.number),
        "crystal_system": str(crystal_system).lower(),
        "point_group": sym.point_group,
    }


def notice(message: str) -> None:
    print(message)
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::notice title=Import::{message}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--chemsys", help="e.g. Li-Fe-O (exactly these elements)")
    group.add_argument("--elements", help="e.g. Li,O (contains at least these)")
    group.add_argument("--ids", help="e.g. mp-149,mp-22862")
    group.add_argument("--all", action="store_true", help="Every material (combine with --stable-only)")
    parser.add_argument("--max", type=int, default=100, help="Maximum number of entries (0 = no limit)")
    parser.add_argument("--stable-only", action="store_true")
    parser.add_argument("--update", action="store_true", help="Re-download entries already imported")
    parser.add_argument("--batch", type=int, default=500, help="Documents per download/commit")
    args = parser.parse_args()

    api_key = os.environ.get("MP_API_KEY")
    if not api_key:
        raise SystemExit("Set MP_API_KEY (get one at https://next-gen.materialsproject.org/api)")
    try:
        from mp_api.client import MPRester
    except ImportError:
        raise SystemExit("Install the client first: pip install mp-api")

    query: dict = {}
    if args.chemsys:
        query["chemsys"] = args.chemsys
    elif args.elements:
        query["elements"] = [e.strip() for e in args.elements.split(",")]
    elif args.ids:
        query["material_ids"] = [i.strip() for i in args.ids.split(",")]
    if args.stable_only:
        query["is_stable"] = True

    settings.load_demo_data = False
    init_db()
    start = time.time()
    with MPRester(api_key, mute_progress_bars=True) as mpr, SessionLocal() as session:
        ids = [str(d.material_id) for d in mpr.materials.summary.search(**query, fields=["material_id"])]
        matches = len(ids)
        if args.max:
            ids = ids[: args.max]
        ingester = Ingester(session, SOURCE)
        if not args.update:
            ids = [i for i in ids if i not in ingester.existing]
        print(f"{matches} matches, {len(ids)} to download")

        done = 0
        for b in range(0, len(ids), args.batch):
            batch = ids[b : b + args.batch]
            for doc in mpr.materials.summary.search(material_ids=batch, fields=FIELDS):
                if doc.structure is None:
                    continue
                ingester.upsert(
                    doc.structure,
                    str(doc.material_id),
                    symmetry=symmetry_of(doc),
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
                done += 1
            session.commit()
            print(f"  {done}/{len(ids)} saved ({time.time() - start:.0f}s)", flush=True)

        notice(f"Imported {done} of {matches} matches in {time.time() - start:.0f}s; database now has {count(session)} materials")


if __name__ == "__main__":
    main()
