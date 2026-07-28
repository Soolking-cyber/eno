// ─────────────────────────────────────────────────────────────────────────────────────────
// PRUNE ABANDONED TRIP-WIZARD SHELLS OUT OF e-VISA THREADS.
//
// WHY. The visa desk and the trip desk are the SAME Seller row (Seller.ownerId is @unique), and
// before the anchor fix (T337) a trip wizard could be authored into a visa conversation. The cards
// are already invisible and inert — the thread refuses to render trip cards when the server says
// kind === 'visa', and advanceTripWizard refuses to drive one — so this removes data, not a symptom.
//
// ⚠️ IT REFUSES TO TOUCH A COMPLETED CARD, and that is the whole design of the query. A trip_step
// whose meta says state:'done' carries a real itineraryId — a plan a real person finished. The one
// in production on 2026-07-28 belonged to a CUSTOMER (not the owner's test account), its itinerary
// was status='ready', and it was their only saved trip. Deleting it would have tidied nothing a
// user can see while destroying their record of a real event.
//
// Run:  node --env-file=.env node_modules/.bin/tsx scripts/prune-orphan-trip-cards.ts
//       …same, plus --apply, to write. Dry run prints every row and its exact prior state first.
// ─────────────────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }), log: ['warn','error'] })
const APPLY = process.argv.includes('--apply')
async function main() {
  const rows = await db.$queryRawUnsafe<Array<{id:string;kind:string;metaJson:string|null;createdAt:Date;conversationId:string;title:string|null}>>(`
    select m.id, m.kind, m."metaJson", m."createdAt", m."conversationId", l.title
    from "Message" m
    join "Conversation" c on c.id = m."conversationId"
    join "Listing" l on l.id = c."listingId"
    where m.kind in ('trip_step','trip_quote','trip_status') and l."subcategorySlug" = 'visa-legal'
      -- ⚠️ NEVER A COMPLETED CARD. A trip_step whose meta says state:'done' carries a real
      -- itineraryId, i.e. a plan a real person finished. Measured before writing this: the one in
      -- production belongs to thehoneypotgame@gmail.com, its itinerary is status='ready' and it is
      -- their ONLY saved trip. It is already invisible (the thread refuses to render trip cards in
      -- a visa thread), so deleting it would tidy nothing a user can see while destroying a
      -- customer's record of a real event. Only the abandoned step-1 shells go.
      and m."metaJson" not like '%"state":"done"%'
    order by m."createdAt"`)
  console.log(`${rows.length} trip-family card(s) in visa threads:`)
  for (const r of rows) console.log(`  ${r.createdAt.toISOString()}  ${r.kind.padEnd(11)} msg=${r.id}  convo=${r.conversationId}  listing="${r.title}"  meta=${r.metaJson}`)
  if (!rows.length) return
  console.log('\nROLLBACK (re-insert is not possible; this is the exact state being removed):')
  for (const r of rows) console.log(`  -- ${r.id}: kind=${r.kind} convo=${r.conversationId} createdAt=${r.createdAt.toISOString()} meta=${r.metaJson}`)
  if (!APPLY) { console.log(`\nDRY RUN — would DELETE ${rows.length} message row(s). Pass --apply.`); return }
  const del = await db.message.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })
  console.log(`\n✅ deleted ${del.count} row(s)`)
  const left = await db.$queryRawUnsafe<Array<{n:bigint}>>(`
    select count(*)::bigint as n from "Message" m
    join "Conversation" c on c.id = m."conversationId" join "Listing" l on l.id = c."listingId"
    where m.kind in ('trip_step','trip_quote','trip_status') and l."subcategorySlug"='visa-legal'`)
  console.log(`remaining: ${left[0].n}`)
}
main().catch(e => { console.error(e.message); process.exit(1) }).finally(() => db.$disconnect())
