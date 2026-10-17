import { describe, expect, it } from "vitest";
import { OPENMX_PAO_TABLE, presetSpecies } from "./openmxPresets";

describe("OpenMX recommended PAO table (manual, DFT_DATA19)", () => {
  it("covers H to Bi as printed: 77 elements, 82 pseudopotentials", () => {
    expect(Object.keys(OPENMX_PAO_TABLE)).toHaveLength(77);
    expect(Object.values(OPENMX_PAO_TABLE).flat()).toHaveLength(82);
    for (const [el, opts] of Object.entries(OPENMX_PAO_TABLE))
      for (const o of opts) {
        expect(o.vps.startsWith(`${el}_PBE19`)).toBe(true);
        for (const pao of Object.values(o.pao)) expect(pao).toMatch(new RegExp(`^${el}\\d+\\.\\d[HS]?-s\\d`));
      }
  });

  it.each([
    ["H", "quick", undefined, { pao: "H5.0-s2", vps: "H_PBE19", valence: 1 }],
    ["Si", "standard", undefined, { pao: "Si7.0-s2p2d1", vps: "Si_PBE19", valence: 4 }],
    ["Si", "precise", undefined, { pao: "Si7.0-s3p3d2", vps: "Si_PBE19", valence: 4 }],
    ["F", "precise", undefined, { pao: "F6.0-s3p3d2f1", vps: "F_PBE19", valence: 7 }],
    ["Fe", "standard", undefined, { pao: "Fe5.5H-s3p2d1", vps: "Fe_PBE19H", valence: 16 }],
    ["Fe", "standard", "Fe_PBE19S", { pao: "Fe6.0S-s3p2d1", vps: "Fe_PBE19S", valence: 14 }],
    ["Cu", "quick", "Cu_PBE19S", { pao: "Cu6.0S-s2p1d1", vps: "Cu_PBE19S", valence: 11 }],
    ["Ge", "standard", undefined, { pao: "Ge7.0-s3p2d2", vps: "Ge_PBE19", valence: 4 }],
    ["Sn", "standard", undefined, { pao: "Sn7.0-s3p2d3", vps: "Sn_PBE19", valence: 14 }],
    ["Ho", "precise", undefined, { pao: "Ho8.0-s3p3d2f1", vps: "Ho_PBE19", valence: 21 }],
    ["Bi", "quick", undefined, { pao: "Bi8.0-s3p2d2", vps: "Bi_PBE19", valence: 15 }],
  ] as const)("%s %s %s", (el, q, vps, expected) => {
    expect(presetSpecies(el, q, vps)).toEqual(expected);
  });

  it("has no preset for elements missing from the manual table", () => {
    for (const el of ["Eu", "Gd", "Yb", "Po", "U"]) expect(presetSpecies(el, "standard")).toBeNull();
  });
});
