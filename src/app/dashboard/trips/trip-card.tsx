'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Download, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { useDualMoney } from '@/context/currency-context'

// Row shapes = the /api/itineraries GET serializer (Prisma rows, dates as ISO strings,
// interests pre-parsed to string[]).
export type SavedItineraryDay = {
  id: string
  dayNumber: number
  area: string
  areaVi: string | null
  title: string
  titleVi: string | null
  morning: string
  morningVi: string | null
  afternoon: string
  afternoonVi: string | null
  evening: string
  eveningVi: string | null
}

export type SavedItineraryStay = {
  id: string
  position: number
  name: string
  nameVi: string | null
  area: string
  areaVi: string | null
  note: string | null
  noteVi: string | null
  estimatedNightly: number | null
  currency: string
}

export type SavedItinerary = {
  id: string
  title: string
  destinationId: string
  days: number
  budgetId: string
  interests: string[]
  status: string
  estimatedBudget: number | null
  currency: string
  updatedAt: string
  dayPlans: SavedItineraryDay[]
  stays: SavedItineraryStay[]
}

// destinationId → [en, vi] display names, mirrored from the forum planner's city
// catalogue (eno-forum itinerary-data — ids are stable). Display-only: an unknown
// id falls back to the prettified slug, never breaks the row.
const CITY_NAMES: Record<string, [string, string]> = {
  hanoi: ['Hanoi', 'Hà Nội'],
  halong: ['Ha Long & Lan Ha Bay', 'Hạ Long & vịnh Lan Hạ'],
  ninhbinh: ['Ninh Binh & Tam Coc', 'Ninh Bình & Tam Cốc'],
  sapa: ['Sa Pa', 'Sa Pa'],
  hagiang: ['Ha Giang', 'Hà Giang'],
  caobang: ['Cao Bang', 'Cao Bằng'],
  puluong: ['Pu Luong & Mai Chau', 'Pù Luông & Mai Châu'],
  hue: ['Hue', 'Huế'],
  danang: ['Da Nang', 'Đà Nẵng'],
  hoian: ['Hoi An', 'Hội An'],
  phongnha: ['Phong Nha', 'Phong Nha'],
  quynhon: ['Quy Nhon', 'Quy Nhơn'],
  nhatrang: ['Nha Trang', 'Nha Trang'],
  dalat: ['Da Lat', 'Đà Lạt'],
  buonmathuot: ['Buon Ma Thuot', 'Buôn Ma Thuột'],
  hochiminh: ['Ho Chi Minh City', 'TP. Hồ Chí Minh'],
  mekong: ['Ben Tre & Mekong Delta', 'Bến Tre & miền Tây'],
  cantho: ['Can Tho', 'Cần Thơ'],
  muine: ['Mui Ne & Phan Thiet', 'Mũi Né & Phan Thiết'],
  phuquoc: ['Phu Quoc', 'Phú Quốc'],
  condao: ['Con Dao', 'Côn Đảo'],
}


// Itinerary currency column stores ISO 'VND'; formatMoneyFull's VND branch keys on '₫'.
function money(amount: number, currency: string, locale: 'en' | 'vi'): string {
  return formatMoneyFull(amount, currency === 'VND' ? '₫' : currency, locale)
}

/**
 * A saved trip's money, in both currencies (owner, 2026-07-29) — same rule as <Price> and
 * plan-results' useVnd: the approximation is USD unless the display already IS USD, then đồng.
 *
 * ⚠️ ONLY A VND-STORED TRIP IS CONVERTED. `Itinerary.currency` is an ISO column, so a plan stored
 * in something else is shown as-is with no approximation — the same call <Price> makes for a
 * non-VND listing, because there is no reliable rate between two foreign currencies here.
 */
function useTripMoney() {
  const { lang } = useLanguage()
  const dual = useDualMoney()
  return (amount: number, currency: string) =>
    (currency === 'VND' || currency === '\u20ab')
      ? dual(amount, moneyLocale(lang))
      : money(amount, currency, moneyLocale(lang))
}

/** One saved itinerary: summary row (title / destination / day count / updated date)
 *  that expands in place to the full day-by-day plan + stay shortlist. Disclosure is
 *  Base UI Collapsible used directly — no ui/ collapsible primitive exists yet and this
 *  is its only call site (same direct-import precedent as availability-client). */
export function TripCard({ trip, onDeleted }: { trip: SavedItinerary; onDeleted?: (id: string) => void }) {
  const { lang, tr } = useLanguage()
  const vi = lang === 'vi'
  const [downloading, setDownloading] = useState(false)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  /**
   * Delete a saved trip (owner 2026-07-27: "add option do delte next to open edit").
   *
   * ⚠️ A SOFT DELETE, and the distinction is load-bearing: DELETE /api/itineraries/[id] sets
   * `status = 'archived'` rather than removing the row, and every read in the feature filters
   * archived out. That only frees a slot against the 3-trip cap because `itineraryQuota` was fixed
   * this morning to exclude archived rows — before that, deleting a trip consumed its slot forever
   * and the traveller could be locked out with nothing on screen to explain it.
   *
   * The row is dropped from the list optimistically ONLY after the server confirms, because the
   * list is also what the chat drafts picker reads: a row that vanished here but survived there
   * would offer a trip whose page 404s.
   */
  const deleteTrip = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/itineraries/${trip.id}`, { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) {
        toast.error(tr('That trip could not be deleted. Please try again.', 'Không xóa được chuyến đi. Vui lòng thử lại.'))
        return
      }
      setConfirmingDelete(false)
      toast.message(tr('Trip deleted.', 'Đã xóa chuyến đi.'))
      onDeleted?.(trip.id)
    } catch {
      toast.error(tr('That trip could not be deleted. Please try again.', 'Không xóa được chuyến đi. Vui lòng thử lại.'))
    } finally {
      setDeleting(false)
    }
  }

  // Word export of the saved plan — server-side assembly from the persisted day plans
  // and stay shortlist (POST /api/itineraries/[id]/docx). Same blob-download pattern as
  // the live planner results; failures surface a toast, never a broken button.
  const downloadWord = async () => {
    setDownloading(true)
    try {
      const response = await fetch(`/api/itineraries/${trip.id}/docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang }),
      })
      if (!response.ok) throw new Error(`DOCX request failed (${response.status})`)
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'eno-itinerary.docx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      toast.message(tr('Your Word file is ready.', 'Tệp Word đã sẵn sàng.'))
    } catch (error) {
      console.error('[trip-card/docx]', error)
      toast.error(tr('The Word file could not be created. Please try again.', 'Không thể tạo tệp Word. Vui lòng thử lại.'))
    } finally {
      setDownloading(false)
    }
  }
  // Day/stay copy is bilingual DATA (columns), not UI strings: vi column when the UI is
  // Vietnamese and the column is filled; English text otherwise (also the MT-language case).

  const city = trip.destinationId ? CITY_NAMES[trip.destinationId] : undefined
  const destination = city ? (vi ? city[1] : city[0]) : (trip.destinationId ?? '').replace(/[-_]/g, ' ')
  const updated = new Date(trip.updatedAt).toLocaleDateString(vi ? 'vi-VN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const tripMoney = useTripMoney()
  const budget = trip.estimatedBudget ? tripMoney(trip.estimatedBudget, trip.currency) : null

  return (
    // Flat design language (§3b): a saved itinerary is a ROW in a divided list, not a bordered
    // box — the parent <Rows> (trips-client) draws the hairline between siblings. `overflow-hidden`
    // stays for the height collapse animation; the panel keeps its own border-t between header and
    // detail. Renders <li> because <Rows> is a <ul>.
    // ⚠️ A FLAT ROW, NOT A DISCLOSURE (owner, 2026-07-29: "my trip is similar to my evisa see draft
    // trips and edit delete on click nothing more remove else"). This used to be a Collapsible that
    // expanded the entire day-by-day plan and stay shortlist in place — a second, read-only copy of
    // the trip detail page, sitting inside a LIST. Everything it showed is one tap away on the page
    // the row now links to, which is also where the map and stop editing live.
    //
    // ⚠️ THE LINK AND THE ACTIONS ARE SIBLINGS, never nested. A <button> inside an <a> is invalid
    // HTML and the two fight for the same tap; the visa case list solves it the same way, which is
    // the shape this row is deliberately copying.
    <li className="flex items-start gap-3 py-4">
      <Link
        href={`/dashboard/trips/${trip.id}`}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <CalendarDays className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-foreground">{trip.title}</span>
            {trip.status === 'draft' && <Badge variant="neutral">{tr('Draft', 'Bản nháp')}</Badge>}
          </span>
          <span className="mt-1 block text-xs text-body">
            {destination} · {trip.days} {tr('days', 'ngày')}
            {budget ? ` · ${budget}` : ''} · {tr('Updated', 'Cập nhật')} {updated}
          </span>
        </span>
      </Link>

      {/* Icon-only, like the visa case row: on a phone two labelled buttons per row wrap and turn
          the list into a wall of controls. Titles + aria-labels carry the meaning. */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={downloadWord}
          disabled={downloading}
          aria-label={tr('Download Word file', 'Tải tệp Word')}
          title={tr('Download Word file', 'Tải tệp Word')}
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={tr('Delete trip', 'Xóa chuyến đi')}
                title={tr('Delete', 'Xóa')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            }
          />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia className="bg-destructive/10 text-destructive">
                  <TriangleAlert />
                </AlertDialogMedia>
                <AlertDialogTitle>{tr('Delete this trip?', 'Xóa chuyến đi này?')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tr('This removes the plan from My Trips and from the drafts you can reopen in chat. It frees one of your three saved-trip slots. The Word file you already downloaded is unaffected.',
                      'Kế hoạch sẽ bị xóa khỏi Chuyến đi của tôi và khỏi danh sách bản nháp mở lại trong chat. Bạn sẽ được trả lại một trong ba lượt lưu. Tệp Word đã tải về không bị ảnh hưởng.')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel render={<Button type="button" variant="outline">{tr('Keep it', 'Giữ lại')}</Button>} />
                <AlertDialogAction
                  render={
                    <Button type="button" variant="cta" className="bg-destructive hover:bg-destructive" disabled={deleting} onClick={(e) => { e.preventDefault(); void deleteTrip() }}>
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {tr('Delete trip', 'Xóa chuyến đi')}
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
      </div>
    </li>
  )
}
