import { type DragEvent, useRef, useState } from "react";
import { type SymmetryResult, findSymmetry } from "../api";
import { SpaceGroup } from "../components/Formula";
import { ACCEPTED_FILES, parseStructureFile } from "../lib/parsers";
import { type Crystal, formula, latticeParams } from "../lib/structure";
import StructureViewer from "../viewer/StructureViewer";

// Bundled demo files from data/samples (loaded on demand).
const SAMPLES = import.meta.glob("../../../data/samples/*.{cif,xyz}", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;
const sampleName = (path: string) => path.split("/").pop()!;

interface Loaded {
  name: string;
  text: string;
  frames: Crystal[];
}

export default function ViewerPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [symmetry, setSymmetry] = useState<SymmetryResult | string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = (text: string, name: string) => {
    setSymmetry(null);
    try {
      setLoaded({ name, text, frames: parseStructureFile(text, name) });
      setError(null);
    } catch (e) {
      setError(`${name}: ${(e as Error).message}`);
    }
  };

  const openFile = async (file: File | undefined) => {
    if (file) open(await file.text(), file.name);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void openFile(e.dataTransfer.files[0]);
  };

  const analyze = async () => {
    if (!loaded) return;
    setSymmetry("Analyzing…");
    try {
      setSymmetry(await findSymmetry(loaded.frames[0]));
    } catch (e) {
      setSymmetry((e as Error).message);
    }
  };

  const first = loaded?.frames[0];
  const params = first?.lattice ? latticeParams(first.lattice) : null;

  return (
    <div
      className={`page viewer-page ${dragging ? "is-dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="viewer-head">
        <div>
          <h1>Structure viewer</h1>
          <p className="muted">
            Open CIF, POSCAR/CONTCAR, XYZ (including multi-frame trajectories) or pymatgen JSON. Files are read in
            your browser and are not uploaded.
          </p>
        </div>
        <div className="row wrap">
          <button type="button" className="primary" onClick={() => inputRef.current?.click()}>
            Open file…
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FILES}
            hidden
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <select
            value=""
            aria-label="Open a sample"
            onChange={async (e) => {
              const path = e.target.value;
              if (path) open(await SAMPLES[path](), sampleName(path));
            }}
          >
            <option value="">Open a sample…</option>
            {Object.keys(SAMPLES)
              .sort()
              .map((p) => (
                <option key={p} value={p}>
                  {sampleName(p)}
                </option>
              ))}
          </select>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {loaded ? (
        <>
          <div className="fileinfo">
            <b>{loaded.name}</b>
            <span>{formula(first!.atoms)}</span>
            <span>{first!.atoms.length} atoms</span>
            {loaded.frames.length > 1 && <span>{loaded.frames.length} frames</span>}
            {params && (
              <span className="mono">
                a={params.a.toFixed(3)} b={params.b.toFixed(3)} c={params.c.toFixed(3)} Å · α={params.alpha.toFixed(1)}° β=
                {params.beta.toFixed(1)}° γ={params.gamma.toFixed(1)}°
              </span>
            )}
            {first!.lattice && loaded.frames.length === 1 && (
              <button type="button" onClick={analyze}>
                Find space group
              </button>
            )}
            {symmetry && typeof symmetry !== "string" && (
              <span className="badge">
                <SpaceGroup symbol={symmetry.spacegroup_symbol} /> ({symmetry.spacegroup_number}) · {symmetry.crystal_system}
              </span>
            )}
            {typeof symmetry === "string" && <span className="muted small">{symmetry}</span>}
          </div>
          <StructureViewer key={loaded.name + loaded.text.length} frames={loaded.frames} name={loaded.name.replace(/\.[^.]+$/, "")} />
        </>
      ) : (
        <button type="button" className="dropzone" onClick={() => inputRef.current?.click()}>
          <span className="dropzone__title">Drop a structure file here</span>
          <span className="muted">or click to choose a file, or open one of the samples above</span>
        </button>
      )}
    </div>
  );
}
