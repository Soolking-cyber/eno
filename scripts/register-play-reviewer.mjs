/**
 * CREATE THE GOOGLE PLAY REVIEWER ACCOUNT — the one login Play's reviewers use to see the parts
 * of the app that sign-in gates.
 *
 *   node --env-file=.env scripts/register-play-reviewer.mjs            # dry run
 *   node --env-file=.env scripts/register-play-reviewer.mjs --apply
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN register-partner-seller.mjs. That script is the right shape for a
 * COMPANY: it claims a Handle, sets `accountType='business'` and writes a bio and a logo, so the
 * storefront is publicly reachable at https://eno.vn/<handle> the moment it exists. A Play reviewer
 * is not a company, and inventing one would put a fake business storefront on a live marketplace
 * for real users to find. This creates the SMALLEST row set that satisfies the sign-in gate and
 * nothing more: no Handle, no business account type, no bio, no avatar, no phone.
 *
 * ⚠️ WHY THE ACCOUNT NEEDS THE OFFICIAL-PARTNER FLAG AT ALL, which reads backwards at first.
 * Password sign-in on this platform is restricted to official partners — src/app/api/auth/password
 * looks up `profile.seller.officialPartner` and denies everyone else (owner, 2026-08-10). Play
 * requires "reusable sign in details that don't expire", which rules out this app's ordinary
 * emailed one-time code: a reviewer has no inbox here. So the reviewer account has to pass that
 * gate, and the gate has exactly one key.
 *
 * ⚠️ THIS SCRIPT DOES NOT SET THAT FLAG, DELIBERATELY — same reason register-partner-seller.mjs
 * does not. `officialPartner` has ONE write path and keeping it that way is the design
 * (scripts/set-official-partner.mjs). That script already accepts a bare seller id, so it reaches a
 * handle-less storefront like this one without modification:
 *     node --env-file=.env scripts/set-official-partner.mjs <sellerId printed below> --apply
 *
 * ⚠️ WHAT THE FLAG COSTS HERE, so nobody is surprised later: an official partner shares no phone
 * number (phoneForSeller() returns null, the contact route answers 403 partner_chat_only) and
 * carries the gold badge wherever its storefront renders.
 *
 * ⛔ AND THE FIRST DRAFT OF THIS PARAGRAPH SAID THE BADGE WAS "INERT BECAUSE THE STOREFRONT IS
 * UNREACHABLE". THAT WAS FALSE, and the evidence was already in this repo — set-official-partner.mjs
 * says in its own header that 14 of 15 imported storefronts have no Handle and "are reached at
 * /sellers/<id>". codex refuted it (2026-09-09). Measured rather than assumed, the real exposure is:
 *   · REACHABLE — src/app/sellers/[id]/page.tsx renders this storefront at /sellers/<sellerId>,
 *     handle or no handle, and it will show the gold official-partner seal.
 *   · NOT DISCOVERABLE — src/app/sitemap.xml/route.ts:239 skips any seller absent from `sellerMax`,
 *     which is built only from live listings. This account has none, so it is never submitted.
 * So: a page at an unguessable cuid URL that nobody links to, not in the sitemap, named so a human
 * who lands on it knows what it is. Small, but NOT nothing — do not write "invisible" here again.
 *
 * ⚠️ THE ZERO-ARTIFACT ALTERNATIVE, if that exposure is ever judged too much: give the password
 * route an env-gated single-address allowlist beside the partner check, and the reviewer account
 * then needs NO Seller row at all — no storefront, no badge, nothing public. That is a change to
 * src/app/api/auth/password and therefore needs a DEPLOY, which is why it is not what this does.
 *
 * ⚠️ THE PASSWORD IS GENERATED HERE AND NEVER PRINTED. It goes to .env.play-reviewer.local
 * (gitignored by both `.env*.local` and `.env*`), mode 0600, and this script reports only the path
 * and the length. Whoever pastes it into Play Console should treat it as a live credential — and
 * SHRED IT afterwards; the success path prints the command.
 *
 * ⚠️ WHAT "NOT DISCOVERABLE" DOES AND DOES NOT MEAN, measured 2026-09-09 rather than asserted. The
 * storefront is excluded from sitemap.xml, AND there is no seller index route (`src/app/sellers`
 * holds only `[id]`), AND `/partners` is a static page with no database query, AND `officialPartner`
 * is not a browse or search facet. So the badge can surface only on this seller's own listings —
 * and this account exists to be signed into, not to sell. A reviewer seat questioned the earlier
 * one-surface version of this claim, correctly: "absent from the sitemap" is not "unreachable".
 *
 * ⚠️ THIS WRITES TO THE PRODUCTION DATABASE. eno.vn and eno.forum share one, and DIRECT_URL needs
 * the SSH tunnel to the box to be up. Dry run by default on purpose.
 *
 * REVERSAL, in this order (the FKs point this way):
 *   1. node --env-file=.env scripts/set-official-partner.mjs <sellerId> --off --apply
 *   2. delete "Seller"  where id = '<sellerId>'
 *   3. delete "Profile" where id = '<userId>'
 *   4. delete the auth user in Supabase → Authentication → Users
 *   5. shred .env.play-reviewer.local
 */
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { randomBytes, randomInt } from 'node:crypto'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const APPLY = process.argv.includes('--apply')

/**
 * ⚠️ THE ADDRESS IS ON A DOMAIN WE CONTROL AND IS NOT AN ADMIN ONE. ADMIN_EMAILS on the box is
 * support@eno.forum and nothing else; naming that address here would hand Play's reviewers the
 * admin console. Nothing is ever delivered to this mailbox either — the account is created with
 * email_confirm so it can sign in without an inbox round-trip.
 */
const REVIEWER = {
  email: 'play-review@eno.forum',
  // ⚠️ THIS NAME IS PUBLIC — it renders on /sellers/<id>, which is reachable (see the header).
  // It is written to say plainly what the account is, so a user or a reviewer who ever lands on
  // that page reads "internal" rather than mistaking it for a real merchant.
  sellerName: 'eno Play review (internal)',
  displayName: 'Play review',
}

/**
 * ⚠️ ABSOLUTE, AND CREATED EXCLUSIVELY. A relative path resolves against the CWD, so running this
 * from anywhere but the repo root would drop a live credential outside the gitignored tree. And
 * `writeFileSync(path, data, { mode })` applies the mode only when it CREATES the file — against an
 * existing file it truncates and keeps the old permissions, and against a symlink it writes through
 * to the target. The 'wx' flag below fails instead of doing either (codex, 2026-09-09).
 */
const CRED_FILE = join(
  execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(),
  '.env.play-reviewer.local',
)

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const DB = process.env.DIRECT_URL
if (!URL_ || !SECRET || !DB) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL — run with node --env-file=.env')
  process.exit(1)
}

/**
 * 24 chars from a 64-symbol alphabet ≈ 141 bits. `randomInt` is rejection-sampled by Node, so the
 * distribution is uniform — `randomBytes()[i] % n` is not, and a biased password is a smaller
 * password than it looks. No quotes, backslashes or spaces: this value gets pasted through a web
 * form and possibly a shell, and the characters that break either are not worth the entropy.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_'
function generatePassword(len = 24) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

/**
 * Find an auth user by email, paging until found. ⚠️ PAGE, DO NOT GUESS A PAGE SIZE — the same
 * bug bit register-partner-seller.mjs: `{ page: 1, perPage: 200 }` silently stops finding anyone
 * once the user table outgrows one page, which is a failure that arrives with time rather than
 * with a code change.
 */
async function findAuthUser(admin, email) {
  const want = email.toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    if (!data?.users?.length) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === want)
    if (hit) return hit
  }
  /**
   * ⚠️ RUNNING OUT OF PAGES IS NOT "NOT FOUND", AND RETURNING null CONFLATED THEM. 50 × 200 bounds
   * this at 10,000 users; past that the old code returned null, which every caller reads as "the
   * address is free" — so the collision guard would wave through a duplicate and the round-4
   * recovery would report "no account was created" without having looked at the whole table.
   * Throwing makes the caller treat it as UNKNOWN, which is what it is (codex, round 5).
   */
  throw new Error('listUsers: exhausted 50 pages (10,000 users) without a conclusive answer')
}

/**
 * ⚠️ FAIL FAST, BEFORE ANYTHING EXISTS. `wx` inside the run already refuses to clobber this file,
 * but by then a production auth user has been created and has to be compensated away. Checking
 * here means the ordinary "a previous run left the file behind" case costs nothing and touches
 * nothing. The `wx` flag stays as the backstop for the race and the permission failures this
 * check cannot see — a pre-check is not a guarantee, it is a courtesy.
 */
if (existsSync(CRED_FILE)) {
  console.error(`${CRED_FILE} already exists.`)
  console.error('A previous run wrote it. Follow the REVERSAL block in the header, shred the file, then re-run.')
  process.exit(1)
}

const admin = createClient(URL_, SECRET, { auth: { autoRefreshToken: false, persistSession: false } })
const c = new Client({ connectionString: DB })
await c.connect()

try {
  /**
   * ⚠️ REFUSE ON ANY COLLISION — NEVER ADOPT. register-partner-seller.mjs has an --adopt path
   * because a partner may genuinely already hold an account at their own address. Nothing owns
   * play-review@eno.forum but this script, so an existing row means something unexpected happened
   * and the safe move is to stop rather than to reset a stranger's password.
   */
  const profileTaken = await c.query(`select id, email from "Profile" where email = $1`, [REVIEWER.email])
  if (profileTaken.rows.length) {
    console.error(`A Profile already exists for ${REVIEWER.email} (${profileTaken.rows[0].id}).`)
    console.error('If that is a previous run of this script, follow the REVERSAL block in the header first.')
    process.exitCode = 1
  } else {
    const sellerTaken = await c.query(`select id, name from "Seller" where name = $1`, [REVIEWER.sellerName])
    if (sellerTaken.rows.length) {
      console.error(`A Seller named "${REVIEWER.sellerName}" already exists (${sellerTaken.rows[0].id}).`)
      process.exitCode = 1
    } else {
      // Supabase auth and Profile are different systems: an auth-only row (a signup that never
      // finished) sails past the Profile check above, so ask auth itself as well.
      const existingAuth = await findAuthUser(admin, REVIEWER.email)
      if (existingAuth) {
        console.error(`An auth user already exists for ${REVIEWER.email} (${existingAuth.id}, created ${existingAuth.created_at}).`)
        console.error('Delete it in Supabase → Authentication → Users, or follow the REVERSAL block, then re-run.')
        process.exitCode = 1
      } else {
        console.log(`${APPLY ? 'WRITING' : 'DRY RUN — would write'}:`)
        console.log(`  auth user : ${REVIEWER.email}   (password generated here, written to ${CRED_FILE}, never printed)`)
        console.log(`  Profile   : accountType=individual, displayName=${REVIEWER.displayName}`)
        console.log(`  Seller    : name="${REVIEWER.sellerName}", no handle, no phone, verified=false, verifiedSeller=false`)
        console.log(`  Handle    : NONE — but /sellers/<id> still renders it; see the header for the real exposure`)
        console.log(`  officialPartner: NOT set here — run set-official-partner.mjs <sellerId> --apply`)

        if (!APPLY) {
          console.log('\nDRY RUN. Re-run with --apply to write.')
        } else {
          const password = generatePassword()

          // 1. Auth user. email_confirm so it can sign in with no inbox round-trip.
          /**
           * ⚠️ THE ONE FAILURE NO ORDERING CAN PREVENT: createUser can SUCCEED on Supabase's side
           * and still fail here, because the response was lost. There is no atomic
           * create-and-learn-the-id, so the account can exist while this process believes it does
           * not — and the password, which lives only in memory until the write below, dies with
           * the run. Left alone that is a permanent orphan: every later run refuses because
           * findAuthUser() sees the account nobody holds a password for (codex, round 4,
           * 2026-09-09).
           *
           * It cannot be made atomic. It CAN be made recoverable: on any failure, ask auth whether
           * the user actually landed, and delete it if so. That converts "orphaned forever, fix it
           * by hand in the dashboard" into "cleaned up, run it again".
           */
          let userId
          try {
            const created = await admin.auth.admin.createUser({
              email: REVIEWER.email,
              password,
              email_confirm: true,
            })
            if (created.error) throw new Error(created.error.message)
            userId = created.data.user.id
          } catch (createErr) {
            /**
             * ⚠️ "THE LOOKUP FAILED" AND "THERE IS NO ACCOUNT" ARE DIFFERENT ANSWERS, and the
             * first draft swallowed the former and then printed the latter — telling the operator
             * nothing was created when it had never established that. Track the failure (codex,
             * round 5, 2026-09-09).
             */
            let stray = null
            let lookupFailed = false
            try {
              stray = await findAuthUser(admin, REVIEWER.email)
            } catch {
              lookupFailed = true
            }
            if (stray) {
              let delErr = null
              try {
                delErr = (await admin.auth.admin.deleteUser(stray.id)).error
              } catch (e) {
                delErr = e
              }
              if (delErr) {
                // ⚠️ A REJECTED delete IS NOT A FAILED delete — the same lost-response ambiguity
                // as createUser, so do not assert the account is still there (codex, round 6).
                console.error(`\n⛔ createUser reported a failure, the account exists (${stray.id}), and the`)
                console.error(`   cleanup delete gave no clear answer: ${delErr.message}`)
                console.error(`   Open Supabase → Authentication → Users, search ${REVIEWER.email}, and delete it`)
                console.error(`   ONLY IF IT IS STILL THERE. Then re-run.`)
              } else {
                console.error(`\n⛔ createUser reported a failure but HAD created ${stray.id} — deleted it. Re-run.`)
              }
            } else if (lookupFailed) {
              console.error(`\n⛔ createUser failed AND the follow-up lookup failed, so whether the account`)
              console.error(`   was created is UNKNOWN. Before re-running, open Supabase → Authentication →`)
              console.error(`   Users, search ${REVIEWER.email}, and DELETE it if it is there — if it exists,`)
              console.error(`   its password was generated in memory and is gone.`)
            } else {
              console.error(`\n⛔ createUser failed and no account was created. Nothing to clean up; re-run.`)
            }
            throw new Error(`createUser failed: ${createErr.message}`)
          }

          console.log(`\n  ✓ auth user ${userId}`)

          /**
           * ⚠️ SUPABASE AUTH AND POSTGRES CANNOT SHARE A TRANSACTION, so a failure below would
           * otherwise strand an auth user with no Profile — the exact half-created state whose
           * only symptom is that THIS SCRIPT REFUSES TO RUN AGAIN ("an auth user already exists"),
           * handing the next operator a manual cleanup in the Supabase dashboard. codex enumerated
           * the states (2026-09-09). So compensate: delete the auth user we just made, and say so.
           * The two INSERTs share one DB transaction, so they are all-or-nothing between them.
           *
           * ⛔ THE CREDENTIAL WRITE IS INSIDE THIS try, AND THE FIRST FIX PUT IT OUTSIDE. `wx` was
           * added so the write cannot clobber a file or follow a symlink — but sitting above the
           * try, its throw skipped the compensation entirely and left exactly the orphaned auth
           * user this block exists to prevent, with the password gone. codex caught the fix's own
           * regression (2026-09-09). A guard that turns a silent overwrite into a hard failure has
           * to be inside the handler for that failure.
           */
          let sellerId
          try {
            // Written BEFORE the rows: the account is already real by this line and its password
            // is the one thing that cannot be re-derived. Rows can be rebuilt; a generated secret
            // cannot. `wx` fails rather than truncating an existing file or writing through a
            // symlink — see CRED_FILE above.
            writeFileSync(
              CRED_FILE,
              `# Google Play Console → App content → Sign in details\n` +
                `# Created ${new Date().toISOString()} by scripts/register-play-reviewer.mjs\n` +
                `# Paste these into the Play form. Treat as a live credential; rotate if it leaks.\n` +
                `PLAY_REVIEWER_EMAIL=${REVIEWER.email}\n` +
                `PLAY_REVIEWER_PASSWORD=${password}\n`,
              { mode: 0o600, flag: 'wx' },
            )
            console.log(`  ✓ credentials written to ${CRED_FILE} (${password.length} chars, not printed)`)
            await c.query('begin')
            // 2. Profile. `id` IS the auth user id — the cross-schema FK profile_auth_fk enforces
            //    it. The email is mirrored in lowercase because the password route's partner
            //    lookup is an EXACT string match against this column: a differing case denies
            //    silently, which is the failure mode with no log line.
            /**
             * ⚠️ `"updatedAt"` IS SUPPLIED BY HAND AND IS NOT OPTIONAL. Prisma's `@updatedAt` is a
             * CLIENT-side behaviour, not a DB default — the column is NOT NULL with no default, so
             * a raw INSERT that omits it fails with `null value in column "updatedAt" ... violates
             * not-null constraint`. That is exactly how the first --apply run died (2026-09-09);
             * six rounds of review never saw it because the reviewers were given this script and
             * not the schema. `createdAt` DOES carry `@default(now())`, so it is left alone.
             * Measured against information_schema: the only NOT NULL columns without a default are
             * Profile.id, Profile.updatedAt, Seller.id and Seller.name — all four are set here.
             * register-partner-seller.mjs:239 has always passed "updatedAt" for the same reason.
             */
            await c.query(
              `insert into "Profile" (id, email, "displayName", "accountType", "updatedAt")
               values ($1, $2, $3, 'individual', now())`,
              [userId, REVIEWER.email.toLowerCase(), REVIEWER.displayName],
            )
            /**
             * 3. Seller. cuid() is a Prisma-side default, so a raw INSERT must supply the id.
             * ⚠️ THIS IS cuid-SHAPED, NOT A cuid — 96 random bits with a 'c' prefix, so collision
             * risk is nil but it carries none of cuid v1's embedded timestamp or counter. Nothing
             * in this repo parses a Seller id (they are opaque strings in URLs and FKs), and
             * register-partner-seller.mjs mints ids the same way, so the shape is consistent with
             * what production already holds. If anything ever starts DECODING a cuid, revisit.
             */
            sellerId = 'c' + randomBytes(12).toString('hex')
            await c.query(`insert into "Seller" (id, "ownerId", name) values ($1, $2, $3)`, [
              sellerId,
              userId,
              REVIEWER.sellerName,
            ])
            await c.query('commit')
          } catch (stepErr) {
            await c.query('rollback').catch(() => {})
            /**
             * ⚠️ THE COMPENSATION ITSELF MUST NOT THROW. deleteUser() reports most problems as
             * `{ error }`, but a transport failure REJECTS — and an unguarded reject here would
             * exit the handler before either cleanup message printed, orphan the auth user
             * anyway, and replace the real `stepErr` with a network error in the output. A
             * compensating action that can fail the same way as the thing it compensates for is
             * not compensation (codex, round 3, 2026-09-09).
             */
            let delError = null
            try {
              delError = (await admin.auth.admin.deleteUser(userId)).error
            } catch (e) {
              delError = e
            }
            if (delError) {
              /**
               * ⚠️ THE MOST LIKELY REASON THE DELETE FAILS IS THAT THE ROWS COMMITTED. If COMMIT
               * succeeded server-side but reported an error, Profile still references this auth
               * user and the FK refuses the deletion — so the run actually SUCCEEDED and only the
               * bookkeeping is confused. Say both possibilities out loud rather than guessing:
               * an operator who reads "check whether the rows exist" does the right thing either
               * way, and one who reads "it failed" might delete a good account.
               */
              console.error(`\n⛔ Step failed and the cleanup delete gave no clear answer: ${delError.message}`)
              console.error(`   Nothing below is asserted — CHECK, then act:`)
              console.error(`   1. Does a Profile exist for ${userId}? If yes, the inserts DID commit, the run`)
              console.error(`      actually succeeded, and you should carry on with set-official-partner.mjs.`)
              console.error(`   2. If no Profile exists, look for ${REVIEWER.email} in Supabase → Authentication →`)
              console.error(`      Users and delete it ONLY IF IT IS STILL THERE — the delete may already have`)
              console.error(`      landed and lost its response.`)
              console.error(`   3. Shred ${CRED_FILE} if it exists, then re-run.`)
            } else {
              console.error(`\n⛔ Step failed — rolled back, and auth user ${userId} was deleted.`)
              console.error(`   Shred ${CRED_FILE} if it exists (its password is dead) and re-run.`)
            }
            throw stepErr
          }
          console.log(`  ✓ Profile ${userId}`)
          console.log(`  ✓ Seller ${sellerId}`)

          console.log(`\nDone. The account CANNOT sign in yet — grant the flag the gate reads:`)
          console.log(`  node --env-file=.env scripts/set-official-partner.mjs ${sellerId} --apply`)
          /**
           * ⛔ AND SHRED THE CREDENTIAL WHEN IT HAS BEEN PASTED. Every FAILURE branch above says so;
           * the SUCCESS branch used to print the path and stop, leaving a live reusable password for
           * a partner-gated account sitting at repo root indefinitely, protected by a gitignore this
           * script asserts in a comment (the Opus seat, 2026-09-09). The one path that ends with a
           * WORKING password is the one that most needed the instruction.
           */
          console.log(`\n⛔ Then paste the password into Play Console and destroy the local copy:`)
          console.log(`     shred -u ${CRED_FILE}   # or: rm -P ${CRED_FILE}  (macOS)`)
          console.log(`   It is a live credential for an account that passes the partner gate. Do not`)
          console.log(`   leave it in the working tree, and do not copy it into a note or a chat.`)
        }
      }
    }
  }
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
