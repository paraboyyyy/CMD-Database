"""Import pipeline: bulk Ingester, compact storage and the Materials Project script (with a fake client)."""

import sys
import types
from pathlib import Path

import pytest
from pymatgen.core import Lattice, Structure

from app import db
from app.models import Material
from app.services.ingest import Ingester, add_material, max_id_number
from app.services.structure import compact_structure_dict, parse_structure

SAMPLES = Path(__file__).resolve().parents[2] / "data" / "samples"


@pytest.fixture()
def session_factory(tmp_path, monkeypatch):
    engine = db.make_engine(f"sqlite:///{tmp_path / 'import.db'}")
    factory = db.sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(db, "SessionLocal", factory)
    db.Base.metadata.create_all(engine)
    return factory


def nacl(a=5.64):
    return Structure.from_spacegroup("Fm-3m", Lattice.cubic(a), ["Na", "Cl"], [[0, 0, 0], [0.5, 0.5, 0.5]])


def test_ingester_assigns_ids_and_upserts(session_factory):
    with session_factory() as s:
        add_material(s, nacl(), source="other", source_id="x")  # cmd-1 from another source
        s.commit()
        ing = Ingester(s, "mp")
        ids = [ing.upsert(nacl(), f"mp-{i}").id for i in range(12)]
        s.commit()
        assert ids == [f"cmd-{n}" for n in range(2, 14)]
        assert max_id_number(s) == 13  # numeric, not lexicographic ("cmd-9" > "cmd-13" as text)

        # Re-importing updates in place instead of duplicating.
        again = Ingester(s, "mp")
        updated = again.upsert(nacl(5.70), "mp-3", band_gap=4.2)
        s.commit()
        assert updated.id == "cmd-5"
        assert s.query(Material).count() == 13
        assert s.get(Material, "cmd-5").lattice["a"] == pytest.approx(5.70)


def test_compact_structure_roundtrips_and_is_smaller():
    s = parse_structure((SAMPLES / "Al2O3_corundum.cif").read_text(), "x.cif")
    s.add_site_property("magmom", [0.0] * len(s))
    compact = compact_structure_dict(s)
    assert len(str(compact)) < 0.7 * len(str(s.as_dict()))
    back = Structure.from_dict(compact)
    assert back.matches(s)
    assert back.lattice.abc == pytest.approx(s.lattice.abc, abs=1e-6)


def test_symmetry_from_source_skips_spglib(session_factory):
    sym = {"spacegroup_symbol": "Fm-3m", "spacegroup_number": 225, "crystal_system": "cubic", "point_group": "m-3m"}
    with session_factory() as s:
        m = Ingester(s, "mp").upsert(nacl(), "mp-22862", symmetry=sym)
        assert (m.spacegroup_number, m.point_group) == (225, "m-3m")


class FakeDoc(types.SimpleNamespace):
    pass


def fake_mp_module(docs):
    """A stand-in for mp_api.client recording each search() call."""
    calls = []

    class Summary:
        def search(self, fields=None, material_ids=None, **query):
            calls.append({"fields": fields, "material_ids": material_ids, **query})
            pool = [d for d in docs if not query.get("is_stable") or d.is_stable]
            if material_ids is not None:
                pool = [d for d in pool if str(d.material_id) in material_ids]
            return pool

    class MPRester:
        def __init__(self, key, mute_progress_bars=False):
            self.materials = types.SimpleNamespace(summary=Summary())

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    module = types.ModuleType("mp_api.client")
    module.MPRester = MPRester
    return module, calls


def make_doc(i, stable=True):
    sym = types.SimpleNamespace(symbol="Fm-3m", number=225, crystal_system=types.SimpleNamespace(value="Cubic"), point_group="m-3m")
    return FakeDoc(
        material_id=f"mp-{i}", structure=nacl(5.6 + i / 100), symmetry=sym, band_gap=5.0, formation_energy_per_atom=-2.0,
        energy_above_hull=0.0 if stable else 0.1, is_stable=stable, is_metal=False, is_magnetic=False, total_magnetization=0.0,
    )


def run_import(monkeypatch, docs, *argv):
    module, calls = fake_mp_module(docs)
    monkeypatch.setitem(sys.modules, "mp_api", types.ModuleType("mp_api"))
    monkeypatch.setitem(sys.modules, "mp_api.client", module)
    monkeypatch.setenv("MP_API_KEY", "test")
    monkeypatch.setattr(sys, "argv", ["import_mp", *argv])
    from scripts import import_mp

    import_mp.main()
    return calls


def test_import_mp_batches_and_resumes(session_factory, monkeypatch):
    docs = [make_doc(i, stable=i % 3 != 0) for i in range(1, 31)]  # 20 stable, 10 not
    calls = run_import(monkeypatch, docs, "--all", "--stable-only", "--max", "0", "--batch", "7")
    assert calls[0] == {"fields": ["material_id"], "material_ids": None, "is_stable": True}
    assert len(calls) == 1 + 3  # id listing + ceil(20 / 7) batches
    with session_factory() as s:
        rows = s.query(Material).order_by(Material.id).all()
        assert len(rows) == 20 and {r.source for r in rows} == {"materials_project"}
        assert rows[0].crystal_system == "cubic" and rows[0].extra["license"].startswith("CC BY")

    # A second run downloads nothing new.
    calls = run_import(monkeypatch, docs, "--all", "--stable-only", "--max", "0")
    assert len(calls) == 1
    with session_factory() as s:
        assert s.query(Material).count() == 20
