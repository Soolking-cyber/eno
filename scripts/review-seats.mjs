/**
 * THE REVIEW SEATS — the reusable password logins eno hands to people who check the platform from outside:
 * the two app-store review teams, the AI-app marketplace reviewers and the owner's lawyer. ONE table, imported
 * by every script that needs it:
 *   · scripts/register-play-reviewer.mjs — creates a seat's account (auth user + Profile + Seller);
 *   · scripts/seed-app-review-thread.mjs — seeds the Apple seat's demo conversation (the Block test);
 *   · scripts/seed-ai-review-listings.mjs — seeds the AI seat's hidden demo listings (what the Partner MCP reads).
 * A second copy of an address in any of them is how they would drift apart, so none keeps one.
 *
 * PURE: no database, no network, no env — src/lib/app-review-seat.test.ts imports it as it stands.
 *
 * ⚠️ EVERY NAME HERE IS PUBLIC. `sellerName` renders on /sellers/<id> — reachable, though linked from
 * nowhere and absent from the sitemap (the measured exposure is in register-play-reviewer.mjs's header) —
 * and `displayName` is what a chat counterpart sees for the seat. Both say plainly what the account is,
 * so nobody who lands on one mistakes it for a real merchant.
 *
 * ⚠️ NO ADDRESS HERE MAY BE AN ADMIN ONE. ADMIN_EMAILS is an EXACT allowlist (src/lib/admin.ts), so naming
 * a staff address would hand a store reviewer the admin console — and, for the Apple seat, make Block
 * answer `cannot_block_staff`, i.e. break the one thing that seat exists to test. Nothing is ever
 * delivered to any of these mailboxes: the accounts are created with email_confirm and sign in with a
 * password (the official-partner gate, scripts/set-official-partner.mjs).
 *
 * ⚠️ THE PLAY SEAT'S @eno.forum IS ONLY AN IDENTIFIER. One database and one auth serve both editions and
 * src/app/api/auth/password has no edition check, so it signs in on eno.vn too; App Store review gets its
 * own @eno.vn seat all the same (docs/ios-appstore-release.md P11) — two stores, two credentials, and a
 * rotation or a deletion on one never takes the other down.
 */

/** The seats, by the key `--for=<key>` names. `play` is the seat with NO flag. */
export const REVIEW_SEATS = Object.freeze({
  play: Object.freeze({
    email: 'play-review@eno.forum',
    sellerName: 'eno Play review (internal)',
    displayName: 'Play review',
    // Repo-root files, gitignored by both `.env*.local` and `.env*` (.gitignore).
    credFile: '.env.play-reviewer.local',
    envPrefix: 'PLAY',
    credHeader: '# Google Play Console → App content → Sign in details',
    credNote: '# Paste these into the Play form. Treat as a live credential; rotate if it leaks.',
    handOff: 'paste the password into Play Console',
  }),
  /**
   * The owner's lawyer (2026-10-01: "create a test account for the lawyer to check the platform"). Since
   * that day this account also owns the Luật Hoàng Phi storefront (scripts/seed-hoangphi.ts), whose buyer
   * chats are read only when the lawyer signs in — unless a Cloudflare rule forwards lawyer-review@eno.vn.
   */
  lawyer: Object.freeze({
    email: 'lawyer-review@eno.vn',
    sellerName: 'eno legal review (internal)',
    displayName: 'Legal review',
    credFile: '.env.lawyer-review.local',
    envPrefix: 'LAWYER',
    credHeader: '# Legal review sign-in for eno.vn (email + password, eno.vn/signin)',
    credNote: '# Hand to the lawyer only, over a private channel. Treat as a live credential; rotate if it leaks.',
    handOff: 'hand the password to the lawyer over a private channel',
  }),
  /**
   * App Store review (2026-10-07, docs/ios-appstore-release.md P11). The conversation its reviewer uses to
   * test Block is seeded separately, by scripts/seed-app-review-thread.mjs, once this account exists.
   */
  apple: Object.freeze({
    email: 'app-review@eno.vn',
    sellerName: 'eno App Review (internal)',
    displayName: 'App Review',
    credFile: '.env.app-review.local',
    envPrefix: 'APPLE',
    credHeader: '# App Store Connect → App Review Information → Sign-in required',
    credNote: '# Paste these into App Store Connect. Treat as a live credential; rotate if it leaks.',
    handOff: 'paste the password into App Store Connect',
  }),
  /**
   * AI-app marketplace review (2026-11-14): the reviewers of OpenAI's ChatGPT apps, Muse and Claude's connector
   * directory. They sign in at eno.vn/signin with this email and password (no SMS, emailed or magic-link code — the
   * official-partner gate, scripts/set-official-partner.mjs), then connect eno's Partner MCP server through "Sign in
   * with eno" (OAuth, src/lib/api/oauth-grant.ts) and read the shop's own demo listings, seeded HIDDEN by
   * scripts/seed-ai-review-listings.mjs.
   * ⚠️ THE ONLY SEAT WITH `accountType: 'business'`, AND IT HAS TO BE: eligibleShop() refuses a sign-in grant to anyone
   * but a BUSINESS account that owns its storefront (`not_business` on the consent page). What business changes in
   * public is measured in register-play-reviewer.mjs's header. Every other seat has NO `accountType` key and is created
   * 'individual' (seatAccountType below) — the Play seat's entry is pinned whole by src/lib/app-review-seat.test.ts.
   */
  ai: Object.freeze({
    email: 'ai-review@eno.vn',
    sellerName: 'eno AI app review (internal)',
    displayName: 'AI app review',
    credFile: '.env.ai-review.local',
    envPrefix: 'AI',
    accountType: 'business',
    credHeader: '# AI app reviews (OpenAI ChatGPT, Muse, Claude): sign-in for eno.vn (email + password, eno.vn/signin)',
    credNote: "# Paste only into the review forms' test-account fields. Treat as a live credential; rotate if it leaks.",
    // ⛔ Printed on success as the next step: it names the precondition, so the step the header forbids is never invited.
    handOff: "ONLY once the app refuses review seats any teacher contact (register-play-reviewer.mjs header) is LIVE: paste the password into the AI app review forms' test-account fields (ChatGPT, Muse, Claude) — nowhere else",
  }),
})

/** The values `--for=` accepts. No `--for` at all is the Play seat — the script's original contract. */
export const SEAT_FLAGS = Object.freeze(['lawyer', 'apple', 'ai'])

/** The Profile account types a seat may be created with — the two the app itself writes (api/profile/account-type). */
export const SEAT_ACCOUNT_TYPES = Object.freeze(['individual', 'business'])

/**
 * The Profile `accountType` a seat is created with: `{ accountType }`, or `{ error }` for the caller to print before
 * exiting.
 *
 * ⛔ FAIL CLOSED, BEFORE ANY WRITE. A seat with NO `accountType` key is 'individual' (what every seat was created as
 * until the AI seat); a key that is present must be EXACTLY 'individual' or 'business'. 'Business', ' business', null,
 * undefined or ['business'] is a typo in this table, and a typo must not become a Profile row the app has never written
 * — nor silently fall back to 'individual', which would leave the AI seat unable to connect the MCP (eligibleShop).
 */
export function seatAccountType(seat) {
  if (!seat || typeof seat !== 'object') return { error: 'no seat given' }
  if (!Object.hasOwn(seat, 'accountType')) return { accountType: 'individual' }
  const v = seat.accountType
  if (typeof v !== 'string' || !SEAT_ACCOUNT_TYPES.includes(v)) {
    return { error: `${seat.email}: accountType must be exactly ${SEAT_ACCOUNT_TYPES.map((t) => `'${t}'`).join(' or ')} (got ${JSON.stringify(v) ?? 'undefined'}) — nothing was written` }
  }
  return { accountType: v }
}

/**
 * Which seat a command line names: `{ key, seat }`, or `{ error }` for the caller to print before exiting.
 *
 * ⛔ FAIL CLOSED ON A MISTYPED SEAT. `--for apple` (a space), `--for=Apple`, a bare `--for=` or two `--for`
 * flags must never fall through to the Play seat and touch the wrong account (a reviewer's catch,
 * 2026-10-01). Only an EXACT `--for=<key>` names a seat, and only one may be given.
 */
export function seatFromArgv(argv) {
  const given = argv.filter((a) => a === '--for' || a.startsWith('--for='))
  if (given.length === 0) return { key: 'play', seat: REVIEW_SEATS.play }
  const usage = `the seat flags are ${SEAT_FLAGS.map((k) => `--for=${k}`).join(' and ')} (no flag = the Play reviewer)`
  if (given.length > 1) return { error: `${given.join(' ')}: give one --for at most — ${usage}` }
  const key = given[0].slice('--for='.length)
  if (!SEAT_FLAGS.includes(key)) return { error: `unknown ${given[0]} — ${usage}` }
  return { key, seat: REVIEW_SEATS[key] }
}

/**
 * Find an auth user by email, paging until found. Shared by both scripts above.
 *
 * ⚠️ PAGE, DO NOT GUESS A PAGE SIZE — the same bug bit register-partner-seller.mjs: `{ page: 1, perPage: 200 }`
 * silently stops finding anyone once the user table outgrows one page, which is a failure that arrives
 * with time rather than with a code change.
 *
 * ⚠️ RUNNING OUT OF PAGES IS NOT "NOT FOUND". 50 × 200 bounds this at 10,000 users; past that, returning
 * null would read as "the address is free" to every caller — a collision guard waving a duplicate
 * through, a recovery path reporting "no account was created" without having looked at the whole table.
 * Throwing makes the caller treat it as UNKNOWN, which is what it is (codex, round 5, 2026-09-09).
 *
 * `admin` is a supabase-js client created with the service-role key (only `auth.admin.listUsers` is used).
 */
export async function findAuthUser(admin, email) {
  const want = email.toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    if (!data?.users?.length) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === want)
    if (hit) return hit
  }
  throw new Error('listUsers: exhausted 50 pages (10,000 users) without a conclusive answer')
}
