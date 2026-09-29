import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { diffSeedAnswer, type SeedAnswer, type StoredAnswer } from './help-seed-diff'

const createdAt = new Date(Date.UTC(2026, 6, 21, 0, 3, 0))
const seed: SeedAnswer = {
  community: 'buying',
  kind: 'guide',
  flair: 'Offers',
  flairVi: 'Trả giá',
  title: 'How offers work',
  body: 'Make an offer from the listing page.',
  pinned: false,
}
const stored = (over: Partial<StoredAnswer> = {}): StoredAnswer => ({
  communitySlug: seed.community,
  kind: seed.kind,
  flair: seed.flair,
  flairVi: seed.flairVi,
  title: seed.title,
  body: seed.body,
  pinned: seed.pinned,
  official: true,
  status: 'published',
  createdAt: new Date(createdAt.getTime()),
  ...over,
})

describe('diffSeedAnswer', () => {
  it('an identical row is neither written nor edited — the whole point: no restamped updatedAt', () => {
    expect(diffSeedAnswer(seed, createdAt, stored(), false)).toEqual({ write: false, edited: false })
  })

  it('a new row is written and counts as an edit', () => {
    expect(diffSeedAnswer(seed, createdAt, null, false)).toEqual({ write: true, edited: true })
  })

  it.each([
    ['title', { title: 'Old title' }],
    ['body', { body: 'Old body' }],
    ['flair', { flair: 'Old' }],
    ['flairVi', { flairVi: 'Cũ' }],
    ['kind', { kind: 'question' }],
    ['topic', { communitySlug: 'selling' }],
    ['a retired row coming back', { status: 'hidden' }],
  ] as const)('%s changed → written AND edited', (_what, over) => {
    expect(diffSeedAnswer(seed, createdAt, stored(over), false)).toEqual({ write: true, edited: true })
  })

  it('a changed curated Vietnamese translation is an edit even when the row is identical', () => {
    expect(diffSeedAnswer(seed, createdAt, stored(), true)).toEqual({ write: true, edited: true })
  })

  it.each([
    ['a reorder (createdAt is the curated-order key)', { createdAt: new Date(createdAt.getTime() + 60_000) }],
    ['pinning', { pinned: true }],
    ['the official flag', { official: false }],
  ] as const)('%s → written but NOT an edit of the answer', (_what, over) => {
    expect(diffSeedAnswer(seed, createdAt, stored(over), false)).toEqual({ write: true, edited: false })
  })
})

describe('scripts/sync-help-center.ts', () => {
  const src = readFileSync('scripts/sync-help-center.ts', 'utf8')

  it('asks diffSeedAnswer before writing an answer, and no longer upserts every answer blindly', () => {
    expect(src).toMatch(/diffSeedAnswer\(/)
    expect(src).not.toMatch(/forumPost\.upsert\(/)
  })

  it('writes an answer only when the diff says so, and stamps editedAt only on an edit or a create', () => {
    expect(src).toMatch(/if \(!dryRun && write\)/)
    const stamps = [...src.matchAll(/editedAt:/g)]
    expect(stamps.length, 'one stamp for an edited update, one for a create').toBe(2)
    expect(src).toMatch(/\.\.\.\(edited \? \{ editedAt: new Date\(\) \} : \{\}\)/)
    expect(src.slice(src.indexOf('db.forumPost.create('))).toMatch(/^[\s\S]{0,400}editedAt: new Date\(\)/)
  })
})
