// Element names, standard atomic masses, Pauling electronegativities and categories.
// Generated from pymatgen. Format: "Symbol|Name|mass|electronegativity|category", Z order.
const TABLE =
  "H|Hydrogen|1.008|2.20|nonmetal;He|Helium|4.003||noble-gas;Li|Lithium|6.941|0.98|alkali;" +
  "Be|Beryllium|9.012|1.57|alkaline;B|Boron|10.811|2.04|metalloid;C|Carbon|12.011|2.55|nonmetal;" +
  "N|Nitrogen|14.007|3.04|nonmetal;O|Oxygen|15.999|3.44|nonmetal;F|Fluorine|18.998|3.98|halogen;" +
  "Ne|Neon|20.180||noble-gas;Na|Sodium|22.990|0.93|alkali;Mg|Magnesium|24.305|1.31|alkaline;" +
  "Al|Aluminum|26.982|1.61|post-transition;Si|Silicon|28.085|1.90|metalloid;" +
  "P|Phosphorus|30.974|2.19|nonmetal;S|Sulfur|32.065|2.58|nonmetal;" +
  "Cl|Chlorine|35.453|3.16|halogen;Ar|Argon|39.948||noble-gas;K|Potassium|39.098|0.82|alkali;" +
  "Ca|Calcium|40.078|1.00|alkaline;Sc|Scandium|44.956|1.36|transition;" +
  "Ti|Titanium|47.867|1.54|transition;V|Vanadium|50.941|1.63|transition;" +
  "Cr|Chromium|51.996|1.66|transition;Mn|Manganese|54.938|1.55|transition;" +
  "Fe|Iron|55.845|1.83|transition;Co|Cobalt|58.933|1.88|transition;" +
  "Ni|Nickel|58.693|1.91|transition;Cu|Copper|63.546|1.90|transition;" +
  "Zn|Zinc|65.409|1.65|transition;Ga|Gallium|69.723|1.81|post-transition;" +
  "Ge|Germanium|72.640|2.01|metalloid;As|Arsenic|74.922|2.18|metalloid;" +
  "Se|Selenium|78.960|2.55|nonmetal;Br|Bromine|79.904|2.96|halogen;" +
  "Kr|Krypton|83.798|3.00|noble-gas;Rb|Rubidium|85.468|0.82|alkali;" +
  "Sr|Strontium|87.620|0.95|alkaline;Y|Yttrium|88.906|1.22|transition;" +
  "Zr|Zirconium|91.224|1.33|transition;Nb|Niobium|92.906|1.60|transition;" +
  "Mo|Molybdenum|95.940|2.16|transition;Tc|Technetium|98.000|1.90|transition;" +
  "Ru|Ruthenium|101.070|2.20|transition;Rh|Rhodium|102.906|2.28|transition;" +
  "Pd|Palladium|106.420|2.20|transition;Ag|Silver|107.868|1.93|transition;" +
  "Cd|Cadmium|112.411|1.69|transition;In|Indium|114.818|1.78|post-transition;" +
  "Sn|Tin|118.710|1.96|post-transition;Sb|Antimony|121.760|2.05|metalloid;" +
  "Te|Tellurium|127.600|2.10|metalloid;I|Iodine|126.904|2.66|halogen;" +
  "Xe|Xenon|131.293|2.60|noble-gas;Cs|Cesium|132.905|0.79|alkali;" +
  "Ba|Barium|137.327|0.89|alkaline;La|Lanthanum|138.905|1.10|lanthanide;" +
  "Ce|Cerium|140.116|1.12|lanthanide;Pr|Praseodymium|140.908|1.13|lanthanide;" +
  "Nd|Neodymium|144.242|1.14|lanthanide;Pm|Promethium|145.000|1.13|lanthanide;" +
  "Sm|Samarium|150.360|1.17|lanthanide;Eu|Europium|151.964|1.20|lanthanide;" +
  "Gd|Gadolinium|157.250|1.20|lanthanide;Tb|Terbium|158.925|1.10|lanthanide;" +
  "Dy|Dysprosium|162.500|1.22|lanthanide;Ho|Holmium|164.930|1.23|lanthanide;" +
  "Er|Erbium|167.259|1.24|lanthanide;Tm|Thulium|168.934|1.25|lanthanide;" +
  "Yb|Ytterbium|173.040|1.10|lanthanide;Lu|Lutetium|174.967|1.27|lanthanide;" +
  "Hf|Hafnium|178.490|1.30|transition;Ta|Tantalum|180.948|1.50|transition;" +
  "W|Tungsten|183.840|2.36|transition;Re|Rhenium|186.207|1.90|transition;" +
  "Os|Osmium|190.230|2.20|transition;Ir|Iridium|192.217|2.20|transition;" +
  "Pt|Platinum|195.084|2.28|transition;Au|Gold|196.967|2.54|transition;" +
  "Hg|Mercury|200.590|2.00|transition;Tl|Thallium|204.383|1.62|post-transition;" +
  "Pb|Lead|207.200|2.33|post-transition;Bi|Bismuth|208.980|2.02|post-transition;" +
  "Po|Polonium|210.000|2.00|metalloid;At|Astatine|210.000|2.20|halogen;" +
  "Rn|Radon|220.000|2.20|noble-gas;Fr|Francium|223.000|0.70|alkali;" +
  "Ra|Radium|226.000|0.90|alkaline;Ac|Actinium|227.000|1.10|actinide;" +
  "Th|Thorium|232.038|1.30|actinide;Pa|Protactinium|231.036|1.50|actinide;" +
  "U|Uranium|238.029|1.38|actinide;Np|Neptunium|237.000|1.36|actinide;" +
  "Pu|Plutonium|244.000|1.28|actinide;Am|Americium|243.000|1.30|actinide;" +
  "Cm|Curium|247.000|1.30|actinide;Bk|Berkelium|247.000|1.30|actinide;" +
  "Cf|Californium|251.000|1.30|actinide;Es|Einsteinium|252.000|1.30|actinide;" +
  "Fm|Fermium|257.000|1.30|actinide;Md|Mendelevium|258.000|1.30|actinide;" +
  "No|Nobelium|259.000|1.30|actinide;Lr|Lawrencium|262.000|1.30|actinide;" +
  "";

export type ElementCategory =
  | "alkali"
  | "alkaline"
  | "transition"
  | "post-transition"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble-gas"
  | "lanthanide"
  | "actinide";

export interface ElementDetails {
  z: number;
  symbol: string;
  name: string;
  mass: number;
  electronegativity: number | null;
  category: ElementCategory;
}

export const ELEMENT_DETAILS: ElementDetails[] = TABLE.split(";")
  .filter(Boolean)
  .map((entry, i) => {
    const [symbol, name, mass, x, category] = entry.split("|");
    return {
      z: i + 1,
      symbol,
      name,
      mass: Number(mass),
      electronegativity: x ? Number(x) : null,
      category: category as ElementCategory,
    };
  });

export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  alkali: "Alkali metal",
  alkaline: "Alkaline earth metal",
  transition: "Transition metal",
  "post-transition": "Post-transition metal",
  metalloid: "Metalloid",
  nonmetal: "Reactive nonmetal",
  halogen: "Halogen",
  "noble-gas": "Noble gas",
  lanthanide: "Lanthanide",
  actinide: "Actinide",
};
