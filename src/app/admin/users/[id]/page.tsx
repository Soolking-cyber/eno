import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft } from '@/components/ui/icons'
import { getAdmin, isAdminEmail } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { getAdminUserDetail } from '@/lib/admin-users'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { UserActionsClient } from '@/components/admin/user-actions-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'User — eno.vn admin', robots: { index: false, follow: false } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const V: Record<string, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  verified: 'success', pending: 'warning', rejected: 'destructive', revoked: 'destructive', expired: 'warning', unverified: 'neutral',
  good_standing: 'success', warned: 'warning', throttled: 'warning', held: 'destructive', suspended: 'destructive',
  approved: 'success', active: 'success', lifted: 'neutral', overturned: 'neutral',
}
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-right text-sm text-foreground">{v ?? '—'}</dd>
    </div>
  )
}

// One account, everything at a glance, the actions at the top. Server-rendered from
// getAdminUserDetail (email and phone are shown — they are what an operator searches by — and no
// document is ever linked from here: that stays with the identity queue's ownership-proved URLs).
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const { id } = await params
  const d = UUID_RE.test(id) ? await getAdminUserDetail(id) : null
  if (!d) {
    return (
      <AdminSectionShell title="User">
        <EmptyState tone="admin" title="No such account" subtitle="It may have been erased." />
        <div className="mt-4"><Link href="/admin/users" className="text-sm font-semibold text-accent-foreground hover:underline">Back to users</Link></div>
      </AdminSectionShell>
    )
  }
  const p = d.profile
  const name = p.displayName || p.email || p.id.slice(0, 8)
  const pendingCase = d.identity.find((v) => v.status === 'pending')
  return (
    <AdminSectionShell
      title={name}
      description={
        <>
          <Link href="/admin/users" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden />Users</Link>
          <span className="mx-2 text-ink-4">·</span>
          <span className="font-mono text-xs">{p.id}</span>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Badge variant={V[p.verificationStatus] ?? 'neutral'} className="capitalize">identity {p.verificationStatus === 'unverified' ? 'not verified' : p.verificationStatus}{p.verificationTier ? ` · tier ${p.verificationTier}` : ''}</Badge>
        <Badge variant={V[p.enforcementState] ?? 'neutral'} className="capitalize">{p.enforcementState.replace('_', ' ')}{p.enforcementUntil ? ` until ${when(p.enforcementUntil)}` : ''}</Badge>
        {d.seller && <Badge variant={d.seller.verifiedSeller ? 'brand' : 'neutral'}>{d.seller.verifiedSeller ? 'verified business' : 'storefront'}</Badge>}
        {p.complianceFlag && <Badge variant="destructive">{p.complianceFlag.replace('_', ' ')}</Badge>}
        {isAdminEmail(p.email) && <Badge variant="brand">admin</Badge>}
        {d.reports.openAgainst > 0 && <Badge variant="warning">{d.reports.openAgainst} open report{d.reports.openAgainst === 1 ? '' : 's'} against</Badge>}
      </div>

      {pendingCase && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-foreground">An identity submission is waiting for review (tier {pendingCase.tier}, {when(pendingCase.submittedAt)}).</p>
          <Link href="/admin/verification?tab=identity" className="text-sm font-semibold text-accent-foreground hover:underline">Open the identity queue</Link>
        </Card>
      )}

      <UserActionsClient profileId={p.id} email={p.email} phone={p.phone} verificationStatus={p.verificationStatus} enforcementState={p.enforcementState} isAdmin={isAdminEmail(p.email)} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Account</h2>
          <dl className="mt-1 divide-y divide-border">
            <Row k="Email" v={p.email} />
            <Row k="Phone" v={p.phone} />
            <Row k="Language" v={p.locale} />
            <Row k="Account type" v={p.accountType ? <span className="capitalize">{p.accountType}{p.businessName ? ` · ${p.businessName}` : ''}</span> : null} />
            <Row k="Joined" v={when(p.createdAt)} />
            <Row k="Last seen" v={when(p.lastSeenAt)} />
            <Row k="Terms accepted" v={when(p.tosAcceptedAt)} />
            <Row k="Trust" v={`${p.trustScore} · ${p.trustTier}${p.falseReportStrikes ? ` · ${p.falseReportStrikes} false-report strike${p.falseReportStrikes === 1 ? '' : 's'}` : ''}`} />
            <Row k="Reports" v={`${d.reports.filed} filed · ${d.reports.against} received · ${d.reports.openAgainst} open`} />
          </dl>
        </Card>

        <Card className="px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Identity</h2>
          <dl className="mt-1 divide-y divide-border">
            <Row k="Status" v={<span className="capitalize">{p.verificationStatus}</span>} />
            <Row k="Method" v={p.verificationMethod} />
            <Row k="Verified at" v={when(p.verifiedAt)} />
            <Row k="Document expires" v={when(p.documentExpiresAt)} />
          </dl>
          {d.identity.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-2">
              {d.identity.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant={V[v.status] ?? 'neutral'} className="capitalize">{v.status}</Badge>
                  <span>tier {v.tier} · {v.method}{v.nationality ? ` · ${v.nationality}` : ''}</span>
                  <span>· submitted {when(v.submittedAt)}</span>
                  {v.decidedAt && <span>· decided {when(v.decidedAt)} by {v.decidedBy}{v.rejectReason ? ` (${v.rejectReason})` : ''}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Storefront</h2>
          {d.seller ? (
            <>
              <dl className="mt-1 divide-y divide-border">
                <Row k="Name" v={<Link href={`/sellers/${d.seller.id}`} className="text-accent-foreground hover:underline">{d.seller.name}</Link>} />
                <Row k="Listings" v={`${d.seller.listings.active} active of ${d.seller.listings.total}`} />
                <Row k="Legal name" v={d.seller.legalName} />
                <Row k="Tax code" v={d.seller.taxCode} />
                <Row k="Member since" v={when(d.seller.memberSince)} />
                <Row k="Business verified until" v={when(d.seller.verifiedUntil)} />
              </dl>
              {d.seller.verificationCases.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-2">
                  {d.seller.verificationCases.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant={V[c.status] ?? 'neutral'} className="capitalize">{c.status}</Badge>
                      <Link href={`/admin/business-verification/${c.id}`} className="text-accent-foreground hover:underline">case {c.id.slice(0, 8)}</Link>
                      <span>· {c.submittedAt ? `submitted ${when(c.submittedAt)}` : 'draft'}{c.reviewedAt ? ` · reviewed ${when(c.reviewedAt)} by ${c.reviewedBy}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No storefront.</p>
          )}
        </Card>

        <Card className="px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">Enforcement</h2>
          {d.enforcement.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No actions on record.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {d.enforcement.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant={V[e.state] ?? 'neutral'} className="capitalize">{e.state.replace('_', ' ')}</Badge>
                  <Badge variant={V[e.status] ?? 'neutral'} className="capitalize">{e.status}</Badge>
                  <span>{e.reason.replace(/_/g, ' ')} · by {e.decidedBy} · {when(e.createdAt)}{e.expiresAt ? ` → ${when(e.expiresAt)}` : ''}{e.liftedAt ? ` · lifted ${when(e.liftedAt)}` : ''}</span>
                  {e.adminNote && <span className="w-full text-ink-4">“{e.adminNote}”</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Appeals, lifts and overturns: <Link href="/admin/moderation?tab=enforcement" className="text-accent-foreground hover:underline">Enforcement tab</Link>.
          </p>
        </Card>

        <Card className="px-4 py-3 lg:col-span-2">
          <h2 className="text-sm font-bold text-foreground">Audit trail</h2>
          {d.audit.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Nothing recorded for this account.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {d.audit.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 py-1.5 text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{a.action}</span>
                  <span>· {a.actorType}{a.actorId ? ` ${a.actorId}` : ''}</span>
                  <span className="ml-auto text-ink-4">{when(a.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminSectionShell>
  )
}
