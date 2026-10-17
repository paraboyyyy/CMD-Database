import { type Crystal, fromPymatgen } from "../structure";
import { parseCif } from "./cif";
import { parsePoscar } from "./poscar";
import { parseXyz } from "./xyz";

export const ACCEPTED_FILES = ".cif,.xyz,.extxyz,.vasp,.poscar,.json,POSCAR,CONTCAR";

/** Pick a parser from the file name, then return one Crystal per frame/data block. */
export function parseStructureFile(text: string, filename: string): Crystal[] {
  const name = filename.toLowerCase().split("/").pop() ?? "";
  let frames: Crystal[];
  if (name.endsWith(".cif") || name.endsWith(".mcif")) frames = parseCif(text);
  else if (name.endsWith(".xyz") || name.endsWith(".extxyz")) frames = parseXyz(text);
  else if (name.endsWith(".json")) frames = [fromPymatgen(JSON.parse(text), filename)];
  else if (name.endsWith(".vasp") || name.endsWith(".poscar") || /^(poscar|contcar)/.test(name))
    frames = parsePoscar(text);
  else throw new Error(`Unsupported file type: ${filename}`);
  if (frames.every((f) => f.atoms.length === 0)) throw new Error(`No atoms found in ${filename}`);
  return frames;
}

export { parseCif, parsePoscar, parseXyz };
