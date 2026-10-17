import { useEffect, useMemo, useRef, useState } from "react";
import {
  type OpenmxOptions,
  type OpenmxSpecies,
  autoKgrid,
  defaultOptions,
  missingSpecies,
  speciesOrder,
  writeOpenmxDat,
} from "../lib/openmx";
import type { Crystal, Vec3 } from "../lib/structure";

const SPECIES_KEY = "cmd-openmx-species";

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
  const [o, setO] = useState<OpenmxOptions>(() => {
    const saved = loadSpecies();
    const species = Object.fromEntries(elements.map((el) => [el, saved[el] ?? { pao: "", vps: "", valence: null }]));
    return { ...defaultOptions(crystal, name), species };
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const set = <K extends keyof OpenmxOptions>(key: K, value: OpenmxOptions[K]) => setO((p) => ({ ...p, [key]: value }));
  const setSpecies = (el: string, patch: Partial<OpenmxSpecies>) =>
    setO((p) => {
      const species = { ...p.species, [el]: { ...p.species[el], ...patch } };
      saveSpecies({ [el]: species[el] });
      return { ...p, species };
    });
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
            <legend>Species (from your DFT_DATA folder)</legend>
            <table className="species-table">
              <thead>
                <tr>
                  <th>El.</th>
                  <th>PAO</th>
                  <th>VPS</th>
                  <th>Valence e⁻</th>
                </tr>
              </thead>
              <tbody>
                {elements.map((el) => {
                  const s = o.species[el];
                  return (
                    <tr key={el} className={missing.includes(el) ? "is-missing" : ""}>
                      <th>{el}</th>
                      <td>
                        <input
                          aria-label={`${el} PAO`}
                          placeholder={`${el}7.0-s2p2d1`}
                          value={s.pao}
                          onChange={(e) => setSpecies(el, { pao: e.target.value.trim() })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${el} VPS`}
                          placeholder={`${el}_PBE19`}
                          value={s.vps}
                          onChange={(e) => setSpecies(el, { vps: e.target.value.trim() })}
                        />
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              Valence electrons are the <span className="mono">valence.electron</span> value in the .vps file, e.g.{" "}
              <span className="mono">grep valence.electron DFT_DATA19/VPS/{elements[0]}_PBE19.vps</span>. Entries are
              remembered in this browser.
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
                <select value={o.spin} onChange={(e) => set("spin", e.target.value as OpenmxOptions["spin"])}>
                  <option value="off">off</option>
                  <option value="on">on (collinear)</option>
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
        </div>

        <div className="export-dialog__preview">
          <pre aria-label="File preview">{dat}</pre>
        </div>
      </div>

      <footer className="export-dialog__foot">
        {missing.length > 0 ? (
          <span className="warn small">Fill PAO, VPS and valence for {missing.join(", ")} to download.</span>
        ) : (
          <span className="muted small">Ready. Check the species names against your DFT_DATA version.</span>
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
