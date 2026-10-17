import { isElement, normalizeSymbol } from "../elements";
import { type Atom, type Crystal, type Mat3, type Vec3, fracToCart, scale, volume } from "../structure";

/** VASP POSCAR / CONTCAR (VASP 4 and 5 formats, selective dynamics, Direct or Cartesian). */
export function parsePoscar(text: string): Crystal[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let l = 0;
  const next = () => {
    if (l >= lines.length) throw new Error("Unexpected end of POSCAR");
    return lines[l++].trim();
  };
  const nums = (s: string) => s.split(/\s+/).map(Number);

  const title = next();
  const scaleLine = nums(next());
  let lattice = [nums(next()), nums(next()), nums(next())].map((r) => r.slice(0, 3)) as Mat3;
  if (lattice.flat().some(Number.isNaN)) throw new Error("Invalid lattice vectors in POSCAR");

  // Cartesian coordinates are scaled by the same universal factor as the lattice.
  let cartScale = 1;
  if (scaleLine.length === 3) {
    lattice = lattice.map((r, i) => scale(r, scaleLine[i])) as Mat3;
  } else {
    // A negative scale is the target cell volume.
    cartScale = scaleLine[0] < 0 ? Math.cbrt(-scaleLine[0] / volume(lattice)) : scaleLine[0];
    lattice = lattice.map((r) => scale(r, cartScale)) as Mat3;
  }

  let line = next();
  let species: string[];
  if (/^[A-Za-z]/.test(line)) {
    // VASP 5: element symbols (possibly "Fe_pv" or "O/hash") before the counts.
    species = line.split(/\s+/).map((s) => normalizeSymbol(s.split(/[_/]/)[0]));
    line = next();
  } else {
    // VASP 4: try the title line for symbols.
    const guess = title.split(/\s+/).map(normalizeSymbol);
    species = guess.every(isElement) ? guess : [];
  }
  const counts = nums(line);
  if (counts.some(Number.isNaN)) throw new Error("Invalid atom counts in POSCAR");
  if (species.length !== counts.length) species = counts.map((_, i) => species[i] ?? `X${i + 1}`);

  let mode = next();
  if (/^s/i.test(mode)) mode = next(); // Selective dynamics
  const cartesian = /^[ck]/i.test(mode);

  const atoms: Atom[] = [];
  counts.forEach((n, s) => {
    for (let k = 0; k < n; k++) {
      const parts = next().split(/\s+/);
      const v = parts.slice(0, 3).map(Number) as Vec3;
      if (v.some(Number.isNaN)) throw new Error(`Invalid coordinates on line ${l}`);
      const cart = cartesian ? scale(v, cartScale) : fracToCart(v, lattice);
      atoms.push({ element: species[s], cart });
    }
  });
  return [{ title: title || "POSCAR", lattice, atoms }];
}
