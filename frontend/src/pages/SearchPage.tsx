import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type MaterialPage, searchMaterials } from "../api";
import { Formula, SpaceGroup } from "../components/Formula";
import PeriodicTable from "../components/PeriodicTable";

const CRYSTAL_SYSTEMS = ["cubic", "hexagonal", "trigonal", "tetragonal", "orthorhombic", "monoclinic", "triclinic"];
const PAGE_SIZE = 25;
const EXAMPLES = ["Fe2O3", "Li-Co-O", "Si", "cmd-1"];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [result, setResult] = useState<MaterialPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const elements = (params.get("elements") ?? "").split(",").filter(Boolean);
  const excluded = (params.get("exclude") ?? "").split(",").filter(Boolean);
  const mode = params.get("mode") === "only" ? "only" : "contains";
  const page = Math.max(Number(params.get("page") ?? 1), 1);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next);
  };

  useEffect(() => {
    const els = (params.get("elements") ?? "").split(",").filter(Boolean);
    const only = params.get("mode") === "only";
    setLoading(true);
    setError(null);
    searchMaterials({
      q: params.get("q") ?? undefined,
      elements: !only && els.length ? els.join(",") : undefined,
      chemsys: only && els.length ? els.join("-") : undefined,
      exclude_elements: params.get("exclude") ?? undefined,
      crystal_system: params.get("crystal_system") ?? undefined,
      sort: params.get("sort") ?? "id",
      order: params.get("order") ?? "asc",
      limit: PAGE_SIZE,
      offset: (Math.max(Number(params.get("page") ?? 1), 1) - 1) * PAGE_SIZE,
    })
      .then(setResult)
      .catch((e: Error) => {
        setResult(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [params]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update({ q: query.trim() });
  };

  const setElements = (include: string[], exclude: string[]) =>
    update({ elements: include.join(","), exclude: exclude.join(",") });

  const sortBy = (key: string) => {
    const same = (params.get("sort") ?? "id") === key;
    update({ sort: key, order: same && params.get("order") !== "desc" ? "desc" : "asc" });
  };

  const sortMark = (key: string) =>
    (params.get("sort") ?? "id") === key ? (params.get("order") === "desc" ? " ↓" : " ↑") : "";

  const pages = result ? Math.max(Math.ceil(result.total / PAGE_SIZE), 1) : 1;

  return (
    <div className="page">
      <section className="hero">
        <h1>Search materials</h1>
        <p className="muted">
          Search by formula, chemical system or ID, or pick elements on the periodic table.
        </p>
        <form className="searchbar" onSubmit={submit} role="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fe2O3, Li-Co-O, cmd-12 …"
            aria-label="Search"
          />
          <button type="submit" className="primary">
            Search
          </button>
        </form>
        <div className="examples">
          Try:{" "}
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="link"
              onClick={() => {
                setQuery(ex);
                update({ q: ex });
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="filters">
          <div className="segmented" role="radiogroup" aria-label="Element match">
            <button type="button" aria-pressed={mode === "contains"} onClick={() => update({ mode: null })}>
              Contains elements
            </button>
            <button type="button" aria-pressed={mode === "only"} onClick={() => update({ mode: "only" })}>
              Only these elements
            </button>
          </div>
          <select
            value={params.get("crystal_system") ?? ""}
            onChange={(e) => update({ crystal_system: e.target.value })}
            aria-label="Crystal system"
          >
            <option value="">Any crystal system</option>
            {CRYSTAL_SYSTEMS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {(elements.length > 0 || params.toString()) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setParams(new URLSearchParams());
              }}
            >
              Clear all
            </button>
          )}
        </div>
        {(elements.length > 0 || excluded.length > 0) && (
          <div className="selection-chips" aria-label="Selected elements">
            {elements.map((el) => (
              <button
                key={el}
                type="button"
                className="chip is-include"
                onClick={() => setElements(elements.filter((x) => x !== el), excluded)}
              >
                {el} <span aria-hidden="true">×</span>
                <span className="sr-only">remove</span>
              </button>
            ))}
            {excluded.map((el) => (
              <button
                key={el}
                type="button"
                className="chip is-exclude"
                onClick={() => setElements(elements, excluded.filter((x) => x !== el))}
              >
                no {el} <span aria-hidden="true">×</span>
                <span className="sr-only">remove</span>
              </button>
            ))}
          </div>
        )}
        <PeriodicTable included={elements} excluded={excluded} onChange={setElements} />
      </section>

      <section className="card">
        <div className="results-head">
          <h2>
            {result ? `${result.total} material${result.total === 1 ? "" : "s"}` : "Results"}
          </h2>
          {loading && <span className="muted small">Loading…</span>}
        </div>
        {error && <p className="error">{error}</p>}
        {result && result.items.length === 0 && (
          <div className="empty-state">
            <p className="muted">No materials match these filters.</p>
            <p>
              Can’t find it? <Link to="/builder">Build the structure yourself</Link> from a template, a similar material
              or your own coordinates.
            </p>
          </div>
        )}
        {result && result.items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th><button type="button" onClick={() => sortBy("id")}>ID{sortMark("id")}</button></th>
                  <th><button type="button" onClick={() => sortBy("formula")}>Formula{sortMark("formula")}</button></th>
                  <th><button type="button" onClick={() => sortBy("spacegroup")}>Space group{sortMark("spacegroup")}</button></th>
                  <th>Crystal system</th>
                  <th className="num"><button type="button" onClick={() => sortBy("nsites")}>Sites{sortMark("nsites")}</button></th>
                  <th className="num"><button type="button" onClick={() => sortBy("density")}>Density (g/cm³){sortMark("density")}</button></th>
                  <th className="num"><button type="button" onClick={() => sortBy("band_gap")}>Band gap (eV){sortMark("band_gap")}</button></th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((m) => (
                  <tr key={m.id}>
                    <td><Link to={`/materials/${m.id}`} className="mono">{m.id}</Link></td>
                    <td><Link to={`/materials/${m.id}`}><Formula value={m.formula_pretty} /></Link></td>
                    <td><SpaceGroup symbol={m.spacegroup_symbol} /> <span className="muted">({m.spacegroup_number})</span></td>
                    <td>{m.crystal_system}</td>
                    <td className="num">{m.nsites}</td>
                    <td className="num">{m.density.toFixed(3)}</td>
                    <td className="num">{m.band_gap?.toFixed(2) ?? "—"}</td>
                    <td><span className="badge">{m.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && pages > 1 && (
          <div className="pager">
            <button type="button" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button type="button" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
