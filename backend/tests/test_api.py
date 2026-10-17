from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymatgen.core import Lattice, Structure

from app import db
from app.db import get_session
from app.config import normalize_database_url
from app.main import app
from app.services.formula import formula_key, parse_formula
from app.services.ingest import add_material
from app.services.structure import parse_structure, summarize

SAMPLES = Path(__file__).resolve().parents[2] / "data" / "samples"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = db.make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    session_factory = db.sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(db, "SessionLocal", session_factory)
    db.Base.metadata.create_all(engine)

    with session_factory() as session:
        nacl = Structure.from_spacegroup(
            "Fm-3m", Lattice.cubic(5.64), ["Na", "Cl"], [[0, 0, 0], [0.5, 0.5, 0.5]]
        )
        si = Structure.from_spacegroup("Fd-3m", Lattice.cubic(5.431), ["Si"], [[0, 0, 0]])
        fe2o3 = Structure.from_spacegroup(
            "R-3c", Lattice.hexagonal(5.035, 13.747), ["Fe", "O"], [[0, 0, 0.3553], [0.3059, 0, 0.25]]
        )
        add_material(session, nacl, source="test", source_id="nacl", band_gap=5.0)
        add_material(session, si, source="test", source_id="si", band_gap=0.6)
        add_material(session, fe2o3, source="test", source_id="fe2o3")
        session.commit()

    def override():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_list_and_detail(client):
    page = client.get("/api/materials").json()
    assert page["total"] == 3
    assert [m["id"] for m in page["items"]] == ["cmd-1", "cmd-2", "cmd-3"]

    nacl = client.get("/api/materials/cmd-1").json()
    assert nacl["formula_pretty"] == "NaCl"
    assert nacl["spacegroup_number"] == 225
    assert nacl["crystal_system"] == "cubic"
    assert nacl["lattice"]["a"] == pytest.approx(5.64)
    assert client.get("/api/materials/cmd-999").status_code == 404


@pytest.mark.parametrize(
    "params,expected",
    [
        ({"q": "Fe2O3"}, ["Fe2O3"]),
        ({"q": "O-Fe"}, ["Fe2O3"]),
        ({"q": "cmd-2"}, ["Si"]),
        ({"formula": "Na2Cl2"}, ["NaCl"]),
        ({"elements": "Cl"}, ["NaCl"]),
        ({"exclude_elements": "Fe,Cl"}, ["Si"]),
        ({"spacegroup_number": 227}, ["Si"]),
        ({"crystal_system": "trigonal"}, ["Fe2O3"]),
        ({"band_gap_min": 1}, ["NaCl"]),
        ({"nelements_min": 2}, ["NaCl", "Fe2O3"]),
    ],
)
def test_search_filters(client, params, expected):
    items = client.get("/api/materials", params=params).json()["items"]
    assert [m["formula_pretty"] for m in items] == expected


def test_element_counts(client):
    res = client.get("/api/elements")
    assert res.json() == {"total": 3, "counts": {"Cl": 1, "Na": 1, "Si": 1, "Fe": 1, "O": 1}}
    assert "s-maxage" in res.headers["cache-control"]
    assert client.get("/api/elements", params={"with": "O"}).json() == {"total": 1, "counts": {"Fe": 1, "O": 1}}
    assert client.get("/api/elements", params={"with": "O,Na"}).json() == {"total": 0, "counts": {}}


def test_sort_and_paginate(client):
    page = client.get("/api/materials", params={"sort": "density", "order": "desc", "limit": 1}).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert page["items"][0]["formula_pretty"] == "Fe2O3"


def test_invalid_formula(client):
    assert client.get("/api/materials", params={"formula": "Xx9"}).status_code == 422


@pytest.mark.parametrize("fmt", ["cif", "poscar", "xyz", "json"])
def test_download_roundtrip(client, fmt):
    res = client.get("/api/materials/cmd-3/download", params={"fmt": fmt})
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    name = {"cif": "x.cif", "poscar": "POSCAR", "json": "x.json", "xyz": "x.xyz"}[fmt]
    if fmt == "xyz":
        # Extended XYZ keeps the lattice, so it round-trips as a periodic structure.
        lines = res.text.splitlines()
        matrix = [float(v) for v in lines[1].split('"')[1].split()]
        rows = [line.split() for line in lines[2:]]
        structure = Structure(
            [matrix[0:3], matrix[3:6], matrix[6:9]],
            [r[0] for r in rows],
            [[float(v) for v in r[1:4]] for r in rows],
            coords_are_cartesian=True,
        )
    else:
        structure = parse_structure(res.text, name)
    assert summarize(structure)["spacegroup_symbol"] == "R-3c"
    assert len(structure) == 30


def _cell(structure):
    return {
        "lattice": structure.lattice.matrix.tolist(),
        "frac": structure.frac_coords.tolist(),
        "species": [site.specie.symbol for site in structure],
    }


def test_symmetry_endpoint(client):
    al2o3 = parse_structure((SAMPLES / "Al2O3_corundum.cif").read_text(), "x.cif")
    res = client.post("/api/symmetry", json=_cell(al2o3)).json()
    assert res == {
        "spacegroup_symbol": "R-3c",
        "spacegroup_number": 167,
        "crystal_system": "trigonal",
        "point_group": "-3m",
    }
    zno = parse_structure((SAMPLES / "ZnO_wurtzite.cif").read_text(), "x.cif")
    assert client.post("/api/symmetry", json=_cell(zno)).json()["crystal_system"] == "hexagonal"


def test_symmetry_rejects_bad_cells(client):
    bad = {"lattice": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "frac": [[0, 0, 0]], "species": ["H", "H"]}
    assert client.post("/api/symmetry", json=bad).status_code == 422
    flat = {"lattice": [[1, 0, 0], [2, 0, 0], [0, 0, 1]], "frac": [[0, 0, 0]], "species": ["H"]}
    assert client.post("/api/symmetry", json=flat).status_code == 422


@pytest.mark.parametrize(
    "formula,key",
    [("Fe2O3", "Fe2O3"), ("O3Fe2", "Fe2O3"), ("Fe4O6", "Fe2O3"), ("LiCoO2", "CoLiO2"), ("Ca3(PO4)2", "Ca3O8P2"), ("Si", "Si")],
)
def test_formula_key(formula, key):
    assert formula_key(parse_formula(formula)) == key


@pytest.mark.parametrize("bad", ["Xx9", "fe2o3", "Fe(O", "Fe)2", ""])
def test_formula_rejects(bad):
    with pytest.raises(ValueError):
        parse_formula(bad)


def test_formula_key_matches_pymatgen():
    # The key computed at import (pymatgen composition) must equal the key from parsing the search text.
    for path in SAMPLES.glob("*.cif"):
        structure = parse_structure(path.read_text(), path.name)
        assert summarize(structure)["formula_key"] == formula_key(parse_formula(structure.composition.formula))


def test_demo_fixture_loads_into_empty_db(tmp_path, monkeypatch):
    engine = db.make_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(db, "SessionLocal", db.sessionmaker(bind=engine, expire_on_commit=False))
    db.Base.metadata.create_all(engine)
    assert db.load_demo_data() == 17
    assert db.load_demo_data() == 0  # not loaded twice


@pytest.mark.parametrize(
    "url,expected",
    [
        ("postgres://u:p@h/db?sslmode=require", "postgresql+psycopg://u:p@h/db?sslmode=require"),
        ("postgresql://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
        ("postgresql+psycopg://u@h/db", "postgresql+psycopg://u@h/db"),
        ("sqlite:///x.db", "sqlite:///x.db"),
    ],
)
def test_database_url_normalization(url, expected):
    assert normalize_database_url(url) == expected
