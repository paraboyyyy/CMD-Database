import { type Vec3, cross, dot, norm, sub } from "../lib/structure";

const DEG = 180 / Math.PI;

export const distance = (a: Vec3, b: Vec3) => norm(sub(a, b));

/** Angle a-b-c at b, in degrees. */
export function angle(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(a, b);
  const v = sub(c, b);
  return Math.acos(Math.min(1, Math.max(-1, dot(u, v) / (norm(u) * norm(v))))) * DEG;
}

/** Dihedral a-b-c-d in degrees, range (-180, 180]. */
export function dihedral(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = sub(b, a);
  const b2 = sub(c, b);
  const b3 = sub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m1 = cross(n1, b2.map((x) => x / norm(b2)) as Vec3);
  return Math.atan2(dot(m1, n2), dot(n1, n2)) * DEG;
}
