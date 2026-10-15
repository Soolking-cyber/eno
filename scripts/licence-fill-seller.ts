/**
 * ENTER A PROVIDER'S LICENCE VALUES FOR IT — an operator act (owner, 2026-10-14), for a provider that cannot type them
 * into the post form itself: VietKite sends eno its international travel-service licence and business registration, and
 * eno enters the registered name and the licence number on its listings.
 *
 *   npx tsx scripts/licence-fill-seller.ts --seller=<id> --aisle=visa-legal|legal-permits \
 *     --name="<registered business name>" --number="<licence no>"            # DRY RUN — lists the rows, writes nothing
 *   … --apply                                                               # writes them
 *
 * Every non-removed listing of THAT seller in THAT aisle (services/visa-legal = e-Visa, services/legal-permits = Legal &
 * permits) gets, in ONE transaction per row:
 *   · the two values (providerLegalName / providerLicenceNo), normalised exactly as the post form stores them
 *     (src/lib/provider-licence.ts withProviderLicence) — and the run REFUSES before reading anything if the values break
 *     any rule the form enforces (providerLicenceProblems: length, an ID-card number, a phone, contact details …);
 *   · the approval stamp CLEARED (LICENCE_STAMP_CLEARED) and verified=false, identityHold=false: the row is UNPUBLISHED
 *     and waits for the admin's one-click approval under Admin › Catalogue › Licence checks, like any value change;
 *   · one compliance_audit row 'listing.licence_values_entered' (actorType 'system', the seller and the aisle).
 * The write is a COMPARE-AND-SET on the attributes this run read (and the seller, the aisle, "not removed"): a seller's
 * own edit landing in between is never overwritten — that row is skipped and reported, and a re-run picks it up.
 * A row that already carries exactly these values (normalised) is LEFT AS IT IS — an approval it has survives, so a
 * re-run unpublishes nothing.
 *
 * ⛔ IT NEVER STAMPS AND NEVER PUBLISHES. Approval stays the admin's act, against the copies the provider emailed, in the
 * one place that writes a stamp (POST /api/admin/listings 'licence-approve' — compliance/public-state-writes.test.ts pins
 * it). Typing the values here is not checking them.
 * ⛔ RUN IT, THEN APPROVE THE GROUP IMMEDIATELY: the rows are OFFLINE in between — VietKite's live e-Visa listings
 * included. Each row's page is tombstoned so it stops showing at once (src/lib/pdp-tombstone.ts); the approval
 * republishes them and purges the pages and the home page again.
 * ⛔ REFUSES eno's own desk (HIDDEN_DESK_OWNER_EMAILS, or the visa/trip desk owners it falls back to — the same list
 * src/lib/edition-scope.ts deskSellerIds reads, rebuilt here because that module is server-only; support@eno.forum is
 * refused whatever the env says): the desk is exempt from the check, and this run would take its listings offline.
 * Refuses an ownerless storefront too — there is no provider account to have sent the licence.
 *
 * ⚠️ THE AUDIT ROW IS WRITTEN BY THE APP'S OWN appendAudit (src/lib/compliance/audit.ts — one hash chain, one
 * implementation), which opens with `import 'server-only'`. Under tsx that resolves only where node_modules/server-only
 * exists (the owner's checkout has the stub; scripts/audit-feed-compliance.ts has the one-line command to create it).
 * The run checks it FIRST, before it reads or writes anything.
 * Reads DIRECT_URL / DATABASE_URL (prod: through the SSH tunnel), like the other scripts.
 */
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { attributeBag, LICENCE_CHECK_SUBCATEGORIES, VISA_CATEGORY_SLUG } from '../src/lib/taxonomy'
import { isEnterpriseCodeForm, normalizeLegalName, normalizeLicenceNo, providerLicenceFromInput, providerLicenceOf, providerLicenceProblems, sameProviderLicence, withProviderLicence } from '../src/lib/provider-licence'
import { LICENCE_STAMP_CLEARED, licenceHeldMark, licenceStateOf } from '../src/lib/licence-stamp'
import { NOT_REMOVED } from '../src/lib/listing-removed'
import { tombstonePdps } from '../src/lib/pdp-tombstone'

const USAGE = 'usage: npx tsx scripts/licence-fill-seller.ts --seller=<id> --aisle=visa-legal|legal-permits --name="<registered business name>" --number="<licence no>" [--apply]'

function refuse(msg: string): never {
  console.error(`⛔ ${msg}`)
  process.exit(1)
}

// ── 1. The arguments — all of them checked before anything is loaded or read. Only `--key=value` (and `--apply`): a
// bare word, or `--name "x"` with a space, is refused rather than guessed at.
const FLAGS = ['seller', 'aisle', 'name', 'number']
const args: Record<string, string> = {}
let APPLY = false
for (const a of process.argv.slice(2)) {
  if (a === '--apply') { APPLY = true; continue }
  const m = /^--([a-z]+)=([\s\S]*)$/.exec(a)
  if (!m || !FLAGS.includes(m[1])) refuse(`unexpected argument "${a}"\n${USAGE}`)
  if (Object.hasOwn(args, m[1])) refuse(`--${m[1]} given twice\n${USAGE}`)
  args[m[1]] = m[2]
}
const sellerId = (args.seller ?? '').trim()
const aisle = (args.aisle ?? '').trim()
if (!sellerId || !aisle || args.name === undefined || args.number === undefined) refuse(USAGE)
if (!(LICENCE_CHECK_SUBCATEGORIES as readonly string[]).includes(aisle)) refuse(`--aisle must be one of ${LICENCE_CHECK_SUBCATEGORIES.join(', ')} (got "${aisle}")`)
const values = { legalName: normalizeLegalName(args.name), licenceNo: normalizeLicenceNo(args.number) }
const problems = providerLicenceProblems(values, aisle)
if (problems.length) refuse(`these values cannot be accepted as written — the post form refuses them too:\n${problems.map((p) => `   ${p.field}: ${p.reason}`).join('\n')}`)

/** eno's own desk owners — edition-scope.ts HIDDEN_DESK_OWNER_EMAILS, rebuilt (that module is server-only), plus the
 *  desk's own account always: refusing one storefront too many is the safe direction here. */
function deskOwnerEmails(): Set<string> {
  // `||`, not the app's `??` (commit gate): an EMPTY variable means "this edition hides nobody" to the app, but here it
  // must fall back to the desk lists — refusing one storefront too many is the safe direction.
  const listed = process.env.HIDDEN_DESK_OWNER_EMAILS
    || [process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.forum', process.env.TRIP_DESK_OWNER_EMAIL || 'support@eno.forum'].join(',')
  // support@eno.vn too (commit gate): eno's own visa admin identity — never a provider this script should touch.
  return new Set([...listed.split(','), 'support@eno.forum', 'support@eno.vn'].map((e) => e.trim().toLowerCase()).filter(Boolean))
}

async function main() {
  // ── 2. The audit writer, before any read (header).
  let appendAudit: typeof import('../src/lib/compliance/audit').appendAudit
  try {
    ;({ appendAudit } = await import('../src/lib/compliance/audit'))
  } catch (e) {
    refuse(`cannot load the app's audit writer (src/lib/compliance/audit.ts): ${e instanceof Error ? e.message : String(e)}\n`
      + '   It opens with `import \'server-only\'`, which a plain script resolves only where node_modules/server-only exists —\n'
      + '   create the stub (scripts/audit-feed-compliance.ts has the command) and re-run. Nothing was read or written.')
  }

  config({ quiet: true })
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) refuse('set DIRECT_URL or DATABASE_URL')
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  try {
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — the provider's licence values onto seller ${sellerId}, services/${aisle}`)
    console.log(`  registered name : ${values.legalName}`)
    console.log(`  licence number  : ${values.licenceNo}${isEnterpriseCodeForm(values.licenceNo) ? '   ⚠️ the bare enterprise-code form — the same shape as a phone number: compare it with the registration certificate' : ''}`)

    // ── 3. The storefront: a real one, owned, and not eno's desk.
    const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { id: true, name: true, ownerId: true, owner: { select: { email: true } }, handle: { select: { handle: true } } } })
    if (!seller) refuse(`no storefront has the id ${sellerId}`)
    const email = seller.owner?.email?.toLowerCase() ?? null
    if (!seller.ownerId || !email) refuse(`storefront ${sellerId} ("${seller.name}") has no owner account — there is no provider to have sent the licence; refusing`)
    if (deskOwnerEmails().has(email)) refuse(`storefront ${sellerId} ("${seller.name}") is eno's own desk (${email}) — the desk is exempt from the licence check and this run would take its listings offline; refusing`)
    console.log(`  storefront      : "${seller.name}"${seller.handle ? ` /${seller.handle.handle}` : ''} — owner ${email}`)

    // ── 4. Its rows in that aisle, as they stand.
    const rows = await db.listing.findMany({
      where: { sellerId, ...NOT_REMOVED, category: { slug: VISA_CATEGORY_SLUG }, subcategorySlug: aisle },
      select: { id: true, title: true, status: true, verified: true, identityHold: true, attributes: true, verificationMethod: true, verificationNotes: true, subcategorySlug: true, sellerId: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!rows.length) { console.log(`\nno listing of this storefront in services/${aisle} — nothing to do`); return }
    const toWrite: typeof rows = []
    console.log(`\n${rows.length} listing(s) in services/${aisle}:`)
    for (const r of rows) {
      const stored = providerLicenceFromInput(attributeBag(r.attributes)) ?? { legalName: '', licenceNo: '' }
      const state = licenceStateOf({ categorySlug: VISA_CATEGORY_SLUG, subcategorySlug: r.subcategorySlug, sellerId: r.sellerId, attributes: r.attributes, verificationMethod: r.verificationMethod, verified: r.verified }, { desk: false })
      const live = r.verified && r.status === 'active'
      const same = sameProviderLicence(providerLicenceOf(r.attributes), values)
      if (!same) toWrite.push(r)
      console.log(`  ${r.id}  [${r.status}${r.verified ? ', verified' : ''}${r.identityHold ? ', identityHold' : ''}${live ? ' — LIVE' : ''}]  licence: ${state}  ${r.title.slice(0, 60)}`)
      console.log(`      now: ${stored.legalName || '—'} · ${stored.licenceNo || '—'}`)
      console.log(`      ${same ? 'unchanged — already these values; left as it is' : `→ these values, stamp cleared, unpublished until approved${live ? ' (goes OFFLINE now)' : ''}`}`)
    }
    if (!toWrite.length) { console.log('\nevery row already carries these values — nothing to write'); return }
    if (!APPLY) { console.log(`\nDRY RUN — nothing written. Re-run with --apply to write ${toWrite.length} row(s), then approve the group at once under Catalogue › Licence checks.`); return }

    // ── 5. The writes: one transaction per row, compare-and-set on what step 4 read (header).
    const written: string[] = []
    let raced = 0
    // ⛔ The rows already written are tombstoned EVEN IF A LATER ROW THROWS (commit gate): each row commits on its own, so
    // a failure mid-loop must not leave the committed ones unpublished in the database but still showing from the cache.
    try {
      for (const r of toWrite) {
        const done = await db.$transaction(async (tx) => {
          const { count } = await tx.listing.updateMany({
            // …and the stamp and publication it read (commit gate): an admin's approval or revoke landing in between wins.
            where: { id: r.id, sellerId, subcategorySlug: aisle, ...NOT_REMOVED, attributes: r.attributes, verificationMethod: r.verificationMethod, verified: r.verified, identityHold: r.identityHold, verificationNotes: r.verificationNotes },
            // The licence hold's mark (licence-stamp.ts licenceHeldMark): a live row is held for the check, so the approval
            // puts it back; a row something else had taken down stays down after it.
            data: { attributes: withProviderLicence(r.attributes, values), ...LICENCE_STAMP_CLEARED, ...licenceHeldMark(r), verified: false, identityHold: false },
          })
          if (count !== 1) return false
          await appendAudit(tx, {
            actorType: 'system',
            action: 'listing.licence_values_entered',
            subjectType: 'listing',
            subjectId: r.id,
            detail: { subcategory: aisle, sellerId },
            legalBasis: 'ecommerceLaw',
          })
          return true
        }, { timeout: 30_000 }) // the audit append waits on its one advisory lock; a busy minute must not abort the row
        if (done) written.push(r.id)
        else raced++
      }
    } finally {
      console.log(`\nWRITTEN ${written.length}${raced ? ` · ${raced} changed since the read — left alone (re-run to pick them up)` : ''}`)
      // The pages stop showing the now-unpublished rows at once: a script has no revalidatePath.
      // A failed tombstone FAILS THE RUN (commit gate): the rows are unpublished, but a cached page can show them until the
      // approval below purges it — the operator must see that, not a clean exit.
      try { console.log(`page tombstones: ${await tombstonePdps(db, written)}`) } catch (e) {
        console.error(`⛔ page tombstones FAILED (${e instanceof Error ? e.message : String(e)}) — a cached page can still show a row: approve the group now (it purges them), or re-run scripts/purge-isr-listings.mjs for these ids`)
        process.exitCode = 1
      }
    }
    console.log('\nNEXT, NOW: Admin › Catalogue › Licence checks → compare the values with the emailed licence → Approve the group.')
    console.log('The rows stay offline until then.')
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
