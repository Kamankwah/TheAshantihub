/** A list from an endpoint that answers an array or a paged `{results}`; anything else is an empty list, never a crash. */
export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const results = (value as { results?: unknown } | null | undefined)?.results;
  return Array.isArray(results) ? (results as T[]) : [];
}
