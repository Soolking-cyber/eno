import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── scripts/listing-ad-ddl.mjs ↔ prisma/schema.prisma — ListingAd (paid ads over x402, owner 2026-11-23) and, since
// 2026-11-25 (any lawful advertiser), AdCreative + AdStat and ListingAd's creative target ──────────────────────────────
// The script is Prisma's own DDL for the models made idempotent: pinned to the schema here, then executed — twice — in
// PGlite against Supabase's default grants, over a ListingAd of the shape that shipped on 2026-11-23.

const ddlScript = readFileSync(join(process.cwd(), 'scripts/listing-ad-ddl.mjs'), 'utf8')
const ddlCode = ddlScript.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const DDL_STATEMENTS = [.../const STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(ddlCode)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const VALIDATE = /const VALIDATE = `([^`]*)`/.exec(ddlCode)![1]!
const CONCURRENT_INDEX = /const CONCURRENT_INDEX = `([^`]*)`/.exec(ddlCode)![1]!
const RELAX = 'ALTER TABLE public."ListingAd" ALTER COLUMN "listingId" DROP NOT NULL'
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const modelBody = (name: string) => new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)![1]!
const statement = (start: string) => DDL_STATEMENTS.find((s) => s.startsWith(start))!

/** Prisma's column DDL for each scalar field of a model (what `prisma migrate diff` prints). */
function prismaColumns(model: string): [string, string][] {
  return modelBody(model).split('\n').map((l) => /^\s+(\w+)\s+(\w+)(\??)\s*(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m && !m[1]!.startsWith('@@'))
    .map((m) => {
      const [, name, type, opt, rest] = m as unknown as [string, string, string, string, string]
      const sql = ({ String: 'TEXT', DateTime: 'TIMESTAMP(3)', Int: 'INTEGER', Json: 'JSONB' } as Record<string, string>)[type]!
      const def = /@default\(now\(\)\)/.test(rest) ? ' DEFAULT CURRENT_TIMESTAMP' : /@default\((\d+)\)/.exec(rest) ? ` DEFAULT ${/@default\((\d+)\)/.exec(rest)![1]}` : ''
      return [name, `${sql}${opt ? '' : ' NOT NULL'}${def}`]
    })
}
const createdColumns = (create: string) => [...create.matchAll(/^\s*"(\w+)" ([A-Z0-9() _]+?),?$/gm)].map((m) => [m[1], m[2]])

describe('scripts/listing-ad-ddl.mjs ↔ prisma/schema.prisma', () => {
  it("ListingAd: exactly the model's columns, in order, as Prisma types them (the table, then the columns added after it shipped)", () => {
    const create = DDL_STATEMENTS[0]!
    const added = DDL_STATEMENTS.map((s) => /ADD COLUMN IF NOT EXISTS "(\w+)" ([A-Z0-9 ]+?)$/.exec(s)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]])
    expect(added).toEqual([['durationSec', 'INTEGER NOT NULL DEFAULT 604800'], ['creativeId', 'TEXT']])
    expect([...createdColumns(create), ...added]).toEqual(prismaColumns('ListingAd'))
    expect(create).toContain('CONSTRAINT "ListingAd_pkey" PRIMARY KEY ("id")')
  })

  it("AdCreative and AdStat: exactly the models' columns and primary keys", () => {
    const creative = statement('CREATE TABLE IF NOT EXISTS public."AdCreative"')
    expect(createdColumns(creative)).toEqual(prismaColumns('AdCreative'))
    expect(creative).toContain('CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")')
    const stat = statement('CREATE TABLE IF NOT EXISTS public."AdStat"')
    expect(createdColumns(stat)).toEqual(prismaColumns('AdStat'))
    expect(modelBody('AdStat')).toContain('@@id([adId, bucket])')
    expect(stat).toContain('CONSTRAINT "AdStat_pkey" PRIMARY KEY ("adId","bucket")')
  })

  it("has the models' keys and indexes (paymentId unique — never txHash), and no foreign key", () => {
    const listingAd = modelBody('ListingAd')
    expect(listingAd).toMatch(/paymentId\s+String\s+@unique/)
    expect(listingAd).toMatch(/txHash\s+String\?\s*$/m)
    expect(listingAd).toMatch(/listingId\s+String\?\s*$/m)
    expect(DDL_STATEMENTS.slice(1, 6)).toEqual([
      'CREATE UNIQUE INDEX IF NOT EXISTS "ListingAd_paymentId_key" ON public."ListingAd"("paymentId")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_status_endsAt_idx" ON public."ListingAd"("status", "endsAt")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_listingId_status_idx" ON public."ListingAd"("listingId", "status")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_sellerId_createdAt_idx" ON public."ListingAd"("sellerId", "createdAt")',
      'CREATE INDEX IF NOT EXISTS "ListingAd_txHash_idx" ON public."ListingAd"("txHash")',
    ])
    for (const idx of ['@@index([status, endsAt])', '@@index([listingId, status])', '@@index([sellerId, createdAt])', '@@index([txHash])', '@@index([creativeId, status])']) expect(listingAd).toContain(idx)
    // The one index on the EXISTING table is built CONCURRENTLY, alone (prisma/CLAUDE.md).
    expect(CONCURRENT_INDEX).toBe('CREATE INDEX CONCURRENTLY IF NOT EXISTS "ListingAd_creativeId_status_idx" ON public."ListingAd"("creativeId", "status")')
    expect(DDL_STATEMENTS.join('\n')).not.toContain('ListingAd_creativeId_status_idx')
    expect(DDL_STATEMENTS).toContain('CREATE INDEX IF NOT EXISTS "AdCreative_sellerId_contentHash_createdAt_idx" ON public."AdCreative"("sellerId", "contentHash", "createdAt")')
    expect(DDL_STATEMENTS).toContain('CREATE INDEX IF NOT EXISTS "AdCreative_status_createdAt_idx" ON public."AdCreative"("status", "createdAt")')
    for (const idx of ['@@index([sellerId, contentHash, createdAt])', '@@index([status, createdAt])']) expect(modelBody('AdCreative')).toContain(idx)
    for (const m of ['ListingAd', 'AdCreative', 'AdStat']) expect(modelBody(m)).not.toMatch(/@relation/)
  })

  it('⛔ is additive only — the one change to an existing column is listingId DROP NOT NULL — in ONE transaction under a lock_timeout; then VALIDATE alone; then the index alone', () => {
    expect(DDL_STATEMENTS).toHaveLength(19)
    expect(DDL_STATEMENTS.filter((s) => s === RELAX)).toHaveLength(1)
    const rest = DDL_STATEMENTS.filter((s) => s !== RELAX).join('\n')
    expect(rest).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b|\breferences\b|foreign\s+key/i)
    // Nothing executable drops anything (the operator's message for an INVALID index names the command; it runs nothing).
    const executable = ddlCode.replace(RELAX, '').replace(/throw new Error\(`[^`]*`\)/g, '')
    expect(executable).not.toMatch(/\bdrop\b|create\s+policy|\bgrant\b/i)
    const at = (s: string) => ddlCode.indexOf(s)
    expect(at("client.query('BEGIN')") > -1 && at("client.query('BEGIN')") < at("SET LOCAL lock_timeout = '5s'") &&
      at("SET LOCAL lock_timeout = '5s'") < at('for (const [label, sql] of STATEMENTS)') && at('for (const [label, sql] of STATEMENTS)') < at("client.query('COMMIT')")).toBe(true)
    // Phase 2 and 3 run only after phase 1 committed, VALIDATE in its own transaction, the index outside any.
    expect(at('await client.query(VALIDATE)') > at("console.log('✓ committed')")).toBe(true)
    expect(at('await client.query(CONCURRENT_INDEX)') > at("console.log('✓ ListingAd one-target CHECK validated')")).toBe(true)
    expect(statement('DO $$ BEGIN\n       IF NOT EXISTS (SELECT 1 FROM pg_constraint')).toContain('CHECK (num_nonnulls("listingId", "creativeId") = 1) NOT VALID')
    expect(VALIDATE).toBe('ALTER TABLE public."ListingAd" VALIDATE CONSTRAINT "ListingAd_one_target"')
    for (const t of ['ListingAd', 'AdCreative', 'AdStat']) expect(DDL_STATEMENTS).toContain(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`)
    for (const t of ['ListingAd', 'AdCreative', 'AdStat']) for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(DDL_STATEMENTS.join('\n')).toContain(`REVOKE ALL ON public."${t}" FROM ${role}`)
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
  const row = (id: string, paymentId: string, tx: string | null, target = `'l1', NULL`) => `INSERT INTO public."ListingAd" ("id","listingId","creativeId","sellerId","bookedByKeyId","via","status","amount","asset","network","payTo","paymentId","authFrom","authNonce","authValidBefore","signature","payloadJson","txHash","updatedAt")
      VALUES ('${id}',${target},'s1','k1','http','pending','3760000','0xa','eip155:8453','0xb','${paymentId}','0xc','0xd','1','0xe','{}',${tx ? `'${tx}'` : 'NULL'},now())`
  beforeAll(async () => {
    if (!pglite) throw new Error('@electric-sql/pglite is not installed — this block must run in CI')
    pg = await pglite.PGlite.create()
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;
    `)
    // ListingAd as it shipped on 2026-11-23 (listingId NOT NULL, no creativeId), holding one listing ad.
    await pg.exec(DDL_STATEMENTS[0]!.replace('"listingId" TEXT,', '"listingId" TEXT NOT NULL,'))
    for (const sql of DDL_STATEMENTS.slice(1, 9)) await pg.exec(sql)
    await pg.exec(`INSERT INTO public."ListingAd" ("id","listingId","sellerId","bookedByKeyId","via","status","amount","asset","network","payTo","paymentId","authFrom","authNonce","authValidBefore","signature","payloadJson","updatedAt")
      VALUES ('old1','l0','s0','k0','mcp','active','3760000','0xa','eip155:8453','0xb','p0','0xc','0xd','1','0xe','{}',now())`)
    for (let i = 0; i < 2; i++) {
      for (const sql of DDL_STATEMENTS) await pg.exec(sql)
      await pg.exec(VALIDATE)
      await pg.exec(CONCURRENT_INDEX)
    }
  }, 120_000)
  afterAll(async () => { await pg?.close() })

  it('makes each table once, closed to the API roles, and one payment can never be two rows', async () => {
    for (const t of ['ListingAd', 'AdCreative', 'AdStat']) {
      const rls = await pg.query<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public."${t}"'::regclass`)
      expect(rls.rows[0]?.r).toBe(true)
      const grants = await pg.query<{ rolname: string }>(`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
          AND has_table_privilege(r.rolname, 'public."${t}"', 'SELECT,INSERT,UPDATE,DELETE')
        UNION ALL SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          WHERE c.oid = 'public."${t}"'::regclass AND a.grantee = 0`)
      expect(grants.rows).toEqual([])
    }
    await pg.exec(row('a1', 'p1', null))
    await pg.exec(row('a2', 'p2', null)) // two NULL tx hashes are fine
    await expect(pg.exec(row('a3', 'p1', null))).rejects.toThrow(/duplicate key/)
    // One transaction may settle both (batch settlement): the same tx hash on two rows is allowed.
    await pg.exec(`UPDATE public."ListingAd" SET "txHash" = '0x1' WHERE id IN ('a1', 'a2')`)
  })

  it('keeps the shipped row, and every ad has exactly one target: a listing OR a creative (the CHECK is validated)', async () => {
    expect((await pg.query<{ listingId: string }>(`SELECT "listingId" FROM public."ListingAd" WHERE id = 'old1'`)).rows).toEqual([{ listingId: 'l0' }])
    await pg.exec(row('c1', 'pc1', null, `NULL, 'cr1'`))
    await expect(pg.exec(row('c2', 'pc2', null, 'NULL, NULL'))).rejects.toThrow(/ListingAd_one_target/)
    await expect(pg.exec(row('c3', 'pc3', null, `'l1', 'cr1'`))).rejects.toThrow(/ListingAd_one_target/)
    const ck = await pg.query<{ v: boolean }>(`SELECT convalidated AS v FROM pg_constraint WHERE conname = 'ListingAd_one_target'`)
    expect(ck.rows).toEqual([{ v: true }])
    const ix = await pg.query<{ v: boolean }>(`SELECT indisvalid AS v FROM pg_index WHERE indexrelid = to_regclass('public."ListingAd_creativeId_status_idx"')`)
    expect(ix.rows).toEqual([{ v: true }])
  })

  it('AdStat holds one row per ad-hour, and the flush upsert adds to it', async () => {
    const upsert = (n: number) => `INSERT INTO public."AdStat" ("adId","bucket","impressions","clicks","invalid","reachNew") VALUES ('c1','2026-11-25 08:00:00',${n},1,0,${n})
      ON CONFLICT ("adId","bucket") DO UPDATE SET "impressions" = "AdStat"."impressions" + EXCLUDED."impressions", "clicks" = "AdStat"."clicks" + EXCLUDED."clicks",
        "invalid" = "AdStat"."invalid" + EXCLUDED."invalid", "reachNew" = "AdStat"."reachNew" + EXCLUDED."reachNew"`
    await pg.exec(upsert(3))
    await pg.exec(upsert(2))
    expect((await pg.query(`SELECT "impressions", "clicks", "reachNew" FROM public."AdStat"`)).rows).toEqual([{ impressions: 5, clicks: 2, reachNew: 5 }])
  })
})
