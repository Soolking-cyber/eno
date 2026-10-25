import { ApiError, route } from '@/lib/api/handler'
import { qrSvg } from '@/lib/qr-svg'
import { classroomAddress } from '@/lib/classroom/host'
import { requireAvatar, requireTeacher } from '@/lib/classroom/guards'
import { seatOfTeacher } from '@/lib/classroom/seats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/classroom/seats/<id>/qr — the QR code of a seat's invite link, as an SVG image for the teacher's share sheet.
 * ⚠️ DRAWN HERE, NOT IN THE BROWSER: qr-svg.ts is server-only (its encoder stays out of the client bundle) — the invite
 * sheet shows this as a same-origin <img>, which the CSP already admits. Only the seat's teacher, only while the seat
 * is still an unclaimed invite with a live code.
 */
export const GET = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const avatar = await requireAvatar(teacher.id)
  const seat = await seatOfTeacher(params.id, avatar.id)
  if (!seat || seat.status !== 'invited' || !seat.inviteCode) throw new ApiError('seat_not_found', 404)
  const svg = qrSvg(`${classroomAddress()}/join/${seat.inviteCode}`, { size: 176, title: 'Invite QR code' })
  if (!svg) throw new ApiError('seat_not_found', 404)
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
})
