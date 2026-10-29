import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type CellMethod,
  type MdEnsemble,
  type MixingType,
  type OpenmxOptions,
  type OpenmxSpecies,
  type OptMethod,
  type Projector,
  type Solver,
  type Task,
  PROJECTOR_COUNT,
  autoKgrid,
  defaultHubbardOrbital,
  defaultOptions,
  dosNeeded,
  missingSpecies,
  mlwfCount,
  openmxWarnings,
  paoOrbitals,
  paoShells,
  segmentPoints,
  speciesOrder,
  spinKeyword,
  writeOpenmxDat,
} from "../lib/openmx";
import {
  type BasisQuality,
  OPENMX_PAO_TABLE,
  QUALITY_LABELS,
  presetSpecies,
} from "../lib/openmxPresets";
import { getKpath } from "../api";
import type { Crystal, Vec3 } from "../lib/structure";

const SPECIES_KEY = "cmd-openmx-species";
const PREFS_KEY = "cmd-openmx-prefs";

interface Prefs {
  quality: BasisQuality;
  vps: Record<string, string>; // chosen VPS for elements with several (Fe_PBE19H / Fe_PBE19S ...)
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { quality: p.quality ?? "standard", vps: p.vps ?? {} };
  } catch {
    return { quality: "standard", vps: {} };
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

/** Table preset for elements in the OpenMX manual; the user's saved entry otherwise. */
function initialSpecies(el: string, prefs: Prefs, saved: Record<string, OpenmxSpecies>): OpenmxSpecies {
  return presetSpecies(el, prefs.quality, prefs.vps[el]) ?? saved[el] ?? { pao: "", vps: "", valence: null };
}

function loadSpecies(): Record<string, OpenmxSpecies> {
  try {
    return JSON.parse(localStorage.getItem(SPECIES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSpecies(species: Record<string, OpenmxSpecies>) {
  try {
    localStorage.setItem(SPECIES_KEY, JSON.stringify({ ...loadSpecies(), ...species }));
  } catch {
    /* storage unavailable: settings last for this page only */
  }
}

// ---------- calculation types and recipes

const TASKS: { id: Task; label: string; hint: string }[] = [
  { id: "scf", label: "Single point (SCF)", hint: "Total energy, charges, forces and any outputs chosen below. MD.Type Nomd." },
  { id: "opt", label: "Relax atoms", hint: "Geometry optimisation of atomic positions in a fixed cell (§18)." },
  { id: "cellopt", label: "Relax atoms + cell", hint: "Variable-cell optimisation, optionally under pressure (§19). Collinear only." },
  { id: "md", label: "Molecular dynamics", hint: "NVE, NVT (velocity scaling, Nosé-Hoover, multi-bath) or NPT (§20)." },
  { id: "evslc", label: "E vs lattice constant", hint: "Total energy while uniformly scaling the cell (MD.Type EvsLC, §64)." },
];

const TM_MOMENTS: Record<string, number> = { V: 2, Cr: 3, Mn: 4, Fe: 3, Co: 2, Ni: 1, Cu: 0.5, Ru: 1, Gd: 7, Eu: 7, Nd: 3, Sm: 5 };

interface Recipe {
  id: string;
  label: string;
  hint: string;
  apply: (o: OpenmxOptions, ctx: { elements: string[]; reset: OpenmxOptions }) => OpenmxOptions;
}

/** Calculation settings back to defaults; structure, basis and k-grid stay as the user set them. */
function resetCalc(o: OpenmxOptions, d: OpenmxOptions): OpenmxOptions {
  return {
    ...d,
    systemName: o.systemName,
    coordinates: o.coordinates,
    repeat: o.repeat,
    species: o.species,
    masses: o.masses,
    dataPath: o.dataPath,
    moments: o.moments,
    angles: o.angles,
    xc: o.xc,
    scf: { ...d.scf, kgrid: o.scf.kgrid, energyCutoff: o.scf.energyCutoff },
    dos: { ...d.dos, kgrid: o.dos.kgrid },
    band: { ...d.band, path: o.band.path },
  };
}

const withMoments = (o: OpenmxOptions, elements: string[]) => ({
  ...o,
  moments: Object.fromEntries(elements.map((el) => [el, o.moments[el] || TM_MOMENTS[el] || 0])),
});

const RECIPES: Recipe[] = [
  { id: "scf", label: "Ground state", hint: "Plain SCF", apply: (o, c) => resetCalc(o, c.reset) },
  { id: "relax", label: "Relax", hint: "Atomic positions (RF)", apply: (o, c) => ({ ...resetCalc(o, c.reset), task: "opt" }) },
  { id: "vc", label: "Relax + cell", hint: "RFC5 variable cell", apply: (o, c) => ({ ...resetCalc(o, c.reset), task: "cellopt" }) },
  {
    id: "band-dos",
    label: "Band + DOS",
    hint: "Band dispersion along the seekpath path and DOS/PDOS",
    apply: (o, c) => {
      const r = resetCalc(o, c.reset);
      return { ...r, band: { ...r.band, enabled: true }, dos: { ...r.dos, enabled: true } };
    },
  },
  {
    id: "pp",
    label: "Band/DOS from restart",
    hint: "scf.restart pp: re-use a converged SCF and only compute bands and DOS",
    apply: (o, c) => {
      const r = resetCalc(o, c.reset);
      return { ...r, scf: { ...r.scf, restart: "pp" }, band: { ...r.band, enabled: true }, dos: { ...r.dos, enabled: true } };
    },
  },
  {
    id: "mag",
    label: "Magnetic (collinear)",
    hint: "Spin-polarized with initial moments on transition metals",
    apply: (o, c) => ({ ...withMoments(resetCalc(o, c.reset), c.elements), spin: "on" }),
  },
  {
    id: "soc",
    label: "SOC bands",
    hint: "Noncollinear + spin–orbit coupling, band structure and DOS",
    apply: (o, c) => {
      const r = withMoments(resetCalc(o, c.reset), c.elements);
      return { ...r, spin: "nc", soc: true, band: { ...r.band, enabled: true }, dos: { ...r.dos, enabled: true } };
    },
  },
  {
    id: "mae",
    label: "MAE (step 2)",
    hint: "Second variational: read the collinear restart (c2n), one diagonalization with SOC; compare Uele (§42)",
    apply: (o, c) => {
      const r = withMoments(resetCalc(o, c.reset), c.elements);
      return {
        ...r,
        spin: "nc",
        soc: true,
        scf: { ...r.scf, restart: "c2n", restartFile: o.systemName, maxIter: 1, kgrid: o.scf.kgrid.map((k) => k * 2) as Vec3 },
      };
    },
  },
  {
    id: "dftu",
    label: "DFT+U",
    hint: "Spin-polarized with U = 4 eV on d/f shells",
    apply: (o, c) => {
      const r = withMoments(resetCalc(o, c.reset), c.elements);
      const values = Object.fromEntries(
        c.elements.map((el) => {
          const orbital = defaultHubbardOrbital(el, o.species[el]?.pao ?? "");
          return [el, { orbital, U: orbital ? 4 : 0, J: 0 }];
        }),
      );
      return { ...r, spin: "on", dftU: { ...r.dftU, enabled: true, values } };
    },
  },
  {
    id: "vdw",
    label: "Relax + vdW",
    hint: "DFT-D3(BJ) dispersion for layered or molecular systems",
    apply: (o, c) => ({ ...resetCalc(o, c.reset), task: "opt", vdw: { mode: "D3", damp: "bj" } }),
  },
  {
    id: "optical",
    label: "Optical",
    hint: "Optical conductivity and dielectric function (CDDF)",
    apply: (o, c) => {
      const r = resetCalc(o, c.reset);
      return { ...r, optical: { ...r.optical, enabled: true, kgrid: o.dos.kgrid } };
    },
  },
  {
    id: "md",
    label: "MD 300 K",
    hint: "Nosé-Hoover NVT, 0.5 fs × 1000 steps",
    apply: (o, c) => ({ ...resetCalc(o, c.reset), task: "md" }),
  },
  {
    id: "stm",
    label: "STM image",
    hint: "Partial charge density 1 eV below E_F (Tersoff-Hamann)",
    apply: (o, c) => {
      const r = resetCalc(o, c.reset);
      return { ...r, partialCharge: { enabled: true, window: -1 } };
    },
  },
  {
    id: "wannier",
    label: "Wannier (CWF)",
    hint: "Closest Wannier functions from the valence PAOs, with Wannier90 files",
    apply: (o, c) => {
      const r = resetCalc(o, c.reset);
      const orbitals = Object.fromEntries(
        c.elements.map((el) => [el, paoShells(o.species[el]?.pao ?? "").map(([l]) => l).filter((l) => l !== "f")]),
      );
      return { ...r, cwf: { ...r.cwf, enabled: true, orbitals, wannier90: true } };
    },
  },
  {
    id: "post",
    label: "Berry / jx / Chern / Z2",
    hint: "HS.fileout writes the .scfout read by polB, jx, calB, Z2FH and kSpin",
    apply: (o, c) => {
      const r = resetCalc(o, c.reset);
      return { ...r, analysis: { ...r.analysis, hs: true } };
    },
  },
  { id: "evslc", label: "E vs a", hint: "Energy-volume curve", apply: (o, c) => ({ ...resetCalc(o, c.reset), task: "evslc" }) },
];

// ---------- small inputs

/** Number input that accepts intermediate text like "-" or "1e-" while typing. */
function Num({
  value,
  onChange,
  int,
  min,
  max,
  label,
  ...rest
}: {
  value: number;
  onChange: (v: number) => void;
  int?: boolean;
  min?: number;
  max?: number;
  label?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== "" ? t : String(value)));
  }, [value]);
  return (
    <input
      {...rest}
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        let n = Number(e.target.value);
        if (e.target.value.trim() === "" || !Number.isFinite(n)) return;
        if (int) n = Math.round(n);
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        onChange(n);
      }}
    />
  );
}

function NumField(props: { label: ReactNode; hint?: ReactNode; value: number; onChange: (v: number) => void; int?: boolean; min?: number; max?: number }) {
  const { label, hint, ...rest } = props;
  return (
    <label className="field">
      <span>{label}</span>
      <Num {...rest} label={typeof label === "string" ? label : undefined} />
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

function Vec3Field({ label, value, onChange, int, min, hint }: { label: ReactNode; value: Vec3; onChange: (v: Vec3) => void; int?: boolean; min?: number; hint?: ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row triple">
        {[0, 1, 2].map((i) => (
          <Num
            key={i}
            int={int}
            min={min}
            label={`${typeof label === "string" ? label : "value"} ${i + 1}`}
            value={value[i]}
            onChange={(x) => {
              const v = [...value] as Vec3;
              v[i] = x;
              onChange(v);
            }}
          />
        ))}
      </div>
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: ReactNode;
  value: T;
  options: (T | [T, string])[];
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  const opts = options.map((o) => (Array.isArray(o) ? o : ([o, String(o)] as [T, string])));
  return (
    <label className="field">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(opts.find(([v]) => String(v) === e.target.value)![0])}>
        {opts.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint, children }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`option${checked ? " is-on" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <b>{label}</b>
      </label>
      {hint && <p className="hint">{hint}</p>}
      {checked && children && <div className="option__body">{children}</div>}
    </div>
  );
}

const Kw = ({ children }: { children: ReactNode }) => <span className="mono kw">{children}</span>;

type Tab = "structure" | "calculation" | "electronic" | "scf" | "output";
const TABS: [Tab, string][] = [
  ["structure", "Structure & basis"],
  ["calculation", "Calculation"],
  ["electronic", "Electronic"],
  ["scf", "SCF & k-points"],
  ["output", "Outputs & analysis"],
];

interface Props {
  crystal: Crystal;
  name: string;
  onClose: () => void;
}

export default function OpenmxExportDialog({ crystal, name, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const elements = useMemo(() => speciesOrder(crystal), [crystal]);
  const defaults = useMemo(() => defaultOptions(crystal, name), [crystal, name]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [tab, setTab] = useState<Tab>("calculation");
  const [recipe, setRecipe] = useState("scf");
  const [o, setO] = useState<OpenmxOptions>(() => {
    const saved = loadSpecies();
    const p = loadPrefs();
    const species = Object.fromEntries(elements.map((el) => [el, initialSpecies(el, p, saved)]));
    return { ...defaultOptions(crystal, name), species };
  });
  const [copied, setCopied] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const spin = spinKeyword(o);
  const magnetic = spin !== "off";
  const nc = spin === "NC";
  const wantPath = o.band.enabled || o.unfolding.enabled;

  // Fetch the high-symmetry path the first time band output (or unfolding) is switched on.
  useEffect(() => {
    if (!wantPath || o.band.path) return;
    let alive = true;
    setPathError(null);
    getKpath(crystal).then(
      (path) => alive && setO((p) => ({ ...p, band: { ...p.band, path } })),
      (e: Error) => alive && setPathError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [wantPath, o.band.path, crystal]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const set = <K extends keyof OpenmxOptions>(key: K, value: OpenmxOptions[K]) => setO((p) => ({ ...p, [key]: value }));
  /** Merge into one of the nested option groups (scf, md, dos, ...). */
  const patch = <K extends keyof OpenmxOptions>(key: K, value: Partial<OpenmxOptions[K]>) =>
    setO((p) => ({ ...p, [key]: { ...(p[key] as object), ...value } }));
  const setSpecies = (el: string, change: Partial<OpenmxSpecies>) =>
    setO((p) => {
      const species = { ...p.species, [el]: { ...p.species[el], ...change } };
      // Only elements without a table preset are remembered; table elements follow the preset.
      if (!OPENMX_PAO_TABLE[el]) saveSpecies({ [el]: species[el] });
      return { ...p, species };
    });
  const applyPrefs = (next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
    setO((p) => {
      const species = { ...p.species };
      for (const el of elements) {
        const preset = presetSpecies(el, next.quality, next.vps[el]);
        if (preset) species[el] = preset;
      }
      return { ...p, species };
    });
  };
  const setRepeat = (i: number, value: number) => {
    const repeat = [...o.repeat] as Vec3;
    repeat[i] = Math.min(Math.max(Math.round(value) || 1, 1), 6);
    setO((p) => ({ ...p, repeat, scf: { ...p.scf, kgrid: autoKgrid(crystal.lattice!, repeat) } }));
  };
  const applyRecipe = (id: string) => {
    const r = RECIPES.find((x) => x.id === id)!;
    setRecipe(id);
    setO((p) => r.apply(p, { elements, reset: defaults }));
  };

  const dat = useMemo(() => writeOpenmxDat(crystal, o), [crystal, o]);
  const warnings = useMemo(() => openmxWarnings(crystal, o), [crystal, o]);
  const missing = missingSpecies(crystal, o.species);
  const natoms = crystal.atoms.length * o.repeat[0] * o.repeat[1] * o.repeat[2];
  const fileName = `${o.systemName || "structure"}.dat`;
  const lineCount = dat.split("\n").length;

  const download = () => {
    const url = URL.createObjectURL(new Blob([dat], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dat);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the preview can still be selected by hand */
    }
  };

  const active = [
    TASKS.find((t) => t.id === o.task)!.label,
    spin !== "off" && `spin ${spin}`,
    o.soc && "SOC",
    o.dftU.enabled && "DFT+U",
    o.vdw.mode !== "off" && `DFT-${o.vdw.mode}`,
    o.band.enabled && "band",
    dosNeeded(o) && "DOS",
    o.unfolding.enabled && "unfolding",
    o.cohp.enabled && "COHP",
    o.optical.enabled && "optical",
    o.mo.enabled && "MO",
    o.partialCharge.enabled && "STM",
    o.cwf.enabled && "CWF",
    o.mlwf.enabled && "MLWF",
    o.esm.mode !== "off" && "ESM",
    o.coreHole.enabled && "XPS",
    o.scf.restart !== "off" && `restart ${o.scf.restart}`,
  ].filter(Boolean) as string[];

  return (
    <dialog ref={ref} className="export-dialog" onClose={onClose} aria-labelledby="openmx-title">
      <header className="export-dialog__head">
        <div>
          <h2 id="openmx-title">Export OpenMX input</h2>
          <p className="muted small">
            {natoms} atoms · {elements.length} species · <span className="mono">{fileName}</span> · OpenMX 4.0
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}>
          ×
        </button>
      </header>

      <div className="export-dialog__body">
        <div className="export-dialog__form">
          <div className="recipes">
            <span className="small muted">Quick setup</span>
            <div className="recipes__list" role="group" aria-label="Calculation recipes">
              {RECIPES.map((r) => (
                <button key={r.id} type="button" title={r.hint} aria-pressed={recipe === r.id} onClick={() => applyRecipe(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
            <p className="hint">{RECIPES.find((r) => r.id === recipe)?.hint}. Everything can be refined in the tabs below.</p>
          </div>

          <div className="omx-tabs" role="tablist" aria-label="Settings">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
                {id === "structure" && missing.length > 0 && <span className="dot" aria-label="incomplete" />}
              </button>
            ))}
          </div>

          {tab === "structure" && (
            <>
              <fieldset>
                <legend>Structure</legend>
                <label className="field">
                  <span>System name</span>
                  <input value={o.systemName} onChange={(e) => set("systemName", e.target.value.replace(/\s+/g, "_"))} />
                </label>
                <div className="field">
                  <span>Coordinates</span>
                  <div className="segmented" role="radiogroup" aria-label="Coordinate unit">
                    <button type="button" aria-pressed={o.coordinates === "FRAC"} onClick={() => set("coordinates", "FRAC")}>
                      Fractional
                    </button>
                    <button type="button" aria-pressed={o.coordinates === "Ang"} onClick={() => set("coordinates", "Ang")}>
                      Cartesian (Å)
                    </button>
                  </div>
                </div>
                <div className="field">
                  <span>Supercell</span>
                  <div className="row triple">
                    {["a", "b", "c"].map((axis, i) => (
                      <label key={axis}>
                        <i>{axis}</i>
                        <input type="number" min={1} max={6} value={o.repeat[i]} onChange={(e) => setRepeat(i, Number(e.target.value))} />
                      </label>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>DATA.PATH</span>
                  <input value={o.dataPath} onChange={(e) => set("dataPath", e.target.value)} />
                </label>
              </fieldset>

              <fieldset>
                <legend>Basis set (PAO) and pseudopotentials</legend>
                <div className="segmented quality" role="radiogroup" aria-label="Basis quality">
                  {(Object.keys(QUALITY_LABELS) as BasisQuality[]).map((q) => (
                    <button key={q} type="button" aria-pressed={prefs.quality === q} onClick={() => applyPrefs({ ...prefs, quality: q })}>
                      {QUALITY_LABELS[q]}
                    </button>
                  ))}
                </div>
                <div className="table-scroll">
                  <table className="species-table">
                    <thead>
                      <tr>
                        <th>El.</th>
                        <th>PAO</th>
                        <th>VPS</th>
                        <th>Valence e⁻</th>
                        {magnetic && <th title="Initial magnetic moment">μB</th>}
                        {nc && <th title="Initial spin direction: polar angle θ (deg)">θ</th>}
                        {nc && <th title="Initial spin direction: azimuth φ (deg)">φ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {elements.map((el) => {
                        const s = o.species[el];
                        const options = OPENMX_PAO_TABLE[el];
                        const [theta, phi] = o.angles[el] ?? [0, 0];
                        return (
                          <tr key={el} className={missing.includes(el) ? "is-missing" : ""}>
                            <th>
                              {el}
                              {!options && (
                                <span className="tag" title="Not in the OpenMX recommended table: enter it yourself">
                                  manual
                                </span>
                              )}
                            </th>
                            <td>
                              <input aria-label={`${el} PAO`} placeholder={`${el}7.0-s2p2d1`} value={s.pao} onChange={(e) => setSpecies(el, { pao: e.target.value.trim() })} />
                            </td>
                            <td>
                              {options && options.length > 1 ? (
                                <select aria-label={`${el} VPS`} value={s.vps} onChange={(e) => applyPrefs({ ...prefs, vps: { ...prefs.vps, [el]: e.target.value } })}>
                                  {options.map((opt) => (
                                    <option key={opt.vps} value={opt.vps}>
                                      {opt.vps} ({opt.valence} e⁻)
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input aria-label={`${el} VPS`} placeholder={`${el}_PBE19`} value={s.vps} onChange={(e) => setSpecies(el, { vps: e.target.value.trim() })} />
                              )}
                            </td>
                            <td>
                              <input
                                aria-label={`${el} valence electrons`}
                                type="number"
                                min={0}
                                step={0.5}
                                value={s.valence ?? ""}
                                onChange={(e) => setSpecies(el, { valence: e.target.value === "" ? null : Number(e.target.value) })}
                              />
                            </td>
                            {magnetic && (
                              <td className="moment">
                                <Num label={`${el} initial magnetic moment`} value={o.moments[el] ?? 0} onChange={(v) => set("moments", { ...o.moments, [el]: v })} />
                              </td>
                            )}
                            {nc && (
                              <td className="moment">
                                <Num label={`${el} spin theta`} value={theta} onChange={(v) => set("angles", { ...o.angles, [el]: [v, phi] })} />
                              </td>
                            )}
                            {nc && (
                              <td className="moment">
                                <Num label={`${el} spin phi`} value={phi} onChange={(v) => set("angles", { ...o.angles, [el]: [theta, v] })} />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="hint">
                  Values follow the recommended PAO table of the OpenMX manual for DFT_DATA19 (H–Bi). For Fe, Co, Ni, Cu and Zn choose the
                  hard (H) or soft (S) pseudopotential. Elements marked <i>manual</i> are not in the table: their entries are remembered in
                  this browser.
                  {magnetic && " μB sets the initial moment through the up/down electron columns."}
                  {nc && " θ, φ are Euler angles of the initial spin (and orbital) moment: θ = 0 along +z, θ = 90, φ = 0 along +x."}
                </p>
              </fieldset>
            </>
          )}

          {tab === "calculation" && (
            <>
              <fieldset>
                <legend>Calculation type</legend>
                <div className="task-list" role="radiogroup" aria-label="Calculation type">
                  {TASKS.map((t) => (
                    <button key={t.id} type="button" role="radio" aria-checked={o.task === t.id} className="task" onClick={() => set("task", t.id)}>
                      <b>{t.label}</b>
                      <span>{t.hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {o.task === "opt" && (
                <fieldset>
                  <legend>Geometry optimisation</legend>
                  <div className="grid-2">
                    <SelectField<OptMethod>
                      label="Method (MD.Type)"
                      value={o.opt.method}
                      options={[
                        ["RF", "RF – rational function (recommended)"],
                        ["BFGS", "BFGS"],
                        ["EF", "EF – eigenvector following"],
                        ["DIIS", "DIIS"],
                        ["Opt", "Opt – steepest descent"],
                      ]}
                      onChange={(v) => patch("opt", { method: v })}
                    />
                    <NumField label="Max. steps (MD.maxIter)" int min={1} value={o.opt.maxIter} onChange={(v) => patch("opt", { maxIter: v })} />
                    <NumField
                      label="Force criterion (Hartree/Bohr)"
                      value={o.opt.criterion}
                      onChange={(v) => patch("opt", { criterion: v })}
                      hint="MD.Opt.criterion, default 3e-4 (≈ 0.015 eV/Å)"
                    />
                    <label className="field">
                      <span>Fixed atoms (MD.Fixed.XYZ)</span>
                      <input placeholder="e.g. 1-4, 9" value={o.opt.fixed} onChange={(e) => patch("opt", { fixed: e.target.value })} />
                      <small className="hint">Serial numbers as in the file; x, y, z all fixed.</small>
                    </label>
                  </div>
                </fieldset>
              )}

              {o.task === "cellopt" && (
                <fieldset>
                  <legend>Variable-cell optimisation</legend>
                  <div className="grid-2">
                    <SelectField<CellMethod>
                      label="Method (MD.Type)"
                      value={o.cell.method}
                      options={[
                        ["RFC5", "RFC5 – cell + atoms, RF/BFGS (recommended)"],
                        ["RFC6", "RFC6 – a3 fixed"],
                        ["RFC7", "RFC7 – a2, a3 fixed"],
                        ["OptC1", "OptC1 – cell only, atoms fixed"],
                        ["OptC2", "OptC2 – lengths only"],
                        ["OptC3", "OptC3 – |a1|=|a2|=|a3|"],
                        ["OptC4", "OptC4 – |a1|=|a2|≠|a3|"],
                        ["OptC5", "OptC5 – cell + atoms, SD"],
                        ["OptC6", "OptC6 – a3 fixed, SD"],
                        ["OptC7", "OptC7 – a2, a3 fixed, SD"],
                      ]}
                      onChange={(v) => patch("cell", { method: v })}
                    />
                    <NumField label="Max. steps" int min={1} value={o.cell.maxIter} onChange={(v) => patch("cell", { maxIter: v })} />
                    <NumField label="Gradient criterion (Hartree/Bohr)" value={o.cell.criterion} onChange={(v) => patch("cell", { criterion: v })} />
                    <NumField
                      label="Pressure (GPa)"
                      value={o.cell.pressure}
                      onChange={(v) => patch("cell", { pressure: v })}
                      hint="MD.applied.pressure: minimises the enthalpy E + pV; positive = compression."
                    />
                  </div>
                  {["OptC1", "OptC2", "OptC5", "RFC5"].includes(o.cell.method) && (
                    <div className="field">
                      <span>Fix Cartesian components of the cell vectors (MD.Fixed.Cell.Vectors)</span>
                      <table className="cell-flags">
                        <tbody>
                          {["a", "b", "c"].map((v, r) => (
                            <tr key={v}>
                              <th>{v}</th>
                              {["x", "y", "z"].map((c, col) => (
                                <td key={c}>
                                  <label className="check">
                                    <input
                                      type="checkbox"
                                      checked={o.cell.fixed[r * 3 + col]}
                                      onChange={(e) => {
                                        const fixed = [...o.cell.fixed];
                                        fixed[r * 3 + col] = e.target.checked;
                                        patch("cell", { fixed });
                                      }}
                                    />
                                    {v}
                                    <sub>{c}</sub>
                                  </label>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <small className="hint">E.g. fix c<sub>x</sub>, c<sub>y</sub>, c<sub>z</sub> to keep the vacuum of a slab.</small>
                    </div>
                  )}
                </fieldset>
              )}

              {o.task === "md" && (
                <fieldset>
                  <legend>Molecular dynamics</legend>
                  <div className="grid-2">
                    <SelectField<MdEnsemble>
                      label="Ensemble (MD.Type)"
                      value={o.md.ensemble}
                      options={[
                        ["NVE", "NVE – microcanonical"],
                        ["NVT_VS", "NVT – velocity scaling"],
                        ["NVT_VS2", "NVT – local velocity scaling"],
                        ["NVT_VS4", "NVT – one heat bath per element"],
                        ["NVT_NH", "NVT – Nosé-Hoover"],
                        ["NPT_VS_PR", "NPT – velocity scaling + Parrinello-Rahman"],
                        ["NPT_VS_WV", "NPT – velocity scaling + Wentzcovitch"],
                      ]}
                      onChange={(v) => patch("md", { ensemble: v })}
                    />
                    <NumField label="Steps (MD.maxIter)" int min={1} value={o.md.steps} onChange={(v) => patch("md", { steps: v })} />
                    <NumField label="Time step (fs)" value={o.md.timestep} onChange={(v) => patch("md", { timestep: v })} hint="Default 0.5 fs; heavier atoms allow larger steps." />
                    {o.md.ensemble !== "NVE" && (
                      <NumField label="Temperature (K)" value={o.md.temperature} onChange={(v) => patch("md", { temperature: v })} hint="Written to MD.TempControl." />
                    )}
                    {o.md.ensemble !== "NVE" && o.md.ensemble !== "NVT_NH" && (
                      <>
                        <NumField label="Scaling interval (steps)" int min={1} value={o.md.interval} onChange={(v) => patch("md", { interval: v })} />
                        <NumField label="Scaling parameter α" value={o.md.alpha} onChange={(v) => patch("md", { alpha: v })} />
                      </>
                    )}
                    {o.md.ensemble === "NVT_NH" && (
                      <NumField label="Heat-bath mass (NH.Mass.HeatBath)" value={o.md.nhMass} onChange={(v) => patch("md", { nhMass: v })} hint="Bohr² × u, default 20." />
                    )}
                    {o.md.ensemble.startsWith("NPT") && (
                      <>
                        <NumField label="Pressure (GPa)" value={o.md.pressure} onChange={(v) => patch("md", { pressure: v })} hint="MD.CellPressureControl" />
                        <label className="field">
                          <span>Barostat mass (u)</span>
                          <input
                            placeholder="OpenMX default"
                            value={o.md.barostatMass ?? ""}
                            onChange={(e) => patch("md", { barostatMass: e.target.value.trim() === "" || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) })}
                          />
                          <small className="hint">NPT.Mass.Barostat: smaller = faster cell response.</small>
                        </label>
                        <SelectField
                          label="Cell shape (NPT.LatticeRestriction)"
                          value={o.md.restriction}
                          options={["none", "cubic", "ortho"] as const as ("none" | "cubic" | "ortho")[]}
                          onChange={(v) => patch("md", { restriction: v })}
                        />
                        <NumField label="Temperature tolerance (K)" value={o.md.tolerance} onChange={(v) => patch("md", { tolerance: v })} hint="No scaling within this window (MD.TempTolerance)." />
                      </>
                    )}
                    {!o.md.ensemble.startsWith("NPT") && (
                      <label className="field">
                        <span>Fixed atoms (MD.Fixed.XYZ)</span>
                        <input placeholder="e.g. 1-4" value={o.md.fixed} onChange={(e) => patch("md", { fixed: e.target.value })} />
                      </label>
                    )}
                  </div>
                  <div className="field">
                    <span>Atomic masses (u, blank = default)</span>
                    <div className="mass-list">
                      {elements.map((el) => (
                        <label key={el}>
                          <i>{el}</i>
                          <input
                            placeholder="default"
                            value={o.masses[el] ?? ""}
                            onChange={(e) =>
                              set("masses", { ...o.masses, [el]: e.target.value.trim() === "" || !(Number(e.target.value) > 0) ? null : Number(e.target.value) })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <small className="hint">4th column of Definition.of.Atomic.Species, e.g. 2.0 for H to simulate deuterium (§20.9).</small>
                  </div>
                </fieldset>
              )}

              {o.task === "evslc" && (
                <fieldset>
                  <legend>Energy vs lattice constant</legend>
                  <div className="grid-2">
                    <NumField label="Step (%)" value={o.evslc.step} onChange={(v) => patch("evslc", { step: v })} hint="MD.EvsLC.Step, default 0.4 %" />
                    <NumField label="Number of points (MD.maxIter)" int min={2} value={o.evslc.steps} onChange={(v) => patch("evslc", { steps: v })} />
                  </div>
                  <div className="field">
                    <span>Axes (MD.EvsLC.flag)</span>
                    <div className="row triple">
                      {["a", "b", "c"].map((axis, i) => (
                        <label key={axis}>
                          <i>{axis}</i>
                          <select
                            value={o.evslc.flag[i]}
                            onChange={(e) => {
                              const flag = [...o.evslc.flag] as Vec3;
                              flag[i] = Number(e.target.value);
                              patch("evslc", { flag });
                            }}
                          >
                            <option value={1}>expand</option>
                            <option value={-1}>contract</option>
                            <option value={0}>fixed</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                </fieldset>
              )}

              <p className="hint">
                Electronic options (spin, SOC, DFT+U, vdW, fields) are in <b>Electronic</b>; band, DOS, Wannier and other outputs in{" "}
                <b>Outputs &amp; analysis</b>. Each can be combined with any calculation type.
              </p>
            </>
          )}

          {tab === "electronic" && (
            <>
              <fieldset>
                <legend>Functional and spin</legend>
                <div className="grid-2">
                  <SelectField
                    label="Exchange-correlation (scf.XcType)"
                    value={o.xc}
                    options={[
                      ["GGA-PBE", "GGA-PBE"],
                      ["LDA", "LDA (non-spin only)"],
                      ["LSDA-CA", "LSDA-CA (Ceperley-Alder)"],
                      ["LSDA-PW", "LSDA-PW (Perdew-Wang)"],
                    ]}
                    onChange={(v) => set("xc", v)}
                  />
                  <label className="field">
                    <span>Spin polarization</span>
                    <select value={o.spin} onChange={(e) => set("spin", e.target.value as OpenmxOptions["spin"])}>
                      <option value="off">off</option>
                      <option value="on">on (collinear)</option>
                      <option value="nc">NC (noncollinear)</option>
                    </select>
                    <small className="hint">
                      Written: <Kw>scf.SpinPolarization {spin}</Kw>
                      {spin !== o.spin.replace("nc", "NC") && " (forced by the options below)"}
                    </small>
                  </label>
                </div>
                <Toggle
                  checked={o.soc}
                  onChange={(v) => set("soc", v)}
                  label="Spin–orbit coupling"
                  hint={
                    <>
                      Fully relativistic, self-consistent SOC (<Kw>scf.SpinOrbit.Coupling on</Kw>, §38). Needs NC and j-dependent
                      pseudopotentials (the DFT_DATA19 VPS files are). Orbital moments are printed automatically.
                    </>
                  }
                >
                  <NumField
                    label="SOC strength factor (scf.SO.factor)"
                    value={o.socScale}
                    min={0}
                    onChange={(v) => set("socScale", v)}
                    hint="1 = physical strength; other values scale s, p, d, f for every species (e.g. 0 vs 1 to isolate SOC effects)."
                  />
                </Toggle>
              </fieldset>

              <fieldset>
                <legend>DFT+U (§40)</legend>
                <Toggle
                  checked={o.dftU.enabled}
                  onChange={(v) => {
                    const values = { ...o.dftU.values };
                    for (const el of elements) {
                      if (values[el]) continue;
                      const orbital = defaultHubbardOrbital(el, o.species[el]?.pao ?? "");
                      values[el] = { orbital, U: orbital ? 4 : 0, J: 0 };
                    }
                    patch("dftU", { enabled: v, values });
                  }}
                  label="Hubbard U"
                  hint="Corrects self-interaction on localized d/f shells (oxides, Mott insulators). Needs spin polarization."
                >
                  <div className="grid-2">
                    <SelectField<1 | 2>
                      label="Form (scf.DFTU.Type)"
                      value={o.dftU.type}
                      options={[
                        [1, "1 – simplified, Dudarev (U only)"],
                        [2, "2 – general (U and J)"],
                      ]}
                      onChange={(v) => patch("dftU", { type: v })}
                    />
                    <SelectField
                      label="Occupation operator"
                      value={o.dftU.occupation}
                      options={[
                        ["dual", "dual (satisfies the sum rule)"],
                        ["onsite", "onsite"],
                        ["full", "full"],
                      ]}
                      onChange={(v) => patch("dftU", { occupation: v })}
                    />
                    {o.dftU.type === 2 && (
                      <SelectField
                        label="Double counting (scf.dc.Type)"
                        value={o.dftU.dc}
                        options={["sFLL", "sAMF", "cFLL", "cAMF"] as ("sFLL" | "sAMF" | "cFLL" | "cAMF")[]}
                        onChange={(v) => patch("dftU", { dc: v })}
                      />
                    )}
                  </div>
                  <table className="species-table">
                    <thead>
                      <tr>
                        <th>El.</th>
                        <th>Orbital</th>
                        <th>U (eV)</th>
                        {o.dftU.type === 2 && !o.dftU.yukawa && <th>J (eV)</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {elements.map((el) => {
                        const e = o.dftU.values[el] ?? { orbital: "", U: 0, J: 0 };
                        const put = (change: Partial<typeof e>) => patch("dftU", { values: { ...o.dftU.values, [el]: { ...e, ...change } } });
                        return (
                          <tr key={el}>
                            <th>{el}</th>
                            <td>
                              <select aria-label={`${el} U orbital`} value={e.orbital} onChange={(ev) => put({ orbital: ev.target.value })}>
                                <option value="">none</option>
                                {paoOrbitals(o.species[el]?.pao ?? "").map((orb) => (
                                  <option key={orb} value={orb}>
                                    {orb}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <Num label={`${el} U`} value={e.U} onChange={(v) => put({ U: v })} disabled={!e.orbital} />
                            </td>
                            {o.dftU.type === 2 && !o.dftU.yukawa && (
                              <td>
                                <Num label={`${el} J`} value={e.J} onChange={(v) => put({ J: v })} disabled={!e.orbital} />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <label className="check">
                    <input type="checkbox" checked={o.dftU.orbitalPolarization} onChange={(e) => patch("dftU", { orbitalPolarization: e.target.checked })} />
                    Promote orbital polarization in the first SCF steps (last atom column = on)
                  </label>
                  {o.dftU.type === 2 && (
                    <label className="check">
                      <input type="checkbox" checked={o.dftU.yukawa} onChange={(e) => patch("dftU", { yukawa: e.target.checked })} />
                      Estimate J and F⁴/F² from U with a Yukawa potential (scf.Yukawa)
                    </label>
                  )}
                  <p className="hint">“1d” is the first d radial function of the PAO (e.g. Fe5.5H-s3p2d1 → 1s 2s 3s 1p 2p 1d).</p>
                </Toggle>
              </fieldset>

              <fieldset>
                <legend>Noncollinear magnetism</legend>
                <Toggle
                  checked={o.constraint.mode !== "off"}
                  onChange={(v) => patch("constraint", { mode: v ? "on" : "off" })}
                  label="Constrain spin directions (§41)"
                  hint="Penalty functional that keeps each spin along the θ, φ of the Structure tab, e.g. for energy vs spin-angle curves."
                >
                  <div className="grid-2">
                    <SelectField
                      label="scf.Constraint.NC.Spin"
                      value={o.constraint.mode}
                      options={[
                        ["on", "on – direction only"],
                        ["on2", "on2 – direction and magnitude"],
                      ]}
                      onChange={(v) => patch("constraint", { mode: v })}
                    />
                    <NumField label="Strength (eV)" value={o.constraint.strength} onChange={(v) => patch("constraint", { strength: v })} />
                  </div>
                </Toggle>
                <Toggle
                  checked={o.zeeman.spin}
                  onChange={(v) => patch("zeeman", { spin: v })}
                  label="Zeeman field on spin moments (§43)"
                  hint="Uniform magnetic field along each atom's θ, φ. Cannot be combined with the spin constraint."
                >
                  <NumField label="Field (Tesla)" value={o.zeeman.spinField} onChange={(v) => patch("zeeman", { spinField: v })} />
                </Toggle>
                <Toggle checked={o.zeeman.orbital} onChange={(v) => patch("zeeman", { orbital: v })} label="Zeeman field on orbital moments">
                  <NumField label="Field (Tesla)" value={o.zeeman.orbitalField} onChange={(v) => patch("zeeman", { orbitalField: v })} />
                </Toggle>
                <Toggle
                  checked={o.spiral.enabled}
                  onChange={(v) => patch("spiral", { enabled: v })}
                  label="Spin spiral (generalized Bloch, §57)"
                  hint="θ in the Structure tab is the cone angle (90 = flat spiral). Not compatible with SOC."
                >
                  <Vec3Field label="Spiral vector q (reciprocal-lattice units)" value={o.spiral.q} onChange={(q) => patch("spiral", { q })} />
                </Toggle>
              </fieldset>

              <fieldset>
                <legend>Interactions, charge and fields</legend>
                <div className="grid-2">
                  <SelectField
                    label="van der Waals (scf.dftD)"
                    value={o.vdw.mode}
                    options={[
                      ["off", "off"],
                      ["D2", "DFT-D2 (Grimme 2006)"],
                      ["D3", "DFT-D3 (Grimme 2010)"],
                    ]}
                    onChange={(v) => patch("vdw", { mode: v })}
                  />
                  {o.vdw.mode === "D3" && (
                    <SelectField
                      label="D3 damping"
                      value={o.vdw.damp}
                      options={[
                        ["bj", "Becke-Johnson (bj)"],
                        ["zero", "zero damping"],
                      ]}
                      onChange={(v) => patch("vdw", { damp: v })}
                    />
                  )}
                  <NumField
                    label="Extra charge (scf.system.charge)"
                    value={o.charge}
                    onChange={(v) => set("charge", v)}
                    hint="+1 removes one electron (hole doping), −1 adds one (§31)."
                  />
                </div>
                <Vec3Field
                  label="Uniform electric field (GV/m, x y z)"
                  value={o.efield}
                  onChange={(v) => set("efield", v)}
                  hint="scf.Electric.Field (§30); use a slab with vacuum along the field."
                />
                <Toggle
                  checked={o.esm.mode !== "off"}
                  onChange={(v) => patch("esm", { mode: v ? "on1" : "off" })}
                  label="Effective screening medium (ESM, §49)"
                  hint="Slab with semi-infinite vacuum or metal boundaries: charged surfaces, electrodes, applied bias, work functions."
                >
                  <div className="grid-2">
                    <SelectField
                      label="ESM.switch"
                      value={o.esm.mode}
                      options={[
                        ["on1", "on1 – vacuum | vacuum"],
                        ["on2", "on2 – metal | metal"],
                        ["on3", "on3 – vacuum | metal"],
                        ["on4", "on4 – metal | metal + field"],
                      ]}
                      onChange={(v) => patch("esm", { mode: v })}
                    />
                    <SelectField label="Surface normal (ESM.direction)" value={o.esm.direction} options={["x", "y", "z"] as ("x" | "y" | "z")[]} onChange={(v) => patch("esm", { direction: v })} />
                    <NumField label="Buffer range (Å)" value={o.esm.buffer} onChange={(v) => patch("esm", { buffer: v })} hint="No atoms within this distance of the boundary." />
                    {o.esm.mode === "on4" && <NumField label="Potential difference (eV)" value={o.esm.potentialDiff} onChange={(v) => patch("esm", { potentialDiff: v })} />}
                  </div>
                </Toggle>
                <Toggle
                  checked={o.coreHole.enabled}
                  onChange={(v) => {
                    patch("coreHole", { enabled: v });
                    if (v && o.charge === 0) set("charge", 1);
                  }}
                  label="XPS core hole, final state (§60)"
                  hint="Absolute core-level binding energy = E(final) − E(initial). Molecules: charge +1 and Coulomb cutoff; bulk: charge 0."
                >
                  <div className="grid-2">
                    <NumField label="Atom" int min={1} max={natoms} value={o.coreHole.atom} onChange={(v) => patch("coreHole", { atom: v })} />
                    <SelectField label="Shell (l)" value={o.coreHole.l} options={["s", "p", "d", "f"] as ("s" | "p" | "d" | "f")[]} onChange={(v) => patch("coreHole", { l: v })} />
                    <NumField
                      label="Orbital index"
                      int
                      min={1}
                      max={4 * ["s", "p", "d", "f"].indexOf(o.coreHole.l) + 2}
                      value={o.coreHole.index}
                      onChange={(v) => patch("coreHole", { index: v })}
                      hint="1 … 4l+2 (Table 13 of the manual), e.g. s: 1 = ↑, 2 = ↓."
                    />
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={o.coreHole.coulombCutoff} onChange={(e) => patch("coreHole", { coulombCutoff: e.target.checked })} />
                    Exact Coulomb cutoff (scf.coulomb.cutoff)
                  </label>
                </Toggle>
              </fieldset>
            </>
          )}

          {tab === "scf" && (
            <>
              <fieldset>
                <legend>Accuracy</legend>
                <div className="grid-2">
                  <NumField label="Energy cutoff (Ry)" min={50} value={o.scf.energyCutoff} onChange={(v) => patch("scf", { energyCutoff: v })} hint="scf.energycutoff, default 220 Ry" />
                  <NumField
                    label="Electronic temperature (K)"
                    value={o.scf.electronicTemperature}
                    onChange={(v) => patch("scf", { electronicTemperature: v })}
                    hint="Smearing; lower for MAE/semiconductors, higher helps metals converge."
                  />
                  <Vec3Field label="k-grid (scf.Kgrid)" int min={1} value={o.scf.kgrid} onChange={(v) => patch("scf", { kgrid: v })} />
                  <SelectField
                    label="k-point generation"
                    value={o.scf.kgridType}
                    options={[
                      ["GCenter", "Γ-centred (default)"],
                      ["Regular", "Regular Monkhorst-Pack"],
                    ]}
                    onChange={(v) => patch("scf", { kgridType: v })}
                  />
                  <NumField label="Max. SCF iterations" int min={1} value={o.scf.maxIter} onChange={(v) => patch("scf", { maxIter: v })} />
                  <NumField label="Convergence (Hartree)" value={o.scf.criterion} onChange={(v) => patch("scf", { criterion: v })} hint="scf.criterion, default 1e-6" />
                </div>
                <button type="button" className="link-button" onClick={() => patch("scf", { kgrid: autoKgrid(crystal.lattice!, o.repeat) })}>
                  Reset k-grid to automatic ({autoKgrid(crystal.lattice!, o.repeat).join("×")})
                </button>
              </fieldset>

              <fieldset>
                <legend>Eigenvalue solver</legend>
                <SelectField<Solver>
                  label="scf.EigenvalueSolver"
                  value={o.scf.solver}
                  options={[
                    ["Band", "Band – periodic crystals (k-points)"],
                    ["Cluster", "Cluster – molecules / Γ only"],
                    ["DC", "DC – divide-conquer O(N)"],
                    ["DC-LNO", "DC-LNO – O(N) with natural orbitals"],
                    ["Krylov", "Krylov – O(N) Krylov subspace"],
                    ["ON2", "ON2 – exact low-order scaling"],
                  ]}
                  onChange={(v) => patch("scf", { solver: v })}
                  hint="O(N) solvers (§27) are for thousands of atoms; band structures need Band."
                />
              </fieldset>

              <fieldset>
                <legend>Charge mixing</legend>
                <div className="grid-2">
                  <SelectField<MixingType>
                    label="scf.Mixing.Type"
                    value={o.scf.mixing}
                    options={[
                      ["RMM-DIISK", "RMM-DIISK – most robust (default)"],
                      ["RMM-DIIS", "RMM-DIIS"],
                      ["RMM-DIISV", "RMM-DIISV (potential)"],
                      ["RMM-DIISH", "RMM-DIISH (Hamiltonian, for +U/NC)"],
                      ["GR-Pulay", "GR-Pulay"],
                      ["Kerker", "Kerker"],
                      ["Simple", "Simple"],
                    ]}
                    onChange={(v) => patch("scf", { mixing: v })}
                  />
                  <NumField label="Initial mixing weight" value={o.scf.initWeight} onChange={(v) => patch("scf", { initWeight: v })} />
                  <NumField label="Min. mixing weight" value={o.scf.minWeight} onChange={(v) => patch("scf", { minWeight: v })} />
                  <NumField label="Max. mixing weight" value={o.scf.maxWeight} onChange={(v) => patch("scf", { maxWeight: v })} />
                  {o.scf.mixing !== "Simple" && (
                    <>
                      <NumField label="History" int min={1} value={o.scf.history} onChange={(v) => patch("scf", { history: v })} hint="≈30 recommended" />
                      <NumField label="Start Pulay at step" int min={1} value={o.scf.startPulay} onChange={(v) => patch("scf", { startPulay: v })} hint="10–30 for hard cases" />
                    </>
                  )}
                </div>
              </fieldset>

              <fieldset>
                <legend>Restart</legend>
                <SelectField
                  label="scf.restart"
                  value={o.scf.restart}
                  options={[
                    ["off", "off – start from atomic densities"],
                    ["on", "on – continue from restart files"],
                    ["pp", "pp – post-processing only (bands, DOS, ... from a converged SCF)"],
                    ["c2n", "c2n – collinear → noncollinear (MAE, second variational)"],
                  ]}
                  onChange={(v) => patch("scf", { restart: v })}
                />
                {o.scf.restart !== "off" && (
                  <div className="grid-2">
                    <label className="field">
                      <span>scf.restart.filename</span>
                      <input placeholder={o.systemName} value={o.scf.restartFile} onChange={(e) => patch("scf", { restartFile: e.target.value.trim() })} />
                      <small className="hint">System.Name of the run that wrote the restart files.</small>
                    </label>
                    {o.scf.restart === "c2n" && (
                      <>
                        <NumField label="Spin angle θ (deg)" value={o.scf.restartAngles[0]} onChange={(v) => patch("scf", { restartAngles: [v, o.scf.restartAngles[1]] })} />
                        <NumField label="Spin angle φ (deg)" value={o.scf.restartAngles[1]} onChange={(v) => patch("scf", { restartAngles: [o.scf.restartAngles[0], v] })} />
                      </>
                    )}
                  </div>
                )}
                {o.scf.restart === "c2n" && (
                  <p className="hint">
                    Run 1: collinear SCF (spin on) of the same System.Name. Run 2 (this file): one diagonalization with SOC for each
                    spin angle (θ, φ); compare <b>Uele</b>, not Utot. Use a low temperature and a dense k-grid.
                  </p>
                )}
              </fieldset>
            </>
          )}

          {tab === "output" && (
            <>
              <fieldset>
                <legend>Electronic structure</legend>
                <Toggle checked={o.band.enabled} onChange={(v) => patch("band", { enabled: v })} label="Band structure (§22)" hint="Band.dispersion along the seekpath high-symmetry path.">
                  {o.band.path ? (
                    <>
                      <p className="small">
                        Path <span className="mono">{pathString(o.band.path.segments)}</span>{" "}
                        <span className="muted">
                          ({o.band.path.bravais_lattice}, {o.band.path.spacegroup}, seekpath)
                        </span>
                      </p>
                      <NumField
                        label={`k-points per Å⁻¹ · ${o.band.path.segments.reduce((n, s) => n + segmentPoints(s.length, o.band.density), 0)} points in total`}
                        min={1}
                        value={o.band.density}
                        onChange={(v) => patch("band", { density: v })}
                      />
                    </>
                  ) : pathError ? (
                    <p className="warn small">Could not get a k-path: {pathError}</p>
                  ) : (
                    <p className="muted small">Finding the high-symmetry path…</p>
                  )}
                </Toggle>
                <Toggle
                  checked={o.dos.enabled}
                  onChange={(v) => patch("dos", { enabled: v })}
                  label="DOS / PDOS (§23)"
                  hint="Eigenvalues and eigenvectors for DosMain: total DOS and projected DOS per atom/orbital."
                >
                  <div className="grid-2">
                    <SelectField
                      label="Method"
                      value={o.dos.method}
                      options={[
                        ["tetrahedron", "Dos.fileout (tetrahedron + Gaussian in DosMain)"],
                        ["gaussian", "DosGauss.fileout (on-the-fly Gaussian, low memory)"],
                      ]}
                      onChange={(v) => patch("dos", { method: v })}
                    />
                    <Vec3Field label="DOS k-grid" int min={1} value={o.dos.kgrid} onChange={(v) => patch("dos", { kgrid: v })} />
                    <NumField label="E min (eV, from E_F)" value={o.dos.emin} onChange={(v) => patch("dos", { emin: v })} />
                    <NumField label="E max (eV)" value={o.dos.emax} onChange={(v) => patch("dos", { emax: v })} />
                    {o.dos.method === "gaussian" && (
                      <>
                        <NumField label="Energy mesh" int min={10} value={o.dos.mesh} onChange={(v) => patch("dos", { mesh: v })} />
                        <NumField label="Gaussian width (eV)" value={o.dos.width} onChange={(v) => patch("dos", { width: v })} />
                      </>
                    )}
                  </div>
                </Toggle>
                {!o.dos.enabled && dosNeeded(o) && <p className="hint">The DOS step is switched on because COHP, STM or Fermi-surface output needs it.</p>}
                <Toggle
                  checked={o.unfolding.enabled}
                  onChange={(v) => patch("unfolding", { enabled: v })}
                  label="Band unfolding (§55)"
                  hint="Spectral weight of a supercell (defects, doping, alloys) unfolded onto the input cell's Brillouin zone. Use a supercell in the Structure tab; the atom map is written automatically."
                >
                  <div className="grid-2">
                    <NumField label="Lower bound (eV)" value={o.unfolding.lower} onChange={(v) => patch("unfolding", { lower: v })} />
                    <NumField label="Upper bound (eV)" value={o.unfolding.upper} onChange={(v) => patch("unfolding", { upper: v })} />
                    <NumField label="Total k-points along the path" int min={2} value={o.unfolding.nk} onChange={(v) => patch("unfolding", { nk: v })} />
                  </div>
                </Toggle>
                <Toggle checked={o.fermiSurface} onChange={(v) => set("fermiSurface", v)} label="Fermi surface (§65)" hint="FermiSurfer (.frmsf) and XCrySDen (.bxsf) files; use a dense DOS k-grid." />
                <Toggle
                  checked={o.cohp.enabled}
                  onChange={(v) => patch("cohp", { enabled: v })}
                  label="COHP / COOP bonding analysis (§24)"
                  hint="Crystal orbital Hamilton/overlap populations of atom pairs."
                >
                  <label className="field">
                    <span>Pairs: atom1 atom2 l1 l2 l3 (one per line; l = cell of atom2)</span>
                    <textarea rows={3} className="mono" value={o.cohp.pairs} onChange={(e) => patch("cohp", { pairs: e.target.value })} />
                  </label>
                </Toggle>
                <Toggle
                  checked={o.optical.enabled}
                  onChange={(v) => patch("optical", { enabled: v })}
                  label="Optical conductivity & dielectric function (§62)"
                  hint="CDDF: σ(ω) and ε(ω) tensors from the Kubo-Greenwood formula."
                >
                  <div className="grid-2">
                    <NumField label="Lorentzian FWHM (eV)" value={o.optical.fwhm} onChange={(v) => patch("optical", { fwhm: v })} />
                    <NumField label="Max. energy (eV)" value={o.optical.emax} onChange={(v) => patch("optical", { emax: v })} />
                    <NumField label="Extra energy range (eV)" value={o.optical.extra} onChange={(v) => patch("optical", { extra: v })} />
                    <Vec3Field label="CDDF k-grid" int min={1} value={o.optical.kgrid} onChange={(v) => patch("optical", { kgrid: v })} />
                  </div>
                </Toggle>
              </fieldset>

              <fieldset>
                <legend>Real-space files</legend>
                <SelectField<0 | 1 | 2>
                  label="level.of.fileout"
                  value={o.fileout}
                  options={[
                    [0, "0 – minimal (no cube or grid files)"],
                    [1, "1 – standard: densities, potentials (.cube)"],
                    [2, "2 – standard + additional information"],
                  ]}
                  onChange={(v) => set("fileout", v)}
                />
                <Toggle checked={o.mo.enabled} onChange={(v) => patch("mo", { enabled: v })} label="HOMO / LUMO orbitals (§34)" hint="Cube files of the frontier orbitals (at Γ for crystals).">
                  <div className="grid-2">
                    <NumField label="HOMOs" int min={0} value={o.mo.homos} onChange={(v) => patch("mo", { homos: v })} />
                    <NumField label="LUMOs" int min={0} value={o.mo.lumos} onChange={(v) => patch("mo", { lumos: v })} />
                  </div>
                </Toggle>
                <Toggle
                  checked={o.partialCharge.enabled}
                  onChange={(v) => patch("partialCharge", { enabled: v })}
                  label="STM image / partial charge (§53)"
                  hint="Tersoff-Hamann partial density between E_F and E_F + window → System.Name.pden.cube."
                >
                  <NumField
                    label="Energy window (eV)"
                    value={o.partialCharge.window}
                    onChange={(v) => patch("partialCharge", { window: v })}
                    hint="Negative = occupied states (filled-state image), positive = empty states."
                  />
                </Toggle>
              </fieldset>

              <fieldset>
                <legend>Wannier functions</legend>
                <Toggle
                  checked={o.cwf.enabled}
                  onChange={(v) => {
                    const orbitals = { ...o.cwf.orbitals };
                    for (const el of elements) orbitals[el] ??= paoShells(o.species[el]?.pao ?? "").map(([l]) => l).filter((l) => l !== "f");
                    patch("cwf", { enabled: v, orbitals });
                  }}
                  label="Closest Wannier functions (CWF, §47.1)"
                  hint="Non-iterative Wannier functions closest to chosen PAOs: tight-binding Hamiltonian (CWF.Dis.vs.H) and interpolated bands."
                >
                  <div className="field">
                    <span>Guiding orbitals (first radial function of each l)</span>
                    <div className="mass-list">
                      {elements.map((el) => (
                        <span key={el} className="orb-pick">
                          <i>{el}</i>
                          {paoShells(o.species[el]?.pao ?? "").map(([l]) => {
                            const chosen = o.cwf.orbitals[el] ?? [];
                            return (
                              <label key={l} className="check">
                                <input
                                  type="checkbox"
                                  checked={chosen.includes(l)}
                                  onChange={(e) =>
                                    patch("cwf", {
                                      orbitals: { ...o.cwf.orbitals, [el]: e.target.checked ? [...chosen, l] : chosen.filter((x) => x !== l) },
                                    })
                                  }
                                />
                                {l}
                              </label>
                            );
                          })}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="grid-2">
                    <SelectField
                      label="Window function"
                      value={o.cwf.window}
                      options={[
                        ["Poly", "Poly – polynomial (smaller files)"],
                        ["Fermi", "Fermi"],
                      ]}
                      onChange={(v) => patch("cwf", { window: v })}
                    />
                  </div>
                  <div className="field">
                    <span>{o.cwf.window === "Poly" ? "Energy range ε0 ε1 ε2 ε3 (eV from E_F)" : "Energy range ε0 ε1 (eV) and kBT0 kBT1"}</span>
                    <div className="row quad">
                      {(o.cwf.window === "Poly" ? [0, 1, 2, 3] : [0, 1]).map((i) => (
                        <Num
                          key={i}
                          label={`CWF energy ${i}`}
                          value={o.cwf.erange[i]}
                          onChange={(v) => {
                            const erange = [...o.cwf.erange] as typeof o.cwf.erange;
                            erange[i] = v;
                            patch("cwf", { erange });
                          }}
                        />
                      ))}
                      {o.cwf.window === "Fermi" &&
                        [0, 1].map((i) => (
                          <Num
                            key={`t${i}`}
                            label={`CWF kBT ${i}`}
                            value={o.cwf.kbt[i]}
                            onChange={(v) => {
                              const kbt = [...o.cwf.kbt] as [number, number];
                              kbt[i] = v;
                              patch("cwf", { kbt });
                            }}
                          />
                        ))}
                    </div>
                    <small className="hint">Poly: weight 1 between ε1 and ε2, smoothly 0 below ε0 and above ε3.</small>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={o.cwf.wannier90} onChange={(e) => patch("cwf", { wannier90: e.target.checked })} />
                    Write Wannier90 files (amn, mmn, eig, win)
                  </label>
                </Toggle>
                <Toggle
                  checked={o.mlwf.enabled}
                  onChange={(v) => patch("mlwf", { enabled: v })}
                  label="Maximally localized Wannier functions (MLWF, §47.2)"
                  hint="Spread minimisation with disentanglement. Projector species projX (…-s1p1d1f1) are added automatically."
                >
                  <div className="field">
                    <span>Projectors per element (Wannier.Func.Num = {mlwfCount(crystal, o)})</span>
                    <div className="mass-list">
                      {elements.map((el) => (
                        <label key={el}>
                          <i>{el}</i>
                          <select
                            value={o.mlwf.projectors[el] ?? ""}
                            onChange={(e) => patch("mlwf", { projectors: { ...o.mlwf.projectors, [el]: e.target.value as Projector } })}
                          >
                            <option value="">none</option>
                            {(Object.keys(PROJECTOR_COUNT) as Exclude<Projector, "">[]).map((p) => (
                              <option key={p} value={p}>
                                {p} ({PROJECTOR_COUNT[p]})
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid-2">
                    <NumField label="Outer window bottom (eV)" value={o.mlwf.outer[0]} onChange={(v) => patch("mlwf", { outer: [v, o.mlwf.outer[1]] })} />
                    <NumField label="Outer window top (eV)" value={o.mlwf.outer[1]} onChange={(v) => patch("mlwf", { outer: [o.mlwf.outer[0], v] })} />
                    <NumField label="Inner window bottom (eV)" value={o.mlwf.inner[0]} onChange={(v) => patch("mlwf", { inner: [v, o.mlwf.inner[1]] })} />
                    <NumField
                      label="Inner window top (eV)"
                      value={o.mlwf.inner[1]}
                      onChange={(v) => patch("mlwf", { inner: [o.mlwf.inner[0], v] })}
                      hint="Equal bottom and top = no inner (frozen) window."
                    />
                    <Vec3Field label="Wannier.Kgrid" int min={1} value={o.mlwf.kgrid} onChange={(v) => patch("mlwf", { kgrid: v })} />
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={o.mlwf.wannier90} onChange={(e) => patch("mlwf", { wannier90: e.target.checked })} />
                    Write Wannier90 files (Wannier90.fileout)
                  </label>
                </Toggle>
              </fieldset>

              <fieldset>
                <legend>Charges, energies and post-processing</legend>
                <p className="hint">Mulliken charges and spin moments are always written to System.Name.out.</p>
                <Toggle checked={o.analysis.voronoi} onChange={(v) => patch("analysis", { voronoi: v })} label="Voronoi charges (§35.2)" />
                <Toggle
                  checked={o.analysis.energyDecomposition}
                  onChange={(v) => patch("analysis", { energyDecomposition: v })}
                  label="Energy decomposition (§25)"
                  hint="Total energy split into atomic and orbital contributions."
                />
                <Toggle
                  checked={o.analysis.nbo}
                  onChange={(v) => patch("analysis", { nbo: v })}
                  label="Natural bond orbitals / NAO (§36)"
                  hint="NBO.switch on1 with the Cluster solver, on2 with Krylov."
                />
                <Toggle
                  checked={o.analysis.hs}
                  onChange={(v) => patch("analysis", { hs: v })}
                  label="Hamiltonian & overlap file (HS.fileout)"
                  hint="System.Name.scfout for the post-processing codes: polB (Berry-phase polarization, Born charges), jx (exchange couplings J_ij), calB (Chern number, Berry curvature), Z2FH (Z2 invariant), kSpin (spin textures)."
                />
                <Toggle
                  checked={o.analysis.negfLead}
                  onChange={(v) => patch("analysis", { negfLead: v })}
                  label="NEGF electrode (lead) calculation (§46.2)"
                  hint="Step 1 of a transport calculation: writes System.Name.hks for the left/right lead. Transport is along a."
                />
                <p className="hint">
                  BoltzTraP/BoltzTraP2 (§63) only needs a converged SCF: run MX_TRAP.sh on System.Name.out afterwards.
                </p>
              </fieldset>
            </>
          )}
        </div>

        <div className="export-dialog__preview">
          <div className="omx-summary">
            <div className="omx-summary__chips">
              {active.map((a) => (
                <span key={a} className="chip">
                  {a}
                </span>
              ))}
            </div>
            {warnings.length > 0 && (
              <ul className="omx-warnings">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          <pre aria-label="File preview">{dat}</pre>
        </div>
      </div>

      <footer className="export-dialog__foot">
        {missing.length > 0 ? (
          <span className="warn small">Fill PAO, VPS and valence for {missing.join(", ")} (Structure & basis) to download.</span>
        ) : (
          <span className="muted small">
            Ready · {QUALITY_LABELS[prefs.quality]} basis · {lineCount} lines
          </span>
        )}
        <div className="row">
          <button type="button" onClick={copy} disabled={missing.length > 0}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="primary" onClick={download} disabled={missing.length > 0}>
            Download .dat
          </button>
        </div>
      </footer>
    </dialog>
  );
}

/** "G-X-U|K-G-L": consecutive segments are joined, jumps shown with "|". */
function pathString(segments: { from: string; to: string }[]): string {
  const greek = (l: string) => (l === "G" ? "Γ" : l);
  let out = "";
  segments.forEach((s, i) => {
    if (i === 0) out = greek(s.from);
    else if (segments[i - 1].to !== s.from) out += `|${greek(s.from)}`;
    out += `–${greek(s.to)}`;
  });
  return out;
}
