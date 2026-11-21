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
  // Owner, 2026-10-19: "they will become our strategic partner for property rental sector … create goplus account
  // contact@goplus.com.vn with this email and they users should message that account to ask for availability".
  // scripts/import-goplus.ts writes GoPlus's vacant rooms into THIS storefront (resolved by the handle AND this email)
  // and refreshes them weekly; renters reach GoPlus by eno chat — set-official-partner.mjs goplus keeps it chat-only.
  goplus: {
    email: 'contact@goplus.com.vn',
    handle: 'goplus',
    name: 'GoPlus',
    // As the company states it in goplus.com.vn's own footer ("CÔNG TY TNHH DỊCH VỤ GOPLUS · MST 0319721165", read
    // 2026-10-19). ⚠️ Taken from the partner's site, not checked against the national register — confirm it on
    // masothue (MST 0319721165) before the official-partner badge vouches for it.
    legalName: 'CÔNG TY TNHH DỊCH VỤ GOPLUS',
    // GMBR's shape: what GoPlus does, in GoPlus's own terms (their site's description: "Ảnh chụp tại phòng, giá niêm
    // yết sẵn, đặt lịch xem phòng trực tuyến, người thuê không trả phí môi giới"), then how a renter reaches them here,
    // then the closing clause that keeps eno the marketplace introducing them — not trimmable.
    bio: "Rooms and serviced apartments for rent across Ho Chi Minh City. In GoPlus's own words: photos taken in the room, prices listed up front, viewings booked online, and no brokerage fee for tenants. Message GoPlus here to check that a room is still free and to book a viewing. eno introduces GoPlus; the tenancy is arranged with them.",
    // Their 512 px app icon (goplus.com.vn/icon-512.png, transparent), fitted to 500² like the other partner logos —
    // 12.8% visible on set-partner-avatar's padded square (its floor is 8%). The wide "GoPlus" wordmark would be a sliver
    // in a round avatar.
    avatarUrl: '/goplus-logo.png',
    // Their theme colour (site.webmanifest theme_color) — the ground under the INITIALS if the logo ever fails to load.
    avatarColor: '#710105',
    // ⛔ NO DAILY "CONFIRM AVAILABILITY" REMINDER. The weekly import IS the confirmation (it stamps
    // availabilityConfirmedAt on every room still vacant), but the reminder's threshold is 3 days (src/lib/stale.ts), so
    // a weekly feed would ping GoPlus "Confirm 2,500 listings are still available" four mornings a week for rooms it does
    // not confirm by hand. Profile.dailyReminderOptIn is the account's own switch — GoPlus can turn it back on.
    dailyReminderOptIn: false,
  },
  // Owner, 2026-11-04: "https://thuexemaysaigon.vn/ eno.vn lets remove all motorbike rentals and add properly the from this
  // partner, create account with their email hand me password so our admin can manage listings". The address is their
  // footer's; scripts/import-blvck.ts writes their 19 bikes once onto THIS storefront (handle AND email), then the account
  // manages them. set-official-partner.mjs blvck keeps it chat-only; set-partner-avatar.ts sets their published logo.
  blvck: {
    email: 'thuexemaysaigonblvck@gmail.com',
    handle: 'blvck',
    name: 'Blvck Motorbike',
    // ⚠️ NULL ON PURPOSE: their footer's tax code is the placeholder "xxxxxxxxxxxxx", so no registered name can be read off it.
    legalName: null,
    // GMBR's shape: what they do, how a renter reaches them here, then the closing clause that keeps eno the marketplace
    // introducing them. Not trimmable.
    bio: 'Motorbike rental in Ho Chi Minh City: scooters, semi-automatics, clutch bikes, an electric scooter and big bikes, from 100,000 đ a day, with lower daily prices for longer rentals. Two helmets with every bike, delivery across the city, or collect in District 1. Message the shop here on eno to check availability. eno introduces Blvck Motorbike; the rental contract is with them.',
    // Set from their own published logo afterwards (scripts/set-partner-avatar.ts), so no deploy is needed for it.
    avatarUrl: null,
    avatarColor: '#111111',
    // ⛔ NO DAILY "CONFIRM AVAILABILITY" MAIL to the partner's inbox: eno's admin manages this account (GoPlus's reasoning).
    dailyReminderOptIn: false,
  },
  // Owner, 2026-11-09: "add https://saigonmoving.com/bang-gia.htm saigon moving as a partner for moving home". The email is
  // the one their own about and home pages publish; scripts/import-saigonmoving.ts writes their one home-moving listing
  // onto THIS storefront (handle AND email) and sets the address and logo; then the account manages it (the runbook is
  // that script's header). set-official-partner.mjs saigonmoving keeps it chat-only.
  saigonmoving: {
    email: 'saigonmoving.com@gmail.com',
    handle: 'saigonmoving',
    name: 'Saigon Moving',
    // ⚠️ NULL ON PURPOSE: their site names the company only in English ("SAIGON MOVING CO., LTD.", /bang-gia.htm, read
    // 2026-11-09), with no Vietnamese registered name and no tax code, so no registered name can be verified from it.
    legalName: null,
    // GMBR's shape: what they do, how a customer reaches them here, then the closing clause that keeps eno the marketplace
    // introducing them. Not trimmable. The claims are their own site's.
    bio: 'Full-package moving in Ho Chi Minh City and the neighbouring provinces: homes, offices and warehouses. Free consultation and a free survey, packing materials supplied, furniture taken apart, wrapped, moved and set back in place. Message Saigon Moving here on eno for a quote. eno introduces Saigon Moving; the moving contract is with them.',
    // Set from their own published logo afterwards (scripts/import-saigonmoving.ts: set-partner-avatar.ts refuses an owned
    // storefront), so no deploy is needed for it.
    avatarUrl: null,
    // The red of their "SaigonMoving" wordmark: the mean of its 22,388 opaque pixels in public/partners/saigonmoving.png.
    avatarColor: '#ed1c25',
    // ⛔ NO DAILY "CONFIRM AVAILABILITY" MAIL to the partner's inbox: eno's admin manages this account (GoPlus's reasoning).
    dailyReminderOptIn: false,
  },
  // ── CAR RENTAL PARTNERS (owner, 2026-11-17: "import car rental services … and the shops as partners"; asked: all 5 are
  // partners, accounts on eno-managed emails). Each login is eno's (support+<handle>@eno.vn, Cloudflare Email Routing →
  // eno's inbox), as Hoàng Hà's and ShopDunk's are; legalName only where the shop's own site prints it. Their cars:
  // src/lib/car-partners.ts + scripts/import-car-partners.ts, which also sets the logo (avatarUrl null here). No daily
  // reminder mail: eno's admin manages these accounts.
  karplus: {
    email: 'support+karplus@eno.vn',
    handle: 'karplus',
    name: 'KarPlus',
    legalName: null,
    bio: 'Self-drive car rental in Ho Chi Minh City: sedans, SUVs and 7-seaters, 400 km a day included, 10% off from 3 days and 15% from 7 days, and a driver on request. Message KarPlus here on eno to check availability. eno introduces KarPlus; the rental contract is with them.',
    avatarUrl: null,
    avatarColor: '#b8913a',
    dailyReminderOptIn: false,
  },
  carbi: {
    email: 'support+carbi@eno.vn',
    handle: 'carbi',
    name: 'Carbi',
    legalName: 'CÔNG TY TNHH TMDV DU LỊCH VẬN TẢI CARBI',
    bio: 'Self-drive car rental in Ho Chi Minh City, based in Gò Vấp: sedans, SUVs and 7-seaters, delivered to your door. Message Carbi here on eno to check availability. eno introduces Carbi; the rental contract is with them.',
    avatarUrl: null,
    avatarColor: '#e8a020',
    dailyReminderOptIn: false,
  },
  ankhanhtravel: {
    email: 'support+ankhanhtravel@eno.vn',
    handle: 'ankhanhtravel',
    name: 'An Khánh Travel',
    legalName: 'CÔNG TY TNHH THƯƠNG MẠI VÀ VẬN TẢI DU LỊCH AN KHÁNH TRAVEL',
    bio: 'Self-drive car rental across Ho Chi Minh City from Bình Tân: sedans, SUVs and 7-seaters, delivered to any district, with a test drive before you rent. Message An Khánh Travel here on eno to check availability. eno introduces An Khánh Travel; the rental contract is with them.',
    avatarUrl: null,
    avatarColor: '#f39200',
    dailyReminderOptIn: false,
  },
  quehuong: {
    email: 'support+quehuong@eno.vn',
    handle: 'quehuong',
    name: 'Quê Hương Group',
    legalName: 'CÔNG TY CP TMDV QUÊ HƯƠNG',
    bio: 'Self-drive car rental in Ho Chi Minh City with branches across the city: sedans, SUVs and 7-seaters under 3 years old, delivered to your home. Message Quê Hương Group here on eno to check availability. eno introduces Quê Hương Group; the rental contract is with them.',
    avatarUrl: null,
    avatarColor: '#e11d2a',
    dailyReminderOptIn: false,
  },
  // ⛔ HELD (src/lib/car-partners.ts `held`): register only once the shop's own photos let its cars be imported.
  anbinhtours: {
    email: 'support+anbinhtours@eno.vn',
    handle: 'anbinhtours',
    name: 'An Bình Tours',
    legalName: null,
    bio: 'Self-drive car rental in Ho Chi Minh City from Bình Tân: sedans, SUVs and 7- and 8-seaters from 2021 on, delivered to your home or to Tân Sơn Nhất airport. Message An Bình Tours here on eno to check availability. eno introduces An Bình Tours; the rental contract is with them.',
    avatarUrl: null,
    avatarColor: '#c9a227',
    dailyReminderOptIn: false,
  },
  // ── WORK PERMIT + TRC PARTNER (owner, 2026-11-18: "https://evisasaigon.vn/ add them as a partner for Work permit and TRC
  // issuance"; asked: eno-managed login like the car partners, go live through the licence check with their registration).
  // legalName = the national tax register's record for MST 0317048667 (the owner's number; read 2026-11-18 via
  // api.vietqr.io, which mirrors the tax office: "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ EVISA SAIGON", active). Its listings are
  // in services/legal-permits — a licence aisle — written by scripts/seed-evisasaigon.ts, held until the admin approves.
  // ⛔ The bio names only work permits and residence cards: eno.vn does not advertise visa runs or the brand's other
  // visa services (CLAUDE.md, the legal boundary) — the brand's name is what it is.
  evisasaigon: {
    email: 'support+evisasaigon@eno.vn',
    handle: 'evisasaigon',
    name: 'Evisa Saigon',
    legalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ EVISA SAIGON',
    bio: 'Work permits and temporary residence cards (TRC) for foreigners in Ho Chi Minh City. Evisa Saigon checks your case, gives you the document list, prepares the file with you and your employer and follows it until the permit or card is issued, with government fees included in the price. Office: 385/14 Nguyễn Trãi, Cầu Ông Lãnh ward. Message Evisa Saigon here on eno to start. eno introduces Evisa Saigon; the service contract is with them.',
    avatarUrl: null,
    // The navy of their globe-and-"EVISA" logo (the most common saturated cluster of evisasaigon.vn's LOGO-EVISA file).
    avatarColor: '#283868',
    dailyReminderOptIn: false,
  },
  // ── RENTAL AGENCY PARTNER (owner, 2026-11-18: "add them as partners and their apartment listings"; then: import everything
  // they list, each dated). An eno-held login like the car partners and Evisa Saigon; NOT an eno-run pair (that pair opens
  // the AccessTrade paths). scripts/import-saigoncribs.ts writes their listings once onto THIS storefront (handle AND email
  // AND official partner) and sets the logo (avatarUrl null here); then eno's admin manages them. Plan:
  // ~/eno-saigoncribs-2026-11-18/PLAN.md.
  // ⛔ The bio names only the homes they let: their site also sells visa help, airport pickup, immigration assistance,
  // internet setup and cash-back offers, and eno.vn carries none of it (CLAUDE.md, the legal boundary; the importer strips
  // the same lines from every description). No address, phone or link either: the site prints no office address.
  saigoncribs: {
    email: 'support+saigoncribs@eno.vn',
    handle: 'saigoncribs',
    name: 'Saigon Cribs',
    // ⚠️ NULL ON PURPOSE: their site prints no registered company name and no tax code (read 2026-11-18), so none can be
    // verified from it (GMBR's and KarPlus's reasoning).
    legalName: null,
    bio: 'Rental agency in Ho Chi Minh City: apartments and serviced apartments, villas and houses, short stays by the night, and offices, in Thảo Điền and District 2, District 7, District 9, Bình Thạnh, District 1 and more. Message Saigon Cribs here on eno to check availability and book a viewing. eno introduces Saigon Cribs; the tenancy is arranged with them.',
    avatarUrl: null,
    // The BLACK of their palm-and-wordmark logo, not its yellow ground (#ffc000): ui/avatar draws the initials in white, and
    // white on that yellow is 1.6:1 — the white-on-white failure above in another colour. Black is the mark's own ink.
    avatarColor: '#000000',
    dailyReminderOptIn: false,
  },
  // ── HOUSING SAIGON (owner, 2026-11-21: "create a partner store with housingsaigon@eno.vn as other formats with support+
  // before it and leave it empty"). An eno-held login like Saigon Cribs and the car partners, created EMPTY: no listings, and
  // no bio, legal name or logo — nothing about the company has been supplied or read, so the storefront states nothing beyond
  // its name until the owner fills it. ⚠️ NO Cloudflare Email Routing rule for this address (owner, same day: "No route"):
  // mail to it — a sign-in code, a password reset — is not delivered until one is added.
  housingsaigon: {
    email: 'support+housingsaigon@eno.vn',
    handle: 'housingsaigon',
    name: 'Housing Saigon',
    legalName: null,
    bio: null,
    avatarUrl: null,
    // A dark blue: ui/avatar draws the initials in white (the contrast rule Saigon Cribs' entry records).
    avatarColor: '#1f4e79',
    dailyReminderOptIn: false,
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
  console.log(`  Profile   : accountType=business, displayName=${SELLER.name}, dailyReminderOptIn=${existingAuth ? 'unchanged (an adopted account keeps its own)' : P.dailyReminderOptIn ?? true}`)
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
    // "dailyReminderOptIn": the partner's own default (GoPlus: off — see its entry); an ADOPTED account keeps the
    // preference it already had (`on conflict` leaves the column alone).
    `insert into "Profile" (id, email, "displayName", "accountType", "dailyReminderOptIn", "updatedAt")
     values ($1::uuid, $2, $3, 'business', $4, now())
     on conflict (id) do update set "accountType" = 'business', "displayName" = excluded."displayName", "updatedAt" = now()`,
    [userId, P.email, SELLER.name, P.dailyReminderOptIn ?? true],
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
  // ⚠️ A PROFILE ROW MAY ALREADY EXIST FOR A FRESH auth user (a sign-up trigger, a race), and the `on conflict` above
  // leaves the column alone — so a partner's own default is SET explicitly on an account this run created (a reviewer's
  // catch: GoPlus would otherwise get the daily "confirm 2,500 listings" ping). An ADOPTED account keeps its own choice.
  if (!existingAuth && P.dailyReminderOptIn !== undefined) {
    await c.query(`update "Profile" set "dailyReminderOptIn" = $1, "updatedAt" = now() where id = $2::uuid`, [P.dailyReminderOptIn, userId])
  }
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
