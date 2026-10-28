import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/teacher-cover-zalo-invite-ddl.mjs ↔ prisma/schema.prisma (the one-time "Zalo for urgent cover" message, owner
 * 2026-10-29): TeacherPrivate.coverZaloInvitedAt, exactly as Prisma declares it, made idempotent — pinned to the schema,
 * then its real `run()` executed in PGlite: it makes the column, re-runs as a no-op, and REFUSES (rolling back) a column
 * of another shape, RLS off, or a policy. And the earlier Zalo script still re-runs cleanly beside it.
 */
type Run = (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, log?: (m: string) => void) => Promise<void>
const { run, STATEMENTS, SHAPE } = (await import('../../../scripts/teacher-cover-zalo-invite-ddl.mjs')) as unknown as { run: Run; STATEMENTS: [string, string][]; SHAPE: string[] }
const { run: runZalo } = (await import('../../../scripts/teacher-zalo-ddl.mjs')) as unknown as { run: Run }
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const model = (name: string) => new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)![1]!
const script = readFileSync(join(process.cwd(), 'scripts/teacher-cover-zalo-invite-ddl.mjs'), 'utf8')

describe('scripts/teacher-cover-zalo-invite-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('the schema declares the one nullable column the script makes', () => {
    expect(model('TeacherPrivate')).toMatch(/^\s+coverZaloInvitedAt\s+DateTime\?\s*$/m)
    expect(STATEMENTS).toEqual([['TeacherPrivate.coverZaloInvitedAt', 'ALTER TABLE "TeacherPrivate" ADD COLUMN IF NOT EXISTS "coverZaloInvitedAt" TIMESTAMP(3)']])
    expect(SHAPE).toEqual(['TeacherPrivate:coverZaloInvitedAt:timestamp without time zone:3:YES:NULL'])
  })
  it('⛔ additive only, and it runs only when executed', () => {
    const code = script.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b|\bupdate\s+"|\bdelete\s+from\b|\bgrant\b/i)
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
  const col = async () => (await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'TeacherPrivate' AND column_name = 'coverZaloInvitedAt'`)).rows.length

  beforeEach(async () => {
    pg = await pglite!.PGlite.create()
    await pg.exec(`CREATE TABLE "Profile" (id uuid PRIMARY KEY);
      CREATE TABLE "TeacherProfile" (id text PRIMARY KEY, "profileId" uuid NOT NULL);
      CREATE TABLE "TeacherPrivate" ("teacherProfileId" text PRIMARY KEY REFERENCES "TeacherProfile"(id) ON DELETE CASCADE, phone text, email text);
      ALTER TABLE "TeacherPrivate" ENABLE ROW LEVEL SECURITY;
      INSERT INTO "Profile" VALUES ('00000000-0000-0000-0000-000000000001');
      INSERT INTO "TeacherProfile" VALUES ('tp1', '00000000-0000-0000-0000-000000000001');
      INSERT INTO "TeacherPrivate" ("teacherProfileId", phone) VALUES ('tp1', '0901234567');`)
  }, 60_000)
  afterEach(async () => { await pg?.close() })

  it('makes the column (existing rows read NULL — not told yet); a second run changes nothing; the Zalo script still re-runs', async () => {
    await runZalo(pg, quiet)
    await run(pg, quiet)
    expect((await pg.query(`SELECT "coverZaloInvitedAt" FROM "TeacherPrivate"`)).rows).toEqual([{ coverZaloInvitedAt: null }])
    await run(pg, quiet)
    await expect(runZalo(pg, quiet)).resolves.toBeUndefined()
  })

  it('⛔ refuses — rolling back — when TeacherPrivate has RLS off, or a policy', async () => {
    await pg.exec(`ALTER TABLE "TeacherPrivate" DISABLE ROW LEVEL SECURITY`)
    await expect(run(pg, quiet)).rejects.toThrow(/RLS is OFF on TeacherPrivate/)
    expect(await col()).toBe(0)
    await pg.exec(`ALTER TABLE "TeacherPrivate" ENABLE ROW LEVEL SECURITY; CREATE POLICY anyone ON "TeacherPrivate" FOR SELECT USING (true)`)
    await expect(run(pg, quiet)).rejects.toThrow(/TeacherPrivate has 1 RLS policy/)
    expect(await col()).toBe(0)
  })

  it('⛔ refuses an existing column of another shape (IF NOT EXISTS never repairs)', async () => {
    await pg.exec(`ALTER TABLE "TeacherPrivate" ADD COLUMN "coverZaloInvitedAt" TIMESTAMP(0)`)
    await expect(run(pg, quiet)).rejects.toThrow(/not the shape this script makes/)
  })
})
