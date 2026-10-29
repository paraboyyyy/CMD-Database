import { describe, expect, it } from "vitest";
import { constrainLattice, p1Crystal, stateFromCrystal, substitute, supercell, TEMPLATES } from "./builder";
import { parseStructureFile } from "./parsers";
import { formula, latticeParams, norm, sub } from "./structure";
import { toCif, toPoscar, toXyz } from "./writers";

const base = { a: 4, b: 5, c: 6, alpha: 80, beta: 95, gamma: 100 };

describe("lattice constraints per crystal system", () => {
  it.each([
    ["cubic", "", { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 }, ["a"]],
    ["tetragonal", "", { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 90 }, ["a", "c"]],
    ["orthorhombic", "", { a: 4, b: 5, c: 6, alpha: 90, beta: 90, gamma: 90 }, ["a", "b", "c"]],
    ["hexagonal", "", { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 }, ["a", "c"]],
    ["trigonal", "H", { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 }, ["a", "c"]],
    ["trigonal", "R", { a: 4, b: 4, c: 4, alpha: 80, beta: 80, gamma: 80 }, ["a", "alpha"]],
    ["monoclinic", "b1", { a: 4, b: 5, c: 6, alpha: 90, beta: 95, gamma: 90 }, ["a", "b", "c", "beta"]],
    ["monoclinic", "c1", { a: 4, b: 5, c: 6, alpha: 90, beta: 90, gamma: 100 }, ["a", "b", "c", "gamma"]],
    ["triclinic", "", base, ["a", "b", "c", "alpha", "beta", "gamma"]],
  ])("%s %s", (system, choice, params, editable) => {
    expect(constrainLattice(base, system, choice)).toEqual({ params, editable });
  });
});

describe("builder operations", () => {
  const rocksalt = { name: "NaCl", ...TEMPLATES.find((t) => t.id === "rocksalt")!.state };
  const p1 = { ...rocksalt, spacegroup: 1, hall: 1 };

  it("makes supercells", () => {
    const big = supercell(p1, [2, 1, 3]);
    expect(big.sites).toHaveLength(12);
    expect(big.params.a).toBeCloseTo(11.28);
    expect(big.params.c).toBeCloseTo(16.92);
    expect(big.sites.every((s) => s.frac.every((x) => x >= 0 && x < 1))).toBe(true);
    // Same Na position in absolute terms: (0.5, 0.5, 0.5) of the unit cell becomes (0.25, 0.5, 1/6).
    expect(big.sites.filter((s) => s.element === "Cl")[0].frac).toEqual([0.25, 0.5, 0.16666667]);
  });

  it("substitutes elements", () => {
    const kcl = substitute(p1, "Na", "K");
    expect(kcl.sites.map((s) => s.element)).toEqual(["K", "Cl"]);
  });

  it("round-trips a crystal through the builder state", () => {
    const crystal = p1Crystal(p1);
    const back = p1Crystal(stateFromCrystal(crystal, "x"));
    crystal.atoms.forEach((a, i) => expect(norm(sub(a.cart, back.atoms[i].cart))).toBeLessThan(1e-6));
  });

  it("has a valid state for every template", () => {
    for (const t of TEMPLATES) {
      expect(t.state.sites.length).toBeGreaterThan(0);
      expect(t.state.hall >= 1 && t.state.hall <= 530).toBe(true);
    }
  });
});

describe("writers round-trip through the parsers", () => {
  const crystal = p1Crystal({ name: "t", spacegroup: 1, hall: 1, params: base, sites: [
    { element: "Fe", frac: [0.1, 0.2, 0.3] },
    { element: "O", frac: [0.6, 0.7, 0.95] },
    { element: "Fe", frac: [0, 0, 0] },
  ] });

  it.each([
    ["cif", "t.cif", toCif],
    ["poscar", "POSCAR", toPoscar],
    ["xyz", "t.xyz", toXyz],
  ] as const)("%s", (_, file, write) => {
    const [back] = parseStructureFile(write(crystal, "test"), file);
    const p = latticeParams(back.lattice!);
    expect(p.a).toBeCloseTo(4, 6);
    expect(p.gamma).toBeCloseTo(100, 6);
    expect(formula(back.atoms)).toBe("Fe2O");
    for (const a of crystal.atoms) {
      const match = back.atoms.find((b) => b.element === a.element && norm(sub(a.cart, b.cart)) < 1e-5);
      expect(match).toBeDefined();
    }
  });
});
