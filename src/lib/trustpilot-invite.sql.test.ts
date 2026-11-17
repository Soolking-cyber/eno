import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() } }))

import { db } from '@/lib/db'
import { TRUSTPILOT_INVITE, countTrustpilotInvites, sendTrustpilotInvites } from './trustpilot-invite'

/**
 * ⛔ THE TRUSTPILOT INVITE'S SQL, EXECUTED (src/lib/trustpilot-invite.ts). ELIGIBLE_SQL and SEND_SQL run in a real Postgres
 * (PGlite — Postgres compiled to WASM, in-process) through the module's own functions: who is due (the earlier of the
 * first buyer message in a listing thread and the first live listing, + 7 days, on or after startsAt), who is not (eno's
 * own addresses, the excluded list, official partners; held / suspended / flagged / restricted WAIT), and never twice
 * (a re-run, a deleted bell, a deleted record).
 *
 * ⚠️ THE CLOCK IS PINNED: `now()` resolves to clock.now() (search_path puts the schema ahead of pg_catalog), so the
 * fixtures sit at fixed distances from a fixed run time and startsAt is the module's real constant. The session runs in
 * Vietnam time (TimeZone=Asia/Ho_Chi_Minh): stored timestamps are zone-less UTC, and a statement that compared them with
 * a bare now() would be 7 hours off — the "not yet" buyer below (day 6.875) would be invited.
 *
 * ⚠️ PGlite is not a declared dependency — it arrives with Prisma's dev tooling. Locally a missing PGlite SKIPS this suite;
 * in CI (CI=true) it FAILS instead (the pattern of src/lib/price-stat.sql.test.ts).
 */

type Pg = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }>
  exec: (sql: string) => Promise<unknown>
  close: () => Promise<void>
}

const pgliteModule = await (async (): Promise<{ PGlite: { create: () => Promise<Pg> } } | null> => {
  const specifier = '@electric-sql/pglite'
  try {
    return (await import(/* @vite-ignore */ specifier)) as { PGlite: { create: () => Promise<Pg> } }
  } catch {
    return null
  }
})()

/** The run: 10:15 ICT, two weeks after startsAt. */
const NOW = Date.parse('2026-12-01T03:15:00Z')
const START = Date.parse(TRUSTPILOT_INVITE.startsAt)
const DAY = 86_400_000
const HOUR = 3_600_000
/** UTC wall-clock text, as the columns store it. */
const ts = (ms: number) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ')
const ago = (days: number, hours = 0) => ts(NOW - days * DAY - hours * HOUR)

const ADMIN = 'boss@example.com'
const EXCLUDED = [ADMIN, 'support@eno.forum']

describe.runIf(!pgliteModule && !!process.env.CI)('trustpilot-invite SQL in CI', () => {
  it('needs @electric-sql/pglite (installed with prisma\'s dev tooling) — it is missing from this install', () => {
    expect.fail('PGlite is missing, so the Trustpilot invite SQL was not executed. Restore it (npm ci) or declare it as a devDependency.')
  })
})

describe.skipIf(!pgliteModule)(`trustpilot-invite SQL, executed in Postgres${pgliteModule ? '' : ' (SKIPPED: @electric-sql/pglite is not installed)'}`, () => {
  let pg: Pg
  let seq = 0
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

  type ProfileOver = { email?: string | null; trustTier?: string; enforcementState?: string; complianceFlag?: string | null }
  async function profile(o: ProfileOver = {}): Promise<string> {
    const id = uuid()
    await pg.query(
      `INSERT INTO "Profile" (id, email, "trustTier", "enforcementState", "complianceFlag") VALUES ($1, $2, $3, $4, $5)`,
      [id, o.email === undefined ? `user${seq}@example.com` : o.email, o.trustTier ?? 'standard', o.enforcementState ?? 'good_standing', o.complianceFlag ?? null],
    )
    return id
  }
  /** A storefront nobody owns (the other side of a buyer's thread). */
  async function shop(): Promise<{ sellerId: string; listingId: string }> {
    const sellerId = `s${++seq}`, listingId = `l${seq}`
    await pg.query(`INSERT INTO "Seller" (id) VALUES ($1)`, [sellerId])
    await pg.query(`INSERT INTO "Listing" (id, "sellerId", status, verified, "createdAt") VALUES ($1, $2, 'active', true, $3)`, [listingId, sellerId, ago(60)])
    return { sellerId, listingId }
  }
  /** `pid` writes in a thread: as the buyer of a listing (default), in a listing-less desk thread, or as the seller. */
  async function message(pid: string, at: string, kind: 'buyer' | 'listingless' | 'seller' = 'buyer'): Promise<void> {
    const { sellerId, listingId } = await shop()
    const convo = `c${++seq}`
    const buyer = kind === 'seller' ? await profile() : pid
    await pg.query(`INSERT INTO "Conversation" (id, "listingId", "buyerProfileId", "sellerId") VALUES ($1, $2, $3, $4)`, [convo, kind === 'listingless' ? null : listingId, buyer, sellerId])
    await pg.query(`INSERT INTO "Message" (id, "conversationId", "senderProfileId", "createdAt") VALUES ($1, $2, $3, $4)`, [`m${++seq}`, convo, pid, at])
  }
  type SellerOver = { officialPartner?: boolean; trustTier?: string; claimedAt?: string | null }
  /** `pid`'s own storefront (made once). */
  async function storefront(pid: string, o: SellerOver = {}): Promise<string> {
    const found = await pg.query(`SELECT id FROM "Seller" WHERE "ownerId" = $1`, [pid])
    if (found.rows[0]) return found.rows[0].id as string
    const id = `own${++seq}`
    await pg.query(
      `INSERT INTO "Seller" (id, "ownerId", "claimedAt", "officialPartner", "trustTier") VALUES ($1, $2, $3, $4, $5)`,
      [id, pid, o.claimedAt ?? null, o.officialPartner ?? false, o.trustTier ?? 'standard'],
    )
    return id
  }
  async function listing(pid: string, at: string, o: { status?: string; verified?: boolean } = {}, s: SellerOver = {}): Promise<string> {
    const sellerId = await storefront(pid, s)
    const id = `l${++seq}`
    await pg.query(`INSERT INTO "Listing" (id, "sellerId", status, verified, "createdAt") VALUES ($1, $2, $3, $4, $5)`, [id, sellerId, o.status ?? 'active', o.verified ?? true, at])
    return id
  }
  /** The 'listing.removed' audit row tombstoneListingsTx writes with every removal (src/lib/core/listing-tombstone.ts). */
  async function removalAudit(listingId: string, detail: { priorVerified: boolean; priorStatus: string }): Promise<void> {
    await pg.query(
      `INSERT INTO compliance_audit (action, "subjectType", "subjectId", detail) VALUES ('listing.removed', 'listing', $1, $2::jsonb)`,
      [listingId, JSON.stringify({ by: 'seller', reason: 'seller_delete', ...detail })],
    )
  }

  const send = () => sendTrustpilotInvites(EXCLUDED)
  const bells = async () => (await pg.query(`SELECT "recipientId" AS id FROM "Notification" WHERE type = 'trustpilot_invite' ORDER BY id`)).rows.map((r) => r.id as string)
  const records = async () => (await pg.query(`SELECT "recipientId" AS id FROM "Notification" WHERE type = 'trustpilot_invited' ORDER BY id`)).rows.map((r) => r.id as string)

  beforeAll(async () => {
    pg = await pgliteModule!.PGlite.create()
    // The columns the statements read; Notification as scripts/add-notifications-table.mjs creates it (+ url).
    await pg.exec(`
      CREATE TABLE "Profile" (
        id uuid PRIMARY KEY, email text UNIQUE, "trustTier" text NOT NULL DEFAULT 'standard',
        "enforcementState" text NOT NULL DEFAULT 'good_standing', "complianceFlag" text
      );
      CREATE TABLE "Seller" (
        id text PRIMARY KEY, "ownerId" uuid UNIQUE REFERENCES "Profile"(id), "claimedAt" timestamp(3),
        "officialPartner" boolean NOT NULL DEFAULT false, "trustTier" text NOT NULL DEFAULT 'standard'
      );
      CREATE TABLE "Listing" (
        id text PRIMARY KEY, "sellerId" text NOT NULL REFERENCES "Seller"(id), status text NOT NULL,
        verified boolean NOT NULL, "createdAt" timestamp(3) NOT NULL
      );
      CREATE TABLE "Conversation" (
        id text PRIMARY KEY, "listingId" text REFERENCES "Listing"(id) ON DELETE CASCADE,
        "buyerProfileId" uuid NOT NULL REFERENCES "Profile"(id) ON DELETE CASCADE, "sellerId" text NOT NULL REFERENCES "Seller"(id)
      );
      CREATE TABLE "Message" (
        id text PRIMARY KEY, "conversationId" text NOT NULL REFERENCES "Conversation"(id) ON DELETE CASCADE,
        "senderProfileId" uuid NOT NULL REFERENCES "Profile"(id) ON DELETE CASCADE, "createdAt" timestamp(3) NOT NULL
      );
      CREATE TABLE "Notification" (
        id text PRIMARY KEY, "recipientId" uuid NOT NULL REFERENCES "Profile"(id) ON DELETE CASCADE, type text NOT NULL,
        title text NOT NULL, body text, "actorName" text, "conversationId" text, "listingId" text, url text,
        read boolean NOT NULL DEFAULT false, "createdAt" timestamp(3) NOT NULL DEFAULT now()
      );
      CREATE TABLE compliance_audit (id serial, action text, "subjectType" text, "subjectId" text, detail jsonb);
      CREATE SCHEMA clock;
      CREATE FUNCTION clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT '${new Date(NOW).toISOString()}'::timestamptz $$;
      SET search_path = clock, pg_catalog, public;
      SET TimeZone = 'Asia/Ho_Chi_Minh';
    `)
  }, 120_000)

  afterAll(async () => {
    await pg?.close()
  })

  beforeEach(async () => {
    await pg.exec(`TRUNCATE compliance_audit, "Notification", "Message", "Conversation", "Listing", "Seller", "Profile" CASCADE`)
    vi.mocked(db.$queryRawUnsafe).mockImplementation((async (sql: string, ...values: unknown[]) => (await pg.query(sql, values)).rows) as never)
    vi.mocked(db.$executeRawUnsafe).mockImplementation((async (sql: string, ...values: unknown[]) => (await pg.query(sql, values)).affectedRows ?? 0) as never)
  })

  it('the clock is pinned and the session is in Vietnam time — the fixtures below depend on both', async () => {
    const { rows } = await pg.query(`SELECT (now() AT TIME ZONE 'UTC')::text AS utc, current_setting('TimeZone') AS tz`)
    expect(rows[0]).toEqual({ utc: '2026-12-01 03:15:00', tz: 'Asia/Ho_Chi_Minh' })
  })

  describe('the mark: the earlier of the first buyer message and the first live listing, + 7 days', () => {
    it('a buyer is asked from day 7 of their first message in a listing thread — not on day 6', async () => {
      const due = await profile(), early = await profile()
      await message(due, ago(7, 1))
      await message(early, ago(7, -3)) // day 6.875 — a bare now() in Vietnam time would call this due
      expect(await send()).toBe(1)
      expect(await bells()).toEqual([due])
    })

    it('a seller is asked from day 7 of their first live listing', async () => {
      const seller = await profile()
      await listing(seller, ago(8))
      expect(await send()).toBe(1)
      expect(await bells()).toEqual([seller])
    })

    it('a claimed storefront dates from the claim, not from listings made before it', async () => {
      const claimed = await profile(), recent = await profile()
      await listing(claimed, ts(START - 90 * DAY), {}, { claimedAt: ago(8) })
      await listing(recent, ts(START - 90 * DAY), {}, { claimedAt: ago(5) })
      expect(await send()).toBe(1)
      expect(await bells()).toEqual([claimed])
    })

    it('the EARLIER event dates the account — a later one never moves the mark', async () => {
      const both = await profile(), oldSeller = await profile()
      await message(both, ago(8)); await listing(both, ago(2))
      // First listed before startsAt, first message this week: their mark is before startsAt — never asked.
      await listing(oldSeller, ts(START - 30 * DAY)); await message(oldSeller, ago(8))
      expect(await send()).toBe(1)
      expect(await bells()).toEqual([both])
    })

    it('⛔ no backfill: a mark before startsAt is never asked', async () => {
      const before = await profile(), at = await profile()
      await message(before, ts(START - 7 * DAY - HOUR))
      await message(at, ts(START - 7 * DAY))
      expect(await send()).toBe(1)
      expect(await bells()).toEqual([at])
    })
  })

  describe('activity that does not count', () => {
    it('a listing-less (support or desk) message, and a reply as the seller', async () => {
      const desk = await profile(), replier = await profile()
      await message(desk, ago(10), 'listingless')
      await message(replier, ago(10), 'seller')
      expect(await countTrustpilotInvites(EXCLUDED)).toBe(0)
      expect(await send()).toBe(0)
    })

    it('⛔ a thread about a listing an excluded address owns (eno\'s forum-only visa desk) — the buyer is never asked to review eno.vn', async () => {
      const desk = await profile({ email: 'support@eno.forum' }), visaBuyer = await profile()
      const deskListing = await listing(desk, ago(60))
      const convo = `c${++seq}`
      await pg.query(`INSERT INTO "Conversation" (id, "listingId", "buyerProfileId", "sellerId") VALUES ($1, $2, $3, (SELECT "sellerId" FROM "Listing" WHERE id = $2))`, [convo, deskListing, visaBuyer])
      await pg.query(`INSERT INTO "Message" (id, "conversationId", "senderProfileId", "createdAt") VALUES ($1, $2, $3, $4)`, [`m${++seq}`, convo, visaBuyer, ago(10)])
      expect(await countTrustpilotInvites(EXCLUDED)).toBe(0)
    })

    it('a listing still waiting, or refused — a refusal is a tombstone whose removal audit says it was never live', async () => {
      const pending = await profile(), refused = await profile(), noAudit = await profile()
      await listing(pending, ago(10), { verified: false })
      // What a moderator's reject (or a seller deleting a pending listing) really writes: status 'removed', verified false.
      await removalAudit(await listing(refused, ago(10), { verified: false, status: 'removed' }), { priorVerified: false, priorStatus: 'hidden' })
      // A tombstone with no removal audit at all proves nothing — it never counts.
      await listing(noAudit, ago(10), { verified: false, status: 'removed' })
      expect(await countTrustpilotInvites(EXCLUDED)).toBe(0)
      expect(await send()).toBe(0)
    })

    it('⛔ a returning seller stays old: a first listing since hidden by its seller, sold or deleted still dates the account', async () => {
      const old = ts(START - 60 * DAY)
      const hid = await profile(), sold = await profile(), removed = await profile()
      await listing(hid, old, { status: 'hidden', verified: true })
      await listing(sold, old, { status: 'sold', verified: false })
      // Deleted while live: its removal audit says so.
      await removalAudit(await listing(removed, old, { status: 'removed', verified: false }), { priorVerified: true, priorStatus: 'active' })
      for (const pid of [hid, sold, removed]) await listing(pid, ago(8))
      expect(await send()).toBe(0)
    })
  })

  describe('⛔ never twice', () => {
    it('one statement writes the hidden record and the bell — and a re-run asks nobody again', async () => {
      const pid = await profile()
      await message(pid, ago(8))
      expect(await send()).toBe(1)
      const { rows } = await pg.query(`SELECT id, type, title, url, read, "createdAt"::text AS at FROM "Notification" ORDER BY id`)
      expect(rows).toEqual([
        { id: `trustpilot-bell-${pid}`, type: 'trustpilot_invite', title: TRUSTPILOT_INVITE.title, url: TRUSTPILOT_INVITE.url, read: false, at: '2026-12-01 03:15:00' },
        { id: `trustpilot-invite-${pid}`, type: 'trustpilot_invited', title: '', url: null, read: true, at: '2026-12-01 03:15:00' },
      ])
      expect(await send()).toBe(0)
      expect(await countTrustpilotInvites(EXCLUDED)).toBe(0)
    })

    it('a deleted bell is not sent again', async () => {
      const pid = await profile()
      await message(pid, ago(8))
      await send()
      await pg.query(`DELETE FROM "Notification" WHERE type = 'trustpilot_invite'`)
      expect(await send()).toBe(0)
      expect(await bells()).toEqual([])
    })

    it('a deleted record whose bell remains does not throw — and writes no second bell', async () => {
      const pid = await profile()
      await message(pid, ago(8))
      await send()
      await pg.query(`DELETE FROM "Notification" WHERE type = 'trustpilot_invited'`)
      expect(await send()).toBe(0)
      expect(await bells()).toEqual([pid])
      expect(await records()).toEqual([pid])
    })

    it('erasing the account erases both rows', async () => {
      const pid = await profile()
      await message(pid, ago(8))
      await send()
      await pg.query(`DELETE FROM "Profile" WHERE id = $1`, [pid])
      expect((await pg.query(`SELECT count(*)::int AS n FROM "Notification"`)).rows[0].n).toBe(0)
    })
  })

  describe('who is not asked', () => {
    it('eno itself — any @eno.vn or @eno.forum address, whatever its case — and the excluded addresses', async () => {
      const ids = await Promise.all(['Staff@ENO.vn', 'e2e-buyer@eno.vn', 'desk@eno.forum', 'Boss@Example.com', 'SUPPORT@eno.forum'].map((email) => profile({ email })))
      for (const pid of ids) await message(pid, ago(8))
      expect(await send()).toBe(0)
    })

    it('an official partner\'s owner (conflict of interest)', async () => {
      const partner = await profile()
      await listing(partner, ago(8), {}, { officialPartner: true })
      expect(await send()).toBe(0)
    })

    it('held, suspended, compliance-flagged and restricted (account or storefront) WAIT — and are asked once lifted', async () => {
      const held = await profile({ enforcementState: 'held' })
      const suspended = await profile({ enforcementState: 'suspended' })
      const flagged = await profile({ complianceFlag: 'authority_hold' })
      const restricted = await profile({ trustTier: 'restricted' })
      const restrictedShop = await profile()
      for (const pid of [held, suspended, flagged, restricted]) await message(pid, ago(8))
      await listing(restrictedShop, ago(8), {}, { trustTier: 'restricted' })
      expect(await send()).toBe(0)
      await pg.query(`UPDATE "Profile" SET "enforcementState" = 'good_standing', "complianceFlag" = NULL, "trustTier" = 'standard'`)
      await pg.query(`UPDATE "Seller" SET "trustTier" = 'standard'`)
      expect(await send()).toBe(5)
    })

    it('warned and throttled accounts, and a phone-only account (no email), ARE asked', async () => {
      const ids = [await profile({ enforcementState: 'warned' }), await profile({ enforcementState: 'throttled' }), await profile({ email: null })]
      for (const pid of ids) await message(pid, ago(8))
      expect(await send()).toBe(3)
      expect(await bells()).toEqual([...ids].sort())
    })
  })

  it('the cap: at most maxPerRun a run, the oldest mark first — the dry run counts them all', async () => {
    const n = TRUSTPILOT_INVITE.maxPerRun + 1
    // In bulk: one profile, one shop, one thread and one message each, the i-th message i minutes older.
    await pg.exec(`
      INSERT INTO "Profile" (id, email) SELECT ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'bulk' || i || '@example.com' FROM generate_series(1, ${n}) i;
      INSERT INTO "Seller" (id) SELECT 'bs' || i FROM generate_series(1, ${n}) i;
      INSERT INTO "Listing" (id, "sellerId", status, verified, "createdAt") SELECT 'bl' || i, 'bs' || i, 'active', true, '${ago(60)}' FROM generate_series(1, ${n}) i;
      INSERT INTO "Conversation" (id, "listingId", "buyerProfileId", "sellerId")
        SELECT 'bc' || i, 'bl' || i, ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, 'bs' || i FROM generate_series(1, ${n}) i;
      INSERT INTO "Message" (id, "conversationId", "senderProfileId", "createdAt")
        SELECT 'bm' || i, 'bc' || i, ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, '${ago(8)}'::timestamp - i * interval '1 minute' FROM generate_series(1, ${n}) i;
    `)
    expect(await countTrustpilotInvites(EXCLUDED)).toBe(n)
    expect(await send()).toBe(TRUSTPILOT_INVITE.maxPerRun)
    // The one left over is the YOUNGEST mark (i = 1, one minute older than ago(8)).
    expect(await countTrustpilotInvites(EXCLUDED)).toBe(1)
    expect((await bells())).not.toContain('00000000-0000-4000-9000-000000000001')
    expect(await send()).toBe(1)
  })
})
