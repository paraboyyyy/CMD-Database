from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymatgen.core import Lattice, Structure

from app import db
from app.db import get_session
from app.main import app
from app.services.ingest import add_material

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


def test_sort_and_paginate(client):
    page = client.get("/api/materials", params={"sort": "density", "order": "desc", "limit": 1}).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert page["items"][0]["formula_pretty"] == "Fe2O3"


def test_invalid_formula(client):
    assert client.get("/api/materials", params={"formula": "Xx9"}).status_code == 422


@pytest.mark.parametrize("fmt", ["cif", "poscar", "xyz", "json"])
def test_download_roundtrip(client, fmt):
    res = client.get("/api/materials/cmd-1/download", params={"fmt": fmt})
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    if fmt != "xyz":
        name = {"cif": "x.cif", "poscar": "POSCAR", "json": "x.json"}[fmt]
        files = {"file": (name, res.content)}
        parsed = client.post("/api/parse", files=files).json()
        assert parsed["spacegroup_number"] == 225


def test_parse_sample_cif(client):
    cif = (SAMPLES / "Al2O3_corundum.cif").read_bytes()
    parsed = client.post("/api/parse", files={"file": ("Al2O3.cif", cif)}).json()
    assert parsed["periodic"] is True
    assert parsed["formula_pretty"] == "Al2O3"
    assert parsed["spacegroup_symbol"] == "R-3c"


def test_parse_xyz_molecule(client):
    xyz = b"3\nwater\nO 0 0 0.1173\nH 0 0.7572 -0.4692\nH 0 -0.7572 -0.4692\n"
    parsed = client.post("/api/parse", files={"file": ("water.xyz", xyz)}).json()
    assert parsed["periodic"] is False
    assert parsed["formula_pretty"] == "H2O"
    assert parsed["lattice"] is None


def test_parse_rejects_bad_files(client):
    assert client.post("/api/parse", files={"file": ("a.txt", b"hi")}).status_code == 422
    assert client.post("/api/parse", files={"file": ("a.cif", b"garbage")}).status_code == 422
