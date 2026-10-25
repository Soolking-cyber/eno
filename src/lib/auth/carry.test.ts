import { beforeEach, describe, expect, it, vi } from 'vitest'

// A teacher's step-1 answers, carried out of an app's built-in browser under a token (carry.ts): stored ONCE (NX) under a
// HASH of the token, for 30 minutes; read back as often as needed (a lost response or a reload asks again), and dropped
// when the form there has them.
const h = vi.hoisted(() => ({
  sets: [] as Array<{ key: string; value: unknown; opts: unknown }>,
  setWins: true,
  gets: [] as string[],
  stored: null as unknown,
  dels: [] as string[],
  sql: [] as Array<{ text: string; values: unknown[] }>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: { $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.sql.push({ text: strings.join('?'), values }); return 1 } },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    set: async (key: string, value: unknown, opts: unknown) => { h.sets.push({ key, value, opts }); return h.setWins ? 'OK' : null },
    get: async (key: string) => { h.gets.push(key); return h.stored },
    del: async (key: string) => { h.dels.push(key) },
  },
}))

const { CARRY_TOKEN_RE, CARRY_TTL_S, CARRY_VALUE_RE, canonicalCarry, dropCarry, putCarry, readCarry } = await import('./carry')
const { decodeHandoff } = await import('@/components/teachers/teacher-form-rules')
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

const TOKEN = 'T'.repeat(43)
beforeEach(() => { h.sets = []; h.setWins = true; h.gets = []; h.stored = null; h.dels = []; h.sql = [] })

describe('carry — step-1 answers for the phone\'s own browser', () => {
  it('stores once (NX) for 30 minutes, under a hash of the token — never the token itself', async () => {
    expect(await putCarry(TOKEN, 'eyJ2IjoyfQ')).toBe(true)
    expect(h.sets).toHaveLength(1)
    const { key, value, opts } = h.sets[0]
    expect(key).toMatch(/^carry:[0-9a-f]{64}$/)
    expect(key).not.toContain(TOKEN)
    expect(value).toBe('eyJ2IjoyfQ')
    expect(opts).toEqual({ nx: true, ex: CARRY_TTL_S })
    expect(CARRY_TTL_S).toBe(1800)
  })

  it('a token already holding a carry is not overwritten: false', async () => {
    h.setWins = false
    expect(await putCarry(TOKEN, 'x')).toBe(false)
  })

  it('⛔ the read is REPEATABLE (a lost response or a reload asks again) — same hashed key, nothing deleted by it', async () => {
    await putCarry(TOKEN, 'x')
    h.stored = 'eyJ2IjoyfQ'
    expect(await readCarry(TOKEN)).toBe('eyJ2IjoyfQ')
    expect(await readCarry(TOKEN)).toBe('eyJ2IjoyfQ')
    expect(h.gets).toEqual([h.sets[0].key, h.sets[0].key])
    expect(h.dels).toEqual([])
  })

  it('⛔ dropped on the form\'s word: a LIVE carry\'s value replaced by a tombstone (the key stays, so no NX write gets back in) — never a row for a token nobody stored', async () => {
    await putCarry(TOKEN, 'x')
    await dropCarry(TOKEN)
    expect(h.sql).toHaveLength(1)
    expect(h.sql[0].text.replace(/\s+/g, ' ').trim()).toBe("UPDATE kv_store SET value = 'false'::jsonb WHERE key = ? AND (expires_at IS NULL OR expires_at > now())")
    expect(h.sql[0].values).toEqual([h.sets[0].key])
    expect(h.sets).toHaveLength(1) // no insert
    h.stored = false
    expect(await readCarry(TOKEN)).toBeNull()
  })

  it('⛔ canonicalCarry keeps step 1 alone — a name, a phone, a consent or any other field never reaches storage; junk is null', () => {
    const step1 = { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', jobTypes: ['fulltime'], relocate: 'no' }
    const crafted = b64({ v: 2, t: { ...step1, fullName: 'Mallory', phone: '+84911111111', bio: 'call me', matchEmailOptIn: true, coverConsent: true } })
    const c = canonicalCarry(crafted)!
    expect(canonicalCarry(c)).toBe(c) // stable: what is stored is already the form's own encoding
    // …and the page there restores exactly what it would have from the value sent — step 1 — and nothing else.
    const back = decodeHandoff(c)!
    expect(back).toEqual(decodeHandoff(crafted))
    expect(back.currentCity).toBe('ho-chi-minh-city')
    expect(back.jobTypes).toEqual(['fulltime'])
    expect(back.fullName).toBe('')
    expect(back.phone).toBe('')
    expect(Buffer.from(c, 'base64url').toString()).not.toMatch(/Mallory|84911111111|call me/)
    for (const junk of ['', 'not base64 json', b64('a string'), b64([1, 2]), 'x'.repeat(5000)]) expect(canonicalCarry(junk), junk.slice(0, 20)).toBeNull()
    // …nor a later step's answers or free text where step 1 holds only known keys (an older four-step fragment, or crafted):
    // what is left is the live #d= hand-over's own fields — known keys only (the teach areas among them).
    const later = b64({ v: 2, t: { ...step1, currentCity: 'x'.repeat(500), currentProvince: 'free text here', headline: 'Head', subjects: ['general-english'], experience: [{ role: 'r', org: 'o' }], teachAreas: ['ha-noi'], expectedSalaryM: 99 } })
    const lc = canonicalCarry(later)
    const text = lc ? Buffer.from(lc, 'base64url').toString() : ''
    expect(text).not.toMatch(/x{20}|free text here|"Head"|general-english|"role"|99/)
  })

  it('nothing there (never written, dropped, expired) — or anything that is not a carry value: null', async () => {
    expect(await readCarry(TOKEN)).toBeNull()
    for (const value of [false, 42, { a: 1 }, 'has spaces', 'x'.repeat(4097)]) {
      h.stored = value
      expect(await readCarry(TOKEN), JSON.stringify(value)).toBeNull()
    }
  })

  it('the shapes: a token is the hand-off nonce\'s (40–90 base64url), a value a bounded base64url string', () => {
    expect(CARRY_TOKEN_RE.test(TOKEN)).toBe(true)
    for (const bad of ['short', 'T'.repeat(91), `${'T'.repeat(42)}=`, `${'T'.repeat(42)}/`]) expect(CARRY_TOKEN_RE.test(bad), bad).toBe(false)
    expect(CARRY_VALUE_RE.test('eyJ2IjoyLCJ0Ijp7fX0')).toBe(true)
    for (const bad of ['', 'x'.repeat(4097), 'a b', 'a#b', 'a=b']) expect(CARRY_VALUE_RE.test(bad), bad).toBe(false)
  })
})
