import { isElement } from "./elements";

/** Elements typed in the search box: "Fe", "Fe, O", "Fe O" (contains) or "Li-Co-O" (only these). */
export function parseElementQuery(text: string): { elements: string[]; only: boolean } | null {
  const t = text.trim();
  if (!/^[A-Z][a-z]?(?:\s*[,\s-]\s*[A-Z][a-z]?)*$/.test(t)) return null;
  const elements = [...new Set(t.split(/[\s,-]+/))];
  if (!elements.every(isElement)) return null;
  return { elements, only: t.includes("-") };
}

/** Search-box text for an element selection, the inverse of parseElementQuery. */
export function elementQuery(elements: string[], only: boolean): string {
  return elements.join(only ? "-" : ", ");
}
