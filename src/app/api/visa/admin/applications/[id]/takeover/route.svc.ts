import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getAdmin } from '@/lib/admin'
import { getVisaDeskOperator } from '@/lib/desk-operator'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaDb } from '@/lib/visa/db'
import { visaDmFailureFor } from '@/lib/visa/dm-flow'
import { setVisaThreadMode } from '@/lib/visa/dm-thread'

// "IF NEEDED ADMIN CAN TAKE OVER CHAT" — the human stepping in front of the wizard.
//
// active:true  → mode 'admin' → the wizard STOPS emitting cards (sendVisaStepCard refuses
//                outright, and advanceVisaDmFlow declines to post anything at all, including
//                the pay card, so an automatic loop cannot talk over a human mid-sentence).
// active:false → mode 'ai'    → the applicant's next /advance resumes the loop where it left
//                off. This route deliberately does not advance on the admin's behalf: the
//                wizard is the applicant's surface and it restarts when they act.
//
// The transition is recorded as visa_events `admin_takeover_started` / `admin_takeover_ended`
// — the same append-only log the mode is DERIVED from (newest wins), so there is no column
// to migrate and the audit trail and the state are the same fact.
//
// ⚠️ ENTITLEMENT LIVES HERE, and it is the ADMIN gate: getAdmin() re-verifies the session
// with the auth server (not a locally-decoded claim) and matches it against ADMIN_EMAILS.
// Admin powers are the documented exception to the getClaims() fast path in src/lib/admin.ts
// — a revoked admin must lose this immediately, not at token expiry.
//
// Reads no payload and decrypts nothing: a takeover is a routing decision about a
// conversation, not access to passport data.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ active: z.boolean() }).strict()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ⚠️ WS6 — NOT MIGRATED: ONE CHARACTER, AND IT IS THE WHOLE REASON. Everything else here lines up
// with the wrapper exactly — the order is auth → rateLimit (429 `rate_limited`, the wrapper's own
// code) → body (400 `invalid_request`, which `invalidBodyCode` supports) → the handler's uuid/404 —
// so this is the closest a route in this cluster comes to migrating. It cannot, because the
// non-admin refusal on the wire is `{"error":"forbidden"}` and `auth: 'admin'` is hardcoded to
// `apiFail('Forbidden', 403)` (handler.ts:189). errors.ts lists both spellings because both are
// live; the wrapper picked one, and this route is on the other.
//
// And with the admin gate pinned in the handler, `rateLimit:` cannot move either: the bucket is
// keyed on the ADMIN EMAIL, which the wrapper has no way to supply — `auth:'admin'` leaves `userId`
// null, so it would fall back to `clientIp(req)` and pool the desk behind one address.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // ⚠️ THE VISA DESK'S OPERATOR, NOT A SITE ADMIN. This was getAdmin(), which on eno.vn would have
  // required putting VietKite into ADMIN_EMAILS to let them do the job they are paid for — filing
  // the visas they sell — and that grants every dispute room, every report and every OTHER
  // applicant's documents along with it. getVisaDeskOperator() still accepts an admin, so eno's own
  // support account is unaffected; it also accepts the account that owns THIS deployment's visa
  // storefront, and only that desk. See src/lib/desk-operator.ts.
  const admin = await getVisaDeskOperator()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  // Fails OPEN (no `strict`): this route is already admin-gated, so a limiter outage must
  // not be able to lock the desk out of a conversation it is trying to rescue.
  const limit = await rateLimit('visa-dm-takeover', admin, 120, '1 h')
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    // The case must exist before an event is written against it — visa_events has no FK to
    // lean on here, so an unchecked id would mint an orphan audit row that
    // getVisaThreadMode would happily read back.
    const { data: application, error } = await getVisaDb()
      .from('visa_applications').select('id').eq('id', id).maybeSingle()
    if (error) throw error
    if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const mode = parsed.data.active ? 'admin' : 'ai'
    // Throws on a failed write (dm-thread.ts's one loud path): an admin who believes they
    // took the thread over while the wizard keeps posting is the exact failure this must
    // never hide. actorRef is the admin's email — the audit answer to "who took this over".
    await setVisaThreadMode({ applicationId: id, mode, actorType: 'admin', actorRef: admin })
    return NextResponse.json({ mode })
  } catch (error) {
    const failure = visaDmFailureFor(error)
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }
}
