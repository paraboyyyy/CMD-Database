import { useEffect, useMemo, useRef, useState } from "react";
import {
  type OpenmxOptions,
  type OpenmxSpecies,
  autoKgrid,
  defaultOptions,
  missingSpecies,
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

interface Props {
  crystal: Crystal;
  name: string;
  onClose: () => void;
}

export default function OpenmxExportDialog({ crystal, name, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const elements = useMemo(() => speciesOrder(crystal), [crystal]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [o, setO] = useState<OpenmxOptions>(() => {
    const saved = loadSpecies();
    const p = loadPrefs();
    const species = Object.fromEntries(elements.map((el) => [el, initialSpecies(el, p, saved)]));
    return { ...defaultOptions(crystal, name), species };
  });
  const [copied, setCopied] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const magnetic = spinKeyword(o) !== "off";

  // Fetch the high-symmetry path the first time band output is switched on.
  useEffect(() => {
    if (!o.band.enabled || o.band.path) return;
    let alive = true;
    setPathError(null);
    getKpath(crystal).then(
      (path) => alive && setO((p) => ({ ...p, band: { ...p.band, path } })),
      (e: Error) => alive && setPathError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [o.band.enabled, o.band.path, crystal]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const set = <K extends keyof OpenmxOptions>(key: K, value: OpenmxOptions[K]) => setO((p) => ({ ...p, [key]: value }));
  const setSpecies = (el: string, patch: Partial<OpenmxSpecies>) =>
    setO((p) => {
      const species = { ...p.species, [el]: { ...p.species[el], ...patch } };
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
    setO((p) => ({ ...p, repeat, kgrid: autoKgrid(crystal.lattice!, repeat) }));
  };
  const setK = (i: number, value: number) => {
    const kgrid = [...o.kgrid] as Vec3;
    kgrid[i] = Math.max(1, Math.round(value) || 1);
    set("kgrid", kgrid);
  };

  const dat = useMemo(() => writeOpenmxDat(crystal, o), [crystal, o]);
  const missing = missingSpecies(crystal, o.species);
  const natoms = crystal.atoms.length * o.repeat[0] * o.repeat[1] * o.repeat[2];
  const fileName = `${o.systemName || "structure"}.dat`;

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

  return (
    <dialog ref={ref} className="export-dialog" onClose={onClose} aria-labelledby="openmx-title">
      <header className="export-dialog__head">
        <div>
          <h2 id="openmx-title">Export OpenMX input</h2>
          <p className="muted small">
            {natoms} atoms · {elements.length} species · <span className="mono">{fileName}</span>
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}>
          ×
        </button>
      </header>

      <div className="export-dialog__body">
        <div className="export-dialog__form">
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
          </fieldset>

          <fieldset>
            <legend>Basis set (PAO) and pseudopotentials</legend>
            <div className="segmented quality" role="radiogroup" aria-label="Basis quality">
              {(Object.keys(QUALITY_LABELS) as BasisQuality[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  aria-pressed={prefs.quality === q}
                  onClick={() => applyPrefs({ ...prefs, quality: q })}
                >
                  {QUALITY_LABELS[q]}
                </button>
              ))}
            </div>
            <table className="species-table">
              <thead>
                <tr>
                  <th>El.</th>
                  <th>PAO</th>
                  <th>VPS</th>
                  <th>Valence e⁻</th>
                  {magnetic && <th title="Initial magnetic moment">μB</th>}
                </tr>
              </thead>
              <tbody>
                {elements.map((el) => {
                  const s = o.species[el];
                  const options = OPENMX_PAO_TABLE[el];
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
                        <input
                          aria-label={`${el} PAO`}
                          placeholder={`${el}7.0-s2p2d1`}
                          value={s.pao}
                          onChange={(e) => setSpecies(el, { pao: e.target.value.trim() })}
                        />
                      </td>
                      <td>
                        {options && options.length > 1 ? (
                          <select
                            aria-label={`${el} VPS`}
                            value={s.vps}
                            onChange={(e) => applyPrefs({ ...prefs, vps: { ...prefs.vps, [el]: e.target.value } })}
                          >
                            {options.map((opt) => (
                              <option key={opt.vps} value={opt.vps}>
                                {opt.vps} ({opt.valence} e⁻)
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label={`${el} VPS`}
                            placeholder={`${el}_PBE19`}
                            value={s.vps}
                            onChange={(e) => setSpecies(el, { vps: e.target.value.trim() })}
                          />
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
                          <input
                            aria-label={`${el} initial magnetic moment`}
                            type="number"
                            step={0.5}
                            value={o.moments[el] ?? 0}
                            onChange={(e) => set("moments", { ...o.moments, [el]: Number(e.target.value) || 0 })}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              Values follow the recommended PAO table of the OpenMX manual for DFT_DATA19 (H–Bi). For Fe, Co, Ni,
              Cu and Zn choose the hard (H) or soft (S) pseudopotential. Elements marked <i>manual</i> are not in
              the table: their entries are remembered in this browser.
            </p>
          </fieldset>

          <fieldset>
            <legend>Calculation</legend>
            <div className="grid-2">
              <label className="field">
                <span>Task</span>
                <select value={o.task} onChange={(e) => set("task", e.target.value as OpenmxOptions["task"])}>
                  <option value="scf">SCF (single point)</option>
                  <option value="opt">Geometry optimisation</option>
                </select>
              </label>
              <label className="field">
                <span>Exchange-correlation</span>
                <select value={o.xc} onChange={(e) => set("xc", e.target.value as OpenmxOptions["xc"])}>
                  <option value="GGA-PBE">GGA-PBE</option>
                  <option value="LDA">LDA</option>
                  <option value="LSDA-CA">LSDA-CA</option>
                  <option value="LSDA-PW">LSDA-PW</option>
                </select>
              </label>
              <label className="field">
                <span>Spin polarization</span>
                <select
                  value={o.soc ? "nc" : o.spin}
                  disabled={o.soc}
                  title={o.soc ? "Spin–orbit coupling needs noncollinear spin" : undefined}
                  onChange={(e) => set("spin", e.target.value as OpenmxOptions["spin"])}
                >
                  <option value="off">off</option>
                  <option value="on">on (collinear)</option>
                  <option value="nc">NC (noncollinear)</option>
                </select>
              </label>
              <label className="field">
                <span>Energy cutoff (Ry)</span>
                <input type="number" min={50} step={10} value={o.energyCutoff} onChange={(e) => set("energyCutoff", Number(e.target.value))} />
              </label>
              <div className="field">
                <span>k-grid</span>
                <div className="row triple">
                  {[0, 1, 2].map((i) => (
                    <input key={i} type="number" min={1} aria-label={`k${i + 1}`} value={o.kgrid[i]} onChange={(e) => setK(i, Number(e.target.value))} />
                  ))}
                </div>
              </div>
              <label className="field">
                <span>DATA.PATH</span>
                <input value={o.dataPath} onChange={(e) => set("dataPath", e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Electronic structure output</legend>

            <label className="check">
              <input type="checkbox" checked={o.dos.enabled} onChange={(e) => set("dos", { ...o.dos, enabled: e.target.checked })} />
              <b>DOS / PDOS</b>
            </label>
            {o.dos.enabled && (
              <div className="grid-2 indent">
                <div className="field">
                  <span>Energy range (eV, relative to E_F)</span>
                  <div className="row">
                    <input type="number" step={1} aria-label="DOS minimum energy" value={o.dos.emin} onChange={(e) => set("dos", { ...o.dos, emin: Number(e.target.value) })} />
                    <span>to</span>
                    <input type="number" step={1} aria-label="DOS maximum energy" value={o.dos.emax} onChange={(e) => set("dos", { ...o.dos, emax: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="field">
                  <span>DOS k-grid</span>
                  <div className="row triple">
                    {[0, 1, 2].map((i) => (
                      <input
                        key={i}
                        type="number"
                        min={1}
                        aria-label={`DOS k${i + 1}`}
                        value={o.dos.kgrid[i]}
                        onChange={(e) => {
                          const kgrid = [...o.dos.kgrid] as Vec3;
                          kgrid[i] = Math.max(1, Math.round(Number(e.target.value)) || 1);
                          set("dos", { ...o.dos, kgrid });
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <label className="check">
              <input type="checkbox" checked={o.band.enabled} onChange={(e) => set("band", { ...o.band, enabled: e.target.checked })} />
              <b>Band structure</b>
            </label>
            {o.band.enabled && (
              <div className="indent">
                {o.band.path ? (
                  <>
                    <p className="small">
                      Path <span className="mono">{pathString(o.band.path.segments)}</span>{" "}
                      <span className="muted">
                        ({o.band.path.bravais_lattice}, {o.band.path.spacegroup}, seekpath)
                      </span>
                    </p>
                    <label className="field">
                      <span>
                        k-points per Å⁻¹ ·{" "}
                        {o.band.path.segments.reduce((n, s) => n + segmentPoints(s.length, o.band.density), 0)} points in total
                      </span>
                      <input
                        type="number"
                        min={1}
                        step={5}
                        value={o.band.density}
                        onChange={(e) => set("band", { ...o.band, density: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </label>
                  </>
                ) : pathError ? (
                  <p className="warn small">Could not get a k-path: {pathError}</p>
                ) : (
                  <p className="muted small">Finding the high-symmetry path…</p>
                )}
              </div>
            )}

            <label className="check">
              <input type="checkbox" checked={o.soc} onChange={(e) => set("soc", e.target.checked)} />
              <b>Spin–orbit coupling</b>
            </label>
            {o.soc && (
              <p className="muted small indent">
                Uses <span className="mono">scf.SpinPolarization NC</span> and{" "}
                <span className="mono">scf.SpinOrbit.Coupling on</span>. SOC needs pseudopotentials with
                j-dependent (fully relativistic) parts, so check that your VPS files include them. Set initial
                moments in the species table for magnetic materials.
              </p>
            )}
          </fieldset>
        </div>

        <div className="export-dialog__preview">
          <pre aria-label="File preview">{dat}</pre>
        </div>
      </div>

      <footer className="export-dialog__foot">
        {missing.length > 0 ? (
          <span className="warn small">Fill PAO, VPS and valence for {missing.join(", ")} to download.</span>
        ) : (
          <span className="muted small">
            Ready · {QUALITY_LABELS[prefs.quality]} basis · DFT_DATA19 recommended PAOs
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
