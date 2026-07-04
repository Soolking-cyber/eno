'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Trash2, EyeOff, Eye, Star, Check } from 'lucide-react'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'

type Row = {
  id: string; title: string; price: number; currency: string; image: string | null
  status: string; verified: boolean; featured: boolean; sellerName: string; category: string; createdAt: string
}

const STATUS = [
  { v: 'all', label: 'All' }, { v: 'active', label: 'Active' }, { v: 'hidden', label: 'Hidden' }, { v: 'sold', label: 'Sold' },
]
const VERIFIED = [
  { v: 'all', label: 'Any' }, { v: 'true', label: 'Live' }, { v: 'false', label: 'Held' },
]

// Admin listings tool: browse + batch act (delete / hide / activate / feature /
// hold-release) over selected listings. Every action re-checks getAdmin server-side.
export function AdminListingsClient() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [verified, setVerified] = useState('all')
  const [sel, setSel] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ status, verified, limit: '80' })
    if (q.trim()) p.set('q', q.trim())
    fetch(`/api/admin/listings?${p}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.listings || []); setTotal(d.total || 0); setSel(new Set()) })
      .catch(() => toast.error('Could not load listings'))
      .finally(() => setLoading(false))
  }, [q, status, verified])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = rows.length > 0 && sel.size === rows.length
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)))

  const act = async (action: string) => {
    const ids = [...sel]
    if (!ids.length) return
    if (action === 'delete' && !confirm(`Delete ${ids.length} listing(s)? This is permanent.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }) })
      const d = await res.json()
      if (!res.ok) throw new Error()
      toast.success(`${action} · ${d.affected} listing(s)`)
      load()
    } catch { toast.error('Action failed') } finally { setBusy(false) }
  }

  const actionsDisabled = busy || sel.size === 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Listings</h1>
      <p className="mt-1 text-sm text-muted-foreground">{total} total · select to batch-act.</p>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-tint px-3 py-2">
          <Search className="h-4 w-4 text-ink-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / location…" className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-ink-4" />
        </div>
        <Segmented options={STATUS} value={status} onChange={setStatus} />
        <Segmented options={VERIFIED} value={verified} onChange={setVerified} />
      </div>

      {/* Batch action bar */}
      <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-1 rounded-xl bg-card/95 px-2 py-2 shadow-pop backdrop-blur">
        <label className="flex items-center gap-2 px-2 text-sm font-semibold text-body">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-brand" />
          {sel.size > 0 ? `${sel.size} selected` : 'Select all'}
        </label>
        <span className="mx-1 h-5 w-px bg-border" />
        <ActionBtn onClick={() => act('activate')} disabled={actionsDisabled} icon={<Eye className="h-4 w-4" />} label="Activate" />
        <ActionBtn onClick={() => act('hide')} disabled={actionsDisabled} icon={<EyeOff className="h-4 w-4" />} label="Hide" />
        <ActionBtn onClick={() => act('feature')} disabled={actionsDisabled} icon={<Star className="h-4 w-4" />} label="Feature" />
        <ActionBtn onClick={() => act('verify')} disabled={actionsDisabled} icon={<Check className="h-4 w-4" />} label="Release" />
        <ActionBtn onClick={() => act('delete')} disabled={actionsDisabled} icon={<Trash2 className="h-4 w-4" />} label="Delete" danger />
        {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin text-ink-4" />}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-ink-4" /></div>
      ) : (
        <div className="mt-2 divide-y divide-border">
          {rows.map((r) => (
            <label key={r.id} className={cn('flex cursor-pointer items-center gap-3 py-2.5', sel.has(r.id) && 'bg-tint/60')}>
              <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 shrink-0 accent-brand" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.image ? <img src={r.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-tint" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{r.title}</div>
                <div className="truncate text-xs text-muted-foreground">{formatMoneyFull(r.price, r.currency)} · {r.category} · {r.sellerName}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {r.featured && <Badge>★</Badge>}
                {!r.verified && <Badge tone="amber">held</Badge>}
                <Badge tone={r.status === 'active' ? 'green' : 'slate'}>{r.status}</Badge>
              </div>
            </label>
          ))}
          {rows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No listings match.</p>}
        </div>
      )}
    </div>
  )
}

// Module-scope so it keeps a stable identity — a component created inside the parent's
// render remounts on every keystroke/selection (the batch bar re-renders constantly).
function ActionBtn({ onClick, disabled, icon, label, danger }: { onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn('inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-body hover:bg-muted')}>
      {icon} {label}
    </button>
  )
}

function Segmented({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-tint p-1">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cn('rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors', value === o.v ? 'bg-primary text-white' : 'text-body hover:bg-muted')}>{o.label}</button>
      ))}
    </div>
  )
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' }) {
  const c = { slate: 'bg-tint text-ink-4', green: 'bg-success/10 text-success', amber: 'bg-warning/10 text-warning' }[tone]
  return <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold capitalize', c)}>{children}</span>
}
