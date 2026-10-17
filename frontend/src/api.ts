import { type Crystal, cartToFrac } from "./lib/structure";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export interface MaterialSummary {
  id: string;
  formula_pretty: string;
  chemsys: string;
  elements: string[];
  nsites: number;
  spacegroup_symbol: string;
  spacegroup_number: number;
  crystal_system: string;
  density: number;
  volume: number;
  band_gap: number | null;
  energy_above_hull: number | null;
  source: string;
}

export interface MaterialDetail extends MaterialSummary {
  formula_reduced: string;
  formula_anonymous: string;
  nelements: number;
  point_group: string;
  lattice: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number; matrix: number[][] };
  structure: any;
  formation_energy_per_atom: number | null;
  extra: Record<string, unknown>;
  source_id: string | null;
  created_at: string;
}

export interface MaterialPage {
  total: number;
  limit: number;
  offset: number;
  items: MaterialSummary[];
}

export interface SymmetryResult {
  spacegroup_symbol: string;
  spacegroup_number: number;
  crystal_system: string;
  point_group: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError("Cannot reach the CMD Database API. Is the backend running?", 0);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export function searchMaterials(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return request<MaterialPage>(`/api/materials?${qs}`);
}

export const getMaterial = (id: string) => request<MaterialDetail>(`/api/materials/${encodeURIComponent(id)}`);

export const downloadUrl = (id: string, fmt: "cif" | "poscar" | "xyz" | "json") =>
  `${BASE}/api/materials/${encodeURIComponent(id)}/download?fmt=${fmt}`;

/** Space group of a periodic structure parsed in the browser (spglib on the server). */
export function findSymmetry(crystal: Crystal) {
  const lattice = crystal.lattice!;
  const body = {
    lattice,
    frac: crystal.atoms.map((a) => cartToFrac(a.cart, lattice)),
    species: crystal.atoms.map((a) => a.element),
  };
  return request<SymmetryResult>("/api/symmetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const API_DOCS_URL = `${BASE}/docs`;
