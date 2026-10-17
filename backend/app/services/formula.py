"""Chemical formula parsing without pymatgen (the API must stay light for serverless)."""

import re
from functools import reduce
from math import gcd

SYMBOLS = frozenset(
    """H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se
    Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy
    Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf
    Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og""".split()
)

_TOKEN = re.compile(r"([A-Z][a-z]?)(\d*\.?\d*)|(\()|(\))(\d*\.?\d*)")


def parse_formula(formula: str) -> dict[str, float]:
    """'Ca3(PO4)2' -> {'Ca': 3, 'P': 2, 'O': 8}. Raises ValueError for invalid input."""
    text = formula.replace(" ", "")
    stack: list[dict[str, float]] = [{}]
    pos = 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            raise ValueError(f"Invalid formula: {formula}")
        el, n, open_, close, close_n = m.groups()
        if el:
            if el not in SYMBOLS:
                raise ValueError(f"Unknown element {el}")
            stack[-1][el] = stack[-1].get(el, 0) + float(n or 1)
        elif open_:
            stack.append({})
        elif close:
            if len(stack) == 1:
                raise ValueError(f"Unbalanced parentheses: {formula}")
            group = stack.pop()
            for k, v in group.items():
                stack[-1][k] = stack[-1].get(k, 0) + v * float(close_n or 1)
        pos = m.end()
    if len(stack) != 1 or not stack[0]:
        raise ValueError(f"Invalid formula: {formula}")
    return stack[0]


def formula_key(amounts: dict[str, float]) -> str:
    """Order-independent reduced formula: elements sorted alphabetically, counts divided by
    their GCD, e.g. {'O': 6, 'Fe': 4} -> 'Fe2O3'. Used to match formula searches."""
    if all(float(v).is_integer() for v in amounts.values()):
        g = reduce(gcd, (int(v) for v in amounts.values()))
        amounts = {k: int(v) // g for k, v in amounts.items()}
    return "".join(f"{el}{'' if v == 1 else f'{v:g}'}" for el, v in sorted(amounts.items()))
