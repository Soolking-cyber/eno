'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Check } from 'lucide-react'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { cn } from '@/lib/utils'

type Brand = {
  id: string
  slug: string
  name: string
  normalized: string
  aliases: string
  iconSlug: string | null
  logoPath: string | null
  listingCount: number
  status: string
  curatedAt: string | null
  iconPath: string | null
}

// Admin brand curation: research a brand, attach a monotone logo (a simple-icons
// slug or a pasted 24×24 SVG path), tidy the name/aliases, hide junk, or merge
// duplicates. Uncurated brands surface first so the weekly pass has a clear queue.
export function AdminBrandsClient() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch('/api/admin/brands')
      .then((r) => r.json())
      .then((d) => setBrands(d.brands || []))
      .catch(() => toast.error('Could not load brands'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return brands
    return brands.filter((b) => b.name.toLowerCase().includes(n) || b.slug.includes(n) || b.normalized.includes(n))
  }, [brands, q])

  const uncurated = brands.filter((b) => !b.curatedAt).length

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Brand curation</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {brands.length} brands · <span className="font-semibold text-accent-foreground">{uncurated} to review</span>. Attach a monotone logo (a{' '}
        <a href="https://simpleicons.org" target="_blank" rel="noreferrer" className="underline">simple-icons</a> slug, or paste a 24×24 SVG path), tidy names, or merge duplicates.
      </p>

      <div className="mt-5 flex items-center gap-2 rounded-xl bg-tint px-3.5 py-2.5">
        <Search className="h-4 w-4 text-ink-4" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brands…" className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-ink-4" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-ink-4" /></div>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {filtered.map((b) => (
            <BrandRow key={b.id} brand={b} brands={brands} open={openId === b.id} onToggle={() => setOpenId(openId === b.id ? null : b.id)} onSaved={load} />
          ))}
          {filtered.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No brands match.</p>}
        </div>
      )}
    </div>
  )
}

function BrandRow({ brand, brands, open, onToggle, onSaved }: { brand: Brand; brands: Brand[]; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [name, setName] = useState(brand.name)
  const [iconSlug, setIconSlug] = useState(brand.iconSlug || '')
  const [logoPath, setLogoPath] = useState(brand.logoPath || '')
  const [status, setStatus] = useState(brand.status)
  const [aliases, setAliases] = useState(() => { try { return (JSON.parse(brand.aliases) as string[]).join(', ') } catch { return '' } })
  const [mergeId, setMergeId] = useState('')
  const [saving, setSaving] = useState(false)

  // Live preview: typed path wins, else the server-resolved icon (simple-icons).
  const previewPath = logoPath.trim() || brand.iconPath

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/brands', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: brand.id, name, iconSlug: iconSlug.trim() || null, logoPath: logoPath.trim() || null, status, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean) }),
      })
      if (!res.ok) throw new Error()
      toast.success('Saved')
      onSaved()
    } catch { toast.error('Save failed') } finally { setSaving(false) }
  }

  const merge = async () => {
    if (!mergeId) return
    const target = brands.find((x) => x.id === mergeId)
    if (!target || !confirm(`Merge "${brand.name}" INTO "${target.name}"? Its listings + aliases move to ${target.name}, and "${brand.name}" is deleted.`)) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'merge', sourceId: brand.id, targetId: mergeId }) })
      if (!res.ok) throw new Error()
      toast.success(`Merged into ${target.name}`)
      onSaved()
    } catch { toast.error('Merge failed') } finally { setSaving(false) }
  }

  return (
    <div className="py-2.5">
      <button onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <BrandLogo name={name} iconPath={previewPath} size={28} flat />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-foreground">{name}</span>
            {!brand.curatedAt && <span className="rounded-full bg-[#0a66c2]/10 px-1.5 text-[10px] font-bold text-accent-foreground">new</span>}
            {brand.status === 'hidden' && <span className="rounded-full bg-tint px-1.5 text-[10px] font-bold text-ink-4">hidden</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{brand.slug} · {brand.listingCount} listings</span>
        </span>
      </button>

      {open && (
        <div className="mt-3 grid gap-3 rounded-2xl bg-card p-4 shadow-pop sm:grid-cols-2">
          <Field label="Display name"><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} /></Field>
          <Field label="Status">
            <div className="flex gap-2">
              {(['active', 'hidden'] as const).map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={cn('rounded-lg border px-3 py-1.5 text-sm font-semibold capitalize', status === s ? 'border-[#0a66c2] bg-[#0a66c2] text-white' : 'border-line-strong text-body hover:bg-muted')}>{s}</button>
              ))}
            </div>
          </Field>
          <Field label="simple-icons slug (e.g. apple)"><input value={iconSlug} onChange={(e) => setIconSlug(e.target.value)} placeholder="leave blank if none" className={INPUT} /></Field>
          <Field label="Aliases (comma-separated, normalized)"><input value={aliases} onChange={(e) => setAliases(e.target.value)} className={INPUT} /></Field>
          <Field label="Custom logo — monotone SVG path (24×24, overrides slug)" full>
            <textarea value={logoPath} onChange={(e) => setLogoPath(e.target.value)} rows={2} placeholder="M12 2 4 5v6.2…" className={cn(INPUT, 'font-mono text-xs')} />
          </Field>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <div className="flex items-center gap-2">
              <select value={mergeId} onChange={(e) => setMergeId(e.target.value)} className="rounded-lg border border-line-strong bg-card px-2 py-1.5 text-xs text-body">
                <option value="">Merge into…</option>
                {brands.filter((x) => x.id !== brand.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button onClick={merge} disabled={!mergeId || saving} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-muted disabled:opacity-40">Merge</button>
            </div>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a66c2] px-4 py-2 text-sm font-bold text-white hover:bg-[#004182] disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const INPUT = 'w-full rounded-xl bg-tint px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-ink-4'

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn('space-y-1', full && 'sm:col-span-2')}>
      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
