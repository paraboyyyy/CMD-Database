"""Import structure files (CIF, POSCAR/CONTCAR, .vasp, pymatgen .json) from a folder.

Useful for COD downloads or a lab's own calculation outputs.

    python -m scripts.import_files path/to/folder --source cod
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pymatgen.core import Structure

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.services.ingest import add_material  # noqa: E402
from app.services.structure import StructureParseError, parse_structure  # noqa: E402

PATTERNS = ("*.cif", "*.vasp", "POSCAR*", "CONTCAR*", "*.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--source", default="upload", help="Source label stored with each entry")
    args = parser.parse_args()

    files = sorted({p for pattern in PATTERNS for p in args.folder.rglob(pattern)})
    if not files:
        raise SystemExit(f"No structure files found in {args.folder}")

    settings.load_demo_data = False
    init_db()
    ok = failed = 0
    with SessionLocal() as session:
        for path in files:
            try:
                structure = parse_structure(path.read_text(errors="replace"), path.name)
                if not isinstance(structure, Structure):
                    raise StructureParseError("not a periodic structure")
                material = add_material(
                    session, structure, source=args.source, source_id=str(path.relative_to(args.folder))
                )
                ok += 1
                print(f"{material.id:10s} {material.formula_pretty:12s} {path}")
            except StructureParseError as exc:
                failed += 1
                print(f"SKIP {path}: {exc}", file=sys.stderr)
        session.commit()
    print(f"Imported {ok}, skipped {failed}")


if __name__ == "__main__":
    main()
