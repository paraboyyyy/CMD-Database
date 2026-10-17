import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSupercell, findBonds, formula, latticeParams, norm, sub } from "../structure";
import { elementInfo } from "../elements";
import { parseStructureFile } from ".";
import { parseSymop } from "./cif";

const samples = fileURLToPath(new URL("../../../../data/samples", import.meta.url));
const load = (name: string) => parseStructureFile(readFileSync(resolve(samples, name), "utf8"), name);

describe("CIF", () => {
  // Expected site counts come from pymatgen (scripts/seed_samples.py checks the same numbers).
  it.each([
    ["Si_diamond.cif", "Si", 8],
    ["NaCl_rocksalt.cif", "NaCl", 8],
    ["CaF2_fluorite.cif", "CaF2", 12],
    ["TiO2_rutile.cif", "TiO2", 6],
    ["ZnO_wurtzite.cif", "ZnO", 4],
    ["Al2O3_corundum.cif", "Al2O3", 30],
    ["LiCoO2.cif", "LiCoO2", 12],
    ["MoS2_2H.cif", "MoS2", 6],
  ])("expands symmetry for %s", (file, f, n) => {
    const [crystal] = load(file);
    expect(crystal.atoms).toHaveLength(n);
    expect(formula(crystal.atoms)).toBe(f);
  });

  it("reads hexagonal cell parameters", () => {
    const [crystal] = load("Al2O3_corundum.cif");
    const p = latticeParams(crystal.lattice!);
    expect(p.a).toBeCloseTo(4.759, 3);
    expect(p.c).toBeCloseTo(12.991, 3);
    expect(p.gamma).toBeCloseTo(120, 3);
  });

  it("parses symmetry operations", () => {
    expect(parseSymop("-x+1/2, y, 'z+1/4'".replace(/'/g, ""))([0.1, 0.2, 0.3])).toEqual([0.4, 0.2, 0.55]);
    expect(parseSymop("x-y,x,z+1/2")([0.5, 0.25, 0])).toEqual([0.25, 0.5, 0.5]);
  });

  it("handles quoted values, uncertainties and type symbols with charge", () => {
    const cif = `data_test
_cell_length_a 4.00(1)
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'-x, -y, -z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Fe1 Fe2+ 0 0 0
O1 O2- 0.25 0.25 0.25
`;
    const [c] = parseStructureFile(cif, "t.cif");
    expect(c.atoms.map((a) => a.element)).toEqual(["Fe", "O", "O"]);
  });
});

describe("POSCAR", () => {
  const poscar = `Si2
1.0
0 2.7155 2.7155
2.7155 0 2.7155
2.7155 2.7155 0
Si
2
Direct
0 0 0
0.25 0.25 0.25
`;

  it("reads VASP 5 format", () => {
    const [c] = parseStructureFile(poscar, "POSCAR");
    expect(c.atoms).toHaveLength(2);
    expect(norm(sub(c.atoms[1].cart, c.atoms[0].cart))).toBeCloseTo(2.3516, 3);
  });

  it("supports negative (volume) scale and cartesian coordinates", () => {
    const text = `cubic\n-64\n1 0 0\n0 1 0\n0 0 1\nNa Cl\n1 1\nCartesian\n0 0 0\n0.5 0.5 0.5\n`;
    const [c] = parseStructureFile(text, "x.vasp");
    expect(latticeParams(c.lattice!).a).toBeCloseTo(4);
    expect(c.atoms[1].cart[0]).toBeCloseTo(2);
  });
});

describe("XYZ", () => {
  it("reads molecules", () => {
    const [mol] = load("benzene.xyz");
    expect(mol.lattice).toBeNull();
    expect(formula(mol.atoms)).toBe("CH");
    const bonds = findBonds(mol.atoms, (e) => elementInfo(e).covalentRadius);
    expect(bonds).toHaveLength(12);
  });

  it("reads trajectories and extended XYZ lattices", () => {
    const frame = (x: number) => `2\nLattice="3 0 0 0 3 0 0 0 3" step\nH 0 0 0\nH ${x} 0 0\n`;
    const frames = parseStructureFile(frame(0.7) + frame(0.8), "traj.xyz");
    expect(frames).toHaveLength(2);
    expect(frames[1].lattice![0][0]).toBe(3);
    expect(frames[1].atoms[1].cart[0]).toBe(0.8);
  });
});

describe("supercell and bonds", () => {
  it("adds boundary images to complete the cell", () => {
    const [cu] = load("Cu_fcc.cif");
    // 8 corners + 6 face centres.
    expect(buildSupercell(cu, [1, 1, 1], true)).toHaveLength(14);
    expect(buildSupercell(cu, [1, 1, 1], false)).toHaveLength(4);
    expect(buildSupercell(cu, [2, 2, 2], false)).toHaveLength(32);
  });

  it("finds tetrahedral Si-Si bonds", () => {
    const [si] = load("Si_diamond.cif");
    const atoms = buildSupercell(si, [1, 1, 1], true);
    const bonds = findBonds(atoms, (e) => elementInfo(e).covalentRadius);
    expect(bonds.length).toBeGreaterThan(0);
    for (const b of bonds) expect(b.length).toBeCloseTo(2.3517, 3);
  });
});
