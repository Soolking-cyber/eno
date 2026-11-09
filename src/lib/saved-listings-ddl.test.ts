import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── scripts/saved-listings-ddl.mjs ↔ prisma/schema.prisma — the SavedListing table (owner, 2026-11-09: "3 ok") ────────────
// A signed-in person's saves live on the account (src/lib/saved-listings.ts, /api/saved-listings). The script is Prisma's
// own DDL for the model made idempotent: pinned to the schema here, then executed — twice — in PGlite against Supabase's
// default grants.

const ddlScript = readFileSync(join(process.cwd(), 'scripts/saved-listings-ddl.mjs'), 'utf8')
const ddlCode = ddlScript.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
/** The script's statements, in order (each a backtick string inside STATEMENTS). */
const DDL_STATEMENTS = [.../const STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(ddlCode)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const modelBody = /^model SavedListing \{([\s\S]*?)^\}/m.exec(schema)![1]!

describe('scripts/saved-listings-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('the model is the three columns, the composite key, its two indexes and two CASCADE relations', () => {
    const fields = modelBody.split('\n').map((l) => /^\s+(\w+)\s+(\S+)(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => `${m[1]} ${m[2]}${m[3]!.replace(/\s+/g, ' ').trimEnd()}`)
    expect(fields).toEqual([
      'profileId String @db.Uuid',
      'profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)',
      'listingId String',
      'listing Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)',
      'createdAt DateTime @default(now())',
    ])
    expect(modelBody).toMatch(/^\s+@@id\(\[profileId, listingId\]\)$/m)
    expect(modelBody).toMatch(/^\s+@@index\(\[profileId, createdAt\]\)$/m)
    expect(modelBody).toMatch(/^\s+@@index\(\[listingId\]\)$/m)
  })

  it("creates Prisma's own columns, key, index and foreign keys (what `prisma migrate diff` prints)", () => {
    const create = DDL_STATEMENTS[0]!
    const cols = [...create.matchAll(/^\s*"(\w+)" ([A-Z0-9() _]+?),?$/gm)].map((m) => [m[1], m[2]])
    expect(cols).toEqual([['profileId', 'UUID NOT NULL'], ['listingId', 'TEXT NOT NULL'], ['createdAt', 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP']])
    expect(create).toContain('CONSTRAINT "SavedListing_pkey" PRIMARY KEY ("profileId","listingId")')
    expect(DDL_STATEMENTS[1]).toBe('CREATE INDEX IF NOT EXISTS "SavedListing_profileId_createdAt_idx" ON public."SavedListing"("profileId", "createdAt")')
    expect(DDL_STATEMENTS[2]).toBe('CREATE INDEX IF NOT EXISTS "SavedListing_listingId_idx" ON public."SavedListing"("listingId")')
    expect(DDL_STATEMENTS[3]).toContain('ADD CONSTRAINT "SavedListing_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES public."Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE')
    expect(DDL_STATEMENTS[4]).toContain('ADD CONSTRAINT "SavedListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  })

  it('⛔ is additive only, in ONE transaction under a lock_timeout; RLS on with NO policy; anon, authenticated and PUBLIC revoked', () => {
    expect(DDL_STATEMENTS).toHaveLength(7)
    expect(DDL_STATEMENTS.join('\n')).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b/i)
    expect(ddlCode).not.toMatch(/\bdrop\b|create\s+policy|\bgrant\b/i)
    const at = (s: string) => ddlCode.indexOf(s)
    expect(at("client.query('BEGIN')")).toBeGreaterThan(-1)
    expect(at("client.query('BEGIN')") < at("SET LOCAL lock_timeout = '5s'") && at("SET LOCAL lock_timeout = '5s'") < at('for (const [label, sql] of STATEMENTS)') &&
      at('for (const [label, sql] of STATEMENTS)') < at("client.query('COMMIT')")).toBe(true)
    expect(DDL_STATEMENTS[5]).toBe('ALTER TABLE public."SavedListing" ENABLE ROW LEVEL SECURITY')
    for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(DDL_STATEMENTS[6]).toContain(`REVOKE ALL ON public."SavedListing" FROM ${role}`)
  })
})

type Pg = {
  exec: (sql: string) => Promise<unknown>
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>
  close: () => Promise<void>
}
const pglite = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try { return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } } } catch { return null }
})()

describe.skipIf(!pglite && !process.env.CI)(`the DDL, run in PGlite${pglite ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  beforeAll(async () => {
    if (!pglite) throw new Error('@electric-sql/pglite is not installed — this block must run in CI')
    pg = await pglite.PGlite.create()
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;
      CREATE TABLE public."Profile" (id uuid PRIMARY KEY);
      CREATE TABLE public."Listing" (id text PRIMARY KEY);
      INSERT INTO public."Profile" VALUES ('11111111-1111-4111-8111-111111111111');
      INSERT INTO public."Listing" VALUES ('l1'), ('l2');
    `)
    // Twice: the script is idempotent.
    for (let i = 0; i < 2; i++) for (const sql of DDL_STATEMENTS) await pg.exec(sql)
  }, 120_000)
  afterAll(async () => { await pg?.close() })

  it('makes the table once, closed to the API roles, and the key refuses a duplicate', async () => {
    const fks = await pg.query<{ f: string }>(`SELECT c.conname || ':' || t.relname || ':' || c.confdeltype::text AS f FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
      WHERE c.conrelid = 'public."SavedListing"'::regclass AND c.contype = 'f' ORDER BY c.conname`)
    expect(fks.rows.map((r) => r.f)).toEqual(['SavedListing_listingId_fkey:Listing:c', 'SavedListing_profileId_fkey:Profile:c'])
    const rls = await pg.query<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public."SavedListing"'::regclass`)
    expect(rls.rows[0]?.r).toBe(true)
    const grants = await pg.query<{ rolname: string }>(`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        AND has_table_privilege(r.rolname, 'public."SavedListing"', 'SELECT,INSERT,UPDATE,DELETE')
      UNION ALL SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public."SavedListing"'::regclass AND a.grantee = 0`)
    expect(grants.rows).toEqual([])
    await pg.exec(`INSERT INTO public."SavedListing" ("profileId", "listingId") VALUES ('11111111-1111-4111-8111-111111111111', 'l1')`)
    await expect(pg.exec(`INSERT INTO public."SavedListing" ("profileId", "listingId") VALUES ('11111111-1111-4111-8111-111111111111', 'l1')`)).rejects.toThrow(/duplicate key/)
  })

  it('a deleted listing or account takes its saves with it (CASCADE), and an unknown listing is refused', async () => {
    await pg.exec(`INSERT INTO public."SavedListing" ("profileId", "listingId") VALUES ('11111111-1111-4111-8111-111111111111', 'l2') ON CONFLICT DO NOTHING`)
    await pg.exec(`DELETE FROM public."Listing" WHERE id = 'l2'`)
    expect((await pg.query(`SELECT 1 FROM public."SavedListing" WHERE "listingId" = 'l2'`)).rows).toHaveLength(0)
    await expect(pg.exec(`INSERT INTO public."SavedListing" ("profileId", "listingId") VALUES ('11111111-1111-4111-8111-111111111111', 'nope')`)).rejects.toThrow(/foreign key/)
    await pg.exec(`DELETE FROM public."Profile"`)
    expect((await pg.query(`SELECT 1 FROM public."SavedListing"`)).rows).toHaveLength(0)
  })
})
