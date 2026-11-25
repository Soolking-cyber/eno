/**
 * The words around a search's first match in a help answer, for the hub's result row (help-center.tsx AnswerRow). The hub lists
 * questions and links each to its page (2026-11-25), so a row found by its ANSWER would otherwise show a title without the
 * word that found it — help centres (Zendesk, Intercom) show an excerpt there. Plain text: the answer's markup marks
 * (headings, bullets, bold, quotes) are dropped. Null when there is no needle or the text does not hold it.
 */
export function answerExcerpt(text: string, needle: string, max = 160): string | null {
  if (!needle) return null
  const plain = text.replace(/[#*•>_`]+/g, ' ').replace(/\s+/g, ' ').trim()
  const at = plain.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (at < 0) return null
  // Some words before the match, from a word's start.
  let start = Math.max(0, at - 60)
  if (start > 0) {
    const space = plain.indexOf(' ', start)
    if (space !== -1 && space < at) start = space + 1
  }
  // At most `max` characters, cut at a word after the match.
  let end = Math.min(plain.length, start + max)
  if (end < plain.length) {
    const space = plain.lastIndexOf(' ', end)
    if (space > at + needle.length) end = space
  }
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}
