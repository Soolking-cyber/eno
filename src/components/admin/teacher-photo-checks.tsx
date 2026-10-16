import 'server-only'
import Link from 'next/link'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TriangleAlert } from '@/components/ui/icons'
import { TeacherPhotoOkButton } from '@/components/admin/teacher-photo-ok-button'

/**
 * TEACHER PHOTOS (owner, 2026-10-16) — the photos the automatic check refused at upload (`teacher.photo.refused`) and
 * the live ones it asked teachers to change (`teacher.photo.ask`), last 180 days, newest first. The human route: an admin
 * who sees a photo that IS fine taps "Photo is fine" (an override the save, the re-check and the edit page all honour).
 * Server-rendered behind the Catalogue page's getAdmin(); the button's API re-checks it.
 */
/** As long as a refusal holds (the verdict cache, photo-verdict.ts): a wrong one never leaves the queue while it still bites. */
const DAYS = 180
const REASON: Record<string, string> = { no_face: 'No face visible', not_photo: 'Not a photo (drawing, character, graphic)' }
const HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const photoUrl = (key: string) => `${HOST}/storage/v1/object/public/listings/${key}`

export async function TeacherPhotoChecks() {
  try {
    return await render()
  } catch (e) {
    logError(e, { op: 'admin.teacherPhotoChecks' })
    return (
      <Alert tone="destructive" icon={<TriangleAlert className="h-4 w-4" />} title="The teacher photo checks could not be read">
        The database read failed — reload.
      </Alert>
    )
  }
}

async function render() {
  const since = new Date(Date.now() - DAYS * 86_400_000)
  const rows = await db.complianceAudit.findMany({
    where: { action: { in: ['teacher.photo.refused', 'teacher.photo.ask'] }, subjectType: 'profile', occurredAt: { gte: since } },
    orderBy: { occurredAt: 'desc' },
    take: 200,
    select: { action: true, occurredAt: true, subjectId: true, detail: true },
  })
  const items = rows.flatMap((r) => {
    const d = (r.detail ?? {}) as { key?: unknown; reason?: unknown; listingId?: unknown }
    return typeof d.key === 'string' ? [{ ...r, key: d.key, reason: typeof d.reason === 'string' ? d.reason : '', listingId: typeof d.listingId === 'string' ? d.listingId : null }] : []
  })
  const profileIds = [...new Set(items.map((i) => i.subjectId))]
  const [overrides, teachers] = await Promise.all([
    db.complianceAudit.findMany({ where: { action: 'teacher.photo.override', subjectType: 'profile', subjectId: { in: profileIds } }, select: { subjectId: true, detail: true } }),
    db.teacherProfile.findMany({ where: { profileId: { in: profileIds } }, select: { profileId: true, fullName: true, listingId: true, photoUrl: true } }),
  ])
  const approved = new Set(overrides.map((o) => `${o.subjectId}:${(o.detail as { key?: string } | null)?.key ?? ''}`))
  const byProfile = new Map(teachers.map((t) => [t.profileId, t]))
  // One row per (teacher, photo): the latest record of it.
  const seen = new Set<string>()
  const list = items.filter((i) => { const k = `${i.subjectId}:${i.key}`; if (seen.has(k)) return false; seen.add(k); return true })

  return (
    <section aria-labelledby="teacher-photos-title" className="space-y-4">
      <div>
        <h2 id="teacher-photos-title" className="text-base font-semibold text-foreground">Teacher photos</h2>
        <p className="text-sm text-muted-foreground">
          Photos the automatic check refused when a teacher chose them, and live photos it asked teachers to change — the last {DAYS} days.
          If a photo is fine, approve it: the teacher can then save it, and nobody is asked about it again.
        </p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing refused or asked about in the last {DAYS} days.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((i) => {
            const t = byProfile.get(i.subjectId)
            const name = t?.fullName || 'A teacher (no profile yet)'
            const ok = approved.has(`${i.subjectId}:${i.key}`)
            const current = !!t?.photoUrl && t.photoUrl.endsWith(`/${i.key}`)
            return (
              <li key={`${i.subjectId}:${i.key}`}>
                <Card className="flex gap-3 p-3">
                  <img src={photoUrl(i.key)} alt="" className="size-24 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    <p className="font-semibold text-foreground">{t?.listingId ? <Link href={`/listings/${t.listingId}`} className="hover:underline">{name}</Link> : name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="neutral">{i.action === 'teacher.photo.ask' ? 'Asked to change' : 'Refused at upload'}</Badge>
                      <Badge variant="warning">{REASON[i.reason] ?? i.reason}</Badge>
                      {current && <Badge variant="neutral">Current photo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{i.occurredAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
                    {ok ? <Badge variant="success">Approved</Badge> : <TeacherPhotoOkButton profileId={i.subjectId} objectKey={i.key} name={name} />}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
