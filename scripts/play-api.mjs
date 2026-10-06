/**
 * GOOGLE PLAY DEVELOPER API (Android Publisher v3) — the scriptable half of a Play release.
 *
 *   node scripts/play-api.mjs status                 # what Play thinks the app is, read-only
 *   node scripts/play-api.mjs listing                # read the current store listing
 *   node scripts/play-api.mjs listing --apply        # write it from PLAY_LISTING below
 *   node scripts/play-api.mjs tracks                 # releases per track
 *   node scripts/play-api.mjs details [--apply]      # the required contact fields
 *   node scripts/play-api.mjs signing <versionCode>  # the PLAY APP SIGNING SHA-256, for assetlinks
 *   node scripts/play-api.mjs release <app.aab> [--track production] [--notes <file>] [--with-listing --shots <dir>] [--apply]
 *                                                   # ⛔ WITH --apply THIS PUBLISHES TO USERS: bundle + track
 *                                                   # release; with --with-listing ALSO the app-wide listing and
 *                                                   # every phone screenshot, in the same edit.
 *
 * ⚠️ EVEN THE READ COMMANDS OPEN A SERVER-SIDE EDIT, because `details`, `listings` and `tracks` are
 * only readable inside one — that is the API's shape, not a choice here. Each run deletes its edit
 * on the way out and shouts if it cannot.
 *
 * ⛔ NO KEY FILE, AND THAT IS NOT A STYLE CHOICE. The classic Play API recipe downloads a service
 * account JSON key; this project's GCP org forbids that outright
 * (`constraints/iam.disableServiceAccountKeyCreation`), and it is right to. Instead the caller's own
 * gcloud login IMPERSONATES the service account for a short-lived token — `support@eno.forum` holds
 * roles/iam.serviceAccountTokenCreator on it. Nothing secret is ever written to disk, so nothing can
 * leak from a repo that is public.
 *
 * ⚠️ WHAT THIS API CANNOT DO, so nobody goes looking. Measured 2026-09-09 against the LIVE
 * discovery doc (`androidpublisher.googleapis.com/$discovery/rest?version=v3`), not from memory:
 *   · Data safety            — ⚠️ CORRECTED: this line used to say "Console only" and it is WRONG.
 *     `POST applications/{package}/dataSafety` exists (SafetyLabelsUpdateRequest) and takes the
 *     Console's own Data-safety CSV as one string. It is a WRITE with no read counterpart, so the
 *     round-trip is Console Export-to-CSV → edit → this endpoint. Not implemented here yet.
 *   · Content rating         — Console only (it is a questionnaire, not a resource).
 *   · Sign in details, Target audience, ads, financial features, government apps, health,
 *     advertising ID, APP CATEGORY — Console only, no endpoint at any of them. `edits.details`
 *     covers ONLY contactEmail / contactPhone / contactWebsite / defaultLanguage; the store
 *     category is not in AppDetails and cannot be set from here.
 *   · INDIVIDUAL tester emails — the API's `testers` resource takes Google GROUPS, not addresses.
 *     A raw email list is Console-only. Point a group at it once and this becomes scriptable.
 * WHAT THIS SCRIPT IMPLEMENTS TODAY: reading app details (`status`), reading tracks and their
 * releases (`tracks`), reading/writing the en-US store listing (`listing`), and the whole release —
 * AAB upload, track release with notes, listing and phone screenshots — in ONE edit (`release`).
 *
 * ⛔ THE IMAGE ENDPOINTS LIVE UNDER `listings/`, NOT `images/`, AND GUESSING COSTS A ROLLED-BACK
 * RELEASE. `edits.images.upload/deleteall` are addressed as
 * `/edits/{id}/listings/{language}/{imageType}` — the resource is called images, the path says
 * listings. A run on 2026-09-14 uploaded the bundle, wrote the track and the listing, then took an
 * HTML 404 from `/edits/{id}/images/...` and discarded the edit, undoing all three. Read the live
 * discovery doc for a path rather than inferring it from the resource name:
 *   curl -s 'https://androidpublisher.googleapis.com/$discovery/rest?version=v3'
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'

/**
 * ⚠️ THE PLAY PACKAGE NAME. Google Play bound the app entry to this identifier before the first upload and it
 * cannot be changed — a package name is a string, not a destination. Since versionCode 5 / 1.0.3 it also matches
 * the site the app renders: capacitor.config.ts server.url is `https://eno.vn` again (owner, 2026-10-06: "ship
 * both with eno.vn"). versionCode 1–4 loaded `https://www.eno.forum`, which is why the listing used to sell e-Visas.
 */
const PACKAGE = 'eno.vn'
const SA = 'play-publisher@speedy-victory-500106-h8.iam.gserviceaccount.com'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3'
const APPLY = process.argv.includes('--apply')
const cmd = process.argv[2]
/**
 * `--track production` → "production". A flag that is PRESENT WITH NO VALUE is an error, never a default: `--track
 * --apply` used to read as "no track given" and fall through to a full production rollout, which is the opposite of
 * what someone who typed `--track` meant (astra, agy).
 */
const argValue = (flag) => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return null
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) { console.error(`⛔ ${flag} needs a value`); process.exit(1) }
  return v
}

/**
 * What the user reads on the Play update card, for THIS build (1.0.1 / versionCode 3). Play's cap is 500 characters
 * per language, and notes cannot be edited afterwards without a new edit and rollout.
 * ⚠️ A LATER RELEASE MUST NOT INHERIT THESE. They describe one build; `--notes <file>` is how the next one carries its
 * own, and `release` refuses to publish these to any versionCode but 3 (opus: the second person to run the command
 * would have shipped correct bytes with 1.0.1's changelog).
 */
const NOTES_VERSION_CODE = 3
const RELEASE_NOTES = `• New app icon — the full eno mark, at every launcher size
• Now called Eno Marketplace, so it is easy to find
• Smoother, quieter haptics across the app
• Swipe down or sideways to close any panel or photo viewer
• Share sheet closes with a swipe or a tap outside
• Bottom navigation icons refreshed`

/** The listing copy, counted against Play's limits. Single source — edit here, not in the Console. */
/**
 * ⛔ SINCE 2026-10-06 THE APP RENDERS eno.vn (owner: "ship both with eno.vn"), THE LICENSED MARKETPLACE — so the
 * listing describes the marketplace, and eno's OWN e-Visa desk and trip planning (eno.forum only) are gone from it.
 * ⛔ e-VISA HELP IS STILL IN THE APP, AS A PARTNER'S SERVICE (owner, 2026-10-06: "have evisa application flow in the
 * app via eno.vn … send to vietkite via message … only passport photo and 3x4 portrait image"): VietKite, a travel company
 * selling on eno, takes the application in its own chat. ⛔ NO "licensed" until the owner confirms VietKite's licence and
 * the signed agreement are on file (2026-10-06 plan, question B3). The section names VietKite as the provider and keeps the
 * two things Play REJECTED the app without on 2026-09-10 (Misleading Claims policy): an easy-to-see statement that eno
 * is not a government entity, and the official, functional source https://evisa.gov.vn. `assertGovernmentDisclosure`
 * refuses to publish any listing that mentions an e-Visa without both — do not trim either for length.
 * ⛔ VERIFY evisa.gov.vn IN A BROWSER, NEVER WITH curl: it refuses non-browser clients (exit 000 reads like a dead
 * host). The superseded portal evisa.xuatnhapcanh.gov.vn itself points to evisa.gov.vn since 11/11/2024.
 * ⚠️ Claims are the verified store text of docs/ios-appstore-release.md Appendix A (2026-10-06 audit): no "every seller
 * carries a trust score" (retired 2026-10-04), chat and offers only on items posted directly on eno.
 * ⚠️ Editing this text changes nothing in the store until `listing --apply` / `release … --apply` runs — the OWNER'S
 * call, and the owner approves this copy first.
 */
const PLAY_LISTING = {
  language: 'en-US',
  /** "Eno Marketplace" — the owner's name for the app (2026-09-14), matching the App Store record. */
  title: 'Eno Marketplace',
  shortDescription: 'Rentals, jobs and second-hand deals in Vietnam, in English and Tiếng Việt.',
  fullDescription: `eno is the app for expats, newcomers and locals in Vietnam: find a place to rent, a motorbike for the month, a job, or a good second-hand deal, and talk to the other side directly.

RENT
• Apartments, houses, rooms and offices, with photos, size, bedrooms and the ward on a map
• Motorbike and scooter rentals from local shops, and self-drive cars from car-rental platforms

WORK
• Jobs in Vietnam, including English-teaching roles in cities across the country

BUY AND SELL USED
• Second-hand phones, laptops and cameras from local shops
• Furniture and home appliances
• Post a listing with photos from your phone in a minute. No listing fees.

VIETNAM e-VISA HELP FROM A SELLER — NOT A GOVERNMENT SERVICE
eno is a marketplace run by Eno Company Limited. It is not a government agency and is not affiliated with, endorsed by or acting for the Government of Vietnam, the Ministry of Public Security or the Vietnam Immigration Department. e-Visa help in the app is sold and provided by VietKite, a Vietnamese travel company selling on eno: message them from their listing and send the two photos they need, your passport data page and a 3x4 portrait, after a quick automatic check in the app. VietKite prepares and files the application and agrees its fee with you in the chat; eno takes no payment for it.
Official source: https://evisa.gov.vn is the only place a Vietnam e-Visa is issued, and you can always apply there yourself. Approval, refusal and processing time are decided only by the Vietnamese authorities.

BUILT FOR TRUST
Trust scores are built from completed deals, reviews and confirmed reports, not stars alone. Every listing and seller has a Report button, and reports are reviewed by a person. Nobody can pay to rank higher, and listings that earn eno a commission are labelled Ad.

CLEAR PRICES
Prices are in Vietnamese đồng with a US dollar reference. On items posted directly on eno, make an offer in the chat and agree the deal with the seller. eno never takes payment for marketplace items.

YOUR LANGUAGE
The app works in English and Tiếng Việt, and listings can be read in nine more languages.

You must be 18 or older to use eno. Terms: https://eno.vn/terms · Privacy: https://eno.vn/privacy`,
}

/**
 * Play's 2026-09-10 rejection, as a check: a listing that mentions an e-Visa must say eno is not a government agency
 * and name the official portal. Run before anything is written to Play.
 */
function assertGovernmentDisclosure(listing) {
  const text = `${listing.title}\n${listing.shortDescription}\n${listing.fullDescription}`
  if (!/e-?visa|thị thực/i.test(text)) return
  if (!/not a government agency/i.test(text) || !text.includes('https://evisa.gov.vn')) {
    console.error('⛔ the listing mentions an e-Visa without "not a government agency" and https://evisa.gov.vn (Play, 2026-09-10)')
    process.exit(1)
  }
}

/**
 * The developer contact Play REQUIRES on the listing. It is published to users, so it is the EDITION'S OWN
 * address — and since 2026-10-06 the app renders eno.vn, the licensed marketplace, whose site publishes
 * support@eno.vn (/contact and the footer; measured 2026-10-06). That address is a Cloudflare redirect
 * into the support@eno.forum mailbox (src/lib/email-alias.ts), so who reads the mail does not change — only which
 * operator the listing names. Until 2026-10-06 this was support@eno.forum / https://www.eno.forum, the edition
 * the app rendered then. ⚠️ Nothing changes in Play until `details --apply` runs (the owner's call).
 */
const PLAY_DETAILS = { contactEmail: 'support@eno.vn', contactWebsite: 'https://eno.vn' }

// Play's hard limits. Checked HERE rather than discovered at the API, because the API's error for an
// over-long field names the field and not the limit, and the old hand-written listing was 86/80.
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 }

function token() {
  try {
    /**
     * ⚠️ THE SCOPE IS EXPLICIT, AND WITHOUT IT EVERY CALL IS A 403 "insufficient authentication
     * scopes" THAT LOOKS LIKE A PERMISSIONS PROBLEM. `print-access-token` defaults to
     * cloud-platform, which does not cover Android Publisher — a different API family entirely.
     */
    return execFileSync('gcloud', ['auth', 'print-access-token', `--impersonate-service-account=${SA}`,
      '--scopes=https://www.googleapis.com/auth/androidpublisher'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    /**
     * ⛔ THROW, NEVER process.exit(). This runs inside withEdit's try: exiting here would skip the
     * catch that DELETES the open edit, so a transient auth failure mid-run would leave an
     * abandoned edit behind — the exact collision this file warns about. A reviewer caught it.
     */
    throw new Error(
      `Could not mint a token by impersonating ${SA}.\n` +
      `Check: gcloud auth list (support@eno.forum active), and that it holds\n` +
      `roles/iam.serviceAccountTokenCreator on that service account.`)
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/applications/${PACKAGE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300)
    /**
     * ⚠️ THE 401 HERE ALMOST NEVER MEANS THE TOKEN IS WRONG. It means the service account has not
     * been INVITED into Play Console — that link is made in the Console (Users and permissions),
     * cannot be made from GCP, and is the one step of this setup nobody can script.
     */
    if (res.status === 401 || res.status === 403) {
      console.error(`\n⛔ ${res.status} from Play, and it is almost never the token.`)
      console.error(`   "insufficient authentication scopes" => the scope above is missing (a 403 too).`)
      console.error(`   "caller does not have permission" / 401 => the service account is not INVITED:`)
      console.error(`     Play Console -> Users and permissions -> Invite user`)
      console.error(`     Email: ${SA}`)
      console.error(`     Grant on the app: view app information, edit store listing, manage releases.`)
      console.error(`   That link is made in the Console, cannot be made from GCP, and is the one step`)
      console.error(`   of this setup that nobody can script.`)
    }
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`)
  }
  return json
}

/**
 * A MEDIA UPLOAD IS A DIFFERENT HOST PREFIX, NOT A DIFFERENT API — `/upload/androidpublisher/v3/...`, with the file as
 * the raw body. The JSON `api()` above cannot be reused: it sets a JSON content type and stringifies, and either one
 * corrupts a bundle. `uploadType=media` is the simple form; Play accepts it well past the 7MB this app's AAB weighs.
 */
async function upload(path, { file, contentType }) {
  const body = readFileSync(file)
  const res = await fetch(`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}${path}?uploadType=media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': contentType, 'Content-Length': String(body.length) },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`upload ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/** An edit is a transaction: everything is staged against one id and only :commit makes it real. */
async function withEdit(fn) {
  const edit = await api('/edits', { method: 'POST' })
  try {
    const out = await fn(edit.id)
    if (!APPLY) {
      // ⚠️ DELETE, NOT just "don't commit" — an abandoned edit stays open and the next run's
      // creation can collide with it. And a FAILED delete is reported rather than swallowed: the
      // old `.catch(() => {})` printed "nothing was committed" while leaving an edit open, which is
      // the one state this cleanup exists to prevent.
      await discard(edit.id)
      console.log('\nDRY RUN — nothing was committed. Re-run with --apply.')
      return out
    }
    await api(`/edits/${edit.id}:commit`, { method: 'POST' })
    console.log('\nCOMMITTED.')
    return out
  } catch (e) {
    await discard(edit.id)
    throw e
  }
}

/** Delete an edit, and SAY SO if it could not be deleted — a silent failure leaves it open. */
async function discard(id) {
  try {
    await api(`/edits/${id}`, { method: 'DELETE' })
  } catch (e) {
    console.error(`⚠️  could not discard edit ${id}: ${e.message}`)
    console.error(`   It stays open server-side and may collide with the next run. Delete it with:`)
    console.error(`   DELETE ${API}/applications/${PACKAGE}/edits/${id}`)
  }
}

async function main() {
  if (cmd === 'status') {
    await withEdit(async (id) => {
      const details = await api(`/edits/${id}/details`)
      console.log(`package         ${PACKAGE}`)
      console.log(`default language ${details.defaultLanguage}`)
      console.log(`contact email    ${details.contactEmail || '(unset)'}`)
      console.log(`contact website  ${details.contactWebsite || '(unset)'}`)
      const langs = await api(`/edits/${id}/listings`)
      console.log(`listings         ${(langs.listings || []).map((l) => l.language).join(', ') || '(none)'}`)
    })
    return
  }

  /**
   * ⛔ THE FINGERPRINT App Links ACTUALLY NEED, AND IT IS NOT THE UPLOAD KEY. With Play App Signing
   * Google strips the upload signature and re-signs every generated APK with THEIR key, so the
   * certificate on a downloaded app matches neither the debug key nor the upload key. Until this
   * hash is in assetlinks.json, verified App Links fail for 100% of Play installs — silently, with
   * no error anywhere; the feature is simply absent.
   *
   * ⚠️ IT IS AVAILABLE OVER THE API, which the release doc did not know: it told the owner to hunt
   * for it in Play Console under App integrity. `generatedApks` reports it per signing key for a
   * given versionCode, so this is one command instead of a click path that changes with the Console.
   */
  if (cmd === 'signing') {
    const versionCode = process.argv[3]
    if (!versionCode) { console.error('usage: signing <versionCode>   e.g. signing 1'); process.exit(1) }
    const res = await fetch(`${API}/applications/${PACKAGE}/generatedApks/${versionCode}`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
    if (!res.ok) { console.error(`${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1) }
    const { generatedApks = [] } = await res.json()
    if (!generatedApks.length) {
      // A versionCode that was uploaded but never had APKs generated for a track reports nothing.
      console.error(`No generated APKs for versionCode ${versionCode} — has it been released to a track?`)
      process.exit(1)
    }
    for (const g of generatedApks) console.log(g.certificateSha256Hash)
    console.error(`\nFeed it to the assetlinks writer together with the UPLOAD key, because the second`)
    console.error(`argument REPLACES the file rather than appending to it:`)
    console.error(`  node scripts/android-assetlinks.mjs <the hash above> <upload key sha256>`)
    console.error(`Then DEPLOY — the file reaches users only through infra/vn-node/eno-deploy.sh.`)
    return
  }

  if (cmd === 'details') {
    await withEdit(async (id) => {
      const before = await api(`/edits/${id}/details`)
      console.log(`  contactEmail   ${before.contactEmail || '(unset)'}  ->  ${PLAY_DETAILS.contactEmail}`)
      console.log(`  contactWebsite ${before.contactWebsite || '(unset)'}  ->  ${PLAY_DETAILS.contactWebsite}`)
      if (!APPLY) return
      // PATCH, not PUT: defaultLanguage is set and must not be cleared by an omitted field.
      await api(`/edits/${id}/details`, { method: 'PATCH', body: PLAY_DETAILS })
      console.log('  wrote contact details')
    })
    return
  }

  if (cmd === 'tracks') {
    await withEdit(async (id) => {
      const { tracks = [] } = await api(`/edits/${id}/tracks`)
      for (const t of tracks) {
        const rels = (t.releases || []).map((r) => `${r.status} v${(r.versionCodes || []).join(',')}`).join(' | ')
        console.log(`  ${t.track.padEnd(18)} ${rels || '(no releases)'}`)
      }
    })
    return
  }

  if (cmd === 'listing') {
    assertGovernmentDisclosure(PLAY_LISTING)
    for (const [k, max] of Object.entries(LIMITS)) {
      const n = PLAY_LISTING[k].length
      if (n > max) { console.error(`⛔ ${k} is ${n} chars, limit ${max}`); process.exit(1) }
      console.log(`  ${k.padEnd(16)} ${String(n).padStart(4)}/${max}`)
    }
    await withEdit(async (id) => {
      /**
       * ⚠️ ONLY A 404 MEANS "no listing yet". The first cut caught EVERY error as absence, so an
       * auth failure or a 5xx printed "(none set)" and then --apply overwrote a listing it had
       * never actually read.
       */
      let current = null
      try {
        current = await api(`/edits/${id}/listings/${PLAY_LISTING.language}`)
      } catch (e) {
        if (!/-> 404:/.test(e.message)) throw e
      }
      console.log(`\ncurrent title: ${current ? current.title : '(none set)'}`)
      if (!APPLY) return
      await api(`/edits/${id}/listings/${PLAY_LISTING.language}`, { method: 'PUT', body: PLAY_LISTING })
      console.log(`wrote listing for ${PLAY_LISTING.language}`)
    })
    return
  }

  /**
   * THE WHOLE RELEASE IN ONE EDIT — bundle, track, listing, screenshots — because an edit is a transaction and these
   * four belong together: a store listing that promises a new icon while the bundle carrying it sits in a separate,
   * uncommitted edit is the half-shipped state this command exists to make impossible.
   *
   *   node scripts/play-api.mjs release <app.aab> [--track production] [--shots <dir>] [--apply]
   *
   * ⛔ WITH --apply THIS PUBLISHES TO USERS. `status: completed` is a FULL rollout of the named track, which for
   * `production` means every install. That is the owner's call, never this script's default behaviour — it is a dry run
   * until someone types --apply.
   */
  if (cmd === 'release') {
    const usage = 'usage: release <path/to/app.aab> [--track production] [--notes <file>] [--with-listing --shots <dir> | --keep-listing] [--apply]'
    /**
     * ⛔ THE LISTING AND THE SCREENSHOTS ARE APP-WIDE, NOT PER TRACK (2026-10-06). A release to `internal` that also PUTs
     * the listing changes the PUBLIC store page for every production user once Play reviews it — while production may
     * still run the previous build (until 2026-10-06: v4 on www.eno.forum with eno's own e-Visa desk). That mismatch is
     * the Misleading-Claims class behind the 2026-09-10 rejection. So a release touches them only when asked:
     * `--with-listing` (normally at the production promotion, after re-capturing the screenshots on the live site
     * with play-capture.mjs + play-frames.mjs and a person looking at every image).
     */
    const withListing = process.argv.includes('--with-listing')
    // ⛔ …AND A PRODUCTION RELEASE MAY NOT SILENTLY KEEP THE OLD PAGE (review 2026-10-06): versionCode 5 renders eno.vn,
    // so promoting it while the public listing still describes the forum-era app is the same mismatch the other way.
    // Production therefore says which it means: --with-listing (the normal promotion) or --keep-listing (a build whose
    // listing really has not changed).
    const keepListing = process.argv.includes('--keep-listing')
    const aab = process.argv[3]
    const trackFlag = argValue('--track')
    const track = trackFlag || 'production'
    const shotsDir = argValue('--shots') || 'play-store-assets/phone/en'
    const notesFile = argValue('--notes')
    if (!aab || aab.startsWith('--') || !aab.endsWith('.aab')) { console.error(usage); process.exit(1) }
    if (!statSync(aab, { throwIfNoEntry: false })) { console.error(`⛔ no bundle at ${aab}`); process.exit(1) }
    /**
     * ⛔ A FULL PRODUCTION ROLLOUT IS NEVER SOMETHING YOU GET BY TYPING NOTHING (opus). `production` stays the default
     * for the dry run, so `release app.aab` prints the plan people actually want to see — but publishing it demands
     * that the caller name the track out loud.
     */
    if (APPLY && !trackFlag) { console.error(`⛔ --apply to ${track} requires naming it: --track ${track}\n   ${usage}`); process.exit(1) }
    if (withListing && keepListing) { console.error(`⛔ --with-listing and --keep-listing contradict each other — pick one\n   ${usage}`); process.exit(1) }
    if (APPLY && track === 'production' && !withListing && !keepListing) { console.error(`⛔ a production release must either update the app-wide listing (--with-listing --shots <fresh set>) or say --keep-listing\n   ${usage}`); process.exit(1) }
    if (withListing && !argValue('--shots')) { console.error(`⛔ --with-listing replaces every phone screenshot: name the freshly captured set with --shots <dir>\n   ${usage}`); process.exit(1) }
    if (withListing && !statSync(shotsDir, { throwIfNoEntry: false })?.isDirectory()) { console.error(`⛔ no screenshot directory at ${shotsDir}`); process.exit(1) }
    // Sorted by filename: the order they are uploaded in is the order Play shows them, and 01-…04- is the story order.
    const shots = withListing ? readdirSync(shotsDir).filter((f) => f.endsWith('.png')).sort().map((f) => `${shotsDir}/${f}`) : []
    // Play's own bounds for a phone listing: at least 2, at most 8. The MAXIMUM is checked here rather than discovered
    // at the ninth upload, which would be after the delete-all has already emptied the live set (astra, agy).
    if (withListing && (shots.length < 2 || shots.length > 8)) { console.error(`⛔ ${shotsDir} holds ${shots.length} PNG(s); Play takes 2 to 8 phone screenshots`); process.exit(1) }
    const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : RELEASE_NOTES
    if (notes.length > 500) { console.error(`⛔ release notes are ${notes.length} chars, limit 500`); process.exit(1) }
    assertGovernmentDisclosure(PLAY_LISTING)
    for (const [k, max] of Object.entries(LIMITS)) {
      const n = PLAY_LISTING[k].length
      if (n > max) { console.error(`⛔ ${k} is ${n} chars, limit ${max}`); process.exit(1) }
    }
    console.log(`bundle       ${aab} (${(statSync(aab).size / 1e6).toFixed(1)} MB)`)
    console.log(`track        ${track} — status "completed" (full rollout)`)
    console.log(withListing ? `listing      "${PLAY_LISTING.title}" — APP-WIDE, public once reviewed` : 'listing      untouched (add --with-listing at the production promotion)')
    console.log(withListing ? `screenshots  ${shots.length} file(s), replacing every phone screenshot on ${PLAY_LISTING.language}` : 'screenshots  untouched')
    console.log(`notes        ${notesFile || `built in (versionCode ${NOTES_VERSION_CODE} only)`} — ${notes.replace(/\n/g, ' / ').slice(0, 80)}…`)
    await withEdit(async (id) => {
      const { tracks = [] } = await api(`/edits/${id}/tracks`)
      const before = tracks.find((t) => t.track === track)
      const releases = before?.releases || []
      console.log(`\ncurrent ${track}: ${releases.map((r) => `${r.status} v${(r.versionCodes || []).join(',')}`).join(' | ') || '(no releases)'}`)
      // ⛔ PATCHING `releases` REPLACES THE WHOLE ARRAY, so ANYTHING already on this track is discarded silently by a
      // command that only means to add one (opus, astra). One completed release is the shape this replaces on purpose;
      // a staged rollout, a halted release, a prepared draft, or a second completed release serving older devices are
      // all human decisions, and this stops rather than guessing which of them to drop.
      const keep = releases.filter((r) => r.status !== 'completed' || releases.length > 1)
      if (keep.length) throw new Error(`${track} carries ${releases.map((r) => `${r.status} v${(r.versionCodes || []).join(',')}`).join(' | ')}. Writing this release replaces that whole list — resolve it in Play Console first, or release to another track.`)
      // A typo'd track name would otherwise CREATE a track rather than fail.
      if (!tracks.some((t) => t.track === track)) throw new Error(`no track "${track}" on this app — it has ${tracks.map((t) => t.track).join(', ')}`)
      if (!APPLY) return
      const bundle = await upload(`/edits/${id}/bundles`, { file: aab, contentType: 'application/octet-stream' })
      console.log(`  uploaded versionCode ${bundle.versionCode}`)
      // The built-in notes describe ONE build. A different bundle must bring its own --notes.
      if (!notesFile && bundle.versionCode !== NOTES_VERSION_CODE) throw new Error(`the built-in release notes describe versionCode ${NOTES_VERSION_CODE}, and this bundle is ${bundle.versionCode} — pass --notes <file> with this build's changes`)
      await api(`/edits/${id}/tracks/${track}`, { method: 'PATCH', body: {
        releases: [{ status: 'completed', versionCodes: [String(bundle.versionCode)], releaseNotes: [{ language: PLAY_LISTING.language, text: notes }] }],
      } })
      console.log(`  ${track}: release with v${bundle.versionCode}`)
      if (!withListing) return
      await api(`/edits/${id}/listings/${PLAY_LISTING.language}`, { method: 'PUT', body: PLAY_LISTING })
      console.log(`  listing: "${PLAY_LISTING.title}"`)
      // ⚠️ DELETE-ALL FIRST, AND IT IS A PLAIN DELETE ON THE COLLECTION. Uploading alone APPENDS — Play caps phone
      // screenshots at 8, so a second run without this would fail on the ninth and leave the old set in front.
      await api(`/edits/${id}/listings/${PLAY_LISTING.language}/phoneScreenshots`, { method: 'DELETE' })
      for (const shot of shots) {
        await upload(`/edits/${id}/listings/${PLAY_LISTING.language}/phoneScreenshots`, { file: shot, contentType: 'image/png' })
        console.log(`  screenshot ${shot}`)
      }
    })
    return
  }

  console.log('usage: node scripts/play-api.mjs <status|listing|details|tracks|signing|release> [--apply]')
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1) })
