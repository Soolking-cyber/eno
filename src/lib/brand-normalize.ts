// Pure brand-string helpers (no deps) — shared by the server resolver + icon lookup.

/** Matching key: lowercase, de-accent, strip everything but a–z 0–9. So "Huawei",
 *  "huawei", "HUAWEI" and "Louis Vuitton" → "huawei" / "louisvuitton". This is what
 *  uniqueness + typo-dedup compare on. */
export function normalizeBrand(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Pretty URL slug: lowercase, de-accent, non-alphanumeric → single hyphen. */
export function brandSlugify(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Levenshtein edit distance (early-exit at `max`) for the typo guard. */
export function levenshtein(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1 // whole row already exceeds the budget
    prev = cur
  }
  return prev[b.length]
}
