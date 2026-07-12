'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, SortingState,
  useReactTable, RowSelectionState,
} from '@tanstack/react-table'
import { ArrowUpDown, CheckCircle2, Eye, Heart, MessageSquareText, MoreHorizontal, Pencil, RotateCcw, Trash2, ExternalLink, TrendingDown } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Price } from './price'
import { QuickDiscount } from './quick-discount'
import { ShareButton } from './share-button'
import { BulkDiscount } from './bulk-discount'
import { ListingSparkline, type SparkPoint } from './listing-sparkline'
import { useListingActions } from './use-listing-actions'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'
import { cn } from '@/lib/utils'

// Desktop listings data-table (shadcn table + TanStack) — the lg+ counterpart
// of DashboardListingRow. Row selection feeds the bulk-discount dialog directly
// (replaces the mobile "Select" mode on desktop); lifecycle actions reuse the
// SAME optimistic hook as the row cards. Mobile keeps the stacked rows.
export function ListingsTable({ listings, onChanged, spark }: {
  listings: SerializedListing[]
  onChanged: () => void
  spark?: Record<string, SparkPoint[]> | null
}) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [bulkOpen, setBulkOpen] = useState(false)
  // Per-row optimistic overrides mirrored out of useListingActions (via onState)
  // so the status badge, selectability and row visibility flip in lockstep with
  // the actions cell — same instant feel as the mobile rows. 'gone' rows are
  // filtered out entirely for the undo-delete window.
  const [overrides, setOverrides] = useState<Record<string, 'sold' | 'active' | 'gone'>>({})
  const setOverride = (id: string) => (state: 'sold' | 'active' | 'gone' | null) =>
    setOverrides((prev) => {
      const next = { ...prev }
      if (state === null) delete next[id]
      else next[id] = state
      return next
    })
  const effStatus = (l: SerializedListing) => overrides[l.id] ?? l.status
  const data = useMemo(() => listings.filter((l) => overrides[l.id] !== 'gone'), [listings, overrides])

  const discountable = (l: SerializedListing) => effStatus(l) === 'active' && l.price > 0

  const columns = useMemo<ColumnDef<SerializedListing>[]>(() => {
    const sortBtn = (label: string) => ({ column }: { column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' } }) => (
      <button
        className="inline-flex cursor-pointer items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    )
    return [
      {
        id: 'select',
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
            aria-label={tr('Select all', 'Chọn tất cả')}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            aria-label={tr('Select listing', 'Chọn tin')}
            onClick={(e) => e.stopPropagation()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        id: 'item',
        enableSorting: false,
        header: () => tr('Listing', 'Tin đăng'),
        cell: ({ row }) => {
          const l = row.original
          const title = lang === 'vi' ? (l.titleVi || l.title) : l.title
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-tint">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {l.images[0] && <img src={l.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </span>
              <span className="min-w-0">
                <span className="block max-w-[26rem] truncate text-sm font-semibold text-foreground">{title}</span>
                {spark?.[l.id] && spark[l.id].length > 0 && <ListingSparkline series={spark[l.id]} />}
              </span>
            </div>
          )
        },
      },
      {
        id: 'price',
        accessorFn: (l) => l.price,
        header: sortBtn(tr('Price', 'Giá')),
        cell: ({ row }) => <Price price={row.original.price} currency={row.original.currency} priceUnit={row.original.priceUnit} compact className="text-sm font-bold text-accent-foreground" />,
      },
      {
        id: 'status',
        accessorFn: (l) => l.status,
        enableSorting: false,
        header: () => tr('Status', 'Trạng thái'),
        cell: ({ row }) => <StatusBadge listing={row.original} status={effStatus(row.original)} />,
      },
      {
        id: 'views',
        accessorFn: (l) => l.views,
        header: sortBtn(tr('Views', 'Lượt xem')),
        cell: ({ row }) => <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Eye className="h-3.5 w-3.5" />{row.original.views}</span>,
      },
      {
        id: 'leads',
        accessorFn: (l) => l.contactCount,
        header: sortBtn(tr('Leads', 'Liên hệ')),
        cell: ({ row }) => <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><MessageSquareText className="h-3.5 w-3.5" />{row.original.contactCount}</span>,
      },
      {
        id: 'saved',
        accessorFn: (l) => l.savedCount,
        header: sortBtn(tr('Saved', 'Đã lưu')),
        cell: ({ row }) => <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Heart className="h-3.5 w-3.5" />{row.original.savedCount}</span>,
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">{tr('Actions', 'Thao tác')}</span>,
        cell: ({ row }) => <ActionsCell listing={row.original} onChanged={onChanged} onState={setOverride(row.original.id)} />,
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, tr, spark, onChanged, overrides])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (l) => l.id,
    enableRowSelection: (row) => discountable(row.original),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const selectedItems = table.getSelectedRowModel().rows.map((r) => r.original)

  return (
    <div>
      {selectedItems.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent px-3 py-2">
          <span className="text-xs font-semibold text-accent-foreground">
            {tr(`${selectedItems.length} selected`, `Đã chọn ${selectedItems.length}`)}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setRowSelection({})} className="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-accent-foreground transition-colors hover:bg-brand/10">
              {tr('Clear', 'Bỏ chọn')}
            </button>
            <Button variant="cta" size="none" onClick={() => setBulkOpen(true)} className="cursor-pointer gap-1 rounded-lg px-3 py-1.5 text-xs">
              <TrendingDown className="h-3.5 w-3.5" /> {tr('Discount', 'Giảm giá')} ({selectedItems.length})
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border">
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
                data-state={row.getIsSelected() ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => router.push(`/listings/${row.original.id}`)}
                onMouseEnter={() => router.prefetch(`/listings/${row.original.id}`)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cn(cell.column.id === 'actions' && 'text-right')} onClick={cell.column.id === 'actions' || cell.column.id === 'select' ? (e) => e.stopPropagation() : undefined}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BulkDiscount
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        listings={selectedItems.map((l) => ({ id: l.id, price: l.price, currency: l.currency }))}
        onDone={() => { setRowSelection({}); onChanged() }}
      />
    </div>
  )
}

function StatusBadge({ listing, status }: { listing: SerializedListing; status: string }) {
  const { tr } = useLanguage()
  if (!listing.verified && status === 'active') return <Badge variant="warning">{tr('Held', 'Đang giữ')}</Badge>
  if (status === 'sold') return <Badge variant="neutral">{tr('Sold', 'Đã bán')}</Badge>
  if (status === 'hidden') return <Badge variant="neutral">{tr('Hidden', 'Đã ẩn')}</Badge>
  return <Badge variant="brand">{tr('Live', 'Đang hiển thị')}</Badge>
}

// Lifecycle actions for one table row — QuickDiscount + share stay inline (both
// are popover surfaces), the rest live in a ⋯ menu. Reuses the shared optimistic
// hook, so behavior (undo-delete included) is identical to the mobile rows.
function ActionsCell({ listing, onChanged, onState }: { listing: SerializedListing; onChanged: () => void; onState: (s: 'sold' | 'active' | 'gone' | null) => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  const { status, setStatus, del } = useListingActions(listing, onChanged, onState)

  const title = lang === 'vi' ? (listing.titleVi || listing.title) : listing.title
  return (
    <div className="flex items-center justify-end gap-1.5">
      {status === 'active' && listing.price > 0 && (
        <QuickDiscount listing={{ id: listing.id, price: listing.price, currency: listing.currency }} onChanged={onChanged} />
      )}
      {status === 'active' && listing.verified && (
        <ShareButton
          url={`${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/listings/${listing.id}`}
          title={title}
          price={listing.price}
          currency={listing.currency}
          className="gap-1 rounded-lg px-2.5 py-1 text-xs [&_svg]:h-3 [&_svg]:w-3"
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<button aria-label={tr('More actions', 'Thao tác khác')} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-ink-4 transition-colors hover:bg-muted hover:text-foreground" />}>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status === 'active' ? (
            <DropdownMenuItem onClick={() => setStatus('sold')}>
              <CheckCircle2 /> {tr('Mark sold', 'Đã bán')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setStatus('active')}>
              <RotateCcw /> {tr('Relist', 'Đăng lại')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => router.push(`/listings/${listing.id}/edit`)}>
            <Pencil /> {tr('Edit', 'Sửa')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`/listings/${listing.id}`)}>
            <ExternalLink /> {tr('View', 'Xem')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={del}>
            <Trash2 /> {tr('Delete', 'Xóa')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
