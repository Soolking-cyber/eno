'use client'

import { useEffect, useRef, useState } from 'react'
import { BedDouble, Loader2, MapPin, Sparkles, Wallet } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Field, FieldLabel, FieldControl } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { moneyLocale } from '@/lib/vnd'
import { useDualMoney } from '@/context/currency-context'

/**
 * "Not this hotel — what else?"
 *
 * ⚠️ THE ACTIVITY DIALOG'S SIBLING, WITH ONE DELIBERATE DIFFERENCE: there is no destructive action.
 * `StopRefineDialog` keeps "Just remove it" enabled in every state because removing an activity is a
 * legitimate outcome; a trip with no accommodation is not. So this dialog swaps or it changes
 * nothing, and the write route has no delete action to call even if a button appeared here.
 *
 * ⚠️ NOTHING HERE TOUCHES THE TRIP UNTIL THE TRAVELLER PICKS. Asking for suggestions calls a route
 * that writes no trip data — it does spend one of the trip's twelve refinements, shared with activity
 * suggestions, which is what that counter is for — so closing the dialog, or choosing "Keep it",
 * leaves the row byte-identical.
 */

type Suggestion = {
  name: string
  area: string
  note: string
  estimatedNightlyVnd: number
}

/** Exactly the shape the stays endpoint's `replace` action validates. */
export type StayReplacementInput = {
  name: string
  area: string
  note: string | null
  estimatedNightlyVnd: number | null
}

export type StayRefineTarget = { stayId: string; name: string; area: string }

const REASONS = [
  { id: 'too_expensive', en: 'Too expensive', vi: 'Quá đắt' },
  { id: 'wrong_area', en: 'Wrong area', vi: 'Sai khu vực' },
  { id: 'too_basic', en: 'Want somewhere nicer', vi: 'Muốn chỗ tốt hơn' },
  { id: 'not_available', en: 'Full or closed', vi: 'Hết phòng hoặc đã đóng' },
] as const

const PREFERENCE_MAX = 300

export function StayRefineDialog({ itineraryId, target, onClose, onApply }: {
  itineraryId: string
  /** null closes the dialog. Carrying the whole target rather than a bare id keeps the heading honest
   *  about WHICH hotel is being replaced. */
  target: StayRefineTarget | null
  onClose: () => void
  onApply: (stayId: string, replacement: StayReplacementInput) => void | Promise<void>
}) {
  const { tr, lang } = useLanguage()
  const dualMoney = useDualMoney()
  const [reasons, setReasons] = useState<string[]>([])
  const [preference, setPreference] = useState('')
  const [asking, setAsking] = useState(false)
  const [writing, setWriting] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Guards that cannot be beaten by render timing — both carried over from the activity dialog,
   * where each was a real defect.
   *
   * `writingRef` — a second tap in the SAME frame as the first runs before React has re-rendered the
   * disabled button, so `writing` alone does not stop a double POST. A ref flips synchronously.
   *
   * `askSeq` — a suggestion response must only be shown if it is still the answer to the question on
   * screen. Escape-then-reopen-a-different-hotel while a request is in flight would otherwise land
   * the FIRST row's suggestions under the SECOND one's heading, and applying one would write a hotel
   * chosen for somewhere else.
   */
  const writingRef = useRef(false)
  const askSeq = useRef(0)

  // Reset on every OPEN, not on close: a dialog that clears while animating out shows the reader
  // their own answers being wiped.
  //
  // ⚠️ KEYED ON THE TARGET OBJECT, not on `target.stayId`. The parent mints a fresh object on every
  // tap, so this resets when the SAME hotel is reopened too — keying on the id would carry the last
  // visit's reasons and suggestions back in, which reads as the dialog having remembered a decision
  // the traveller already abandoned.
  useEffect(() => {
    /**
     * ⚠️ THE INCREMENT IS ABOVE THE EARLY RETURN, so an in-flight request is retired on CLOSE as well
     * as on open. It read the other way round first, and a review of the finished code broke it: with
     * the guard only bumped on open, a response arriving while the dialog was shut still passed its
     * own sequence check and wrote itself into `suggestions`. Nothing rendered — the component
     * returns null with no target — but the state survived, so the NEXT open painted the previous
     * hotel's alternatives under the new hotel's heading for the frame before this effect ran, with
     * live "Stay here instead" buttons that would have written a suggestion chosen for somewhere
     * else. Retiring the request costs nothing and closes the window entirely.
     */
    askSeq.current += 1
    if (!target) return
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
      const res = await fetch(`/api/itineraries/${encodeURIComponent(itineraryId)}/stays/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ stayId: target.stayId, reasons, preference }),
      })
      const data = (await res.json().catch(() => ({}))) as { suggestions?: Suggestion[]; remaining?: number; error?: string }
      // The dialog has moved on to a different hotel (or closed and reopened) — this answer is no
      // longer to the question on screen, so it is dropped rather than displayed.
      if (askSeq.current !== seq) return
      if (!res.ok) {
        // Each of these means something different to the traveller, so none collapses into "something
        // went wrong" — especially the lifetime cap, which is not transient and must not invite a
        // retry that cannot succeed. It says "for this trip" because the budget is shared with
        // activity suggestions, and a traveller who spent it there must not read this as a bug.
        setError(
          data.error === 'refinement_limit'
            ? tr("You've used all the suggestions for this trip. You can still ask the desk in the chat.",
                 'Bạn đã dùng hết số lần gợi ý cho chuyến đi này. Bạn vẫn có thể nhắn cho bộ phận hỗ trợ.')
            : res.status === 429
              ? tr('Too many requests just now — try again in a minute.', 'Quá nhiều yêu cầu — thử lại sau một phút.')
              : data.error === 'no_suggestions'
                ? tr("We couldn't find anywhere different to suggest.", 'Không tìm được chỗ ở nào khác để gợi ý.')
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
    // ⚠️ Sent as the endpoint's own nullable shape rather than the display strings: an empty string is
    // not "no note", it is a blank one, and 0 is not "no price" — it is the model saying it could not
    // estimate honestly, which must render as nothing rather than as free.
    const replacement: StayReplacementInput = {
      name: suggestion.name,
      area: suggestion.area,
      note: suggestion.note || null,
      estimatedNightlyVnd: suggestion.estimatedNightlyVnd || null,
    }
    try {
      await onApply(target.stayId, replacement)
    } finally {
      /**
       * Closing in a `finally` so a rejecting parent cannot strand the traveller in a dialog whose
       * buttons are all disabled.
       *
       * ⚠️ IT CLOSES ON FAILURE TOO, AND THAT IS THE DESIGN, not an oversight — `onApply` resolves
       * the same way for a write that succeeded, one that lost a race and one that was refused, so
       * this dialog CANNOT tell them apart and deliberately does not try. Reporting belongs to the
       * page behind it, which has the response: it raises a `role="alert"` banner and, for 409 and
       * 404, re-reads the trip so the list stops disagreeing with the database. Duplicating that
       * judgement here would mean two components deciding what happened from different evidence.
       */
      writingRef.current = false
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Change where you stay?', 'Đổi chỗ ở?')}</DialogTitle>
          <DialogDescription>
            {tr(`We can suggest somewhere else instead of ${target.name}.`,
                `Chúng tôi có thể gợi ý chỗ khác thay cho ${target.name}.`)}
          </DialogDescription>
        </DialogHeader>

        {suggestions === null ? (
          <div className="space-y-4">
            {/* Toggle BUTTONS with aria-pressed, the same shape the activity dialog and the day tabs
                use. Base UI ships a ToggleGroup and is the standing first choice, but there is still
                no `ui/toggle-group` primitive — matching the feature's existing shape beats
                hand-rolling a second control here. */}
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
              {/* No explicit ids: Base UI's Field wires label to control itself and overrides ours. */}
              <FieldControl
                render={
                  <Textarea
                    rows={3}
                    size="compact"
                    maxLength={PREFERENCE_MAX}
                    value={preference}
                    onChange={(e) => setPreference(e.target.value.slice(0, PREFERENCE_MAX))}
                    placeholder={tr('Walking distance to the old quarter, with a pool…', 'Gần phố cổ, có hồ bơi…')}
                  />
                }
              />
            </Field>

            {error && <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" disabled={writing} onClick={onClose}>
                {tr('Keep it', 'Vẫn giữ')}
              </Button>
              <Button type="button" disabled={asking || writing} onClick={() => void ask()} className="gap-2">
                {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {tr('Suggest other places', 'Gợi ý chỗ khác')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.length === 0 && (
              <p className="text-sm text-body">
                {tr("We couldn't find anywhere different to suggest.", 'Không tìm được chỗ ở nào khác để gợi ý.')}
              </p>
            )}
            <ul className="space-y-2">
              {suggestions.map((suggestion, index) => (
                // Position-qualified: the route dedupes by name, but a list key should not depend on
                // a server invariant holding forever.
                <li key={`${index}-${suggestion.name}`} className="rounded-xl border border-border/70 p-3">
                  <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <BedDouble className="h-3.5 w-3.5 shrink-0 text-ink-4" aria-hidden />
                    {suggestion.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-4">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{suggestion.area}</span>
                    {/* 0 renders as nothing, not as "0 đ": the route uses 0 for "could not estimate
                        honestly", and a free hotel is a claim we would be making on its behalf. */}
                    {suggestion.estimatedNightlyVnd > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Wallet className="h-3 w-3" aria-hidden />
                        {dualMoney(suggestion.estimatedNightlyVnd, moneyLocale(lang))}/{tr('night', 'đêm')}
                      </span>
                    )}
                  </div>
                  {suggestion.note && <p className="mt-1.5 text-xs text-body">{suggestion.note}</p>}
                  <Button type="button" size="sm" disabled={writing} onClick={() => void apply(suggestion)} className="mt-2.5">
                    {tr('Stay here instead', 'Chọn chỗ này')}
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

            <div className="flex justify-end">
              {/* Declining is a real, named outcome — and it genuinely changes nothing, because asking
                  for suggestions never wrote anything to the trip. */}
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
