import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────────────────
// MERGE ONE BUYER'S VISA CONVERSATIONS INTO ONE.
//
// WHY. The visa feature is designed around ONE buyer↔desk conversation holding several drafts,
// with `Conversation.visaApplicationId` naming the ACTIVE one (see the header comment on
// api/visa/applications/[id]/resume/route.ts). When a buyer ends up with several visa threads —
// this one did, through the anchor corruption fixed in T337 — every case switch necessarily
// becomes a thread switch, because `Conversation.visaApplicationId` is @unique and an
// application's `conversation_id` names exactly one thread. No wording and no client change makes
// that feel local; the threads have to actually be one. The owner reported the consequence three
// times before this ran.
//
// ⚠️ SAFE BY CONSTRUCTION, and the guarantee is not in this script — it is in the route. A card
// action is refused unless the card's case IS the conversation's active one
// (api/visa/cards/[messageId]/act/route.ts:86: `row.conversation.visaApplicationId !== meta.applicationId`).
// So the merged-in cards become inert history the moment they arrive, exactly as a superseded
// case's cards already do after a normal resume. A stale checkout for the OTHER product cannot be
// paid from the merged timeline.
//
// ⚠️ NOTHING IS DELETED. Messages are moved, the emptied conversation is kept and merely hidden
// from the buyer's inbox (buyerDeletedAt), and every write is printed as inverse SQL before it
// happens. `visa_applications.conversation_id` is documented as immutable; this is the one
// operation that is allowed to move it, and it moves it deliberately and reversibly.
//
// Run:  node --env-file=.env node_modules/.bin/tsx scripts/merge-visa-threads.ts --email=<addr>
//       …same, plus --apply, to write.
// ─────────────────────────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply')
const EMAIL = (process.argv.find((a) => a.startsWith('--email=')) || '').split('=')[1]

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
  log: ['warn', 'error'],
})

function visaDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('visa_database_not_configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main() {
  if (!EMAIL) throw new Error('pass --email=<applicant address>')
  const profile = await db.profile.findFirst({ where: { email: EMAIL }, select: { id: true, email: true } })
  if (!profile) throw new Error(`no profile for ${EMAIL}`)

  // The visa catalogue defines what a visa thread IS — the same EXCLUDE-shaped rule
  // getVisaShopListings uses, so an unclassified desk row is not silently skipped.
  const listings = await db.listing.findMany({
    where: { subcategorySlug: 'visa-legal' },
    select: { id: true, title: true, sellerId: true },
  })
  if (!listings.length) throw new Error('no visa listings — refusing to guess which threads are visa')
  const visaIds = listings.map((l) => l.id)
  const titleOf = new Map(listings.map((l) => [l.id, l.title]))

  const convos = await db.conversation.findMany({
    where: { buyerProfileId: profile.id, listingId: { in: visaIds } },
    select: { id: true, listingId: true, visaApplicationId: true, createdAt: true, lastMessageAt: true, buyerDeletedAt: true },
  })
  const counted = await Promise.all(convos.map(async (c) => ({
    ...c,
    messages: await db.message.count({ where: { conversationId: c.id } }),
  })))

  console.log(`applicant ${profile.email}`)
  for (const c of counted) {
    console.log(`  ${c.id}  ${String(c.messages).padStart(3)} msgs  case=${(c.visaApplicationId ?? '—').slice(0, 8)}  ${titleOf.get(c.listingId!)}`)
  }
  if (counted.length < 2) { console.log('\nnothing to merge — one visa thread or none'); return }

  // ⚠️ THE SURVIVOR IS THE RICHEST THREAD, not the newest. It carries the most history, so merging
  // into it moves the fewest messages and disturbs the fewest ids. Ties break on the older thread,
  // then on id, so the choice is total and the dry run predicts the apply exactly.
  const [survivor, ...losers] = counted.slice().sort((a, b) =>
    b.messages - a.messages ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id))

  if (survivor.buyerDeletedAt) {
    console.log(`\n⚠️  the survivor is currently HIDDEN from the buyer (deleted ${survivor.buyerDeletedAt.toISOString()}) — the merge will un-hide it, since it becomes their only visa thread`)
  }
  console.log(`\nSURVIVOR ${survivor.id}  (${survivor.messages} msgs, active case ${(survivor.visaApplicationId ?? '—').slice(0, 8)})`)
  const rollback: string[] = []
  for (const loser of losers) {
    console.log(`MERGE IN ${loser.id}  (${loser.messages} msgs, case ${(loser.visaApplicationId ?? '—').slice(0, 8)})`)
    rollback.push(`-- restore ${loser.id}`)
    rollback.push(`UPDATE "Message" SET "conversationId" = '${loser.id}' WHERE "conversationId" = '${survivor.id}' AND id IN (SELECT id FROM "Message" WHERE "conversationId" = '${loser.id}');`)
    if (loser.visaApplicationId) {
      rollback.push(`UPDATE "Conversation" SET "visaApplicationId" = '${loser.visaApplicationId}' WHERE id = '${loser.id}';`)
    }
    rollback.push(`UPDATE "Conversation" SET "buyerDeletedAt" = NULL WHERE id = '${loser.id}';`)
  }

  // The message ids being moved, captured BEFORE the move so the rollback can name them exactly
  // rather than by a predicate that will no longer select them afterwards.
  const moving: Record<string, string[]> = {}
  for (const loser of losers) {
    const ids = (await db.message.findMany({ where: { conversationId: loser.id }, select: { id: true }, orderBy: { id: 'asc' } })).map((m) => m.id)
    moving[loser.id] = ids
  }
  const preciseRollback = losers.flatMap((loser) => [
    `-- ${loser.id}: ${moving[loser.id].length} messages back`,
    moving[loser.id].length
      ? `UPDATE "Message" SET "conversationId" = '${loser.id}' WHERE id IN (${moving[loser.id].map((i) => `'${i}'`).join(', ')});`
      : `-- (no messages)`,
    loser.visaApplicationId ? `UPDATE "Conversation" SET "visaApplicationId" = '${loser.visaApplicationId}' WHERE id = '${loser.id}';` : '',
    `UPDATE "Conversation" SET "buyerDeletedAt" = NULL WHERE id = '${loser.id}';`,
    loser.visaApplicationId ? `-- and in visa_applications: UPDATE visa_applications SET conversation_id = '${loser.id}' WHERE id = '${loser.visaApplicationId}';` : '',
  ].filter(Boolean))

  console.log('\nROLLBACK (run in order to undo everything below):')
  for (const line of preciseRollback) console.log(`  ${line}`)

  if (!APPLY) {
    console.log(`\nDRY RUN — would move ${losers.reduce((n, l) => n + moving[l.id].length, 0)} message(s) into ${survivor.id} and hide ${losers.length} emptied thread(s). Pass --apply to write.`)
    return
  }

  for (const loser of losers) {
    // 1. Free the @unique slot FIRST. Repointing the application while two rows still name it
    //    would be a window in which the case resolves to a thread that is about to be emptied.
    if (loser.visaApplicationId) {
      await db.conversation.update({ where: { id: loser.id }, data: { visaApplicationId: null } })
    }
    // 2. Move the messages. createdAt is untouched, so the two histories interleave by time
    //    rather than stacking one after the other.
    if (moving[loser.id].length) {
      await db.message.updateMany({ where: { id: { in: moving[loser.id] } }, data: { conversationId: survivor.id } })
    }
    // 3. Point the case at the survivor. This is the one place allowed to move an "immutable"
    //    conversation_id, and without it /resume would keep sending the applicant back here.
    if (loser.visaApplicationId) {
      const { error } = await visaDb().from('visa_applications')
        .update({ conversation_id: survivor.id }).eq('id', loser.visaApplicationId)
      if (error) throw new Error(`visa_applications repoint failed: ${error.message}`)
    }
    // 4. Hide the emptied thread from the applicant's inbox WITHOUT deleting it, so every step
    //    above stays reversible. The inbox hides a thread whose lastMessageAt <= buyerDeletedAt;
    //    an emptied thread receives nothing further, so it stays hidden.
    await db.conversation.update({ where: { id: loser.id }, data: { buyerDeletedAt: new Date() } })
    console.log(`  merged ${loser.id} → ${survivor.id}`)
  }

  // 5. ⚠️ THE SURVIVOR MUST BE VISIBLE, AND THIS NEARLY SHIPPED A DISAPPEARED INBOX. The survivor is
  //    chosen on message count, which says nothing about whether the buyer had DELETED that thread
  //    from their own inbox. On the first real run they had: `buyerDeletedAt` was set seven minutes
  //    before the merge, so everything was consolidated INTO a hidden thread while the one thread
  //    they could still see was emptied and hidden — leaving no visa conversation at all. A merge
  //    is new activity by definition, so the survivor's delete marker is cleared here.
  await db.conversation.update({ where: { id: survivor.id }, data: { buyerDeletedAt: null } })

  // 6. The survivor's denormalised inbox preview must reflect what it now holds, or the list
  //    shows a line from before the merge. Recomputed from the real newest row, mirroring what
  //    insertMessage writes (lastMessageAt + a 140-char preview).
  const newest = await db.message.findFirst({
    where: { conversationId: survivor.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, body: true },
  })
  if (newest) {
    await db.conversation.update({
      where: { id: survivor.id },
      data: { lastMessageAt: newest.createdAt, lastMessageText: (newest.body || '').slice(0, 140) },
    })
  }

  const finalCount = await db.message.count({ where: { conversationId: survivor.id } })
  console.log(`\n✅ ${survivor.id} now holds ${finalCount} messages. ${losers.length} thread(s) emptied and hidden.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
