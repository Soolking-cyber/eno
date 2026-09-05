import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { getAdminUserDetail, revokeIdentity } from '@/lib/admin-users'
import { eraseAccount } from '@/lib/core/account-erasure'
import { isAdminEmail } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// One account, everything the platform knows about it, and the two actions that are only an
// admin's to take. Enforcement moves go through /api/admin/enforcement (set-state / lift) and
// messages through /api/admin/message — the console links to both rather than duplicating them.
export const GET = route({ auth: 'admin' }, async ({ params }) => {
  const id = String(params.id ?? '')
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const detail = await getAdminUserDetail(id)
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return detail
})

export const POST = route({ auth: 'admin' }, async ({ req, params, admin }) => {
  const id = String(params.id ?? '')
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let body: { action?: string; reason?: string; confirmEmail?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  const reason = String(body.reason ?? '').trim().slice(0, 120)

  switch (String(body.action ?? '')) {
    case 'revoke-identity': {
      // A revocation needs a written reason — it is unappealable without one, and the audit row
      // carries it.
      if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })
      const r = await revokeIdentity({ profileId: id, admin, reason })
      if (!r.ok) return NextResponse.json({ error: r.code }, { status: r.code === 'not_found' ? 404 : 409 })
      return { ok: true, status: r.status }
    }
    case 'erase': {
      // ⛔ THE IRREVERSIBLE ONE. The admin retypes the account's email (not "DELETE" — the wrong
      // account is the failure mode here, not a drive-by click), gives a reason that goes on the
      // audit row, and an admin account itself can never be erased from this console.
      if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 })
      const detail = await getAdminUserDetail(id)
      if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      // The admin retypes the account's email — or its phone, for a phone-only account (passwordless
      // sign-in means some profiles have no email at all, and erasure must not be impossible for them).
      const email = (detail.profile.email ?? '').toLowerCase()
      const phone = (detail.profile.phone ?? '').replace(/\s+/g, '')
      const typed = String(body.confirmEmail ?? '').trim().toLowerCase().replace(/\s+/g, '')
      const confirmed = typed.length > 0 && ((!!email && typed === email) || (!!phone && typed === phone))
      if (!confirmed) return NextResponse.json({ error: 'confirmation_mismatch' }, { status: 400 })
      if (email && isAdminEmail(email)) return NextResponse.json({ error: 'cannot_erase_admin' }, { status: 409 })
      const r = await eraseAccount(id, { kind: 'admin', email: admin, reason })
      if (!r.ok) return NextResponse.json({ error: r.code }, { status: r.code === 'not_found' ? 404 : 409 })
      return { ok: true, purge: r.purge }
    }
    default:
      return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  }
})
