'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Check, Sparkles, Upload } from 'lucide-react'
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
        <a href="https://simpleicons.org" target="_blank" rel="noreferrer" className="underline">simple-icons</a> slug, or paste a full SVG / path), tidy names, or merge duplicates.
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
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPath, setAiPath] = useState<string | null>(null) // AI-suggested logo preview
  const [aiNote, setAiNote] = useState<string | null>(null)

  // Live preview: typed custom path wins, then an AI suggestion, then the saved icon.
  const previewPath = logoPath.trim() || aiPath || brand.iconPath

  // Upload an .svg file → load its markup into the logo field for review.
  const onSvgFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 200_000) { toast.error('SVG too large (max 200 KB)'); return }
    let text = (await file.text()).trim()
    if (!/<svg[\s\S]*<\/svg>/i.test(text)) { toast.error('That file is not a valid SVG'); return }
    const svgAt = text.search(/<svg[\s>]/i) // drop any <?xml …?> prolog
    if (svgAt > 0) text = text.slice(svgAt)
    setLogoPath(text)
    setAiPath(null)
    toast.success('SVG loaded — review + Save')
  }

  // AI lookup: canonicalize the name + find a real simple-icons logo to approve.
  const aiSuggest = async () => {
    setAiBusy(true); setAiNote(null)
    try {
      const res = await fetch('/api/admin/brands/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const d = await res.json()
      if (!res.ok) throw new Error()
      if (d.name) setName(d.name)
      if (d.iconSlug) { setIconSlug(d.iconSlug); setAiPath(d.iconPath || null); toast.success('AI found a logo — review + Save') }
      else { setAiPath(null); toast(d.note ? `No logo match — ${d.note}` : 'No logo match — keep monogram or paste a path') }
      setAiNote(d.note || null)
    } catch { toast.error('AI lookup failed') } finally { setAiBusy(false) }
  }

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
          {/* AI assist — canonicalize the name + find a real monotone logo to approve. */}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button onClick={aiSuggest} disabled={aiBusy} className="inline-flex items-center gap-1.5 rounded-xl border border-[#0a66c2]/30 px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:bg-tint disabled:opacity-50">
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI suggest logo &amp; name
            </button>
            {aiNote && <span className="text-xs text-muted-foreground">{aiNote}</span>}
            <span className="text-[11px] text-ink-4">— review, then Save to approve.</span>
          </div>
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
          <Field label="Custom logo — upload an .svg, paste a full <svg>…</svg>, or a monotone path (overrides slug)" full>
            <div className="mb-1.5 flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold text-body hover:bg-muted">
                <Upload className="h-3.5 w-3.5" /> Upload .svg
                <input type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => { onSvgFile(e.target.files?.[0]); e.currentTarget.value = '' }} />
              </label>
              {logoPath && <button type="button" onClick={() => { setLogoPath(''); setAiPath(null) }} className="text-xs font-semibold text-ink-4 hover:text-foreground">Clear logo</button>}
            </div>
            <textarea value={logoPath} onChange={(e) => setLogoPath(e.target.value)} rows={2} placeholder={'<svg viewBox="0 0 24 24">…</svg>  or  M12 2 4 5v6.2…'} className={cn(INPUT, 'font-mono text-xs')} />
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
