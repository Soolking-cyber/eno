/**
 * GOOGLE PLAY DEVELOPER API (Android Publisher v3) — the scriptable half of a Play release.
 *
 *   node scripts/play-api.mjs status                 # what Play thinks the app is, read-only
 *   node scripts/play-api.mjs listing                # read the current store listing
 *   node scripts/play-api.mjs listing --apply        # write it from PLAY_LISTING below
 *   node scripts/play-api.mjs tracks                 # releases per track
 *   node scripts/play-api.mjs details [--apply]      # the required contact fields
 *   node scripts/play-api.mjs signing <versionCode>  # the PLAY APP SIGNING SHA-256, for assetlinks
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
 * ⚠️ WHAT THIS API CANNOT DO, so nobody goes looking:
 *   · Data safety            — Console only. Use its Export/Import CSV, which is the bulk path.
 *   · Content rating         — Console only (it is a questionnaire, not a resource).
 *   · Target audience, ads, financial features — Console only.
 *   · INDIVIDUAL tester emails — the API's `testers` resource takes Google GROUPS, not addresses.
 *     A raw email list is Console-only. Point a group at it once and this becomes scriptable.
 * WHAT THIS SCRIPT IMPLEMENTS TODAY: reading app details (`status`), reading tracks and their
 * releases (`tracks`), and reading/writing the en-US store listing (`listing`). The API itself also
 * covers AAB upload, creating releases and release notes — those are NOT implemented here, and the
 * header used to imply they were.
 */
import { execFileSync } from 'node:child_process'

/**
 * ⚠️ THE PLAY PACKAGE NAME — AND IT IS NOT THE SITE THE APP RENDERS. Two reviewers read `eno.vn`
 * beside e-Visa copy and called it a licensing leak, so it is worth stating flatly: Google Play
 * bound the app entry to this identifier before the first upload and it cannot be changed. The app
 * loads `https://www.eno.forum` (capacitor.config.ts server.url), which is the edition that may
 * offer visa and itinerary. A package name is a string, not a destination.
 */
const PACKAGE = 'eno.vn'
const SA = 'play-publisher@speedy-victory-500106-h8.iam.gserviceaccount.com'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3'
const APPLY = process.argv.includes('--apply')
const cmd = process.argv[2]

/** The listing copy, counted against Play's limits. Single source — edit here, not in the Console. */
const PLAY_LISTING = {
  language: 'en-US',
  title: 'eno: Marketplace & e-Visa',
  shortDescription: 'Buy, sell and rent in Vietnam. Plus Vietnam e-Visas and free trip planning.',
  fullDescription: `eno is the app for expats and internationals living in or travelling to Vietnam. One place to buy and sell, sort your visa, and plan the trip.

BUY AND SELL
• Housing and rentals, from studios to serviced apartments
• Motorbikes, bicycles and cars
• Furniture and appliances, including whole moving sales
• Electronics, phones and laptops — new, used and refurbished
• Jobs and local services

Post a listing with photos from your phone, set a price in VND, and reply to buyers in the app. No listing fees.

VIETNAM e-VISA
Apply for a Vietnam e-Visa without deciphering a government form. Choose standard or express processing, see the price and the timeline before you commit, and ask a human first if you are not sure which option fits. Your documents are handled securely and you are told what happens at each step.

PLAN THE TRIP
Build an itinerary, save the places you like, and get help with bookings — free.

BUILT FOR TRUST
Every seller carries a public trust score built from real evidence, not stars alone. Business sellers can verify their registration. Listings that break the rules get reported by the community and reviewed. Prices are shown in Vietnamese đồng with a US dollar reference, so you always know what you are paying. Nobody can pay to rank higher.

YOUR LANGUAGE
The whole app works in English and Tiếng Việt, with nine more languages for listing content.

MADE FOR VIETNAM
Search by city and district, see listings on a map, and message sellers directly. Offers are built in, so you can negotiate without leaving the app.`,
}

/**
 * The developer contact Play REQUIRES on the listing. It is published to users, so it is the
 * EDITION'S OWN address: the app renders eno.forum, and support@eno.vn is the licensed
 * marketplace's inbox — printing that here would put the wrong operator's contact on an app that
 * sells visa services.
 */
const PLAY_DETAILS = { contactEmail: 'support@eno.forum', contactWebsite: 'https://www.eno.forum' }

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

  console.log('usage: node scripts/play-api.mjs <status|listing|details|tracks|signing> [--apply]')
}

main().catch((e) => { console.error('\n' + e.message); process.exit(1) })
