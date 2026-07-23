import 'server-only'
import { db } from '@/lib/db'

// Real seller response metrics — the nightly job that makes RESPONSE_METRIC_IS_REAL
// true (see seller-metrics.ts). One set-based UPDATE, never a per-seller JS scan.
//
// Definitions (dual-reviewed 2026-07-23, codex + Gemini — both fixes below are theirs):
//   · A Conversation is buyer-opened by construction, so the clock starts at
//     Conversation.createdAt.
//   · A reply is the FIRST message from anyone other than the buyer — but only of
//     kind 'text' or 'offer'. Visa cards (visa_step/…) are AUTO-POSTED with the shop
//     owner as sender when the BUYER advances the wizard, so counting them would
//     credit the seller with machine "replies" (Gemini's find).
//   · Only conversations older than 24h are scored: a thread opened minutes before
//     the run cannot possibly have a within-24h reply yet, so counting it would
//     unfairly depress the rate during inbound bursts (codex's find).
//   · n >= RESPONSE_MIN_CONVOS(5): thinner history is never written — those sellers
//     keep the fabricated =100 default AND a NULL responseMetricAt, and BOTH display
//     and trust gate on responseMetricAt, so the default can never surface.
//
// The correlated MIN rides @@index([conversationId, createdAt]). The outer 90d filter
// has no Conversation(createdAt) index ON PURPOSE: this runs once nightly, a seq scan
// is the right trade against taxing every conversation insert with another index.
//
// Sender invariant the reply definition rests on (verified 2026-07-23): every
// 'text'/'offer' write path is participant-gated (conversations create / [id]/messages
// 403 non-participants; admin/report messaging never inserts Message rows), so a
// non-buyer sender IS the seller side. The visa concierge posts as the shop's own
// desk profile — an AI answering on the shop's behalf counts as the shop responding.
export async function recomputeResponseRates(): Promise<number> {
  const written = await db.$executeRaw`
    WITH conv AS (
      SELECT c."sellerId",
             c."createdAt" AS opened_at,
             (SELECT MIN(m."createdAt") FROM "Message" m
               WHERE m."conversationId" = c.id
                 AND m."senderProfileId" <> c."buyerProfileId"
                 AND m.kind IN ('text', 'offer')) AS reply_at
      FROM "Conversation" c
      WHERE c."createdAt" >= now() - interval '90 days'
        AND c."createdAt" < now() - interval '24 hours'
    ),
    agg AS (
      SELECT "sellerId",
             count(*) AS n,
             count(*) FILTER (
               WHERE reply_at IS NOT NULL
                 AND reply_at - opened_at <= interval '24 hours') AS replied,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY (reply_at - opened_at))
               FILTER (WHERE reply_at IS NOT NULL) AS median_gap
      FROM conv GROUP BY "sellerId"
    )
    UPDATE "Seller" s
    SET "responseRate" = round(100.0 * a.replied / a.n)::int,
        "responseTime" = CASE
          WHEN a.median_gap <= interval '1 hour' THEN 'within an hour'
          WHEN a.median_gap <= interval '24 hours' THEN 'within a day'
          ELSE 'within a few days' END,
        "responseMetricAt" = now()
    FROM agg a
    WHERE s.id = a."sellerId" AND a.n >= 5
  `
  // Receipt hygiene: an eligible seller is re-stamped every night, so a receipt more
  // than a few days old means the seller FELL OUT of the >=5-convo cohort (or the
  // cron broke — either way suppression is the safe direction). Without this sweep a
  // once-measured seller kept a stale rate in the trust term forever (dual review,
  // 2026-07-23). 8d > the nightly cadence with generous slack for missed runs.
  await db.$executeRaw`
    UPDATE "Seller" SET "responseMetricAt" = NULL
    WHERE "responseMetricAt" < now() - interval '8 days'
  `
  return written
}
