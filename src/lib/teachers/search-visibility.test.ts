import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * setTeacherSearchHidden — the ONE writer of TeacherProfile.hideFromSearch (owner decision 14, 2026-10-20): one UPDATE keyed
 * on the account's own profile id that never moves @updatedAt (the matcher's seen-cache key and the JSON-LD's
 * dateModified) and writes ONLY A CHANGE, then a purge of the profile page in both languages so its robots tag follows. A
 * request that changes nothing writes and purges nothing (a hide is never rate-limited — review round 1). No profile → null.
 */
const h = vi.hoisted(() => ({
  queries: [] as { sql: string; values: unknown[] }[],
  /** What the conditional UPDATE returns: a row only when the switch moved. */
  rows: [{ listingId: 'L1' }] as { listingId: string | null }[],
  /** The row the no-change path reads back (null = no profile). */
  existing: { hideFromSearch: true } as { hideFromSearch: boolean } | null,
  reads: [] as unknown[],
  purged: [] as string[],
}))
vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      h.queries.push({ sql: strings.join('?'), values })
      return h.rows
    },
    teacherProfile: { findUnique: async (q: unknown) => { h.reads.push(q); return h.existing } },
  },
}))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))

const { setTeacherSearchHidden } = await import('./search-visibility')

beforeEach(() => { h.queries = []; h.rows = [{ listingId: 'L1' }]; h.existing = { hideFromSearch: true }; h.reads = []; h.purged = [] })

describe('setTeacherSearchHidden', () => {
  it('one conditional UPDATE of the switch alone, keyed on the account\'s profile id — never touching updatedAt', async () => {
    expect(await setTeacherSearchHidden('9b0c1e2a-0000-4000-8000-000000000001', true)).toEqual({ hidden: true })
    expect(h.queries).toHaveLength(1)
    const { sql, values } = h.queries[0]
    expect(sql.replace(/\s+/g, ' ').trim()).toBe('UPDATE "TeacherProfile" SET "hideFromSearch" = ? WHERE "profileId" = ?::uuid AND "hideFromSearch" IS DISTINCT FROM ? RETURNING "listingId"')
    expect(values).toEqual([true, '9b0c1e2a-0000-4000-8000-000000000001', true])
    expect(sql).not.toMatch(/updatedAt/)
    expect(h.reads).toEqual([])
  })

  it('⛔ a change purges the profile page (both languages through revalidatePublicPath), so its robots tag follows', async () => {
    await setTeacherSearchHidden('p', false)
    expect(h.purged).toEqual(['/listings/L1'])
  })

  it('⛔ a request that changes nothing writes nothing and purges nothing — and answers what is stored', async () => {
    h.rows = []
    expect(await setTeacherSearchHidden('p', true)).toEqual({ hidden: true })
    expect(h.purged).toEqual([])
    expect(h.reads).toEqual([{ where: { profileId: 'p' }, select: { hideFromSearch: true } }])
    // Moved by another window between the two reads: the answer is the stored value, never the request's.
    h.existing = { hideFromSearch: false }
    expect(await setTeacherSearchHidden('p', true)).toEqual({ hidden: false })
  })

  it('a profile with no listing: saved, nothing to purge', async () => {
    h.rows = [{ listingId: null }]
    expect(await setTeacherSearchHidden('p', true)).toEqual({ hidden: true })
    expect(h.purged).toEqual([])
  })

  it('no profile: null, and no purge', async () => {
    h.rows = []
    h.existing = null
    expect(await setTeacherSearchHidden('p', true)).toBeNull()
    expect(h.purged).toEqual([])
  })
})
