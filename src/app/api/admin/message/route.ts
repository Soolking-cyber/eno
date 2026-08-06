import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { localizedMacro } from '@/lib/admin-macros'

export const dynamic = 'force-dynamic'

// Admin → user outreach from the moderation queue. The admin can ONLY send a PRE-PREPARED
// macro (no free text) — delivered to the recipient's notification bell IN THEIR LANGUAGE
// (Profile.locale, EN/VI). One-way (warnings / requests for detail), not a two-way thread.
//
// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY. `auth: 'admin'` reproduces the
// `{"error":"Forbidden"}` 403 exactly (capital F). The old code bound `const admin = await
// getAdmin()` and then never read it — the admin's individual identity is deliberately never
// stored on the notification, which renders as "eno.vn moderation" — so nothing is destructured
// from ctx but `req`.
//
// ⚠️ NO `body:` SCHEMA, AND THE REASON IS TWO DIFFERENT 400s. Malformed JSON answers
// `{"error":"Invalid body"}` — free text, not an ApiErrorCode, so `invalidBodyCode` cannot express
// it — while a missing recipientId/macroKey answers `{"error":"Missing recipient or message"}`,
// also free text. A schema would collapse both into one code and 400 the `String(body.x || '')`
// coercion that currently accepts a number. Both stay hand-parsed. No `rateLimit:` either: there
// was none, and adding one to an admin console would be a behaviour change, not a migration.
//
// Branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · malformed JSON → 400
// `{"error":"Invalid body"}` · missing recipientId or macroKey → 400 `{"error":"Missing recipient
// or message"}` · unclaimed guest seller / unknown profile → 404
// `{"error":"recipient_unreachable"}` · macro key not in the catalogue → 400
// `{"error":"unknown_macro"}` · success → 200 `{"ok":true}`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: nothing here was wrapped in a try/catch, so a rejection from
// the Profile lookup, the Report lookup or the notification create used to reach Next's default 500
// HTML. route() now catches it, logs with an `op`, and returns `{"error":"internal_error"}` 500 —
// an improvement, and a wire change on that failure path.
export const POST = route({ auth: 'admin' }, async ({ req }) => {
  let body: { recipientId?: string; macroKey?: string; listingId?: string; conversationId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const recipientId = String(body.recipientId || '').trim()
  const macroKey = String(body.macroKey || '').trim()
  if (!recipientId || !macroKey) return NextResponse.json({ error: 'Missing recipient or message' }, { status: 400 })

  // A guest seller with no claimed account can't be notified.
  const recipient = await db.profile.findUnique({ where: { id: recipientId }, select: { id: true, locale: true } })
  if (!recipient) return NextResponse.json({ error: 'recipient_unreachable' }, { status: 404 })

  const text = localizedMacro(macroKey, recipient.locale)
  if (!text) return NextResponse.json({ error: 'unknown_macro' }, { status: 400 })

  // ROUTING: when this macro goes to the REPORTER of an open case (e.g. "need more
  // detail"), the notification must land on /reports/{id} — the page where they can
  // actually add details — NOT the buyer↔seller conversation (which conversationId
  // would deep-link to). Inferred server-side so every caller gets it right; an
  // explicit body.reportId (newer clients) takes precedence over inference.
  const listingId = body.listingId ? String(body.listingId).trim() : null
  const conversationId = body.conversationId ? String(body.conversationId).trim() : null
  let url: string | null = null
  const explicitReportId = (body as { reportId?: string }).reportId ? String((body as { reportId?: string }).reportId).trim() : null
  const reporterCase = explicitReportId
    ? await db.report.findFirst({ where: { id: explicitReportId, reporterProfileId: recipientId }, select: { id: true } })
    : (conversationId || listingId)
      ? await db.report.findFirst({
          where: {
            reporterProfileId: recipientId,
            status: 'open',
            OR: [
              ...(conversationId ? [{ conversationId }] : []),
              ...(listingId ? [{ listingId }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
      : null
  if (reporterCase) url = `/reports/${reporterCase.id}`

  await db.notification.create({
    data: {
      recipientId,
      type: 'system',
      title: 'Message from eno.vn',
      body: text,
      actorName: 'eno.vn moderation',
      listingId,
      // When the recipient is the reporter, suppress the convo deep-link fallback —
      // url wins in the bell, but keep the row's context clean regardless.
      conversationId: url ? null : conversationId,
      url,
    },
  })
  return NextResponse.json({ ok: true })
})
