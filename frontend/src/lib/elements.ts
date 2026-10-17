// Element data: Jmol CPK colours and covalent radii in Å (Cordero et al. 2008).
// Generated from pymatgen's ElementColorSchemes.yaml and CovalentRadius tables.
// Format: "Symbol:hexcolour:radius", space separated, ordered by atomic number.
const TABLE =
  "H:ffffff:0.31 He:d9ffff:0.28 Li:cc80ff:1.28 Be:c2ff00:0.96 B:ffb5b5:0.84 C:909090:0.73 " +
  "N:3050f8:0.71 O:ff0d0d:0.66 F:90e050:0.57 Ne:b3e3f5:0.58 Na:ab5cf2:1.66 Mg:8aff00:1.41 " +
  "Al:bfa6a6:1.21 Si:f0c8a0:1.11 P:ff8000:1.07 S:ffff30:1.05 Cl:1ff01f:1.02 Ar:80d1e3:1.06 " +
  "K:8f40d4:2.03 Ca:3dff00:1.76 Sc:e6e6e6:1.70 Ti:bfc2c7:1.60 V:a6a6ab:1.53 Cr:8a99c7:1.39 " +
  "Mn:9c7ac7:1.50 Fe:e06633:1.42 Co:f090a0:1.38 Ni:50d050:1.24 Cu:c88033:1.32 " +
  "Zn:7d80b0:1.22 Ga:c28f8f:1.22 Ge:668f8f:1.20 As:bd80e3:1.19 Se:ffa100:1.20 " +
  "Br:a62929:1.20 Kr:5cb8d1:1.16 Rb:702eb0:2.20 Sr:00ff00:1.95 Y:94ffff:1.90 Zr:94e0e0:1.75 " +
  "Nb:73c2c9:1.64 Mo:54b5b5:1.54 Tc:3b9e9e:1.47 Ru:248f8f:1.46 Rh:0a7d8c:1.42 " +
  "Pd:006985:1.39 Ag:c0c0c0:1.45 Cd:ffd98f:1.44 In:a67573:1.42 Sn:668080:1.39 " +
  "Sb:9e63b5:1.39 Te:d47a00:1.38 I:940094:1.39 Xe:429eb0:1.40 Cs:57178f:2.44 Ba:00c900:2.15 " +
  "La:70d4ff:2.07 Ce:ffffc7:2.04 Pr:d9ffc7:2.03 Nd:c7ffc7:2.01 Pm:a3ffc7:1.99 " +
  "Sm:8fffc7:1.98 Eu:61ffc7:1.98 Gd:45ffc7:1.96 Tb:30ffc7:1.94 Dy:1fffc7:1.92 " +
  "Ho:00ff9c:1.92 Er:00e675:1.89 Tm:00d452:1.90 Yb:00bf38:1.87 Lu:00ab24:1.87 " +
  "Hf:4dc2ff:1.75 Ta:4da6ff:1.70 W:2194d6:1.62 Re:267dab:1.51 Os:266696:1.44 Ir:175487:1.41 " +
  "Pt:d0d0e0:1.36 Au:ffd123:1.36 Hg:b8b8d0:1.32 Tl:a6544d:1.45 Pb:575961:1.46 " +
  "Bi:9e4fb5:1.48 Po:ab5c00:1.40 At:754f45:1.50 Rn:428296:1.50 Fr:420066:2.60 " +
  "Ra:007d00:2.21 Ac:70abfa:2.15 Th:00baff:2.06 Pa:00a1ff:2.00 U:008fff:1.96 Np:0080ff:1.90 " +
  "Pu:006bff:1.87 Am:545cf2:1.80 Cm:785ce3:1.69 Bk:8a4fe3:1.50 Cf:a136d4:1.50 " +
  "Es:b31fd4:1.50 Fm:b31fba:1.50 Md:b30da6:1.50 No:bd0d87:1.50 Lr:c70066:1.50 " +
  "";

export interface ElementInfo {
  symbol: string;
  z: number;
  color: string;
  covalentRadius: number;
}

export const ELEMENTS: Record<string, ElementInfo> = {};
TABLE.trim()
  .split(/\s+/)
  .forEach((entry, i) => {
    const [symbol, color, radius] = entry.split(":");
    ELEMENTS[symbol] = { symbol, z: i + 1, color: `#${color}`, covalentRadius: Number(radius) };
  });

const UNKNOWN: Omit<ElementInfo, "symbol"> = { z: 0, color: "#ff1493", covalentRadius: 1.5 };

/** Normalise "fe", "FE", "Fe2+", "Fe1", "O1-" to an element symbol. */
export function normalizeSymbol(raw: string): string {
  const m = raw.trim().match(/^([A-Za-z]{1,2})/);
  if (!m) return raw;
  const two = m[1][0].toUpperCase() + (m[1][1] ?? "").toLowerCase();
  if (two.length === 2 && ELEMENTS[two]) return two;
  return m[1][0].toUpperCase();
}

export function elementInfo(symbol: string): ElementInfo {
  return ELEMENTS[symbol] ?? { symbol, ...UNKNOWN };
}

export function isElement(symbol: string): boolean {
  return symbol in ELEMENTS;
}
