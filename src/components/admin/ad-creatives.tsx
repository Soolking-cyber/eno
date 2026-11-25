import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TriangleAlert } from '@/components/ui/icons'
import { storedPermitClasses, storedReasons } from '@/lib/ads/creative-review'
import { isProvisionalReview } from '@/lib/ads/review-jev'
import { AdRemoveButton } from '@/components/admin/ad-remove-button'

/**
 * ADS (owner 2026-11-25: any lawful advertiser, reviewed before payment; eno may remove an unlawful ad) — every creative an
 * advertiser submitted, newest first, with the review's verdict (its reasons, the permit classes it falls in and the
 * advertiser's permit number), the advertiser's legal identity, and its runs. "Remove" takes one down for good
 * (api/admin/ads/remove → src/lib/ads/admin.ts): it stops serving within a minute; the unused part of a run is shown for
 * the manual pro-rata refund. Server-rendered behind the Catalogue page's getAdmin(); the button's API re-checks it.
 */
const TAKE = 200

export async function AdCreatives() {
  try {
    return await render()
  } catch (e) {
    logError(e, { op: 'admin.adCreatives' })
    return (
      <Alert tone="destructive" icon={<TriangleAlert className="h-4 w-4" />} title="The ads could not be read">
        The database read failed (before scripts/listing-ad-ddl.mjs has run, the table does not exist) — reload.
      </Alert>
    )
  }
}

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  approved: { label: 'Approved', variant: 'success' },
  refused: { label: 'Refused', variant: 'warning' },
  removed: { label: 'Removed', variant: 'neutral' },
}
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`

async function render() {
  const now = new Date()
  const creatives = await db.adCreative.findMany({ orderBy: { createdAt: 'desc' }, take: TAKE })
  const ids = creatives.map((c) => c.id)
  const runs = ids.length
    ? await db.listingAd.findMany({ where: { creativeId: { in: ids }, status: { in: ['active', 'pending', 'unknown', 'review'] } }, select: { id: true, creativeId: true, status: true, startsAt: true, endsAt: true, impressions: true, clicks: true } })
    : []
  const runsOf = new Map<string, typeof runs>()
  for (const r of runs) if (r.creativeId) runsOf.set(r.creativeId, [...(runsOf.get(r.creativeId) ?? []), r])

  return (
    <section aria-labelledby="ad-creatives-title" className="space-y-4">
      <div>
        <h2 id="ad-creatives-title" className="text-base font-semibold text-foreground">Ads</h2>
        <p className="text-sm text-muted-foreground">
          Advertisers&apos; own ads for the feed card, as the automatic review judged them before any payment — the newest {TAKE}.
          Permit classes (medicines, cosmetics, finance …) are allowed and flagged here with the advertiser&apos;s permit number.
          Remove takes an ad down for good: it stops showing within a minute, and its unused time is refunded pro rata on request.
        </p>
      </div>
      {creatives.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ad has been submitted yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {creatives.map((c) => {
            const st = STATUS[c.status] ?? { label: c.status, variant: 'neutral' as const }
            const reasons = storedReasons(c.reasons)
            const permits = storedPermitClasses(c.scores)
            const mine = runsOf.get(c.id) ?? []
            const live = mine.filter((r) => r.status === 'active' && r.startsAt && r.endsAt && r.startsAt <= now && r.endsAt > now)
            return (
              <li key={c.id}>
                <Card className="flex gap-3 p-3">
                  {c.imageUrl
                    // Admin chrome: a plain thumbnail of eno's own copy, as listing-photo-checks.tsx draws its photos.
                    ? <img src={c.imageUrl} alt="" className="size-24 shrink-0 rounded-lg bg-muted object-cover" loading="lazy" />
                    : <div className="flex size-24 shrink-0 items-center justify-center rounded-lg bg-muted p-2 text-center text-xs text-muted-foreground">No picture kept</div>}
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    <p className="font-semibold text-foreground">{c.headline}</p>
                    {c.body && <p className="text-muted-foreground">{c.body}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {isProvisionalReview(c.reviewModel) && <Badge variant="warning">Provisional review</Badge>}
                      {permits.map((p) => <Badge key={p} variant="neutral">Permit: {p}</Badge>)}
                      {live.length > 0 && <Badge variant="success">Running</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {/* The tax or registration number is optional (any advertiser, 2026-11-25): an MST or a foreign company's number. */}
                      {c.advertiserName} · {c.legalName} · {c.taxCode ? `tax/reg. no. ${c.taxCode}` : 'no tax/reg. no.'}{c.permitRef ? ` · permit ${c.permitRef}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {/* Only an approved ad's page is a link: a refused one's is the advertiser's URL the review rejected. */}
                      {c.status === 'approved'
                        ? <a href={c.clickUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">{c.landingHost}</a>
                        : <span>{c.landingHost}</span>}
                      {' · '}{c.sourceLang} · reviewed {utc(c.reviewedAt)} · shop {c.sellerId}
                    </p>
                    {reasons.length > 0 && (
                      <ul className="list-disc pl-4 text-xs text-muted-foreground">
                        {reasons.map((r) => <li key={r.code}><span className="font-mono">{r.code}</span> — {r.en}</li>)}
                      </ul>
                    )}
                    {mine.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {mine.length} run{mine.length === 1 ? '' : 's'}: {mine.map((r) => `${r.status}${r.endsAt ? ` to ${utc(r.endsAt)}` : ''} (${r.impressions} views, ${r.clicks} clicks)`).join('; ')}
                      </p>
                    )}
                    {c.status === 'removed'
                      ? <p className="text-xs text-muted-foreground">Removed {c.removedAt ? utc(c.removedAt) : ''}{c.removedReason ? ` — ${c.removedReason}` : ''}</p>
                      : c.status === 'approved' ? <AdRemoveButton creativeId={c.id} headline={c.headline} /> : null}
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
