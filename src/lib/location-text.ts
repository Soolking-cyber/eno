/**
 * "The House of Bee (The House of Bee)" → "The House of Bee". Imported buildings often carry their local name in brackets, and where
 * both names are the same the bracket says the same thing twice in the buy box. Only an exact repeat folds (ignoring case and the
 * spaces around it): "District 1 (Quận 1)" tells a reader something, so it stays.
 */
export function collapseRepeatedName(location: string): string {
  const m = /^(.+?)\s*\((.+)\)\s*$/.exec(location)
  return m && m[1].trim().toLowerCase() === m[2].trim().toLowerCase() ? m[1].trim() : location
}

/** The same fold over a place name's translations, so collapsing it never loses a reader's language. */
export function collapseRepeatedNames(i18n: Record<string, string> | null | undefined): Record<string, string> | null | undefined {
  return i18n ? Object.fromEntries(Object.entries(i18n).map(([lang, text]) => [lang, collapseRepeatedName(text)])) : i18n
}
