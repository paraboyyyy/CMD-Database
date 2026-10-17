import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, buildStructure, getMaterial, getSpacegroups } from "../api";
import { Formula, SpaceGroup } from "../components/Formula";
import OpenmxExportDialog from "../components/OpenmxExportDialog";
import {
  type BuildResult,
  type BuilderSite,
  type BuilderState,
  IMPORT_KEY,
  type ParamKey,
  type SpacegroupInfo,
  TEMPLATES,
  constrainLattice,
  p1Crystal,
  resultToCrystal,
  stateFromCrystal,
  stateToP1,
  substitute,
  supercell,
} from "../lib/builder";
import { isElement, normalizeSymbol } from "../lib/elements";
import { ACCEPTED_FILES, parseStructureFile } from "../lib/parsers";
import { type Vec3, formula, fromPymatgen } from "../lib/structure";
import { downloadText, toCif, toPoscar, toXyz } from "../lib/writers";
import StructureViewer from "../viewer/StructureViewer";

const DRAFT_KEY = "cmd-builder-draft";
const SAVED_KEY = "cmd-builder-saved";

interface SavedStructure {
  id: string;
  savedAt: string;
  state: BuilderState;
}

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full */
  }
}

const fromTemplate = (id: string): BuilderState => {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  return { name: t.label.replace(/\s*\(.*\)/, "").replace(/\s+/g, "_"), ...structuredClone(t.state) };
};

const PARAMS: { key: ParamKey; label: string; unit: string }[] = [
  { key: "a", label: "a", unit: "Å" },
  { key: "b", label: "b", unit: "Å" },
  { key: "c", label: "c", unit: "Å" },
  { key: "alpha", label: "α", unit: "°" },
  { key: "beta", label: "β", unit: "°" },
  { key: "gamma", label: "γ", unit: "°" },
];

export default function BuilderPage() {
  const [search, setSearch] = useSearchParams();
  const [groups, setGroups] = useState<SpacegroupInfo[] | null>(null);
  const [state, setState] = useState<BuilderState>(() => readJson(localStorage, DRAFT_KEY, null) ?? fromTemplate("rocksalt"));
  const [session, setSession] = useState(0); // bump to re-frame the 3D view after loading something new
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState<SavedStructure[]>(() => readJson(localStorage, SAVED_KEY, []));
  const [subFrom, setSubFrom] = useState("");
  const [subTo, setSubTo] = useState("");
  const [cells, setCells] = useState<Vec3>([2, 2, 2]);
  const [loadId, setLoadId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (next: BuilderState, message?: string) => {
    setState(next);
    setSession((s) => s + 1);
    setNotice(message ?? null);
  };

  useEffect(() => {
    getSpacegroups().then(setGroups, () => setGroups(null));
  }, []);

  // Structures handed over from a material page (?from=cmd-12) or the viewer (sessionStorage).
  useEffect(() => {
    const from = search.get("from");
    if (from) {
      getMaterial(from).then(
        (m) => load(stateFromCrystal(fromPymatgen(m.structure), `${m.formula_pretty}_${m.id}`), `Loaded ${m.id} (${m.formula_pretty}) as a P1 cell.`),
        (e: Error) => setError(e.message),
      );
      setSearch({}, { replace: true });
      return;
    }
    const handed = readJson<BuilderState | null>(sessionStorage, IMPORT_KEY, null);
    if (handed) {
      sessionStorage.removeItem(IMPORT_KEY);
      load(handed, `Loaded ${handed.name} from the viewer.`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setTimeout(() => writeJson(localStorage, DRAFT_KEY, state), 400);
    return () => window.clearTimeout(id);
  }, [state]);

  const invalid = state.sites.filter((s) => !isElement(s.element) || s.frac.some((x) => !Number.isFinite(x)));

  // Rebuild the cell (debounced) whenever the inputs change.
  useEffect(() => {
    if (!state.sites.length || invalid.length) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      buildStructure({ hall: state.hall, lattice: state.params, sites: state.sites }, ctrl.signal).then(
        (r) => {
          setResult(r);
          setError(null);
        },
        (e: Error) => {
          if (e.name === "AbortError") return;
          setResult(null);
          setError(e instanceof ApiError && e.status === 0 && state.hall !== 1 ? `${e.message} Space-group expansion needs the API.` : e.message);
        },
      );
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [state.hall, state.params, state.sites]); // eslint-disable-line react-hooks/exhaustive-deps

  const crystal = useMemo(() => {
    if (result) return resultToCrystal(result, state.name);
    // Without the API a P1 cell can still be shown and exported.
    if (state.hall === 1 && !invalid.length && state.sites.length) return p1Crystal(state);
    return null;
  }, [result, state, invalid.length]);
  const frames = useMemo(() => (crystal ? [crystal] : []), [crystal]);

  const group = groups?.find((g) => g.number === state.spacegroup);
  const setting = group?.settings.find((s) => s.hall === state.hall);
  const constraint = constrainLattice(state.params, group?.crystal_system ?? "triclinic", setting?.choice ?? "");

  const update = (patch: Partial<BuilderState>) => setState((s) => ({ ...s, ...patch }));
  const setParam = (key: ParamKey, value: number) => {
    const next = { ...state.params, [key]: value };
    update({ params: constrainLattice(next, group?.crystal_system ?? "triclinic", setting?.choice ?? "").params });
  };
  const setSpacegroup = (number: number, hall?: number) => {
    const g = groups?.find((x) => x.number === number);
    if (!g) return;
    const s = g.settings.find((x) => x.hall === hall) ?? g.settings[0];
    update({ spacegroup: number, hall: s.hall, params: constrainLattice(state.params, g.crystal_system, s.choice).params });
  };
  const setSite = (i: number, patch: Partial<BuilderSite>) =>
    update({ sites: state.sites.map((s, j) => (i === j ? { ...s, ...patch } : s)) });
  const setCoord = (i: number, axis: number, value: number) => {
    const frac = [...state.sites[i].frac] as Vec3;
    frac[axis] = value;
    setSite(i, { frac });
  };

  const toP1 = () => {
    if (result && state.hall !== 1) load(stateToP1(state, result), `Expanded to ${result.atoms.length} atoms in P1. Delete rows to make vacancies or change single atoms to dope.`);
  };
  const makeSupercell = () => {
    const base = state.hall !== 1 && result ? stateToP1(state, result) : state;
    const next = supercell(base, cells);
    if (next.sites.length > 2000) {
      setNotice(`That supercell would have ${next.sites.length} atoms; the limit is 2000.`);
      return;
    }
    load({ ...next, name: `${state.name}_${cells.join("x")}` }, `Built a ${cells.join("×")} supercell with ${next.sites.length} atoms (P1).`);
  };
  const applySubstitution = () => {
    const to = normalizeSymbol(subTo);
    if (!subFrom || !isElement(to)) return;
    update(substitute(state, subFrom, to));
    setSubTo("");
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const [c] = parseStructureFile(await file.text(), file.name);
      if (!c.lattice) throw new Error("The builder needs a periodic structure (with a unit cell).");
      load(stateFromCrystal(c, file.name.replace(/\.[^.]+$/, "")), `Loaded ${file.name} as a P1 cell.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const loadFromDatabase = () => {
    const id = loadId.trim();
    if (!id) return;
    getMaterial(id).then(
      (m) => load(stateFromCrystal(fromPymatgen(m.structure), `${m.formula_pretty}_${m.id}`), `Loaded ${m.id} (${m.formula_pretty}) as a P1 cell.`),
      (e: Error) => setError(e.message),
    );
  };

  const save = () => {
    const entry: SavedStructure = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), state };
    const next = [entry, ...saved.filter((s) => s.state.name !== state.name)].slice(0, 50);
    setSaved(next);
    writeJson(localStorage, SAVED_KEY, next);
    setNotice(`Saved "${state.name}" in this browser.`);
  };
  const remove = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    writeJson(localStorage, SAVED_KEY, next);
  };

  const fileBase = state.name.replace(/[^\w.-]+/g, "_") || "structure";
  const presentElements = [...new Set(state.sites.map((s) => s.element).filter(isElement))];
  const detectedDiffers = result?.detected && result.detected.spacegroup_number !== result.spacegroup.number;

  return (
    <div className="page builder">
      <header className="viewer-head">
        <div>
          <h1>Structure builder</h1>
          <p className="muted">
            Make your own crystal: pick a space group and lattice, place the symmetry-inequivalent atoms, and the full
            cell is generated. Start from a template, a database entry or a file.
          </p>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="builder__grid">
        <div className="builder__form">
          <section className="card">
            <h2>Start from</h2>
            <div className="builder__start">
              <select
                aria-label="Template"
                value=""
                onChange={(e) => e.target.value && load(fromTemplate(e.target.value), `Template: ${TEMPLATES.find((t) => t.id === e.target.value)?.label}.`)}
              >
                <option value="">Template…</option>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  loadFromDatabase();
                }}
              >
                <input placeholder="Database ID, e.g. cmd-12" value={loadId} onChange={(e) => setLoadId(e.target.value)} aria-label="Material ID" />
                <button type="submit">Load</button>
              </form>
              <button type="button" onClick={() => fileRef.current?.click()}>
                Open file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_FILES}
                hidden
                onChange={(e) => {
                  void openFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </section>

          <section className="card">
            <h2>Cell</h2>
            <label className="field">
              <span>Name</span>
              <input value={state.name} onChange={(e) => update({ name: e.target.value })} />
            </label>
            <div className="builder__sg">
              <label className="field">
                <span>Space group</span>
                <select value={state.spacegroup} onChange={(e) => setSpacegroup(Number(e.target.value))} disabled={!groups}>
                  {groups ? (
                    groups.map((g) => (
                      <option key={g.number} value={g.number}>
                        {g.number} · {g.symbol} ({g.crystal_system})
                      </option>
                    ))
                  ) : (
                    <option value={state.spacegroup}>{state.spacegroup}</option>
                  )}
                </select>
              </label>
              {group && group.settings.length > 1 && (
                <label className="field">
                  <span>Setting</span>
                  <select value={state.hall} onChange={(e) => setSpacegroup(state.spacegroup, Number(e.target.value))}>
                    {group.settings.map((s) => (
                      <option key={s.hall} value={s.hall}>
                        {s.symbol}
                        {s.choice ? ` (${settingLabel(s.choice)})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="builder__lattice">
              {PARAMS.map(({ key, label, unit }) => {
                const editable = constraint.editable.includes(key);
                return (
                  <label key={key} className="field">
                    <span>
                      {label} ({unit})
                    </span>
                    <input
                      type="number"
                      step={unit === "Å" ? 0.01 : 0.1}
                      value={Number(state.params[key].toFixed(6))}
                      disabled={!editable}
                      title={editable ? undefined : `Fixed by the ${group?.crystal_system ?? ""} crystal system`}
                      onChange={(e) => setParam(key, Number(e.target.value))}
                    />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="row between">
              <h2>{state.hall === 1 ? `Atoms (${state.sites.length})` : `Inequivalent sites (${state.sites.length})`}</h2>
              <button type="button" onClick={() => update({ sites: [...state.sites, { element: presentElements[0] ?? "H", frac: [0, 0, 0] }] })}>
                + Add atom
              </button>
            </div>
            <div className="sites-wrap">
              <table className="sites">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>El.</th>
                    <th>x</th>
                    <th>y</th>
                    <th>z</th>
                    {state.hall !== 1 && <th title="Atoms generated by symmetry">Mult.</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.sites.map((s, i) => (
                    <tr key={i} className={isElement(s.element) ? "" : "is-invalid"}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        <input
                          aria-label={`Site ${i + 1} element`}
                          className="el-input"
                          value={s.element}
                          onChange={(e) => setSite(i, { element: e.target.value.trim() ? normalizeSymbol(e.target.value) : "" })}
                        />
                      </td>
                      {[0, 1, 2].map((axis) => (
                        <td key={axis}>
                          <input
                            aria-label={`Site ${i + 1} ${"xyz"[axis]}`}
                            type="number"
                            step={0.01}
                            value={Number(s.frac[axis].toFixed(6))}
                            onChange={(e) => setCoord(i, axis, Number(e.target.value))}
                          />
                        </td>
                      ))}
                      {state.hall !== 1 && <td className="num muted">{result?.multiplicities[i] ?? ""}</td>}
                      <td>
                        <button type="button" className="icon-button small" aria-label={`Remove site ${i + 1}`} onClick={() => update({ sites: state.sites.filter((_, j) => j !== i) })}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Fractional coordinates. Values like 0.3333 snap onto special positions.</p>
          </section>

          <section className="card">
            <h2>Modify</h2>
            <div className="tool">
              <span>Substitute</span>
              <select value={subFrom} onChange={(e) => setSubFrom(e.target.value)} aria-label="Element to replace">
                <option value="">element…</option>
                {presentElements.map((el) => (
                  <option key={el}>{el}</option>
                ))}
              </select>
              <span>→</span>
              <input className="el-input" placeholder="new" value={subTo} onChange={(e) => setSubTo(e.target.value)} aria-label="Replacement element" />
              <button type="button" onClick={applySubstitution} disabled={!subFrom || !isElement(normalizeSymbol(subTo))}>
                Apply
              </button>
            </div>
            <div className="tool">
              <span>Supercell</span>
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  type="number"
                  min={1}
                  max={8}
                  aria-label={`Supercell ${"abc"[i]}`}
                  value={cells[i]}
                  onChange={(e) => {
                    const next = [...cells] as Vec3;
                    next[i] = Math.min(Math.max(Math.round(Number(e.target.value)) || 1, 1), 8);
                    setCells(next);
                  }}
                />
              ))}
              <button type="button" onClick={makeSupercell} disabled={!crystal}>
                Build
              </button>
            </div>
            {state.hall !== 1 && (
              <div className="tool">
                <span>Vacancies / doping</span>
                <button type="button" onClick={toP1} disabled={!result}>
                  Expand to P1
                </button>
                <span className="muted small">then edit or delete single atoms</span>
              </div>
            )}
          </section>
        </div>

        <div className="builder__preview">
          {frames.length ? (
            <StructureViewer key={session} frames={frames} name={fileBase} compact preserveView />
          ) : (
            <div className="dropzone">
              <span className="muted">{invalid.length ? `Fix the element symbol in row ${state.sites.indexOf(invalid[0]) + 1}.` : "Add atoms to see the structure."}</span>
            </div>
          )}

          <section className="card builder__summary">
            <div className="builder__facts">
              <div>
                <span className="muted small">Formula</span>
                <b>{crystal ? <Formula value={formula(crystal.atoms)} /> : "—"}</b>
              </div>
              <div>
                <span className="muted small">Atoms</span>
                <b>{crystal?.atoms.length ?? "—"}</b>
              </div>
              <div>
                <span className="muted small">Built in</span>
                <b>{group ? <SpaceGroup symbol={group.symbol} /> : state.spacegroup}</b>
              </div>
              <div>
                <span className="muted small">Detected symmetry</span>
                <b>
                  {result?.detected ? (
                    <>
                      <SpaceGroup symbol={result.detected.spacegroup_symbol} /> ({result.detected.spacegroup_number})
                    </>
                  ) : (
                    "—"
                  )}
                </b>
              </div>
            </div>
            {detectedDiffers && (
              <p className="muted small">
                The atoms have higher symmetry than the chosen space group. That is fine; it often happens when sites sit on
                special positions.
              </p>
            )}
            {result?.warnings.map((w) => (
              <p key={w} className="warn small">
                Atoms overlap: {w}
              </p>
            ))}

            <div className="row wrap">
              <button type="button" onClick={() => crystal && downloadText(toCif(crystal, fileBase), `${fileBase}.cif`)} disabled={!crystal}>
                CIF
              </button>
              <button type="button" onClick={() => crystal && downloadText(toPoscar(crystal, fileBase), `${fileBase}.vasp`)} disabled={!crystal}>
                POSCAR
              </button>
              <button type="button" onClick={() => crystal && downloadText(toXyz(crystal, fileBase), `${fileBase}.xyz`)} disabled={!crystal}>
                XYZ
              </button>
              <button type="button" className="primary" onClick={() => setExporting(true)} disabled={!crystal}>
                OpenMX (.dat)…
              </button>
              <button type="button" onClick={save}>
                Save to My structures
              </button>
            </div>
          </section>

          <section className="card">
            <h2>My structures</h2>
            {saved.length === 0 ? (
              <p className="muted small">Saved structures stay in this browser. Nothing is uploaded.</p>
            ) : (
              <ul className="saved">
                {saved.map((s) => (
                  <li key={s.id}>
                    <div>
                      <b>{s.state.name}</b>
                      <span className="muted small">
                        {s.state.sites.length} sites · SG {s.state.spacegroup} · {new Date(s.savedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="row">
                      <button type="button" onClick={() => load(structuredClone(s.state), `Loaded "${s.state.name}".`)}>
                        Open
                      </button>
                      <button type="button" className="icon-button small" aria-label={`Delete ${s.state.name}`} onClick={() => remove(s.id)}>
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">
              Want it in the public database? That needs accounts and review (planned). For now, export a CIF and
              keep it with your project, or <Link to="/viewer">open it in the viewer</Link>.
            </p>
          </section>
        </div>
      </div>

      {exporting && crystal && <OpenmxExportDialog crystal={crystal} name={fileBase} onClose={() => setExporting(false)} />}
    </div>
  );
}

function settingLabel(choice: string): string {
  if (choice === "1" || choice === "2") return `origin choice ${choice}`;
  if (choice === "H") return "hexagonal axes";
  if (choice === "R") return "rhombohedral axes";
  const m = choice.match(/^-?([abc])([123])$/); // monoclinic: unique axis and cell choice
  return m ? `unique axis ${m[1]}, cell ${m[2]}` : `axes ${choice}`;
}
