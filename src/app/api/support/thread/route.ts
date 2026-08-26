import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { getOrCreateSupportThread } from '@/lib/support-thread'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/support/thread — open (or reopen) this person's support conversation.
 *
 * ⚠️ NO BODY, AND THAT IS THE SECURITY PROPERTY. Every input is derived server-side: the buyer is
 * the session profile, the seller is the edition's support desk, the listing is null. There is no
 * field a caller could pass to open a thread as somebody else or against another edition's desk —
 * contrast `/api/conversations`, which takes a listingId and therefore has to validate it.
 *
 * ⚠️ `auth: 'profile'` MEANS THIS ROUTE CANNOT SERVE GUESTS, WHICH IS THE CURRENT PRODUCT LIMIT
 * rather than an oversight. The owner's brief was that a signed-out visitor gets a generated name
 * and lands in the thread anyway; that needs Supabase anonymous sign-in, which is DISABLED on the
 * box (`anonymous_provider_disabled`, 422). Until it is enabled there is no profile to own the
 * conversation, and `Conversation.buyerProfileId` is NOT NULL. The client keeps the email panel as
 * the signed-out path; see support-button.tsx.
 *
 * ⚠️ RATE-LIMITED EVEN THOUGH IT IS IDEMPOTENT. The first call INSERTS, and a script hammering it
 * from many fresh accounts is the cheap way to fill the table; the limit is per-profile and set
 * well above any human's use of a support button.
 */
export const POST = route(
  {
    auth: 'profile',
    rateLimit: { bucket: 'support-thread', limit: 20, window: '1 h' },
  },
  async ({ profile }) => {
    const thread = await getOrCreateSupportThread(db, profile.id)
    return { id: thread.id, created: thread.created }
  },
)
