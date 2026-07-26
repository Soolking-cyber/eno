import { beforeEach, describe, expect, it, vi } from 'vitest'

// Deterministic stop editing. The two properties the task names — a reorder cannot duplicate a
// position, and a concurrent edit loses cleanly — are the two the unique index makes hard, so they
// are tested against a mock that ENFORCES that index rather than one that merely records calls.

const h = vi.hoisted(() => ({
  state: {
    // dayId -> ordered stops, as the table holds them.
    days: {} as Record<string, Array<{ id: string; position: number }>>,
    dayMeta: {} as Record<string, { profileId: string; itineraryId: string }>,
    statements: [] as string[],
    // Fires once, between the ownership read and the staging write: the concurrent editor.
    mutateBeforeWrite: null as null | (() => void),
  },
}))

/** The real unique index, enforced in the mock. Without this the tests would pass against SQL
 *  Postgres would reject — which is exactly how a staging bug ships. */
function assertUnique(dayId: string) {
  const seen = new Set<number>()
  for (const stop of h.state.days[dayId] ?? []) {
    if (seen.has(stop.position)) {
      throw Object.assign(new Error(`duplicate position ${stop.position}`), { code: '23505' })
    }
    seen.add(stop.position)
  }
}

vi.mock('@/lib/db', () => {
  const tx = {
    itineraryDay: {
      findFirst: async ({ where }: any) => {
        const day = h.state.dayMeta[where.id]
        if (!day) return null
        // Honour BOTH halves of the predicate — the profile AND the itinerary in the path.
        if (day.profileId !== where.itinerary.profileId) return null
        if (where.itineraryId !== undefined && day.itineraryId !== where.itineraryId) return null
        return { id: where.id }
      },
    },
    itineraryStop: {
      findMany: async ({ where }: any) =>
        [...(h.state.days[where.dayId] ?? [])].sort((a, b) => a.position - b.position).map((s) => ({ ...s })),
      deleteMany: async ({ where }: any) => {
        // The hook fires before the FIRST write, whichever it is — a delete race happens between
        // the ownership read and this statement, not later.
        if (h.state.mutateBeforeWrite) { h.state.mutateBeforeWrite(); h.state.mutateBeforeWrite = null }
        const list = h.state.days[where.dayId] ?? []
        const before = list.length
        h.state.days[where.dayId] = list.filter((s) => s.id !== where.id)
        return { count: before - h.state.days[where.dayId].length }
      },
    },
    // The two staging statements, interpreted rather than merely counted.
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      h.state.statements.push(sql.replace(/\s+/g, ' ').trim())
      if (h.state.mutateBeforeWrite) { h.state.mutateBeforeWrite(); h.state.mutateBeforeWrite = null }

      if (sql.includes('unnest')) {
        const [ids, oldPositions, newPositions, dayId] = values as [string[], number[], number[], string]
        const list = h.state.days[dayId] ?? []
        // ⚠️ HONOUR THE SQL, DO NOT REIMPLEMENT ITS INTENT. This used to compare positions
        // unconditionally, which meant the compare-and-set tests passed even with the predicate
        // DELETED from the real query — a mock asserting its own good intentions. The predicate is
        // now applied only when the statement actually asks for it.
        const casOnPosition = sql.includes('v.old_pos')
        let matched = 0
        ids.forEach((id, i) => {
          const row = list.find((s) => s.id === id && (!casOnPosition || s.position === oldPositions[i]))
          if (!row) return
          row.position = newPositions[i]
          matched += 1
        })
        assertUnique(dayId)
        return matched
      }
      // The flip back out of the negative range.
      const dayId = values[0] as string
      const list = h.state.days[dayId] ?? []
      let n = 0
      for (const row of list) {
        if (row.position < 0) { row.position = -row.position - 1; n += 1 }
      }
      assertUnique(dayId)
      return n
    },
  }
  return { db: { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } }
})

import { deleteStop, reorderStop, swapStops } from './reorder'

const DAY = 'day-1'
const ITIN = 'itin-1'
const ME = 'traveller'
const order = () => [...h.state.days[DAY]].sort((a, b) => a.position - b.position).map((s) => s.id)
const positions = () => [...h.state.days[DAY]].sort((a, b) => a.position - b.position).map((s) => s.position)

beforeEach(() => {
  h.state.days = { [DAY]: [
    { id: 's0', position: 0 }, { id: 's1', position: 1 }, { id: 's2', position: 2 }, { id: 's3', position: 3 },
  ] }
  h.state.dayMeta = { [DAY]: { profileId: ME, itineraryId: ITIN } }
  h.state.statements = []
  h.state.mutateBeforeWrite = null
})

describe('a reorder can never duplicate a position', () => {
  it('moves a stop and leaves positions 0..n-1 exactly once each', async () => {
    const result = await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId: 's0', toIndex: 3, profileId: ME })
    expect(result.ok).toBe(true)
    expect(order()).toEqual(['s1', 's2', 's3', 's0'])
    expect(positions()).toEqual([0, 1, 2, 3])
  })

  it.each([
    ['first to last', 's0', 3, ['s1', 's2', 's3', 's0']],
    ['last to first', 's3', 0, ['s3', 's0', 's1', 's2']],
    ['middle forward', 's1', 2, ['s0', 's2', 's1', 's3']],
    ['middle backward', 's2', 0, ['s2', 's0', 's1', 's3']],
    ['no-op index', 's1', 1, ['s0', 's1', 's2', 's3']],
  ])('%s keeps a gap-free ordering', async (_label, stopId, toIndex, expected) => {
    const result = await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId, toIndex, profileId: ME })
    expect(result.ok).toBe(true)
    expect(order()).toEqual(expected)
    expect(positions()).toEqual([0, 1, 2, 3])
  })

  it('stages through the NEGATIVE range — two statements, never a direct permutation', async () => {
    // Measured on the real table before this was written: a single permuting UPDATE fails with
    // 23505 because Postgres checks the unique index per row as the statement runs. The staging
    // pass is not an optimisation, it is the only thing that works without a deferrable
    // constraint — and there is no constraint to defer, only a Prisma-created unique index.
    await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId: 's0', toIndex: 2, profileId: ME })
    expect(h.state.statements).toHaveLength(2)
    expect(h.state.statements[0]).toContain('unnest')
    expect(h.state.statements[1]).toContain('position < 0')
  })

  it('a swap is the same primitive, not a third write path', async () => {
    const result = await swapStops({ dayId: DAY, itineraryId: ITIN, stopIdA: 's0', stopIdB: 's2', profileId: ME })
    expect(result.ok).toBe(true)
    expect(order()).toEqual(['s2', 's1', 's0', 's3'])
    expect(positions()).toEqual([0, 1, 2, 3])
  })

  it('a delete closes the gap rather than leaving a hole', async () => {
    const result = await deleteStop({ dayId: DAY, itineraryId: ITIN, stopId: 's1', profileId: ME })
    expect(result.ok).toBe(true)
    expect(order()).toEqual(['s0', 's2', 's3'])
    expect(positions()).toEqual([0, 1, 2])
  })

  it('deleting the last stop leaves an empty, still-consistent day', async () => {
    for (const id of ['s0', 's1', 's2', 's3']) {
      expect((await deleteStop({ dayId: DAY, itineraryId: ITIN, stopId: id, profileId: ME })).ok).toBe(true)
    }
    expect(order()).toEqual([])
  })
})

describe('a concurrent edit loses cleanly', () => {
  it('REFUSES when another editor reordered between the read and the write', async () => {
    // The compare-and-set lives in the staging WHERE: each row is matched on its EXPECTED position.
    h.state.mutateBeforeWrite = () => {
      h.state.days[DAY] = [
        { id: 's3', position: 0 }, { id: 's0', position: 1 }, { id: 's1', position: 2 }, { id: 's2', position: 3 },
      ]
    }
    const result = await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId: 's0', toIndex: 3, profileId: ME })
    expect(result).toEqual({ ok: false, error: 'stale' })
  })

  it('leaves the other editor’s ordering intact and gap-free after losing', async () => {
    const theirOrder = [
      { id: 's3', position: 0 }, { id: 's0', position: 1 }, { id: 's1', position: 2 }, { id: 's2', position: 3 },
    ]
    h.state.mutateBeforeWrite = () => { h.state.days[DAY] = theirOrder.map((s) => ({ ...s })) }
    await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId: 's0', toIndex: 3, profileId: ME })
    // Nothing half-applied: the loser wrote nothing, so the winner's order stands.
    expect(order()).toEqual(['s3', 's0', 's1', 's2'])
    expect(positions()).toEqual([0, 1, 2, 3])
  })

  it('REFUSES a delete of a stop another editor already removed', async () => {
    h.state.mutateBeforeWrite = () => { h.state.days[DAY] = h.state.days[DAY].filter((s) => s.id !== 's1') }
    const result = await deleteStop({ dayId: DAY, itineraryId: ITIN, stopId: 's1', profileId: ME })
    expect(result.ok).toBe(false)
  })
})

describe('ownership and legality', () => {
  it('refuses a day that is not the callers — and answers the same for one that does not exist', async () => {
    const theirs = await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId: 's0', toIndex: 1, profileId: 'someone-else' })
    const missing = await reorderStop({ dayId: 'no-such-day', itineraryId: ITIN, stopId: 's0', toIndex: 1, profileId: ME })
    expect(theirs).toEqual({ ok: false, error: 'not_found' })
    expect(theirs).toEqual(missing)
    expect(order()).toEqual(['s0', 's1', 's2', 's3'])
  })

  it('refuses a day that belongs to a DIFFERENT itinerary than the path names', async () => {
    // Without the itineraryId predicate a caller could edit any day they own through any itinerary
    // id, and the route's own URL would be a lie.
    const result = await reorderStop({ dayId: DAY, itineraryId: 'another-itinerary', stopId: 's0', toIndex: 1, profileId: ME })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(order()).toEqual(['s0', 's1', 's2', 's3'])
  })

  it.each([
    ['a stop not in this day', 's-nope', 1],
    ['a negative index', 's0', -1],
    ['an index past the end', 's0', 4],
    ['a fractional index', 's0', 1.5],
  ])('rejects %s without writing', async (_label, stopId, toIndex) => {
    const result = await reorderStop({ dayId: DAY, itineraryId: ITIN, stopId, toIndex, profileId: ME })
    expect(result).toEqual({ ok: false, error: 'invalid_order' })
    expect(h.state.statements).toHaveLength(0)
  })

  it('rejects swapping a stop with itself', async () => {
    expect(await swapStops({ dayId: DAY, itineraryId: ITIN, stopIdA: 's1', stopIdB: 's1', profileId: ME }))
      .toEqual({ ok: false, error: 'invalid_order' })
  })

  it('rejects deleting a stop that is not in this day', async () => {
    expect(await deleteStop({ dayId: DAY, itineraryId: ITIN, stopId: 's-nope', profileId: ME }))
      .toEqual({ ok: false, error: 'invalid_order' })
  })
})
