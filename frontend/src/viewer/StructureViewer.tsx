import { useEffect, useMemo, useRef, useState } from "react";
import { elementInfo } from "../lib/elements";
import { onThemeChange } from "../lib/theme";
import { type Crystal, type DisplayAtom, type Vec3, cartToFrac, formula } from "../lib/structure";
import { type AtomStyle, CrystalScene, DEFAULT_OPTIONS, type SceneColors, type ViewOptions } from "./CrystalScene";
import { angle, dihedral, distance } from "./measure";

export const ELEMENT_MIME = "application/x-cmd-element";

/** Callbacks that turn the viewer into an editor (used by the builder). Indices are crystal atoms. */
export interface StructureEditor {
  onMove: (atom: number, delta: Vec3) => void;
  onDrop: (element: string, atom: number | null, cart: Vec3) => void;
  onRemove: (atoms: number[]) => void;
  /** Element placed by clicking empty space (or applied to a clicked atom). */
  brush: string | null;
}

interface Props {
  frames: Crystal[];
  /** Used for the PNG file name. */
  name?: string;
  compact?: boolean;
  /** Keep the camera when `frames` changes (live editing). Remount with a new key to re-frame. */
  preserveView?: boolean;
  editor?: StructureEditor;
}

function readColors(): SceneColors {
  const css = getComputedStyle(document.documentElement);
  return {
    background: css.getPropertyValue("--viewer-bg").trim() || "#ffffff",
    cell: css.getPropertyValue("--viewer-cell").trim() || "#444444",
    label: css.getPropertyValue("--text").trim() || "#111111",
  };
}

export default function StructureViewer({ frames, name = "structure", compact = false, preserveView = false, editor }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CrystalScene | null>(null);
  const [options, setOptions] = useState<ViewOptions>(DEFAULT_OPTIONS);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<DisplayAtom[]>([]);
  const [error, setError] = useState<string | null>(null);

  const crystal = frames[Math.min(frame, frames.length - 1)] ?? null;
  const periodic = !!crystal?.lattice;

  useEffect(() => {
    if (!hostRef.current) return;
    let scene: CrystalScene;
    try {
      scene = new CrystalScene(hostRef.current);
    } catch {
      setError("WebGL is not available in this browser, so the 3D view cannot be shown.");
      return;
    }
    scene.onSelect = setSelection;
    scene.setColors(readColors());
    sceneRef.current = scene;
    const stopWatching = onThemeChange(() => scene.setColors(readColors()));
    return () => {
      stopWatching();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Keep the latest editor callbacks without re-binding the scene.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.editable = !!editor;
    scene.onAtomDrag = (atom, delta) => editorRef.current?.onMove(atom, delta);
    scene.onBackgroundClick = (cart) => {
      const ed = editorRef.current;
      if (ed?.brush) ed.onDrop(ed.brush, null, cart);
    };
    scene.onAtomClick = (atom) => {
      const ed = editorRef.current;
      if (ed?.brush) ed.onDrop(ed.brush, atom, [0, 0, 0]);
    };
  }, [!!editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const dropElement = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const el = e.dataTransfer.getData(ELEMENT_MIME);
    const scene = sceneRef.current;
    if (!el || !scene || !editor) return;
    editor.onDrop(el, scene.pickAtom(e.clientX, e.clientY), scene.pointOnViewPlane(e.clientX, e.clientY));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editor || !selection.length || (e.key !== "Delete" && e.key !== "Backspace")) return;
    e.preventDefault();
    editor.onRemove([...new Set(selection.map((a) => a.index))]);
    sceneRef.current?.clearSelection();
  };

  // Re-frame the camera for a new file; keep the view while stepping through frames.
  // Parents give each file its own `key`, so frame/playing state resets with it.
  const shownFrames = useRef<Crystal[] | null>(null);
  useEffect(() => {
    const keepView = shownFrames.current === frames || (preserveView && shownFrames.current !== null);
    shownFrames.current = frames;
    sceneRef.current?.setStructure(crystal, keepView);
  }, [frames, crystal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => sceneRef.current?.setOptions(options), [options]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % frames.length), 120);
    return () => window.clearInterval(id);
  }, [playing, frames.length]);

  const set = <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  const setRepeat = (axis: number, value: number) => {
    const repeat = [...options.repeat] as ViewOptions["repeat"];
    repeat[axis] = Math.min(Math.max(Math.round(value) || 1, 1), 8);
    set("repeat", repeat);
  };

  const savePNG = () => {
    const url = sceneRef.current?.toPNG();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.png`;
    a.click();
  };

  const legend = useMemo(() => {
    if (!crystal) return [];
    return [...new Set(crystal.atoms.map((a) => a.element))].sort(
      (x, y) => elementInfo(x).z - elementInfo(y).z,
    );
  }, [crystal]);

  return (
    <div className={`viewer ${compact ? "viewer--compact" : ""}`}>
      <div
        className={`viewer__stage ${editor ? "is-editing" : ""} ${dropping ? "is-drop-target" : ""}`}
        tabIndex={editor ? 0 : undefined}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (!editor || !e.dataTransfer.types.includes(ELEMENT_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={dropElement}
      >
        <div ref={hostRef} className="viewer__canvas" aria-label="3D structure view" />
        {error && <div className="viewer__error">{error}</div>}
        {crystal && (
          <div className="viewer__legend">
            {legend.map((el) => (
              <span key={el} className="legend-item">
                <span className="legend-dot" style={{ background: elementInfo(el).color }} />
                {el}
              </span>
            ))}
          </div>
        )}
        <div className="viewer__hint">
          {editor
            ? `Drag atoms to move · drag empty space to rotate · drop elements here${editor.brush ? ` · click to place ${editor.brush}` : ""} · select + Delete to remove`
            : "Drag to rotate · right-drag to pan · scroll to zoom · click atoms to measure"}
        </div>
      </div>

      <div className="viewer__panel">
        {frames.length > 1 && (
          <fieldset>
            <legend>
              Frame {frame + 1} / {frames.length}
            </legend>
            <div className="row">
              <button type="button" onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                min={0}
                max={frames.length - 1}
                value={frame}
                onChange={(e) => {
                  setPlaying(false);
                  setFrame(Number(e.target.value));
                }}
                aria-label="Frame"
              />
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Style</legend>
          <select value={options.style} onChange={(e) => set("style", e.target.value as AtomStyle)}>
            <option value="ball-stick">Ball and stick</option>
            <option value="spacefill">Space filling</option>
            <option value="stick">Stick</option>
            <option value="wireframe">Wireframe</option>
          </select>
          <label className="slider">
            Atom size
            <input
              type="range"
              min={0.3}
              max={2}
              step={0.05}
              value={options.atomScale}
              onChange={(e) => set("atomScale", Number(e.target.value))}
            />
          </label>
          <label className="slider">
            Bond cutoff ×{options.bondTolerance.toFixed(2)}
            <input
              type="range"
              min={0.8}
              max={1.6}
              step={0.01}
              value={options.bondTolerance}
              onChange={(e) => set("bondTolerance", Number(e.target.value))}
            />
          </label>
        </fieldset>

        {periodic && (
          <fieldset>
            <legend>Supercell</legend>
            <div className="row repeat">
              {["a", "b", "c"].map((axis, i) => (
                <label key={axis}>
                  {axis}
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={options.repeat[i]}
                    onChange={(e) => setRepeat(i, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Show</legend>
          <div className="checks">
            <Check label="Bonds" value={options.showBonds} onChange={(v) => set("showBonds", v)} />
            {periodic && <Check label="Unit cell" value={options.showCell} onChange={(v) => set("showCell", v)} />}
            {periodic && (
              <Check label="Boundary atoms" value={options.boundary} onChange={(v) => set("boundary", v)} />
            )}
            <Check label="Labels" value={options.showLabels} onChange={(v) => set("showLabels", v)} />
            <Check label="Axes" value={options.showAxes} onChange={(v) => set("showAxes", v)} />
            <Check label="Orthographic" value={options.orthographic} onChange={(v) => set("orthographic", v)} />
          </div>
        </fieldset>

        <fieldset>
          <legend>View</legend>
          <div className="row">
            {(periodic ? ["a", "b", "c"] : ["x", "y", "z"]).map((axis, i) => (
              <button key={axis} type="button" onClick={() => sceneRef.current?.viewAlong(i as 0 | 1 | 2)}>
                along {axis}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" onClick={() => sceneRef.current?.resetView()}>
              Reset
            </button>
            <button type="button" onClick={savePNG}>
              Save PNG
            </button>
          </div>
        </fieldset>

        {crystal && <Measurements crystal={crystal} selection={selection} onClear={() => sceneRef.current?.clearSelection()} />}
      </div>
    </div>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Measurements({ crystal, selection, onClear }: { crystal: Crystal; selection: DisplayAtom[]; onClear: () => void }) {
  if (!selection.length) {
    return (
      <fieldset>
        <legend>Selection</legend>
        <p className="muted small">
          {formula(crystal.atoms)} · {crystal.atoms.length} atoms. Click atoms to see coordinates, distances and
          angles.
        </p>
      </fieldset>
    );
  }
  const p = selection.map((a) => a.cart);
  const tag = (a: DisplayAtom) => `${a.element}${a.index + 1}`;
  const fmt = (v: number[]) => v.map((x) => x.toFixed(4)).join(", ");
  return (
    <fieldset>
      <legend>Selection</legend>
      <ul className="measure">
        {selection.map((a, k) => (
          <li key={k}>
            <b>{tag(a)}</b>{" "}
            <span className="mono small">
              {crystal.lattice ? `frac (${fmt(cartToFrac(a.cart, crystal.lattice))})` : `(${fmt(a.cart)}) Å`}
            </span>
          </li>
        ))}
        {p.length >= 2 && (
          <li>
            d({tag(selection[0])}–{tag(selection[1])}) = <b>{distance(p[0], p[1]).toFixed(4)} Å</b>
          </li>
        )}
        {p.length >= 3 && (
          <li>
            ∠ = <b>{angle(p[0], p[1], p[2]).toFixed(2)}°</b>
          </li>
        )}
        {p.length >= 4 && (
          <li>
            dihedral = <b>{dihedral(p[0], p[1], p[2], p[3]).toFixed(2)}°</b>
          </li>
        )}
      </ul>
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </fieldset>
  );
}
