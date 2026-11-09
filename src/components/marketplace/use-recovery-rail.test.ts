// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRecoveryRail } from './use-recovery-rail'

/**
 * The rail under a sparse answer is decided ONCE PER ANSWER, from the answer whose rows are on screen (UI climb 2026-11-09,
 * hunt #9 — both plan reviewers' counterexamples): a refetch never reshuffles it, rows with no answer yet get no rail
 * ('unknown', never a Trending that might change), and a new answer is a new decision.
 */
const rows = (...ids: string[]) => ids.map((id) => ({ id }))
const rail = (tag: string) => ({ slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', subcategory: 'phones', subName: 'Phones', subNameVi: 'Điện thoại', listings: rows(`${tag}1`, `${tag}2`, `${tag}3`) as never })
const answer = (sig: string, ids: string[], related: ReturnType<typeof rail> | null) => ({ listings: rows(...ids), related, fetchedFor: { sig } })

type P = { a: Parameters<typeof useRecoveryRail>[0]; shown: { id: string }[] }
const mount = (p: P) => renderHook(({ a, shown }: P) => useRecoveryRail(a, shown), { initialProps: p })

describe('useRecoveryRail', () => {
  it('the answer on screen brought related: "related"; it brought none: "trending"', () => {
    expect(mount({ a: answer('s', ['a', 'b'], rail('x')), shown: rows('a', 'b') }).result.current).toMatchObject({ kind: 'related', related: { listings: rail('x').listings } })
    expect(mount({ a: answer('s', ['a', 'b'], null), shown: rows('a', 'b') }).result.current).toEqual({ kind: 'trending' })
  })

  it('rows with no answer to decide by — none yet, or a payload for other rows — are "unknown"', () => {
    expect(mount({ a: undefined, shown: rows('a', 'b') }).result.current).toEqual({ kind: 'unknown' })
    expect(mount({ a: answer('s', ['c'], rail('x')), shown: rows('a', 'b') }).result.current).toEqual({ kind: 'unknown' })
    // Same ids in another order are other rows.
    expect(mount({ a: answer('s', ['b', 'a'], rail('x')), shown: rows('a', 'b') }).result.current).toEqual({ kind: 'unknown' })
  })

  it('⛔ a refetch of the same answer with re-ranked related cards does NOT reshuffle the rail', () => {
    const v = mount({ a: answer('s', ['a', 'b'], rail('x')), shown: rows('a', 'b') })
    v.rerender({ a: answer('s', ['a', 'b'], rail('y')), shown: rows('a', 'b') })
    expect(v.result.current).toMatchObject({ kind: 'related', related: { listings: rail('x').listings } })
    // …nor does a refetch that suddenly brings none turn it into Trending.
    v.rerender({ a: answer('s', ['a', 'b'], null), shown: rows('a', 'b') })
    expect(v.result.current).toMatchObject({ kind: 'related' })
  })

  it('a full-reload restore: rows first, no rail; the answer lands for them: decided once', () => {
    const v = mount({ a: undefined, shown: rows('a', 'b') })
    expect(v.result.current).toEqual({ kind: 'unknown' })
    v.rerender({ a: answer('s', ['a', 'b'], rail('x')), shown: rows('a', 'b') })
    expect(v.result.current).toMatchObject({ kind: 'related' })
  })

  it('the render between a new payload and its rows keeps the old decision (placeholder and adoption)', () => {
    const v = mount({ a: answer('s1', ['a', 'b'], rail('x')), shown: rows('a', 'b') })
    // A new payload, rows not yet adopted: the rows on screen keep their own decision.
    v.rerender({ a: answer('s2', ['c'], null), shown: rows('a', 'b') })
    expect(v.result.current).toMatchObject({ kind: 'related', related: { listings: rail('x').listings } })
    // The rows follow: a new answer, a new decision.
    v.rerender({ a: answer('s2', ['c'], null), shown: rows('c') })
    expect(v.result.current).toEqual({ kind: 'trending' })
  })

  it('the same rows under a new answer (other words or answer-language) are decided again', () => {
    const v = mount({ a: answer('en', ['a', 'b'], rail('x')), shown: rows('a', 'b') })
    v.rerender({ a: answer('ko', ['a', 'b'], rail('k')), shown: rows('a', 'b') })
    expect(v.result.current).toMatchObject({ kind: 'related', related: { listings: rail('k').listings } })
  })
})
