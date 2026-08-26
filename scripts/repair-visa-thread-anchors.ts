import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────────────────
// T337 (d) — RE-ANCHOR VISA THREADS THAT THE SELLER-LEVEL REUSE RULE POINTED AT THE TRIP LISTING.
//
// THE DAMAGE. `/api/conversations` reused "the newest thread with this seller" and retargeted its
// listingId. The e-visa catalogue and the trip-planning anchor are sold from ONE Seller row
// (`Seller.ownerId` is @unique), so a traveller with a visa thread who then touched the itinerary
// "book it for you" flow had their VISA thread silently re-anchored onto the trip listing. Two
// consequences, and the loud one is not the expensive one:
//   · where the buyer already held a trip thread, the retarget collided on
//     @@unique([listingId, buyerProfileId]) and threw → the HTTP 500 (fixed in the route).
//   · where it SUCCEEDED, the visa case's thread now sits on a non-visa listing, so
//     `getOrCreateVisaThread`'s lookup — `listingId: { in: visaListingIds }` — misses it and
//     OPENS A SECOND CHAT. That is the owner's "visa apply send form again opens new chat", and
//     it is data corruption: the case's conversation is still there, holding all its messages,
//     just unreachable by the flow that owns it.
//
// The route fix stops new corruption. It cannot un-corrupt these rows: nothing re-anchors a
// thread backwards, so without this script those cases stay orphaned forever.
//
// ⚠️ DRY RUN BY DEFAULT. Pass --apply to write. Read the plan it prints first — every row is
// listed with its message count, because these are real conversations with real people in them.
//
// ⚠️ NOTHING IS DELETED OR MERGED, EVER. The task anticipated having to choose a survivor between
// two threads of one buyer. Measured on prod 2026-07-27, that choice does not arise and MUST NOT
// be invented: buyer 562fa1d5's two desk threads carry two DIFFERENT visa applications
// (e77d1197 and 97756c48), which select two DIFFERENT products. They are two cases, not a
// duplicate — merging them would fuse two people's separate applications into one conversation.
// Each thread is re-anchored to ITS OWN case's product, and they stop colliding by construction.
//
// ⚠️ THE DIRECTION OF THE REPAIR WAS VERIFIED AGAINST THE MESSAGES, not assumed from the column.
// Measured 2026-07-27, both affected threads are visa conversations that were hijacked, not trip
// conversations that happen to carry a case:
//   cmrvk2xnl…  79 msgs — 32 visa_step + 9 visa_checkout + 1 visa_picker vs 1 trip_step
//   cmrvl74e6…  52 msgs — 18 visa_step + 5 visa_picker + 4 visa_checkout vs 2 trip_step
// Those one-and-two stray trip cards ARE the damage: while a visa thread is anchored on the trip
// listing, `threadKind` answers 'itinerary' for it and the trip wizard renders to somebody filling
// in a passport form — the exact leak the shared-desk rule exists to prevent. The first thread was
// still taking messages the morning this was written, so the corruption is live, not historical.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/repair-visa-thread-anchors.ts [--apply]
// ─────────────────────────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply')

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
  log: ['warn', 'error'],
})

function visaDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('visa_database_not_configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY)')
  return createClient(url, key, { auth: { persistSession: false } })
}

type Plan = {
  conversationId: string
  buyerProfileId: string
  applicationId: string
  from: string
  to: string
  why: string
  messages: number
}

async function main() {
  // ⚠️ THE DESK IS RESOLVED, NOT PASTED. A hard-coded seller id would be a second source of truth
  // for "which storefront is the visa desk" and would quietly repair nothing after a reseed. This
  // is the same predicate getVisaShopSeller() uses — owner email — kept here rather than imported
  // because the lib is `server-only` and will not load in a plain script.
  //
  // ⚠️ THE FALLBACK IS `support@eno.forum`, AND GETTING IT WRONG IS A DOCUMENTED OUTAGE. The first
  // cut of this script defaulted to support@eno.vn and matched no seller at all — the same failure
  // src/lib/visa-shop.ts records for 2026-07-22, when that address took the entire visa surface
  // down silently because no Profile carries it (it is a Cloudflare mail redirect, never an
  // account). Keep this equal to VISA_SHOP_OWNER_EMAILS, and note the mismatch is SILENT: a wrong
  // address here does not error, it just repairs nothing and reports success.
  const ownerEmails = (process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.forum')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  const desk = await db.seller.findFirst({
    where: { owner: { email: { in: ownerEmails } } },
    orderBy: { memberSince: 'asc' },
    select: { id: true, name: true },
  })
  if (!desk) throw new Error(`no desk seller for ${ownerEmails.join(', ')}`)

  const listings = await db.listing.findMany({
    where: { sellerId: desk.id },
    select: { id: true, title: true, externalId: true, subcategorySlug: true, price: true, verified: true, status: true },
  })
  // Same EXCLUDE-shaped rule as getVisaShopListings(): a row is visa unless it DECLARES another
  // subcategory. Restating it as "must be visa-legal" would drop an unclassified row and quietly
  // skip a thread that needs repairing.
  const visaListings = listings.filter((l) => l.subcategorySlug === 'visa-legal' || l.subcategorySlug === null)
  const visaIds = new Set(visaListings.map((l) => l.id))
  // The floor a threadless visa start would have opened on — used only for a case that never
  // selected a product. Cheapest for-sale row, which is what the catalogue order resolves to.
  const floor = visaListings
    .filter((l) => l.verified && l.status === 'active')
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0]

  console.log(`desk=${desk.id} (${desk.name}) · ${listings.length} listings, ${visaIds.size} visa · floor=${floor?.id ?? 'NONE'}`)

  const convos = await db.conversation.findMany({
    where: { sellerId: desk.id, visaApplicationId: { not: null } },
    select: {
      id: true, listingId: true, buyerProfileId: true, visaApplicationId: true,
      _count: { select: { messages: true } },
    },
    // ⚠️ ORDERED, BECAUSE THE DRY RUN IS A PROMISE. Postgres returns an unordered findMany in
    // whatever order it likes, and the dry run and the --apply run are two separate executions —
    // so an unordered read could preview one plan and perform another the moment two plans ever
    // contend for a slot (agy). Deterministic input is what makes "read the plan, then apply it"
    // an honest instruction rather than a likely one.
    orderBy: { id: 'asc' },
  })
  // A visa case whose thread is anchored on a visa listing is healthy — the flow finds it.
  // A support thread (listingId null) is not a desk thread and cannot be mis-anchored — skip it.
  const broken = convos.filter((c) => c.listingId !== null && !visaIds.has(c.listingId))
  console.log(`${convos.length} desk threads carry a visa case; ${broken.length} are anchored OFF the catalogue\n`)
  if (broken.length === 0) { console.log('nothing to repair'); return }

  const { data: apps, error } = await visaDb()
    .from('visa_applications')
    .select('id,user_id,conversation_id,selected_listing_id,status')
    .in('id', broken.map((c) => c.visaApplicationId as string))
  if (error) throw new Error(`visa_applications read failed: ${error.message}`)
  const appById = new Map((apps ?? []).map((a: Record<string, unknown>) => [String(a.id), a]))

  const plans: Plan[] = []
  const skipped: string[] = []
  for (const c of broken) {
    const app = appById.get(String(c.visaApplicationId))
    if (!app) { skipped.push(`${c.id}: no visa_applications row for ${c.visaApplicationId}`); continue }
    // ⚠️ THE THREAD'S OWN CASE DECIDES ITS ANCHOR. Using one shared target for every repaired
    // thread is what would manufacture the collision this script is careful not to have: two
    // threads of one buyer forced onto one listing violates the unique index.
    const selected = app.selected_listing_id ? String(app.selected_listing_id) : null
    const target = selected && visaIds.has(selected) ? selected : floor?.id
    // Precise about WHY, because this line is what a human reads before authorising a write. A
    // selected listing that is not in `visaIds` is usually the TRIP ANCHOR — which is on this very
    // desk — so calling it "not on the desk" would be false (agy). What disqualifies it is that it
    // is not a visa listing.
    const why = selected && visaIds.has(selected)
      ? 'the product this case selected'
      : selected
        ? `case selects ${selected}, which is not a visa listing → catalogue floor`
        : 'case never selected a product → catalogue floor'
    if (!target) { skipped.push(`${c.id}: no target (no selected product and no for-sale floor)`); continue }
    // ⚠️ VERIFY THE BUYER, not just the case. The thread and the application must belong to the
    // same person before this moves anything on their behalf.
    if (String(app.user_id) !== c.buyerProfileId) {
      skipped.push(`${c.id}: application ${c.visaApplicationId} belongs to ${app.user_id}, thread to ${c.buyerProfileId}`)
      continue
    }
    plans.push({
      conversationId: c.id, buyerProfileId: c.buyerProfileId, applicationId: String(c.visaApplicationId),
      from: c.listingId ?? '(none)', to: target, why, messages: c._count.messages,
    })
  }

  // Collision check, against the live table AND against the other repairs in this same batch —
  // two plans landing on one (listing, buyer) would fail the second write halfway through.
  const claimed = new Set<string>()
  const doable: Plan[] = []
  // ⚠️ A PRINCIPLED TIE-BREAK, not array order. If two of this buyer's threads ever want one slot,
  // the case that explicitly SELECTED that product has the better claim than one merely falling
  // back to the catalogue floor, and the busier thread beats the quieter one. `conversationId`
  // last makes the whole ordering total, so the plan is identical on every run.
  const rank = (p: Plan) => (p.why === 'the product this case selected' ? 0 : 1)
  plans.sort((a, b) => rank(a) - rank(b) || b.messages - a.messages || a.conversationId.localeCompare(b.conversationId))
  for (const p of plans) {
    const key = `${p.to}::${p.buyerProfileId}`
    const live = await db.conversation.findUnique({
      where: { listingId_buyerProfileId: { listingId: p.to, buyerProfileId: p.buyerProfileId } },
      select: { id: true },
    })
    if ((live && live.id !== p.conversationId) || claimed.has(key)) {
      // Refuse rather than pick a survivor. Both threads hold real messages; choosing between
      // them is a decision for a person, and the script's job is to make that visible.
      skipped.push(`${p.conversationId}: target ${p.to} is already taken for this buyer by ${live?.id ?? 'another repair in this batch'} — NEEDS A HUMAN DECISION, nothing written`)
      continue
    }
    claimed.add(key)
    doable.push(p)
  }

  console.log(APPLY ? 'APPLYING:' : 'DRY RUN (pass --apply to write):')
  for (const p of doable) {
    console.log(`  ${p.conversationId}  ${p.messages} msgs  case ${p.applicationId.slice(0, 8)}`)
    console.log(`      ${p.from}  →  ${p.to}   (${p.why})`)
  }
  for (const s of skipped) console.log(`  SKIP ${s}`)

  // The exact inverse, printed either way. Re-anchoring is a one-column write with no cascade, so
  // it is fully reversible — but only if the OLD anchor is written down before it is overwritten,
  // and after the fact nothing in the row remembers it.
  console.log('\nROLLBACK (restores the pre-repair anchors verbatim):')
  for (const p of doable) {
    console.log(`  UPDATE "Conversation" SET "listingId" = '${p.from}' WHERE id = '${p.conversationId}';`)
  }

  if (!APPLY) { console.log(`\n${doable.length} thread(s) would be re-anchored, ${skipped.length} skipped.`); return }

  let done = 0
  for (const p of doable) {
    // Guarded exactly like the route: a concurrent writer could have taken this slot since the
    // check above, and a half-finished repair must not be a stack trace.
    try {
      await db.conversation.update({ where: { id: p.conversationId }, data: { listingId: p.to } })
      done++
      console.log(`  ok   ${p.conversationId} → ${p.to}`)
    } catch (e) {
      const code = (e as { code?: string })?.code
      console.error(`  FAIL ${p.conversationId} → ${p.to}${code === 'P2002' ? ' (P2002: slot taken since the check)' : ''}`, e)
    }
  }
  console.log(`\nre-anchored ${done}/${doable.length}; ${skipped.length} skipped.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
