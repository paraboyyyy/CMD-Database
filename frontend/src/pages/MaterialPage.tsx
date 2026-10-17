import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type MaterialDetail, downloadUrl, getMaterial } from "../api";
import { fromPymatgen } from "../lib/structure";
import StructureViewer from "../viewer/StructureViewer";
import { Formula, SpaceGroup } from "../components/Formula";
import OpenmxExportDialog from "../components/OpenmxExportDialog";

const SOURCES: Record<string, { label: string; url?: (id: string) => string; license?: string }> = {
  materials_project: {
    label: "Materials Project",
    url: (id) => `https://next-gen.materialsproject.org/materials/${id}`,
    license: "CC BY 4.0",
  },
  cod: { label: "Crystallography Open Database", url: (id) => `https://www.crystallography.net/cod/${id.replace(/\D/g, "")}.html` },
  sample: { label: "Demo sample" },
};

const num = (v: number | null | undefined, digits = 3, unit = "") =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)}${unit}`;

export default function MaterialPage() {
  const { id = "" } = useParams();
  const [material, setMaterial] = useState<MaterialDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setMaterial(null);
    setError(null);
    getMaterial(id).then(setMaterial, (e: Error) => setError(e.message));
  }, [id]);

  const frames = useMemo(
    () => (material ? [fromPymatgen(material.structure, material.formula_pretty)] : []),
    [material],
  );

  if (error)
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/">Back to search</Link>
      </div>
    );
  if (!material) return <div className="page muted">Loading…</div>;

  const m = material;
  const source = SOURCES[m.source] ?? { label: m.source };
  const extra = Object.entries(m.extra).filter(([k]) => k !== "license" && k !== "note");

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/">Search</Link> / <span className="mono">{m.id}</span>
      </nav>
      <header className="material-head">
        <h1>
          <Formula value={m.formula_pretty} />
        </h1>
        <span className="mono muted">{m.id}</span>
        <span className="badge">{m.crystal_system}</span>
        <span className="badge">
          <SpaceGroup symbol={m.spacegroup_symbol} /> ({m.spacegroup_number})
        </span>
      </header>

      <StructureViewer key={m.id} frames={frames} name={`${m.id}_${m.formula_pretty}`} compact />

      <div className="grid">
        <section className="card">
          <h2>Structure</h2>
          <dl className="props">
            <dt>Formula</dt><dd><Formula value={m.formula_pretty} /> <span className="muted">({m.formula_anonymous})</span></dd>
            <dt>Space group</dt><dd><SpaceGroup symbol={m.spacegroup_symbol} /> (No. {m.spacegroup_number})</dd>
            <dt>Point group</dt><dd>{m.point_group}</dd>
            <dt>Crystal system</dt><dd>{m.crystal_system}</dd>
            <dt>Sites in cell</dt><dd>{m.nsites}</dd>
            <dt>Volume</dt><dd>{num(m.volume, 3, " Å³")}</dd>
            <dt>Density</dt><dd>{num(m.density, 3, " g/cm³")}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>Lattice</h2>
          <dl className="props">
            <dt>a, b, c</dt>
            <dd className="mono">
              {num(m.lattice.a, 4)}, {num(m.lattice.b, 4)}, {num(m.lattice.c, 4)} Å
            </dd>
            <dt>α, β, γ</dt>
            <dd className="mono">
              {num(m.lattice.alpha, 2)}°, {num(m.lattice.beta, 2)}°, {num(m.lattice.gamma, 2)}°
            </dd>
          </dl>
          <table className="matrix mono">
            <tbody>
              {m.lattice.matrix.map((row, i) => (
                <tr key={i}>
                  <th>{"abc"[i]}</th>
                  {row.map((v, j) => (
                    <td key={j}>{v.toFixed(4)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>Properties</h2>
          <dl className="props">
            <dt>Band gap</dt><dd>{num(m.band_gap, 3, " eV")}</dd>
            <dt>Formation energy</dt><dd>{num(m.formation_energy_per_atom, 3, " eV/atom")}</dd>
            <dt>Energy above hull</dt><dd>{num(m.energy_above_hull, 3, " eV/atom")}</dd>
            {extra.map(([k, v]) => (
              <FragmentRow key={k} label={k.replace(/_/g, " ")} value={String(v)} />
            ))}
          </dl>
          {m.band_gap === null && m.source === "sample" && (
            <p className="muted small">Demo entries have no computed properties. Import data to fill these in.</p>
          )}
        </section>

        <section className="card">
          <h2>Download</h2>
          <div className="row wrap">
            {(["cif", "poscar", "xyz", "json"] as const).map((fmt) => (
              <a key={fmt} className="button" href={downloadUrl(m.id, fmt)}>
                {fmt.toUpperCase()}
              </a>
            ))}
          </div>
          <h2>Calculation input</h2>
          <div className="row wrap">
            <button type="button" className="primary" onClick={() => setExporting(true)}>
              OpenMX (.dat)…
            </button>
          </div>
          {exporting && (
            <OpenmxExportDialog
              crystal={frames[0]}
              name={`${m.formula_pretty}_${m.id}`}
              onClose={() => setExporting(false)}
            />
          )}
          <h2>Source</h2>
          <p>
            {source.url && m.source_id ? (
              <a href={source.url(m.source_id)} target="_blank" rel="noreferrer">
                {source.label} · {m.source_id}
              </a>
            ) : (
              <>
                {source.label}
                {m.source_id && <span className="muted"> · {m.source_id}</span>}
              </>
            )}
          </p>
          {source.license && <p className="muted small">License: {source.license}</p>}
          {typeof m.extra.note === "string" && <p className="muted small">{m.extra.note}</p>}
        </section>
      </div>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
