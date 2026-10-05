import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import ids from '@/data/gone-listing-ids.json'
import { isJournaledGone } from './gone-listing-ids'

describe('the gone page allow-list is the owner\'s cleanup journals, and only those', () => {
  it('holds the 10-03 new-goods hide (68,250) and the 10-05 "[New 100%]" laptops (31)', () => {
    expect((ids as string[]).length).toBe(68_281)
    // The exact list, pinned: sha256 of the sorted ids joined by "\n" (recipe in gone-listing-ids.ts).
    expect(createHash('sha256').update((ids as string[]).join('\n')).digest('hex')).toBe('b85f66553198fb711187f525bbafd90c3da201e94ab7b173dd0f3dda77616a17')
    expect([...(ids as string[])].sort()).toEqual(ids)
    expect(isJournaledGone('cmtunah980p1h0ipascmxdnwc')).toBe(true) // new-goods-hide-20261003T040816Z.csv, line 1
    expect(isJournaledGone('cmtzh27h400630jnt4d8uj6a9')).toBe(true) // tgs-new100-hidden.txt, line 1
  })
  it('⛔ not SuperSports (the owner removed its products outright), not anything unjournaled', () => {
    expect(isJournaledGone('cmu54sbkk04e6czq46mk1u4ub')).toBe(false) // supersports-hide-20261002T025207Z.csv, line 1
    expect(isJournaledGone('L1')).toBe(false)
  })
})
