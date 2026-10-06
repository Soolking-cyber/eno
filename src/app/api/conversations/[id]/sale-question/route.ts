import { db } from '@/lib/db'
import { route, ApiError } from '@/lib/api/handler'
import { isSellerHiddenHere } from '@/lib/edition-scope'
import { openSaleQuestions } from '@/lib/core/sale-loop'
import { isBlockedBetween } from '@/lib/user-blocks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/conversations/[id]/sale-question — what THIS thread's seller is asking the caller to confirm.
 *
 * The buyer's half of the trade loop is shown IN the thread with the seller: that is where the "did you
 * buy this?" notification and push open (POST /api/listings/[id]/sold), and where the buyer already
 * knows the person asking. The thread page fetches this once per open (not on its 15s poll — the
 * thread GET is the app's most-polled route and stays untouched) and mounts sale-confirm-prompt.tsx for
 * each question; the answer goes to POST /api/listings/[id]/sale-confirmation.
 *
 * ⚠️ BY SELLER, NOT BY THE THREAD'S CURRENT LISTING. A thread is one-per-buyer-per-seller and is
 * retargeted to whatever the buyer asked about last, so the sold item is often not the one the thread
 * shows now. Every open question from this seller to this buyer belongs here (src/lib/core/sale-loop.ts
 * openSaleQuestions — the same rule the answer route enforces, edition-scoped).
 *
 * Branches: guest → 401 auth_required · unknown thread, or one this edition hides → 404 not_found (the
 * thread GET's own answer) · not this thread's BUYER → 403 forbidden · a block between the buyer and the seller,
 * either way (gate `ugc-safety`) → 200 {"questions":[]} · success → 200 {"questions":[…]}.
 */
export const GET = route({ auth: 'userId' }, async ({ params, userId }) => {
  const convo = await db.conversation.findUnique({
    where: { id: params.id },
    select: { buyerProfileId: true, seller: { select: { id: true, ownerId: true } } },
  })
  if (!convo) throw new ApiError('not_found', 404)
  if (await isSellerHiddenHere(convo.seller.id)) throw new ApiError('not_found', 404)
  if (convo.buyerProfileId !== userId) throw new ApiError('forbidden', 403)
  // ⛔ App Store gate `ugc-safety`: nothing is asked across a block, EITHER way — the asker is the storefront's
  // owner, the profile POST /sold checks. The answer route refuses alike. Off ⇒ no query.
  if (await isBlockedBetween(userId, convo.seller.ownerId)) return { questions: [] }
  return { questions: await openSaleQuestions(userId, convo.seller, new Date()) }
})
