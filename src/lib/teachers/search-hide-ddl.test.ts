import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * scripts/teacher-search-hide-ddl.mjs ↔ prisma/schema.prisma (owner decision 14, 2026-10-20): the ONE additive column
 * TeacherProfile."hideFromSearch", exactly as `prisma migrate diff` prints it, made idempotent — pinned to the schema, then
 * RUN in PGlite: it adds the column (existing rows read false), runs again without error, its shape check reports the
 * column it made and REFUSES one of another shape, and its exposure check finds no API role able to read it.
 * ⛔ ON A TABLE SHAPED LIKE PRODUCTION'S (verifier, 2026-10-20): Supabase's default privileges leave anon/authenticated
 * holding ALL on TeacherProfile (scripts/teachers-ddl.mjs: RLS on, no policy, nothing taken back) — the first version's
 * fixture took those away, so its column-privilege check passed here and would have refused every production run.
 */
const script = readFileSync(join(process.cwd(), 'scripts/teacher-search-hide-ddl.mjs'), 'utf8')
const code = script.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const STATEMENTS = [.../const STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(code)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const SHAPE = /const SHAPE = '([^']+)'/.exec(code)![1]!
const SHAPE_SQL = /const SHAPE_SQL = `([^`]+)`/.exec(code)![1]!
const API_ACCESS_SQL = /const API_ACCESS_SQL = `([^`]+)`/.exec(code)![1]!
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const model = /^model TeacherProfile \{([\s\S]*?)^\}/m.exec(schema)![1]!

describe('scripts/teacher-search-hide-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('the schema declares hideFromSearch Boolean @default(false) — and the script adds exactly it, Prisma\'s own DDL', () => {
    expect(model).toMatch(/^\s+hideFromSearch\s+Boolean\s+@default\(false\)\s*$/m)
    expect(STATEMENTS).toEqual(['ALTER TABLE public."TeacherProfile" ADD COLUMN IF NOT EXISTS "hideFromSearch" BOOLEAN NOT NULL DEFAULT false'])
    expect(SHAPE).toBe('hideFromSearch:boolean:NO:false')
  })
  it('⛔ additive only: no DROP, ALTER COLUMN, TRUNCATE, UPDATE or GRANT — the default is the answer, nothing is backfilled', () => {
    expect(code).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b|\bgrant\b|\bupdate\s+(public\.)?"?TeacherProfile/i)
  })
  it('one transaction under a 5 s lock_timeout: BEGIN → SET LOCAL → the ALTER → the checks → COMMIT, ROLLBACK on any failure', () => {
    const at = (s: string) => code.indexOf(s)
    expect(at("client.query('BEGIN')")).toBeGreaterThan(-1)
    expect(at("client.query('BEGIN')") < at("SET LOCAL lock_timeout = '5s'")).toBe(true)
    expect(at("SET LOCAL lock_timeout = '5s'") < at('for (const [label, sql] of STATEMENTS)')).toBe(true)
    expect(at('for (const [label, sql] of STATEMENTS)') < at('client.query(SHAPE_SQL)')).toBe(true)
    expect(at('client.query(SHAPE_SQL)') < at('client.query(API_ACCESS_SQL)')).toBe(true)
    expect(at('client.query(API_ACCESS_SQL)') < at("client.query('COMMIT')")).toBe(true)
    expect(code).toContain("client.query('ROLLBACK')")
    expect(code).toMatch(/if \(shape !== SHAPE\) throw/)
    expect(code).toMatch(/if \(!rel\.rows\[0\]\?\.relrowsecurity\) throw/)
    expect(code).toMatch(/if \(open\.length\) throw/)
  })
})

// ── RUN IN PGlite (Postgres 17, in-process): the statements and the script's own checks ──────────────────────────────
type Pg = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}
const pglite = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try { return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } } } catch { return null }
})()

describe.skipIf(!pglite && !process.env.CI)(`the DDL — run in PGlite${pglite ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  const shape = async () => (await pg.query<{ s: string }>(SHAPE_SQL)).rows.map((r) => r.s).join(',')
  const open = async () => (await pg.query<{ rolname: string }>(API_ACCESS_SQL)).rows.map((r) => r.rolname).sort()

  beforeAll(async () => {
    if (!pglite) throw new Error('@electric-sql/pglite is not installed — this block must run in CI')
    pg = await pglite.PGlite.create()
    // A TeacherProfile as production has it, for this purpose: rows already there, RLS on with NO policy, and Supabase's
    // default privileges — anon and authenticated hold ALL on the table (scripts/teachers-ddl.mjs never took them back;
    // rls-guard.sql only switches RLS on). Row security is what keeps them out, and the script must accept exactly this.
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE TABLE public."TeacherProfile" ("id" TEXT PRIMARY KEY, "profileId" UUID NOT NULL UNIQUE, "listingId" TEXT, "fullName" TEXT NOT NULL);
      ALTER TABLE public."TeacherProfile" ENABLE ROW LEVEL SECURITY;
      GRANT ALL ON public."TeacherProfile" TO anon, authenticated;
      INSERT INTO public."TeacherProfile" VALUES ('t1', '9b0c1e2a-0000-4000-8000-000000000001', 'L1', 'Jane Doe');
    `)
  }, 120_000) // PGlite's WASM start takes seconds, and minutes on a loaded machine (job-ad-sightings.test.ts allows the same)
  afterAll(async () => { await pg?.close() })

  it('adds the column: the shape the script asserts, and every existing row reads false (not hidden)', async () => {
    for (const sql of STATEMENTS) await pg.exec(sql)
    expect(await shape()).toBe(SHAPE)
    expect((await pg.query<{ h: boolean }>(`SELECT "hideFromSearch" AS h FROM "TeacherProfile"`)).rows).toEqual([{ h: false }])
  })
  it('runs again without error (idempotent), and the writer\'s UPDATE works on it', async () => {
    for (const sql of STATEMENTS) await pg.exec(sql)
    expect(await shape()).toBe(SHAPE)
    const r = await pg.query<{ listingId: string }>(`UPDATE "TeacherProfile" SET "hideFromSearch" = $1 WHERE "profileId" = $2::uuid RETURNING "listingId"`, [true, '9b0c1e2a-0000-4000-8000-000000000001'])
    expect(r.rows).toEqual([{ listingId: 'L1' }])
  })
  it('⛔ the exposure check passes on the production shape — the API roles\' table-level ALL, RLS on, no policy', async () => {
    // The first version asked has_column_privilege, which counts the table-level grant: ['anon', 'authenticated'] here,
    // so it rolled back on every production run and the deploy could never get its column.
    expect((await pg.query<{ ok: boolean }>(`SELECT has_table_privilege('anon', 'public."TeacherProfile"', 'SELECT') AS ok`)).rows).toEqual([{ ok: true }])
    expect(await open()).toEqual([])
  })
  it('the exposure check SEES every way an API role could read a row: a policy for it, for PUBLIC, for a role it inherits, or BYPASSRLS', async () => {
    await pg.exec(`CREATE ROLE svc NOLOGIN; CREATE ROLE readers NOLOGIN`)
    // A policy for a role neither API role holds admits neither: not exposure.
    await pg.exec(`CREATE POLICY p_svc ON public."TeacherProfile" FOR SELECT TO svc USING (true)`)
    expect(await open()).toEqual([])
    await pg.exec(`CREATE POLICY p_anon ON public."TeacherProfile" FOR SELECT TO anon USING (true)`)
    expect(await open()).toEqual(['policy p_anon'])
    await pg.exec(`DROP POLICY p_anon ON public."TeacherProfile"; CREATE POLICY p_public ON public."TeacherProfile" FOR SELECT USING (true)`)
    expect(await open()).toEqual(['policy p_public'])
    await pg.exec(`DROP POLICY p_public ON public."TeacherProfile"; CREATE POLICY p_readers ON public."TeacherProfile" FOR SELECT TO readers USING (true); GRANT readers TO authenticated`)
    expect(await open()).toEqual(['policy p_readers'])
    await pg.exec(`DROP POLICY p_readers ON public."TeacherProfile"; REVOKE readers FROM authenticated; ALTER ROLE anon BYPASSRLS`)
    expect(await open()).toEqual(['anon'])
    await pg.exec(`ALTER ROLE anon NOBYPASSRLS; DROP POLICY p_svc ON public."TeacherProfile"`)
    expect(await open()).toEqual([])
  })
  it('⛔ a column of another shape is REFUSED: IF NOT EXISTS keeps it, and the shape check says so', async () => {
    await pg.exec(`ALTER TABLE public."TeacherProfile" DROP COLUMN "hideFromSearch"; ALTER TABLE public."TeacherProfile" ADD COLUMN "hideFromSearch" TEXT`)
    for (const sql of STATEMENTS) await pg.exec(sql)
    expect(await shape()).toBe('hideFromSearch:text:YES:NULL')
    expect(await shape()).not.toBe(SHAPE)
  })
})
