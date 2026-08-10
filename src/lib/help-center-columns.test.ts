import { describe, expect, it } from 'vitest'
import { HELP_TOPICS, splitIntoColumns } from './help-center'

// Tests for the /help two-column pack. It exists because a reviewer pointed out the
// obvious: the packing rationale is thirty lines of measured numbers defending a
// function with no test, so the day a topic gains a question, nothing notices.
//
// The two properties that actually matter are ORDER and BALANCE, in that order. Balance
// is the visible symptom; order is the one that silently broke mobile, because the two
// columns stack below `lg` and an interleaving pack ships a scrambled topic list.

/** Build the minimal shape splitIntoColumns cares about: `{ posts: [...] }`. */
const g = (id: string, posts: number) => ({ id, posts: Array.from({ length: posts }, (_, i) => i) })
const weightOf = (col: { posts: readonly unknown[] }[]) => col.reduce((sum, x) => sum + x.posts.length + 1, 0)

describe('splitIntoColumns', () => {
  it('preserves reading order — left column then right column is the input sequence', () => {
    const input = [g('a', 3), g('b', 6), g('c', 10), g('d', 8), g('e', 3), g('f', 10)]
    const [left, right] = splitIntoColumns(input)
    expect([...left, ...right].map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('splits contiguously — each column is an unbroken run, never interleaved', () => {
    const input = [g('a', 3), g('b', 6), g('c', 10), g('d', 8), g('e', 3), g('f', 10)]
    const [left, right] = splitIntoColumns(input)
    // The old greedy pack produced left=[a,c,e] / right=[b,d,f]; a contiguous split
    // cannot, because the concatenation above already fixed the order.
    expect(left.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(right.map((x) => x.id)).toEqual(['d', 'e', 'f'])
  })

  it('reproduces the measured production numbers for the real HELP_TOPICS shape', () => {
    // Weights [4,7,11,9,4,11] — the post counts measured on the live page. The old
    // greedy pack gave 19/27 (a 456px hole at 1440px); the split gives 22/24 (114px).
    const input = [g('getting-started', 3), g('buying', 6), g('selling', 10), g('trust', 8), g('account', 3), g('vietnam', 10)]
    const [left, right] = splitIntoColumns(input)
    expect(weightOf(left)).toBe(22)
    expect(weightOf(right)).toBe(24)
    // Strictly better than the 8 the old greedy pack produced (asserted below).
    expect(Math.abs(weightOf(left) - weightOf(right))).toBe(2)
  })

  it('beats the alternating greedy pack it replaced, on the real content', () => {
    const input = [g('a', 3), g('b', 6), g('c', 10), g('d', 8), g('e', 3), g('f', 10)]
    // Reimplementation of the OLD algorithm, kept here so the regression is testable
    // rather than remembered.
    const greedy = (groups: typeof input) => {
      const l: typeof input = []
      const r: typeof input = []
      let lc = 0
      let rc = 0
      for (const group of groups) {
        const w = group.posts.length + 1
        if (lc <= rc) { l.push(group); lc += w } else { r.push(group); rc += w }
      }
      return [l, r] as const
    }
    const [gl, gr] = greedy(input)
    const [sl, sr] = splitIntoColumns(input)
    expect(Math.abs(weightOf(gl) - weightOf(gr))).toBe(8)
    expect(Math.abs(weightOf(sl) - weightOf(sr))).toBe(2)
  })

  it('picks the best break point, not merely a valid one', () => {
    // Exhaustively verify optimality within the order-preserving constraint.
    const input = [g('a', 1), g('b', 9), g('c', 2), g('d', 4), g('e', 7)]
    const [left, right] = splitIntoColumns(input)
    const actual = Math.abs(weightOf(left) - weightOf(right))
    const everySplit = Array.from({ length: input.length - 1 }, (_, i) =>
      Math.abs(weightOf(input.slice(0, i + 1)) - weightOf(input.slice(i + 1))))
    expect(actual).toBe(Math.min(...everySplit))
  })

  it('keeps a lone group in the FIRST column, so it renders full width, not half', () => {
    // ⚠️ SCOPE: this covers the SPLIT only. The other half of that behaviour — the caller
    // dropping the empty column and withholding `lg:grid-cols-2` — is a render concern
    // and is NOT tested here, which a reviewer was right to point out. It could not be
    // verified in the browser either: the grouped grid only renders when there is no
    // query and no topic filter (`grouped = !topic && !needle`), so the sparse-taxonomy
    // state it guards is not reachable from the UI on the current data.
    const [left, right] = splitIntoColumns([g('only', 4)])
    expect(left.map((x) => x.id)).toEqual(['only'])
    expect(right).toEqual([])
  })

  it('handles an empty list without throwing or producing a NaN break', () => {
    expect(splitIntoColumns([])).toEqual([[], []])
  })

  it('gives each of two groups its own column', () => {
    const [left, right] = splitIntoColumns([g('a', 1), g('b', 9)])
    expect(left.map((x) => x.id)).toEqual(['a'])
    expect(right.map((x) => x.id)).toEqual(['b'])
  })

  it('weighs a heading as one post, so a topic\'s fixed chrome is not free', () => {
    // ⚠️ THIS INPUT IS CHOSEN, NOT ARBITRARY. The first version of this test used two
    // empty groups and passed even with the `+ 1` deleted from the implementation —
    // a test that cannot fail is not a test, which a mutation run is what caught.
    // Four small topics and one large one is the shape that separates the two models:
    // weights [2,2,2,2,6] break at 3 (6 vs 8), while unweighted [1,1,1,1,5] break at
    // 4 (4 vs 5). So deleting the heading weight moves a real group across the gutter.
    const input = [g('a', 1), g('b', 1), g('c', 1), g('d', 1), g('e', 5)]
    const [left] = splitIntoColumns(input)
    expect(left.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('never drops or duplicates a group, for any shape', () => {
    for (const counts of [[1], [1, 1], [5, 1, 1], [1, 1, 5], [3, 3, 3, 3], [10, 1, 1, 10], [2, 8]]) {
      const input = counts.map((n, i) => g(`g${i}`, n))
      const [left, right] = splitIntoColumns(input)
      expect([...left, ...right].map((x) => x.id)).toEqual(input.map((x) => x.id))
    }
  })

  it('does not mutate its input', () => {
    const input = [g('a', 3), g('b', 6), g('c', 10)]
    const snapshot = input.map((x) => x.id)
    splitIntoColumns(input)
    expect(input.map((x) => x.id)).toEqual(snapshot)
  })

  it('holds for whatever length the live HELP_TOPICS export happens to be', () => {
    // ⚠️ NAMED FOR WHAT IT DOES. An earlier name claimed this covered "the edition-filtered
    // taxonomy", which a reviewer correctly called out: it reads the already-filtered
    // HELP_TOPICS export and attaches FABRICATED post counts, so it proves nothing about
    // edition filtering itself and would not catch a forum-only topic leaking onto eno.vn.
    // (That is help-center-edition.test.ts's job and it already does it.) What this does
    // cover is the thing the measured six-topic numbers cannot: the split still behaves
    // when the taxonomy is not six items long.
    const input = HELP_TOPICS.map((t, i) => g(t.slug, i + 1))
    const [left, right] = splitIntoColumns(input)
    expect(left.length + right.length).toBe(HELP_TOPICS.length)
    if (HELP_TOPICS.length >= 2) {
      expect(left.length).toBeGreaterThan(0)
      expect(right.length).toBeGreaterThan(0)
    }
  })
})
