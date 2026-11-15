import 'server-only'
import Link from 'next/link'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { PHOTO_HELD_NOTE, strippedPhotosOf } from '@/lib/listing-photo-hold'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TriangleAlert } from '@/components/ui/icons'
import { ListingPhotoOkButton } from '@/components/admin/listing-photo-ok-button'

/**
 * LISTING PHOTOS (owner, 2026-11-15: no flyers and no contact details in listing photos) — what the photo check did to
 * listings over the last 180 days, newest first: a listing it HELD (every photo refused: `listing.photo.held`) and photos
 * it REMOVED from a listing that kept a real one (`listing.photo.stripped`). The human route: "Photo is fine" overrides
 * that photo on that listing, puts a removed one back and re-runs the check (api/admin/listings/photo-override).
 * Server-rendered behind the Catalogue page's getAdmin(); the button's API re-checks it.
 */
/** As long as a removed photo is kept (listing-photo-pass.ts STRIPPED_KEEP_MS). */
const DAYS = 180
const REASON: Record<string, string> = { flyer: 'Flyer or ad', contact: 'Contact details' }
const HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const photoUrl = (key: string) => `${HOST}/storage/v1/object/public/listings/${key}`

type Item = { listingId: string; key: string; rule: string; held: boolean; at: Date }
const photosOf = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v : [] } catch { return [] } }

export async function ListingPhotoChecks() {
  try {
    return await render()
  } catch (e) {
    logError(e, { op: 'admin.listingPhotoChecks' })
    return (
      <Alert tone="destructive" icon={<TriangleAlert className="h-4 w-4" />} title="The listing photo checks could not be read">
        The database read failed — reload.
      </Alert>
    )
  }
}

async function render() {
  const since = new Date(Date.now() - DAYS * 86_400_000)
  const rows = await db.complianceAudit.findMany({
    where: { action: { in: ['listing.photo.held', 'listing.photo.stripped'] }, subjectType: 'listing', occurredAt: { gte: since } },
    orderBy: { occurredAt: 'desc' },
    take: 200,
    select: { action: true, occurredAt: true, subjectId: true, detail: true },
  })
  const items: Item[] = rows.flatMap((r) => {
    const held = r.action === 'listing.photo.held'
    const photos = held ? (r.detail as { photos?: Array<{ key?: unknown; rule?: unknown }> } | null)?.photos ?? [] : strippedPhotosOf(r.detail)?.removed ?? []
    return photos.flatMap((p) => (typeof p.key === 'string' ? [{ listingId: r.subjectId, key: p.key, rule: String(p.rule ?? ''), held, at: r.occurredAt }] : []))
  })
  const listingIds = [...new Set(items.map((i) => i.listingId))]
  const [overrides, listings] = await Promise.all([
    db.complianceAudit.findMany({ where: { action: 'listing.photo.override', subjectType: 'listing', subjectId: { in: listingIds } }, select: { subjectId: true, detail: true } }),
    // edition-lint-allow: the admin console's own review of rows the photo check wrote; never a public surface.
    db.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, images: true, verificationNotes: true } }),
  ])
  const approved = new Set(overrides.map((o) => `${o.subjectId}:${(o.detail as { key?: string } | null)?.key ?? ''}`))
  const byId = new Map(listings.map((l) => [l.id, l]))
  // One card per (listing, photo): its latest record.
  const seen = new Set<string>()
  const list = items.filter((i) => { const k = `${i.listingId}:${i.key}`; if (seen.has(k)) return false; seen.add(k); return true })

  return (
    <section aria-labelledby="listing-photos-title" className="space-y-4">
      <div>
        <h2 id="listing-photos-title" className="text-base font-semibold text-foreground">Listing photos</h2>
        <p className="text-sm text-muted-foreground">
          Listings the automatic photo check held because every photo was a flyer or showed contact details, and photos it removed from
          listings that kept a real one — the last {DAYS} days. If a photo is fine, approve it: a removed photo goes back, and a held
          listing goes live again once its photos pass.
        </p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing held or removed in the last {DAYS} days.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((i) => {
            const l = byId.get(i.listingId)
            const title = l?.title || 'A listing (since removed)'
            const ok = approved.has(`${i.listingId}:${i.key}`)
            const onListing = !!l && photosOf(l.images).some((u) => u.endsWith(`/${i.key}`))
            return (
              <li key={`${i.listingId}:${i.key}`}>
                <Card className="flex gap-3 p-3">
                  <img src={photoUrl(i.key)} alt="" className="size-24 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    <p className="font-semibold text-foreground">{l ? <Link href={`/listings/${i.listingId}`} className="hover:underline">{title}</Link> : title}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="neutral">{i.held ? 'Listing held' : 'Removed from the listing'}</Badge>
                      <Badge variant="warning">{REASON[i.rule] ?? i.rule}</Badge>
                      {l?.verificationNotes === PHOTO_HELD_NOTE && <Badge variant="neutral">Still held</Badge>}
                      {!i.held && onListing && <Badge variant="neutral">Back on the listing</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{i.at.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
                    {ok ? <Badge variant="success">Approved</Badge> : l ? <ListingPhotoOkButton listingId={i.listingId} objectKey={i.key} title={title} /> : null}
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
