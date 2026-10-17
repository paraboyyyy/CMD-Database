import { ELEMENTS } from "../lib/elements";

// [period row, group column] for Z = 1..103; lanthanides/actinides sit in rows 9 and 10.
function position(z: number): [number, number] {
  if (z === 1) return [1, 1];
  if (z === 2) return [1, 18];
  if (z <= 10) return [2, z <= 4 ? z - 2 : z + 8];
  if (z <= 18) return [3, z <= 12 ? z - 10 : z];
  if (z <= 36) return [4, z - 18];
  if (z <= 54) return [5, z - 36];
  if (z >= 57 && z <= 71) return [9, z - 54];
  if (z >= 89 && z <= 103) return [10, z - 86];
  if (z <= 56) return [6, z - 54];
  if (z <= 86) return [6, z - 68];
  return [7, z - 86];
}

interface Props {
  selected: string[];
  onToggle: (symbol: string) => void;
}

export default function PeriodicTable({ selected, onToggle }: Props) {
  const elements = Object.values(ELEMENTS).filter((e) => e.z <= 103);
  return (
    <div className="ptable" role="group" aria-label="Periodic table">
      {elements.map((e) => {
        const [row, col] = position(e.z);
        const on = selected.includes(e.symbol);
        return (
          <button
            key={e.symbol}
            type="button"
            className={`ptable__el ${on ? "is-on" : ""}`}
            style={{ gridRow: row, gridColumn: col, ["--el" as string]: e.color }}
            aria-pressed={on}
            title={`${e.symbol} (Z=${e.z})`}
            onClick={() => onToggle(e.symbol)}
          >
            {e.symbol}
          </button>
        );
      })}
      <div className="ptable__gap" style={{ gridRow: 8, gridColumn: "1 / -1" }} />
    </div>
  );
}
