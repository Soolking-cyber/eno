// Trust v2 dry-run — READ-ONLY. Computes the v2 composite for every profile that
// owns a Seller (plus a guest-seller section) and prints the old→new tier
// distribution and the top 15 movers with a full component breakdown. NOTHING is
// written — review this before running scripts/trust-v2-backfill.mjs.
//
// The math MIRRORS src/lib/trust-math.ts (the unit-tested TS source of truth) —
// every formula below cites its TS counterpart; if you change one, change BOTH.
//
// Bootstrap note: reviewer/reporter credibility is weighted by the CURRENT (v1)
// cached trustScore — the pre-migration standing is the only one that exists yet.
// v1 scores run hotter (baseline 100 vs v2's 60), so credibility is slightly
// generous on this first pass; the daily recompute re-weights with v2 scores and
// converges within days. Same approximation in the backfill, so this dry-run
// predicts the backfill's output exactly.
//
//   set -a; . ./.env; set +a; node scripts/trust-v2-dryrun.mjs            # read-only
//   set -a; . ./.env; set +a; node scripts/trust-v2-dryrun.mjs --write    # BACKFILL
// (--write is what scripts/trust-v2-backfill.mjs invokes — ONE code path, so the
//  dry-run's predictions and the backfill's writes can never diverge.)
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const DAY_MS = 86_400_000
const now = Date.now()

// ── Constants — MIRROR of TRUST in src/lib/trust-math.ts ──────────────────────────
const T = {
  BASE: 60, MAX: 150,
  V_PHONE: 10, V_KYC: 10, V_AGE: 5, V_AGE_DAYS: 90,
  REVIEW_PRIOR_MEAN: 4.6, REVIEW_PRIOR_WEIGHT: 5, REVIEW_MAX: 25, REVIEW_FLOOR: 3.5,
  REVIEW_SPAN: 1.5, REVIEW_SATURATION: 5, REVIEW_PAIR_DEDUP_DAYS: 90,
  RESPONSE_MAX: 10, WILSON_Z: 1.28, RESPONSE_WINDOW_DAYS: 90,
  FRESH_MAX: 5, FRESH_DAYS: 14,
  TRACK_MAX: 25, TRACK_LOG_COEF: 12, TRACK_WINDOW_DAYS: 365,
  CONDUCT_MAX: 90,
  SEVERITY_WEIGHT: { minor: 5, moderate: 18, severe: 45 },
  DECAY_HALF_LIFE_DAYS: { minor: 45, moderate: 180, severe: 365 },
  SCAM_CLEAN_TX: 5, SCAM_FLOOR: 0.4,
  MANUAL_HALF_LIFE_DAYS: 365,
  CRED_FULL: 1.0, CRED_DEFAULT: 0.6, CRED_LOW: 0.25,
  CRED_FULL_TRUST: 85, CRED_FULL_AGE_DAYS: 180, CRED_DEFAULT_AGE_DAYS: 30,
  CRED_STRIKE_FACTOR: 0.5, CRED_FLOOR: 0.1,
  TIER: {
    TRUSTED_SCORE: 85, TRUSTED_TX: 3, TRUSTED_AGE_DAYS: 60, TRUSTED_ALT_REVIEWS: 3,
    EXCEPTIONAL_SCORE: 110, EXCEPTIONAL_TX: 10, EXCEPTIONAL_REVIEWS: 5, EXCEPTIONAL_WILSON: 0.85,
    DEMOTE_RATE: 0.02, DEMOTE_MIN_REPORTERS: 2,
  },
}
const ONE_TIME_REASONS = new Set(['new_account', 'phone_verified', 'zalo_linked', 'kyc', 'profile_complete'])
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

// ── Pure math — MIRROR of src/lib/trust-math.ts (cited per function) ──────────────

// bayesianRating(): IMDb shrinkage — (m·prior + Σw·r)/(m + Σw).
const bayesianRating = (weightedSum, weightN) =>
  (T.REVIEW_PRIOR_WEIGHT * T.REVIEW_PRIOR_MEAN + weightedSum) / (T.REVIEW_PRIOR_WEIGHT + weightN)

// reviewScore(): quality band [3.5..5.0] × volume ramp min(1, n_eff/5), 0–25.
function reviewScore(reviews) {
  let weightedSum = 0, weightN = 0
  for (const r of reviews) { weightedSum += r.weight * r.rating; weightN += r.weight }
  if (weightN <= 0) return 0
  const adj = bayesianRating(weightedSum, weightN)
  return T.REVIEW_MAX * clamp01((adj - T.REVIEW_FLOOR) / T.REVIEW_SPAN) * Math.min(1, weightN / T.REVIEW_SATURATION)
}

// wilsonLowerBound(): pessimistic success-rate estimate, z=1.28 (~80% one-sided).
function wilsonLowerBound(successes, n, z = T.WILSON_Z) {
  if (n <= 0) return 0
  const p = Math.min(1, Math.max(0, successes / n))
  const z2 = z * z
  return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n))
}

// freshnessScore(): share of active listings confirmed <14d; none active → full marks.
const freshnessScore = (fresh, total) => (total <= 0 ? T.FRESH_MAX : T.FRESH_MAX * clamp01(fresh / total))

// trackRecordScore(): 12·log10(1+tx365) capped at 25 — log-diminishing.
const trackRecordScore = (tx) => Math.min(T.TRACK_MAX, T.TRACK_LOG_COEF * Math.log10(1 + Math.max(0, tx)))

// verificationScore(): phone +10 · KYC +10 · age≥90d +5.
const verificationScore = (v) =>
  (v.phoneVerified ? T.V_PHONE : 0) + (v.kycVerified ? T.V_KYC : 0) + (v.accountAgeDays >= T.V_AGE_DAYS ? T.V_AGE : 0)

// credibilityWeight(): mini-EigenTrust author standing, strikes halve, floor 0.1.
function credibilityWeight(a) {
  let base
  if (a.trustScore >= T.CRED_FULL_TRUST && (a.kycVerified || a.accountAgeDays >= T.CRED_FULL_AGE_DAYS)) base = T.CRED_FULL
  else if (a.accountAgeDays >= T.CRED_DEFAULT_AGE_DAYS && a.falseReportStrikes === 0) base = T.CRED_DEFAULT
  else base = T.CRED_LOW
  return Math.max(T.CRED_FLOOR, base * Math.pow(T.CRED_STRIKE_FACTOR, Math.max(0, a.falseReportStrikes)))
}

// decayFactor(): minor 2^(−age/45) · moderate 2^(−age/180) · severe FROZEN until
// 5 clean tx after the event, then 2^(−sinceFifth/365) with a permanent 0.4 floor.
function decayFactor(severity, ageDays, scam) {
  const age = Math.max(0, ageDays)
  if (severity !== 'severe') return Math.pow(2, -age / T.DECAY_HALF_LIFE_DAYS[severity])
  if ((scam?.cleanTxAfter ?? 0) < T.SCAM_CLEAN_TX || scam?.daysSinceFifthCleanTx == null) return 1
  return Math.max(T.SCAM_FLOOR, Math.pow(2, -Math.max(0, scam.daysSinceFifthCleanTx) / T.DECAY_HALF_LIFE_DAYS.severe))
}

// severityFromDelta(): legacy v1 deltas (−3/−10/−25) → class, when Report is gone.
const severityFromDelta = (d) => (Math.abs(d) >= 25 ? 'severe' : Math.abs(d) >= 10 ? 'moderate' : 'minor')

// dedupeReviewPairs(): one COUNTED review per buyer per 90d, oldest-first.
function dedupeReviewPairs(reviews) {
  const byAuthor = new Map()
  for (const r of reviews) (byAuthor.get(r.authorId) ?? byAuthor.set(r.authorId, []).get(r.authorId)).push(r)
  const kept = []
  const windowMs = T.REVIEW_PAIR_DEDUP_DAYS * DAY_MS
  for (const list of byAuthor.values()) {
    list.sort((a, b) => a.createdAtMs - b.createdAtMs)
    let last = -Infinity
    for (const r of list) if (r.createdAtMs - last >= windowMs) { kept.push(r); last = r.createdAtMs }
  }
  return kept
}

// reportsDemote(): eBay dual threshold — (rate >2% ∧ ≥2 distinct reporters) OR scam.
function reportsDemote(w, transactions) {
  if (w.scams > 0) return true
  if (w.count <= 0) return false
  return w.distinctReporters >= T.TIER.DEMOTE_MIN_REPORTERS && w.count / Math.max(1, transactions) > T.TIER.DEMOTE_RATE
}

// tierFor(): volume-gated tiers (see src/lib/trust-math.ts tierFor).
function tierFor(i) {
  if (i.score < 60 || i.hasScamHold) return 'restricted'
  const G = T.TIER
  if (i.score >= G.EXCEPTIONAL_SCORE && i.transactions365 >= G.EXCEPTIONAL_TX && i.distinctBuyerReviews >= G.EXCEPTIONAL_REVIEWS &&
      i.responseWilson >= G.EXCEPTIONAL_WILSON && !reportsDemote(i.reports180, i.transactions365)) return 'exceptional'
  if (i.score >= G.TRUSTED_SCORE && i.transactions365 >= G.TRUSTED_TX &&
      (i.accountAgeDays >= G.TRUSTED_AGE_DAYS || i.distinctBuyerReviews >= G.TRUSTED_ALT_REVIEWS) &&
      !reportsDemote(i.reports90, i.transactions365)) return 'trusted'
  return 'standard'
}

// composeScore(): clamp(0, 150, round(60 + V + Q + T − C + M)).
const composeScore = (p) => Math.round(Math.min(T.MAX, Math.max(0, T.BASE + p.V + p.Q + p.T - p.C + (p.M ?? 0))))

// ── Data pull (set-based; one round-trip per table) ────────────────────────────────

const client = new pg.Client({ connectionString: url })
await client.connect()

const owned = (await client.query(`
  SELECT s.id AS seller_id, s."ownerId" AS owner_id, s."responseRate",
         p."createdAt", p.phone, p."trustScore" AS old_score, p."trustTier" AS old_tier,
         COALESCE(p."displayName", p.email, s.name) AS label
  FROM "Seller" s JOIN "Profile" p ON p.id = s."ownerId"
  WHERE s."ownerId" IS NOT NULL`)).rows
const guests = (await client.query(`
  SELECT id AS seller_id, name AS label, "trustScore" AS old_score, "trustTier" AS old_tier, "responseRate"
  FROM "Seller" WHERE "ownerId" IS NULL`)).rows

const ownerIds = owned.map((r) => r.owner_id)
const sellerIds = [...owned.map((r) => r.seller_id), ...guests.map((r) => r.seller_id)]

// Ledger: conduct + manual adjustments + one-time verification gates (same filter as
// computeTrustV2 in src/lib/trust.ts).
const events = ownerIds.length ? (await client.query(`
  SELECT "subjectProfileId" AS pid, type, delta, reason, "reportId" AS report_id, "createdAt"
  FROM "TrustEvent"
  WHERE "subjectProfileId" = ANY($1::uuid[]) AND type IN ('report_confirmed','manual_adjust')`, [ownerIds])).rows : []
const eventsByPid = new Map()
for (const e of events) (eventsByPid.get(e.pid) ?? eventsByPid.set(e.pid, []).get(e.pid)).push(e)

const reportIds = [...new Set(events.map((e) => e.report_id).filter(Boolean))]
const reports = reportIds.length ? (await client.query(`
  SELECT id, severity, "reporterProfileId" AS reporter_id FROM "Report" WHERE id = ANY($1::text[])`, [reportIds])).rows : []
const reportById = new Map(reports.map((r) => [r.id, r]))

// Verified reviews (conversation-backed, authored) for ALL sellers.
const reviews = sellerIds.length ? (await client.query(`
  SELECT "sellerId" AS seller_id, rating, "authorProfileId" AS author_id, "createdAt"
  FROM "Review" WHERE "sellerId" = ANY($1::text[]) AND "conversationId" IS NOT NULL AND "authorProfileId" IS NOT NULL`, [sellerIds])).rows : []
const reviewsBySeller = new Map()
for (const r of reviews) (reviewsBySeller.get(r.seller_id) ?? reviewsBySeller.set(r.seller_id, []).get(r.seller_id)).push(r)

// Rater credibility inputs (reviewers + reporters), single batch.
const raterIds = [...new Set([...reviews.map((r) => r.author_id), ...reports.map((r) => r.reporter_id)].filter(Boolean))]
const raters = raterIds.length ? (await client.query(`
  SELECT p.id, p."trustScore", p."createdAt", p."falseReportStrikes",
         EXISTS(SELECT 1 FROM "TrustEvent" te WHERE te."subjectProfileId" = p.id AND te.reason = 'kyc') AS kyc
  FROM "Profile" p WHERE p.id = ANY($1::uuid[])`, [raterIds])).rows : []
const credByPid = new Map(raters.map((p) => [p.id, credibilityWeight({
  trustScore: p.trustScore,
  accountAgeDays: (now - p.createdAt.getTime()) / DAY_MS,
  falseReportStrikes: p.falseReportStrikes,
  kycVerified: p.kyc,
})]))

// Responsiveness n: conversations opened in the last 90d, per seller.
const convo90 = sellerIds.length ? (await client.query(`
  SELECT "sellerId" AS seller_id, COUNT(*)::int AS n FROM "Conversation"
  WHERE "sellerId" = ANY($1::text[]) AND "createdAt" >= now() - interval '90 days' GROUP BY 1`, [sellerIds])).rows : []
const convoBySeller = new Map(convo90.map((r) => [r.seller_id, r.n]))

// Availability freshness: active + fresh(<14d) counts per seller.
const freshness = sellerIds.length ? (await client.query(`
  SELECT "sellerId" AS seller_id, COUNT(*)::int AS active,
         COUNT(*) FILTER (WHERE COALESCE("availabilityConfirmedAt", "postedAt") >= now() - interval '14 days')::int AS fresh
  FROM "Listing" WHERE "sellerId" = ANY($1::text[]) AND status = 'active' AND verified = true GROUP BY 1`, [sellerIds])).rows : []
const freshBySeller = new Map(freshness.map((r) => [r.seller_id, r]))

// Transactions: sold listings (updatedAt ≈ sale time — the status flip touches it;
// same approximation as computeTrustV2) + accepted offers, unioned by listing.
const sold = sellerIds.length ? (await client.query(`
  SELECT "sellerId" AS seller_id, id AS listing_id, "updatedAt" AS at
  FROM "Listing" WHERE "sellerId" = ANY($1::text[]) AND status = 'sold'`, [sellerIds])).rows : []
const offers = sellerIds.length ? (await client.query(`
  SELECT c."sellerId" AS seller_id, c."listingId" AS listing_id, m."createdAt" AS at
  FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
  WHERE m.kind = 'offer' AND m."offerStatus" = 'accepted' AND c."sellerId" = ANY($1::text[])`, [sellerIds])).rows : []
const txBySeller = new Map() // sellerId → Map(listingId → earliest ms)
for (const row of [...sold, ...offers]) {
  const m = txBySeller.get(row.seller_id) ?? txBySeller.set(row.seller_id, new Map()).get(row.seller_id)
  const t = row.at.getTime()
  const prev = m.get(row.listing_id)
  if (prev === undefined || t < prev) m.set(row.listing_id, t)
}

await client.end()

// ── Per-profile composite (mirror of computeTrustV2 in src/lib/trust.ts) ──────────
// NOTE: the daily +6 cap is an OPERATIONS rail — the migration writes the true
// composite directly (as the backfill will), so no cap is applied here.

function sellerComponents(sellerId, responseRate) {
  const txTimes = [...(txBySeller.get(sellerId)?.values() ?? [])].sort((a, b) => a - b)
  const tx365 = txTimes.filter((t) => t >= now - T.TRACK_WINDOW_DAYS * DAY_MS).length
  const deduped = dedupeReviewPairs(
    (reviewsBySeller.get(sellerId) ?? []).map((r) => ({ authorId: r.author_id, createdAtMs: r.createdAt.getTime(), rating: r.rating })),
  )
  const reviewsQ = reviewScore(deduped.map((r) => ({ rating: r.rating, weight: credByPid.get(r.authorId) ?? T.CRED_DEFAULT })))
  const n = convoBySeller.get(sellerId) ?? 0
  const wilson = wilsonLowerBound(Math.round(((responseRate ?? 0) / 100) * n), n)
  const f = freshBySeller.get(sellerId) ?? { active: 0, fresh: 0 }
  const Q = reviewsQ + T.RESPONSE_MAX * clamp01(wilson) + freshnessScore(f.fresh, f.active)
  return { Q, T: trackRecordScore(tx365), tx365, txTimes, wilson, distinctBuyerReviews: new Set(deduped.map((r) => r.authorId)).size }
}

function conductFor(pid, txTimes) {
  const evts = (eventsByPid.get(pid) ?? []).filter((e) => e.type === 'report_confirmed')
  let hasScamHold = false
  const win90 = { count: 0, distinctReporters: 0, scams: 0 }, win180 = { count: 0, distinctReporters: 0, scams: 0 }
  const rep90 = new Set(), rep180 = new Set()
  let C = 0
  for (const e of evts) {
    const report = e.report_id ? reportById.get(e.report_id) : undefined
    const severity = report?.severity ?? severityFromDelta(e.delta)
    // Reporter unreachable → default credibility 0.6 (same fallback as trust.ts).
    const cred = report?.reporter_id ? (credByPid.get(report.reporter_id) ?? T.CRED_DEFAULT) : T.CRED_DEFAULT
    const eventMs = e.createdAt.getTime()
    const ageDays = (now - eventMs) / DAY_MS
    let scam = null
    if (severity === 'severe') {
      const after = txTimes.filter((t) => t > eventMs)
      if (after.length >= T.SCAM_CLEAN_TX) scam = { cleanTxAfter: after.length, daysSinceFifthCleanTx: (now - after[T.SCAM_CLEAN_TX - 1]) / DAY_MS }
      else { scam = { cleanTxAfter: after.length, daysSinceFifthCleanTx: null }; hasScamHold = true }
    }
    C += T.SEVERITY_WEIGHT[severity] * cred * decayFactor(severity, ageDays, scam)
    const key = report?.reporter_id ?? `anon:${e.report_id ?? eventMs}`
    if (ageDays <= 90) { win90.count++; rep90.add(key); if (severity === 'severe') win90.scams++ }
    if (ageDays <= 180) { win180.count++; rep180.add(key); if (severity === 'severe') win180.scams++ }
  }
  win90.distinctReporters = rep90.size
  win180.distinctReporters = rep180.size
  return { C: Math.min(T.CONDUCT_MAX, C), win90, win180, hasScamHold }
}

const rows = []
for (const o of owned) {
  const accountAgeDays = (now - o.createdAt.getTime()) / DAY_MS
  const evts = eventsByPid.get(o.owner_id) ?? []
  const phoneVerified = !!o.phone || evts.some((e) => e.reason === 'phone_verified')
  const kycVerified = evts.some((e) => e.reason === 'kyc')
  const V = verificationScore({ phoneVerified, kycVerified, accountAgeDays })
  const s = sellerComponents(o.seller_id, o.responseRate)
  const { C, win90, win180, hasScamHold } = conductFor(o.owner_id, s.txTimes)
  // Manual adjustments (H=365 decay), one-time verification reasons excluded.
  const M = evts
    .filter((e) => e.type === 'manual_adjust' && !(e.reason && ONE_TIME_REASONS.has(e.reason)))
    .reduce((sum, e) => sum + e.delta * Math.pow(2, -Math.max(0, (now - e.createdAt.getTime()) / DAY_MS) / T.MANUAL_HALF_LIFE_DAYS), 0)
  const score = composeScore({ V, Q: s.Q, T: s.T, C, M })
  const tier = tierFor({
    score, transactions365: s.tx365, accountAgeDays, distinctBuyerReviews: s.distinctBuyerReviews,
    responseWilson: s.wilson, reports90: win90, reports180: win180, hasScamHold,
  })
  rows.push({ label: o.label, kind: 'owned', profileId: o.owner_id, sellerId: o.seller_id, oldScore: o.old_score, oldTier: o.old_tier, score, tier, V, Q: s.Q, T: s.T, C, M })
}

// Guest sellers (ownerId NULL): no Profile/ledger — V=0, and the accumulated v1
// mirror penalties are carried as a legacy conduct term min(0, old−100) so a docked
// guest doesn't reset to clean. Tier: standard/restricted only (badges need accounts).
const guestRows = []
for (const g of guests) {
  const s = sellerComponents(g.seller_id, g.responseRate)
  const legacy = Math.min(0, g.old_score - 100)
  const score = composeScore({ V: 0, Q: s.Q, T: s.T, C: -legacy, M: 0 })
  guestRows.push({ label: g.label, sellerId: g.seller_id, oldScore: g.old_score, oldTier: g.old_tier, score, tier: score < 60 ? 'restricted' : 'standard', V: 0, Q: s.Q, T: s.T, C: -legacy, M: 0 })
}

// ── Report ─────────────────────────────────────────────────────────────────────────
const TIERS = ['restricted', 'standard', 'trusted', 'exceptional']
const dist = (list, key) => Object.fromEntries(TIERS.map((t) => [t, list.filter((r) => r[key] === t).length]))
const fmt = (n) => String(n).padStart(6)

console.log(`\nTrust v2 dry-run — ${rows.length} owned seller profile(s), ${guestRows.length} guest seller(s). READ-ONLY.\n`)
console.log('Tier distribution (owned sellers), old → new:')
const before = dist(rows, 'oldTier'), after = dist(rows, 'tier')
console.log('  tier         before   after')
for (const t of TIERS) console.log(`  ${t.padEnd(12)}${fmt(before[t])}  ${fmt(after[t])}`)

console.log('\nTop 15 movers (|new − old|), with component breakdown:')
console.log('  Δ      old → new   tier old → new            V     Q     T     C     M   who')
for (const r of [...rows, ...guestRows].sort((a, b) => Math.abs(b.score - b.oldScore) - Math.abs(a.score - a.oldScore)).slice(0, 15)) {
  const d = r.score - r.oldScore
  console.log(
    `  ${String(d > 0 ? `+${d}` : d).padStart(4)}  ${String(r.oldScore).padStart(4)} → ${String(r.score).padEnd(4)} ${r.oldTier.padEnd(11)} → ${r.tier.padEnd(11)} ` +
    `${r.V.toFixed(0).padStart(4)} ${r.Q.toFixed(1).padStart(5)} ${r.T.toFixed(1).padStart(5)} ${r.C.toFixed(1).padStart(5)} ${r.M.toFixed(1).padStart(5)}   ${String(r.label).slice(0, 40)}`,
  )
}

if (guestRows.length) {
  console.log('\nGuest sellers (mirror-only), old → new:')
  const gb = dist(guestRows, 'oldTier'), ga = dist(guestRows, 'tier')
  console.log('  tier         before   after')
  for (const t of TIERS) console.log(`  ${t.padEnd(12)}${fmt(gb[t])}  ${fmt(ga[t])}`)
}
if (!process.argv.includes('--write')) {
  console.log('\nREAD-ONLY pass. If this looks right: node scripts/trust-v2-backfill.mjs (or re-run with --write), then scripts/backfill-listing-rankscore.mjs.')
} else {
  // ── BACKFILL — writes the EXACT rows printed above ───────────────────────────────
  console.log(`\n--write: backfilling ${rows.length} profiles + ${rows.length + guestRows.length} sellers…`)
  const w = new pg.Client({ connectionString: url })
  await w.connect()
  try {
    await w.query('begin')
    for (const r of rows) {
      await w.query('update "Profile" set "trustScore" = $1, "trustTier" = $2 where id = $3', [r.score, r.tier, r.profileId])
      await w.query('update "Seller" set "trustScore" = $1, "trustTier" = $2 where id = $3', [r.score, r.tier, r.sellerId])
      await w.query('update "Listing" set "sellerTrustScore" = $1 where "sellerId" = $2', [r.score, r.sellerId])
    }
    for (const g of guestRows) {
      await w.query('update "Seller" set "trustScore" = $1, "trustTier" = $2 where id = $3', [g.score, g.tier, g.sellerId])
      await w.query('update "Listing" set "sellerTrustScore" = $1 where "sellerId" = $2', [g.score, g.sellerId])
    }
    await w.query('commit')
    console.log('✓ committed. NOW RUN: node scripts/backfill-listing-rankscore.mjs (trust feeds rankScore).')
  } catch (e) {
    await w.query('rollback').catch(() => {})
    console.error('✗ rolled back:', e.message)
    process.exitCode = 1
  } finally {
    await w.end()
  }
}
