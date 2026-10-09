import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { actingAccountMismatch } from '@/lib/api/acting-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE one of MY notifications (owner-scoped — deleteMany by recipientId so a
// cross-user id simply deletes nothing, no 404 oracle).
//
// ⚠️ WS6 MIGRATION. `auth: 'userId'` — the old code called getCurrentProfileId() and the id is only
// the ownership scope on the deleteMany; the bell's swipe-to-dismiss calls this per row, so the
// Profile read 'profile' would add buys nothing. Guest → 401 `auth_required`, unchanged.
// `params.id` arrives already awaited from the wrapper.
//
// ⚠️ 204 + EMPTY BODY, so the handler returns the Response rather than an object (a returned object
// would become a 200 `{}`). Error-path change, deliberate: an unhandled deleteMany rejection used to
// be Next's default 500 and is now `{"error":"internal_error"}` 500.
export const DELETE = route({ auth: 'userId' }, async ({ req, params, userId }) => {
  // ⛔ FIRST (F6, as F1 did for deletes and offer answers): the account whose bell made this tap. A tab still
  // showing one account while another tab switched the shared cookie must not read or delete the OTHER account's
  // notifications. Absent header = an older client: allowed, as before.
  if (actingAccountMismatch(req, userId)) throw new ApiError('account_changed', 409)
  await db.notification.deleteMany({ where: { id: params.id, recipientId: userId } })
  return new NextResponse(null, { status: 204 })
})
