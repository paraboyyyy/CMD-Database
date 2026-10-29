import { describe, expect, it } from "vitest";
import { elementQuery, parseElementQuery } from "./searchQuery";

describe("element queries in the search box", () => {
  it("recognizes element lists", () => {
    expect(parseElementQuery("Fe")).toEqual({ elements: ["Fe"], only: false });
    expect(parseElementQuery(" Fe, O ")).toEqual({ elements: ["Fe", "O"], only: false });
    expect(parseElementQuery("Fe O")).toEqual({ elements: ["Fe", "O"], only: false });
    expect(parseElementQuery("Li-Co-O")).toEqual({ elements: ["Li", "Co", "O"], only: true });
  });

  it("leaves formulas and IDs to the text search", () => {
    for (const q of ["Fe2O3", "CO", "NaCl", "cmd-12", "Xx", "fe", ""]) expect(parseElementQuery(q), q).toBeNull();
  });

  it("round-trips", () => {
    for (const only of [false, true]) {
      const text = elementQuery(["Fe", "O"], only);
      expect(parseElementQuery(text)).toEqual({ elements: ["Fe", "O"], only });
    }
  });
});
