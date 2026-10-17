from math import pi, sqrt

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

A_SI = 5.431
SI_CONV = {
    "lattice": [[A_SI, 0, 0], [0, A_SI, 0], [0, 0, A_SI]],
    "frac": [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0], [0.25, 0.25, 0.25], [0.25, 0.75, 0.75], [0.75, 0.25, 0.75], [0.75, 0.75, 0.25]],
    "species": ["Si"] * 8,
}


def cart(lattice, f):
    B = 2 * pi * np.linalg.inv(np.array(lattice)).T
    return np.array(f) @ B


def test_fcc_path_and_point_lengths():
    r = client.post("/api/kpath", json=SI_CONV).json()
    assert r["bravais_lattice"].startswith("cF")
    assert r["segments"][0]["from"] == "G"
    labels = {s["from"] for s in r["segments"]} | {s["to"] for s in r["segments"]}
    assert {"G", "X", "L", "W", "K", "U"} <= labels
    assert r["points"]["G"] == [0, 0, 0]
    # |X| = 2π/a and |L| = √3·π/a for an fcc lattice, whatever cell is used.
    assert np.linalg.norm(cart(SI_CONV["lattice"], r["points"]["X"])) == pytest.approx(2 * pi / A_SI)
    assert np.linalg.norm(cart(SI_CONV["lattice"], r["points"]["L"])) == pytest.approx(sqrt(3) * pi / A_SI)
    # In the conventional cubic cell the X point is a whole reciprocal vector, e.g. (0, 1, 0).
    assert sorted(abs(x) for x in r["points"]["X"]) == pytest.approx([0, 0, 1])
    for s in r["segments"]:
        assert s["length"] == pytest.approx(np.linalg.norm(cart(SI_CONV["lattice"], r["points"][s["to"]]) - cart(SI_CONV["lattice"], r["points"][s["from"]])))


def test_rotated_cell_gives_the_same_fractional_points():
    th = 0.7
    rot = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]]) @ np.array(
        [[1, 0, 0], [0, np.cos(0.3), -np.sin(0.3)], [0, np.sin(0.3), np.cos(0.3)]]
    )
    rotated = {**SI_CONV, "lattice": (np.array(SI_CONV["lattice"]) @ rot.T).tolist()}
    a = client.post("/api/kpath", json=SI_CONV).json()
    b = client.post("/api/kpath", json=rotated).json()
    assert [(s["from"], s["to"]) for s in a["segments"]] == [(s["from"], s["to"]) for s in b["segments"]]
    assert [s["length"] for s in a["segments"]] == pytest.approx([s["length"] for s in b["segments"]])
    for label, f in a["points"].items():
        assert b["points"][label] == pytest.approx(f, abs=1e-6)


def test_primitive_cell_input():
    h = A_SI / 2
    prim = {"lattice": [[0, h, h], [h, 0, h], [h, h, 0]], "frac": [[0, 0, 0], [0.25, 0.25, 0.25]], "species": ["Si", "Si"]}
    r = client.post("/api/kpath", json=prim).json()
    assert np.linalg.norm(cart(prim["lattice"], r["points"]["X"])) == pytest.approx(2 * pi / A_SI)


def test_hexagonal_path():
    a, c = 3.25, 5.207
    hexa = {
        "lattice": [[a, 0, 0], [-a / 2, a * sqrt(3) / 2, 0], [0, 0, c]],
        "frac": [[1 / 3, 2 / 3, 0], [2 / 3, 1 / 3, 0.5], [1 / 3, 2 / 3, 0.382], [2 / 3, 1 / 3, 0.882]],
        "species": ["Zn", "Zn", "O", "O"],
    }
    r = client.post("/api/kpath", json=hexa).json()
    assert r["bravais_lattice"].startswith("hP")
    assert {"G", "M", "K", "A", "L", "H"} <= set(r["points"])
    assert np.linalg.norm(cart(hexa["lattice"], r["points"]["M"])) == pytest.approx(2 * pi / (sqrt(3) * a))
    assert np.linalg.norm(cart(hexa["lattice"], r["points"]["A"])) == pytest.approx(pi / c)


def test_bad_cell():
    assert client.post("/api/kpath", json={**SI_CONV, "species": ["Si"]}).status_code == 422
