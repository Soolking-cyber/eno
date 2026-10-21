/**
 * THE WORDS THAT TRIP A TEXT RULE, cut from the text exactly as typed — moved verbatim from src/lib/job-listing.ts (2026-10-21)
 * so the teacher form can point at its own refused words too (src/lib/teachers/text-screen.ts) without shipping the job rules
 * to the browser. Pure: no imports.
 */

/** The longest snippet a refusal carries (a word run longer than this is cut, with "…"). */
export const SNIPPET_MAX = 80

/**
 * The poster's own words that trip the rule, cut from the refused block or sentence so they read exactly as shown — what
 * they are asked to take out or reword ("Visa", "TRC", "training fee required", "tạm trú"). The fewest whole words around
 * the FIRST hit (words come off the back while the rest still trips, then off the front) joined to the fewest around the
 * LAST (front, then back), so a line with two ("hostess for a karaoke bar") shows both and one fix clears it. Exactly the
 * first and the last when more words can only add hits — always so for the visa test; a negation taken out can make the rule
 * trip on fewer words and not on more ("Training fee:" against "Training fee: none"), and then the cut lands on a hit near
 * them. Edge punctuation goes ("Visa." → "Visa"), and so does a bracket or quote left without its pair ("(visa" → "visa"); a
 * pair ("Visa (thị thực)") and a hashtag's # stay as typed.
 * ⛔ TWO HITS FAR APART — the joined span past SNIPPET_MAX — give the FIRST hit's own words only (Opus, round 3): a whole
 * paragraph is a block now, and a cut "first … last" run would end in "…" before the last hit and name words nobody could
 * find. The first hit alone is one contiguous run of the block, so the wizard's note (post-wizard.tsx jobTextStill) still
 * finds it in the field; the refusal comes back for the next hit once that one is fixed. A single run past the limit (one
 * very long word) is cut, with "…", as ever.
 * ⚠️ EACH CUT IS A BINARY SEARCH between a span that trips and one that does not, so a 5,000-character line costs a few
 * dozen tests of the rule (O(n log n) in all), not one per word each way (measured 2026-10-18: ~350 ms for 1,200 words that way) — and it
 * ends, like the word-by-word cut, on words that trip while one fewer does not.
 */
export function trippingWords(piece: string, trips: (s: string) => boolean): string {
  const words = [...piece.matchAll(/\S+/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const)
  const span = (a: number, b: number) => piece.slice(words[a][0], words[b - 1][1])
  const narrow = (backFirst: boolean): [number, number] => {
    let a = 0
    let b = words.length
    // The last end that still trips: [a, hi) trips, [a, lo) does not (an empty span never does).
    const back = () => {
      let lo = a
      let hi = b
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (trips(span(a, mid))) hi = mid; else lo = mid }
      b = hi
    }
    // The last start that still trips: [lo, b) trips, [hi, b) does not.
    const front = () => {
      let lo = a
      let hi = b
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (trips(span(mid, b))) lo = mid; else hi = mid }
      a = lo
    }
    if (backFirst) { back(); front() } else { front(); back() }
    return [a, b]
  }
  const [first, last] = [narrow(true), narrow(false)]
  // Edge punctuation and an unpaired bracket or quote off a cut — kept only while what is left still trips.
  const tidy = (cut: string): string => {
    let trimmed = cut.replace(/^[.,;:!?…]+|[.,;:!?…]+$/gu, '')
    for (const [open, close] of [['(', ')'], ['[', ']'], ['“', '”'], ['«', '»']]) {
      if (trimmed.startsWith(open) && !trimmed.includes(close)) trimmed = trimmed.slice(open.length)
      if (trimmed.endsWith(close) && !trimmed.includes(open)) trimmed = trimmed.slice(0, -close.length)
    }
    return trimmed && trimmed !== cut && trips(trimmed) ? trimmed : cut
  }
  let out = tidy(span(Math.min(first[0], last[0]), Math.max(first[1], last[1])))
  if (Array.from(out).length > SNIPPET_MAX) out = tidy(span(first[0], first[1]))
  const chars = Array.from(out)
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX - 1).join('')}…` : out
}
