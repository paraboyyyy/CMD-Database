import type { BuildResult, SpacegroupInfo } from "./lib/builder";
import type { KPath } from "./lib/openmx";
import { type Crystal, type LatticeParams, type Vec3, cartToFrac } from "./lib/structure";

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
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Cannot reach the CMD Labs API. Is the backend running?", 0);
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

/** High-symmetry band path for a cell (seekpath), in its own reciprocal-lattice coordinates. */
export function getKpath(crystal: Crystal) {
  const lattice = crystal.lattice!;
  return request<KPath>("/api/kpath", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lattice,
      frac: crystal.atoms.map((a) => cartToFrac(a.cart, lattice)),
      species: crystal.atoms.map((a) => a.element),
    }),
  });
}

export interface ElementCounts {
  total: number;
  counts: Record<string, number>;
}

const elementCountsCache = new Map<string, Promise<ElementCounts>>();

/** Materials per element, among those containing all of `withElements` (comma separated). */
export function getElementCounts(withElements: string) {
  let pending = elementCountsCache.get(withElements);
  if (!pending) {
    const qs = withElements ? `?with=${encodeURIComponent(withElements)}` : "";
    pending = request<ElementCounts>(`/api/elements${qs}`);
    pending.catch(() => elementCountsCache.delete(withElements));
    elementCountsCache.set(withElements, pending);
  }
  return pending;
}

const spacegroupsPromise: { current: Promise<SpacegroupInfo[]> | null } = { current: null };

/** All 230 space groups with their settings (fetched once). */
export function getSpacegroups() {
  if (!spacegroupsPromise.current) {
    spacegroupsPromise.current = request<SpacegroupInfo[]>("/api/spacegroups");
    spacegroupsPromise.current.catch(() => (spacegroupsPromise.current = null));
  }
  return spacegroupsPromise.current;
}

/** Expand symmetry-inequivalent sites into a full cell (spglib on the server). */
export function buildStructure(body: { hall: number; lattice: LatticeParams; sites: { element: string; frac: Vec3 }[] }, signal?: AbortSignal) {
  return request<BuildResult>("/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export const API_DOCS_URL = `${BASE}/docs`;
