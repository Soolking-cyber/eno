import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COVER_LIMITS } from './cover'
import { MAX_TEACH_AREAS } from './places'

/**
 * scripts/teacher-cover-zalo-ddl.mjs (Hà Nội's districts, owner 2026-10-28): widens the two area CHECKs of an EXISTING
 * database from 40 to 60 — teachers-ddl.mjs's own bodies (compared here, word for word) — and ⛔ ONLY when the whole rule
 * is the 40 form (review, 2026-10-28). Its real `run()` is executed in PGlite: it widens a production-shaped table, re-runs
 * as a no-op, REFUSES a rule changed anywhere else (a language limit, a cap of another number) and rolls back the one it
 * had already widened, leaving everything as it was.
 */
const { run, WIDEN, OLD_CAP, NEW_CAP } = (await import('../../../scripts/teacher-cover-zalo-ddl.mjs')) as {
  run: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, log?: (m: string) => void) => Promise<Record<string, string>>
  WIDEN: [string, string][]
  OLD_CAP: number
  NEW_CAP: number
}
const ddl = readFileSync(join(process.cwd(), 'scripts/teachers-ddl.mjs'), 'utf8')
const script = readFileSync(join(process.cwd(), 'scripts/teacher-cover-zalo-ddl.mjs'), 'utf8')
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const body = (check: string, cap: number) => check.replace('{CAP}', String(cap))
/** teachers-ddl.mjs's CHECK body for a constraint (between `check (` and the `);` that closes the add). */
const ddlCheck = (name: string) => squash(new RegExp(`add constraint "${name}" check \\(([\\s\\S]*?)\\);\\s*end if;`).exec(ddl)![1]!)

describe('scripts/teacher-cover-zalo-ddl.mjs ↔ scripts/teachers-ddl.mjs', () => {
  it('widens exactly the two area CHECKs, from 40 to the app\'s caps, with teachers-ddl.mjs\'s own bodies', () => {
    expect(WIDEN.map(([n]) => n)).toEqual(['TeacherProfile_cover_bounds', 'TeacherProfile_teach_bounds'])
    expect([OLD_CAP, NEW_CAP]).toEqual([40, 60])
    expect(COVER_LIMITS.areas).toBe(NEW_CAP)
    expect(MAX_TEACH_AREAS).toBe(NEW_CAP)
    for (const [name, check] of WIDEN) expect(squash(body(check, NEW_CAP))).toBe(ddlCheck(name))
    expect(WIDEN.every(([, check]) => check.split('{CAP}').length === 2)).toBe(true)
  })
  it('drops nothing but the rule it replaces, touches no row, and runs only when executed', () => {
    const code = script.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code.match(/\bDROP CONSTRAINT\b/g)).toHaveLength(1)
    expect(code).not.toMatch(/drop\s+(table|column|index)/i)
    // The only other DROP is the scratch table's own ON COMMIT DROP.
    expect(code.match(/\bDROP\b/g)).toHaveLength(2)
    expect(code).toContain('CREATE TEMP TABLE "_cover_zalo_shape" (LIKE public."TeacherProfile") ON COMMIT DROP')
    expect(code).not.toMatch(/alter\s+column|\btruncate\b|\bupdate\s+public|\bdelete\s+from\b|\bgrant\b/i)
    expect(code).toMatch(/if \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href\)/)
  })
})

// ── RUN IN PGlite (Postgres 17, in-process): the script's own run() ──────────────────────────────────────────────────
type Pg = { query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>; exec: (sql: string) => Promise<unknown>; close: () => Promise<void> }
const pglite = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try { return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } } } catch { return null }
})()

describe.skipIf(!pglite && !process.env.CI)(`the widening — run() in PGlite${pglite ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  const quiet = () => {}
  const def = async (name: string) =>
    (await pg.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1 AND conrelid = 'public."TeacherProfile"'::regclass`, [name])).rows[0]?.def
  const many = (n: number) => `array[${Array.from({ length: n }, (_, i) => `'k${i}'`).join(',')}]::text[]`
  const insert = (id: string, n: number) => pg.exec(`INSERT INTO public."TeacherProfile" (id, "teachAreas", "coverAreas") VALUES ('${id}', ${many(n)}, ${many(n)})`)

  beforeEach(async () => {
    pg = await pglite!.PGlite.create()
    // Production as it stands: the columns, the two constraints with 40, and rows at the old cap.
    await pg.exec(`CREATE TABLE public."TeacherProfile" (id text primary key, "coverSlots" text[], "coverAreas" text[], "coverRateVnd" int,
      "coverOpen" boolean not null default false, "coverConsentVersion" text, "coverConsentAt" timestamp(3), "teachAreas" text[], "teachLanguages" text[])`)
    for (const [name, check] of WIDEN) await pg.exec(`ALTER TABLE public."TeacherProfile" ADD CONSTRAINT "${name}" CHECK (${body(check, OLD_CAP)})`)
    await insert('old', 40)
  }, 60_000) // a cold PGlite takes seconds to start
  afterEach(async () => { await pg?.close() })

  it('widens both to 60: 41 was refused before, 60 saves after, 61 is still refused — and a second run changes nothing', async () => {
    await expect(insert('t41', 41)).rejects.toThrow()
    expect(await run(pg, quiet)).toEqual({ TeacherProfile_cover_bounds: 'widened', TeacherProfile_teach_bounds: 'widened' })
    await insert('t60', 60)
    await expect(insert('t61', 61)).rejects.toThrow()
    const before = [await def('TeacherProfile_cover_bounds'), await def('TeacherProfile_teach_bounds')]
    expect(await run(pg, quiet)).toEqual({ TeacherProfile_cover_bounds: 'already', TeacherProfile_teach_bounds: 'already' })
    expect([await def('TeacherProfile_cover_bounds'), await def('TeacherProfile_teach_bounds')]).toEqual(before)
    // The scratch table went with the commit.
    expect((await pg.query<{ t: string | null }>(`SELECT to_regclass('pg_temp."_cover_zalo_shape"')::text AS t`)).rows[0]?.t).toBeNull()
  })

  it('⛔ refuses a rule changed elsewhere (the language limit 8 → 4) — and rolls back the cover rule it had already widened', async () => {
    await pg.exec(`ALTER TABLE public."TeacherProfile" DROP CONSTRAINT "TeacherProfile_teach_bounds"`)
    await pg.exec(`ALTER TABLE public."TeacherProfile" ADD CONSTRAINT "TeacherProfile_teach_bounds" CHECK (coalesce(cardinality("teachAreas"), 0) <= 40 and coalesce(cardinality("teachLanguages"), 0) <= 4)`)
    const cover = await def('TeacherProfile_cover_bounds')
    const teach = await def('TeacherProfile_teach_bounds')
    await expect(run(pg, quiet)).rejects.toThrow(/TeacherProfile_teach_bounds is not the rule this script replaces/)
    expect(await def('TeacherProfile_cover_bounds')).toBe(cover)
    expect(await def('TeacherProfile_teach_bounds')).toBe(teach)
  })

  it('⛔ refuses a cap of another number, and a missing constraint — never drops or adds', async () => {
    await pg.exec(`ALTER TABLE public."TeacherProfile" DROP CONSTRAINT "TeacherProfile_cover_bounds"`)
    await pg.exec(`ALTER TABLE public."TeacherProfile" ADD CONSTRAINT "TeacherProfile_cover_bounds" CHECK (${body(WIDEN[0]![1], 99)})`)
    await expect(run(pg, quiet)).rejects.toThrow(/TeacherProfile_cover_bounds is not the rule/)
    expect(await def('TeacherProfile_cover_bounds')).toContain('<= 99')
    await pg.exec(`ALTER TABLE public."TeacherProfile" DROP CONSTRAINT "TeacherProfile_cover_bounds"`)
    await expect(run(pg, quiet)).rejects.toThrow(/found no constraint/)
    expect(await def('TeacherProfile_cover_bounds')).toBeUndefined()
  })

  it('refuses a database without TeacherProfile', async () => {
    await pg.exec(`DROP TABLE public."TeacherProfile"`)
    await expect(run(pg, quiet)).rejects.toThrow(/not the eno database/)
  })
})
