import { type Crystal, type LatticeParams, type Vec3, cartToFrac, fracToCart, latticeFromParams, latticeParams, wrap01 } from "./structure";

/** sessionStorage key used to hand a structure from the viewer to the builder. */
export const IMPORT_KEY = "cmd-builder-import";

export interface BuilderSite {
  element: string;
  frac: Vec3;
}

/** Everything the builder edits. `hall` 1 is P1: sites are then the full list of atoms. */
export interface BuilderState {
  name: string;
  spacegroup: number;
  hall: number;
  params: LatticeParams;
  sites: BuilderSite[];
}

export interface SpacegroupSetting {
  hall: number;
  choice: string;
  symbol: string;
}

export interface SpacegroupInfo {
  number: number;
  symbol: string;
  crystal_system: string;
  settings: SpacegroupSetting[];
}

export interface BuildResult {
  spacegroup: { number: number; symbol: string; choice: string };
  lattice: Crystal["lattice"];
  atoms: { element: string; frac: Vec3; site: number; rotation?: number[] }[];
  multiplicities: number[];
  detected: { spacegroup_symbol: string; spacegroup_number: number; crystal_system: string; point_group: string } | null;
  warnings: string[];
}

export type ParamKey = keyof LatticeParams;

/**
 * Lattice parameters fixed by the crystal system: returns the constrained parameters and
 * which ones the user may edit. `choice` is the spglib setting (e.g. "R" for rhombohedral
 * axes, "b1"/"c1" for the unique axis of monoclinic groups).
 */
export function constrainLattice(p: LatticeParams, system: string, choice: string): { params: LatticeParams; editable: ParamKey[] } {
  const right = { alpha: 90, beta: 90, gamma: 90 };
  switch (system) {
    case "cubic":
      return { params: { ...p, ...right, b: p.a, c: p.a }, editable: ["a"] };
    case "tetragonal":
      return { params: { ...p, ...right, b: p.a }, editable: ["a", "c"] };
    case "orthorhombic":
      return { params: { ...p, ...right }, editable: ["a", "b", "c"] };
    case "trigonal":
    case "hexagonal":
      if (choice === "R") return { params: { ...p, b: p.a, c: p.a, beta: p.alpha, gamma: p.alpha }, editable: ["a", "alpha"] };
      return { params: { ...p, b: p.a, alpha: 90, beta: 90, gamma: 120 }, editable: ["a", "c"] };
    case "monoclinic": {
      const axis = (choice.match(/[abc]/)?.[0] ?? "b") as "a" | "b" | "c";
      const free = ({ a: "alpha", b: "beta", c: "gamma" } as const)[axis];
      return { params: { ...p, ...right, [free]: p[free] }, editable: ["a", "b", "c", free] };
    }
    default:
      return { params: p, editable: ["a", "b", "c", "alpha", "beta", "gamma"] };
  }
}

export function resultToCrystal(r: BuildResult, name: string): Crystal {
  const lattice = r.lattice!;
  return { title: name, lattice, atoms: r.atoms.map((a) => ({ element: a.element, cart: fracToCart(a.frac, lattice) })) };
}

/** Local P1 expansion (used when the API is unreachable). */
export function p1Crystal(s: BuilderState): Crystal {
  const lattice = latticeFromParams(s.params);
  return { title: s.name, lattice, atoms: s.sites.map((x) => ({ element: x.element, cart: fracToCart(x.frac, lattice) })) };
}

/** Builder state for an existing structure, as a P1 cell (every atom is its own site). */
export function stateFromCrystal(c: Crystal, name: string): BuilderState {
  const params = latticeParams(c.lattice!);
  // Re-express atoms in the standard orientation (a along x) that the builder uses.
  return {
    name,
    spacegroup: 1,
    hall: 1,
    params: roundParams(params),
    sites: c.atoms.map((a) => ({ element: a.element, frac: cartToFrac(a.cart, c.lattice!).map((x) => round(wrap01(x, 1e-8), 8)) as Vec3 })),
  };
}

/** Expand the current build into P1 so single atoms can be removed or substituted. */
export function stateToP1(s: BuilderState, r: BuildResult): BuilderState {
  return { ...s, spacegroup: 1, hall: 1, sites: r.atoms.map((a) => ({ element: a.element, frac: a.frac })) };
}

/** na × nb × nc supercell of a P1 state. */
export function supercell(s: BuilderState, n: Vec3): BuilderState {
  const sites: BuilderSite[] = [];
  for (const site of s.sites)
    for (let i = 0; i < n[0]; i++)
      for (let j = 0; j < n[1]; j++)
        for (let k = 0; k < n[2]; k++)
          sites.push({
            element: site.element,
            frac: [(site.frac[0] + i) / n[0], (site.frac[1] + j) / n[1], (site.frac[2] + k) / n[2]].map((x) => round(x, 8)) as Vec3,
          });
  const p = s.params;
  return { ...s, params: { ...p, a: round(p.a * n[0], 6), b: round(p.b * n[1], 6), c: round(p.c * n[2], 6) }, sites };
}

/** Index of the builder site that produced atom `atom` of the built cell. */
export function siteOfAtom(result: BuildResult | null, atom: number): number {
  return result ? result.atoms[atom]?.site ?? -1 : atom;
}

const wrapSnap = (f: Vec3, snap: number): Vec3 =>
  f.map((x) => {
    const v = snap > 0 ? Math.round(x * snap) / snap : x;
    return round(wrap01(v, 1e-9), 8);
  }) as Vec3;

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d].map(
    (x) => x / det,
  );
}

/**
 * Move atom `atom` of the built cell by `delta` (fractional). The move is applied to the site it
 * came from: an image made by rotation R moves its site by R⁻¹·delta, so every
 * symmetry-equivalent atom follows. `snap` > 0 rounds the new site position to multiples of 1/snap.
 */
export function moveAtom(s: BuilderState, result: BuildResult | null, atom: number, delta: Vec3, snap = 0): BuilderState {
  const site = siteOfAtom(result, atom);
  if (site < 0 || !s.sites[site]) return s;
  const rotation = result?.atoms[atom]?.rotation ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv = invert3(rotation);
  const d = [0, 1, 2].map((r) => inv[3 * r] * delta[0] + inv[3 * r + 1] * delta[1] + inv[3 * r + 2] * delta[2]);
  const frac = wrapSnap(s.sites[site].frac.map((x, k) => x + d[k]) as Vec3, snap);
  return { ...s, sites: s.sites.map((x, j) => (j === site ? { ...x, frac } : x)) };
}

/** Add a new site at a fractional position (wrapped into the cell). */
export function addSite(s: BuilderState, element: string, frac: Vec3, snap = 0): BuilderState {
  return { ...s, sites: [...s.sites, { element, frac: wrapSnap(frac, snap) }] };
}

/** Change the element of the site behind atom `atom` (all its symmetry images change too). */
export function setAtomElement(s: BuilderState, result: BuildResult | null, atom: number, element: string): BuilderState {
  const site = siteOfAtom(result, atom);
  if (site < 0) return s;
  return { ...s, sites: s.sites.map((x, j) => (j === site ? { ...x, element } : x)) };
}

/** Remove the sites behind the given atoms (in P1 each atom is its own site). */
export function removeAtoms(s: BuilderState, result: BuildResult | null, atoms: number[]): BuilderState {
  const sites = new Set(atoms.map((a) => siteOfAtom(result, a)));
  return { ...s, sites: s.sites.filter((_, j) => !sites.has(j)) };
}

export const removeAtom = (s: BuilderState, result: BuildResult | null, atom: number) => removeAtoms(s, result, [atom]);

export function substitute(s: BuilderState, from: string, to: string): BuilderState {
  return { ...s, sites: s.sites.map((x) => (x.element === from ? { ...x, element: to } : x)) };
}

const round = (x: number, d: number) => Number(x.toFixed(d));
const roundParams = (p: LatticeParams): LatticeParams =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round(v, 6)])) as unknown as LatticeParams;

const cubic = (a: number): LatticeParams => ({ a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 });
const hex = (a: number, c: number): LatticeParams => ({ a, b: a, c, alpha: 90, beta: 90, gamma: 120 });
const tet = (a: number, c: number): LatticeParams => ({ a, b: a, c, alpha: 90, beta: 90, gamma: 90 });

/** Common prototypes. `hall` is the default setting of the space group (spglib numbering). */
export const TEMPLATES: { id: string; label: string; state: Omit<BuilderState, "name"> }[] = [
  { id: "blank", label: "Empty cubic cell (P1)", state: { spacegroup: 1, hall: 1, params: cubic(5), sites: [{ element: "Si", frac: [0, 0, 0] }] } },
  { id: "fcc", label: "FCC metal (Cu)", state: { spacegroup: 225, hall: 523, params: cubic(3.615), sites: [{ element: "Cu", frac: [0, 0, 0] }] } },
  { id: "bcc", label: "BCC metal (Fe)", state: { spacegroup: 229, hall: 529, params: cubic(2.8665), sites: [{ element: "Fe", frac: [0, 0, 0] }] } },
  { id: "hcp", label: "HCP metal (Mg)", state: { spacegroup: 194, hall: 488, params: hex(3.209, 5.211), sites: [{ element: "Mg", frac: [1 / 3, 2 / 3, 0.25] }] } },
  { id: "diamond", label: "Diamond (Si)", state: { spacegroup: 227, hall: 525, params: cubic(5.431), sites: [{ element: "Si", frac: [0, 0, 0] }] } },
  {
    id: "rocksalt",
    label: "Rock salt AB (NaCl)",
    state: { spacegroup: 225, hall: 523, params: cubic(5.64), sites: [{ element: "Na", frac: [0, 0, 0] }, { element: "Cl", frac: [0.5, 0.5, 0.5] }] },
  },
  {
    id: "cscl",
    label: "CsCl AB",
    state: { spacegroup: 221, hall: 517, params: cubic(4.123), sites: [{ element: "Cs", frac: [0, 0, 0] }, { element: "Cl", frac: [0.5, 0.5, 0.5] }] },
  },
  {
    id: "zincblende",
    label: "Zinc blende AB (GaAs)",
    state: { spacegroup: 216, hall: 512, params: cubic(5.653), sites: [{ element: "Ga", frac: [0, 0, 0] }, { element: "As", frac: [0.25, 0.25, 0.25] }] },
  },
  {
    id: "wurtzite",
    label: "Wurtzite AB (ZnO)",
    state: { spacegroup: 186, hall: 480, params: hex(3.25, 5.207), sites: [{ element: "Zn", frac: [1 / 3, 2 / 3, 0] }, { element: "O", frac: [1 / 3, 2 / 3, 0.382] }] },
  },
  {
    id: "fluorite",
    label: "Fluorite AB2 (CaF2)",
    state: { spacegroup: 225, hall: 523, params: cubic(5.463), sites: [{ element: "Ca", frac: [0, 0, 0] }, { element: "F", frac: [0.25, 0.25, 0.25] }] },
  },
  {
    id: "perovskite",
    label: "Cubic perovskite ABX3 (SrTiO3)",
    state: {
      spacegroup: 221,
      hall: 517,
      params: cubic(3.905),
      sites: [{ element: "Sr", frac: [0, 0, 0] }, { element: "Ti", frac: [0.5, 0.5, 0.5] }, { element: "O", frac: [0.5, 0.5, 0] }],
    },
  },
  {
    id: "rutile",
    label: "Rutile AB2 (TiO2)",
    state: { spacegroup: 136, hall: 419, params: tet(4.594, 2.959), sites: [{ element: "Ti", frac: [0, 0, 0] }, { element: "O", frac: [0.3048, 0.3048, 0] }] },
  },
  {
    id: "graphite",
    label: "Graphite (C)",
    state: { spacegroup: 194, hall: 488, params: hex(2.464, 6.711), sites: [{ element: "C", frac: [0, 0, 0.25] }, { element: "C", frac: [1 / 3, 2 / 3, 0.25] }] },
  },
  {
    id: "mos2",
    label: "2H-MoS2 (layered)",
    state: { spacegroup: 194, hall: 488, params: hex(3.16, 12.294), sites: [{ element: "Mo", frac: [1 / 3, 2 / 3, 0.25] }, { element: "S", frac: [1 / 3, 2 / 3, 0.621] }] },
  },
];
