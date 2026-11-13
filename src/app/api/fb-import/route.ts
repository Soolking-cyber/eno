import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { facebookConnectionState } from '@/lib/auth/facebook-connect'
import { getVerifiedPhone } from '@/lib/admin'
import { logError } from '@/lib/log'
import type { ReportedItem } from '@/lib/fb-import/shared'
import { fbImportOn } from '@/lib/fb-import/available'

export const dynamic = 'force-dynamic'

// My listings › Import from Facebook: the latest import and its drafts.
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const on = await fbImportOn()
  const [job, olderDrafts, conn, seller, verifiedPhone] = await Promise.all([
    db.facebookImportJob.findFirst({ where: { profileId: userId }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, createdAt: true, items: { orderBy: { createdAt: 'asc' } } } }),
    // An import that found nothing must not hide what the seller already edited from the last one.
    db.facebookImportItem.findMany({ where: { status: 'draft', job: { profileId: userId } }, orderBy: { createdAt: 'asc' } }),
    facebookConnectionState(userId).catch((e: unknown) => { logError(e, { op: 'fb-import.state' }); return { connected: false } }),
    db.seller.findUnique({ where: { ownerId: userId }, select: { phone: true } }),
    getVerifiedPhone().catch(() => null),
  ])
  return NextResponse.json({
    on,
    connected: conn.connected,
    // Their own number, already on file: nothing to type at Publish.
    phone: seller?.phone || verifiedPhone || null,
    job: job && {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      items: [...olderDrafts.filter((d) => d.jobId !== job.id && !job.items.some((i) => i.fbItemId === d.fbItemId)), ...job.items].map((i) => {
        const raw = i.raw as unknown as ReportedItem
        return { id: i.id, status: i.status, title: i.title ?? (i.titleVi != null ? null : raw.title), description: i.description ?? (i.descriptionVi != null ? null : raw.description ?? ''), titleVi: i.titleVi, descriptionVi: i.descriptionVi, fbTitle: raw.title, fresh: i.jobId === job.id, price: i.price, fbPrice: raw.currency === 'VND' && raw.priceAmount && i.price != null && Number(raw.priceAmount) !== i.price ? raw.priceAmount : null, district: i.district, city: i.city, categorySlug: i.categorySlug, subcategorySlug: i.subcategorySlug, listingType: i.listingType, condition: i.condition, attributes: i.attributes, reason: i.reason, listingId: i.listingId, photo: raw.photos?.[0] ?? null, photoCount: raw.photos?.length ?? 0 }
      }),
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
})
