/** "A, B and C" / "A, B và C" — a list of names inside a sentence, in the page's language. */
export function joinNames(names: readonly string[], lang: 'en' | 'vi'): string {
  if (names.length <= 1) return names[0] ?? ''
  const and = lang === 'vi' ? 'và' : 'and'
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`
}
