/**
 * REGISTER VIETKITE AS A BUSINESS SELLER, WITH ITS OWN ACCOUNT AND STOREFRONT HANDLE.
 *
 *   VIETKITE_PASSWORD='…' node --env-file=.env scripts/register-vietkite-seller.mjs
 *   VIETKITE_PASSWORD='…' node --env-file=.env scripts/register-vietkite-seller.mjs --apply
 *
 * ⚠️ THE PASSWORD IS READ FROM THE ENVIRONMENT AND IS NEVER STORED IN THIS FILE.
 * It must not be committed, pasted into a commit message, or echoed to a log. This script prints
 * only whether one was supplied. Whoever runs it should treat the value as sensitive and rotate it
 * afterwards — a password that has travelled through a terminal, a shell history or a chat log is
 * no longer a secret, whatever else is true about it.
 *
 * ⚠️ THIS WRITES TO THE PRODUCTION DATABASE AND CREATES A REAL LOGIN. eno.vn and eno.forum share
 * one database; the storefront is publicly reachable the moment it exists, and the account can
 * sign in immediately. Dry run by default on purpose — run without --apply first and read the plan.
 *
 * WHY AN ACCOUNT AT ALL, rather than the simpler guest seller: `isBusiness` is derived in
 * src/lib/serialize.ts from `seller.owner?.accountType === 'business'`. No Profile means no owner
 * means the storefront can never present as a business, whatever else is set on the Seller row.
 * The account is what makes "business" true rather than decorative — and it is also what lets
 * VietKite manage their own storefront instead of eno holding it for them.
 *
 * REVERSAL, in this order (the FKs point this way): delete the Handle row, delete the Seller row,
 * delete the Profile row, then delete the auth user in Supabase.
 */
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const APPLY = process.argv.includes('--apply')

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const DB = process.env.DIRECT_URL
const PASSWORD = process.env.VIETKITE_PASSWORD

if (!URL_ || !SECRET || !DB) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL — run with node --env-file=.env')
  process.exit(1)
}
if (!PASSWORD) {
  console.error('Missing VIETKITE_PASSWORD in the environment. It is deliberately not stored in this file.')
  process.exit(1)
}

const EMAIL = 'info@vietkite.com.vn'
const HANDLE = 'vietkite'
const SELLER = {
  name: 'VietKite',
  legalName: 'Công ty TNHH Cánh Diều Việt',
  // ⚠️ This bio carries the provider-of-record disclaimer. It is the same sentence the /vietkite
  // static page held, and it moves here because the storefront now owns that URL. Do not trim it
  // to make the bio shorter — it is the line that keeps eno's position accurate.
  bio: 'Licensed Vietnamese travel and visa company. VietKite is the provider of record for e-visa services under its own licence; eno introduces VietKite and does not perform or guarantee the service.',
  avatarUrl: '/vietkite-logo.png',
  // ⚠️ WHITE, NOT THE SCHEMA'S RED DEFAULT (#dc2626). ui/avatar paints avatarColor BEHIND the
  // photo so a transparent logo cannot show the initials through its gaps — which means for a
  // transparent PNG this colour IS the logo's background. VietKite's mark is an orange wordmark
  // and a green kite drawn on white; on the red default every transparent pixel rendered red and
  // the storefront looked like a different company. Any partner logo with alpha needs this set.
  avatarColor: '#ffffff',
  // ⚠️ Both stay FALSE. These badges mean eno verified something and nobody has run that check.
  // A trust signal granted by a seed script is exactly what the trust system exists to prevent.
  verified: false,
  verifiedSeller: false,
}

const admin = createClient(URL_, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
const c = new Client({ connectionString: DB })
await c.connect()

try {
  const existing = await c.query(
    `select s.id as "sellerId", s.name, h.handle, p.id as "profileId", p."accountType"
       from "Seller" s
       left join "Handle" h on h."sellerId" = s.id
       left join "Profile" p on p.id = s."ownerId"
      where s.name = $1 or h.handle = $2`,
    [SELLER.name, HANDLE],
  )
  if (existing.rows.length) {
    console.log('Already registered — nothing to do:')
    console.log(JSON.stringify(existing.rows, null, 2))
    process.exit(0)
  }
  const taken = await c.query(`select handle from "Handle" where handle = $1`, [HANDLE])
  if (taken.rows.length) {
    console.error(`Handle "${HANDLE}" is already claimed. Pick another and re-run.`)
    process.exit(1)
  }

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — would write'}:`)
  console.log(`  auth user : ${EMAIL}  (password supplied via env: yes, ${PASSWORD.length} chars — not printed)`)
  console.log(`  Profile   : accountType=business, displayName=${SELLER.name}`)
  console.log(`  Seller    : ${JSON.stringify({ ...SELLER })}`)
  console.log(`  Handle    : ${HANDLE}  ->  https://eno.vn/${HANDLE}`)
  if (!APPLY) {
    console.log('\nRe-run with --apply to write.')
    process.exit(0)
  }

  // 1. Auth user. email_confirm so they can sign in without an inbox round-trip.
  let userId
  const created = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })
  if (created.error) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const u = list?.users?.find((x) => x.email === EMAIL)
    if (!u) throw new Error(`createUser failed: ${created.error.message}`)
    userId = u.id
    console.log('  auth user already existed — reusing it')
  } else {
    userId = created.data.user.id
  }

  // 2..4 in one transaction: a Profile without its Seller, or a Seller without its Handle, is a
  // half-registered company that renders wrong rather than not at all.
  await c.query('BEGIN')
  await c.query(
    // ⚠️ updatedAt is NOT NULL with NO default — Prisma's @updatedAt is applied by the CLIENT, so
    // a raw INSERT has to set it or the row is rejected. Same trap for any hand-written insert
    // into a Prisma-managed table; check information_schema before assuming defaults exist.
    `insert into "Profile" (id, email, "displayName", "accountType", "updatedAt")
     values ($1::uuid, $2, $3, 'business', now())
     on conflict (id) do update set "accountType" = 'business', "displayName" = excluded."displayName", "updatedAt" = now()`,
    [userId, EMAIL, SELLER.name],
  )
  const s = await c.query(
    `insert into "Seller" (id, "ownerId", name, "legalName", bio, "avatarUrl", verified, "verifiedSeller", "memberSince", "claimedAt")
     values (gen_random_uuid()::text, $1::uuid, $2, $3, $4, $5, $8, $6, $7, now(), now())
     returning id`,
    [userId, SELLER.name, SELLER.legalName, SELLER.bio, SELLER.avatarUrl, SELLER.verified, SELLER.verifiedSeller, SELLER.avatarColor],
  )
  const sellerId = s.rows[0].id
  await c.query(`insert into "Handle" (handle, "sellerId", "createdAt") values ($1, $2, now())`, [HANDLE, sellerId])
  await c.query('COMMIT')

  console.log(`\nDone.`)
  console.log(`  userId    = ${userId}`)
  console.log(`  sellerId  = ${sellerId}`)
  console.log(`  storefront= https://eno.vn/${HANDLE}`)
  console.log(`\n⚠️ Rotate the password now — it has been through a shell environment.`)
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('FAILED, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
