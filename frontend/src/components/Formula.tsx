/** Render "Fe2O3" with subscript counts. */
export function Formula({ value }: { value: string }) {
  const parts = value.split(/(\d+(?:\.\d+)?)/);
  return <span className="formula">{parts.map((p, i) => (i % 2 ? <sub key={i}>{p}</sub> : p))}</span>;
}

/** Render Hermann–Mauguin symbols: "P4_2/mnm" → P4₂/mnm, "R-3c" → R3̄c. */
export function SpaceGroup({ symbol }: { symbol: string }) {
  const parts = symbol.match(/-\d|\d_\d|./g) ?? [];
  return (
    <span className="spacegroup">
      {parts.map((p, i) =>
        p.startsWith("-") ? (
          <span key={i} className="overline">{p[1]}</span>
        ) : p.includes("_") ? (
          <span key={i}>
            {p[0]}
            <sub>{p[2]}</sub>
          </span>
        ) : (
          p
        ),
      )}
    </span>
  );
}
