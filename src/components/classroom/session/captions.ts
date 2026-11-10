/**
 * THE TUTOR'S CAPTION AS LINES (Praktika comparison, 2026-11-10: "three looks" — the learner's bubble, the tutor's English,
 * the Vietnamese help). A line is Vietnamese when the server says so: the reply's `support` (tutor-ai.ts — Vietnamese by
 * contract), and a streamed sentence with `lang: 'vi'` (turn-stream.ts — the help, or a Vietnamese sentence of the reply).
 * Consecutive lines of one kind read as one paragraph.
 */
export type CaptionLine = { text: string; vi: boolean }

export function appendLine(lines: readonly CaptionLine[], text: string | null | undefined, vi: boolean): CaptionLine[] {
  const t = (text ?? '').trim()
  if (!t) return [...lines]
  const last = lines.at(-1)
  if (last && last.vi === vi) return [...lines.slice(0, -1), { text: `${last.text} ${t}`, vi }]
  return [...lines, { text: t, vi }]
}

/** A whole line as saved — its Vietnamese help first (said first), then the English. */
export function captionLines(support: string | null | undefined, text: string | null | undefined): CaptionLine[] {
  return appendLine(appendLine([], support, true), text, false)
}

/** ONE SPEED BUTTON (owner, 2026-11-10: "one button tap slow tap normal tap fast in rotation"): the next pace in the
 *  learner's range, slowest first, wrapping round. A pace outside the range starts it again from the slowest. */
export function nextPace<T>(paces: readonly T[], p: T): T {
  const i = paces.indexOf(p)
  return paces[(i + 1) % paces.length]
}
