import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def hall_of(number: int, choice: str | None = None) -> int:
    group = next(g for g in client.get("/api/spacegroups").json() if g["number"] == number)
    settings = group["settings"]
    return next(s["hall"] for s in settings if choice is None or s["choice"] == choice)


def cubic(a):
    return {"a": a, "b": a, "c": a, "alpha": 90, "beta": 90, "gamma": 90}


def hexagonal(a, c):
    return {"a": a, "b": a, "c": c, "alpha": 90, "beta": 90, "gamma": 120}


def test_spacegroup_list():
    res = client.get("/api/spacegroups")
    groups = res.json()
    assert len(groups) == 230 and sum(len(g["settings"]) for g in groups) == 530
    assert groups[224]["symbol"] == "Fm-3m" and groups[224]["crystal_system"] == "cubic"
    assert [s["choice"] for s in groups[226]["settings"]] == ["1", "2"]  # Fd-3m origin choices
    assert "max-age" in res.headers["cache-control"]


@pytest.mark.parametrize(
    "number,choice,lattice,sites,natoms,mult,symbol",
    [
        (225, None, cubic(5.64), [("Na", [0, 0, 0]), ("Cl", [0.5, 0.5, 0.5])], 8, [4, 4], "Fm-3m"),
        (227, "1", cubic(5.431), [("Si", [0, 0, 0])], 8, [8], "Fd-3m"),
        (227, "2", cubic(5.431), [("Si", [0.125, 0.125, 0.125])], 8, [8], "Fd-3m"),
        (186, None, hexagonal(3.25, 5.207), [("Zn", [1 / 3, 2 / 3, 0]), ("O", [1 / 3, 2 / 3, 0.382])], 4, [2, 2], "P6_3mc"),
        (167, "H", hexagonal(4.759, 12.991), [("Al", [0, 0, 0.3523]), ("O", [0.3064, 0, 0.25])], 30, [12, 18], "R-3c"),
        (221, None, cubic(3.905), [("Sr", [0, 0, 0]), ("Ti", [0.5] * 3), ("O", [0.5, 0.5, 0])], 5, [1, 1, 3], "Pm-3m"),
    ],
)
def test_build_expands_sites(number, choice, lattice, sites, natoms, mult, symbol):
    body = {"hall": hall_of(number, choice), "lattice": lattice, "sites": [{"element": e, "frac": f} for e, f in sites]}
    res = client.post("/api/build", json=body).json()
    assert len(res["atoms"]) == natoms
    assert res["multiplicities"] == mult
    assert res["spacegroup"]["symbol"] == symbol
    assert res["detected"]["spacegroup_symbol"] == symbol
    assert res["warnings"] == []
    assert all(0 <= x < 1 for a in res["atoms"] for x in a["frac"])


def test_special_positions_and_higher_detected_symmetry():
    # Typed decimals for 1/3 still collapse onto the special position; a lone site there is hcp,
    # so the detected symmetry is higher than the space group used to build it.
    body = {"hall": hall_of(186), "lattice": hexagonal(3.25, 5.207), "sites": [{"element": "Zn", "frac": [0.3333, 0.6667, 0]}]}
    res = client.post("/api/build", json=body).json()
    assert len(res["atoms"]) == 2 and res["multiplicities"] == [2]
    assert res["spacegroup"]["symbol"] == "P6_3mc"
    assert res["detected"]["spacegroup_symbol"] == "P6_3/mmc"


def test_p1_keeps_sites_and_detects_higher_symmetry():
    body = {"hall": 1, "lattice": cubic(4.123), "sites": [{"element": "Cs", "frac": [0, 0, 0]}, {"element": "Cl", "frac": [0.5] * 3}]}
    res = client.post("/api/build", json=body).json()
    assert len(res["atoms"]) == 2
    assert res["spacegroup"]["symbol"] == "P1"
    assert res["detected"]["spacegroup_number"] == 221


def test_atoms_carry_the_rotation_that_generated_them():
    import numpy as np

    site = [0.3064, 0.0, 0.25]
    body = {"hall": hall_of(167, "H"), "lattice": hexagonal(4.759, 12.991), "sites": [{"element": "O", "frac": site}]}
    res = client.post("/api/build", json=body).json()
    for atom in res["atoms"]:
        rot = np.array(atom["rotation"]).reshape(3, 3)
        # R·site differs from the atom only by a lattice translation + the centring/screw part,
        # and a small move d of the site moves this image by R·d.
        assert abs(round(np.linalg.det(rot))) == 1
        d = np.array([0.01, 0.0, 0.0])
        moved = client.post("/api/build", json={**body, "sites": [{"element": "O", "frac": (np.array(site) + d).tolist()}]}).json()
        target = (np.array(atom["frac"]) + rot @ d) % 1.0
        assert any(np.allclose((np.array(m["frac"]) - target + 0.5) % 1.0 - 0.5, 0, atol=1e-6) for m in moved["atoms"])


def test_rhombohedral_setting():
    lattice = {"a": 5.13, "b": 5.13, "c": 5.13, "alpha": 55.3, "beta": 55.3, "gamma": 55.3}
    body = {"hall": hall_of(167, "R"), "lattice": lattice, "sites": [{"element": "Al", "frac": [0.3523] * 3}]}
    res = client.post("/api/build", json=body).json()
    assert len(res["atoms"]) == 4 and res["multiplicities"] == [4]


def test_overlapping_sites_are_reported():
    body = {"hall": 1, "lattice": cubic(4), "sites": [{"element": "Na", "frac": [0, 0, 0]}, {"element": "Cl", "frac": [0.05, 0, 0]}]}
    res = client.post("/api/build", json=body).json()
    assert len(res["warnings"]) == 1 and "0.20 Å" in res["warnings"][0]


@pytest.mark.parametrize(
    "body",
    [
        {"hall": 1, "lattice": cubic(4), "sites": [{"element": "Xx", "frac": [0, 0, 0]}]},
        {"hall": 1, "lattice": {**cubic(4), "alpha": 170, "beta": 10}, "sites": [{"element": "H", "frac": [0, 0, 0]}]},
        {"hall": 999, "lattice": cubic(4), "sites": [{"element": "H", "frac": [0, 0, 0]}]},
        {"hall": 1, "lattice": cubic(4), "sites": []},
    ],
)
def test_build_rejects_bad_input(body):
    assert client.post("/api/build", json=body).status_code == 422
