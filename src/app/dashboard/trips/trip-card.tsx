'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronDown, Download, Loader2, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { Collapsible } from '@base-ui/react/collapsible'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { INTEREST_LABELS, type OptionLabel } from '@/lib/itinerary-data'

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

// ⚠️ THE SHARED TABLE, not a copy. This file held its own INTEREST_LABELS and it had DRIFTED: it
// said `wellness` = "Thư giãn" while src/lib/itinerary-data.ts and the builder both said
// "Nghỉ dưỡng", so the saved-trip list and the builder disagreed in Vietnamese about the same
// interest. Third copy of a table that was already shared — murat flagged the pattern; this is the
// instance where it had already gone wrong.
//
// Kept as a lookup on `string` because `trip.interests` comes off a JSON column and may legitimately
// hold an id this build does not know; the caller falls back to the raw id for that case.
const interestLabel = (id: string): [string, string] | undefined => {
  const entry = (INTEREST_LABELS as Record<string, OptionLabel | undefined>)[id]
  return entry ? [entry.label, entry.labelVi] : undefined
}

// Itinerary currency column stores ISO 'VND'; formatMoneyFull's VND branch keys on '₫'.
function money(amount: number, currency: string, locale: 'en' | 'vi'): string {
  return formatMoneyFull(amount, currency === 'VND' ? '₫' : currency, locale)
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
  const loc = (en: string, viText: string | null | undefined) => (vi && viText ? viText : en)

  const city = trip.destinationId ? CITY_NAMES[trip.destinationId] : undefined
  const destination = city ? (vi ? city[1] : city[0]) : (trip.destinationId ?? '').replace(/[-_]/g, ' ')
  const updated = new Date(trip.updatedAt).toLocaleDateString(vi ? 'vi-VN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const budget = trip.estimatedBudget ? money(trip.estimatedBudget, trip.currency, moneyLocale(lang)) : null

  return (
    // Flat design language (§3b): a saved itinerary is a ROW in a divided list, not a bordered
    // box — the parent <Rows> (trips-client) draws the hairline between siblings. `overflow-hidden`
    // stays for the height collapse animation; the panel keeps its own border-t between header and
    // detail. Renders <li> because <Rows> is a <ul>.
    <Collapsible.Root render={<li className="overflow-hidden" />}>
      <Collapsible.Trigger
        render={
          // Overrides live on the Button (cn-merged); a className on a render CHILD would
          // only concatenate. bare/none: the row owns its box; the base keeps focus ring.
          <Button
            variant="bare"
            size="none"
            className="group w-full items-start justify-start gap-3 whitespace-normal py-4 text-left font-normal active:scale-100"
          />
        }
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
        <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-ink-4 transition-transform group-data-[panel-open]:rotate-180" />
      </Collapsible.Trigger>

      <Collapsible.Panel className="border-t border-border py-4">
        {Array.isArray(trip.interests) && trip.interests.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {trip.interests.map((interest) => {
              const label = interestLabel(interest)
              return (
                <Badge key={interest} variant="neutral">
                  {label ? (vi ? label[1] : label[0]) : interest}
                </Badge>
              )
            })}
          </div>
        )}

        <ol className="space-y-4">
          {trip.dayPlans.map((day) => (
            <li key={day.id} className="border-l-2 border-primary/30 pl-3">
              <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                {tr('Day', 'Ngày')} {day.dayNumber} · {loc(day.area, day.areaVi)}
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">{loc(day.title, day.titleVi)}</p>
              <div className="mt-2 space-y-1 text-xs leading-relaxed text-body">
                <p>
                  <strong className="font-semibold text-foreground">{tr('Morning', 'Sáng')}:</strong>{' '}
                  {loc(day.morning, day.morningVi)}
                </p>
                <p>
                  <strong className="font-semibold text-foreground">{tr('Afternoon', 'Chiều')}:</strong>{' '}
                  {loc(day.afternoon, day.afternoonVi)}
                </p>
                <p>
                  <strong className="font-semibold text-foreground">{tr('Evening', 'Tối')}:</strong>{' '}
                  {loc(day.evening, day.eveningVi)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {trip.stays.length > 0 && (
          <div className="mt-5 rounded-xl bg-tint p-4">
            <p className="text-2xs font-bold uppercase tracking-wide text-foreground">
              {tr('Stay shortlist', 'Danh sách chỗ ở')}
            </p>
            <ul className="mt-2 space-y-2 text-xs text-body">
              {trip.stays.map((stay) => (
                <li key={stay.id}>
                  <strong className="font-semibold text-foreground">{loc(stay.name, stay.nameVi)}</strong> ·{' '}
                  {loc(stay.area, stay.areaVi)}
                  {stay.estimatedNightly
                    ? ` · ${money(stay.estimatedNightly, stay.currency, moneyLocale(lang))}/${tr('night', 'đêm')}`
                    : ''}
                  {stay.note && <span className="block text-muted-foreground">{loc(stay.note, stay.noteVi)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ⚠️ THE ONLY DOOR TO THE PER-TRIP PAGE, and until now there was none. Owner, 2026-07-26:
            "how do we edit here activities we want to swap" — the answer was that you could not.
            /dashboard/trips/[id] holds the map and the stop editing, and it was reachable ONLY from
            the chat wizard's "Open the plan" card. Anyone who saved a plan from the builder, or came
            back a week later, expanded this row and hit a dead end.

            It sits in the PANEL beside the download, not in the row header: the header is a
            Collapsible.Trigger (a Button), and a link nested inside a button is invalid and would
            fight it for the tap. */}
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button asChild variant="cta">
            <Link href={`/dashboard/trips/${trip.id}`}>
              <Pencil className="h-4 w-4" />
              {tr('Open & edit', 'Mở & chỉnh sửa')}
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={downloadWord} disabled={downloading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? tr('Creating Word file…', 'Đang tạo tệp Word…') : tr('Download Word file', 'Tải tệp Word')}
          </Button>
          {/* Destructive, so it is the LAST control in the row and wears the quiet variant — it must
              not compete with "Open & edit" for the thumb. A confirm step because a trip is minutes
              of the traveller's answers plus an AI generation, and nothing here can bring it back. */}
          <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                  {tr('Delete', 'Xóa')}
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
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
