import 'server-only'
import { db } from '@/lib/db'

/**
 * THE TRUSTPILOT INVITE (owner, 2026-11-17) — one in-app bell per account asking for a review on Trustpilot's public
 * evaluate page. /privacy names it ('why-and-basis'); /api/cron/trustpilot-invite runs it daily at 10:15 ICT.
 *
 * D1 · THE BELL ONLY — no web or native push (owner, 2026-11-17: "in-app bell only"). The push opt-in is a promise of
 *      what sends a push (PushEventList), and a review ask is not on it — the job-messages invite's precedent.
 * D2 · ONE SENDER, eno.vn: the route answers {skipped:'marketplace_only'} elsewhere and the installer pins it to :3001.
 * D3 · NEVER TWICE. One statement writes two rows: a hidden RECORD (`trustpilot-invite-<profile>`, type
 *      'trustpilot_invited', read — RECORD_ONLY_NOTIFICATION_TYPES: no bell shows or deletes it) and the visible BELL
 *      (`trustpilot-bell-<profile>`, the person may delete it). The record is inserted ON CONFLICT DO NOTHING and a bell
 *      is written only for a record this same statement inserted, so a re-run, a parallel run or a deleted bell never
 *      asks again. Erasing the Profile cascades to both. (kv_store cannot hold this: it is UNLOGGED.)
 * D4 · NO BACKFILL: only a mark on or after `startsAt` (the deploy day, 00:00 ICT) is invited, at most `maxPerRun` a
 *      run, oldest mark first. A backfill later is a change to `startsAt`.
 * D5 · NOT INVITED: any @eno.vn / @eno.forum address (staff, desks, review seats, e2e and partner shells), the addresses
 *      the route passes (ADMIN_EMAILS, the hidden desks, both desk operators) and official-partner owners (conflict of
 *      interest). Held or suspended accounts, a compliance flag and the 'restricted' tier (Profile or owned Seller) WAIT:
 *      a mark never expires, so they are asked once the account is back in standing. Warned and throttled are asked.
 * D6 · THE MARK: 7 days after the EARLIER of the account's first message as the buyer in a listing thread (support and
 *      desk threads have no listing) and its first listing on a storefront it owns at GREATEST(createdAt, claimedAt) —
 *      there is no publishedAt, so createdAt stands in for "went live".
 */
export const TRUSTPILOT_INVITE = {
  type: 'trustpilot_invite',
  recordType: 'trustpilot_invited',
  url: 'https://www.trustpilot.com/evaluate/eno.vn',
  /** Bilingual composite (written server-side, where tr() cannot run); the bell shows its own tr() label. */
  title: 'Đánh giá eno trên Trustpilot? · Review eno on Trustpilot?',
  /** ⛔ THE DEPLOY DAY, like PRIVACY_TEXT_PUBLISHED (src/lib/compliance/privacy-updated.ts): re-date both together. */
  startsAt: '2026-11-17T00:00:00+07:00',
  maxPerRun: 200,
} as const

// Stored timestamps are zone-less UTC: pass UTC wall-clock text, never a Date.
const startsAtSql = () => new Date(TRUSTPILOT_INVITE.startsAt).toISOString().slice(0, 23).replace('T', ' ')

/**
 * $1 startsAt text · $2 excluded emails text[] · $3 limit int (null = all).
 * ⛔ THE SELLER PREDICATE KEEPS A RETURNING SELLER OLD: a listing that went live and was since hidden by its seller
 * (still verified), sold, or removed still dates the account — a predicate on today's 'active' would make a long-time
 * seller "new" on their next listing and ask them after startsAt. Pending and refused listings never count.
 * ⛔ A TOMBSTONE COUNTS ONLY IF ITS REMOVAL AUDIT SAYS IT WAS LIVE: every removal (seller delete, moderator reject,
 * admin remove) writes status 'removed' + verified false (src/lib/core/listing-tombstone.ts), so the row alone cannot
 * tell a deleted live listing from a rejected pending one. Its compliance_audit 'listing.removed' row can:
 * detail.priorVerified true or detail.priorStatus 'sold'. Every tombstone since 2026-10-01 has that row.
 * ⛔ A BUYER'S TRIGGER IS A LISTING ON ENO.VN (the commit gate, 2026-11-17): a thread about a listing whose storefront an excluded
 * address owns — eno's own visa desk (HIDDEN_DESK_OWNER_EMAILS: forum-only, never on eno.vn) and the operators' desks — does not
 * count, so someone who only ever asked the forum's visa desk is never asked to review eno.vn.
 * ⛔ THE NULL-EMAIL BRANCH IS DELIBERATE: phone-only accounts are real people, and `NULL <> ALL(…)` would drop them
 * (the trap in src/lib/review-seat-accounts.ts NOT_A_REVIEW_SEATS_LISTING).
 */
export const ELIGIBLE_SQL = `
WITH firsts AS (
  SELECT m."senderProfileId" AS pid, m."createdAt" AS at
    FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
    JOIN "Listing" bl ON bl.id = c."listingId" JOIN "Seller" bs ON bs.id = bl."sellerId" LEFT JOIN "Profile" bo ON bo.id = bs."ownerId"
   WHERE m."senderProfileId" = c."buyerProfileId" AND (bo.email IS NULL OR lower(bo.email) <> ALL($2::text[]))
  UNION ALL
  SELECT s."ownerId", GREATEST(l."createdAt", COALESCE(s."claimedAt", l."createdAt"))
    FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId"
   WHERE s."ownerId" IS NOT NULL AND (l.verified OR l.status = 'sold' OR (l.status = 'removed' AND EXISTS (
     SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = l.id AND a.action = 'listing.removed'
        AND (a.detail->>'priorVerified' = 'true' OR a.detail->>'priorStatus' = 'sold'))))
), due AS (SELECT pid, min(at) + interval '7 days' AS at FROM firsts GROUP BY pid)
SELECT p.id FROM due d
  JOIN "Profile" p ON p.id = d.pid
  LEFT JOIN "Seller" s ON s."ownerId" = p.id
 WHERE d.at >= $1::timestamp AND d.at <= (now() AT TIME ZONE 'UTC')
   AND NOT EXISTS (SELECT 1 FROM "Notification" n WHERE n.id = 'trustpilot-invite-' || p.id::text)
   AND p."enforcementState" NOT IN ('held','suspended') AND p."complianceFlag" IS NULL
   AND p."trustTier" <> 'restricted' AND s."trustTier" IS DISTINCT FROM 'restricted'
   AND s."officialPartner" IS NOT TRUE
   AND (p.email IS NULL OR (lower(p.email) <> ALL($2::text[]) AND split_part(lower(p.email),'@',2) NOT IN ('eno.vn','eno.forum')))
 ORDER BY d.at, p.id
 LIMIT $3::int`

/** ELIGIBLE_SQL's $1–$3, then $4 the bell's title and $5 its url. The command's count is the bells written. */
export const SEND_SQL = `
WITH e AS (${ELIGIBLE_SQL}),
rec AS (INSERT INTO "Notification" (id,"recipientId",type,title,read,"createdAt")
        SELECT 'trustpilot-invite-' || e.id::text, e.id, 'trustpilot_invited', '', true, (now() AT TIME ZONE 'UTC') FROM e
        ON CONFLICT (id) DO NOTHING RETURNING "recipientId")
INSERT INTO "Notification" (id,"recipientId",type,title,url,read,"createdAt")
SELECT 'trustpilot-bell-' || r."recipientId"::text, r."recipientId", 'trustpilot_invite', $4, $5, false, (now() AT TIME ZONE 'UTC') FROM rec r
ON CONFLICT (id) DO NOTHING`

/** How many accounts are due now (uncapped) — the dry run. Writes nothing. */
export async function countTrustpilotInvites(excluded: string[]): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM (${ELIGIBLE_SQL}) e`, startsAtSql(), excluded, null)
  return Number(rows[0]?.n ?? 0)
}

/** Invite up to maxPerRun accounts; answers the number of bells written. One statement: all or nothing. */
export async function sendTrustpilotInvites(excluded: string[]): Promise<number> {
  const { maxPerRun, title, url } = TRUSTPILOT_INVITE
  return db.$executeRawUnsafe(SEND_SQL, startsAtSql(), excluded, maxPerRun, title, url)
}
