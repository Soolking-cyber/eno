'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Check, Sparkles, Upload } from '@/components/ui/icons'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

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

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search brands" placeholder="Search brands…" className="py-2.5 pl-9 pr-3" />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-ink-4" /></div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Logo</span></TableHead>
                <TableHead className="text-xs text-muted-foreground">Brand</TableHead>
                <TableHead className="text-xs text-muted-foreground">Slug</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">Listings</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <BrandRow key={b.id} brand={b} brands={brands} open={openId === b.id} onOpenChange={(o) => setOpenId(o ? b.id : null)} onSaved={load} />
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <p className="py-10 text-center text-sm text-muted-foreground">No brands match.</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// One brand = one table row + its side edit sheet. The component (and its form
// state) stays mounted whether or not the sheet is open, so in-progress edits
// survive closing and reopening a row — same persistence the old inline
// expander had.
function BrandRow({ brand, brands, open, onOpenChange, onSaved }: { brand: Brand; brands: Brand[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
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
  // merge target awaiting the destructive confirm (alert-dialog replaces window.confirm)
  const [mergeConfirm, setMergeConfirm] = useState(false)

  // Live preview: typed custom path wins, then an AI suggestion, then the saved icon.
  const previewPath = logoPath.trim() || aiPath || brand.iconPath
  const mergeTarget = brands.find((x) => x.id === mergeId)

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

  // Runs after the alert-dialog confirm — same guard + copy the old confirm() had.
  const merge = async () => {
    if (!mergeId || !mergeTarget) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'merge', sourceId: brand.id, targetId: mergeId }) })
      if (!res.ok) throw new Error()
      toast.success(`Merged into ${mergeTarget.name}`)
      onSaved()
    } catch { toast.error('Merge failed') } finally { setSaving(false) }
  }

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => onOpenChange(true)}>
        <TableCell><BrandLogo name={name} iconPath={previewPath} size={28} flat /></TableCell>
        <TableCell className="max-w-[18rem]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-bold text-foreground">{name}</span>
            {!brand.curatedAt && <Badge variant="brand">new</Badge>}
            {brand.status === 'hidden' && <Badge variant="neutral">hidden</Badge>}
          </span>
        </TableCell>
        <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">{brand.slug}</TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">{brand.listingCount}</TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end">
            <Button variant="ghost" size="none" onClick={() => onOpenChange(true)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-muted hover:text-accent-foreground">
              Edit
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader className="pr-12">
            <div className="flex items-center gap-3">
              <BrandLogo name={name} iconPath={previewPath} size={28} flat />
              <div className="min-w-0">
                <SheetTitle className="truncate">{name}</SheetTitle>
                <SheetDescription className="truncate text-xs">{brand.slug} · {brand.listingCount} listings</SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="grid flex-1 content-start gap-3 overflow-y-auto px-4 pb-4">
            {/* AI assist — canonicalize the name + find a real monotone logo to approve. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="none" onClick={aiSuggest} disabled={aiBusy} className="gap-1.5 rounded-xl border border-brand/30 px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:bg-tint hover:text-accent-foreground disabled:opacity-50">
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI suggest logo &amp; name
              </Button>
              {aiNote && <span className="text-xs text-muted-foreground">{aiNote}</span>}
              <span className="text-2xs text-ink-4">— review, then Save to approve.</span>
            </div>
            <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} className="px-3 py-2" /></Field>
            <Field label="Status">
              <div className="flex gap-2">
                {(['active', 'hidden'] as const).map((s) => (
                  <Button key={s} variant="ghost" size="none" onClick={() => setStatus(s)}
                    className={cn('rounded-lg border px-3 py-1.5 text-sm font-semibold capitalize',
                      status === s ? 'border-brand bg-primary text-white hover:bg-primary hover:text-white' : 'border-line-strong text-body hover:bg-muted hover:text-body')}>
                    {s}
                  </Button>
                ))}
              </div>
            </Field>
            <Field label="simple-icons slug (e.g. apple)"><Input value={iconSlug} onChange={(e) => setIconSlug(e.target.value)} placeholder="leave blank if none" className="px-3 py-2" /></Field>
            <Field label="Aliases (comma-separated, normalized)"><Input value={aliases} onChange={(e) => setAliases(e.target.value)} className="px-3 py-2" /></Field>
            <Field label="Custom logo — upload an .svg, paste a full <svg>…</svg>, or a monotone path (overrides slug)">
              <div className="mb-1.5 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold text-body hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> Upload .svg
                  <input type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => { onSvgFile(e.target.files?.[0]); e.currentTarget.value = '' }} />
                </label>
                {logoPath && (
                  <Button type="button" variant="ghost" size="none" onClick={() => { setLogoPath(''); setAiPath(null) }} className="text-xs font-semibold text-ink-4 hover:bg-transparent hover:text-foreground">
                    Clear logo
                  </Button>
                )}
              </div>
              <Textarea value={logoPath} onChange={(e) => setLogoPath(e.target.value)} rows={2} placeholder={'<svg viewBox="0 0 24 24">…</svg>  or  M12 2 4 5v6.2…'} className="min-h-0 px-3 py-2 font-mono text-xs" />
            </Field>
          </div>

          <SheetFooter className="flex-row items-center justify-between gap-3 border-t">
            <div className="flex items-center gap-2">
              {/* items gives Base UI the value->label map (otherwise the trigger
                  shows the raw cuid); the null item doubles as placeholder AND lets
                  the admin un-pick a merge target. */}
              <Select
                value={mergeId || null}
                onValueChange={(v) => setMergeId((v as string) ?? '')}
                items={[
                  { value: null, label: 'Merge into…' },
                  ...brands.filter((x) => x.id !== brand.id).map((x) => ({ value: x.id, label: x.name })),
                ]}
              >
                <SelectTrigger size="sm" className="max-w-[11rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Merge into…</SelectItem>
                  {brands.filter((x) => x.id !== brand.id).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="none" onClick={() => setMergeConfirm(true)} disabled={!mergeId || saving} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-muted hover:text-accent-foreground disabled:opacity-40">
                Merge
              </Button>
            </div>
            <Button variant="cta" size="none" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </Button>
          </SheetFooter>

          {/* Destructive confirm — same copy the old window.confirm carried.
              Lives INSIDE SheetContent so Base UI counts it as a nested dialog:
              Escape then cancels only the confirm, not the sheet underneath. */}
          <AlertDialog open={mergeConfirm} onOpenChange={(o) => { if (!o) setMergeConfirm(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge brands</AlertDialogTitle>
            <AlertDialogDescription>
              {mergeTarget ? `Merge "${brand.name}" INTO "${mergeTarget.name}"? Its listings + aliases move to ${mergeTarget.name}, and "${brand.name}" is deleted.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setMergeConfirm(false); void merge() }}>
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </SheetContent>
      </Sheet>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
