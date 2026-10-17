import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autoKgrid, defaultOptions, missingSpecies, segmentPoints, spinKeyword, writeOpenmxDat } from "./openmx";
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
    expect(atoms.filter((r) => r[1] === "Na").every((r) => r[5] === "4.50" && r[6] === "4.50")).toBe(true);
    expect(atoms.filter((r) => r[1] === "Cl").every((r) => r[5] === "3.50" && r[6] === "3.50")).toBe(true);
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

describe("DOS, band structure, spin and SOC", () => {
  const nacl = load("NaCl_rocksalt.cif");
  const base = { ...defaultOptions(nacl, "NaCl"), species };
  const path = {
    bravais_lattice: "cF2",
    spacegroup: "Fm-3m",
    points: { G: [0, 0, 0] as Vec3, X: [0, 1, 0] as Vec3, L: [0.5, 0.5, 0.5] as Vec3 },
    segments: [
      { from: "G", to: "X", length: 1.114 },
      { from: "X", to: "L", length: 0.05 },
    ],
  };

  it("chooses the spin keyword", () => {
    expect(spinKeyword({ spin: "off", soc: false })).toBe("off");
    expect(spinKeyword({ spin: "on", soc: false })).toBe("on");
    expect(spinKeyword({ spin: "nc", soc: false })).toBe("NC");
    expect(spinKeyword({ spin: "off", soc: true })).toBe("NC");
  });

  it("writes the band path with points proportional to segment length", () => {
    const dat = writeOpenmxDat(nacl, { ...base, band: { enabled: true, path, density: 20 } });
    expect(keyword(dat, "Band.dispersion")).toBe("on");
    expect(keyword(dat, "Band.Nkpath")).toBe("2");
    const rows = block(dat, "Band.kpath");
    expect(rows[0]).toEqual(["22", "0.000000", "0.000000", "0.000000", "0.000000", "1.000000", "0.000000", "G", "X"]);
    expect(rows[1][0]).toBe("2"); // short segments still get two points
    expect(rows[1].slice(-2)).toEqual(["X", "L"]);
    expect(segmentPoints(1.114, 20)).toBe(22);
  });

  it("scales band k-points for a supercell", () => {
    const dat = writeOpenmxDat(nacl, { ...base, repeat: [2, 1, 1], band: { enabled: true, path, density: 20 } });
    expect(block(dat, "Band.kpath")[1].slice(4, 7)).toEqual(["1.000000", "0.500000", "0.500000"]);
  });

  it("leaves bands out when disabled or without a path", () => {
    expect(writeOpenmxDat(nacl, base)).not.toContain("Band.dispersion");
    expect(writeOpenmxDat(nacl, { ...base, band: { enabled: true, path: null, density: 20 } })).not.toContain("Band.kpath");
  });

  it("writes DOS settings", () => {
    const dat = writeOpenmxDat(nacl, { ...base, dos: { enabled: true, emin: -12, emax: 8, kgrid: [9, 9, 9] } });
    expect(keyword(dat, "Dos.fileout")).toBe("on");
    expect(keyword(dat, "Dos.Erange")).toBe("-12.0 8.0");
    expect(keyword(dat, "Dos.Kgrid")).toBe("9 9 9");
  });

  it("sets initial moments through up/down electrons", () => {
    const dat = writeOpenmxDat(nacl, { ...base, spin: "on", moments: { Na: 1, Cl: -0.5 } });
    expect(keyword(dat, "scf.SpinPolarization")).toBe("on");
    const atoms = block(dat, "Atoms.SpeciesAndCoordinates");
    expect(atoms.find((r) => r[1] === "Na")!.slice(5)).toEqual(["5.00", "4.00"]);
    expect(atoms.find((r) => r[1] === "Cl")!.slice(5)).toEqual(["3.25", "3.75"]);
    // Up + down always adds up to the valence.
    for (const r of atoms) expect(Number(r[5]) + Number(r[6])).toBeCloseTo(r[1] === "Na" ? 9 : 7, 10);
    const odd = block(writeOpenmxDat(nacl, { ...base, spin: "on", moments: { Na: 0.33, Cl: 1 / 3 } }), "Atoms.SpeciesAndCoordinates");
    for (const r of odd) expect((Number(r[5]) * 100 + Number(r[6]) * 100) / 100).toBe(r[1] === "Na" ? 9 : 7);
    // Moments are ignored without spin polarization.
    const off = block(writeOpenmxDat(nacl, { ...base, moments: { Na: 1 } }), "Atoms.SpeciesAndCoordinates");
    expect(off.find((r) => r[1] === "Na")!.slice(5)).toEqual(["4.50", "4.50"]);
  });

  it("writes noncollinear atom lines and SOC", () => {
    const dat = writeOpenmxDat(nacl, { ...base, soc: true });
    expect(keyword(dat, "scf.SpinPolarization")).toBe("NC");
    expect(keyword(dat, "scf.SpinOrbit.Coupling")).toBe("on");
    const row = block(dat, "Atoms.SpeciesAndCoordinates")[0];
    expect(row).toHaveLength(13);
    expect(row.slice(7)).toEqual(["0.0", "0.0", "0.0", "0.0", "0", "off"]);
    expect(writeOpenmxDat(nacl, base)).not.toContain("SpinOrbit");
  });
});
