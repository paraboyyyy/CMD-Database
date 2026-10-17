import type { CSSProperties } from "react";
import { ELEMENT_DETAILS, periodicPosition } from "../lib/elementDetails";
import { elementInfo } from "../lib/elements";
import { ELEMENT_MIME } from "../viewer/StructureViewer";

interface Props {
  brush: string | null;
  onBrush: (element: string | null) => void;
  /** True when editing a space group other than P1: edits apply to whole symmetry orbits. */
  symmetric?: boolean;
}

/** Compact periodic table whose elements can be dragged onto the 3D editor or picked as a brush. */
export default function ElementPalette({ brush, onBrush, symmetric = false }: Props) {
  return (
    <div className="palette">
      <div className="palette__grid" role="group" aria-label="Elements to place">
        {ELEMENT_DETAILS.map((e) => {
          const [row, col] = periodicPosition(e.z);
          const on = brush === e.symbol;
          return (
            <button
              key={e.symbol}
              type="button"
              draggable
              className={`palette__el ${on ? "is-on" : ""}`}
              style={{ gridRow: row, gridColumn: col, "--cat": `var(--cat-${e.category})`, "--atom": elementInfo(e.symbol).color } as CSSProperties}
              title={`${e.name}: drag onto the structure, or click to place by clicking`}
              aria-pressed={on}
              onClick={() => onBrush(on ? null : e.symbol)}
              onDragStart={(ev) => {
                ev.dataTransfer.setData(ELEMENT_MIME, e.symbol);
                ev.dataTransfer.setData("text/plain", e.symbol);
                ev.dataTransfer.effectAllowed = "copy";
              }}
            >
              {e.symbol}
            </button>
          );
        })}
        <div className="palette__gap" style={{ gridRow: 8, gridColumn: "1 / -1" }} />
      </div>
      <p className="muted small palette__help">
        {brush ? (
          <>
            Placing <b>{brush}</b>: click empty space to add, click an atom to replace it.{" "}
            <button type="button" className="link" onClick={() => onBrush(null)}>
              Stop
            </button>
          </>
        ) : (
          "Drag an element onto empty space to add an atom, or onto an atom to replace it. Or click an element, then click in the view."
        )}
      </p>
      {symmetric && (
        <p className="muted small palette__help">
          Space-group mode: moving or replacing an atom changes all of its symmetry copies. Use <i>Expand to P1</i>{" "}
          to edit single atoms.
        </p>
      )}
    </div>
  );
}
