import { describe, expect, it } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { allCards, homeRailClaims, isCard, slimHomeRails, visibleCategoryRails, withTitles } from './home-lanes'

/**
 * ⛔ THE HOME PAGE SENDS WHOLE ONLY THE RAIL CARDS ITS FIRST PAINT DRAWS (owner, 2026-11-17 — home-lanes.ts slimHomeRails): the
 * first product lane's cards, as the explorer will draw it; every other category-lane card and every Outstanding-businesses
 * card as its id, in its place. The choice is untouched: the same ids, the same order, so the explorer's dedup, floors and
 * lane places are what they were.
 */
const cat = (slug: string) => ({ id: `c-${slug}`, slug, name: slug, nameVi: slug, icon: 'Home' }) as unknown as SerializedCategory
const card = (id: string) => ({ id, title: `T ${id}`, sellerId: 's', images: [] }) as unknown as SerializedListingCard
const cards = (...ids: string[]) => ids.map(card)
const rail = (slug: string, ...ids: string[]) => ({ slug, listings: cards(...ids) })
const shape = (rails: { slug: string; listings: Array<{ id: string }> }[]) =>
  rails.map((r) => [r.slug, r.listings.map((l) => (isCard(l as never) ? l.id : `#${l.id}`))])

const cats = ['services', 'rentals', 'electronics', 'fashion'].map(cat)

describe('slimHomeRails', () => {
  it('whole: the first product lane\'s drawn cards only — Services (a late lane) and the lanes after stay ids, in their places', () => {
    const out = slimHomeRails({
      categories: cats,
      trending: cards('t1', 't2', 't3'),
      businesses: cards('b1', 'b2', 'b3', 'b4'),
      rails: [rail('services', 's1', 's2', 's3'), rail('rentals', 'r1', 'b1', 'r2', 't1', 'r3'), rail('electronics', 'e1', 'e2', 'e3')],
    })
    // The cards the dedup takes out of the first lane (b1, t1) were never drawn: ids too.
    expect(shape(out.rails)).toEqual([
      ['services', ['#s1', '#s2', '#s3']],
      ['rentals', ['r1', '#b1', 'r2', '#t1', 'r3']],
      ['electronics', ['#e1', '#e2', '#e3']],
    ])
    expect(out.businesses).toEqual([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }, { id: 'b4' }])
  })

  it('the first product lane is the one the explorer draws first: a rail the dedup puts under the floor is passed over', () => {
    const out = slimHomeRails({
      categories: cats,
      trending: cards('t1', 't2', 't3'),
      businesses: [],
      rails: [rail('rentals', 'r1', 't1', 't2'), rail('electronics', 'e1', 'e2', 'e3')],
    })
    expect(shape(out.rails)).toEqual([['rentals', ['#r1', '#t1', '#t2']], ['electronics', ['e1', 'e2', 'e3']]])
  })

  it('a rail this edition does not list, and a thin Trending or businesses seed, decide exactly as the explorer does', () => {
    // Trending under the floor claims nothing, so t1 stays in the lane; 'visa' is not a category here.
    const out = slimHomeRails({
      categories: cats,
      trending: cards('t1', 't2'),
      businesses: cards('b1', 'b2'),
      rails: [rail('visa', 'v1', 'v2', 'v3'), rail('rentals', 'r1', 't1', 'b1')],
    })
    expect(shape(out.rails)).toEqual([['visa', ['#v1', '#v2', '#v3']], ['rentals', ['r1', 't1', 'b1']]])
  })

  it('round trip: the explorer\'s lanes from the slim rails are the lanes from the whole ones — same ids, same places, same first lane', () => {
    const input = {
      categories: cats,
      trending: cards('t1', 't2', 't3'),
      businesses: cards('t2', 'b1', 'b2', 'b3'),
      rails: [rail('services', 's1', 'b2', 's2', 's3'), rail('rentals', 'r1', 'r2', 't3', 'r3'), rail('fashion', 'f1', 'b3', 'f2', 'f3')],
    }
    const out = slimHomeRails(input)
    const before = homeRailClaims(input.trending, input.businesses)
    const after = homeRailClaims(input.trending, out.businesses)
    expect(after.excludeIds).toEqual(before.excludeIds)
    expect(after.businesses!.map((b) => b.id)).toEqual(before.businesses!.map((b) => b.id))
    const ids = (lanes: ReturnType<typeof visibleCategoryRails>) => lanes.map((l) => [l.slug, l.items.map((i) => i.id)])
    const slimLanes = visibleCategoryRails(out.rails, cats, after.excludeIds)
    expect(ids(slimLanes)).toEqual(ids(visibleCategoryRails(input.rails, cats, before.excludeIds)))
    // The lane drawn at first paint (the first one not in LATE_LANE_SLUGS) is whole; every other lane holds ids only.
    expect(slimLanes.map((l) => [l.slug, allCards(l.items), l.items.some(isCard)])).toEqual([
      ['services', false, false], ['rentals', true, true], ['fashion', false, false],
    ])
  })

  it('no rails, no businesses: nothing to send', () => {
    expect(slimHomeRails({ categories: cats, trending: [], businesses: [], rails: [] })).toEqual({ businesses: [], rails: [] })
  })
})

describe('homeRailClaims (the explorer\'s dedup, shared with the server)', () => {
  it('Trending claims first, the businesses rail is deduped against it, and only a rail over the floor claims its cards', () => {
    expect(homeRailClaims(cards('a', 'b', 'c'), cards('a', 'd', 'e', 'f'))).toEqual({ businesses: cards('d', 'e', 'f'), excludeIds: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect(homeRailClaims(cards('a', 'b'), cards('a', 'd'))).toEqual({ businesses: cards('a', 'd'), excludeIds: [] })
    // Ids claim exactly as whole cards do.
    expect(homeRailClaims(cards('a', 'b', 'c'), [{ id: 'a' }, { id: 'd' }, { id: 'e' }, { id: 'f' }]).excludeIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(homeRailClaims(undefined, undefined)).toEqual({ businesses: undefined, excludeIds: [] })
  })
})

describe('withTitles (a language switch after a card came by id)', () => {
  it('widens only titleI18n, by id, across several answers — no card comes, goes or moves, and an id stays an id', () => {
    const mine = [{ ...card('a'), titleI18n: { ko: 'ko-a' } }, card('b'), { id: 'c' }]
    const out = withTitles(mine, [{ id: 'a', titleI18n: { ja: 'ja-a' } }, { id: 'a', titleI18n: { fr: 'fr-a' } }, { id: 'n', titleI18n: { ja: 'ja-n' } }, { id: 'c', titleI18n: { ja: 'ja-c' } }, { id: 'b' }])
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect((out[0] as SerializedListingCard).titleI18n).toEqual({ ko: 'ko-a', ja: 'ja-a', fr: 'fr-a' })
    expect(out[1]).toBe(mine[1])
    expect(out[2]).toEqual({ id: 'c' })
  })
})
