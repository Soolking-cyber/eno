import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── scripts/listing-ad-ddl.mjs ↔ prisma/schema.prisma — the ListingAd table (paid ads over x402, owner 2026-11-23) ──────
// The script is Prisma's own DDL for the model made idempotent: pinned to the schema here, then executed — twice — in
// PGlite against Supabase's default grants.

const ddlScript = readFileSync(join(process.cwd(), 'scripts/listing-ad-ddl.mjs'), 'utf8')
const ddlCode = ddlScript.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const DDL_STATEMENTS = [.../const STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(ddlCode)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const modelBody = /^model ListingAd \{([\s\S]*?)^\}/m.exec(schema)![1]!

/** Prisma's column DDL for each scalar field of the model (what `prisma migrate diff` prints). */
function prismaColumns(): [string, string][] {
  return modelBody.split('\n').map((l) => /^\s+(\w+)\s+(\w+)(\??)\s*(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m && !m[1]!.startsWith('@@'))
    .map((m) => {
      const [, name, type, opt, rest] = m as unknown as [string, string, string, string, string]
      const sql = ({ String: 'TEXT', DateTime: 'TIMESTAMP(3)', Int: 'INTEGER', Json: 'JSONB' } as Record<string, string>)[type]!
      const def = /@default\(now\(\)\)/.test(rest) ? ' DEFAULT CURRENT_TIMESTAMP' : /@default\((\d+)\)/.exec(rest) ? ` DEFAULT ${/@default\((\d+)\)/.exec(rest)![1]}` : ''
      return [name, `${sql}${opt ? '' : ' NOT NULL'}${def}`]
    })
}

describe('scripts/listing-ad-ddl.mjs ↔ prisma/schema.prisma', () => {
  it("creates exactly the model's columns, in order, as Prisma types them", () => {
    const create = DDL_STATEMENTS[0]!
    const cols = [...create.matchAll(/^\s*"(\w+)" ([A-Z0-9() _]+?),?$/gm)].map((m) => [m[1], m[2]])
    expect(cols).toEqual(prismaColumns())
    expect(create).toContain('CONSTRAINT "ListingAd_pkey" PRIMARY KEY ("id")')
  })

  it("has the model's two unique keys and three indexes, and no foreign key", () => {
    expect(modelBody).toMatch(/paymentId\s+String\s+@unique/)
    expect(modelBody).toMatch(/txHash\s+String\?\s+@unique/)
    expect(DDL_STATEMENTS.slice(1, 6)).toEqual([
      'CREATE UNIQUE INDEX IF NOT EXISTS "ListingAd_paymentId_key" ON public."ListingAd"("paymentId")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "ListingAd_txHash_key" ON public."ListingAd"("txHash")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_status_endsAt_idx" ON public."ListingAd"("status", "endsAt")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_listingId_status_idx" ON public."ListingAd"("listingId", "status")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_sellerId_createdAt_idx" ON public."ListingAd"("sellerId", "createdAt")',
    ])
    for (const idx of ['@@index([status, endsAt])', '@@index([listingId, status])', '@@index([sellerId, createdAt])']) expect(modelBody).toContain(idx)
    expect(modelBody).not.toMatch(/@relation/)
  })

  it('⛔ is additive only, in ONE transaction under a lock_timeout; RLS on with NO policy; anon, authenticated and PUBLIC revoked', () => {
    expect(DDL_STATEMENTS).toHaveLength(8)
    expect(DDL_STATEMENTS.join('\n')).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b|\breferences\b|foreign\s+key/i)
    expect(ddlCode).not.toMatch(/\bdrop\b|create\s+policy|\bgrant\b/i)
    const at = (s: string) => ddlCode.indexOf(s)
    expect(at("client.query('BEGIN')") > -1 && at("client.query('BEGIN')") < at("SET LOCAL lock_timeout = '5s'") &&
      at("SET LOCAL lock_timeout = '5s'") < at('for (const [label, sql] of STATEMENTS)') && at('for (const [label, sql] of STATEMENTS)') < at("client.query('COMMIT')")).toBe(true)
    expect(DDL_STATEMENTS[6]).toBe('ALTER TABLE public."ListingAd" ENABLE ROW LEVEL SECURITY')
    for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(DDL_STATEMENTS[7]).toContain(`REVOKE ALL ON public."ListingAd" FROM ${role}`)
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
    `)
    for (let i = 0; i < 2; i++) for (const sql of DDL_STATEMENTS) await pg.exec(sql)
  }, 120_000)
  afterAll(async () => { await pg?.close() })

  it('makes the table once, closed to the API roles, and one payment can never be two rows', async () => {
    const rls = await pg.query<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public."ListingAd"'::regclass`)
    expect(rls.rows[0]?.r).toBe(true)
    const grants = await pg.query<{ rolname: string }>(`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
        AND has_table_privilege(r.rolname, 'public."ListingAd"', 'SELECT,INSERT,UPDATE,DELETE')
      UNION ALL SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public."ListingAd"'::regclass AND a.grantee = 0`)
    expect(grants.rows).toEqual([])
    const row = (id: string, paymentId: string, tx: string | null) => `INSERT INTO public."ListingAd" ("id","listingId","sellerId","bookedByKeyId","via","status","amount","asset","network","payTo","paymentId","authFrom","authNonce","authValidBefore","signature","payloadJson","txHash","updatedAt")
      VALUES ('${id}','l1','s1','k1','http','pending','3760000','0xa','eip155:8453','0xb','${paymentId}','0xc','0xd','1','0xe','{}',${tx ? `'${tx}'` : 'NULL'},now())`
    await pg.exec(row('a1', 'p1', null))
    await pg.exec(row('a2', 'p2', null)) // two NULL tx hashes are fine
    await expect(pg.exec(row('a3', 'p1', null))).rejects.toThrow(/duplicate key/)
    await pg.exec(`UPDATE public."ListingAd" SET "txHash" = '0x1' WHERE id = 'a1'`)
    await expect(pg.exec(`UPDATE public."ListingAd" SET "txHash" = '0x1' WHERE id = 'a2'`)).rejects.toThrow(/duplicate key/)
  })
})
