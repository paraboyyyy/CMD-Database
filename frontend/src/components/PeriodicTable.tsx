import { type CSSProperties, type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { type ElementCounts, getElementCounts } from "../api";
import { CATEGORY_LABELS, ELEMENT_DETAILS, type ElementCategory, type ElementDetails, periodicPosition } from "../lib/elementDetails";

const PLACED = ELEMENT_DETAILS.map((e) => ({ ...e, pos: periodicPosition(e.z) }));
const AT = new Map(PLACED.map((e) => [`${e.pos[0]},${e.pos[1]}`, e]));
const CATEGORIES = Object.keys(CATEGORY_LABELS) as ElementCategory[];

export type ElementState = "include" | "exclude" | undefined;
type ColorMode = "category" | "heatmap";

interface Props {
  included: string[];
  excluded: string[];
  onChange: (included: string[], excluded: string[]) => void;
}

const compact = (n: number) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function PeriodicTable({ included, excluded, onChange }: Props) {
  const [mode, setMode] = useState<ColorMode>("category");
  const [hovered, setHovered] = useState<ElementDetails | null>(null);
  const [highlight, setHighlight] = useState<ElementCategory | null>(null);
  const [counts, setCounts] = useState<ElementCounts | null>(null);
  const [all, setAll] = useState<ElementCounts | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Counts among materials that contain every included element ("what can I add next?").
  const withKey = [...included].sort().join(",");
  useEffect(() => {
    let alive = true;
    getElementCounts(withKey).then((c) => alive && setCounts(c), () => alive && setCounts(null));
    return () => {
      alive = false;
    };
  }, [withKey]);
  useEffect(() => {
    getElementCounts("").then(setAll, () => setAll(null));
  }, []);

  const maxLog = useMemo(() => {
    const values = Object.entries(counts?.counts ?? {})
      .filter(([el]) => !included.includes(el))
      .map(([, n]) => n);
    return Math.log1p(Math.max(1, ...values));
  }, [counts, included]);

  const stateOf = (el: string): ElementState =>
    included.includes(el) ? "include" : excluded.includes(el) ? "exclude" : undefined;

  const setState = (el: string, next: ElementState) => {
    const inc = included.filter((x) => x !== el);
    const exc = excluded.filter((x) => x !== el);
    if (next === "include") inc.push(el);
    if (next === "exclude") exc.push(el);
    onChange(inc, exc);
  };

  // Click cycles off → include → exclude → off. Shift-click or right-click excludes directly.
  const onClick = (e: MouseEvent, el: string) => {
    const s = stateOf(el);
    if (e.shiftKey) setState(el, s === "exclude" ? undefined : "exclude");
    else setState(el, s === undefined ? "include" : s === "include" ? "exclude" : undefined);
  };
  const onContextMenu = (e: MouseEvent, el: string) => {
    e.preventDefault();
    setState(el, stateOf(el) === "exclude" ? undefined : "exclude");
  };

  // Arrow keys move between elements like cells of a table.
  const onKeyDown = (e: KeyboardEvent, el: (typeof PLACED)[number]) => {
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    let [r, c] = el.pos;
    for (let i = 0; i < 18; i++) {
      r += step[0];
      c += step[1];
      if (r === 8) r += step[0]; // skip the spacer row
      if (r < 1 || r > 10 || c < 1 || c > 18) return;
      const next = AT.get(`${r},${c}`);
      if (next) {
        gridRef.current?.querySelector<HTMLButtonElement>(`[data-el="${next.symbol}"]`)?.focus();
        return;
      }
    }
  };

  const countFor = (el: string) => counts?.counts[el] ?? 0;
  const loaded = counts !== null;

  return (
    <div className="pt">
      <div className="pt__bar">
        <div className="segmented" role="radiogroup" aria-label="Color elements by">
          <button type="button" aria-pressed={mode === "category"} onClick={() => setMode("category")}>
            Category
          </button>
          <button type="button" aria-pressed={mode === "heatmap"} onClick={() => setMode("heatmap")}>
            Materials count
          </button>
        </div>
        <span className="muted small pt__help">
          Click to include · click again to exclude · right-click or shift-click to exclude directly
        </span>
      </div>

      <div className="pt__scroll">
        <div
          ref={gridRef}
          className={`pt__grid pt--${mode} ${highlight ? "pt--highlighting" : ""}`}
          onMouseLeave={() => setHovered(null)}
        >
          <InfoCard
            element={hovered}
            state={hovered ? stateOf(hovered.symbol) : undefined}
            count={hovered ? countFor(hovered.symbol) : 0}
            allCount={hovered ? (all?.counts[hovered.symbol] ?? 0) : 0}
            total={all?.total ?? null}
            withSelection={included.length > 0 ? (counts?.total ?? null) : null}
            included={included}
          />

          {PLACED.map((e) => {
            const state = stateOf(e.symbol);
            const n = countFor(e.symbol);
            const heat = loaded && !state ? Math.log1p(n) / maxLog : 0;
            const empty = loaded && n === 0 && !state;
            const style = {
              gridRow: e.pos[0],
              gridColumn: e.pos[1],
              "--cat": `var(--cat-${e.category})`,
              "--h": heat.toFixed(3),
            } as CSSProperties;
            return (
              <button
                key={e.symbol}
                type="button"
                data-el={e.symbol}
                className={[
                  "pt__el",
                  state ? `is-${state}` : "",
                  empty ? "is-empty" : "",
                  heat > 0.62 ? "is-hot" : "",
                  highlight === e.category ? "is-highlighted" : "",
                ].join(" ")}
                style={style}
                aria-pressed={state === "include" ? true : state === "exclude" ? "mixed" : false}
                aria-label={`${e.name}, ${loaded ? `${n} materials` : ""}${state ? `, ${state}d` : ""}`}
                onClick={(ev) => onClick(ev, e.symbol)}
                onContextMenu={(ev) => onContextMenu(ev, e.symbol)}
                onMouseEnter={() => setHovered(e)}
                onFocus={() => setHovered(e)}
                onKeyDown={(ev) => onKeyDown(ev, e)}
              >
                <span className="pt__z">{e.z}</span>
                <span className="pt__sym">{e.symbol}</span>
                <span className="pt__count">{loaded && n > 0 ? compact(n) : " "}</span>
              </button>
            );
          })}

          <div className="pt__series" style={{ gridRow: 6, gridColumn: 3, "--cat": "var(--cat-lanthanide)" } as CSSProperties}>
            57–71
          </div>
          <div className="pt__series" style={{ gridRow: 7, gridColumn: 3, "--cat": "var(--cat-actinide)" } as CSSProperties}>
            89–103
          </div>
          <div className="pt__spacer" style={{ gridRow: 8, gridColumn: "1 / -1" }} />
        </div>
      </div>

      {mode === "category" ? (
        <div className="pt__legend" onMouseLeave={() => setHighlight(null)}>
          {CATEGORIES.map((c) => (
            <span
              key={c}
              className="pt__legend-item"
              style={{ "--cat": `var(--cat-${c})` } as CSSProperties}
              onMouseEnter={() => setHighlight(c)}
            >
              <i />
              {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>
      ) : (
        <div className="pt__legend">
          <span className="muted small">
            {included.length ? `Materials that also contain ${included.join(", ")}` : "Materials containing each element"}
          </span>
          <span className="pt__ramp" aria-hidden="true">
            <span>1</span>
            <i />
            <span>{loaded ? compact(Math.round(Math.expm1(maxLog))) : ""}</span>
          </span>
          <span className="muted small">log scale</span>
        </div>
      )}
    </div>
  );
}

function InfoCard({
  element,
  state,
  count,
  allCount,
  total,
  withSelection,
  included,
}: {
  element: ElementDetails | null;
  state: ElementState;
  count: number;
  allCount: number;
  total: number | null;
  withSelection: number | null;
  included: string[];
}) {
  if (!element) {
    return (
      <div className="pt__info pt__info--idle" style={{ gridRow: "1 / 4", gridColumn: "3 / 13" }}>
        <div>
          <div className="pt__info-title">Explore by element</div>
          <p className="muted small">
            Hover an element for its properties and how many materials contain it. Pick elements to filter the
            results below.
          </p>
        </div>
        <div className="pt__info-stats">
          <div>
            <b>{total === null ? "…" : total.toLocaleString()}</b>
            <span className="muted small">materials</span>
          </div>
          {withSelection !== null && (
            <div>
              <b>{withSelection.toLocaleString()}</b>
              <span className="muted small">with {included.join(", ")}</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  const e = element;
  return (
    <div
      className="pt__info"
      style={{ gridRow: "1 / 4", gridColumn: "3 / 13", "--cat": `var(--cat-${e.category})` } as CSSProperties}
      aria-live="polite"
    >
      <div className="pt__info-tile">
        <span className="pt__z">{e.z}</span>
        <span className="pt__info-sym">{e.symbol}</span>
        <span className="pt__info-mass">{e.mass.toFixed(3)}</span>
      </div>
      <div className="pt__info-body">
        <div className="pt__info-title">
          {e.name}
          {state && <span className={`pt__chip is-${state}`}>{state === "include" ? "included" : "excluded"}</span>}
        </div>
        <div className="pt__info-cat">{CATEGORY_LABELS[e.category]}</div>
        <dl>
          <dt>Atomic number</dt>
          <dd>{e.z}</dd>
          <dt>Atomic mass</dt>
          <dd>{e.mass.toFixed(3)} u</dd>
          <dt>Electronegativity</dt>
          <dd>{e.electronegativity?.toFixed(2) ?? "—"}</dd>
        </dl>
      </div>
      <div className="pt__info-stats">
        <div>
          <b>{allCount.toLocaleString()}</b>
          <span className="muted small">materials with {e.symbol}</span>
        </div>
        {included.length > 0 && !included.includes(e.symbol) && (
          <div>
            <b>{count.toLocaleString()}</b>
            <span className="muted small">
              with {[...included, e.symbol].join(", ")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
