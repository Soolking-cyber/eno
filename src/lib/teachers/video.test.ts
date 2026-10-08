import { describe, expect, it } from 'vitest'
import { PENDING, planVideoChange, type StoredVideo } from './video'

/**
 * THE INTRO-VIDEO STATE TABLE (owner, 2026-10-07: "show their intro video in profile or hide and send upon
 * request"), row by row. Every row must end in exactly ONE home, displace (tombstone) only what it leaves, never
 * accept someone else's upload, and refuse any change a stale window did not load (videoBase).
 */
const U = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000000-abcd12.mp4'
const V = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000001-efgh34.mp4'
const P = 'p1/aaaaaaaa-0000-4000-8000-000000000000.mp4'
const mine = (url: string) => url === V
const row = (o: Partial<StoredVideo> = {}): StoredVideo => ({ videoOnRequest: false, videoUrl: null, videoPath: null, videoVersion: 3, ...o })
const apply = (plan: ReturnType<typeof planVideoChange>) => {
  if (plan.kind !== 'apply') throw new Error(`refused: ${plan.code}`)
  return plan
}

describe('no video stored', () => {
  it('a new upload, shown: public, nothing displaced', () => {
    const p = apply(planVideoChange(row(), { videoOnRequest: false, videoUrl: V, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'public', url: V })
    expect(p.displaced).toEqual([])
  })
  it('a new upload, kept private: copied into the private bucket, the public upload displaced', () => {
    const p = apply(planVideoChange(row(), { videoOnRequest: true, videoUrl: V, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'private', path: PENDING, copyFromPublic: V })
    expect(p.displaced).toEqual([{ bucket: 'listing-videos', url: V }])
  })
  it('a first publish needs no base (no profile yet)', () => {
    expect(planVideoChange(null, { videoOnRequest: true, videoUrl: V }, mine).kind).toBe('apply')
  })
})

describe('a public video stored', () => {
  const stored = row({ videoUrl: U })
  it('saved unchanged: no work, and no base needed', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: false, videoUrl: U }, mine))
    expect(p.changed).toBe(false)
    expect(p.displaced).toEqual([])
  })
  it('made private: copied in, the public object displaced', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: true, videoUrl: U, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'private', path: PENDING, copyFromPublic: U })
    expect(p.displaced).toEqual([{ bucket: 'listing-videos', url: U }])
  })
  it('replaced by a new public upload: the old one displaced now', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: false, videoUrl: V, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'public', url: V })
    expect(p.displaced).toEqual([{ bucket: 'listing-videos', url: U }])
  })
  it('replaced by a new upload kept private: both public objects displaced', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: true, videoUrl: V, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'private', path: PENDING, copyFromPublic: V })
    expect(p.displaced).toEqual([{ bucket: 'listing-videos', url: U }, { bucket: 'listing-videos', url: V }])
  })
  it('removed (videoUrl null): none, the public object displaced', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: false, videoUrl: null, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'none' })
    expect(p.displaced).toEqual([{ bucket: 'listing-videos', url: U }])
  })
})

describe('a private video stored', () => {
  const stored = row({ videoOnRequest: true, videoPath: P })
  it('saved with no URL and still private: kept, no work', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: true, videoUrl: null }, mine))
    expect(p.changed).toBe(false)
    expect(p.home).toEqual({ kind: 'private', path: P })
  })
  it('published (choice flipped, base matched): copied out, the private object displaced, grants revoked', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: false, videoUrl: null, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'public', url: PENDING, copyFromPrivate: P })
    expect(p.displaced).toEqual([{ bucket: 'teacher-videos', path: P }])
    expect(p.revokeGrants).toBe(true)
  })
  it('replaced by a new private upload: new copy in, the old private and the public upload displaced, grants revoked', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: true, videoUrl: V, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'private', path: PENDING, copyFromPublic: V })
    expect(p.displaced).toEqual([{ bucket: 'teacher-videos', path: P }, { bucket: 'listing-videos', url: V }])
    expect(p.revokeGrants).toBe(true)
  })
  it('replaced by a new upload that is shown: public, the private object displaced', () => {
    const p = apply(planVideoChange(stored, { videoOnRequest: false, videoUrl: V, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'public', url: V })
    expect(p.displaced).toEqual([{ bucket: 'teacher-videos', path: P }])
  })
})

describe('stale windows, drafts and old clients never change the video', () => {
  it('a stale base is refused, whatever it asks', () => {
    expect(planVideoChange(row({ videoOnRequest: true, videoPath: P }), { videoOnRequest: false, videoUrl: null, videoBase: 2 }, mine)).toEqual({ kind: 'refuse', code: 'video_changed' })
    expect(planVideoChange(row({ videoUrl: U }), { videoOnRequest: false, videoUrl: null, videoBase: 2 }, mine)).toEqual({ kind: 'refuse', code: 'video_changed' })
  })
  it('no base (a draft, the join form, a crafted body): the default videoOnRequest=false cannot publish a private video', () => {
    expect(planVideoChange(row({ videoOnRequest: true, videoPath: P }), { videoOnRequest: false, videoUrl: null }, mine)).toEqual({ kind: 'refuse', code: 'video_changed' })
  })
  it('no base cannot remove or replace a public video either', () => {
    expect(planVideoChange(row({ videoUrl: U }), { videoOnRequest: false, videoUrl: null }, mine).kind).toBe('refuse')
    expect(planVideoChange(row({ videoUrl: U }), { videoOnRequest: false, videoUrl: V }, mine).kind).toBe('refuse')
  })
  it('a client from before this feature (no videoOnRequest) keeps a private video, and may not replace it', () => {
    expect(apply(planVideoChange(row({ videoOnRequest: true, videoPath: P }), { videoUrl: null }, mine)).changed).toBe(false)
    expect(planVideoChange(row({ videoOnRequest: true, videoPath: P }), { videoUrl: V }, mine)).toEqual({ kind: 'refuse', code: 'video_changed' })
  })
  it('a choice flip with no video still needs the base (it is a change)', () => {
    expect(planVideoChange(row(), { videoOnRequest: true, videoUrl: null }, mine)).toEqual({ kind: 'refuse', code: 'video_changed' })
    expect(apply(planVideoChange(row(), { videoOnRequest: true, videoUrl: null, videoBase: 3 }, mine)).videoOnRequest).toBe(true)
  })
})

describe('ownership', () => {
  it('refuses to MOVE a new URL that is not the teacher\'s own upload into the private bucket (it would delete it)', () => {
    const someoneElses = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000009-zzzz99.mp4'
    expect(planVideoChange(row(), { videoOnRequest: true, videoUrl: someoneElses, videoBase: 3 }, mine)).toEqual({ kind: 'refuse', code: 'video_not_owned' })
    expect(planVideoChange(row({ videoOnRequest: true, videoPath: P }), { videoOnRequest: true, videoUrl: someoneElses, videoBase: 3 }, mine)).toEqual({ kind: 'refuse', code: 'video_not_owned' })
  })
  it('stores a new URL SHOWN publicly as before this feature — no move, no delete, no upload record needed', () => {
    const someoneElses = 'https://sb.eno.vn/storage/v1/object/public/listing-videos/1700000000009-zzzz99.mp4'
    const p = apply(planVideoChange(row(), { videoOnRequest: false, videoUrl: someoneElses, videoBase: 3 }, () => false))
    expect(p.home).toEqual({ kind: 'public', url: someoneElses })
    expect(p.displaced).toEqual([])
  })
  it('grandfathers the stored public video (no upload record needed to keep or hide it)', () => {
    expect(planVideoChange(row({ videoUrl: U }), { videoOnRequest: true, videoUrl: U, videoBase: 3 }, () => false).kind).toBe('apply')
  })
})

describe('a stored state with both homes (only a deploy window makes one)', () => {
  it('resolves to private and displaces the public copy', () => {
    const p = apply(planVideoChange(row({ videoOnRequest: true, videoUrl: U, videoPath: P }), { videoOnRequest: true, videoUrl: null, videoBase: 3 }, mine))
    expect(p.home).toEqual({ kind: 'private', path: P })
    expect(p.displaced).toEqual([{ bucket: 'listing-videos', url: U }])
    expect(p.changed).toBe(true)
  })
})
