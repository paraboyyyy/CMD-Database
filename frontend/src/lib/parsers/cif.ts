import { normalizeSymbol } from "../elements";
import { type Atom, type Crystal, type Vec3, fracToCart, latticeFromParams, norm, sub, wrap01 } from "../structure";

/** Split a CIF line into tokens, honouring 'single' and "double" quoted values. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /'((?:[^']|'(?=\S))*)'(?=\s|$)|"((?:[^"]|"(?=\S))*)"(?=\s|$)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[3]?.startsWith("#")) break;
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

/** "5.431(2)" -> 5.431 */
export function cifNumber(value: string | undefined): number {
  if (value === undefined) return NaN;
  return parseFloat(value.replace(/\(\d+\)$/, ""));
}

interface CifBlock {
  name: string;
  items: Map<string, string>;
  loops: Map<string, string[]>[];
}

/** Read every data_ block: single key/value items and loop_ tables. */
export function readCifBlocks(text: string): CifBlock[] {
  const blocks: CifBlock[] = [];
  let block: CifBlock | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  // Flatten to a token stream; ';' text fields become one token.
  const tokens: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(";")) {
      const parts = [line.slice(1)];
      while (++i < lines.length && !lines[i].startsWith(";")) parts.push(lines[i]);
      tokens.push(parts.join("\n").trim());
      continue;
    }
    tokens.push(...tokenize(line));
  }

  let t = 0;
  while (t < tokens.length) {
    const tok = tokens[t];
    const lower = tok.toLowerCase();
    if (lower.startsWith("data_")) {
      block = { name: tok.slice(5), items: new Map(), loops: [] };
      blocks.push(block);
      t++;
    } else if (!block) {
      t++;
    } else if (lower === "loop_") {
      const names: string[] = [];
      t++;
      while (t < tokens.length && tokens[t].startsWith("_")) names.push(tokens[t++].toLowerCase());
      const loop = new Map<string, string[]>(names.map((n) => [n, []]));
      let col = 0;
      while (t < tokens.length) {
        const v = tokens[t];
        const vl = v.toLowerCase();
        if (col === 0 && (v.startsWith("_") || vl === "loop_" || vl.startsWith("data_"))) break;
        loop.get(names[col])!.push(v);
        col = (col + 1) % names.length;
        t++;
      }
      block.loops.push(loop);
    } else if (tok.startsWith("_")) {
      block.items.set(lower, tokens[t + 1] ?? "");
      t += 2;
    } else {
      t++;
    }
  }
  return blocks;
}

/** Parse a symmetry operation like "-x+1/2, y, z+1/4" into a function on fractional coords. */
export function parseSymop(op: string): (f: Vec3) => Vec3 {
  const rows = op
    .toLowerCase()
    .replace(/\s+/g, "")
    .split(",")
    .map((expr) => {
      const coef = [0, 0, 0];
      let shift = 0;
      const terms = expr.match(/[+-]?[^+-]+/g) ?? [];
      for (const term of terms) {
        const sign = term.startsWith("-") ? -1 : 1;
        const body = term.replace(/^[+-]/, "");
        const axis = body.match(/[xyz]/)?.[0];
        if (axis) {
          const factorText = body.replace(/\*?[xyz]\*?/, "");
          const factor = factorText ? evalFraction(factorText) : 1;
          coef["xyz".indexOf(axis)] += sign * factor;
        } else {
          shift += sign * evalFraction(body);
        }
      }
      return { coef, shift };
    });
  if (rows.length !== 3) throw new Error(`Bad symmetry operation: ${op}`);
  return (f) => rows.map((r) => r.coef[0] * f[0] + r.coef[1] * f[1] + r.coef[2] * f[2] + r.shift) as Vec3;
}

function evalFraction(s: string): number {
  const [n, d] = s.split("/");
  return d === undefined ? parseFloat(n) : parseFloat(n) / parseFloat(d);
}

const SYMOP_KEYS = [
  "_space_group_symop_operation_xyz",
  "_symmetry_equiv_pos_as_xyz",
  "_space_group_symop.operation_xyz",
];

export function parseCif(text: string): Crystal[] {
  const blocks = readCifBlocks(text).filter((b) => b.loops.some((l) => l.has("_atom_site_fract_x")));
  if (!blocks.length) throw new Error("No atom sites found in CIF file");
  return blocks.map(blockToCrystal);
}

function blockToCrystal(block: CifBlock): Crystal {
  const get = (k: string) => cifNumber(block.items.get(k));
  const params = {
    a: get("_cell_length_a"),
    b: get("_cell_length_b"),
    c: get("_cell_length_c"),
    alpha: get("_cell_angle_alpha"),
    beta: get("_cell_angle_beta"),
    gamma: get("_cell_angle_gamma"),
  };
  if (Object.values(params).some(Number.isNaN)) throw new Error("CIF is missing cell parameters");
  const lattice = latticeFromParams(params);

  const sites = block.loops.find((l) => l.has("_atom_site_fract_x"))!;
  const symLoop = block.loops.find((l) => SYMOP_KEYS.some((k) => l.has(k)));
  const symKey = SYMOP_KEYS.find((k) => symLoop?.has(k));
  const ops = (symKey ? symLoop!.get(symKey)! : ["x,y,z"]).map(parseSymop);

  const labels = sites.get("_atom_site_label") ?? [];
  const types = sites.get("_atom_site_type_symbol");
  const xs = sites.get("_atom_site_fract_x")!;
  const ys = sites.get("_atom_site_fract_y")!;
  const zs = sites.get("_atom_site_fract_z")!;
  const occ = sites.get("_atom_site_occupancy");

  const atoms: Atom[] = [];
  const placed: Vec3[] = [];
  for (let s = 0; s < xs.length; s++) {
    const element = normalizeSymbol(types?.[s] ?? labels[s]);
    const f0: Vec3 = [cifNumber(xs[s]), cifNumber(ys[s]), cifNumber(zs[s])];
    for (const op of ops) {
      const f = op(f0).map((x) => wrap01(x)) as Vec3;
      // Skip symmetry copies landing on an already placed site (periodic distance < 0.01 Å).
      const duplicate = placed.some((p) => {
        const d = sub(p, f).map((x) => x - Math.round(x)) as Vec3;
        return norm(fracToCart(d, lattice)) < 0.01;
      });
      if (duplicate) continue;
      placed.push(f);
      atoms.push({
        element,
        cart: fracToCart(f, lattice),
        label: labels[s],
        occupancy: occ ? cifNumber(occ[s]) : undefined,
      });
    }
  }
  return { title: block.name, lattice, atoms };
}
