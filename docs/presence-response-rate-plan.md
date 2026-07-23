# Real response-rate + last-online — implementation spec (owner-requested 2026-07-23)

Owner chose "build both for real". Both are honesty-gated: response rate is a fabricated
=100 default today (RESPONSE_METRIC_IS_REAL=false suppresses it); last-online does not
exist for marketplace sellers. NOTHING may surface until computed from real data. This
spec was produced by a mapping+design workflow verified against the live files.

# ENO — Real response-rate + last-online: one implementation plan

Verified against the live files. Dependency order.

---

## 1. RESPONSE RATE (real, from Conversation/Message)

**Compute** — one set-based SQL aggregate, no per-seller scan. A Conversation is buyer-opened by construction, so the opener is `Conversation.createdAt`; a seller reply is the first message whose sender is **not** the buyer (safe because threads are strictly 1:1 — offer/visa cards from the seller correctly count as replies). This is the recompute body (`recomputeResponseRates()`), expressed like `price-stats/route.ts`:

```sql
WITH conv AS (
  SELECT c."sellerId",
         c."createdAt" AS opened_at,
         (SELECT MIN(m."createdAt") FROM "Message" m
           WHERE m."conversationId" = c.id
             AND m."senderProfileId" <> c."buyerProfileId") AS reply_at
  FROM "Conversation" c
  WHERE c."createdAt" >= now() - interval '90 days'
),
agg AS (
  SELECT "sellerId",
         count(*) AS n,
         count(*) FILTER (
           WHERE reply_at IS NOT NULL
             AND reply_at - opened_at <= interval '24 hours') AS replied,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (reply_at - opened_at))
         ) FILTER (WHERE reply_at IS NOT NULL) AS median_secs
  FROM conv GROUP BY "sellerId"
)
UPDATE "Seller" s
SET "responseRate" = round(100.0 * a.replied / a.n),
    "responseTime" = CASE
      WHEN a.median_secs <= 3600  THEN 'within an hour'
      WHEN a.median_secs <= 86400 THEN 'within a day'
      ELSE 'within a few days' END
FROM agg a
WHERE s.id = a."sellerId" AND a.n >= 5;
```

The `MIN(m.createdAt)` subquery rides the existing `@@index([conversationId, createdAt])`. The `n >= 5` filter means low-activity and unclaimed-guest-seller threads (null `sellerProfileId` still resolves via `<> buyerProfileId`, but sparse) simply never get written — their stale value stays, and the display gate suppresses it anyway.

**Store** — denormalized on the existing `Seller.responseRate` (Int) + `Seller.responseTime` (String). No column migration needed; both already exist (`schema.prisma:191-192`).

**Recompute where** — add `recomputeResponseRates()` (the SQL above as one `db.$executeRaw`) in a new tiny lib, and call it from the existing daily aggregation hub `src/app/api/cron/daily-reminders/route.ts:108` right beside `runTrustMaintenance()`. No new Cloud Scheduler job (avoids the second registration step). One-shot historical populate: `scripts/backfill-response-rates.mjs` (DIRECT_URL script shape, same `$executeRaw`), run once before flipping the gate.

**Minimum sample** — `RESPONSE_MIN_CONVOS = 5` already exists (`seller-metrics.ts:26`) and the SQL `HAVING n >= 5` mirrors it, so recompute, display gate, and the trust Wilson bound all agree on the same n.

**The flip** (only AFTER backfill has run and you've eyeballed a non-100 spread) — `src/lib/seller-metrics.ts:38`:
```ts
export const RESPONSE_METRIC_IS_REAL: boolean = true
```
That single line simultaneously un-suppresses the display bucket (`responseBucket()`) and re-arms the trust Q responsiveness term (`trust.ts:332-333`). Do not flip before the backfill or you re-launder the `=100` default.

---

## 2. LAST ONLINE

**Schema** — add to `model Profile` (marketplace account), nullable so absent = suppress:
```prisma
  lastSeenAt  DateTime?
```
(Nullable, unlike ForumProfile's defaulted one — a never-seen profile must produce nothing, not "now".)

**Write point** — `src/lib/admin.ts:57`, inside `getCurrentProfile()` (which already loads `existing` and already has the deferred-write template at lines 54-56). Add a sibling throttled heartbeat, guarded in-row so it writes at most once per 5 min:
```ts
const HEARTBEAT_MS = 5 * 60_000
if (!existing.lastSeenAt || Date.now() - existing.lastSeenAt.getTime() > HEARTBEAT_MS) {
  try { after(() => db.profile.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } }).catch(() => {})) } catch { /* no request scope */ }
}
```
This covers the `/api/me` funnel (`auth-context.tsx:165` fires it every auth-user load), admin gates, account page, and conversation-create for free. **Do NOT** put it in `getCurrentProfileId()` (admin.ts:87 — hot messaging path, deliberately zero DB) or `proxy.ts` (edge, no Prisma, no identity).

**Bucket helper** — new `lastSeenBucket(iso, lang)` in `seller-metrics.ts`, coarse only, never a timestamp:
```ts
export function lastSeenBucket(iso: string | null): { key: 'today'|'week'|'month'|null; en: string; vi: string } {
  if (!iso) return { key: null, en: '', vi: '' }
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000
  if (d < 1)  return { key: 'today', en: 'Active today',      vi: 'Hoạt động hôm nay' }
  if (d < 7)  return { key: 'week',  en: 'Active this week',  vi: 'Hoạt động tuần này' }
  if (d < 30) return { key: 'month', en: 'Active this month', vi: 'Hoạt động tháng này' }
  return { key: null, en: '', vi: '' } // >30d or never → suppress, don't surface staleness
}
```

---

## 3. DISPLAY

**Carry both new fields on the bundle** — `SellerMetrics` (`seller-metrics.ts:75-82`) gains one field; the raw `lastSeenAt` is consumed inside `sellerMetrics()` and only the bucket escapes (same discipline as `responseRate`):
```ts
export type SellerMetrics = { responseBucket: ResponseBucket; lastSeen: ResponseBucket['key'] extends never ? never : ReturnType<typeof lastSeenBucket>; /* …existing… */ }
```
`sellerMetrics()` (`:98`) takes the seller's owner `lastSeenAt` and adds `lastSeen: lastSeenBucket(lastSeenAt)`. The three server producers must select it and pass it: PDP `listings/[id]/page.tsx:214`, storefront `seller-storefront.tsx:95`, and `api/sellers/[id]/route.ts:35` — each already loads the seller; add `owner: { select: { lastSeenAt: true } }` to their select and thread `seller.owner?.lastSeenAt` in. `types.ts` (`SerializedListing.seller`) needs `lastSeenAt: string | null` alongside the existing raw seller fields for the PDP path.

**PDP — `pdp-shop-link.tsx:28-32`** — destructure and push, response bucket first, presence last (both suppress-when-empty, identical to the existing `.key` guard):
```ts
const { responseBucket, lastSeen, memberSinceYear, reviewCount, rating, trustScore } = metrics
// …
if (responseBucket.key) strip.push(tr(responseBucket.en, responseBucket.vi))
strip.push(tr(`Joined ${memberSinceYear}`, `Tham gia ${memberSinceYear}`))
// …existing reviews leaf…
if (lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))
```

**Storefront — `seller-card.tsx:57,61`** — same two lines: destructure `lastSeen`, and after the existing leaves `if (lastSeen.key) strip.push(tr(lastSeen.en, lastSeen.vi))`. Because it already reads the `SellerMetrics` bundle and gates every leaf on presence, nothing else changes — it inherits suppress-when-empty automatically.

**Chat header — `trust-meta.tsx`** — the odd one out: it takes **flat props**, not the bundle, and its sole caller (`messages/[id]/page.tsx:894`) hard-codes `responseBucket={{key:null}}`. To light presence there you must add a flat `lastSeen` prop and populate it from the chat counterpart serializer (`thread.counterpart.trust`), not from `sellerMetrics()`. This is the one place the honesty-gate flip does **not** auto-propagate. Recommend doing PDP + storefront now and threading trust-meta's presence in the same serializer pass, leaving its response bucket suppressed unless you also extend that serializer.

---

## 4. MIGRATION APPROACH (schema work in flight elsewhere)

Only one new column, and only on `Profile` (`responseRate/responseTime` already exist). Do **not** run a full `prisma db push` while another session holds the schema — mirror the `NativePushToken` hand-DDL approach:

1. Add `lastSeenAt DateTime?` to `model Profile` in `schema.prisma` (so `prisma generate` types match) — claim the file in `.claude/COORDINATION.md` first, stage only that file.
2. Apply the column directly over `DIRECT_URL`:
   ```sql
   ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
   ```
3. `prisma generate` → restart. No `db push`, no FK drop, no collision with the in-flight schema session.

---

## 5. THREE HIGHEST RISKS

1. **A fake number leaks to buyers.** Prevention: the raw `responseRate` never enters any client bundle — `sellerMetrics()` consumes it server-side and emits only the coarse bucket (enforced by the `SellerMetrics` type shape). Keep `RESPONSE_METRIC_IS_REAL=false` until `backfill-response-rates.mjs` has actually written real rates, and verify a non-100 distribution before flipping. Both the SQL (`n>=5`) and `responseBucket()` (`convoCount<5→SUPPRESS`) gate on the same sample floor, so a thin-history seller shows nothing rather than a laundered 100%.

2. **The heartbeat turns a read path into a per-request write.** Prevention: the write lives in an `after()` (post-response, zero added latency), fire-and-forget with `.catch(()=>{})`, and is guarded by the in-row `lastSeenAt > 5min` check so at most one write per user per 5 min. It is placed in `getCurrentProfile()` (already does a DB read), never in the hot `getCurrentProfileId()` messaging path and never at the edge (`proxy.ts`).

3. **N+1 on the response-rate computation.** Prevention: it is a single set-based `UPDATE … FROM (aggregate)` run once nightly inside the cron — never a per-seller JS scan. The correlated `MIN(m.createdAt)` subquery is served by the existing `@@index([conversationId, createdAt])`, and the whole job runs off the request path in `daily-reminders`, bounded to 90 days.