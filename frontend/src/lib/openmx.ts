import { type Crystal, type Mat3, type Vec3, buildSupercell, cartToFrac, norm, wrap01 } from "./structure";

// Writer for OpenMX 4.0 input files (.dat). Every keyword, block layout and default below follows the
// OpenMX Ver. 4.0 manual; section numbers in the comments point to the chapter that describes it.

/** Basis and pseudopotential for one element, as named in the OpenMX DFT_DATA folder. */
export interface OpenmxSpecies {
  pao: string; // e.g. "Si7.0-s2p2d1"
  vps: string; // e.g. "Si_PBE19"
  valence: number | null; // electrons in the VPS ("valence.electron" in the .vps file)
}

/** Band-structure path from /api/kpath, in fractional coordinates of the unit cell's reciprocal lattice. */
export interface KPath {
  bravais_lattice: string;
  spacegroup: string;
  points: Record<string, Vec3>;
  segments: { from: string; to: string; length: number }[];
}

export type Task = "scf" | "opt" | "cellopt" | "md" | "evslc";
export type Xc = "GGA-PBE" | "LDA" | "LSDA-CA" | "LSDA-PW";
export type Solver = "Band" | "Cluster" | "DC" | "DC-LNO" | "Krylov" | "ON2";
export type MixingType = "RMM-DIISK" | "RMM-DIIS" | "RMM-DIISV" | "RMM-DIISH" | "GR-Pulay" | "Kerker" | "Simple";
export type OptMethod = "RF" | "BFGS" | "EF" | "DIIS" | "Opt";
export type CellMethod = "RFC5" | "RFC6" | "RFC7" | "OptC1" | "OptC2" | "OptC3" | "OptC4" | "OptC5" | "OptC6" | "OptC7";
export type MdEnsemble = "NVE" | "NVT_VS" | "NVT_VS2" | "NVT_VS4" | "NVT_NH" | "NPT_VS_PR" | "NPT_VS_WV";
export type Restart = "off" | "on" | "pp" | "c2n";
/** Wannier projector orbitals (manual Table 10); "" means no projector on that element. */
export type Projector = "" | "s" | "p" | "d" | "f" | "sp" | "sp2" | "sp3" | "sp3dz2" | "sp3deg";

export const PROJECTOR_COUNT: Record<Exclude<Projector, "">, number> = {
  s: 1, p: 3, d: 5, f: 7, sp: 2, sp2: 3, sp3: 4, sp3dz2: 5, sp3deg: 6,
};

/** DFT+U on one radial orbital of an element, e.g. orbital "1d" with U = 4 eV. */
export interface HubbardEntry {
  orbital: string; // "1d", "2p", ... or "" for none
  U: number; // eV
  J: number; // eV, only for scf.DFTU.Type 2
}

export interface OpenmxOptions {
  systemName: string;
  coordinates: "Ang" | "FRAC";
  repeat: Vec3;
  species: Record<string, OpenmxSpecies>;
  /** Atomic mass per element (4th column of Definition.of.Atomic.Species, §20.9); null = OpenMX default. */
  masses: Record<string, number | null>;
  dataPath: string;
  fileout: 0 | 1 | 2; // level.of.fileout: 0 none, 1 cube files of densities and potentials, 2 + more

  // Electronic structure
  xc: Xc;
  spin: "off" | "on" | "nc";
  /** Spin–orbit coupling (needs noncollinear spin, §38). */
  soc: boolean;
  /** Uniform scaling of the SOC strength (scf.SO.factor, §38.2); 1 = physical. */
  socScale: number;
  /** Initial magnetic moment per element in μB (spin-polarized runs). */
  moments: Record<string, number>;
  /** Initial spin direction per element as Euler angles (θ, φ) in degrees, noncollinear runs (§37). */
  angles: Record<string, [number, number]>;
  charge: number; // scf.system.charge: + removes electrons (holes), − adds electrons (§31)
  efield: Vec3; // scf.Electric.Field in GV/m (§30)

  scf: {
    energyCutoff: number; // Ry
    kgrid: Vec3;
    kgridType: "GCenter" | "Regular";
    electronicTemperature: number; // K
    maxIter: number;
    criterion: number; // Hartree
    solver: Solver;
    mixing: MixingType;
    initWeight: number;
    minWeight: number;
    maxWeight: number;
    history: number;
    startPulay: number;
    restart: Restart;
    restartFile: string; // scf.restart.filename (System.Name of the run that wrote the restart files)
    restartAngles: [number, number]; // c2n: spin direction θ, φ (§42)
  };

  task: Task;
  opt: { method: OptMethod; maxIter: number; criterion: number; fixed: string };
  cell: { method: CellMethod; maxIter: number; criterion: number; pressure: number; fixed: boolean[] };
  md: {
    ensemble: MdEnsemble;
    steps: number;
    timestep: number; // fs
    temperature: number; // K
    interval: number; // velocity-scaling interval (steps)
    alpha: number; // velocity-scaling parameter
    nhMass: number; // NH.Mass.HeatBath
    barostatMass: number | null; // NPT.Mass.Barostat; null = OpenMX default
    pressure: number; // GPa
    restriction: "none" | "cubic" | "ortho";
    tolerance: number; // MD.TempTolerance (K)
    fixed: string;
  };
  evslc: { step: number; steps: number; flag: Vec3 };

  dftU: {
    enabled: boolean;
    type: 1 | 2; // 1 simplified (Dudarev), 2 general
    occupation: "dual" | "onsite" | "full";
    dc: "sFLL" | "sAMF" | "cFLL" | "cAMF";
    values: Record<string, HubbardEntry>;
    orbitalPolarization: boolean;
    yukawa: boolean;
  };
  constraint: { mode: "off" | "on" | "on2"; strength: number }; // §41
  zeeman: { spin: boolean; spinField: number; orbital: boolean; orbitalField: number }; // §43, Tesla
  spiral: { enabled: boolean; q: Vec3 }; // §57
  vdw: { mode: "off" | "D2" | "D3"; damp: "bj" | "zero" }; // §54
  esm: { mode: "off" | "on1" | "on2" | "on3" | "on4"; direction: "x" | "y" | "z"; buffer: number; potentialDiff: number }; // §49
  coreHole: { enabled: boolean; atom: number; l: "s" | "p" | "d" | "f"; index: number; coulombCutoff: boolean }; // §60

  dos: { enabled: boolean; method: "tetrahedron" | "gaussian"; emin: number; emax: number; kgrid: Vec3; mesh: number; width: number };
  band: { enabled: boolean; path: KPath | null; density: number }; // density: k-points per Å⁻¹
  cohp: { enabled: boolean; pairs: string }; // "atom1 atom2 l1 l2 l3" per line (§24)
  mo: { enabled: boolean; homos: number; lumos: number }; // §34
  partialCharge: { enabled: boolean; window: number }; // STM, §53
  fermiSurface: boolean; // §65
  optical: { enabled: boolean; fwhm: number; emax: number; extra: number; kgrid: Vec3 }; // §62
  unfolding: { enabled: boolean; lower: number; upper: number; nk: number }; // §55
  cwf: {
    enabled: boolean;
    window: "Poly" | "Fermi";
    erange: [number, number, number, number];
    kbt: [number, number];
    orbitals: Record<string, string[]>; // l channels used as guiding AOs, e.g. ["s", "p"]
    wannier90: boolean;
  };
  mlwf: {
    enabled: boolean;
    projectors: Record<string, Projector>;
    outer: [number, number];
    inner: [number, number];
    kgrid: Vec3;
    wannier90: boolean;
  };
  analysis: { voronoi: boolean; energyDecomposition: boolean; nbo: boolean; hs: boolean; negfLead: boolean };
}

/** Monkhorst-Pack grid with roughly `density` / |a_i| points along each reciprocal direction. */
export function autoKgrid(lattice: Mat3, repeat: Vec3 = [1, 1, 1], density = 25): Vec3 {
  return lattice.map((v, i) => Math.max(1, Math.round(density / (norm(v) * repeat[i])))) as Vec3;
}

export function defaultOptions(crystal: Crystal, name: string): OpenmxOptions {
  const kgrid: Vec3 = crystal.lattice ? autoKgrid(crystal.lattice) : [1, 1, 1];
  const dense = kgrid.map((k) => k * 2) as Vec3;
  return {
    systemName: name.replace(/[^\w.-]+/g, "_"),
    coordinates: "FRAC",
    repeat: [1, 1, 1],
    species: {},
    masses: {},
    dataPath: "../DFT_DATA19",
    fileout: 1,
    xc: "GGA-PBE",
    spin: "off",
    soc: false,
    socScale: 1,
    moments: {},
    angles: {},
    charge: 0,
    efield: [0, 0, 0],
    scf: {
      energyCutoff: 220,
      kgrid,
      kgridType: "GCenter",
      electronicTemperature: 300,
      maxIter: 100,
      criterion: 1e-6,
      solver: "Band",
      mixing: "RMM-DIISK",
      initWeight: 0.3,
      minWeight: 0.001,
      maxWeight: 0.4,
      history: 30,
      startPulay: 6,
      restart: "off",
      restartFile: "",
      restartAngles: [90, 0],
    },
    task: "scf",
    opt: { method: "RF", maxIter: 100, criterion: 3e-4, fixed: "" },
    cell: { method: "RFC5", maxIter: 100, criterion: 3e-4, pressure: 0, fixed: Array(9).fill(false) },
    md: {
      ensemble: "NVT_NH",
      steps: 1000,
      timestep: 0.5,
      temperature: 300,
      interval: 10,
      alpha: 0.5,
      nhMass: 20,
      barostatMass: null,
      pressure: 0,
      restriction: "none",
      tolerance: 100,
      fixed: "",
    },
    evslc: { step: 0.4, steps: 20, flag: [1, 1, 1] },
    dftU: { enabled: false, type: 1, occupation: "dual", dc: "sFLL", values: {}, orbitalPolarization: false, yukawa: false },
    constraint: { mode: "off", strength: 0.5 },
    zeeman: { spin: false, spinField: 100, orbital: false, orbitalField: 100 },
    spiral: { enabled: false, q: [0, 0, 0.1] },
    vdw: { mode: "off", damp: "bj" },
    esm: { mode: "off", direction: "x", buffer: 10, potentialDiff: 0 },
    coreHole: { enabled: false, atom: 1, l: "s", index: 1, coulombCutoff: true },
    dos: { enabled: false, method: "tetrahedron", emin: -10, emax: 10, kgrid: dense, mesh: 200, width: 0.2 },
    band: { enabled: false, path: null, density: 20 },
    cohp: { enabled: false, pairs: "1 2 0 0 0" },
    mo: { enabled: false, homos: 2, lumos: 2 },
    partialCharge: { enabled: false, window: -1 },
    fermiSurface: false,
    optical: { enabled: false, fwhm: 0.2, emax: 10, extra: 1, kgrid: dense },
    unfolding: { enabled: false, lower: -10, upper: 10, nk: 100 },
    cwf: { enabled: false, window: "Poly", erange: [-20, -18, 1, 10], kbt: [3, 3], orbitals: {}, wannier90: false },
    mlwf: { enabled: false, projectors: {}, outer: [-14, 4], inner: [0, 0], kgrid, wannier90: false },
    analysis: { voronoi: false, energyDecomposition: false, nbo: false, hs: false, negfLead: false },
  };
}

/** Elements in order of first appearance, which is also the species order in the file. */
export function speciesOrder(crystal: Crystal): string[] {
  return [...new Set(crystal.atoms.map((a) => a.element))];
}

/** Elements whose species definition is incomplete (the .dat would not run). */
export function missingSpecies(crystal: Crystal, species: Record<string, OpenmxSpecies>): string[] {
  return speciesOrder(crystal).filter((el) => {
    const s = species[el];
    return !s || !s.pao.trim() || !s.vps.trim() || s.valence === null || !(s.valence > 0);
  });
}

/** Radial orbitals of a PAO name: "Fe6.0S-s3p2d1" → [["s", 3], ["p", 2], ["d", 1]]. */
export function paoShells(pao: string): [string, number][] {
  const m = pao.match(/-((?:[spdfg]\d+)+)$/);
  if (!m) return [];
  return [...m[1].matchAll(/([spdfg])(\d+)/g)].map((x) => [x[1], Number(x[2])]);
}

/** Orbital labels in the order Hubbard.U.values lists them: 1s 2s 1p 2p 1d ... (§40.1). */
export function paoOrbitals(pao: string): string[] {
  return paoShells(pao).flatMap(([l, n]) => Array.from({ length: n }, (_, i) => `${i + 1}${l}`));
}

/** The atoms DFT+U usually targets: first d shell of transition metals, first f shell of 4f/5f elements. */
export function defaultHubbardOrbital(element: string, pao: string): string {
  const orbitals = paoOrbitals(pao);
  const f = /^(La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Ac|Th|Pa|U|Np|Pu|Am|Cm)$/.test(element);
  const d = /^(Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg)$/.test(element);
  if (f && orbitals.includes("1f")) return "1f";
  if (d && orbitals.includes("1d")) return "1d";
  return "";
}

/** Atom serial numbers from "1-4, 7 9": 1-based, deduplicated, sorted. */
export function parseAtomList(text: string, natoms: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= natoms) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/** COHP pairs from "atom1 atom2 l1 l2 l3" lines; malformed lines are dropped. */
export function parseCohpPairs(text: string, natoms: number): number[][] {
  return text
    .split(/\n|;/)
    .map((l) => l.trim().split(/[\s,]+/).map(Number))
    .filter((r) => r.length === 5 && r.every(Number.isInteger) && r[0] >= 1 && r[1] >= 1 && r[0] <= natoms && r[1] <= natoms);
}

const f = (x: number, digits = 10) => (Object.is(x, -0) ? 0 : x).toFixed(digits).padStart(digits + 5);
const k = (x: number) => f(x, 6);
const g = (x: number) => String(Object.is(x, -0) ? 0 : Number(x.toPrecision(10)));
const onoff = (b: boolean) => (b ? "on" : "off");

/** Features that only exist in noncollinear DFT. */
function needsNoncollinear(o: OpenmxOptions): boolean {
  return (
    o.soc ||
    o.spin === "nc" ||
    o.constraint.mode !== "off" ||
    o.zeeman.spin ||
    o.zeeman.orbital ||
    o.spiral.enabled ||
    o.scf.restart === "c2n" ||
    (o.coreHole.enabled && o.coreHole.l !== "s")
  );
}

/** Value written for scf.SpinPolarization, after the switches that force a spin treatment. */
export function spinKeyword(o: Partial<OpenmxOptions> & Pick<OpenmxOptions, "spin" | "soc">): "off" | "on" | "NC" {
  const full = { ...defaults, ...o } as OpenmxOptions;
  if (needsNoncollinear(full)) return "NC";
  // DFT+U and core-hole (XPS) calculations are spin-polarized (§40.1, §60).
  if (full.spin === "off" && (full.dftU.enabled || full.coreHole.enabled)) return "on";
  return full.spin === "nc" ? "NC" : full.spin;
}
const defaults = defaultOptions({ atoms: [], lattice: null } as unknown as Crystal, "x");

/** Whether the DOS step runs: asked for directly, or needed by COHP, STM or Fermi surfaces. */
export function dosNeeded(o: OpenmxOptions): boolean {
  return o.dos.enabled || o.cohp.enabled || o.partialCharge.enabled || o.fermiSurface;
}

/** k-points on each band-path segment, proportional to its length (at least 2). */
export function segmentPoints(length: number, density: number): number {
  return Math.max(2, Math.round(length * density));
}
const num = (x: number | null) => (x === null ? "?" : x.toFixed(2));

/** Combinations the manual rules out or warns about; shown next to the preview. */
export function openmxWarnings(crystal: Crystal, o: OpenmxOptions): string[] {
  const w: string[] = [];
  const spin = spinKeyword(o);
  const natoms = crystal.atoms.length * o.repeat[0] * o.repeat[1] * o.repeat[2];
  if (o.xc === "LDA" && spin !== "off") w.push("LDA only works without spin polarization: use LSDA-CA or LSDA-PW for spin-polarized runs.");
  if (o.spin === "off" && spin === "on") w.push("DFT+U / core-hole runs need spin polarization: scf.SpinPolarization is set to on.");
  if (o.spin !== "nc" && !o.soc && spin === "NC")
    w.push("The selected options are noncollinear features: scf.SpinPolarization is set to NC.");
  if (o.task === "cellopt" && spin === "NC") w.push("Variable-cell optimization is only available for collinear calculations (§19).");
  if (o.task === "cellopt" && o.vdw.mode !== "off") w.push("Variable-cell optimization does not support DFT-D2/D3 (§19).");
  if (o.task === "md" && o.md.ensemble.startsWith("NPT") && o.md.fixed.trim()) w.push("Constrained (fixed-atom) MD is not compatible with NPT (§20.6); MD.Fixed.XYZ is left out.");
  if (o.zeeman.spin && o.constraint.mode !== "off") w.push("scf.NC.Zeeman.Spin and scf.Constraint.NC.Spin cannot be used together (§43.1).");
  if (o.spiral.enabled && o.soc) w.push("Spin-spiral (generalized Bloch) calculations cannot include spin–orbit coupling (§57).");
  if (o.dos.enabled && o.dos.method === "gaussian" && (o.cohp.enabled || o.partialCharge.enabled || o.fermiSurface))
    w.push("COHP, STM and FermiSurfer files need Dos.fileout (tetrahedron), so the Gaussian DOS is replaced by it.");
  if (o.dftU.enabled && !Object.values(o.dftU.values).some((v) => v.orbital && (v.U || v.J)))
    w.push("DFT+U is on but no orbital has a U value.");
  if (o.analysis.nbo && o.scf.solver !== "Cluster" && o.scf.solver !== "Krylov") w.push("NBO analysis needs scf.EigenvalueSolver Cluster (on1) or Krylov (on2) (§36).");
  if (o.mo.enabled && !(o.scf.solver === "Band" || o.scf.solver === "Cluster")) w.push("MO output (HOMO/LUMO cubes) needs the Band or Cluster solver.");
  if (o.scf.solver === "Cluster" && (o.band.enabled || o.unfolding.enabled)) w.push("Band structures need scf.EigenvalueSolver Band.");
  if (o.unfolding.enabled && !o.band.path) w.push("Band unfolding uses the band path: it is written once the high-symmetry path is loaded.");
  if (o.cohp.enabled && parseCohpPairs(o.cohp.pairs, natoms).length === 0) w.push("COHP has no valid atom pairs (format: atom1 atom2 l1 l2 l3).");
  if (o.cwf.enabled && o.mlwf.enabled) w.push("CWF and MLWF are both on; usually one Wannier method is enough.");
  if (o.mlwf.enabled && mlwfCount(crystal, o) === 0) w.push("MLWF needs at least one projector (choose orbitals per element).");
  if (o.mlwf.enabled && !(o.mlwf.outer[0] < o.mlwf.outer[1])) w.push("MLWF outer window: bottom must be below top.");
  if (o.coreHole.enabled && (o.coreHole.atom < 1 || o.coreHole.atom > natoms)) w.push(`Core hole atom must be between 1 and ${natoms}.`);
  if (o.coreHole.enabled) w.push("XPS core hole: use a VPS/PAO that contains the core state as valence (e.g. C_PBE19_1s / C6.0_1s-...) for that atom (§60).");
  if (o.esm.mode === "on1" && o.charge !== 0) w.push("ESM on1 (vacuum|vacuum) requires a neutral system: set the charge to 0 (§49).");
  if (o.scf.restart === "c2n" && !o.soc) w.push("The second-variational MAE step (c2n) is meant to include spin–orbit coupling (§42).");
  if (o.scf.restart !== "off" && !o.scf.restartFile.trim()) w.push("Restart reads files of the System.Name given as scf.restart.filename (default: this System.Name).");
  if (o.analysis.negfLead) w.push("NEGF leads: transport runs along the a axis; use many k-points along a (§46.2).");
  return w;
}

/** Number of MLWFs: projector orbitals summed over all atoms of the exported cell. */
export function mlwfCount(crystal: Crystal, o: OpenmxOptions): number {
  const n = o.repeat[0] * o.repeat[1] * o.repeat[2];
  return crystal.atoms.reduce((s, a) => {
    const p = o.mlwf.projectors[a.element];
    return s + (p ? PROJECTOR_COUNT[p] * n : 0);
  }, 0);
}

/** Write an OpenMX input file (.dat) for a periodic crystal. */
export function writeOpenmxDat(crystal: Crystal, o: OpenmxOptions): string {
  if (!crystal.lattice) throw new Error("OpenMX input needs a periodic structure (unit cell)");
  const base = crystal.lattice;
  const lattice = base.map((v, i) => v.map((x) => x * o.repeat[i])) as Mat3;
  const atoms = buildSupercell(crystal, o.repeat, false);
  const order = speciesOrder(crystal);
  const spin = spinKeyword(o);
  const frac = atoms.map((a) => cartToFrac(a.cart, lattice).map((x) => wrap01(x, 1e-8)) as Vec3);
  const projectorSpecies = o.mlwf.enabled ? order.filter((el) => o.mlwf.projectors[el]) : [];

  const L: string[] = [];
  const kv = (key: string, value: string | number) => L.push(`${key.padEnd(36)} ${value}`);
  const blank = () => L.push("");
  const section = (title: string) => {
    if (L[L.length - 1] !== "") blank();
    L.push(`# ${title}`);
  };

  L.push(`# OpenMX 4.0 input generated by CMD Labs`);
  L.push(`# ${crystal.title || o.systemName}: ${atoms.length} atoms, ${o.repeat.join("x")} cell`);
  L.push(`# Check the PAO/VPS names and valence electrons against your DFT_DATA folder.`);
  blank();
  kv("System.CurrrentDirectory", "./"); // sic: OpenMX spells the keyword with three r's
  kv("System.Name", o.systemName);
  kv("DATA.PATH", o.dataPath);
  kv("level.of.stdout", 1);
  kv("level.of.fileout", o.fileout);

  section("Species");
  kv("Species.Number", order.length + projectorSpecies.length);
  L.push("<Definition.of.Atomic.Species");
  for (const el of order) {
    const s = o.species[el];
    const mass = o.masses[el];
    L.push(`  ${el.padEnd(6)} ${(s?.pao || "?").padEnd(22)} ${(s?.vps || "?").padEnd(14)}${mass ? ` ${g(mass)}` : ""}`.trimEnd());
  }
  // MLWF projectors are extra species with one radial function per l (s1p1d1f1, §47.2).
  for (const el of projectorSpecies) {
    const s = o.species[el];
    const radius = (s?.pao || el).split("-")[0];
    L.push(`  ${`proj${el}`.padEnd(6)} ${`${radius}-s1p1d1f1`.padEnd(22)} ${s?.vps || "?"}`);
  }
  L.push("Definition.of.Atomic.Species>");

  section("Structure");
  kv("Atoms.Number", atoms.length);
  kv("Atoms.SpeciesAndCoordinates.Unit", o.coordinates);
  L.push("<Atoms.SpeciesAndCoordinates");
  const flagged = o.constraint.mode !== "off" || o.zeeman.spin || o.zeeman.orbital;
  atoms.forEach((a, i) => {
    const v = o.coordinates === "FRAC" ? frac[i] : a.cart;
    const val = o.species[a.element]?.valence ?? null;
    // Up/down electrons set the initial moment: (valence ± m) / 2.
    const m = spin === "off" || val === null ? 0 : Math.max(-val, Math.min(val, o.moments[a.element] ?? 0));
    // Round `up` first and derive `down`, so the two always add up to the valence exactly.
    const up = val === null ? null : Math.round(((val + m) / 2) * 100) / 100;
    const down = val === null || up === null ? null : val - up;
    const op = onoff(o.dftU.enabled && o.dftU.orbitalPolarization);
    let extra = "";
    if (spin === "NC") {
      // Columns 8–13 (§37): Euler angles (θ, φ) of the spin and orbital moments, the switch for
      // constraint/Zeeman terms, and the orbital-polarization switch for DFT+U.
      const [t, p] = o.angles[a.element] ?? [0, 0];
      extra = `   ${t.toFixed(1)} ${p.toFixed(1)}   ${t.toFixed(1)} ${p.toFixed(1)}   ${flagged ? 1 : 0}  ${op}`;
    } else if (o.dftU.enabled && o.dftU.orbitalPolarization) {
      extra = `  ${op}`; // collinear: orbital-polarization switch in column 8 (§40.1)
    }
    L.push(`  ${String(i + 1).padStart(5)}  ${a.element.padEnd(4)}${f(v[0])}${f(v[1])}${f(v[2])}   ${num(up)}  ${num(down)}${extra}`);
  });
  L.push("Atoms.SpeciesAndCoordinates>");
  kv("Atoms.UnitVectors.Unit", "Ang");
  L.push("<Atoms.UnitVectors");
  for (const v of lattice) L.push(`  ${f(v[0])}${f(v[1])}${f(v[2])}`);
  L.push("Atoms.UnitVectors>");

  section("SCF");
  kv("scf.XcType", o.xc);
  kv("scf.SpinPolarization", spin);
  if (spin === "NC") kv("scf.SpinOrbit.Coupling", onoff(o.soc));
  kv("scf.ElectronicTemperature", o.scf.electronicTemperature.toFixed(1));
  kv("scf.energycutoff", o.scf.energyCutoff.toFixed(1));
  kv("scf.maxIter", o.scf.maxIter);
  kv("scf.EigenvalueSolver", o.scf.solver);
  if (o.scf.solver !== "Cluster") {
    kv("scf.Kgrid", o.scf.kgrid.join(" "));
    if (o.scf.kgridType !== "GCenter") kv("scf.Generation.Kpoint", o.scf.kgridType);
  }
  kv("scf.Mixing.Type", o.scf.mixing);
  kv("scf.Init.Mixing.Weight", g(o.scf.initWeight));
  kv("scf.Min.Mixing.Weight", g(o.scf.minWeight));
  kv("scf.Max.Mixing.Weight", g(o.scf.maxWeight));
  if (o.scf.mixing !== "Simple") {
    kv("scf.Mixing.History", o.scf.history);
    kv("scf.Mixing.StartPulay", o.scf.startPulay);
  }
  kv("scf.criterion", o.scf.criterion.toExponential(1));
  if (o.charge !== 0) kv("scf.system.charge", g(o.charge));
  if (o.efield.some((x) => x !== 0)) kv("scf.Electric.Field", o.efield.map(g).join(" "));
  if (o.scf.restart !== "off") {
    kv("scf.restart", o.scf.restart);
    if (o.scf.restartFile.trim()) kv("scf.restart.filename", o.scf.restartFile.trim());
    if (o.scf.restart === "c2n") {
      kv("scf.Restart.Spin.Angle.Theta", g(o.scf.restartAngles[0]));
      kv("scf.Restart.Spin.Angle.Phi", g(o.scf.restartAngles[1]));
    }
  }
  if (spin === "NC" && o.soc && o.socScale !== 1) {
    // §38.2: one factor per l, given up to f for every species.
    const s = g(o.socScale);
    L.push("<scf.SO.factor");
    for (const el of order) L.push(`  ${el} s ${s} p ${s} d ${s} f ${s}`);
    L.push("scf.SO.factor>");
  }

  if (o.dftU.enabled) {
    section("DFT+U (§40)");
    kv("scf.Hubbard.U", "on");
    kv("scf.DFTU.Type", o.dftU.type);
    kv("scf.Hubbard.Occupation", o.dftU.occupation);
    if (o.dftU.type === 2) {
      kv("scf.dc.Type", o.dftU.dc);
      if (o.dftU.yukawa) kv("scf.Yukawa", "on");
    }
    const rows = (pick: (e: HubbardEntry) => number) =>
      order.map((el) => {
        const e = o.dftU.values[el];
        const orbitals = paoOrbitals(o.species[el]?.pao ?? "");
        return `  ${el} ${orbitals.map((orb) => `${orb} ${(e && e.orbital === orb ? pick(e) : 0).toFixed(1)}`).join(" ")}`;
      });
    L.push("<Hubbard.U.values   # eV", ...rows((e) => e.U), "Hubbard.U.values>");
    if (o.dftU.type === 2 && !o.dftU.yukawa) L.push("<Hund.J.values   # eV", ...rows((e) => e.J), "Hund.J.values>");
  }

  if (spin === "NC" && (o.constraint.mode !== "off" || o.zeeman.spin || o.zeeman.orbital || o.spiral.enabled)) {
    section("Noncollinear spin control");
    if (o.constraint.mode !== "off" && !o.zeeman.spin) {
      kv("scf.Constraint.NC.Spin", o.constraint.mode);
      kv("scf.Constraint.NC.Spin.v", g(o.constraint.strength));
    }
    if (o.zeeman.spin) {
      kv("scf.NC.Zeeman.Spin", "on");
      kv("scf.NC.Mag.Field.Spin", g(o.zeeman.spinField));
    }
    if (o.zeeman.orbital) {
      kv("scf.NC.Zeeman.Orbital", "on");
      kv("scf.NC.Mag.Field.Orbital", g(o.zeeman.orbitalField));
    }
    if (o.spiral.enabled) {
      kv("scf.Generalized.Bloch", "on");
      kv("Spin.Spiral.Vector", o.spiral.q.map(g).join(" "));
    }
  }

  if (o.vdw.mode !== "off") {
    section(`van der Waals: DFT-${o.vdw.mode} (§54)`);
    kv("scf.dftD", "on");
    kv("version.dftD", o.vdw.mode === "D3" ? 3 : 2);
    if (o.vdw.mode === "D3") kv("DFTD3.damp", o.vdw.damp);
    kv("DFTD.Unit", "Ang");
    kv("DFTD.rcut_dftD", "100.0");
    if (o.vdw.mode === "D3") kv("DFTD.cncut_dftD", 40);
    kv("DFTD.IntDirection", "1 1 1");
  }

  if (o.esm.mode !== "off") {
    section("Effective screening medium (§49)");
    kv("ESM.switch", o.esm.mode);
    kv("ESM.direction", o.esm.direction);
    kv("ESM.buffer.range", g(o.esm.buffer));
    if (o.esm.mode === "on4") kv("ESM.potential.diff", g(o.esm.potentialDiff));
  }

  if (o.coreHole.enabled) {
    section("XPS core hole (§60)");
    if (o.coreHole.coulombCutoff) kv("scf.coulomb.cutoff", "on");
    kv("scf.core.hole", "on");
    L.push("<core.hole.state", `  ${o.coreHole.atom} ${o.coreHole.l} ${o.coreHole.index}`, "core.hole.state>");
  }

  // Band dispersion and unfolding need the Band solver.
  const bandSolver = o.scf.solver === "Band";
  if (o.band.enabled && o.band.path && bandSolver) {
    section("Band structure (§22)");
    // Path points are fractional in the unit cell's reciprocal lattice; a supercell's reciprocal
    // vectors are 1/n as long, so the same k-points have n times larger coordinates.
    const p = o.band.path;
    const at = (label: string) => p.points[label].map((x, i) => x * o.repeat[i]) as Vec3;
    kv("Band.dispersion", "on");
    kv("Band.Nkpath", p.segments.length);
    L.push("<Band.kpath");
    for (const seg of p.segments) {
      const [a, b] = [at(seg.from), at(seg.to)];
      const n = segmentPoints(seg.length, o.band.density);
      L.push(`  ${String(n).padStart(4)} ${k(a[0])}${k(a[1])}${k(a[2])}  ${k(b[0])}${k(b[1])}${k(b[2])}   ${seg.from} ${seg.to}`);
    }
    L.push("Band.kpath>");
  }

  if (o.unfolding.enabled && o.unfolding.nk > 0 && o.band.path && bandSolver) {
    section("Band unfolding (§55)");
    kv("Unfolding.Electronic.Band", "on");
    kv("Unfolding.LowerBound", g(o.unfolding.lower));
    kv("Unfolding.UpperBound", g(o.unfolding.upper));
    // k-points along the high-symmetry path of the reference (input) cell.
    const labels: string[] = [];
    for (const s of o.band.path.segments) {
      if (labels[labels.length - 1] !== s.from) labels.push(s.from);
      labels.push(s.to);
    }
    kv("Unfolding.Nkpoint", labels.length);
    L.push("<Unfolding.kpoint");
    for (const l of labels) {
      const p = o.band.path.points[l];
      L.push(`  ${l} ${k(p[0])}${k(p[1])}${k(p[2])}`);
    }
    L.push("Unfolding.kpoint>");
    kv("Unfolding.desired_totalnkpt", o.unfolding.nk);
    if (o.repeat.some((n) => n !== 1)) {
      // The input cell is the reference; each supercell atom maps to the atom it was copied from.
      L.push("<Unfolding.ReferenceVectors");
      for (const v of base) L.push(`  ${f(v[0])}${f(v[1])}${f(v[2])}`);
      L.push("Unfolding.ReferenceVectors>");
      L.push("<Unfolding.Map");
      atoms.forEach((a, i) => L.push(`  ${i + 1} ${a.index + 1}`));
      L.push("Unfolding.Map>");
    }
  }

  if (dosNeeded(o)) {
    // COHP, partial charge and FermiSurfer files come out of the tetrahedron DOS step (Dos.fileout).
    const gauss = o.dos.enabled && o.dos.method === "gaussian" && !o.cohp.enabled && !o.partialCharge.enabled && !o.fermiSurface;
    section("Density of states (§23)");
    kv("Dos.fileout", onoff(!gauss));
    if (gauss) {
      kv("DosGauss.fileout", "on");
      kv("DosGauss.Num.Mesh", o.dos.mesh);
      kv("DosGauss.Width", g(o.dos.width));
    }
    kv("Dos.Erange", `${o.dos.emin.toFixed(1)} ${o.dos.emax.toFixed(1)}`);
    kv("Dos.Kgrid", o.dos.kgrid.join(" "));
    if (o.fermiSurface) kv("FermiSurfer.fileout", "on");
    if (o.partialCharge.enabled) {
      kv("partial.charge", "on");
      kv("partial.charge.energy.window", g(o.partialCharge.window));
    }
    if (o.cohp.enabled) {
      const pairs = parseCohpPairs(o.cohp.pairs, atoms.length);
      kv("COHP.calc.flag", "on");
      kv("COHP.num.pairs", pairs.length);
      L.push("<COHP.pairs", ...pairs.map((r, i) => `  ${i + 1} ${r.join(" ")}`), "COHP.pairs>");
    }
  }

  if (o.optical.enabled) {
    section("Optical conductivity and dielectric function (§62)");
    kv("CDDF.start", "on");
    kv("CDDF.FWHM", g(o.optical.fwhm));
    kv("CDDF.maximum_energy", g(o.optical.emax));
    kv("CDDF.additional_maximum_energy", g(o.optical.extra));
    kv("CDDF.frequency.grid.total_number", 10000);
    kv("CDDF.Kgrid", o.optical.kgrid.join(" "));
  }

  if (o.mo.enabled) {
    section("Molecular / Bloch orbitals as cube files (§34)");
    kv("MO.fileout", "on");
    kv("num.HOMOs", o.mo.homos);
    kv("num.LUMOs", o.mo.lumos);
    if (o.scf.solver !== "Cluster") {
      kv("MO.Nkpoint", 1);
      L.push("<MO.kpoint", "  0.0 0.0 0.0", "MO.kpoint>");
    }
  }

  if (o.cwf.enabled) {
    section("Closest Wannier functions (§47.1)");
    kv("CWF.Calc", "on");
    kv("CWF.Wannier90.fileout", onoff(o.cwf.wannier90));
    kv("CWF.Dis.vs.H", "on");
    kv("CWF.Guiding.Orbitals", "AO");
    L.push("<CWF.Guiding.AOs");
    for (const el of order) {
      const chosen = o.cwf.orbitals[el] ?? [];
      // Only the first radial function of each chosen l is a guiding function.
      const orbitals = paoOrbitals(o.species[el]?.pao ?? "");
      L.push(`  ${el} ${orbitals.map((orb) => `${orb} ${orb.startsWith("1") && chosen.includes(orb.slice(1)) ? 1 : 0}`).join(" ")}`);
    }
    L.push("CWF.Guiding.AOs>");
    kv("CWF.window.function", o.cwf.window);
    if (o.cwf.window === "Poly") kv("CWF.disentangling.Erange", o.cwf.erange.map(g).join(" "));
    else {
      kv("CWF.disentangling.Erange", o.cwf.erange.slice(0, 2).map(g).join(" "));
      kv("CWF.disentangling.smearing.kBT", o.cwf.kbt.map(g).join(" "));
    }
  }

  if (o.mlwf.enabled) {
    section("Maximally localized Wannier functions (§47.2)");
    kv("Wannier.Func.Calc", "on");
    kv("Wannier.Func.Num", mlwfCount(crystal, o));
    kv("Wannier.Outer.Window.Bottom", g(o.mlwf.outer[0]));
    kv("Wannier.Outer.Window.Top", g(o.mlwf.outer[1]));
    kv("Wannier.Inner.Window.Bottom", g(o.mlwf.inner[0]));
    kv("Wannier.Inner.Window.Top", g(o.mlwf.inner[1]));
    kv("Wannier.Initial.Guess", "on");
    kv("Wannier.Initial.Projectors.Unit", "FRAC");
    L.push("<Wannier.Initial.Projectors");
    atoms.forEach((a, i) => {
      const p = o.mlwf.projectors[a.element];
      if (p) L.push(`  ${`proj${a.element}-${p}`.padEnd(14)}${k(frac[i][0])}${k(frac[i][1])}${k(frac[i][2])}   0.0 0.0 1.0   1.0 0.0 0.0`);
    });
    L.push("Wannier.Initial.Projectors>");
    kv("Wannier.Kgrid", o.mlwf.kgrid.join(" "));
    kv("Wannier.MaxShells", 12);
    kv("Wannier.Minimizing.Scheme", 2);
    if (o.mlwf.wannier90) kv("Wannier90.fileout", "on");
  }

  const a = o.analysis;
  if (a.voronoi || a.energyDecomposition || a.nbo || a.hs || a.negfLead) {
    section("Analysis and files for post-processing");
    if (a.voronoi) kv("Voronoi.charge", "on");
    if (a.energyDecomposition) kv("Energy.Decomposition", "on");
    if (a.nbo) kv("NBO.switch", o.scf.solver === "Krylov" ? "on2" : "on1");
    // .scfout for jx (exchange coupling), polB (Berry phase), calB (Chern), Z2FH, kSpin.
    if (a.hs) kv("HS.fileout", "on");
    if (a.negfLead) {
      kv("NEGF.output_hks", "on");
      kv("NEGF.filename.hks", `${o.systemName}.hks`);
    }
  }

  writeMd(L, kv, section, o, atoms);
  L.push("");
  return L.join("\n");
}

function writeMd(
  L: string[],
  kv: (key: string, value: string | number) => void,
  section: (title: string) => void,
  o: OpenmxOptions,
  atoms: { element: string }[],
) {
  const fixedBlock = (text: string) => {
    const fixed = new Set(parseAtomList(text, atoms.length));
    if (!fixed.size) return;
    L.push("<MD.Fixed.XYZ");
    atoms.forEach((_, i) => {
      const v = fixed.has(i + 1) ? 1 : 0;
      L.push(`  ${i + 1} ${v} ${v} ${v}`);
    });
    L.push("MD.Fixed.XYZ>");
  };

  section("Ionic steps");
  if (o.task === "opt") {
    kv("MD.Type", o.opt.method);
    kv("MD.maxIter", o.opt.maxIter);
    kv("MD.Opt.criterion", o.opt.criterion.toExponential(1));
    if (o.opt.method === "DIIS" || o.opt.method === "BFGS" || o.opt.method === "RF" || o.opt.method === "EF") {
      kv("MD.Opt.DIIS.History", 3);
      kv("MD.Opt.StartDIIS", 5);
    }
    fixedBlock(o.opt.fixed);
  } else if (o.task === "cellopt") {
    kv("MD.Type", o.cell.method);
    kv("MD.maxIter", o.cell.maxIter);
    kv("MD.Opt.criterion", o.cell.criterion.toExponential(1));
    kv("MD.Opt.DIIS.History", 3);
    kv("MD.Opt.StartDIIS", 5);
    kv("MD.Opt.EveryDIIS", 200);
    kv("scf.stress.tensor", "on");
    if (o.cell.pressure !== 0) kv("MD.applied.pressure", g(o.cell.pressure));
    // §19.3: fixing Cartesian components only works with OptC1, OptC2, OptC5 and RFC5.
    if (["OptC1", "OptC2", "OptC5", "RFC5"].includes(o.cell.method) && o.cell.fixed.some(Boolean)) {
      L.push("<MD.Fixed.Cell.Vectors");
      for (let r = 0; r < 3; r++) L.push(`  ${o.cell.fixed.slice(r * 3, r * 3 + 3).map((b) => (b ? 1 : 0)).join(" ")}`);
      L.push("MD.Fixed.Cell.Vectors>");
    }
  } else if (o.task === "md") {
    const m = o.md;
    kv("MD.Type", m.ensemble);
    kv("MD.maxIter", m.steps);
    kv("MD.TimeStep", g(m.timestep));
    if (m.ensemble === "NVT_NH") {
      // §20.3: "MD step, temperature" rows, linearly interpolated.
      L.push("<MD.TempControl", "  2", `  1 ${g(m.temperature)}`, `  ${m.steps} ${g(m.temperature)}`, "MD.TempControl>");
      kv("NH.Mass.HeatBath", g(m.nhMass));
    } else if (m.ensemble !== "NVE") {
      // §20.2: "MD step, scaling interval, temperature, alpha" rows.
      L.push("<MD.TempControl", "  1", `  ${m.steps} ${m.interval} ${g(m.temperature)} ${g(m.alpha)}`, "MD.TempControl>");
    }
    if (m.ensemble === "NVT_VS4") {
      // §20.4: one heat bath per element.
      const groups = [...new Set(atoms.map((x) => x.element))];
      kv("MD.num.AtomGroup", groups.length);
      L.push("<MD.AtomGroup", ...atoms.map((x, i) => `  ${i + 1} ${groups.indexOf(x.element) + 1}`), "MD.AtomGroup>");
    }
    if (m.ensemble.startsWith("NPT")) {
      if (m.barostatMass !== null) kv("NPT.Mass.Barostat", g(m.barostatMass));
      L.push("<MD.CellPressureControl", "  1", `  ${m.steps} ${g(m.pressure)}`, "MD.CellPressureControl>");
      kv("NPT.LatticeRestriction", m.restriction);
      kv("MD.TempTolerance", g(m.tolerance));
    } else {
      fixedBlock(m.fixed);
    }
  } else if (o.task === "evslc") {
    kv("MD.Type", "EvsLC");
    kv("MD.EvsLC.Step", g(o.evslc.step));
    kv("MD.maxIter", o.evslc.steps);
    kv("MD.EvsLC.flag", o.evslc.flag.join(" "));
  } else {
    kv("MD.Type", "Nomd");
    kv("MD.maxIter", 1);
  }
}
