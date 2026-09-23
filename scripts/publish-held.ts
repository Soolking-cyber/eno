// One-off: publish the pre-existing verified=false ("Held") listings that pass the NEW
// publish rules (non-restricted seller + ≥1 photo + clean text). Restricted / no-photo /
// contact-or-banned-text listings stay hidden — consistent with the new model. Uses the
// SAME guard functions as the live post path.
//   set -a; . ./.env; set +a; npx tsx scripts/publish-held.ts                      # dry run (gate assumed ON)
//   set -a; . ./.env; set +a; npx tsx scripts/publish-held.ts --gate=on  --apply   # production enforces the gate
//   set -a; . ./.env; set +a; npx tsx scripts/publish-held.ts --gate=off --apply   # production does NOT
//
// ⚖️ SELLER IDENTITY GATE (2026-09-23). This script used to set verified=true for every eligible
// held listing of ANY seller — a bulk publish that no identity check could see. With the gate on, a
// listing whose owner the gate refuses is PARKED instead (identityHold=true, verified stays false)
// and is published by releaseIdentityHolds() when the owner verifies. The decision is the app's own:
// the pure rules in src/lib/compliance/seller-publish-decision.ts over the same identity_verifications
// derivation (derive-verification.ts) — resolved once per owner. `--gate=off` → exactly what it
// always did.
//
// ⚖️ OWNERLESS SPLITS IN TWO under --gate=on, as it does in the app: a platform IMPORT storefront is
// allowed (nobody to verify), a GUEST storefront is refused. The app tells them apart by the session
// (only a signed-out web post is a guest); a script has no session, so it uses the row: a guest
// storefront carries the phone it was posted under (Seller.phone is the guest-claim join key), an
// import seller does not. Measured on production 2026-09-23: all 30 ownerless sellers are imports with
// `phone IS NULL`, and no guest storefront exists — so today this skips nothing, and it exists so the
// first guest listing held later is not published by a bulk run. Guest rows are left held as they are
// (no identityHold: there is no owner whose verification could release them) and counted.
//
// ⛔ THE GATE STATE IS AN ARGUMENT, NEVER THIS SHELL'S ENV. identityGateEnforced() is true only when
// NEXT_PUBLIC_ENO_EDITION=marketplace AND IDENTITY_GATE_ENFORCED=1 are both set in THIS process, and
// neither is in .env / .env.local — they live in the deployed Secret Manager env. So under the
// documented invocation it always read "off", and --apply published every held listing of every
// unverified owner while production enforced the gate. Now --apply refuses to run without an explicit
// --gate=on|off, and a dry run without one shows the gate-ON split (the fail-closed answer).
import pg from 'pg'
import { containsPhoneNumber } from '../src/lib/phone'
import { containsContactInfo, findBannedWord } from '../src/lib/publish-guard'
import { identityGateEnforced } from '../src/lib/compliance/account-state'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned } from '../src/lib/compliance/seller-publish-decision'

const APPLY = process.argv.includes('--apply')
const GATE_ARG = process.argv.find((a) => a.startsWith('--gate='))?.slice('--gate='.length)
if (GATE_ARG !== undefined && GATE_ARG !== 'on' && GATE_ARG !== 'off') {
  console.error(`⛔ --gate must be on or off (got "${GATE_ARG}").`)
  process.exit(1)
}
if (APPLY && !GATE_ARG) {
  console.error('⛔ --apply needs --gate=on or --gate=off: say whether PRODUCTION enforces IDENTITY_GATE_ENFORCED (Secret Manager eno-root-env). This shell cannot tell.')
  process.exit(1)
}

;(async () => {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()

  const { rows } = await c.query(
    `SELECT l.id, l.title, l.description, l.images, s."trustTier", s."ownerId", s.phone
     FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId"
     WHERE l.verified = false AND l.status = 'active' AND l."identityHold" = false`,
  )

  // One owner's identity decision — the app's rules over the app's derivation (see the header).
  const decide = async (ownerId: string, now: Date) => {
    const p = await c.query(`SELECT "createdAt" FROM "Profile" WHERE id = $1`, [ownerId])
    const accountCreatedAt: Date | null = p.rows[0]?.createdAt ?? null
    const early = decideBeforeStatus({ enforced: true, ownerId, accountCreatedAt, now })
    if (early) return early
    const iv = await c.query(
      `SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
         FROM identity_verifications WHERE "profileId" = $1 ORDER BY "submittedAt" DESC`,
      [ownerId],
    )
    return decideOwned(deriveVerification(iv.rows as VerificationRow[], now).status, accountCreatedAt, now)
  }

  // `guest`: ownerless AND carrying a phone — see the header. Any non-null phone counts, so a malformed
  // one fails closed (stays held) rather than open.
  const eligible: { id: string; ownerId: string | null; guest: boolean }[] = []
  const skip = { restricted: 0, noPhoto: 0, content: 0 }
  for (const r of rows) {
    if (r.trustTier === 'restricted') { skip.restricted++; continue }
    let imgs: unknown[] = []
    try { imgs = JSON.parse(r.images || '[]') } catch { /* treat as none */ }
    if (!Array.isArray(imgs) || imgs.length < 1) { skip.noPhoto++; continue }
    const txt = `${r.title} ${r.description || ''}`
    if (containsPhoneNumber(r.title) || containsPhoneNumber(r.description) || containsContactInfo(txt) || findBannedWord(txt)) { skip.content++; continue }
    eligible.push({ id: r.id, ownerId: r.ownerId ?? null, guest: !r.ownerId && r.phone != null })
  }

  // Identity decision, once per distinct owner. Gate off → nobody is refused and nothing is read.
  // ⛔ Fail CLOSED: only an explicit --gate=off skips it (see the header).
  const enforced = GATE_ARG !== 'off'
  if (identityGateEnforced() !== enforced) console.warn(`(note: this shell's env reads the gate as ${identityGateEnforced() ? 'ON' : 'off'}; using --gate=${GATE_ARG ?? 'on (default for a dry run)'})`)
  const now = new Date()
  const refused = new Map<string, string>() // ownerId → code
  if (enforced) {
    const owners = [...new Set(eligible.map((e) => e.ownerId).filter((o): o is string => !!o))]
    for (const ownerId of owners) {
      const decision = await decide(ownerId, now)
      if (!decision.ok) refused.set(ownerId, decision.code)
    }
  }
  // Guests: the app's own rule for an ownerless GUEST (decideBeforeStatus + guestCreate), asked once.
  // Only when enforced — with the gate off nothing below differs from what this script always did.
  const guestDecision = enforced ? decideBeforeStatus({ enforced: true, ownerId: null, guestCreate: true, now }) : null
  const guestCode = guestDecision && !guestDecision.ok ? guestDecision.code : null
  const guestSkipped = guestCode ? eligible.filter((e) => e.guest).length : 0
  const toPublish = eligible.filter((e) => !(e.ownerId && refused.has(e.ownerId)) && !(guestCode && e.guest)).map((e) => e.id)
  const toHold = eligible.filter((e) => e.ownerId && refused.has(e.ownerId)).map((e) => e.id)

  console.log(`held(active)=${rows.length}  →  WOULD PUBLISH=${toPublish.length}  |  stays hidden: restricted=${skip.restricted} noPhoto=${skip.noPhoto} content=${skip.content}`)
  console.log(`identity gate ${enforced ? 'ON' : 'off'} (--gate=${GATE_ARG ?? 'unset → on'})  →  WOULD PARK (identityHold)=${toHold.length} across ${refused.size} unverified owner(s)`)
  if (enforced) console.log(`guest storefronts (ownerless + phone)  →  SKIPPED, left held=${guestSkipped}${guestCode ? ` (${guestCode})` : ''}`)
  if (APPLY) {
    if (toPublish.length) {
      // `"identityHold" = false` rides the publish (the selection read identityHold = false, but a park
      // can land between that read and this write): a row made live must never carry a hold.
      const res = await c.query(`UPDATE "Listing" SET verified = true, "identityHold" = false WHERE id = ANY($1::text[])`, [toPublish])
      console.log(`PUBLISHED ${res.rowCount} listing(s).`)
    }
    if (toHold.length) {
      const res = await c.query(`UPDATE "Listing" SET "identityHold" = true WHERE id = ANY($1::text[]) AND verified = false`, [toHold])
      console.log(`PARKED ${res.rowCount} listing(s) until their owners verify.`)
      // ⚠️ RE-CHECK AFTER THE PARK (the app's settleHolds, for a raw client): an owner whose KYC was
      // approved between the decision above and this write had their release run BEFORE the hold
      // existed, and nothing would ever release it. Re-decide on a fresh clock; release if now allowed.
      // ⚠️ NO `status = 'active'` IN THE RELEASE, ON PURPOSE — it is releaseIdentityHolds() in SQL, and
      // that selects on identityHold alone. That is safe only because every takedown (admin unverify,
      // the moderation queue, provenance/AI auto-holds, the enforcement pull) clears identityHold, so a
      // row still carrying it was parked by the gate and nothing else; a sold or hidden one becomes
      // verified but stays off the public surfaces, exactly as the app's release leaves it.
      let released = 0
      for (const ownerId of refused.keys()) {
        if (!(await decide(ownerId, new Date())).ok) continue
        const r = await c.query(
          `UPDATE "Listing" l SET verified = true, "identityHold" = false FROM "Seller" s
            WHERE s.id = l."sellerId" AND s."ownerId" = $1 AND l."identityHold"`,
          [ownerId],
        )
        released += r.rowCount ?? 0
      }
      if (released) console.log(`RELEASED ${released} of them again — their owner verified while this ran.`)
    }
  } else {
    console.log('(dry run — re-run with --apply to publish)')
  }
  await c.end()
})()
