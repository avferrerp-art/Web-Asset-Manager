/**
 * Shared search normalization: case-insensitive and accent-insensitive.
 * Normalizes BOTH sides (query and field values).
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Returns true if the normalized query is contained in any of the given fields.
 * Null/undefined fields are ignored. Numeric fields (e.g. ids) are stringified.
 * A leading "#" in the query is stripped so "#25" matches id 25.
 */
export function matchesSearch(
  query: string,
  fields: Array<string | number | null | undefined>
): boolean {
  const q = normalizeText(query.startsWith("#") ? query.slice(1) : query);
  if (!q) return true;
  return fields.some(
    (f) => f != null && normalizeText(String(f)).includes(q)
  );
}
