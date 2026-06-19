// Accent/diacritic + case folding for search ("Quận 1" → "quan 1", "Căn hộ" → "can ho").
// Keeps word boundaries (unlike slugify) so substring matching works across languages.
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Build the searchable, folded blob for a listing (covers EN + VI fields). */
export function buildSearchText(parts: (string | null | undefined)[]): string {
  return fold(parts.filter(Boolean).join(' '))
}
