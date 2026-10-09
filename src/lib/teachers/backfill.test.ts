import { describe, expect, it } from 'vitest'
import { applyReviewedPlan, hashOf, type Db, type Journal, type PlanFile } from '../../../scripts/teachers-backfill'
import { planTeacherBackfill, type BackfillDecision, type TeacherRow } from './projection'

/**
 * scripts/teachers-backfill.ts --apply (gate review, 2026-10-09) — the step the deploy waits on. The new code has no
 * adapter for a row it has not migrated, so the apply FAILS CLOSED: a refused row (changed since the reviewed dry run), or
 * an unmigrated profile the plan does not carry, ends it with STOP and exit 1 — never "NEXT: deploy" and exit 0, which is
 * how it ended before. And the rows it did commit are tombstoned even when a later row throws.
 */
const category = { name: 'Teachers', nameVi: 'Giáo viên' }
/** An unmigrated row as the old code wrote it (projection.test.ts has the full demo and real rows). */
const oldRow = (id: string, o: Record<string, unknown> = {}): TeacherRow => ({
  id, profileId: `p-${id}`, listingId: `l-${id}`, situationVersion: null, createdAt: new Date('2026-10-01T00:00:00Z'),
  fullName: 'Real Teacher', headline: 'English teacher in Hanoi', bio: '', photoUrl: 'https://sb.eno.vn/x.webp', videoUrl: null,
  videoOnRequest: false, nationality: 'US', nativeSpeaker: true, languages: [], currentCity: 'ha-noi', currentDistrict: null,
  preferredCities: ['ha-noi'], openToOnline: false, availableFrom: null, jobTypes: ['fulltime'], ageGroups: ['kids'],
  subjects: ['general-english'], yearsExperience: 4, experience: [], degreeLevel: null, degreeMajor: null, degreeInstitution: null,
  degreeYear: null, certificates: [], expectedSalaryM: null, coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null,
  coverConsentVersion: null, livesIn: null, currentProvince: null, currentDistrictKey: null, teachAreas: [], teachLanguages: [],
  englishLevel: null, experienceBand: null,
  ...o,
})
const listingOf = (id: string) => ({ id: `l-${id}`, city: 'Hà Nội', district: null, location: 'Hanoi', facetTokens: '|workIn:ha-noi|', searchText: 'real teacher', status: 'active', verified: true })
const decision: BackfillDecision = { livesIn: 'city' }

/** The reviewed plan entry for a row as the dry run saw it. */
const planned = (row: TeacherRow) => {
  const plan = planTeacherBackfill(row, category, decision, true)
  return { id: String(row.id), profileId: String(row.profileId), decision, hash: hashOf(row, listingOf(String(row.id)), decision, plan), plan }
}

/** A Postgres stand-in: the profiles and listings above, the statements it saw, and the ISR tags written. */
function fakeDb(rows: TeacherRow[], opts: { failProfileUpdate?: string; failTombstones?: boolean } = {}) {
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  const tags: string[] = []
  const db: Db = {
    async query(sql: string, params: unknown[] = []) {
      if (/^select \* from "TeacherProfile" where id = \$1 and "situationVersion" is null/.test(sql)) {
        const r = byId.get(String(params[0]))
        return { rows: r && r.situationVersion == null ? [r] : [], rowCount: r ? 1 : 0 }
      }
      if (/from "Listing" where id = \$1/.test(sql)) return { rows: [listingOf(String(params[0]).slice(2))], rowCount: 1 }
      if (/^update "TeacherProfile"/.test(sql)) {
        if (params[0] === opts.failProfileUpdate) throw new Error('connection reset')
        byId.get(String(params[0]))!.situationVersion = 1
        return { rows: [], rowCount: 1 }
      }
      if (/^update "Listing"/.test(sql)) return { rows: [], rowCount: 1 }
      if (/to_regclass\('public\.next_cache_tag'\)/.test(sql)) return { rows: [{ t: 'next_cache_tag' }], rowCount: 1 }
      if (/insert into next_cache_tag/.test(sql)) {
        if (opts.failTombstones) throw new Error('permission denied for table next_cache_tag')
        tags.push(...(params[0] as string[])); return { rows: [], rowCount: 0 }
      }
      if (/^select id from "TeacherProfile" where "situationVersion" is null/.test(sql)) {
        return { rows: [...byId.values()].filter((r) => r.situationVersion == null).map((r) => ({ id: r.id })), rowCount: null }
      }
      return { rows: [], rowCount: 0 } // begin, commit, rollback, set local, the advisory lock
    },
  }
  return { db, tags }
}
const journal = () => {
  const j = { entries: [] as Record<string, unknown>[], closed: false }
  const api: Journal = { append: (e) => { j.entries.push(e) }, close: () => { j.closed = true } }
  return { j, api }
}
const run = async (db: Db, file: PlanFile, jr: Journal) => {
  const lines: string[] = []
  const code = await applyReviewedPlan(db, file, category, jr, (l) => lines.push(l))
  return { code, out: lines.join('\n') }
}

describe('scripts/teachers-backfill.ts --apply', () => {
  it('a clean apply migrates every row, tombstones their pages and says NEXT: deploy (exit 0)', async () => {
    const a = oldRow('a')
    const b = oldRow('b')
    const file: PlanFile = { generatedAt: 'x', rows: [planned(a), planned(b)] }
    const { db, tags } = fakeDb([a, b])
    const { j, api } = journal()
    const { code, out } = await run(db, file, api)
    expect(code).toBe(0)
    expect(out).toContain('NEXT: deploy')
    expect(tags).toEqual(expect.arrayContaining(['eno:isrtag:_N_T_/en/listings/l-a', 'eno:isrtag:_N_T_/vi/listings/l-b']))
    expect(j.entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect(j.closed).toBe(true)
  })

  it('⛔ tombstones that could not be written end the run STOP, exit 1 — the rows are migrated, but never "NEXT: deploy" (codex)', async () => {
    const a = oldRow('a')
    const { db } = fakeDb([a], { failTombstones: true })
    const { code, out } = await run(db, { generatedAt: 'x', rows: [planned(a)] }, journal().api)
    expect(a.situationVersion).toBe(1)
    expect(code).toBe(1)
    expect(out).toContain('run --purge first')
    expect(out).not.toContain('NEXT: deploy')
  })

  it('⛔ a row changed since the reviewed dry run is REFUSED — and the run ends STOP, exit 1, never "NEXT: deploy"', async () => {
    const a = oldRow('a')
    const b = oldRow('b')
    const file: PlanFile = { generatedAt: 'x', rows: [planned(a), planned(b)] }
    b.bio = 'edited through the old form after the dry run' // its hash moves
    const { db, tags } = fakeDb([a, b])
    const { code, out } = await run(db, file, journal().api)
    expect(code).toBe(1)
    expect(out).toContain('REFUSED b')
    expect(out).toContain('STOP')
    expect(out).not.toContain('NEXT: deploy')
    expect(b.situationVersion).toBeNull()
    // …while the row it did migrate is tombstoned all the same
    expect(tags).toContain('eno:isrtag:_N_T_/en/listings/l-a')
  })

  it('⛔ an unmigrated profile the plan does not carry (made after the dry run) stops the deploy too', async () => {
    const a = oldRow('a')
    const late = oldRow('late')
    const { db } = fakeDb([a, late])
    const { code, out } = await run(db, { generatedAt: 'x', rows: [planned(a)] }, journal().api)
    expect(code).toBe(1)
    expect(out).toContain('Unmigrated: late')
    expect(out).not.toContain('NEXT: deploy')
  })

  it('⛔ a failure on a later row still tombstones the rows already committed, and closes the journal', async () => {
    const a = oldRow('a')
    const b = oldRow('b')
    const file: PlanFile = { generatedAt: 'x', rows: [planned(a), planned(b)] }
    const { db, tags } = fakeDb([a, b], { failProfileUpdate: 'b' })
    const { j, api } = journal()
    await expect(run(db, file, api)).rejects.toThrow('connection reset')
    expect(a.situationVersion).toBe(1)
    expect(tags).toContain('eno:isrtag:_N_T_/en/listings/l-a')
    expect(tags).not.toContain('eno:isrtag:_N_T_/en/listings/l-b')
    expect(j.closed).toBe(true)
  })
})
