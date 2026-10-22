import 'server-only'
import { db } from './db'
import { getSupabaseAdmin } from './supabase-admin'
import { getOrCreateSupportThread, SUPPORT_SELLER_ID } from './support-thread'
import { insertMessage } from './messages'
import { logError } from './log'
import type { InboundWhatsAppMessage } from './whatsapp'

/**
 * TURN AN INBOUND WHATSAPP MESSAGE INTO A MESSAGE IN THAT PERSON'S SUPPORT THREAD.
 *
 * ⛔ THE SUPPORT THREAD IS THE RIGHT ANCHOR AND A NEW TABLE WOULD HAVE BEEN THE WRONG ONE. It
 * already means "this person talking to us, about nothing in particular" (`listingId: null`), it is
 * already one per person per edition, and it already renders in /messages with the offer bar,
 * listing subtitle and reveal-number action hidden. A parallel WhatsApp inbox would have to
 * reproduce all of that and would still not be where support looks.
 *
 * ⛔ AND IT IS WHY A WHATSAPP SENDER NEEDS A REAL ACCOUNT. `Conversation.buyerProfileId` is a FK to
 * `Profile`, whose id IS `auth.users.id` under the cross-schema constraint `profile_auth_fk` — so a
 * message in /messages is not expressible without one. The person proved control of the number by
 * messaging from it, which is the same evidence phone OTP collects, so the auth user is created
 * `phone_confirm: true`: when they later sign in with that number they get THIS account and see
 * this history, rather than a second empty one beside it.
 * ⚠️ THAT IS A REAL SIDE EFFECT AND IT IS DELIBERATE: anyone who messages the business number gets
 * an account. It is what "deliver messages to support within app" requires, and it is how every
 * business-messaging bridge behaves, but it should be a decision someone made on purpose.
 */

/** E.164 with '+', which is what `Profile.phone` stores; Meta sends it without. */
const plus = (waId: string) => (waId.startsWith('+') ? waId : `+${waId}`)

/**
 * ⛔ MATCH ONLY A GoTrue-CONFIRMED PHONE, NEVER `Profile.phone` (security review 2026-10-22, item 6).
 * `Profile.phone` is self-service: PATCH /api/profile and /api/seller write it with NO OTP (the schema
 * even calls it a mirror of a verified auth phone, but nothing enforces that). Matching on it meant an
 * attacker could PATCH their own profile to a victim's number and then RECEIVE that victim's first
 * support conversation with the e-Visa desk — passport scans, payment instructions settled in chat.
 * `auth.users.phone` is set with `phone_confirmed_at` only by this bridge (which the person reaches
 * only by messaging FROM the number, through Meta's signed webhook) or by a real phone OTP — neither
 * of which an attacker can point at a number they do not control. auth.users stores the phone WITHOUT
 * '+', which is exactly the raw `wa_id` Meta sends.
 */
async function confirmedPhoneOwner(waId: string): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM auth.users
    WHERE phone = ${waId} AND phone_confirmed_at IS NOT NULL
    LIMIT 1`
  return rows[0]?.id ?? null
}

async function profileForWhatsApp(waId: string, name?: string): Promise<string | null> {
  const phone = plus(waId)
  const existingId = await confirmedPhoneOwner(waId)
  if (existingId) return existingId

  /**
   * ⚠️ CREATE THE AUTH USER FIRST, THEN LET THE PROFILE FOLLOW IT. The FK runs that way round, and
   * Supabase's own trigger mirrors a new auth user into `Profile` — so this re-reads rather than
   * inserting a Profile itself, which would race that trigger and violate the constraint.
   */
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.auth.admin.createUser({
    /**
     * ⚠️ E.164 WITH THE '+', which is the documented form GoTrue accepts and normalises. Meta sends
     * `wa_id` without it, and it was passed through raw on the reasoning that auth.users stores it
     * that way — true of STORAGE, not of the API's input. A rejected create would have failed every
     * first-time sender, and a record that did not match a later `+84…` OTP sign-in would have
     * given the same person a second, empty account — the opposite of the history-linking this
     * whole path exists for.
     */
    phone: plus(waId),
    phone_confirm: true,
    user_metadata: { name: name || undefined, signup_source: 'whatsapp' },
  })
  if (error || !data.user) {
    /**
     * ⚠️ A DUPLICATE IS NOT A FAILURE — it is the race between two messages arriving together, and
     * the answer is the row the winner made. Anything else is reported: a support message silently
     * not appearing is the one outcome this bridge must never produce.
     */
    // The racing winner created the auth user with phone_confirm:true, so match it the same way —
    // by the confirmed auth phone, never Profile.phone (see confirmedPhoneOwner).
    const again = await confirmedPhoneOwner(waId)
    if (again) return again
    logError(error ?? new Error('createUser returned no user'), { op: 'whatsapp.createUser' })
    return null
  }

  const id = data.user.id
  // The mirror trigger runs on the auth side; make sure the row is there and carries the phone.
  await db.profile.upsert({
    where: { id },
    update: { phone },
    create: { id, phone, displayName: name?.slice(0, 80) || null },
  }).catch((e) => logError(e, { op: 'whatsapp.profileUpsert' }))
  return id
}

export type BridgeResult = { delivered: number; duplicates: number; failed: number }

/**
 * ⛔ IDEMPOTENT ON META'S `wamid`, BECAUSE A WEBHOOK IS AT-LEAST-ONCE. Meta redelivers any delivery
 * that does not return 200 — including one that timed out AFTER we committed the message — so
 * without a dedupe key a slow night duplicates every support message. `wamid` is the only stable
 * identifier in the envelope and it is unique per message.
 */
export async function deliverInboundWhatsApp(messages: InboundWhatsAppMessage[]): Promise<BridgeResult> {
  let delivered = 0, duplicates = 0, failed = 0
  for (const m of messages) {
    /**
     * ⛔ CLAIM FIRST, ATOMICALLY, THEN WRITE THE MESSAGE. A read-then-write dedupe is not one: two
     * simultaneous deliveries of the same `wamid` — which is exactly what a Meta redelivery racing
     * a slow original looks like — both saw "not seen", and both inserted a message; only the
     * second `create` failed, long after the duplicate was in the thread. The primary key is the
     * only thing that can arbitrate, so the INSERT is the claim and the loser gets P2002 here,
     * before it can author anything.
     */
    let claimed = false
    try {
      const profileId = await profileForWhatsApp(m.from, m.name)
      if (!profileId) { failed++; continue }
      const thread = await getOrCreateSupportThread(db, profileId)

      try {
        await db.whatsAppInbound.create({ data: { wamid: m.wamid, profileId, conversationId: thread.id, waId: m.from } })
        claimed = true
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2002') throw e
        /**
         * ⛔ A CLAIM IS NOT A DELIVERY, AND CONFLATING THEM LOSES MESSAGES. The row is written
         * before the message so two concurrent deliveries cannot both author one — but a process
         * that dies in between leaves a claim with nothing behind it, and treating every P2002 as
         * "already delivered" would then swallow that message on every retry, for ever, while
         * answering 200. `deliveredAt` is what separates the two: set only once the message is in
         * the thread, so an unfinished claim is retryable and a finished one is a true duplicate.
         */
        const prior = await db.whatsAppInbound.findUnique({ where: { wamid: m.wamid }, select: { deliveredAt: true } })
        if (prior?.deliveredAt) { duplicates++; continue }
        claimed = true   // a stale claim from a crashed run — take it over and finish the job
      }

      await insertMessage(
        { id: thread.id, buyerProfileId: profileId, sellerProfileId: null, listingId: null },
        profileId,
        m.text.slice(0, 4000),
      )
      await db.whatsAppInbound.update({ where: { wamid: m.wamid }, data: { deliveredAt: new Date() } })
      delivered++
    } catch (e) {
      /**
       * ⛔ RELEASE THE CLAIM, OR THE RETRY IS REFUSED AS A DUPLICATE AND THE MESSAGE IS LOST FOR
       * GOOD. Claiming first is what makes concurrency safe; releasing on failure is what keeps it
       * from turning a transient blip into permanent silence. The caller then answers non-200 so
       * Meta redelivers, and the claim is free to be taken again.
       */
      if (claimed) {
        await db.whatsAppInbound.delete({ where: { wamid: m.wamid } })
          .catch((e2) => logError(e2, { op: 'whatsapp.releaseClaim' }))
      }
      logError(e, { op: 'whatsapp.deliverInbound' })
      failed++
    }
  }
  return { delivered, duplicates, failed }
}

/**
 * Is this conversation a WhatsApp-bridged support thread, and to which number?
 *
 * ⛔ THE BUYER'S PHONE IS NOT ENOUGH ON ITS OWN. Most people with a phone on their profile never
 * messaged the business number, and relaying a support reply to them over WhatsApp would be an
 * unsolicited message from a business account — the thing that gets a WhatsApp sender banned. The
 * presence of an inbound row is the consent: they opened the channel.
 */
export async function whatsappRecipientFor(conversationId: string): Promise<string | null> {
  const inbound = await db.whatsAppInbound.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    // ⚠️ The number is stored ON THE ROW rather than read back through Profile.phone: this table
    // is deliberately FK-free (see schema.prisma) so it stays an additive migration, and the wa_id
    // Meta sent is the address that actually opened the channel.
    select: { waId: true },
  })
  return inbound?.waId ?? null
}

export { SUPPORT_SELLER_ID }
