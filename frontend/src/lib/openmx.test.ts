import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autoKgrid, defaultOptions, missingSpecies, writeOpenmxDat } from "./openmx";
import { parseStructureFile } from "./parsers";
import { type Mat3, type Vec3, cartToFrac, fracToCart, norm, sub } from "./structure";

const load = (name: string) => {
  const path = fileURLToPath(new URL(`../../../data/samples/${name}`, import.meta.url));
  return parseStructureFile(readFileSync(path, "utf8"), name)[0];
};

const species = {
  Na: { pao: "Na9.0-s3p2d1", vps: "Na_PBE19", valence: 9 },
  Cl: { pao: "Cl7.0-s2p2d1f1", vps: "Cl_PBE19", valence: 7 },
};

/** Pull a <Block ... Block> out of the file as rows of tokens. */
function block(dat: string, name: string): string[][] {
  const m = dat.match(new RegExp(`<${name}\\n([\\s\\S]*?)\\n${name}>`));
  if (!m) throw new Error(`missing block ${name}`);
  return m[1].trim().split("\n").map((l) => l.trim().split(/\s+/));
}
const keyword = (dat: string, key: string) => dat.match(new RegExp(`^${key.replace(/\./g, "\\.")}\\s+(.+)$`, "m"))?.[1];

describe("OpenMX .dat writer", () => {
  const nacl = load("NaCl_rocksalt.cif");

  it("writes species, coordinates and cell blocks", () => {
    const dat = writeOpenmxDat(nacl, { ...defaultOptions(nacl, "NaCl"), species, coordinates: "Ang" });
    expect(keyword(dat, "System.CurrrentDirectory")).toBe("./");
    expect(keyword(dat, "Species.Number")).toBe("2");
    expect(block(dat, "Definition.of.Atomic.Species")).toEqual([
      ["Na", "Na9.0-s3p2d1", "Na_PBE19"],
      ["Cl", "Cl7.0-s2p2d1f1", "Cl_PBE19"],
    ]);
    expect(keyword(dat, "Atoms.Number")).toBe("8");
    expect(keyword(dat, "Atoms.SpeciesAndCoordinates.Unit")).toBe("Ang");
    const atoms = block(dat, "Atoms.SpeciesAndCoordinates");
    expect(atoms).toHaveLength(8);
    expect(atoms.map((r) => r[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    // Up and down electrons are half the valence each.
    expect(atoms.filter((r) => r[1] === "Na").every((r) => r[5] === "4.5" && r[6] === "4.5")).toBe(true);
    expect(atoms.filter((r) => r[1] === "Cl").every((r) => r[5] === "3.5" && r[6] === "3.5")).toBe(true);
    const cell = block(dat, "Atoms.UnitVectors").map((r) => r.map(Number));
    expect(cell[0][0]).toBeCloseTo(5.64, 6);
    expect(cell[2][2]).toBeCloseTo(5.64, 6);
    expect(keyword(dat, "scf.Kgrid")).toBe("4 4 4");
  });

  it("fractional and Cartesian outputs describe the same positions", () => {
    const al2o3 = load("Al2O3_corundum.cif");
    const sp = { Al: { pao: "A", vps: "B", valence: 3 }, O: { pao: "C", vps: "D", valence: 6 } };
    const opts = { ...defaultOptions(al2o3, "x"), species: sp };
    const cart = block(writeOpenmxDat(al2o3, { ...opts, coordinates: "Ang" }), "Atoms.SpeciesAndCoordinates");
    const datFrac = writeOpenmxDat(al2o3, { ...opts, coordinates: "FRAC" });
    expect(keyword(datFrac, "Atoms.SpeciesAndCoordinates.Unit")).toBe("FRAC");
    const frac = block(datFrac, "Atoms.SpeciesAndCoordinates");
    const cell = block(datFrac, "Atoms.UnitVectors").map((r) => r.map(Number)) as Mat3;
    expect(frac).toHaveLength(30);
    frac.forEach((row, i) => {
      expect(row[1]).toBe(cart[i][1]);
      const f = row.slice(2, 5).map(Number) as Vec3;
      f.forEach((x) => expect(x >= 0 && x < 1).toBe(true));
      // Same atom up to a lattice translation: the fractional difference is an integer vector.
      const c = cartToFrac(cart[i].slice(2, 5).map(Number) as Vec3, cell);
      const d = sub(f, c).map((x) => x - Math.round(x)) as Vec3;
      expect(norm(fracToCart(d, cell))).toBeLessThan(1e-5);
    });
  });

  it("builds supercells with a scaled cell and k-grid", () => {
    const opts = { ...defaultOptions(nacl, "NaCl"), species, repeat: [2, 1, 1] as Vec3 };
    opts.kgrid = autoKgrid(nacl.lattice!, opts.repeat);
    const dat = writeOpenmxDat(nacl, opts);
    expect(keyword(dat, "Atoms.Number")).toBe("16");
    expect(Number(block(dat, "Atoms.UnitVectors")[0][0])).toBeCloseTo(11.28, 6);
    expect(keyword(dat, "scf.Kgrid")).toBe("2 4 4");
  });

  it("reports incomplete species and marks them in the file", () => {
    expect(missingSpecies(nacl, species)).toEqual([]);
    expect(missingSpecies(nacl, { Na: species.Na })).toEqual(["Cl"]);
    expect(missingSpecies(nacl, { ...species, Cl: { ...species.Cl, valence: null } })).toEqual(["Cl"]);
    const dat = writeOpenmxDat(nacl, { ...defaultOptions(nacl, "NaCl"), species: { Na: species.Na } });
    expect(block(dat, "Definition.of.Atomic.Species")[1]).toEqual(["Cl", "?", "?"]);
  });

  it("switches to geometry optimisation", () => {
    const dat = writeOpenmxDat(nacl, { ...defaultOptions(nacl, "NaCl"), species, task: "opt" });
    expect(keyword(dat, "MD.Type")).toBe("RF");
    expect(keyword(dat, "MD.maxIter")).toBe("100");
  });

  it("rejects molecules", () => {
    const water = load("water.xyz");
    expect(() => writeOpenmxDat(water, defaultOptions(water, "w"))).toThrow(/periodic/);
  });
});
