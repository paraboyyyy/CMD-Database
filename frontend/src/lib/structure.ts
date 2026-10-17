export type Vec3 = [number, number, number];
/** Rows are the lattice vectors a, b, c in Cartesian Å. */
export type Mat3 = [Vec3, Vec3, Vec3];

export interface Atom {
  element: string;
  /** Cartesian position in Å. */
  cart: Vec3;
  label?: string;
  occupancy?: number;
}

/** One frame of a structure. `lattice` is null for molecules (plain .xyz). */
export interface Crystal {
  title: string;
  lattice: Mat3 | null;
  atoms: Atom[];
}

export interface LatticeParams {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

const DEG = Math.PI / 180;

export const add = (u: Vec3, v: Vec3): Vec3 => [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
export const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
export const scale = (u: Vec3, s: number): Vec3 => [u[0] * s, u[1] * s, u[2] * s];
export const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
export const norm = (u: Vec3) => Math.sqrt(dot(u, u));
export const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];

/** Standard setting: a along x, b in the xy plane. */
export function latticeFromParams({ a, b, c, alpha, beta, gamma }: LatticeParams): Mat3 {
  const [ca, cb, cg, sg] = [Math.cos(alpha * DEG), Math.cos(beta * DEG), Math.cos(gamma * DEG), Math.sin(gamma * DEG)];
  const cx = c * cb;
  const cy = (c * (ca - cb * cg)) / sg;
  const cz = Math.sqrt(Math.max(c * c - cx * cx - cy * cy, 0));
  return [
    [a, 0, 0],
    [b * cg, b * sg, 0],
    [cx, cy, cz],
  ];
}

export function latticeParams(m: Mat3): LatticeParams {
  const [a, b, c] = m.map(norm);
  const angle = (u: Vec3, v: Vec3) => Math.acos(dot(u, v) / (norm(u) * norm(v))) / DEG;
  return { a, b, c, alpha: angle(m[1], m[2]), beta: angle(m[0], m[2]), gamma: angle(m[0], m[1]) };
}

export function volume(m: Mat3): number {
  return Math.abs(dot(m[0], cross(m[1], m[2])));
}

export function fracToCart(f: Vec3, m: Mat3): Vec3 {
  return [
    f[0] * m[0][0] + f[1] * m[1][0] + f[2] * m[2][0],
    f[0] * m[0][1] + f[1] * m[1][1] + f[2] * m[2][1],
    f[0] * m[0][2] + f[1] * m[1][2] + f[2] * m[2][2],
  ];
}

export function inverse(m: Mat3): Mat3 {
  const [a, b, c] = m;
  const det = dot(a, cross(b, c));
  const r0 = scale(cross(b, c), 1 / det);
  const r1 = scale(cross(c, a), 1 / det);
  const r2 = scale(cross(a, b), 1 / det);
  // Columns of the inverse are r0, r1, r2; return rows.
  return [
    [r0[0], r1[0], r2[0]],
    [r0[1], r1[1], r2[1]],
    [r0[2], r1[2], r2[2]],
  ];
}

export function cartToFrac(p: Vec3, m: Mat3): Vec3 {
  const inv = inverse(m);
  return [
    p[0] * inv[0][0] + p[1] * inv[1][0] + p[2] * inv[2][0],
    p[0] * inv[0][1] + p[1] * inv[1][1] + p[2] * inv[2][1],
    p[0] * inv[0][2] + p[1] * inv[1][2] + p[2] * inv[2][2],
  ];
}

/** Wrap a fractional coordinate into [0, 1), snapping values within `tol` of 1 to 0. */
export function wrap01(x: number, tol = 1e-4): number {
  let w = x - Math.floor(x);
  if (w > 1 - tol) w = 0;
  return w;
}

/** Reduced formula like "Fe2O3" (elements in order of first appearance, counts divided by GCD). */
export function formula(atoms: Atom[]): string {
  const counts = new Map<string, number>();
  for (const a of atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  const g = [...counts.values()].reduce(gcd, 0) || 1;
  return [...counts].map(([el, n]) => el + (n / g === 1 ? "" : n / g)).join("");
}

/** Convert a pymatgen Structure.as_dict() / Molecule.as_dict() into a Crystal. */
export function fromPymatgen(d: any, title = ""): Crystal {
  const lattice: Mat3 | null = d.lattice?.matrix ?? null;
  const atoms: Atom[] = d.sites.map((s: any) => {
    const top = [...s.species].sort((x: any, y: any) => y.occu - x.occu)[0];
    return { element: top.element, cart: s.xyz as Vec3, label: s.label, occupancy: top.occu };
  });
  return { title, lattice, atoms };
}

export interface DisplayAtom extends Atom {
  /** Index of the source atom in the unit cell. */
  index: number;
  /** True for periodic images added on the far cell faces. */
  image: boolean;
}

/**
 * Expand a crystal into an na×nb×nc supercell. With `boundary`, atoms sitting on a
 * cell face/edge/corner (fractional coordinate ≈ 0) are repeated on the opposite face,
 * the way VESTA draws a complete cell.
 */
export function buildSupercell(
  crystal: Crystal,
  repeat: Vec3 = [1, 1, 1],
  boundary = true,
  tol = 1e-3,
): DisplayAtom[] {
  if (!crystal.lattice) return crystal.atoms.map((a, index) => ({ ...a, index, image: false }));
  const m = crystal.lattice;
  const out: DisplayAtom[] = [];
  crystal.atoms.forEach((atom, index) => {
    const f = cartToFrac(atom.cart, m).map((x) => wrap01(x, tol)) as Vec3;
    for (let i = 0; i < repeat[0]; i++)
      for (let j = 0; j < repeat[1]; j++)
        for (let k = 0; k < repeat[2]; k++) {
          const base: Vec3 = [f[0] + i, f[1] + j, f[2] + k];
          out.push({ ...atom, cart: fracToCart(base, m), index, image: false });
        }
    if (!boundary) return;
    // Faces at 0 get an extra image at repeat[d]; combine shifts for edges and corners.
    const onFace = f.map((x) => x < tol);
    for (let mask = 1; mask < 8; mask++) {
      const dims = [0, 1, 2].filter((d) => mask & (1 << d));
      if (!dims.every((d) => onFace[d])) continue;
      const ranges = [0, 1, 2].map((d) =>
        dims.includes(d) ? [repeat[d]] : Array.from({ length: repeat[d] }, (_, n) => n),
      );
      for (const i of ranges[0])
        for (const j of ranges[1])
          for (const k of ranges[2]) {
            const p: Vec3 = [f[0] + i, f[1] + j, f[2] + k];
            out.push({ ...atom, cart: fracToCart(p, m), index, image: true });
          }
    }
  });
  return out;
}

export interface Bond {
  i: number;
  j: number;
  length: number;
}

/**
 * Bonds between displayed atoms whose distance is below (r_i + r_j) * tolerance.
 * Uses a uniform grid so it stays fast for supercells with tens of thousands of atoms.
 */
export function findBonds(
  atoms: Atom[],
  radius: (element: string) => number,
  tolerance = 1.15,
  minDistance = 0.4,
): Bond[] {
  if (atoms.length < 2) return [];
  const radii = atoms.map((a) => radius(a.element));
  const cell = Math.max(...radii) * 2 * tolerance;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  const coords = atoms.map((a) => a.cart.map((c) => Math.floor(c / cell)) as Vec3);
  coords.forEach((c, i) => {
    const k = key(...c);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });
  const bonds: Bond[] = [];
  atoms.forEach((a, i) => {
    const [cx, cy, cz] = coords[i];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const d = norm(sub(a.cart, atoms[j].cart));
            if (d > minDistance && d < (radii[i] + radii[j]) * tolerance) bonds.push({ i, j, length: d });
          }
        }
  });
  return bonds;
}

export function center(atoms: Atom[], lattice: Mat3 | null, repeat: Vec3 = [1, 1, 1]): Vec3 {
  if (lattice) {
    return fracToCart([repeat[0] / 2, repeat[1] / 2, repeat[2] / 2], lattice);
  }
  if (!atoms.length) return [0, 0, 0];
  const s = atoms.reduce((acc, a) => add(acc, a.cart), [0, 0, 0] as Vec3);
  return scale(s, 1 / atoms.length);
}
