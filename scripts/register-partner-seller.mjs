/**
 * REGISTER A PARTNER AS A BUSINESS SELLER, WITH ITS OWN ACCOUNT AND STOREFRONT HANDLE.
 *
 *   PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs gmbr
 *   PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs gmbr --apply
 *
 * Generalised from scripts/register-vietkite-seller.mjs when the SECOND partner arrived (owner,
 * 2026-08-13). That script was one company hard-coded into its own file; a third partner would have
 * meant a third copy, and the copies would drift — the VietKite one already carried a broken INSERT
 * (ten columns, eleven values) that nobody hit because nobody ran it twice. One table, one code path.
 *
 * ⚠️ THE PASSWORD IS READ FROM THE ENVIRONMENT AND IS NEVER STORED IN THIS FILE.
 * It must not be committed, pasted into a commit message, or echoed to a log. This script prints
 * only whether one was supplied and how long it is. Whoever runs it should treat the value as
 * sensitive and ROTATE IT AFTERWARDS — a password that has travelled through a terminal, a shell
 * history or a chat log is no longer a secret, whatever else is true about it.
 *
 * ⚠️ THIS WRITES TO THE PRODUCTION DATABASE AND CREATES A REAL LOGIN. eno.vn and eno.forum share
 * one database; the storefront is publicly reachable the moment it exists, and the account can sign
 * in immediately. Dry run by default on purpose — run without --apply first and read the plan.
 *
 * WHY AN ACCOUNT AT ALL, rather than the simpler guest seller: `isBusiness` is derived in
 * src/lib/serialize.ts from `seller.owner?.accountType === 'business'`. No Profile means no owner
 * means the storefront can never present as a business, whatever else is set on the Seller row.
 * The account is what makes "business" true rather than decorative — and it is also what lets the
 * partner manage their own storefront instead of eno holding it for them.
 *
 * ⚠️ THIS DOES NOT GRANT THE OFFICIAL-PARTNER BADGE, DELIBERATELY. `officialPartner` has exactly
 * one write path — scripts/set-official-partner.mjs — because it asserts a commercial agreement
 * that no automated check can establish, and because it CHANGES BEHAVIOUR (an official partner
 * shares no phone number; the contact route answers 403 partner_chat_only). Registering a seller
 * and vouching for them are two decisions, so they stay two commands:
 *     node --env-file=.env scripts/set-official-partner.mjs <handle> --apply
 *
 * REVERSAL, in this order (the FKs point this way): delete the Handle row, delete the Seller row,
 * delete the Profile row, then delete the auth user in Supabase.
 */
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const PARTNERS = {
  gmbr: {
    email: 'info@giacmobayre.com',
    handle: 'gmbr',
    name: 'GMBR',
    // ⚠️ NULL ON PURPOSE — I DO NOT KNOW THIS COMPANY'S REGISTERED NAME. `legalName` renders on the
    // storefront as a statement about a real legal entity, and the two spellings reachable from
    // what was supplied ("Giá Máy Bay Rẻ" from the asset folder, "Giấc Mơ Bay Rẻ" from the email
    // domain) are different companies' worth of different. Guessing one would be inventing a fact,
    // so it stays null until the owner supplies the registered name — the storefront simply omits
    // the line, which is honest. VietKite's is 'Công ty TNHH Cánh Diều Việt' for comparison.
    legalName: null,
    // ⚠️ IT LEADS WITH THE PARTNER, AND THE LAST CLAUSE IS STILL LOAD-BEARING. Rewritten on the
    // owner's instruction (2026-08-13: "they have all licenses and booking is certain") because the
    // first draft opened on what eno does NOT do — three negatives before a reader learned what the
    // company sells, which reads as a warning about the partner rather than a description of them.
    // Licences and confirmed bookings now come first, in GMBR's own terms. The closing sentence is
    // NOT decoration and must not be trimmed away as "defensive": it is the line that keeps eno a
    // marketplace introducing a licensed seller rather than the seller of a travel service it holds
    // no licence for — the same position VietKite's bio states. Say it once, plainly, at the end.
    // The "600+ airlines" / "10+ years" figures are GMBR's own, taken from their banner artwork,
    // and are phrased as theirs.
    bio: 'Fully licensed Vietnamese travel agency with 10+ years in the market. GMBR issues confirmed bookings for flights across 600+ airlines, plus hotels, travel insurance and attraction tickets — every booking made, ticketed and honoured by GMBR under its own licences. eno introduces GMBR; the booking contract is with them.',
    avatarUrl: '/gmbr-logo.png',
    avatarColor: '#e02020',
  },
}

const KEY = process.argv[2]
const APPLY = process.argv.includes('--apply')
// Explicit consent to take over an auth account that already exists at this address. See the
// account-takeover note further down — adoption is never a silent fallback.
const ADOPT = process.argv.includes('--adopt')
const P = PARTNERS[KEY]

if (!P) {
  console.error(`Usage: PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs <${Object.keys(PARTNERS).join('|')}> [--apply] [--adopt]`)
  process.exit(1)
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const DB = process.env.DIRECT_URL
const PASSWORD = process.env.PARTNER_PASSWORD

if (!URL_ || !SECRET || !DB) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL — run with node --env-file=.env')
  process.exit(1)
}
if (!PASSWORD) {
  console.error('Missing PARTNER_PASSWORD in the environment. It is deliberately not stored in this file.')
  process.exit(1)
}

const SELLER = {
  name: P.name,
  legalName: P.legalName,
  bio: P.bio,
  avatarUrl: P.avatarUrl,
  // ⚠️ THE PARTNER'S BRAND COLOUR, AND EMPHATICALLY *NOT* WHITE. avatarColor is the ground under
  // the INITIALS — what shows if the logo ever fails to load — since ui/avatar stopped painting it
  // behind the photo (2026-08-12). ui/avatar renders those initials with `text-white` on its root
  // (avatar.tsx:45, measured), so a white avatarColor is white-on-white: a storefront whose avatar
  // is an empty disc exactly when the logo 404s. The VietKite row inherited '#ffffff' from a
  // comment that justified white as a PLATE colour — correct once, obsolete the moment the plate
  // moved to a neutral surface, and never re-checked. Sampled from the supplied logo
  // (most-saturated opaque cluster: #e02020, 5006px).
  avatarColor: P.avatarColor,
  // ⚠️ Both stay FALSE. These badges mean eno verified something and nobody has run that check.
  // A trust signal granted by a seed script is exactly what the trust system exists to prevent.
  verified: false,
  verifiedSeller: false,
}

const admin = createClient(URL_, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
const c = new Client({ connectionString: DB })
await c.connect()

/**
 * Find an auth user by email, paging until found. ⚠️ PAGE, DO NOT GUESS A PAGE SIZE — the inherited
 * version read `{ page: 1, perPage: 200 }` and silently stopped finding anyone once the user table
 * outgrew 200 rows, which is a bug that arrives on its own with time rather than with a code change.
 */
async function findAuthUser(email) {
  const want = email.toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    if (!data?.users?.length) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === want)
    if (hit) return hit
  }
  return null
}

try {
  // ⚠️ "ALREADY REGISTERED" MUST MEAN *THIS* PARTNER, NOT "SOMETHING MATCHED".
  // The inherited query asked `where s.name = $1 OR h.handle = $2` and treated any hit as
  // idempotent success. That conflates two opposite outcomes: if a DIFFERENT seller already owns
  // this handle, the OR matches THEM, and the script prints "nothing to do" and exits 0 — a
  // collision reported as success, with the handle check below never reached. Ask the two
  // questions separately: same handle AND same owning email is us; same handle, anyone else, is a
  // collision and must fail loudly.
  const byHandle = await c.query(
    `select s.id as "sellerId", s.name, h.handle, p.id as "profileId", p."accountType", p.email
       from "Handle" h
       left join "Seller" s on h."sellerId" = s.id
       left join "Profile" p on p.id = s."ownerId"
      where h.handle = $1`,
    [P.handle],
  )
  if (byHandle.rows.length) {
    const row = byHandle.rows[0]
    if (row.email === P.email) {
      console.log('Already registered — nothing to do:')
      console.log(JSON.stringify(byHandle.rows, null, 2))
      process.exit(0)
    }
    console.error(`Handle "${P.handle}" is already claimed by a DIFFERENT owner (${row.email ?? 'unknown'}, seller ${row.sellerId ?? 'none'}).`)
    console.error('Pick another handle and re-run. Refusing to touch someone else\'s storefront.')
    process.exit(1)
  }
  const byName = await c.query(`select id, name from "Seller" where name = $1`, [SELLER.name])
  if (byName.rows.length) {
    console.error(`A seller named "${SELLER.name}" already exists (${byName.rows[0].id}) without the "${P.handle}" handle.`)
    console.error('Resolve that by hand — this script will not adopt or rename an existing storefront.')
    process.exit(1)
  }
  // The email is a UNIQUE column on Profile and an identity in Supabase auth; colliding with an
  // existing human account here would attach a company storefront to a person's login.
  const emailTaken = await c.query(`select id, email from "Profile" where email = $1`, [P.email])
  if (emailTaken.rows.length) {
    console.error(`Email ${P.email} already belongs to profile ${emailTaken.rows[0].id}. Resolve that first.`)
    process.exit(1)
  }

  // ⚠️ THE PROFILE CHECKS ABOVE DO NOT SEE AN AUTH-ONLY ACCOUNT, AND THE ADOPT PATH IS DESTRUCTIVE.
  // Supabase auth and the Profile table are different systems: somebody can hold an auth.users row
  // at this address with no Profile (a signup that never finished, an OTP request). Every check so
  // far queries Profile, so such an account sails through — and then the adopt branch below RESETS
  // ITS PASSWORD, force-confirms its email, and attaches a company Profile to their user id. That
  // is an account takeover performed by a seeding script (found by review, 2026-08-13).
  // So look in auth itself, and make adoption an explicit decision rather than a fallback.
  const existingAuth = await findAuthUser(P.email)
  if (existingAuth && !ADOPT) {
    console.error(`An auth account already exists for ${P.email} (id ${existingAuth.id}, created ${existingAuth.created_at}).`)
    console.error('This script would RESET ITS PASSWORD and confirm its email. That is an account takeover')
    console.error('unless the account is genuinely the partner\'s. If it is, re-run with --adopt; if it is not,')
    console.error('use a different address or delete the stray user in Supabase → Authentication → Users.')
    process.exit(1)
  }

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — would write'}:`)
  if (existingAuth) console.log(`  ⚠️ ADOPTING the existing auth user ${existingAuth.id} and RESETTING its password`)
  console.log(`  auth user : ${P.email}  (password supplied via env: yes, ${PASSWORD.length} chars — not printed)`)
  console.log(`  Profile   : accountType=business, displayName=${SELLER.name}`)
  console.log(`  Seller    : ${JSON.stringify(SELLER)}`)
  console.log(`  Handle    : ${P.handle}  ->  https://eno.vn/${P.handle}`)
  console.log(`  officialPartner: NOT set here — run set-official-partner.mjs ${P.handle} --apply`)
  if (!APPLY) {
    console.log('\nRe-run with --apply to write.')
    process.exit(0)
  }

  // 1. Auth user. email_confirm so they can sign in without an inbox round-trip.
  //
  // ⚠️ THE RECOVERY PATH HAD TO ACTUALLY RECOVER, AND THE INHERITED ONE DID NOT (both problems
  // found by review, 2026-08-13). It swept up EVERY createUser failure as "already exists", then
  // looked for the address in `listUsers({ page: 1, perPage: 200 })` — the first page only, which
  // stops finding anyone the moment the user table outgrows it. And when it did find the user it
  // adopted them WITHOUT setting the password, while still printing "Done" and "password supplied
  // via env: yes": the operator hands the partner credentials that cannot sign in.
  //
  // So: page until found rather than guessing a page size, and set the password on the account we
  // adopt, so "Done" means the same thing on both paths.
  let userId
  const created = await admin.auth.admin.createUser({ email: P.email, password: PASSWORD, email_confirm: true })
  if (created.error) {
    const found = await findAuthUser(P.email)
    if (!found) throw new Error(`createUser failed: ${created.error.message}`)
    if (!ADOPT) throw new Error(`an auth user exists for ${P.email} but --adopt was not given`)
    userId = found.id
    // Adopting an existing login means adopting whatever password it already had — which is not
    // the one the operator was told they were setting. Make them agree.
    const pw = await admin.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true })
    if (pw.error) throw new Error(`adopted the existing auth user but could not set its password: ${pw.error.message}`)
    console.log('  auth user already existed — reused it AND reset its password to the supplied one')
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
    [userId, P.email, SELLER.name],
  )
  const s = await c.query(
    // Column list and values are aligned and in the same order — the only arrangement a reader can
    // check by eye. The VietKite copy of this statement listed TEN columns against ELEVEN values
    // (`INSERT has more expressions than target columns`) and could not have run as written.
    `insert into "Seller" (id, "ownerId", name, "legalName", bio, "avatarUrl", "avatarColor", verified, "verifiedSeller", "memberSince", "claimedAt")
     values (gen_random_uuid()::text, $1::uuid, $2, $3, $4, $5, $6, $7, $8, now(), now())
     returning id`,
    [userId, SELLER.name, SELLER.legalName, SELLER.bio, SELLER.avatarUrl, SELLER.avatarColor, SELLER.verified, SELLER.verifiedSeller],
  )
  const sellerId = s.rows[0].id
  await c.query(`insert into "Handle" (handle, "sellerId", "createdAt") values ($1, $2, now())`, [P.handle, sellerId])
  await c.query('COMMIT')

  console.log(`\nDone.`)
  console.log(`  userId    = ${userId}`)
  console.log(`  sellerId  = ${sellerId}`)
  console.log(`  storefront= https://eno.vn/${P.handle}`)
  console.log(`\nNext: node --env-file=.env scripts/set-official-partner.mjs ${P.handle} --apply`)
  console.log(`⚠️ Rotate the password now — it has been through a shell environment.`)
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('FAILED, rolled back:', e.message)
  // ⚠️ THE ROLLBACK DOES NOT REACH SUPABASE. The auth user is created before BEGIN and lives in a
  // different system, so a failed transaction can leave a real, signable-in login with no Profile,
  // Seller or Handle behind it. That is not silently recoverable — the next run's createUser will
  // fail on the duplicate address and take the adopt-and-reset path above — so say it out loud
  // rather than leaving the operator to discover it.
  console.error(`\n⚠️ An auth user for ${P.email} may now exist WITHOUT a storefront.`)
  console.error('   Either delete it in Supabase → Authentication → Users, or re-run this script:')
  console.error('   it will adopt that user, reset its password, and finish the rows.')
  process.exitCode = 1
} finally {
  await c.end()
}
