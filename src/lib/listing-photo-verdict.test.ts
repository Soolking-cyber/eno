import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'
import type { PhotoFacts } from './listing-photo-check'

const h = vi.hoisted(() => ({
  client: true,
  answers: {} as Record<string, () => Promise<unknown>>,
  calls: [] as string[],
  lanes: [] as string[],
  budget: true,
  laneOpen: true,
  override: null as null | { id: bigint },
  overrideThrows: false,
  cache: new Map<string, unknown>(),
  kvGetThrows: false,
  kvSetThrows: false,
  sets: [] as Array<{ key: string; value: unknown; ex?: number }>,
  bytes: Buffer.alloc(0),
  download: 'ok' as 'ok' | 'error',
  downloads: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/gemini', () => ({
  getGemini: () => (h.client ? { models: { generateContent: async ({ model }: { model: string }) => { h.calls.push(model); return h.answers[model]() } } } : null),
}))
vi.mock('@/lib/ai-guard', () => ({ chargeAiPhotoCheck: async (lane: string) => { h.lanes.push(lane); return h.budget }, photoLaneOpen: async () => h.laneOpen }))
vi.mock('@/lib/sharp-lazy', () => ({ getSharp: async () => sharpLib }))
vi.mock('@/lib/db', () => ({ db: { complianceAudit: { findFirst: async () => { if (h.overrideThrows) throw new Error('db'); return h.override } } } }))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => { if (h.kvGetThrows) throw new Error('kv'); return h.cache.get(k) ?? null },
    set: async (key: string, value: unknown, o?: { ex?: number }) => {
      if (h.kvSetThrows) throw new Error('kv')
      h.sets.push({ key, value, ex: o?.ex }); h.cache.set(key, value); return 'OK'
    },
  },
}))
vi.mock('@/lib/supabase-admin', () => ({
  LISTINGS_BUCKET: 'listings',
  getSupabaseAdmin: () => ({ storage: { from: () => ({ download: async () => {
    h.downloads++
    return h.download === 'ok' ? { data: new Blob([new Uint8Array(h.bytes)]), error: null } : { data: null, error: new Error('gone') }
  } }) } }),
}))

const { clearPhotoContent, listingPhotoVerdict, photoClearances, rememberPhotoKey, sha256 } = await import('./listing-photo-verdict')
const { PHOTO_MODEL } = await import('./listing-photo-check')
const { GEMINI_MODEL } = await import('@/lib/gemini-model')

const FL = PHOTO_MODEL
const HY = GEMINI_MODEL
const facts = (o: Partial<PhotoFacts> = {}): PhotoFacts => ({ kind: 'camera_photo', advertises: false, overlayText: 'none', contact: [], websites: [], ...o })
const FLYER = facts({ kind: 'designed_graphic', advertises: true })
const say = (f: PhotoFacts) => async () => ({ text: JSON.stringify(f) })
const KEY = 'bulk/1791898094623-rh7bov-h0000000929000801.webp'
const DAY180 = 180 * 24 * 3600
const shaKey = (sha: string) => `listing-photo:v1:sha:${sha}`
const keyKey = (k: string) => `listing-photo:v1:key:${k}`
const ON = { lane: 'pass' as const, flyerRule: true }

beforeEach(async () => {
  Object.assign(h, { client: true, calls: [], lanes: [], budget: true, laneOpen: true, override: null, overrideThrows: false, kvGetThrows: false, kvSetThrows: false, sets: [], download: 'ok', downloads: 0 })
  h.answers = { [FL]: say(facts()), [HY]: say(facts()) }
  h.cache.clear()
  h.bytes = await sharpLib({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).png().toBuffer()
})

describe('listingPhotoVerdict — override, cache, budget, model', () => {
  it('an admin\'s "Photo is fine" on this listing wins over a cached refusal — nothing is read or asked', async () => {
    h.override = { id: BigInt(1) }
    h.cache.set(keyKey(KEY), { sha: 'abc' })
    h.cache.set(shaKey('abc'), { reads: [{ facts: FLYER, model: FL, at: 'x' }, { facts: FLYER, model: HY, at: 'x' }] })
    await expect(listingPhotoVerdict({ key: KEY }, { ...ON, listingId: 'L1' })).resolves.toEqual({ rule: 'ok', sha: null, overridden: true })
    expect(h.calls).toEqual([])
  })

  it('an override is per listing: without its id, the cached refusal stands', async () => {
    h.override = { id: BigInt(1) }
    h.cache.set(shaKey('abc'), { reads: [{ facts: FLYER, model: FL, at: 'x' }, { facts: FLYER, model: HY, at: 'x' }] })
    await expect(listingPhotoVerdict({ sha: 'abc', key: KEY }, ON)).resolves.toEqual({ rule: 'flyer', confirmed: true, sha: 'abc' })
  })

  it('cached by sha: the answer, with no download and no model call', async () => {
    h.cache.set(shaKey('abc'), { reads: [{ facts: facts({ contact: ['phone'] }), model: FL, at: 'x' }] })
    await expect(listingPhotoVerdict({ sha: 'abc' }, ON)).resolves.toEqual({ rule: 'contact', confirmed: false, sha: 'abc' })
    expect(h.calls).toEqual([])
    expect(h.downloads).toBe(0)
  })

  it('cached by object key → sha: a stored photo is never downloaded twice', async () => {
    h.cache.set(keyKey(KEY), { sha: 'abc' })
    h.cache.set(shaKey('abc'), { reads: [{ facts: facts(), model: FL, at: 'x' }] })
    await expect(listingPhotoVerdict({ key: KEY }, ON)).resolves.toEqual({ rule: 'ok', sha: 'abc' })
    expect(h.downloads).toBe(0)
    expect(h.sets).toEqual([])
  })

  it('⛔ facts, not verdicts: the same cached reads are a refusal on a rental and ok on a job', async () => {
    h.cache.set(shaKey('abc'), { reads: [{ facts: FLYER, model: FL, at: 'x' }, { facts: FLYER, model: HY, at: 'x' }] })
    await expect(listingPhotoVerdict({ sha: 'abc' }, ON)).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
    await expect(listingPhotoVerdict({ sha: 'abc' }, { ...ON, flyerRule: false })).resolves.toMatchObject({ rule: 'ok' })
  })

  it('a miss with the bytes in hand: one hedged read, charged to the lane, cached for 180 days by sha', async () => {
    h.answers[FL] = say(FLYER)
    const sha = sha256(h.bytes)
    await expect(listingPhotoVerdict({ bytes: h.bytes, sha }, { ...ON, lane: 'upload' })).resolves.toEqual({ rule: 'flyer', confirmed: false, sha })
    expect(h.calls).toEqual([FL])
    expect(h.lanes).toEqual(['upload'])
    expect(h.sets).toEqual([{ key: shaKey(sha), value: { reads: [expect.objectContaining({ facts: FLYER, model: FL })] }, ex: DAY180 }])
  })

  it('a stored photo seen for the first time: downloaded, hashed, read, and its key pointed at the sha', async () => {
    const sha = sha256(h.bytes)
    await expect(listingPhotoVerdict({ key: KEY }, ON)).resolves.toEqual({ rule: 'ok', sha })
    expect(h.downloads).toBe(1)
    expect(h.cache.get(keyKey(KEY))).toEqual({ sha })
    expect(h.cache.get(shaKey(sha))).toEqual({ reads: [expect.objectContaining({ model: FL })] })
  })

  it('a re-host of bytes already read (new key, same sha): no model call, the new key is pointed', async () => {
    const sha = sha256(h.bytes)
    h.cache.set(shaKey(sha), { reads: [{ facts: facts(), model: FL, at: 'x' }] })
    await expect(listingPhotoVerdict({ key: 'bulk/new.webp' }, ON)).resolves.toEqual({ rule: 'ok', sha })
    expect(h.calls).toEqual([])
    expect(h.cache.get(keyKey('bulk/new.webp'))).toEqual({ sha })
  })

  it('a kv that cannot be read is a miss — the check runs, never a guess; a cache that cannot be written still answers', async () => {
    h.kvGetThrows = true
    h.kvSetThrows = true
    await expect(listingPhotoVerdict({ bytes: h.bytes }, ON)).resolves.toMatchObject({ rule: 'ok' })
    expect(h.calls).toEqual([FL])
  })

  it('rememberPhotoKey points a stored key at the sha its upload was checked under', async () => {
    await rememberPhotoKey(KEY, 'abc')
    expect(h.sets).toEqual([{ key: keyKey(KEY), value: { sha: 'abc' }, ex: DAY180 }])
    h.kvSetThrows = true
    await expect(rememberPhotoKey(KEY, 'abc')).resolves.toBeUndefined()
  })
})

describe('clearPhotoContent — "Photo is fine" clears the bytes of the rule that refused them, for anyone', () => {
  const both = (f: PhotoFacts) => ({ reads: [{ facts: f, model: FL, at: 'x' }, { facts: f, model: HY, at: 'x' }] })

  it('⛔ a refused sha → an admin clears its key of flyer → the same bytes uploaded again are accepted, and on a new key at save', async () => {
    const sha = sha256(h.bytes)
    await rememberPhotoKey(KEY, sha)
    h.cache.set(shaKey(sha), both(FLYER))
    const upload = { lane: 'upload' as const, flyerRule: true, confirm: 'parallel' as const }
    await expect(listingPhotoVerdict({ bytes: h.bytes, sha }, upload)).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
    await expect(clearPhotoContent(await photoClearances(KEY, ['flyer']), 'mod@eno.vn')).resolves.toBe(true)
    expect(h.cache.has(`listing-photo:v1:cleared:flyer:${sha}`)).toBe(true)
    await expect(listingPhotoVerdict({ bytes: h.bytes, sha }, upload)).resolves.toEqual({ rule: 'ok', sha, overridden: true })
    // The re-upload is stored under a new key pointing at the same bytes: the save-time screen (cache only) accepts it.
    await rememberPhotoKey('bulk/new.webp', sha)
    await expect(listingPhotoVerdict({ key: 'bulk/new.webp' }, { ...ON, cacheOnly: true })).resolves.toMatchObject({ rule: 'ok' })
    expect(h.calls).toEqual([])
  })

  it('⛔ cleared on a JOB listing (only contact refuses there): the same bytes are still a flyer in another category', async () => {
    const sha = sha256(h.bytes)
    await rememberPhotoKey(KEY, sha)
    h.cache.set(shaKey(sha), both(facts({ kind: 'designed_graphic', advertises: true, contact: ['phone'] })))
    const jobs = { ...ON, flyerRule: false }
    await expect(listingPhotoVerdict({ key: KEY }, jobs)).resolves.toMatchObject({ rule: 'contact', confirmed: true })
    // The job listing's audit says contact: that rule alone is cleared.
    await clearPhotoContent(await photoClearances(KEY, ['contact']), 'mod@eno.vn')
    await expect(listingPhotoVerdict({ key: KEY }, jobs)).resolves.toEqual({ rule: 'ok', sha, overridden: true })
    await expect(listingPhotoVerdict({ bytes: h.bytes, sha }, { lane: 'upload', flyerRule: true, confirm: 'parallel' })).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
    expect(h.calls).toEqual([])
  })

  it('⛔ a contact clearance lets the same bytes through for contact only — never a flyer clearance', async () => {
    const sha = sha256(h.bytes)
    await rememberPhotoKey(KEY, sha)
    h.cache.set(shaKey(sha), both(facts({ contact: ['phone'] })))
    await clearPhotoContent(await photoClearances(KEY, ['contact']), 'mod@eno.vn')
    expect(h.cache.has(`listing-photo:v1:cleared:flyer:${sha}`)).toBe(false)
    await expect(listingPhotoVerdict({ key: KEY }, ON)).resolves.toEqual({ rule: 'ok', sha, overridden: true })
    // Other bytes, cleared of nothing, still show their contact.
    h.cache.set(shaKey('other'), both(facts({ contact: ['phone'] })))
    await expect(listingPhotoVerdict({ sha: 'other' }, ON)).resolves.toMatchObject({ rule: 'contact', confirmed: true })
  })

  it('no key → sha pointer known: nothing cleared (the per-listing override still holds)', async () => {
    expect(await photoClearances('unknown.webp', ['flyer'])).toEqual([])
    await expect(clearPhotoContent([], 'mod@eno.vn')).resolves.toBe(false)
  })
})

describe('listingPhotoVerdict — the two-read confirmation', () => {
  it("'after': the first read refuses, the other model reads it too; both refuse → confirmed, both cached, both charged", async () => {
    h.answers = { [FL]: say(FLYER), [HY]: say(facts({ kind: 'photo_of_printed_matter', advertises: true })) }
    const r = await listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'after' })
    expect(r).toMatchObject({ rule: 'flyer', confirmed: true })
    expect(h.calls).toEqual([FL, HY])
    expect(h.lanes).toEqual(['pass', 'pass'])
    expect((h.cache.get(shaKey(sha256(h.bytes))) as { reads: unknown[] }).reads).toHaveLength(2)
  })

  it("'after': the other model disagrees → ok", async () => {
    h.answers = { [FL]: say(FLYER), [HY]: say(facts()) }
    await expect(listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'after' })).resolves.toMatchObject({ rule: 'ok' })
  })

  it("'after': a first read that is ok needs no second", async () => {
    await listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'after' })
    expect(h.calls).toEqual([FL])
  })

  it("'after' on a cached lone refusal: only the missing model is asked", async () => {
    const sha = sha256(h.bytes)
    h.cache.set(shaKey(sha), { reads: [{ facts: FLYER, model: FL, at: 'x' }] })
    h.answers[HY] = say(FLYER)
    await expect(listingPhotoVerdict({ bytes: h.bytes, sha }, { ...ON, confirm: 'after' })).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
    expect(h.calls).toEqual([HY])
  })

  it("'parallel': both models at once (Publish), both charged", async () => {
    h.answers = { [FL]: say(facts({ contact: ['phone'] })), [HY]: say(facts({ contact: ['messaging_handle'] })) }
    await expect(listingPhotoVerdict({ bytes: h.bytes }, { ...ON, lane: 'upload', confirm: 'parallel' })).resolves.toMatchObject({ rule: 'contact', confirmed: true })
    expect([...h.calls].sort()).toEqual([FL, HY].sort())
    expect(h.lanes).toEqual(['upload', 'upload'])
  })

  it("'after': a hedge that already asked both models confirms from those two — no model is asked (or paid) twice", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const late = (ms: number) => () => new Promise((r) => setTimeout(() => r({ text: JSON.stringify(FLYER) }), ms))
      h.answers = { [FL]: late(4_500), [HY]: late(1_000) }
      const p = listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'after' })
      await vi.waitFor(() => expect(h.calls).toEqual([FL]), { interval: 1 })
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(p).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
      expect(h.calls).toEqual([FL, HY])
      expect(h.lanes).toEqual(['pass', 'pass'])
    } finally { vi.useRealTimers() }
  })

  it('a confirming read that fails leaves the refusal unconfirmed — no caller acts on it', async () => {
    h.answers = { [FL]: say(FLYER), [HY]: async () => { throw new Error('quota') } }
    await expect(listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'after' })).resolves.toMatchObject({ rule: 'flyer', confirmed: false })
  })
})

describe("listingPhotoVerdict — ⛔ every failure is 'unavailable', never a reason", () => {
  it.each([
    ['the override cannot be read', () => { h.overrideThrows = true }],
    ['the download fails', () => { h.download = 'error' }],
    ['the bytes do not decode', () => { h.bytes = Buffer.from('not an image') }],
    ['both models fail', () => { h.answers = { [FL]: async () => { throw new Error('a') }, [HY]: async () => ({ text: 'nope' }) } }],
    ['no Gemini client is configured', () => { h.client = false }],
  ])('%s', async (_why, set) => {
    set()
    await expect(listingPhotoVerdict({ key: KEY }, { ...ON, listingId: 'L1' })).resolves.toBe('unavailable')
    expect(h.cache.get(shaKey(sha256(h.bytes)))).toBeUndefined()
  })

  it('no bytes and no key: nothing to read', async () => {
    await expect(listingPhotoVerdict({ sha: 'abc' }, ON)).resolves.toBe('unavailable')
  })

  it('no client, but a cached read: the cache still answers', async () => {
    h.client = false
    h.cache.set(shaKey('abc'), { reads: [{ facts: FLYER, model: FL, at: 'x' }] })
    await expect(listingPhotoVerdict({ sha: 'abc', bytes: h.bytes }, { ...ON, confirm: 'after' })).resolves.toMatchObject({ rule: 'flyer', confirmed: false })
  })

  it("past the deadline: 'unavailable' — and the read still lands in the cache for next time", async () => {
    let release: () => void = () => {}
    h.answers[FL] = () => new Promise((r) => { release = () => r({ text: JSON.stringify(facts()) }) })
    await expect(listingPhotoVerdict({ bytes: h.bytes }, { ...ON, deadlineMs: 20 })).resolves.toBe('unavailable')
    release()
    await vi.waitFor(() => expect(h.cache.get(shaKey(sha256(h.bytes)))).toBeDefined())
  })
})

describe("listingPhotoVerdict — a spent lane is 'budget', and costs nothing more", () => {
  it('a lane already spent: no download, no charge, no model call', async () => {
    h.laneOpen = false
    await expect(listingPhotoVerdict({ key: KEY }, { ...ON, confirm: 'after' })).resolves.toBe('budget')
    expect([h.downloads, h.lanes.length, h.calls.length]).toEqual([0, 0, 0])
  })

  it('a charge refused: the hedge starts no backup — one refused charge, no model call', async () => {
    h.budget = false
    await expect(listingPhotoVerdict({ key: KEY }, { ...ON, confirm: 'after' })).resolves.toBe('budget')
    expect(h.lanes).toEqual(['pass'])
    expect(h.calls).toEqual([])
  })

  it('the cache still answers on a spent lane', async () => {
    h.laneOpen = false
    h.cache.set(shaKey('abc'), { reads: [{ facts: facts(), model: FL, at: 'x' }] })
    await expect(listingPhotoVerdict({ sha: 'abc' }, { ...ON, confirm: 'after' })).resolves.toEqual({ rule: 'ok', sha: 'abc' })
  })
})

describe("listingPhotoVerdict — 'both' (a photo that held its listing)", () => {
  const both = { ...ON, confirm: 'both' as const }
  it('a cached ok from one model is not enough: the other is asked, and both ok → ok', async () => {
    const sha = sha256(h.bytes)
    h.cache.set(shaKey(sha), { reads: [{ facts: facts(), model: FL, at: 'x' }] })
    await expect(listingPhotoVerdict({ bytes: h.bytes, sha }, both)).resolves.toEqual({ rule: 'ok', sha })
    expect(h.calls).toEqual([HY])
  })

  it('⛔ one model still refusing keeps it refused (confirmed), where a plain read would say ok', async () => {
    h.answers = { [FL]: say(facts()), [HY]: say(FLYER) }
    await expect(listingPhotoVerdict({ bytes: h.bytes }, both)).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
    expect(h.calls).toEqual([FL, HY])
  })

  it('only one read to be had: unavailable, never ok', async () => {
    h.answers = { [FL]: say(facts()), [HY]: async () => { throw new Error('quota') } }
    await expect(listingPhotoVerdict({ bytes: h.bytes }, both)).resolves.toBe('unavailable')
  })
})

describe('listingPhotoVerdict — the cache only, and a member’s own cap', () => {
  it('cacheOnly: a cached answer stands; a miss is unavailable with no download and no model call', async () => {
    h.cache.set(shaKey('abc'), { reads: [{ facts: FLYER, model: FL, at: 'x' }, { facts: FLYER, model: HY, at: 'x' }] })
    await expect(listingPhotoVerdict({ sha: 'abc' }, { ...ON, cacheOnly: true })).resolves.toMatchObject({ rule: 'flyer', confirmed: true })
    await expect(listingPhotoVerdict({ key: KEY, bytes: h.bytes }, { ...ON, cacheOnly: true, confirm: 'parallel' })).resolves.toBe('unavailable')
    expect(h.calls).toEqual([])
    expect(h.downloads).toBe(0)
  })

  it('beforeRead is asked once, before any paid read — false leaves the cache only', async () => {
    const asked: number[] = []
    const gate = (ok: boolean) => async () => { asked.push(1); return ok }
    await expect(listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'parallel', beforeRead: gate(false) })).resolves.toBe('unavailable')
    expect(h.calls).toEqual([])
    await expect(listingPhotoVerdict({ bytes: h.bytes }, { ...ON, confirm: 'parallel', beforeRead: gate(true) })).resolves.toMatchObject({ rule: 'ok' })
    expect(h.calls).toHaveLength(2)
    expect(asked).toHaveLength(2)
  })

  it('a cache hit never asks beforeRead (a member’s cap is spent only on paid reads)', async () => {
    const sha = sha256(h.bytes)
    h.cache.set(shaKey(sha), { reads: [{ facts: facts(), model: FL, at: 'x' }] })
    let asked = 0
    await listingPhotoVerdict({ bytes: h.bytes, sha }, { ...ON, beforeRead: async () => { asked++; return true } })
    expect(asked).toBe(0)
  })
})
