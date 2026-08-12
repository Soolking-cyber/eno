'use client'

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { toast } from 'sonner'
import { Tooltip } from '@/components/ui/tooltip'
import {
  ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, SortingState, useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, Loader2, MoreHorizontal, Search, Trash2, EyeOff, Eye, Star, Check } from '@/components/ui/icons'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { shortDate } from '@/lib/dates'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { useLatestRequest } from '@/hooks/use-latest-request'

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
/**
 * What each admin action actually WRITES — shown on hover in both places it can be triggered
 * (the bulk bar and the row menu), so the two can never drift apart.
 *
 * The owner asked for these after "what do these do, release and feature": the labels did not
 * say, and two were easy to read backwards.
 *
 * ⚠️ THE PUBLISH ACTION WAS LABELLED "Release" UNTIL 2026-07-24. Beside "Activate" that read as
 * something about holds or escrow, and an admin could reasonably think Activate was the publish
 * button — while Activate only flips `status`. Renamed to "Publish"; the underlying action is
 * still `verify` and the API is untouched, so nothing outside this file changed.
 *
 * `Publish` writes `verified: true`, the gate that makes a listing publicly live (an unverified
 * one 404s and is absent from feed/search/digest). `Feature` is only a ranking boost — not a
 * badge, not a pinned slot. Guessing wrong changes what buyers can see, so each hint states the
 * EFFECT rather than restating the label.
 */
const ACTION_HINT = {
  activate: 'Sets status to active — undoes Hide. On its own this does NOT publish: a listing still needs Publish.',
  hide: 'Sets status to hidden — pulls it from the feed, search and its product page without deleting anything. Reversible with Activate.',
  feature: 'Boosts ranking in browse. Not a badge and not a pinned slot — worth about as much as being brand new. Reversible.',
  verify: 'Makes the listing publicly live (sets verified). Until then its product page 404s and it is absent from feed, search and the digest. This is also what clears a listing held by the duplicate/illegal-content guard.',
  delete: 'Permanently deletes the listing and its data. Cannot be undone — use Hide unless you mean it.',
} as const

export function AdminListingsClient() {
  const { lang } = useLanguage() // admin chrome stays English; amounts follow the viewer's language
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [verified, setVerified] = useState('all')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [sorting, setSorting] = useState<SortingState>([])
  // ids awaiting the destructive confirm (alert-dialog replaces window.confirm)
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  // Last non-null value keeps the dialog copy stable while it animates out
  // (clearing on close would flash "Delete 0 listing(s)?" mid-exit).
  const lastDelete = useRef<string[]>([])
  // ⚠️ Written in an EFFECT, not during render. A render-phase ref write is mutation from a
  // render React may abandon or replay under concurrent rendering (both reviewers flagged it).
  // The dialog copy still stays stable while it animates out, which is all this ref is for.
  useEffect(() => { if (pendingDelete) lastDelete.current = pendingDelete }, [pendingDelete])

  // Stale-async guard (audit Phase 2): typing 'iph' → 'iphone' (or a filter switch
  // during a slow query) put two requests in flight; the EARLIER response landing
  // last overwrote rows/total for the current filters — and cleared the selection.
  const latest = useLatestRequest()
  const load = useCallback(() => {
    setLoading(true)
    const req = latest.begin()
    const p = new URLSearchParams({ status, verified, limit: '80' })
    if (q.trim()) p.set('q', q.trim())
    fetch(`/api/admin/listings?${p}`, { signal: req.signal })
      .then((r) => r.json())
      .then((d) => { if (!req.isCurrent()) return; setRows(d.listings || []); setTotal(d.total || 0); setSel((prev) => (prev.size ? new Set() : prev)) })
      .catch(() => { if (req.isCurrent()) toast.error('Could not load listings') })
      .finally(() => { if (req.isCurrent()) setLoading(false) })
  }, [q, status, verified, latest])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allSelected = rows.length > 0 && sel.size === rows.length
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)))

  // Runs the batch action for `ids` (defaults to the current selection — row-level
  // menu actions pass a single id). Delete detours through the confirm dialog.
  const act = async (action: string, ids: string[] = [...sel]) => {
    if (!ids.length) return
    if (action === 'delete') { setPendingDelete(ids); return }
    await run(action, ids)
  }

  const run = async (action: string, ids: string[]) => {
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

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const sortBtn = (label: string) => ({ column }: { column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' } }) => (
      <Button
        variant="bare"
        size="none"
        className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        {label} <ArrowUpDown className="h-3 w-3" />
      </Button>
    )
    return [
      {
        id: 'select',
        enableSorting: false,
        header: () => (
          <Checkbox
            checked={allSelected}
            indeterminate={sel.size > 0 && !allSelected}
            aria-label="Select all"
            onChange={toggleAll}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={sel.has(row.original.id)}
            aria-label="Select listing"
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(row.original.id)}
          />
        ),
      },
      {
        id: 'item',
        enableSorting: false,
        header: () => 'Listing',
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex min-w-0 items-center gap-3">
              {r.image ? <img src={r.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-tint" />}
              <div className="min-w-0">
                <div className="max-w-[24rem] truncate text-sm font-semibold text-foreground">{r.title}</div>
                <div className="max-w-[24rem] truncate text-xs text-muted-foreground">{formatMoneyFull(r.price, r.currency, moneyLocale(lang))} · {r.category}</div>
              </div>
            </div>
          )
        },
      },
      {
        id: 'seller',
        enableSorting: false,
        header: () => 'Seller',
        cell: ({ row }) => <span className="text-sm text-body">{row.original.sellerName}</span>,
      },
      {
        id: 'status',
        enableSorting: false,
        header: () => 'Status',
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="flex items-center gap-1.5">
              {r.featured && <Badge variant="neutral">★</Badge>}
              {!r.verified && <Badge variant="warning" className="capitalize">held</Badge>}
              <Badge variant={r.status === 'active' ? 'success' : 'neutral'} className="capitalize">{r.status}</Badge>
            </div>
          )
        },
      },
      {
        id: 'created',
        accessorFn: (r) => new Date(r.createdAt).getTime(),
        header: sortBtn('Created'),
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{shortDate(row.original.createdAt)}</span>,
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger render={<IconButton size="xs" tapTarget={false} aria-label="More actions" className="rounded-lg text-ink-4 transition-colors hover:bg-muted hover:text-foreground" />}>
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* `title` rather than a Tooltip: a Base UI menu item already owns hover and
                    keyboard focus, and nesting a tooltip trigger inside it fights that. The
                    native hint is enough for admin-only chrome and works on the focused item too.
                    Same wording as the bulk bar — one vocabulary for one action. */}
                <DropdownMenuItem disabled={busy} title={ACTION_HINT.activate} onClick={() => act('activate', [row.original.id])}><Eye /> Activate</DropdownMenuItem>
                <DropdownMenuItem disabled={busy} title={ACTION_HINT.hide} onClick={() => act('hide', [row.original.id])}><EyeOff /> Hide</DropdownMenuItem>
                <DropdownMenuItem disabled={busy} title={ACTION_HINT.feature} onClick={() => act('feature', [row.original.id])}><Star /> Feature</DropdownMenuItem>
                <DropdownMenuItem disabled={busy} title={ACTION_HINT.verify} onClick={() => act('verify', [row.original.id])}><Check /> Publish</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={busy} title={ACTION_HINT.delete} onClick={() => act('delete', [row.original.id])}><Trash2 /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ]
  }, [lang, sel, allSelected, busy, rows])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">Listings</h1>
      <p className="mt-1 text-sm text-muted-foreground">{total} total · select to batch-act.</p>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search listings by title or location" placeholder="Search title / location…" className="py-2 pl-9 pr-3" />
        </div>
        <Segmented options={STATUS} value={status} onChange={setStatus} />
        <Segmented options={VERIFIED} value={verified} onChange={setVerified} />
      </div>

      {/* Batch action bar */}
      <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-1 rounded-xl bg-popover/95 px-2 py-2 shadow-pop backdrop-blur">
        <label className="flex items-center gap-2 px-2 text-sm font-semibold text-body">
          <Checkbox checked={allSelected} indeterminate={sel.size > 0 && !allSelected} onChange={toggleAll} />
          {sel.size > 0 ? `${sel.size} selected` : 'Select all'}
        </label>
        <span className="mx-1 h-5 w-px bg-border" />
        <ActionBtn onClick={() => act('activate')} disabled={actionsDisabled} icon={<Eye className="h-4 w-4" />} label="Activate"
          hint={ACTION_HINT.activate} />
        <ActionBtn onClick={() => act('hide')} disabled={actionsDisabled} icon={<EyeOff className="h-4 w-4" />} label="Hide"
          hint={ACTION_HINT.hide} />
        <ActionBtn onClick={() => act('feature')} disabled={actionsDisabled} icon={<Star className="h-4 w-4" />} label="Feature"
          hint={ACTION_HINT.feature} />
        <ActionBtn onClick={() => act('verify')} disabled={actionsDisabled} icon={<Check className="h-4 w-4" />} label="Publish"
          hint={ACTION_HINT.verify} />
        <ActionBtn onClick={() => act('delete')} disabled={actionsDisabled} icon={<Trash2 className="h-4 w-4" />} label="Delete" danger
          hint={ACTION_HINT.delete} />
        {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin text-ink-4" />}
      </div>

      {/* ⚠️ THE FLICKER (owner, 2026-07-24). This used to be `loading ? <spinner> : <table>`, so
          EVERY fetch unmounted the whole table and replaced it with a centred spinner — a full
          content swap on each keystroke of the 200ms-debounced search and on every filter
          change. (Before the useLatestRequest identity fix it also fired ~2.6×/second forever,
          which is what made it constant.) Both external reviewers ranked this the top remaining
          cause once the loop was gone.

          Now the table STAYS MOUNTED across refetches: only a genuinely empty first load shows
          the spinner, and a refresh over existing rows just dims them slightly while the small
          inline spinner beside the count does the talking. No unmount, no reflow, no flash. */}
      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-ink-4" /></div>
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn(
            'mt-4 overflow-x-auto rounded-2xl border transition-opacity duration-150',
            loading && 'opacity-60',
          )}
        >
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id} className="whitespace-nowrap text-xs text-muted-foreground">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={sel.has(row.original.id) ? 'selected' : undefined}
                  className="cursor-pointer"
                  onClick={() => toggle(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} onClick={cell.column.id === 'actions' || cell.column.id === 'select' ? (e) => e.stopPropagation() : undefined}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <p className="py-10 text-center text-sm text-muted-foreground">No listings match.</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Destructive confirm — same copy the old window.confirm carried */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete listings</AlertDialogTitle>
            <AlertDialogDescription>{`Delete ${(pendingDelete ?? lastDelete.current).length} listing(s)? This is permanent.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { const ids = pendingDelete; setPendingDelete(null); if (ids?.length) void run('delete', ids) }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Module-scope so it keeps a stable identity — a component created inside the parent's
// render remounts on every keystroke/selection (the batch bar re-renders constantly).
/**
 * A bulk-action button with a hover explanation of what it actually WRITES.
 *
 * Owner asked for this after "what do these do, release and feature" — the labels did not say.
 * The wording lives in ACTION_HINT (see the note there, including why "Release" became
 * "Publish"); this component only renders it.
 *
 * ⚠️ THE TOOLTIP HANGS ON A WRAPPER, NOT THE BUTTON. These are disabled until rows are
 * selected — which is exactly when an admin most wants to know what they do — and a disabled
 * <button> fires no pointer events, so a tooltip bound to it would be silent in the one state
 * it is most needed. The <span> is not disabled, so it still receives the hover.
 */
function ActionBtn({ onClick, disabled, icon, label, hint, danger }: { onClick: () => void; disabled: boolean; icon: React.ReactNode; label: string; hint: string; danger?: boolean }) {
  return (
    // max-w + leading: these hints are a sentence or two and the popup has no width cap of its
    // own — unconstrained it renders as one ~950px line that is genuinely hard to read.
    <Tooltip content={hint} className="max-w-sm leading-relaxed whitespace-normal">
      <span className="inline-flex">
        <Button onClick={onClick} disabled={disabled} variant="ghost" size="none"
          className={cn('gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold disabled:opacity-40',
            danger ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : 'text-body hover:bg-muted hover:text-body')}>
          {icon} {label}
        </Button>
      </span>
    </Tooltip>
  )
}

// Interactive filter pills with selected-state logic stay bespoke per the Badge
// canon — these are buttons, not chips.
function Segmented({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-tint p-1">
      {options.map((o) => (
        <Button key={o.v} onClick={() => onChange(o.v)} variant="bare" size="none" className={cn('cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors', value === o.v ? 'bg-primary text-white' : 'text-body hover:bg-muted')}>{o.label}</Button>
      ))}
    </div>
  )
}
