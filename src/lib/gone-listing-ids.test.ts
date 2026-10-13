import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import ids from '@/data/gone-listing-ids.json'
import { isJournaledGone } from './gone-listing-ids'

describe('the gone page allow-list is the owner\'s cleanup journals, and only those', () => {
  it('holds the 10-03 new-goods hide and the 10-05 "[New 100%]" laptops, minus every AccessTrade row (2026-10-13)', () => {
    expect((ids as string[]).length).toBe(6_947)
    // The exact list, pinned: sha256 of the sorted ids joined by "\n" (recipe in gone-listing-ids.ts).
    expect(createHash('sha256').update((ids as string[]).join('\n')).digest('hex')).toBe('4818674ccaeb494e967cbcca4cead6a6c3a24b95340f5e3cf5275b6965b5d5ca')
    expect([...(ids as string[])].sort()).toEqual(ids)
    expect(isJournaledGone('cmtsgclki03wwrvq43xmhw0rk')).toBe(true) // new-goods-hide-20261003T040816Z.csv — a scraped shop's new goods
    expect(isJournaledGone('cmtzh27h400630jnt4d8uj6a9')).toBe(true) // tgs-new100-hidden.txt, line 1
  })
  it('⛔ no AccessTrade row (owner 2026-10-13: "remove all accesstrade products from the website")', () => {
    expect(isJournaledGone('cmtunah980p1h0ipascmxdnwc')).toBe(false) // new-goods-hide-20261003T040816Z.csv line 1 — an AccessTrade (isclix) row
  })
  it('⛔ not SuperSports (the owner removed its products outright), not anything unjournaled', () => {
    expect(isJournaledGone('cmu54sbkk04e6czq46mk1u4ub')).toBe(false) // supersports-hide-20261002T025207Z.csv, line 1
    expect(isJournaledGone('L1')).toBe(false)
  })
})
