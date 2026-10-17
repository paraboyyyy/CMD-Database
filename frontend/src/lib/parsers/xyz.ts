import { normalizeSymbol } from "../elements";
import type { Atom, Crystal, Mat3, Vec3 } from "../structure";

/**
 * XYZ and extended XYZ. Multiple concatenated frames (MD trajectories, relaxations)
 * become multiple Crystals. An extended-XYZ `Lattice="..."` comment makes a frame periodic.
 */
export function parseXyz(text: string): Crystal[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const frames: Crystal[] = [];
  let l = 0;
  while (l < lines.length) {
    const countLine = lines[l].trim();
    if (!countLine) {
      l++;
      continue;
    }
    const n = parseInt(countLine, 10);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Expected atom count on line ${l + 1}`);
    const comment = lines[l + 1] ?? "";
    const atoms: Atom[] = [];
    for (let k = 0; k < n; k++) {
      const parts = (lines[l + 2 + k] ?? "").trim().split(/\s+/);
      const cart = parts.slice(1, 4).map(Number) as Vec3;
      if (parts.length < 4 || cart.some(Number.isNaN)) {
        throw new Error(`Invalid atom line ${l + 3 + k}`);
      }
      atoms.push({ element: normalizeSymbol(parts[0]), cart });
    }
    frames.push({ title: comment.trim() || `frame ${frames.length + 1}`, lattice: extendedLattice(comment), atoms });
    l += n + 2;
  }
  if (!frames.length) throw new Error("Empty XYZ file");
  return frames;
}

function extendedLattice(comment: string): Mat3 | null {
  const m = comment.match(/Lattice\s*=\s*"([^"]+)"/i);
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map(Number);
  if (v.length !== 9 || v.some(Number.isNaN)) return null;
  return [
    [v[0], v[1], v[2]],
    [v[3], v[4], v[5]],
    [v[6], v[7], v[8]],
  ];
}
