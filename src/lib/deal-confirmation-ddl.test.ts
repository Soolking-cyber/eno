import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── scripts/deal-confirmation-ddl.mjs ↔ prisma/schema.prisma — the service-deal tables + Review.basis (2026-11-11) ──────
// The script is Prisma's own DDL for the two models made idempotent: pinned to the schema here, then executed — twice —
// in PGlite against Supabase's default grants (the seller-blocks-ddl.test.ts pattern).

const ddlScript = readFileSync(join(process.cwd(), 'scripts/deal-confirmation-ddl.mjs'), 'utf8')
const ddlCode = ddlScript.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
/** The table transaction's statements, in order (each a backtick string inside TABLE_STATEMENTS). */
const TABLE_SQL = [.../const TABLE_STATEMENTS = \[([\s\S]*?)\n\]\n/.exec(ddlCode)![1]!.matchAll(/`([^`]*)`/g)].map((m) => m[1]!)
const REVIEW_SQL = /const REVIEW_BASIS_STATEMENT = `([^`]*)`/.exec(ddlCode)![1]!
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const MODEL_RE = /^model (\w+) \{([\s\S]*?)^\}/gm
const body = (name: string) => [...schema.matchAll(MODEL_RE)].find((m) => m[1] === name)![2]!
const fields = (name: string) => body(name).split('\n').map((l) => /^\s+(\w+)\s+(\S+)(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
  .map((m) => `${m[1]} ${m[2]}${m[3]!.replace(/\/\/\/.*$/, '').replace(/\s+/g, ' ').trimEnd()}`)

describe('scripts/deal-confirmation-ddl.mjs ↔ prisma/schema.prisma', () => {
  it('DealConfirmation: the columns, the unique conversation and review, the Cascade relation, the (sellerId, confirmedAt) index', () => {
    expect(fields('DealConfirmation')).toEqual([
      'id String @id @default(cuid())',
      'conversationId String @unique',
      'conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)',
      'listingId String',
      'sellerId String',
      'sellerProfileId String @db.Uuid',
      'buyerProfileId String @db.Uuid',
      'kind String',
      'confirmedAt DateTime?',
      'revokedAt DateTime?',
      'declinedAt DateTime?',
      'confirmCount Int @default(0)',
      'reviewId String? @unique',
      'createdAt DateTime @default(now())',
      'updatedAt DateTime @updatedAt',
    ])
    expect(body('DealConfirmation')).toMatch(/^\s+@@index\(\[sellerId, confirmedAt\]\)$/m)
  })

  it('DealConfirmationEvent: no relation at all (it outlives every cascade), two indexes', () => {
    expect(fields('DealConfirmationEvent')).toEqual([
      'id String @id @default(cuid())',
      'conversationId String',
      'listingId String',
      'sellerId String',
      'actorProfileId String @db.Uuid',
      'buyerProfileId String @db.Uuid',
      'action String',
      'createdAt DateTime @default(now())',
    ])
    expect(body('DealConfirmationEvent')).toMatch(/^\s+@@index\(\[conversationId, createdAt\]\)$/m)
    expect(body('DealConfirmationEvent')).toMatch(/^\s+@@index\(\[actorProfileId, action, createdAt\]\)$/m)
  })

  it('Review.basis is a nullable String; Conversation carries the back-relation only', () => {
    expect(fields('Review')).toContain('basis String?')
    expect(fields('Conversation')).toContain('dealConfirmation DealConfirmation?')
  })

  it("creates Prisma's own columns, keys, indexes and the one foreign key", () => {
    const cols = (sql: string) => [...sql.matchAll(/^\s*"(\w+)" ([A-Z0-9() _]+?),?$/gm)].map((m) => `${m[1]} ${m[2]}`)
    expect(cols(TABLE_SQL[0]!)).toEqual([
      'id TEXT NOT NULL', 'conversationId TEXT NOT NULL', 'listingId TEXT NOT NULL', 'sellerId TEXT NOT NULL',
      'sellerProfileId UUID NOT NULL', 'buyerProfileId UUID NOT NULL', 'kind TEXT NOT NULL', 'confirmedAt TIMESTAMP(3)',
      'revokedAt TIMESTAMP(3)', 'declinedAt TIMESTAMP(3)', 'confirmCount INTEGER NOT NULL DEFAULT 0', 'reviewId TEXT',
      'createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP', 'updatedAt TIMESTAMP(3) NOT NULL',
    ])
    expect(TABLE_SQL[0]).toContain('CONSTRAINT "DealConfirmation_pkey" PRIMARY KEY ("id")')
    expect(TABLE_SQL[1]).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "DealConfirmation_conversationId_key" ON public."DealConfirmation"("conversationId")')
    expect(TABLE_SQL[2]).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "DealConfirmation_reviewId_key" ON public."DealConfirmation"("reviewId")')
    expect(TABLE_SQL[3]).toBe('CREATE INDEX IF NOT EXISTS "DealConfirmation_sellerId_confirmedAt_idx" ON public."DealConfirmation"("sellerId", "confirmedAt")')
    expect(TABLE_SQL[4]).toContain('ADD CONSTRAINT "DealConfirmation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE')
    expect(cols(TABLE_SQL[5]!)).toEqual([
      'id TEXT NOT NULL', 'conversationId TEXT NOT NULL', 'listingId TEXT NOT NULL', 'sellerId TEXT NOT NULL',
      'actorProfileId UUID NOT NULL', 'buyerProfileId UUID NOT NULL', 'action TEXT NOT NULL',
      'createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    ])
    expect(TABLE_SQL[6]).toBe('CREATE INDEX IF NOT EXISTS "DealConfirmationEvent_conversationId_createdAt_idx" ON public."DealConfirmationEvent"("conversationId", "createdAt")')
    expect(TABLE_SQL[7]).toBe('CREATE INDEX IF NOT EXISTS "DealConfirmationEvent_actorProfileId_action_createdAt_idx" ON public."DealConfirmationEvent"("actorProfileId", "action", "createdAt")')
    expect(REVIEW_SQL).toBe('ALTER TABLE public."Review" ADD COLUMN IF NOT EXISTS "basis" TEXT')
  })

  it('⛔ additive only; TWO transactions, each under a lock_timeout; RLS enabled AND forced, asserted before the first COMMIT; the API roles revoked', () => {
    expect([...TABLE_SQL, REVIEW_SQL].join('\n')).not.toMatch(/\bdrop\b|alter\s+column|\btruncate\b/i)
    expect(ddlCode).not.toMatch(/\bdrop\b|create\s+policy|\bgrant\b/i)
    for (const t of ['DealConfirmation', 'DealConfirmationEvent']) {
      expect(TABLE_SQL).toContain(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`)
      expect(TABLE_SQL).toContain(`ALTER TABLE public."${t}" FORCE ROW LEVEL SECURITY`)
      for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(TABLE_SQL.at(-1)).toContain(`REVOKE ALL ON public."${t}" FROM ${role}`)
    }
    const at = (s: string, from = 0) => ddlCode.indexOf(s, from)
    const begin1 = at("client.query('BEGIN')")
    const loop = at('for (const [label, sql] of TABLE_STATEMENTS)')
    const rlsCheck = at('relforcerowsecurity')
    const commit1 = at("client.query('COMMIT')")
    const begin2 = at("client.query('BEGIN')", commit1)
    const review = at('client.query(REVIEW_BASIS_STATEMENT)')
    const commit2 = at("client.query('COMMIT')", review)
    expect(begin1).toBeGreaterThan(-1)
    expect(at("SET LOCAL lock_timeout = '5s'", begin1)).toBeLessThan(loop)
    expect(begin1 < loop && loop < rlsCheck && rlsCheck < commit1 && commit1 < begin2 && begin2 < review && review < commit2).toBe(true)
    expect(at("SET LOCAL lock_timeout = '5s'", begin2)).toBeLessThan(review)
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
      CREATE TABLE public."Conversation" (id text PRIMARY KEY);
      CREATE TABLE public."Review" (id text PRIMARY KEY, rating int NOT NULL DEFAULT 5);
      INSERT INTO public."Conversation" VALUES ('c1'), ('c2');
      INSERT INTO public."Review" (id) VALUES ('r-old');
    `)
    // Twice: the script is idempotent.
    for (let i = 0; i < 2; i++) {
      for (const sql of TABLE_SQL) await pg.exec(sql)
      await pg.exec(REVIEW_SQL)
    }
  }, 120_000)
  afterAll(async () => { await pg?.close() })

  it('RLS on and forced on both tables, closed to the API roles', async () => {
    const rls = await pg.query<{ relname: string; r: boolean; f: boolean }>(`SELECT relname, relrowsecurity AS r, relforcerowsecurity AS f FROM pg_class
      WHERE oid IN ('public."DealConfirmation"'::regclass, 'public."DealConfirmationEvent"'::regclass) ORDER BY relname`)
    expect(rls.rows).toEqual([{ relname: 'DealConfirmation', r: true, f: true }, { relname: 'DealConfirmationEvent', r: true, f: true }])
    for (const t of ['DealConfirmation', 'DealConfirmationEvent']) {
      const grants = await pg.query(`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
          AND has_table_privilege(r.rolname, 'public."${t}"', 'SELECT,INSERT,UPDATE,DELETE')
        UNION ALL SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          WHERE c.oid = 'public."${t}"'::regclass AND a.grantee = 0`)
      expect(grants.rows).toEqual([])
    }
  })

  it('one row per conversation, one per review; the row goes with its conversation, the events stay', async () => {
    const ins = (id: string, convo: string, reviewId: string | null) => pg.exec(`INSERT INTO public."DealConfirmation"
      ("id", "conversationId", "listingId", "sellerId", "sellerProfileId", "buyerProfileId", "kind", "updatedAt", "reviewId")
      VALUES ('${id}', '${convo}', 'L1', 's1', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'rental', now(), ${reviewId ? `'${reviewId}'` : 'NULL'})`)
    await ins('d1', 'c1', 'r1')
    await expect(ins('d2', 'c1', null)).rejects.toThrow(/duplicate key/)
    await expect(ins('d3', 'c2', 'r1')).rejects.toThrow(/duplicate key/)
    await expect(ins('d4', 'nope', null)).rejects.toThrow(/foreign key/)
    await pg.exec(`INSERT INTO public."DealConfirmationEvent" ("id", "conversationId", "listingId", "sellerId", "actorProfileId", "buyerProfileId", "action")
      VALUES ('e1', 'c1', 'L1', 's1', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'confirm')`)
    await pg.exec(`DELETE FROM public."Conversation" WHERE id = 'c1'`)
    expect((await pg.query(`SELECT 1 FROM public."DealConfirmation" WHERE "conversationId" = 'c1'`)).rows).toHaveLength(0)
    expect((await pg.query(`SELECT 1 FROM public."DealConfirmationEvent" WHERE "conversationId" = 'c1'`)).rows).toHaveLength(1)
  })

  it('Review.basis: nullable, no default — an existing review reads NULL ("Verified buyer")', async () => {
    const col = await pg.query<{ data_type: string; is_nullable: string; column_default: string | null }>(`SELECT data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'Review' AND column_name = 'basis'`)
    expect(col.rows).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }])
    expect((await pg.query<{ basis: string | null }>(`SELECT basis FROM public."Review" WHERE id = 'r-old'`)).rows).toEqual([{ basis: null }])
  })
})
