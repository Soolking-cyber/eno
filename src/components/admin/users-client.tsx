'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Search } from '@/components/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { shortDate } from '@/lib/dates'
import type { AdminUserFilter, AdminUserRow } from '@/lib/admin-users'

// The Users list — search + a few "what needs attention" filters, paged by cursor. Reads
// GET /api/admin/users (auth: 'admin' re-checked there). Admin chrome is EN-only.
const FILTERS: Array<{ key: AdminUserFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending_identity', label: 'Identity pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'sellers', label: 'Sellers' },
  { key: 'enforced', label: 'Under enforcement' },
]

const VERIFICATION_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  verified: 'success', pending: 'warning', rejected: 'destructive', revoked: 'destructive', expired: 'warning', unverified: 'neutral',
}
const STATE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  good_standing: 'success', warned: 'warning', throttled: 'warning', held: 'destructive', suspended: 'destructive',
}

export function UsersClient({ initialFilter = 'all', initialQuery = '' }: { initialFilter?: AdminUserFilter; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery)
  const [filter, setFilter] = useState<AdminUserFilter>(initialFilter)
  const [rows, setRows] = useState<AdminUserRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async (opts: { q: string; filter: AdminUserFilter; cursor?: string | null }) => {
    const id = ++reqId.current
    setBusy(true); setFailed(false)
    try {
      const params = new URLSearchParams({ q: opts.q, filter: opts.filter })
      if (opts.cursor) params.set('cursor', opts.cursor)
      const res = await fetch(`/api/admin/users?${params}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { rows: AdminUserRow[]; nextCursor: string | null }
      if (id !== reqId.current) return // a newer search superseded this one
      setRows((prev) => (opts.cursor && prev ? [...prev, ...data.rows] : data.rows))
      setCursor(data.nextCursor)
    } catch {
      if (id === reqId.current) setFailed(true)
    } finally {
      if (id === reqId.current) setBusy(false)
    }
  }, [])

  // Debounced search: the list follows the box without a submit, but never fires per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load({ q, filter }) }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, filter, load])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-xl bg-tint px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
          <Input
            variant="unstyled"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Email, name, phone, id or storefront…"
            aria-label="Search users"
            className="min-w-0 flex-1 text-sm"
          />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-4" aria-label="Loading" />}
        </div>
        <div role="group" aria-label="Filter users" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={filter === f.key ? 'cta' : 'outline'}
              size="none"
              className="rounded-full px-3 py-1.5 text-xs"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {failed ? (
        <div className="mt-4">
          <EmptyState tone="admin" title="Could not load users" subtitle="The list request failed — try again." />
          <div className="mt-2 text-center"><Button variant="outline" onClick={() => void load({ q, filter })}>Retry</Button></div>
        </div>
      ) : rows === null ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-4"><EmptyState tone="admin" title="No accounts match" subtitle={q ? `Nothing for “${q}”.` : 'Nothing in this filter.'} /></div>
      ) : (
        <Card className="mt-4 py-0">
          <ul className="divide-y divide-border">
            {rows.map((u) => (
              <li key={u.id}>
                <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-foreground">{u.displayName || u.email || u.id.slice(0, 8)}</span>
                      <Badge variant={VERIFICATION_VARIANT[u.verificationStatus] ?? 'neutral'} className="capitalize">
                        {u.verificationStatus === 'unverified' ? 'not verified' : u.verificationStatus}{u.verificationTier ? ` · ${u.verificationTier}` : ''}
                      </Badge>
                      {u.enforcementState !== 'good_standing' && (
                        <Badge variant={STATE_VARIANT[u.enforcementState] ?? 'neutral'} className="capitalize">{u.enforcementState.replace('_', ' ')}</Badge>
                      )}
                      {u.seller && <Badge variant={u.seller.verifiedSeller ? 'brand' : 'neutral'}>{u.seller.name} · {u.seller.listings} listing{u.seller.listings === 1 ? '' : 's'}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {u.email ?? 'no email'}{u.phone ? ` · ${u.phone}` : ''} · trust {u.trustScore} ({u.trustTier})
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-3xs text-ink-4">
                    <p>joined {shortDate(u.createdAt)}</p>
                    {u.lastSeenAt && <p>seen {shortDate(u.lastSeenAt)}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {cursor && !failed && (
        <div className="mt-3 text-center">
          <Button variant="outline" disabled={busy} onClick={() => void load({ q, filter, cursor })}>Load more</Button>
        </div>
      )}
    </div>
  )
}
