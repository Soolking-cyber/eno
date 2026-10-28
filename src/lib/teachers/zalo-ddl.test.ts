import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/teacher-zalo-ddl.mjs ↔ prisma/schema.prisma ("Zalo for urgent cover", owner 2026-10-28): the four TeacherPrivate
 * columns and the TeacherZaloReveal ledger, exactly as `prisma migrate diff` printed them, made idempotent — pinned to the
 * schema, then its real `run()` executed in PGlite: it makes them, re-runs as a no-op, reads its own shape back and
 * REFUSES (rolling everything back) a table of another shape, RLS off, or a policy that would let an API role read a row.
 */
const { run, STATEMENTS, SHAPE } = (await import('../../../scripts/teacher-zalo-ddl.mjs')) as unknown as {
  run: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, log?: (m: string) => void) => Promise<void>
  STATEMENTS: [string, string][]
  SHAPE: string[]
}
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const model = (name: string) => new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)![1]!
const script = readFileSync(join(process.cwd(), 'scripts/teacher-zalo-ddl.mjs'), 'utf8')

describe('scripts/teacher-zalo-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('the schema declares the four nullable TeacherPrivate columns and the ledger the script makes', () => {
    const priv = model('TeacherPrivate')
    expect(priv).toMatch(/^\s+coverZalo\s+String\?\s*$/m)
    expect(priv).toMatch(/^\s+coverZaloAt\s+DateTime\?\s*$/m)
    expect(priv).toMatch(/^\s+coverZaloVersion\s+String\?\s*$/m)
    expect(priv).toMatch(/^\s+coverZaloWithdrawnAt\s+DateTime\?\s*$/m)
    const r = model('TeacherZaloReveal')
    expect(r).toMatch(/viewerProfileId\s+String\?\s+@db\.Uuid/)
    expect(r).toMatch(/viewer\s+Profile\?\s+@relation\(fields: \[viewerProfileId\], references: \[id\], onDelete: SetNull\)/)
    expect(r).toMatch(/teacherProfile\s+TeacherProfile\?\s+@relation\(fields: \[teacherProfileId\], references: \[id\], onDelete: SetNull\)/)
    expect(r).toMatch(/@@unique\(\[viewerProfileId, teacherProfileId, grantAt\]\)/)
    for (const col of ['viewerName', 'teacherProfileId', 'grantAt', 'day', 'poolKey', 'revealedAt']) expect(r).toContain(col)
    expect(SHAPE).toHaveLength(12)
  })
  it('⛔ additive only: no DROP, ALTER COLUMN, TRUNCATE, UPDATE, DELETE or GRANT — and it runs only when executed', () => {
    // Code only: line and block comments out (a comment may say "grant" — a Zalo grant — without granting anything).
    const code = script.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b|\bupdate\s+"|\bdelete\s+from\b|\bgrant\b/i)
    expect(STATEMENTS.every(([, sql]) => /IF NOT EXISTS|ENABLE ROW LEVEL SECURITY/.test(sql))).toBe(true)
    expect(code).toMatch(/if \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href\)/)
  })
})

type Pg = { query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>; exec: (sql: string) => Promise<unknown>; close: () => Promise<void> }
const pglite = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try { return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } } } catch { return null }
})()

describe.skipIf(!pglite && !process.env.CI)(`the DDL — run() in PGlite${pglite ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  const quiet = () => {}
  const exists = async (rel: string) => (await pg.query<{ r: string | null }>(`SELECT to_regclass($1)::text AS r`, [rel])).rows[0]?.r ?? null

  beforeEach(async () => {
    pg = await pglite!.PGlite.create()
    // Production's shape where it matters: the three tables the change hangs on, TeacherPrivate with RLS on and no policy.
    await pg.exec(`CREATE TABLE "Profile" (id uuid PRIMARY KEY);
      CREATE TABLE "TeacherProfile" (id text PRIMARY KEY, "profileId" uuid NOT NULL);
      CREATE TABLE "TeacherPrivate" ("teacherProfileId" text PRIMARY KEY REFERENCES "TeacherProfile"(id) ON DELETE CASCADE, phone text, email text);
      ALTER TABLE "TeacherPrivate" ENABLE ROW LEVEL SECURITY;
      INSERT INTO "Profile" VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
      INSERT INTO "TeacherProfile" VALUES ('tp1', '00000000-0000-0000-0000-000000000001');
      INSERT INTO "TeacherPrivate" ("teacherProfileId", phone) VALUES ('tp1', '0901234567');`)
  }, 60_000)
  afterEach(async () => { await pg?.close() })

  it('makes the columns and the ledger; existing rows read NULL (off); a second run changes nothing', async () => {
    await run(pg, quiet)
    expect((await pg.query(`SELECT "coverZalo", "coverZaloAt" FROM "TeacherPrivate"`)).rows).toEqual([{ coverZalo: null, coverZaloAt: null }])
    await run(pg, quiet)
    expect(await exists('"TeacherZaloReveal"')).toBe('"TeacherZaloReveal"')
  })

  it('the ledger: one row per school × grant; either side going leaves the row with that side NULL (counts are never handed back)', async () => {
    await run(pg, quiet)
    const ins = (id: string, viewer: string | null, grant: string) => pg.exec(`INSERT INTO "TeacherZaloReveal" (id, "viewerProfileId", "viewerName", "teacherProfileId", "grantAt", day)
      VALUES ('${id}', ${viewer ? `'${viewer}'` : 'NULL'}, 'School A', 'tp1', '${grant}', '2026-10-28')`)
    const v = '00000000-0000-0000-0000-000000000002'
    await ins('r1', v, '2026-10-28 08:00')
    await expect(ins('r2', v, '2026-10-28 08:00')).rejects.toThrow() // the same grant twice
    await ins('r3', v, '2026-10-28 09:00') // a new grant is a new disclosure
    await pg.exec(`DELETE FROM "Profile" WHERE id = '${v}'`)
    expect((await pg.query<{ v: string | null; n: string }>(`SELECT "viewerProfileId" AS v, "viewerName" AS n FROM "TeacherZaloReveal" ORDER BY id`)).rows)
      .toEqual([{ v: null, n: 'School A' }, { v: null, n: 'School A' }])
    await pg.exec(`DELETE FROM "TeacherProfile" WHERE id = 'tp1'`)
    expect((await pg.query<{ t: string | null }>(`SELECT "teacherProfileId" AS t FROM "TeacherZaloReveal"`)).rows).toEqual([{ t: null }, { t: null }])
  })

  it('⛔ refuses — and rolls back the columns it had added — when TeacherPrivate has RLS off', async () => {
    await pg.exec(`ALTER TABLE "TeacherPrivate" DISABLE ROW LEVEL SECURITY`)
    await expect(run(pg, quiet)).rejects.toThrow(/RLS is OFF on TeacherPrivate/)
    expect((await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'TeacherPrivate' AND column_name = 'coverZalo'`)).rows).toHaveLength(0)
    expect(await exists('"TeacherZaloReveal"')).toBeNull()
  })

  it('⛔ refuses a policy that could let an API role read a row', async () => {
    await pg.exec(`CREATE POLICY anyone ON "TeacherPrivate" FOR SELECT USING (true)`)
    await expect(run(pg, quiet)).rejects.toThrow(/TeacherPrivate has 1 RLS policy/)
  })

  it('⛔ refuses a same-named unique index on other columns — the key that makes a re-open free must be the real one', async () => {
    await pg.exec(`CREATE TABLE "TeacherZaloReveal" ("id" TEXT NOT NULL, "viewerProfileId" UUID, "viewerName" TEXT NOT NULL, "teacherProfileId" TEXT,
      "grantAt" TIMESTAMP(3) NOT NULL, "day" TEXT NOT NULL, "poolKey" TEXT, "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TeacherZaloReveal_pkey" PRIMARY KEY ("id"));
      CREATE UNIQUE INDEX "TeacherZaloReveal_viewerProfileId_teacherProfileId_grantAt_key" ON "TeacherZaloReveal"("viewerProfileId", "teacherProfileId")`)
    await expect(run(pg, quiet)).rejects.toThrow(/indexes are/)
  })

  it('⛔ refuses a grant column of another precision — TIMESTAMP(0) would merge two number changes in one second', async () => {
    await pg.exec(`ALTER TABLE "TeacherPrivate" ADD COLUMN "coverZaloAt" TIMESTAMP(0)`)
    await expect(run(pg, quiet)).rejects.toThrow(/not the shape this script makes/)
  })

  it('⛔ refuses an existing column of another shape (IF NOT EXISTS never repairs)', async () => {
    await pg.exec(`ALTER TABLE "TeacherPrivate" ADD COLUMN "coverZalo" integer`)
    await expect(run(pg, quiet)).rejects.toThrow(/not the shape this script makes/)
    expect(await exists('"TeacherZaloReveal"')).toBeNull()
  })
})
