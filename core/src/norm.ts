/**
 * Normalize a card name for matching: lowercase, collapse any run of non-alphanumeric
 * characters to a single space, trim. Mirrors the Python prototype's `norm()` so the two
 * implementations resolve names identically.
 */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
