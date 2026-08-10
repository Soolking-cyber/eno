/**
 * GRANT OR REVOKE THE OFFICIAL-PARTNER BADGE, BY STOREFRONT HANDLE.
 *
 *   node --env-file=.env scripts/set-official-partner.mjs vietkite            # dry run
 *   node --env-file=.env scripts/set-official-partner.mjs vietkite --apply
 *   node --env-file=.env scripts/set-official-partner.mjs vietkite --off --apply
 *
 * ⚠️ THIS IS THE ONLY WRITE PATH, AND THAT IS THE DESIGN. There is deliberately no admin UI and no
 * API for this flag. `officialPartner` asserts that eno has a commercial agreement with a company —
 * a claim about the real world that no automated check can establish, so it should cost a human a
 * deliberate command rather than a click. It is also unreachable from the seller-facing PATCH:
 * updateSeller() builds its `data` object field-by-field from an allowlist (verified 2026-08-10,
 * no `...body` spread anywhere), so a seller cannot grant it to themselves. If that function ever
 * grows a spread, a seller can award themselves the badge AND switch off their own phone reveal.
 *
 * ⚠️ IT CHANGES BEHAVIOUR, NOT JUST DECORATION. An official partner shares NO phone number:
 * phoneForSeller() returns null for them and the contact route answers 403 `partner_chat_only`.
 * Revoking the flag therefore turns a seller's phone reveal back ON if a number is still stored —
 * which is why --off prints the stored phone state instead of silently flipping it.
 */
import { Client } from 'pg'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const OFF = args.includes('--off')
// ⚠️ REVOKING IS NOT THE MIRROR OF GRANTING, SO IT DOES NOT SHARE ITS FLAG. Granting hides a phone;
// revoking REPUBLISHES one that is still sitting in the column, and the person running `--off` is
// usually thinking about a badge, not about a phone number going back on the internet. A reviewer
// noted the first version printed the warning and then flipped anyway in the same run. So when a
// number is stored, --off additionally requires --republish-phone: the operator has to name the
// consequence before it happens.
const REPUBLISH_OK = args.includes('--republish-phone')
const handle = args.find((a) => !a.startsWith('--'))

if (!handle) {
  console.error('Usage: node --env-file=.env scripts/set-official-partner.mjs <handle> [--off] [--apply]')
  process.exit(1)
}
const DB = process.env.DIRECT_URL
if (!DB) {
  console.error('Missing DIRECT_URL — run with node --env-file=.env')
  process.exit(1)
}

const c = new Client({ connectionString: DB })
await c.connect()
try {
  const found = await c.query(
    `select s.id, s.name, s."officialPartner", s.phone
       from "Seller" s join "Handle" h on h."sellerId" = s.id
      where h.handle = $1`,
    [handle],
  )
  // ⚠️ NO `process.exit()` ANYWHERE IN THIS BLOCK — it skips `finally`, so the client would never
  // close. Every terminating path sets `process.exitCode` and falls through instead. An earlier
  // version carried this comment while STILL exiting on the not-found path below; two reviewers
  // caught it independently. A comment asserting a property the code lacks is worse than the lapse
  // it describes, because it stops the next reader checking. Hence the nesting rather than guards.
  const s = found.rows[0]
  if (!s) {
    console.error(`No storefront with handle "${handle}".`)
    process.exitCode = 1
  } else {
  const next = !OFF

  console.log(`${s.name} (${s.id})`)
  console.log(`  officialPartner : ${s.officialPartner}  ->  ${next}`)
  // Surfaced on purpose: with the flag ON the number is unreachable whatever it says, so a stored
  // phone is dormant rather than gone. Turning the flag OFF republishes it in the same breath.
  console.log(`  stored phone    : ${s.phone ?? '(none)'}${s.phone && OFF ? '  ⚠️ REVEAL TURNS BACK ON' : ''}`)

  if (s.officialPartner === next) {
    console.log('\nAlready in that state — nothing to do.')
  } else if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.')
  } else if (OFF && s.phone && !REPUBLISH_OK) {
    console.error(
      `\nREFUSING: ${s.name} still has a phone number stored, and clearing the partner flag makes it` +
        `\nrevealable again through the contact route. If that is what you want, pass --republish-phone.` +
        `\nIf it is not, clear the number first.`,
    )
    process.exitCode = 1
  } else {
    const upd = await c.query(`update "Seller" set "officialPartner" = $1 where id = $2`, [next, s.id])
    if (upd.rowCount !== 1) throw new Error(`expected to update 1 row, updated ${upd.rowCount}`)

    // ⚠️ THE FLAG IS INSTANT; THE PAGES ARE NOT. Three different caches, measured 2026-08-10, and
    // an earlier version of this message named only the first — which is the shape that makes an
    // operator flip the flag, see the storefront update, and conclude the whole thing shipped.
    //   · /[handle]      — `force-dynamic`. Correct on the next request. Only the EDGE needs a purge.
    //   · /              — `revalidate = 21600` (6h). The home feed keeps the old card seal till then.
    //   · /listings/[id] — `revalidate = 2592000` (30 DAYS). A partner's existing PDPs keep the old
    //                      badge state for a MONTH. This is the one that bites.
    // A plain node script cannot fix that: `revalidatePath` only exists inside a Next request scope.
    // What actually clears it is a DEPLOY (a new BUILD_ID drops every ISR entry) or an on-demand
    // revalidation triggered by editing each listing. In practice granting is harmless — eno creates
    // partner accounts before they have listings, so there are no stale PDPs to fix. REVOKING from a
    // seller with live listings is the case to plan around.
    console.log(`\nDone — the flag is live. Pages are not, yet:`)
    console.log(`  · purge Cloudflare (purge_everything, never by URL) for the storefront HTML`)
    console.log(`  · / is ISR 6h and /listings/[id] is ISR 30d — deploy, or edit each listing, to`)
    console.log(`    refresh the card seal and the PDP badge. Flipping the flag alone will NOT.`)
  }
  }
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
