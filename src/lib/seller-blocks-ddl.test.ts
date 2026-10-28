import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── scripts/seller-blocks-ddl.mjs ↔ prisma/schema.prisma — the SellerBlock table (App Store 1.2, 2026-10-29) ──────────
// A shop no blockable person runs is blocked as a SHOP (src/lib/user-blocks.ts). The script is Prisma's own DDL for the
// model made idempotent: pinned to the schema here, then executed — twice — in PGlite against Supabase's default grants.

const ddlScript = readFileSync(join(process.cwd(), 'scripts/seller-blocks-ddl.mjs'), 'utf8')
const ddlCode = ddlScript.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
/** The script's statements, in order (each a backtick string inside STATEMENTS). */
const DDL_STATEMENTS = [.../const STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(ddlCode)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const modelBody = /^model SellerBlock \{([\s\S]*?)^\}/m.exec(schema)![1]!

describe('scripts/seller-blocks-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('the model is the three columns, the composite key, the seller index and two CASCADE relations', () => {
    const fields = modelBody.split('\n').map((l) => /^\s+(\w+)\s+(\S+)(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => `${m[1]} ${m[2]}${m[3]!.replace(/\s+/g, ' ').trimEnd()}`)
    expect(fields).toEqual([
      'blockerProfileId String @db.Uuid',
      'blocker Profile @relation(fields: [blockerProfileId], references: [id], onDelete: Cascade)',
      'sellerId String',
      'seller Seller @relation(fields: [sellerId], references: [id], onDelete: Cascade)',
      'createdAt DateTime @default(now())',
    ])
    expect(modelBody).toMatch(/^\s+@@id\(\[blockerProfileId, sellerId\]\)$/m)
    expect(modelBody).toMatch(/^\s+@@index\(\[sellerId\]\)$/m)
  })

  it("creates Prisma's own columns, key, index and foreign keys (what `prisma migrate diff` prints)", () => {
    const create = DDL_STATEMENTS[0]!
    const cols = [...create.matchAll(/^\s*"(\w+)" ([A-Z0-9() _]+?),?$/gm)].map((m) => [m[1], m[2]])
    expect(cols).toEqual([['blockerProfileId', 'UUID NOT NULL'], ['sellerId', 'TEXT NOT NULL'], ['createdAt', 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP']])
    expect(create).toContain('CONSTRAINT "SellerBlock_pkey" PRIMARY KEY ("blockerProfileId","sellerId")')
    expect(DDL_STATEMENTS[1]).toBe('CREATE INDEX IF NOT EXISTS "SellerBlock_sellerId_idx" ON public."SellerBlock"("sellerId")')
    expect(DDL_STATEMENTS[2]).toContain('ADD CONSTRAINT "SellerBlock_blockerProfileId_fkey" FOREIGN KEY ("blockerProfileId") REFERENCES public."Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE')
    expect(DDL_STATEMENTS[3]).toContain('ADD CONSTRAINT "SellerBlock_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES public."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  })

  it('⛔ is additive only, in ONE transaction under a lock_timeout; RLS on with NO policy; anon, authenticated and PUBLIC revoked', () => {
    expect(DDL_STATEMENTS).toHaveLength(6)
    expect(DDL_STATEMENTS.join('\n')).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b/i)
    expect(ddlCode).not.toMatch(/\bdrop\b|create\s+policy|\bgrant\b/i)
    const at = (s: string) => ddlCode.indexOf(s)
    expect(at("client.query('BEGIN')")).toBeGreaterThan(-1)
    expect(at("client.query('BEGIN')") < at("SET LOCAL lock_timeout = '5s'") && at("SET LOCAL lock_timeout = '5s'") < at('for (const [label, sql] of STATEMENTS)') &&
      at('for (const [label, sql] of STATEMENTS)') < at("client.query('COMMIT')")).toBe(true)
    expect(DDL_STATEMENTS[4]).toBe('ALTER TABLE public."SellerBlock" ENABLE ROW LEVEL SECURITY')
    for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(DDL_STATEMENTS[5]).toContain(`REVOKE ALL ON public."SellerBlock" FROM ${role}`)
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
      CREATE TABLE public."Seller" (id text PRIMARY KEY);
      INSERT INTO public."Profile" VALUES ('11111111-1111-4111-8111-111111111111');
      INSERT INTO public."Seller" VALUES ('shop1'), ('shop2');
    `)
    // Twice: the script is idempotent.
    for (let i = 0; i < 2; i++) for (const sql of DDL_STATEMENTS) await pg.exec(sql)
  }, 120_000)
  afterAll(async () => { await pg?.close() })

  it('makes the table once, closed to the API roles, and the key refuses a duplicate', async () => {
    const fks = await pg.query<{ f: string }>(`SELECT c.conname || ':' || t.relname || ':' || c.confdeltype::text AS f FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
      WHERE c.conrelid = 'public."SellerBlock"'::regclass AND c.contype = 'f' ORDER BY c.conname`)
    expect(fks.rows.map((r) => r.f)).toEqual(['SellerBlock_blockerProfileId_fkey:Profile:c', 'SellerBlock_sellerId_fkey:Seller:c'])
    const rls = await pg.query<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public."SellerBlock"'::regclass`)
    expect(rls.rows[0]?.r).toBe(true)
    const grants = await pg.query<{ rolname: string }>(`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        AND has_table_privilege(r.rolname, 'public."SellerBlock"', 'SELECT,INSERT,UPDATE,DELETE')
      UNION ALL SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public."SellerBlock"'::regclass AND a.grantee = 0`)
    expect(grants.rows).toEqual([])
    await pg.exec(`INSERT INTO public."SellerBlock" ("blockerProfileId", "sellerId") VALUES ('11111111-1111-4111-8111-111111111111', 'shop1')`)
    await expect(pg.exec(`INSERT INTO public."SellerBlock" ("blockerProfileId", "sellerId") VALUES ('11111111-1111-4111-8111-111111111111', 'shop1')`)).rejects.toThrow(/duplicate key/)
  })

  it('a deleted shop or account takes its blocks with it (CASCADE), and an unknown shop is refused', async () => {
    await pg.exec(`INSERT INTO public."SellerBlock" ("blockerProfileId", "sellerId") VALUES ('11111111-1111-4111-8111-111111111111', 'shop2') ON CONFLICT DO NOTHING`)
    await pg.exec(`DELETE FROM public."Seller" WHERE id = 'shop2'`)
    expect((await pg.query(`SELECT 1 FROM public."SellerBlock" WHERE "sellerId" = 'shop2'`)).rows).toHaveLength(0)
    await expect(pg.exec(`INSERT INTO public."SellerBlock" ("blockerProfileId", "sellerId") VALUES ('11111111-1111-4111-8111-111111111111', 'nope')`)).rejects.toThrow(/foreign key/)
    await pg.exec(`DELETE FROM public."Profile"`)
    expect((await pg.query(`SELECT 1 FROM public."SellerBlock"`)).rows).toHaveLength(0)
  })
})
