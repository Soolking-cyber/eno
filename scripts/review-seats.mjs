/**
 * THE REVIEW SEATS — the reusable password logins eno hands to people who check the platform from outside:
 * the two app-store review teams and the owner's lawyer. ONE table, imported by both scripts that need it:
 *   · scripts/register-play-reviewer.mjs — creates a seat's account (auth user + Profile + Seller);
 *   · scripts/seed-app-review-thread.mjs — seeds the Apple seat's demo conversation (the Block test).
 * A second copy of an address in either script is how the two would drift apart, so neither keeps one.
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
})

/** The values `--for=` accepts. No `--for` at all is the Play seat — the script's original contract. */
export const SEAT_FLAGS = Object.freeze(['lawyer', 'apple'])

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
