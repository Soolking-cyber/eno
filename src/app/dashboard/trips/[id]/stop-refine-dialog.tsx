'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPinOff, Sparkles, Trash2, Wallet, Clock, Footprints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Field, FieldLabel, FieldControl } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { moneyLocale } from '@/lib/vnd'
import { useDualMoney } from '@/context/currency-context'
import { formatTravel } from '@/lib/travel'

/**
 * "Not this one — what else?"
 *
 * ⚠️ THIS ADDS A PATH, IT DOES NOT TAKE ONE (the owner's constraint, and the thing most likely to be
 * eroded later). Removing outright stays ONE tap from here — "Just remove it" is present AND ENABLED
 * in every state of this dialog, including while suggestions are loading and after they have failed.
 * It is disabled only while a write is actually in flight. Nobody who just wants the activity gone is
 * ever made to wait on an AI call, let alone read three alternatives first.
 *
 * ⚠️ NOTHING HERE TOUCHES THE ITINERARY UNTIL THE TRAVELLER PICKS. Asking for suggestions calls a
 * route that writes no itinerary data — it does spend one of the trip's refinements, which is what
 * that counter is for — so closing the dialog, or choosing "Keep it", leaves the stop
 * byte-identical. That is why this is a dialog and not a delete-then-undo.
 */

type Suggestion = {
  name: string
  place: string
  time: string
  details: string
  travelMinutes: number
  estimatedCostVnd: number
  bookingAdvice: string
  lat: number | null
  lng: number | null
  mapped: boolean
}

/** Exactly the shape the stops endpoint's `replace` action validates. */
export type StopReplacement = {
  name: string
  place: string
  time: string | null
  details: string | null
  lat: number | null
  lng: number | null
  travelMinutes: number | null
  estimatedCostVnd: number | null
  bookingAdvice: string | null
}

export type RefineTarget = { dayId: string; stopId: string; name: string; place: string }

const REASONS = [
  { id: 'too_far', en: 'Too far away', vi: 'Quá xa' },
  { id: 'not_interested', en: 'Not interested', vi: 'Không thích' },
  { id: 'too_expensive', en: 'Too expensive', vi: 'Quá đắt' },
  { id: 'closed', en: 'Closed or gone', vi: 'Đã đóng cửa' },
] as const

const PREFERENCE_MAX = 300

export function StopRefineDialog({ itineraryId, target, onClose, onRemove, onApply }: {
  itineraryId: string
  /** null closes the dialog. Carrying the whole target rather than a bare id keeps the heading
   *  honest about WHICH activity is being replaced. */
  target: RefineTarget | null
  onClose: () => void
  onRemove: (dayId: string, stopId: string) => void | Promise<void>
  onApply: (dayId: string, stopId: string, replacement: StopReplacement) => void | Promise<void>
}) {
  const { tr, lang } = useLanguage()
  const dualMoney = useDualMoney()
  const [reasons, setReasons] = useState<string[]>([])
  const [preference, setPreference] = useState('')
  /**
   * ⚠️ TWO FLAGS, NOT ONE, and this was a real defect caught by review and then confirmed by probing
   * the rendered dialog: with a single `busy`, asking for suggestions disabled "Just remove it" for
   * the whole round trip. The measured result was `DURING ask — remove enabled: false`, which flatly
   * contradicts the promise at the top of this file. Waiting on an optional AI call must never take
   * away the plain action, so only a WRITE disables anything.
   */
  const [asking, setAsking] = useState(false)
  const [writing, setWriting] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Guards that cannot be beaten by render timing.
   *
   * `writingRef` — a second tap in the SAME frame as the first runs before React has re-rendered the
   * disabled button, so `writing` alone does not stop a double POST. A ref flips synchronously.
   *
   * `askSeq` — a suggestion response must only be shown if it is still the answer to the question on
   * screen. Escape-then-reopen-a-different-stop while a request is in flight would otherwise land the
   * FIRST activity's suggestions under the SECOND one's heading, and applying one would write
   * alternatives chosen for something else.
   */
  const writingRef = useRef(false)
  const askSeq = useRef(0)

  // Reset on every OPEN, not on close: a dialog that clears while it is animating out shows the
  // reader their own answers being wiped.
  //
  // ⚠️ KEYED ON THE TARGET OBJECT, not on `target.stopId`. The parent mints a fresh object on every
  // tap, so this resets when the SAME activity is reopened too — keying on the id would have carried
  // the last visit's reasons and suggestions back in, which reads as the dialog having remembered a
  // decision the traveller already abandoned.
  useEffect(() => {
    if (!target) return
    // Retires any suggestion request still in flight from a previous open — see askSeq.
    askSeq.current += 1
    setReasons([])
    setPreference('')
    setSuggestions(null)
    setRemaining(null)
    setError(null)
    setAsking(false)
  }, [target])

  if (!target) return null

  const toggleReason = (id: string) =>
    setReasons((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))

  const ask = async () => {
    const seq = askSeq.current
    setAsking(true)
    setError(null)
    try {
      const res = await fetch(`/api/itineraries/${encodeURIComponent(itineraryId)}/stops/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dayId: target.dayId, stopId: target.stopId, reasons, preference }),
      })
      const data = (await res.json().catch(() => ({}))) as { suggestions?: Suggestion[]; remaining?: number; error?: string }
      // The dialog has moved on to a different activity (or closed and reopened) — this answer is
      // no longer to the question on screen, so it is dropped rather than displayed.
      if (askSeq.current !== seq) return
      if (!res.ok) {
        // Each of these means something different to the traveller, so none of them collapses into
        // "something went wrong" — especially the lifetime cap, which is not a transient failure and
        // must not invite a retry that cannot succeed.
        setError(
          data.error === 'refinement_limit'
            ? tr("You've used all the suggestions for this trip. You can still remove the activity.",
                 'Bạn đã dùng hết số lần gợi ý cho chuyến đi này. Bạn vẫn có thể xóa hoạt động.')
            : res.status === 429
              ? tr('Too many requests just now — try again in a minute.', 'Quá nhiều yêu cầu — thử lại sau một phút.')
              : data.error === 'no_suggestions'
                ? tr("We couldn't find anything different for this slot.", 'Không tìm được hoạt động nào khác cho khung giờ này.')
                : tr("We couldn't get suggestions right now.", 'Hiện chưa lấy được gợi ý.'),
        )
        return
      }
      setSuggestions(data.suggestions ?? [])
      setRemaining(typeof data.remaining === 'number' ? data.remaining : null)
    } catch {
      if (askSeq.current === seq) setError(tr('Check your connection and try again.', 'Kiểm tra kết nối và thử lại.'))
    } finally {
      if (askSeq.current === seq) setAsking(false)
    }
  }

  const apply = async (suggestion: Suggestion) => {
    if (writingRef.current) return
    writingRef.current = true
    setWriting(true)
    // ⚠️ Sent as the endpoint's own nullable shape rather than the display strings: an empty string
    // is not "no time", it is a blank one, and it would render as a stray empty chip forever.
    const replacement: StopReplacement = {
      name: suggestion.name,
      place: suggestion.place,
      time: suggestion.time || null,
      details: suggestion.details || null,
      lat: suggestion.lat,
      lng: suggestion.lng,
      travelMinutes: suggestion.travelMinutes || null,
      estimatedCostVnd: suggestion.estimatedCostVnd || null,
      bookingAdvice: suggestion.bookingAdvice || null,
    }
    try {
      await onApply(target.dayId, target.stopId, replacement)
    } finally {
      // Closing in a `finally` so a rejecting parent cannot strand the traveller in a dialog whose
      // buttons are all disabled. The parent surfaces the failure on the page behind this.
      writingRef.current = false
      onClose()
    }
  }

  const remove = async () => {
    if (writingRef.current) return
    writingRef.current = true
    setWriting(true)
    try {
      await onRemove(target.dayId, target.stopId)
    } finally {
      writingRef.current = false
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Replace this activity?', 'Thay hoạt động này?')}</DialogTitle>
          <DialogDescription>
            {tr(`We can suggest something else instead of ${target.name}, or just take it off the day.`,
                `Chúng tôi có thể gợi ý hoạt động khác thay cho ${target.name}, hoặc chỉ cần bỏ khỏi ngày.`)}
          </DialogDescription>
        </DialogHeader>

        {suggestions === null ? (
          <div className="space-y-4">
            {/* Toggle BUTTONS with aria-pressed, matching the day tabs in the list beside this
                dialog. Base UI is the standing first choice and ships a ToggleGroup, but there is
                no `ui/toggle-group` primitive yet and `src/components/ui/**` is outside this task's
                owned paths — so this reuses `ui/button` in the same shape the feature already uses,
                rather than hand-rolling a new control or widening scope. */}
            <div role="group" aria-label={tr("What's wrong with it?", 'Điều gì chưa phù hợp?')} className="space-y-2">
              <p className="text-xs font-semibold text-body">{tr("What's wrong with it?", 'Điều gì chưa phù hợp?')}</p>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((reason) => {
                  const on = reasons.includes(reason.id)
                  return (
                    <Button
                      key={reason.id}
                      type="button"
                      variant="bare"
                      size="none"
                      aria-pressed={on}
                      onClick={() => toggleReason(reason.id)}
                      className={cn(
                        'rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                        on ? 'border-brand bg-accent text-accent-foreground' : 'border-border text-body hover:bg-tint',
                      )}
                    >
                      {tr(reason.en, reason.vi)}
                    </Button>
                  )
                })}
              </div>
            </div>

            <Field>
              <FieldLabel className="text-xs font-semibold text-body">
                {tr('What would you prefer? (optional)', 'Bạn muốn gì hơn? (không bắt buộc)')}
              </FieldLabel>
              {/* No explicit ids: Base UI's Field wires label to control itself, and a DOM probe of
                  the rendered dialog confirmed it overrides ours anyway (one `id` attribute,
                  `label[for]` correctly resolved). An id here would only look load-bearing. */}
              <FieldControl
                render={
                  <Textarea
                    rows={3}
                    size="compact"
                    maxLength={PREFERENCE_MAX}
                    value={preference}
                    onChange={(e) => setPreference(e.target.value.slice(0, PREFERENCE_MAX))}
                    placeholder={tr('Somewhere quieter, near the river…', 'Nơi yên tĩnh hơn, gần sông…')}
                  />
                }
              />
            </Field>

            {error && <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {/* Destructive and FIRST in the DOM so it is never buried, but visually trailing on
                  desktop where the primary action sits right. */}
              <Button type="button" variant="secondary" disabled={writing} onClick={() => void remove()} className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" aria-hidden />
                {tr('Just remove it', 'Chỉ cần xóa')}
              </Button>
              <Button type="button" disabled={asking || writing} onClick={() => void ask()} className="gap-2">
                {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {tr('Suggest replacements', 'Gợi ý thay thế')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.length === 0 && (
              <p className="text-sm text-body">
                {tr("We couldn't find anything different for this slot.", 'Không tìm được hoạt động nào khác cho khung giờ này.')}
              </p>
            )}
            <ul className="space-y-2">
              {suggestions.map((suggestion, index) => (
                // Position-qualified: the route dedupes by place, but a list key should not depend on
                // a server invariant holding forever.
                <li key={`${index}-${suggestion.place}`} className="rounded-xl border border-border/70 p-3">
                  <p className="text-sm font-semibold text-foreground">{suggestion.name}</p>
                  <p className="text-xs text-body">{suggestion.place}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-4">
                    {suggestion.time && (
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{suggestion.time}</span>
                    )}
                    {suggestion.travelMinutes > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Footprints className="h-3 w-3" aria-hidden />
                        {formatTravel({ straightKm: 0, roadKm: 0, minutes: suggestion.travelMinutes }, lang === 'vi' ? 'vi' : 'en').time}
                      </span>
                    )}
                    {suggestion.estimatedCostVnd > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Wallet className="h-3 w-3" aria-hidden />
                        {dualMoney(suggestion.estimatedCostVnd, moneyLocale(lang))}
                      </span>
                    )}
                  </div>
                  {suggestion.details && <p className="mt-1.5 text-xs text-body">{suggestion.details}</p>}
                  {/* ⚠️ SAID, not silently different — the same rule the list follows for an unmapped
                      stop. An offer we cannot plot is still a real offer; what is missing is a
                      location we could resolve, and that is a sentence rather than an absence. */}
                  {!suggestion.mapped && (
                    <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-tint px-1.5 py-0.5 text-3xs font-bold text-ink-4">
                      <MapPinOff className="h-2.5 w-2.5 shrink-0" aria-hidden />
                      {tr("We couldn't place this on the map", 'Chưa xác định được vị trí trên bản đồ')}
                    </p>
                  )}
                  <Button type="button" size="sm" disabled={writing} onClick={() => void apply(suggestion)} className="mt-2.5">
                    {tr('Use this one', 'Chọn cái này')}
                  </Button>
                </li>
              ))}
            </ul>

            {typeof remaining === 'number' && (
              <p className="text-3xs text-ink-4">
                {remaining === 1
                  ? tr('1 more suggestion left for this trip', 'Còn 1 lần gợi ý cho chuyến đi này')
                  : tr(`${remaining} more suggestions left for this trip`, `Còn ${remaining} lần gợi ý cho chuyến đi này`)}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" disabled={writing} onClick={() => void remove()} className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" aria-hidden />
                {tr('Just remove it', 'Chỉ cần xóa')}
              </Button>
              {/* Declining is a real, named outcome — and it genuinely changes nothing, because
                  asking for suggestions never wrote anything. */}
              <Button type="button" variant="secondary" disabled={writing} onClick={onClose}>
                {tr('Keep it after all', 'Vẫn giữ lại')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
