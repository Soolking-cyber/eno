import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'

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
export const DELETE = route({ auth: 'userId' }, async ({ params, userId }) => {
  await db.notification.deleteMany({ where: { id: params.id, recipientId: userId } })
  return new NextResponse(null, { status: 204 })
})
