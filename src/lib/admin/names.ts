/** First of "base", "base (2)", "base (3)"… that `taken` doesn't contain (case-insensitive). Used when duplicating. */
export function nextFreeName(base: string, taken: string[]) {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const trimmed = base.slice(0, 110);
  if (!used.has(trimmed.toLowerCase())) return trimmed;
  for (let i = 2; ; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
