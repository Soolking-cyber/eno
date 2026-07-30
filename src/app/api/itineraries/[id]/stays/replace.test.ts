import { beforeEach, describe, expect, it, vi } from 'vitest'

// Swapping a hotel. The three properties an adversarial review of the plan named — the mutation
// itself is ownership-scoped, the compare-and-set sees a change to ANY column, and the Vietnamese
// copy of the old hotel does not survive the swap — are tested against a mock that evaluates the
// WHERE clause the way Postgres would, rather than one that records the call and returns success.

const h = vi.hoisted(() => ({
  state: {
    // stayId -> the row, plus the itinerary/owner it hangs off.
    rows: {} as Record<string, Record<string, unknown> & { itineraryId: string; ownerId: string }>,
    // Fires once, between the ownership read and the write: the concurrent editor.
    mutateBeforeWrite: null as null | (() => void),
  },
}))

/** The clauses `replaceStay` actually sends, evaluated as SQL would evaluate them: scalar equality,
 *  `null` meaning IS NULL, and the relation filter resolved through the row's owner. */
function matches(row: (typeof h.state.rows)[string], where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'id') continue
    if (key === 'itinerary') {
      const rel = expected as { profileId: string }
      if (row.ownerId !== rel.profileId) return false
      continue
    }
    // `undefined` is absent-from-the-query; `null` is IS NULL. Prisma distinguishes them and so must
    // this, or a CAS on a nullable column would silently pass.
    if (expected === undefined) continue
    if (row[key] !== expected) return false
  }
  return true
}

vi.mock('@/lib/db', () => ({
  db: {
    itineraryStay: {
      findFirst: async ({ where, select }: any) => {
        const row = h.state.rows[where.id]
        if (!row) return null
        if (!matches(row, where)) return null
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(select)) out[key] = row[key]
        return out
      },
      updateMany: async ({ where, data }: any) => {
        if (h.state.mutateBeforeWrite) { h.state.mutateBeforeWrite(); h.state.mutateBeforeWrite = null }
        const row = h.state.rows[where.id]
        if (!row) return { count: 0 }
        if (!matches(row, where)) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
    },
  },
}))

import { replaceStay } from './replace'

const REPLACEMENT = { name: 'Hotel B', area: 'District 3', note: 'Quieter street', estimatedNightly: 900_000 }

beforeEach(() => {
  h.state.mutateBeforeWrite = null
  h.state.rows = {
    stay1: {
      itineraryId: 'trip1',
      ownerId: 'owner',
      position: 0,
      name: 'Hotel A',
      nameVi: 'Khách sạn A',
      area: 'District 1',
      areaVi: 'Quận 1',
      note: 'Central',
      noteVi: 'Trung tâm',
      estimatedNightly: 1_200_000,
      currency: 'VND',
    },
  }
})

const call = (over: Partial<Parameters<typeof replaceStay>[0]> = {}) =>
  replaceStay({ itineraryId: 'trip1', stayId: 'stay1', profileId: 'owner', replacement: REPLACEMENT, ...over })

describe('replaceStay', () => {
  it('writes the replacement and forces the currency to VND', async () => {
    const result = await call()
    expect(result).toEqual({ ok: true })
    expect(h.state.rows.stay1).toMatchObject({ name: 'Hotel B', area: 'District 3', estimatedNightly: 900_000, currency: 'VND' })
  })

  it('clears the Vietnamese columns, which described the OLD hotel', async () => {
    await call()
    // The whole point: a vi reader must see the new hotel untranslated, never the old name against
    // the new price.
    expect(h.state.rows.stay1.nameVi).toBeNull()
    expect(h.state.rows.stay1.areaVi).toBeNull()
    expect(h.state.rows.stay1.noteVi).toBeNull()
  })

  it('refuses a stay that belongs to another traveller, and writes nothing', async () => {
    const result = await call({ profileId: 'someone-else' })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(h.state.rows.stay1.name).toBe('Hotel A')
  })

  it('refuses a stay that is not on the itinerary in the path', async () => {
    const result = await call({ itineraryId: 'other-trip' })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(h.state.rows.stay1.name).toBe('Hotel A')
  })

  it('answers not_found for a stay id that does not exist', async () => {
    expect(await call({ stayId: 'nope' })).toEqual({ ok: false, error: 'not_found' })
  })

  // ⚠️ THE POINT OF COMPARING EVERY COLUMN. A name-only predicate passes all four of these: the
  // review that demanded it called out A→B→A explicitly, and the note/price/currency cases are the
  // same defect wearing different columns.
  it.each([
    ['the name changed', () => { h.state.rows.stay1.name = 'Hotel Z' }],
    ['the note changed', () => { h.state.rows.stay1.note = 'Now noisy' }],
    ['the nightly price changed', () => { h.state.rows.stay1.estimatedNightly = 400_000 }],
    ['a null column was filled in', () => { h.state.rows.stay1.noteVi = 'Đã đổi' }],
    // No writer moves a stay today — which is why this was missing from the predicate until a
    // review of the finished diff caught it. The test exists so the first reordering feature cannot
    // quietly turn "any concurrent change loses" back into a false claim.
    ['the row was reordered', () => { h.state.rows.stay1.position = 3 }],
  ])('loses cleanly when %s under it', async (_label, mutate) => {
    h.state.mutateBeforeWrite = mutate
    const result = await call()
    expect(result).toEqual({ ok: false, error: 'stale' })
    // Not merely refused — the concurrent editor's value survived intact.
    expect(h.state.rows.stay1.name).not.toBe('Hotel B')
  })

  it('loses cleanly when the row moves to another itinerary between the read and the write', async () => {
    // The TOCTOU the ownership-in-the-mutation clause exists for: a check that passed at read time no
    // longer holds at write time, and the write must notice by itself.
    h.state.mutateBeforeWrite = () => { h.state.rows.stay1.itineraryId = 'trip2' }
    expect(await call()).toEqual({ ok: false, error: 'stale' })
    expect(h.state.rows.stay1.name).toBe('Hotel A')
  })

  it('reports update_failed rather than throwing when the database errors', async () => {
    h.state.mutateBeforeWrite = () => { throw new Error('connection reset') }
    expect(await call()).toEqual({ ok: false, error: 'update_failed' })
  })
})
