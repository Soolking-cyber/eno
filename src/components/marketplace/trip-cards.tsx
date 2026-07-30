'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarCheck, Check, ChevronDown, FolderOpen, Loader2, MapPinned, Sparkles, UserRound, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useCurrency, vndPerUsd } from '@/context/currency-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'

import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import {
  ACCOMMODATION_LABELS, BUDGETS, CITIES, DEFAULT_TRIP_DAYS, INTEREST_LABELS, PACE_LABELS,
} from '@/lib/itinerary-data'
import {
  firstIncompleteTripWizardStep, LAST_TRIP_WIZARD_STEP, tripWizardChip, tripWizardStepForField,
  type TripWizardStep,
} from '@/lib/trips/itinerary-wizard'
import { ChatCard, ChatCardSteps } from '@/components/marketplace/chat-card-shell'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ── TRIP ASSISTANCE CARDS, RENDERED INSIDE THE CHAT THREAD ─────────────────────────
//
// Two cards, and the asymmetry between them is the whole design (see TripQuoteMeta /
// TripStatusMeta in src/lib/messages.ts):
//
//   · TripQuoteCard is a LIVE HANDLE. Its message row carries a requestId and nothing else, so
//     the amounts are fetched here on every render. An operator who re-quotes never leaves a
//     contradicting number sitting in the traveller's timeline, and the accept/decline buttons
//     disappear on their own once the case is no longer `quoted` — including when it moved in
//     another tab, because the state is re-read rather than remembered.
//   · TripStatusCard is a HISTORICAL FACT. Its status was proven true at write time (the card
//     write re-asserts it against the case row), so it renders from meta and never re-reads.
//     Re-reading it would rewrite the past: a card posted on Tuesday would start claiming
//     today's status.
//
// ⚠️ NOTHING HERE IS AN AUTHORITY. The buttons call the API and re-read; every gate that matters
// (ownership, admin-ness, the legal transition) is enforced server-side, and `mine` comes from
// the server rather than being inferred from the viewer, so an operator is never shown an accept
// button that would accept on the traveller's behalf.

type AssistanceView = {
  requestId: string
  status: string
  supplierTotalVnd: number | null
  feeVnd: number | null
  quotedAt: string | null
  mine: boolean
}

/** Statuses the traveller can still act on from the card. */
const ACTIONABLE = 'quoted'

/**
 * The family eyebrow, spelled ONCE — the trip counterpart of the visa cards' "e-Visa".
 *
 * ⚠️ Not translated. "Trip" is the product name on this surface in both languages, the way "e-Visa"
 * is; a two-word Vietnamese phrase in a 10px uppercase eyebrow wraps the header row on a phone.
 */
const TRIP = 'Trip'

export function TripQuoteCard({ requestId }: { requestId: string }) {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const [view, setView] = useState<AssistanceView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/assistance/${encodeURIComponent(requestId)}`, { cache: 'no-store' })
      setView(res.ok ? await res.json() : null)
    } catch {
      // A card that cannot read its case renders as unavailable rather than as a broken bubble.
      setView(null)
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { void load() }, [load])

  const act = async (action: 'accept' | 'decline') => {
    if (busy) return
    setBusy(true)
    try {
      await fetch(`/api/trips/assistance/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      // Re-read rather than trust the response: the server is the only thing that knows what the
      // case ended up as, and a 409 (someone else moved it) must show the REAL state, not ours.
      // ⚠️ This makes the card correct AT THE MOMENT OF ACTING, not permanently. There is no
      // polling or subscription, so a case moved by an operator seconds later is not reflected
      // until the next render — the accept POST would then 409 and the re-read would correct it.
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      // ⚠️ `settled` while loading, so the tone can only ever brighten. Actionability is unknown
      // until the fetch lands, so SOME flip is unavoidable; dull→bright reads as "something you can
      // act on just arrived", where bright→dull is a promise withdrawn. (Raised by codex.)
      <ChatCard eyebrow={TRIP} icon={MapPinned} tone="settled">
        <Skeleton className="mt-1.5 h-4 w-40" />
        <Skeleton className="mt-3 h-6 w-32" />
        <Skeleton className="mt-2 h-4 w-24" />
      </ChatCard>
    )
  }

  if (!view || view.supplierTotalVnd === null || view.feeVnd === null) {
    return (
      <ChatCard eyebrow={TRIP} icon={MapPinned} tone="settled">
        <p className="mt-1.5 text-sm text-ink-4">{tr('This quote is no longer available.', 'Báo giá này không còn khả dụng.')}</p>
      </ChatCard>
    )
  }

  const total = view.supplierTotalVnd + view.feeVnd
  const live = view.mine && view.status === ACTIONABLE

  return (
    // ⚠️ `live` already meant "the traveller can still act on this" for the buttons below; it is
    // the same distinction the shell's tone draws, so it drives both rather than being re-derived.
    <ChatCard eyebrow={TRIP} icon={MapPinned} title={tr('Trip quote', 'Báo giá chuyến đi')} tone={live ? 'live' : 'settled'}>
      <dl className="mt-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-ink-3">{tr('Suppliers', 'Nhà cung cấp')}</dt>
          <dd className="text-sm tabular-nums text-ink-2">{formatMoneyFull(view.supplierTotalVnd, '₫', locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-ink-3">{tr('Our fee', 'Phí dịch vụ')}</dt>
          <dd className="text-sm tabular-nums text-ink-2">{formatMoneyFull(view.feeVnd, '₫', locale)}</dd>
        </div>
        <Separator className="my-2" />
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm font-semibold text-foreground">{tr('Total', 'Tổng cộng')}</dt>
          <dd className="text-base font-bold tabular-nums text-foreground">{formatMoneyFull(total, '₫', locale)}</dd>
        </div>
      </dl>

      {/* ⚠️ Says what eno does and does NOT do with this money. The traveller pays suppliers
          directly — no amount here is ever charged — and stating it on the card is the honest
          place, not a help page they would have to go looking for. */}
      <p className="mt-3 text-xs text-ink-4">
        {tr(
          'You pay suppliers directly. Nothing is charged here.',
          'Bạn thanh toán trực tiếp cho nhà cung cấp. Không có khoản nào bị trừ ở đây.',
        )}
      </p>

      {live ? (
        <div className="mt-4 flex gap-2">
          <Button variant="cta" className="flex-1" disabled={busy} onClick={() => void act('accept')}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            {tr('Accept', 'Chấp nhận')}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void act('decline')}>
            <X className="size-4" aria-hidden />
            {tr('Decline', 'Từ chối')}
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <TripStatusBadge status={view.status} />
        </div>
      )}
    </ChatCard>
  )
}

/** The announcement card. Renders from its own meta — see the note at the top of this file. */
export function TripStatusCard({ status }: { status: string }) {
  const { tr } = useLanguage()
  return (
    // Settled by nature: this card states a fact that was true when it was written (see the note at
    // the top of the file), and the status badge is what it has to say — so it takes the slot the
    // visa cards give their step counter.
    <ChatCard
      eyebrow={TRIP}
      icon={CalendarCheck}
      tone="settled"
      title={tr('Trip assistance', 'Hỗ trợ chuyến đi')}
      right={<TripStatusBadge status={status} />}
    />
  )
}

function TripStatusBadge({ status }: { status: string }) {
  const { tr } = useLanguage()
  // One row per status of the machine. An unknown status renders its raw name rather than
  // nothing, so a card from a newer build degrades to something legible instead of a blank chip.
  const label: Record<string, string> = {
    requested: tr('Requested', 'Đã gửi yêu cầu'),
    reviewing: tr('Being reviewed', 'Đang xem xét'),
    quoted: tr('Quote ready', 'Đã có báo giá'),
    accepted: tr('Accepted', 'Đã chấp nhận'),
    arranging: tr('Arranging', 'Đang sắp xếp'),
    completed: tr('Arranged', 'Đã hoàn tất'),
    declined: tr('Declined', 'Đã từ chối'),
    cancelled: tr('Cancelled', 'Đã huỷ'),
  }
  // Tones from the badge primitive's own vocabulary — no new variant invented for this card.
  const tone = status === 'completed' || status === 'accepted'
    ? 'success' as const
    : status === 'declined' || status === 'cancelled'
      ? 'neutral' as const
      : 'brand' as const
  return <Badge variant={tone}>{label[status] ?? status}</Badge>
}

// ── THE IN-CHAT ITINERARY WIZARD ───────────────────────────────────────────────────────────
//
// Five steps in one bubble. The card is updated in place by the server (one message row that
// moves), so this component renders whichever step the row currently names.
//
// ⚠️ THE ANSWERS NEVER LEAVE THIS COMPONENT except on their way to a request. They live in React
// state for the duration; the card's metaJson holds a step number and a state, and the server
// validates each step's answers and then discards them. The notes field in particular — where
// somebody writes "honeymoon" or an access requirement — is typed on the last step and spent
// immediately on the generate call.
//
// ⚠️ IT CALLS /api/itineraries/generate DIRECTLY, exactly as the dashboard builder does. That is
// what keeps generation to ONE entrance: the same aiGuard('itinerary', 8), the same global daily
// caps, one budget per traveller across both surfaces. Do not proxy it through /api/trips/**.

type WizardStepMeta = { step: number; state: string; itineraryId?: string }

type Draft = {
  cityIds: string[]
  days: number
  startDate: string
  travelers: number
  budgetId: string
  pace: string
  accommodation: string
  interests: string[]
  flight: { include: boolean; cabin: string; maxStops: string; checkedBags: boolean }
  origin: string
  notes: string
}

/** Schema bounds from FIELD_SHAPE.budgetDailyVnd — restated so the field refuses before POSTing. */
const MIN_CUSTOM_DAILY_VND = 100_000
const MAX_CUSTOM_DAILY_VND = 100_000_000

/** The tier a custom amount is closest to, so `budgetId` stays truthful for what stores one. */
function nearestBudgetTier(dailyVnd: number | null): string {
  if (!dailyVnd) return 'comfort'
  return BUDGETS.reduce((best, tier) =>
    Math.abs(tier.daily - dailyVnd) < Math.abs(best.daily - dailyVnd) ? tier : best, BUDGETS[0]).id
}

const EMPTY_DRAFT: Draft = {
  cityIds: [], days: DEFAULT_TRIP_DAYS, startDate: '', travelers: 2,
  budgetId: 'comfort', pace: 'balanced', accommodation: 'hotel', interests: [],
  flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false },
  origin: '', notes: '',
}

/**
 * Where a half-finished draft survives a reload.
 *
 * ⚠️ THE SERVER DELIBERATELY KEEPS NOTHING. `advanceTripWizard` validates each step and then
 * discards the values — "keeping them would put a traveller's plan in a column nothing here
 * governs" (wizard-flow.ts) — which is a privacy decision, not an oversight, and it is why the
 * answers can only live on the client. Before this, they lived ONLY in React state: reloading the
 * page restored `step` from the server row while `draft` reset to EMPTY_DRAFT, so the traveller
 * came back to step 5 with nothing filled in, "Build my plan" posted an empty request and 400'd
 * forever, and there was no Back and no restart. sessionStorage (not local) keeps that recovery on
 * the same device and clears itself with the tab.
 */
/** Rail labels — what each step ASKED, so a traveller scanning back knows which one to tap. */
const STEP_LABELS = [
  { en: 'Destination', vi: 'Điểm đến' },
  { en: 'Dates', vi: 'Ngày đi' },
  { en: 'Budget', vi: 'Ngân sách' },
  { en: 'Interests', vi: 'Sở thích' },
  { en: 'Flights', vi: 'Chuyến bay' },
] as const

const draftKey = (messageId: string) => `trip-wizard:${messageId}`

function loadDraft(messageId: string): Draft {
  try {
    const raw = sessionStorage.getItem(draftKey(messageId))
    if (!raw) return EMPTY_DRAFT
    // Spread over EMPTY_DRAFT so a stored shape written by an older build cannot leave a field
    // undefined that the inputs assume is present.
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) }
  } catch { return EMPTY_DRAFT }
}

export function TripWizardCard({ conversationId, messageId, meta }: { conversationId: string; messageId: string; meta: WizardStepMeta }) {
  const { tr, lang } = useLanguage()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  /** WHICH card's answers are loaded — not merely 'some card's'. See the repair effect. */
  const [hydratedCard, setHydratedCard] = useState<string | null>(null)
  // "My own budget" — a fourth CHOICE, not a fourth BudgetId (that enum is stored and label-mapped).
  const [customBudgetOn, setCustomBudgetOn] = useState(false)
  /** Raw text in whichever unit the field is asking for. Parsed on use, never on keystroke. */
  const [customBudgetText, setCustomBudgetText] = useState('')
  // Plausibility-banded đồng-per-dollar — a bare `> 0` check would let an absurd-but-positive rate
  // convert a sensible $120 into a figure that still passes the schema and becomes the AI's target.
  const usdRate = vndPerUsd(useCurrency().rates)
  const usdPerDay = (vnd: number) => (usdRate ? `$${Math.round(vnd / usdRate).toLocaleString('en-US')}` : '')
  // ⚠️ The field's UNIT follows the rate, so the text is cleared when that flips — otherwise
  // "3000000" typed as đồng becomes three million DOLLARS the moment rates arrive.
  const unitIsUsd = !!usdRate
  const lastUnitIsUsd = useRef(unitIsUsd)
  useEffect(() => {
    if (lastUnitIsUsd.current !== unitIsUsd) { lastUnitIsUsd.current = unitIsUsd; setCustomBudgetText('') }
  }, [unitIsUsd])
  const customBudgetVnd = useMemo(() => {
    const typed = Number(customBudgetText.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(typed) || typed <= 0) return null
    const vnd = Math.round(usdRate ? typed * usdRate : typed)
    return vnd >= MIN_CUSTOM_DAILY_VND && vnd <= MAX_CUSTOM_DAILY_VND ? vnd : null
  }, [customBudgetText, usdRate])
  /** Typed something unusable — say so rather than silently planning to a tier they never chose. */
  const customBudgetInvalid = customBudgetOn && customBudgetText.trim() !== '' && customBudgetVnd === null
  const [step, setStep] = useState(meta.step)
  /**
   * The step being REVIEWED, when the traveller has tapped back into an earlier one. Null = follow
   * the server's step.
   *
   * ⚠️ SEPARATE FROM `step` ON PURPOSE. `step` is the server's, and the poll below re-syncs it; if
   * going back wrote to `step`, the next poll would yank the traveller out of the answer they were
   * mid-way through editing. This shadows it for rendering only, and nothing here posts.
   */
  const [editingStep, setEditingStep] = useState<number | null>(null)
  /** What the body renders: the step being reviewed if there is one, else the server's step. */
  const view = editingStep ?? step
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [itineraryId, setItineraryId] = useState<string | null>(meta.itineraryId ?? null)
  const done = meta.state === 'done' || Boolean(itineraryId)

  // The server owns the step. If the row moved (another tab, a resume), follow it rather than
  // keeping a local number that would let the traveller answer a question nobody asked.
  /**
   * ⚠️ THE SERVER'S STEP IS A CEILING, NOT A TRUTH — the answers may not have survived with it.
   *
   * The STEP lives on the server (the card row); the ANSWERS live in sessionStorage keyed on the
   * message. Those two have different lifetimes, so opening the thread in a new tab — or coming
   * back the next day — restores "step 5" over a draft that has reset to EMPTY_DRAFT. The card then
   * showed the last question with nothing behind it, and "Build my plan" posted `cityIds: []` and
   * `interests: []` to a schema that refuses both, so the traveller hit
   * "That did not go through. Please try again." and retrying could never work. Reported from
   * production as a 400 on /api/itineraries/generate.
   *
   * Landing on the first UNANSWERED step instead is the honest reading of that state: the server
   * knows how far they got, the draft knows what is still known, and where those disagree the draft
   * wins — it is the thing that has to be posted. A complete draft yields null and the server's step
   * stands, so nothing changes for the normal path.
   */
  /**
   * ⚠️ THE VIEW FOLLOWS THE CARD, FULL STOP.
   *
   * An earlier cut derived the rendered step from the DRAFT (land on the first unanswered step) and
   * that was wrong in a way worth remembering: the card is what `advance` validates against, so a
   * view that disagrees with it produces a 409 on the very next tap. Recovering from a draft that
   * outlived its answers is a WRITE — see the `goto` call in build() — not a render-time opinion.
   */
  useEffect(() => { setStep(meta.step) }, [meta.step])

  /**
   * ⚠️ REPAIR A CARD THAT HAS OUTLIVED ITS ANSWERS, ON ARRIVAL — not when they reach for Build.
   *
   * Without this the traveller lands on step 5 of a draft that no longer has any answers, taps
   * "Build my plan", and only THEN gets moved back to step 1. Correct, but it makes them discover
   * the breakage. Detecting it on mount and moving the card immediately means the wizard simply
   * opens at the first question it still needs.
   *
   * ⚠️ ONCE PER CARD, and only BACKWARDS. `sentRepair` stops a re-render (or the 15s poll swapping
   * `meta`) from firing a second write, and goto itself refuses any forward jump — so the worst a
   * bug here can do is ask the card to stay where it is, which is a no-op server-side.
   * A complete draft yields null and nothing is written at all, which is the normal path.
   */
  /** The card this component has already repaired, so a re-render or the poll cannot repeat it. */
  const repairedCard = useRef<string | null>(null)
  useEffect(() => {
    // Gated on `hydrated`: see the note on the hydration effect — without it this reads the empty
    // default and rewinds a perfectly good wizard.
    // ⚠️ HYDRATION IS TRACKED PER CARD, NOT AS A BOOLEAN. A plain `hydrated` flag stays true when
    // `messageId` changes, and because this effect is declared BEFORE the hydration effect it would
    // then run for the NEW card while `draft` still held the PREVIOUS one's answers — rewinding a
    // wizard whose stored answers are complete. Comparing the id means "the draft in hand belongs
    // to this card", which is the thing actually being relied on. Caught by codex.
    if (hydratedCard !== messageId || meta.state !== 'active' || repairedCard.current === messageId) return
    const missing = firstIncompleteTripWizardStep(draft)
    if (missing === null || missing >= meta.step) return
    repairedCard.current = messageId
    void (async () => {
      try {
        // ⚠️ THE VIEW MOVES ONLY AFTER THE CARD DOES. Setting local step regardless of the response
        // is what produced the 409 loop in the first place — a client that believes a step the
        // server never accepted. `expectedStep` also makes this a compare-and-set, so a second tab
        // advancing underneath us loses the race cleanly instead of silently rewinding their work.
        const res = await post({ action: 'goto', conversationId, step: missing, expectedStep: meta.step })
        if (typeof res.step === 'number') setStep(res.step)
      } catch {
        // The card stays where it is and so does the view — they remain in agreement, which is the
        // property that matters. build() still refuses to generate from an incomplete draft.
      }
    })()
    // `draft` is intentionally absent: this is an arrival-time repair keyed on hydration, not a
    // live rule. Re-running it as they type would drag them backwards mid-answer. (No
    // eslint-disable: the rule does not flag it, and a directive nothing suppresses is itself a
    // lint warning — which is how this line was found.)
  }, [hydratedCard, meta.step, meta.state, messageId, conversationId])

  // Hydrate once per card. Keyed by the CARD's message id, so two wizards in different threads
  // cannot read each other's answers.
  //
  // ⚠️ `hydrated` EXISTS SO THE REPAIR BELOW CANNOT RUN ON A DRAFT THAT IS ONLY EMPTY BECAUSE THIS
  // HAS NOT RUN YET. `draft` initialises to EMPTY_DRAFT and is filled HERE, in an effect — reading
  // sessionStorage during render would break SSR hydration. My first arrival-repair had no such
  // gate and would therefore have inspected the empty default on every mount and rewound EVERY
  // valid step-5 card to step 1: strictly worse than the bug it was fixing. Caught by codex.
  useEffect(() => { setDraft(loadDraft(messageId)); setHydratedCard(messageId) }, [messageId])

  const patch = (next: Partial<Draft>) => setDraft((current) => {
    const merged = { ...current, ...next }
    try { sessionStorage.setItem(draftKey(messageId), JSON.stringify(merged)) } catch {}
    return merged
  })

  // Finished: the answers have become an itinerary, so the draft is dead weight and keeping it
  // would repopulate a fresh wizard with a previous trip's answers.
  useEffect(() => { if (done) { try { sessionStorage.removeItem(draftKey(messageId)) } catch {} } }, [done, messageId])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/trips/wizard', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'update_failed')
    return res.json() as Promise<{ step: number | null }>
  }

  const answersFor = (which: number): Record<string, unknown> => {
    switch (which) {
      case 1: return { cityIds: draft.cityIds, cityDays: [], days: draft.days }
      case 2: return { startDate: draft.startDate, travelers: draft.travelers }
      // budgetId is ALWAYS sent — on a custom amount it is the nearest tier, so everything that
      // stores or renders a tier keeps working. budgetDailyVnd rides alongside only when they
      // named a usable number, and the generator prefers it over the tier's figure.
      case 3: return {
        budgetId: customBudgetOn ? nearestBudgetTier(customBudgetVnd) : draft.budgetId,
        ...(customBudgetOn && customBudgetVnd ? { budgetDailyVnd: customBudgetVnd } : {}),
        pace: draft.pace,
      }
      case 4: return { accommodation: draft.accommodation, interests: draft.interests }
      default: return { flight: draft.flight, origin: draft.origin, notes: draft.notes }
    }
  }

  const next = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const result = await post({ action: 'advance', conversationId, step, answers: answersFor(step) })
      if (result.step) setStep(result.step)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const build = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      // ⚠️ NEVER GENERATE FROM AN INCOMPLETE DRAFT — THIS WAS AN UNWINNABLE DEAD END.
      //
      // The STEP lives on the server (the card row) but the ANSWERS live in sessionStorage keyed on
      // the message. Open the thread in a new tab, or come back tomorrow, and the server still says
      // "step 5" while the draft has reset to EMPTY_DRAFT — so "Build my plan" posted
      // `cityIds: []` and `interests: []`, which the request schema refuses (both are min-1).
      // The traveller got "That did not go through. Please try again." and retrying could NEVER
      // work, because nothing about the empty draft changes on a retry. Reported from production
      // with a 400 on /api/itineraries/generate. The recovery comment above sessionStorage says
      // this was already known to be the failure shape; the submit path just never checked.
      //
      // firstIncompleteTripWizardStep has existed for exactly this and had no caller. It validates
      // each step's own fields and returns the FIRST unanswered one, so the fix is to send the
      // traveller back there instead of spending a generation token on a body we can already see
      // is invalid — the route's own note is that a rejected generate still costs quota on the most
      // expensive path in the app.
      const missing = firstIncompleteTripWizardStep(draft)
      if (missing) {
        setError('incomplete')
        // ⚠️ MOVE THE CARD, NOT JUST THE VIEW. Setting local step alone swapped one dead end for
        // another: `Next` then answered step 1 while the card still said 5, and advance correctly
        // refused it as a step_mismatch (409 in production). The card is the authority on the step.
        const moved = await post({ action: 'goto', conversationId, step: missing, expectedStep: step })
        if (typeof moved.step === 'number') setStep(moved.step)
        return
      }
      // Record the last step's answers first, so a generate failure does not lose them silently.
      await post({ action: 'advance', conversationId, step: LAST_TRIP_WIZARD_STEP, answers: answersFor(5) })
      // ⚠️ THE SAME ENDPOINT THE DASHBOARD BUILDER USES. One entrance, one set of cost guards.
      const res = await fetch('/api/itineraries/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...answersFor(1), ...answersFor(2), ...answersFor(3), ...answersFor(4), ...answersFor(5), locale: lang }),
      })
      if (res.status === 400) {
        // ⚠️ A 400 IS "THIS BODY IS WRONG", WHICH RETRYING CANNOT FIX — so it must never end at the
        // generic "try again". The route answers with Zod's issues; the first path names a field,
        // and the step partition says which question owns it. Send them there.
        // This is deliberately CAUSE-AGNOSTIC: two production reports of this 400 had two different
        // causes and both had to be guessed from a screenshot. Whatever the field is, the traveller
        // now lands on the question that can change it.
        const data = (await res.json().catch(() => null)) as { issues?: Array<{ path?: unknown[] }> } | null
        const owning = (data?.issues ?? [])
          .map((issue) => tripWizardStepForField(String(issue.path?.[0] ?? '')))
          .find((candidate): candidate is TripWizardStep => candidate !== null)
        if (owning) {
          setError('incomplete')
          const moved = await post({ action: 'goto', conversationId, step: owning, expectedStep: step }).catch(() => null)
          if (moved && typeof moved.step === 'number') setStep(moved.step)
          return
        }
        setError('generate_failed')
        return
      }
      if (!res.ok) {
        // 429 is the cost guard doing its job — say so plainly rather than "something went wrong".
        // 429 is the cost guard doing its job; 409 means a plan is ALREADY being built for this
        // account (another tab, or a submit that is still running). Neither is "something went
        // wrong", and telling a traveller to retry a 409 would be advice to wait, not to act.
        setError(res.status === 429 ? 'rate_limited' : res.status === 409 ? 'already_generating' : 'generate_failed')
        return
      }
      // ⚠️ THE FIELD IS `savedItineraryId`. I first read `itineraryId ?? id` from assumption; the
      // route returns neither, so the wizard would have GENERATED — spending a token on the most
      // expensive path in the app — and then told the traveller it had failed. Checked against the
      // route rather than guessed.
      const created = (await res.json()) as { savedItineraryId?: string | null }
      const id = created.savedItineraryId
      if (!id) {
        // Generation SUCCEEDED and the auto-save did not: the route logs and returns the plan
        // anyway. Saying "failed" here would be a lie that invites a retry costing another
        // generation, so the message says what actually happened.
        setError('not_saved')
        return
      }
      await post({ action: 'complete', conversationId, itineraryId: id })
      setItineraryId(id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      // LIVE, not settled: the plan is finished but this card is the freshest thing in the thread
      // and carries the action that opens it — the visa result card makes the same call.
      <ChatCard eyebrow={TRIP} icon={MapPinned} title={tr('Your trip plan is ready', 'Chuyến đi của bạn đã sẵn sàng')}>
        {/* ui/button is the documented asChild exception in this codebase — it bridges asChild to
            Base UI's render prop, so a link-button composes here and nowhere else. */}
        {itineraryId ? (
          <Button variant="cta" className="mt-3 w-full" asChild>
            <Link href={`/dashboard/trips/${itineraryId}`}>{tr('Open in My Trips', 'Mở trong Chuyến đi của tôi')}</Link>
          </Button>
        ) : null}
      </ChatCard>
    )
  }

  return (
    <ChatCard
      eyebrow={TRIP}
      // ⚠️ MapPinned, not Sparkles. Sparkles is the visa family's mark on all seven of its cards,
      // and now that the two shells are identical the icon is half of what says which family a card
      // belongs to — a trip card wearing the visa icon reads as a visa card at a glance.
      icon={MapPinned}
      title={tr('Plan your trip', 'Lên kế hoạch chuyến đi')}
      // The badge replaces a bespoke "Step 3/5" caption, and the rail is the signal the visa
      // wizard had and this one did not — both are five-step cards in the same thread.
      step={{ current: step, total: LAST_TRIP_WIZARD_STEP }}
    >
      {/* ⚠️ THE RAIL IS THE "GO BACK" CONTROL (owner 2026-07-27: "click and go to card"). Only steps
          already ANSWERED are reachable — jumping forward past a question nobody answered would
          submit an empty step, which the server rejects as invalid_answers anyway. Reviewing is
          purely local: nothing is posted until the traveller taps through with Next, so tapping
          back cannot desync the server's step. */}
      <ChatCardSteps
        current={view}
        total={LAST_TRIP_WIZARD_STEP}
        labels={STEP_LABELS.map((l) => tr(l.en, l.vi))}
        reachable={Array.from({ length: Math.max(step, view) }, (_, i) => i + 1)}
        onSelect={(n) => { setError(null); setEditingStep(n === step ? null : n) }}
      />

      {editingStep !== null && editingStep !== step ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-tint px-3 py-2">
          <p className="text-2xs text-ink-3">
            {tr('Reviewing an earlier answer — nothing is sent until you continue.',
                'Đang xem lại câu trả lời trước — chưa gửi gì cho đến khi bạn tiếp tục.')}
          </p>
          <Button variant="soft" size="none" className="relative tap-44 rounded-full px-3 py-1 text-2xs font-bold" onClick={() => setEditingStep(null)}>
            {tr('Back to step', 'Về bước hiện tại')} {step}
          </Button>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {view === 1 ? (
          <>
            <p className="text-sm text-ink-3">{tr('Where would you like to go?', 'Bạn muốn đi đâu?')}</p>
            <div className="flex flex-wrap gap-1.5">
              {CITIES.map((city) => {
                const on = draft.cityIds.includes(city.id)
                return (
                  <Button
                    key={city.id}
                    variant={on ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => patch({ cityIds: on ? draft.cityIds.filter((id) => id !== city.id) : [...draft.cityIds, city.id] })}
                  >
                    {lang === 'vi' ? city.nameVi : city.name}
                  </Button>
                )
              })}
            </div>
            <Field>
              <FieldLabel htmlFor="tw-days">{tr('How many days?', 'Bao nhiêu ngày?')}</FieldLabel>
              <FieldControl
                render={<Input id="tw-days" type="number" min={1} max={30} inputMode="numeric" value={draft.days} onChange={(e) => patch({ days: Number(e.target.value) })} />}
              />
            </Field>
          </>
        ) : view === 2 ? (
          <>
            <Field>
              <FieldLabel htmlFor="tw-start">{tr('When do you start?', 'Bạn khởi hành khi nào?')}</FieldLabel>
              <FieldControl render={<Input id="tw-start" type="date" value={draft.startDate} onChange={(e) => patch({ startDate: e.target.value })} />} />
            </Field>
            <Field>
              <FieldLabel htmlFor="tw-travelers">{tr('How many travellers?', 'Bao nhiêu người?')}</FieldLabel>
              <FieldControl render={<Input id="tw-travelers" type="number" min={1} max={100} inputMode="numeric" value={draft.travelers} onChange={(e) => patch({ travelers: Number(e.target.value) })} />} />
            </Field>
          </>
        ) : view === 3 ? (
          <>
            <p className="text-sm text-ink-3">{tr('Budget', 'Ngân sách')}</p>
            {/* ⚠️ THE PER-DAY RANGE IS SHOWN, NOT JUST THE TIER NAME (owner, 2026-07-26: "add price
                ranges for customers to have expense range idea"). "Smart / Comfort / Premium" tells
                a traveller nothing about what they are committing to, and this is the step where
                they decide it — the number is the whole point of the question.

                The figures are NOT written here: they come from BUDGETS.detail/detailVi in
                itinerary-data.ts, the same source the dashboard builder renders and the same tier
                whose `daily` value is sent to the generator. One place to change a price.

                Full-width ROWS rather than the chip row this replaced: three chips each carrying a
                second line do not fit a chat card (the shared shell caps at 28rem, so ~138px per
                chip against "Tối đa 1,2 triệu/ngày"), and shrinking the range to fit would defeat
                the purpose. Rows also match the builder's own budget control, so the two surfaces
                read the same. Pace stays a chip row — its options carry no number. */}
            {/* ⚠️ The custom amount is NOT in the draft — it lives in this component's own state and
                is composed into answersFor(3) at submit, so picking a tier only has to switch the
                mode off. Keeping it out of Draft also keeps it out of the PERSISTED half-finished
                draft, where a stale đồng figure could outlive the rate it was converted at. */}
            <div className="flex flex-col gap-1.5">
              {BUDGETS.map((budget) => {
                // Composed OUTSIDE the markup: design-lint refuses bare strings AND template
                // literals in JSX, and the dollar hint is only meaningful when a rate loaded.
                const usd = usdPerDay(budget.daily)
                const detail = (lang === 'vi' ? budget.detailVi : budget.detail)
                  + (usd ? ` · ≈ ${usd}/${tr('day', 'ngày')}` : '')
                return (
                  <Button
                    key={budget.id}
                    size="none"
                    variant={!customBudgetOn && draft.budgetId === budget.id ? 'default' : 'outline'}
                    onClick={() => { setCustomBudgetOn(false); patch({ budgetId: budget.id }) }}
                    className="w-full flex-col items-start gap-0 rounded-xl px-3 py-2 text-left"
                  >
                    <span className="text-sm font-bold">{lang === 'vi' ? budget.labelVi : budget.label}</span>
                    <span className="text-2xs font-medium opacity-80">{detail}</span>
                  </Button>
                )
              })}
              {/* ⚠️ THE CUSTOM BUDGET LIVES HERE, NOT IN THE DASHBOARD BUILDER (owner, 2026-07-29:
                  "there shouldnt be dashboard builder only in chat"). It was first built into
                  itinerary-builder.tsx, which had already been reduced to dead code behind a
                  redirect — a working feature nobody could reach. This is the only planner. */}
              <Button
                size="none"
                variant={customBudgetOn ? 'default' : 'outline'}
                onClick={() => setCustomBudgetOn(true)}
                className="w-full flex-col items-start gap-0 rounded-xl px-3 py-2 text-left"
              >
                <span className="text-sm font-bold">{tr('My own budget', 'Ngân sách của tôi')}</span>
                <span className="text-2xs font-medium opacity-80">{tr('Name a daily amount per traveler', 'Nhập số tiền mỗi ngày cho mỗi khách')}</span>
              </Button>
            </div>
            {/* Asked in USD, planned in đồng — the conversion is shown live so the number being
                committed to is never hidden behind a rate the traveller cannot see. Falls back to
                đồng when no usable rate has loaded; the field never simply disappears. */}
            {customBudgetOn && (
              <div>
                <Input
                  type="number"
                  inputMode="decimal"
                  variant="outline"
                  aria-label={usdRate
                    ? tr('Daily budget per traveler in US dollars', 'Ngân sách mỗi ngày mỗi khách, tính bằng đô la Mỹ')
                    : tr('Daily budget per traveler in dong', 'Ngân sách mỗi ngày mỗi khách, tính bằng đồng')}
                  min={usdRate ? Math.ceil(MIN_CUSTOM_DAILY_VND / usdRate) : MIN_CUSTOM_DAILY_VND}
                  max={usdRate ? Math.floor(MAX_CUSTOM_DAILY_VND / usdRate) : MAX_CUSTOM_DAILY_VND}
                  value={customBudgetText}
                  onChange={(e) => setCustomBudgetText(e.currentTarget.value)}
                  placeholder={usdRate ? '$120' : '3000000'}
                  aria-invalid={customBudgetInvalid || undefined}
                  className="w-full"
                />
                <p className={cn('mt-1 text-2xs', customBudgetInvalid ? 'text-destructive' : 'text-ink-4')} role={customBudgetInvalid ? 'alert' : undefined}>
                  {customBudgetInvalid
                    ? tr('Enter a realistic daily amount per traveler.', 'Nhập số tiền hợp lý mỗi khách, mỗi ngày.')
                    : customBudgetVnd
                      ? `≈ ${formatMoneyFull(customBudgetVnd, '₫', moneyLocale(lang))} / ${tr('traveler / day', 'khách / ngày')}`
                      : tr('Excludes long-haul flights, like the tiers above.', 'Chưa gồm vé bay đường dài, giống các mức ở trên.')}
                </p>
              </div>
            )}
            <p className="text-sm text-ink-3">{tr('Pace', 'Nhịp độ')}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(PACE_LABELS).map(([id, option]) => (
                <Button key={id} size="sm" variant={draft.pace === id ? 'default' : 'outline'} onClick={() => patch({ pace: id })}>
                  {lang === 'vi' ? option.labelVi : option.label}
                </Button>
              ))}
            </div>
          </>
        ) : view === 4 ? (
          <>
            <p className="text-sm text-ink-3">{tr('What do you enjoy?', 'Bạn thích điều gì?')}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(INTEREST_LABELS).map(([id, option]) => {
                const on = draft.interests.includes(id)
                return (
                  <Button key={id} size="sm" variant={on ? 'default' : 'outline'} onClick={() => patch({ interests: on ? draft.interests.filter((i) => i !== id) : [...draft.interests, id] })}>
                    {lang === 'vi' ? option.labelVi : option.label}
                  </Button>
                )
              })}
            </div>
            <p className="text-sm text-ink-3">{tr('Where would you like to stay?', 'Bạn muốn ở đâu?')}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ACCOMMODATION_LABELS).map(([id, option]) => (
                <Button key={id} size="sm" variant={draft.accommodation === id ? 'default' : 'outline'} onClick={() => patch({ accommodation: id })}>
                  {lang === 'vi' ? option.labelVi : option.label}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-3">{tr('Research flights too?', 'Tìm chuyến bay luôn?')}</span>
              <Switch checked={draft.flight.include} onChange={(on) => patch({ flight: { ...draft.flight, include: on } })} />
            </div>
            {draft.flight.include ? (
              <Field>
                <FieldLabel htmlFor="tw-origin">{tr('Flying from', 'Bay từ')}</FieldLabel>
                <FieldControl render={<Input id="tw-origin" maxLength={120} value={draft.origin} onChange={(e) => patch({ origin: e.target.value })} />} />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="tw-notes">{tr('Anything else we should know?', 'Bạn muốn nhắn thêm điều gì?')}</FieldLabel>
              <FieldControl render={<Textarea id="tw-notes" rows={2} maxLength={600} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />} />
            </Field>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error === 'rate_limited'
            ? tr('You have reached today’s planning limit. Try again later.', 'Bạn đã đạt giới hạn lập kế hoạch hôm nay. Hãy thử lại sau.')
            : error === 'already_generating'
              ? tr('A plan is already being built for you. Give it a moment.', 'Một lịch trình đang được tạo cho bạn. Vui lòng đợi một chút.')
              : error === 'invalid_answers'
              ? tr('Please check the answers on this step.', 'Vui lòng kiểm tra lại các câu trả lời ở bước này.')
              // ⚠️ NOT "try again" — retrying an empty draft can never work, which is exactly what
              // the old catch-all told people to do. The card has already moved them back to the
              // step that is missing, so the copy says what happened and what to do.
              : error === 'incomplete'
              ? tr('Some answers were not saved — the form has moved back to the first one we still need.', 'Một số câu trả lời chưa được lưu — biểu mẫu đã quay lại câu đầu tiên chúng tôi còn thiếu.')
              : error === 'not_saved'
                ? tr('We built your plan but could not save it. Ask the desk in this chat to try again.', 'Chúng tôi đã tạo kế hoạch nhưng chưa lưu được. Hãy nhắn cho bàn hỗ trợ trong cuộc trò chuyện này để thử lại.')
                : tr('That did not go through. Please try again.', 'Chưa gửi được. Vui lòng thử lại.')}
        </p>
      ) : null}

      {/* ⚠️ THE ACTION ALWAYS BELONGS TO THE SERVER'S STEP, never to the one being reviewed. Posting
          `next()` while the traveller is looking at step 2 would answer step 2 again and the server
          would refuse it as a step_mismatch — so from a review the button simply returns them to
          where the wizard actually is, with their edit already kept in the local draft. */}
      <Button
        variant="cta"
        className="mt-4 w-full"
        disabled={busy}
        onClick={() => {
          if (editingStep !== null && editingStep !== step) { setEditingStep(null); return }
          void (step === LAST_TRIP_WIZARD_STEP ? build() : next())
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {editingStep !== null && editingStep !== step
          ? tr('Keep this and continue', 'Giữ lại và tiếp tục')
          : step === LAST_TRIP_WIZARD_STEP ? tr('Build my plan', 'Tạo lịch trình') : tr('Next', 'Tiếp tục')}
      </Button>
    </ChatCard>
  )
}

/**
 * The wizard's ENTRY POINT — the chip a traveller taps to start planning in the thread.
 *
 * Without this the whole feature is unreachable: the card only renders once a card row exists, and
 * only `start` creates one. It renders nothing at all unless the server says this thread is a trip
 * desk thread with no wizard already running, so it never appears in an ordinary seller
 * conversation.
 */
type ItineraryDraft = { id: string; title: string; days: number; summary: string }

/**
 * "Choose from drafts" — the traveller's saved trips, reachable from the thread they plan in.
 *
 * ⚠️ IT NAVIGATES; IT DOES NOT AUTHOR A CARD. Picking a trip opens it at /dashboard/trips/<id>,
 * where the stop editing lives. It deliberately does NOT put a card back into the conversation:
 * cards are authored through ONE server chokepoint against the MESSAGE_KINDS whitelist, the wizard
 * route accepts only `start`, and a launcher that wrote its own card would become a second
 * authoring path — the exact thing the task forbids. Reopening a saved trip where it lives is the
 * honest reading of "reopen it"; if the owner wants the card back IN the thread, that needs a
 * server action (a `resume`), not a client-side write.
 *
 * ⚠️ FETCHES ON OPEN, not on mount. Every itinerary thread would otherwise spend a request on a
 * menu most travellers never open, and the list must be fresh — a trip saved or deleted in another
 * tab has to be reflected the moment the menu is opened, not as of page load.
 */
function TripDraftsChip() {
  const { tr } = useLanguage()
  const [state, setState] = useState<
    { phase: 'idle' | 'loading' | 'error' } | { phase: 'ready'; drafts: ItineraryDraft[]; used: number; limit: number }
  >({ phase: 'idle' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch('/api/trips/drafts', { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as
        | { drafts?: ItineraryDraft[]; used?: number; limit?: number }
        | null
      // A 503 still carries the degraded shape, but it means "we could not read your trips" — an
      // empty list would be a lie, so it is surfaced as an error instead.
      if (!res.ok || !data) { setState({ phase: 'error' }); return }
      setState({ phase: 'ready', drafts: data.drafts ?? [], used: data.used ?? 0, limit: data.limit ?? 0 })
    } catch {
      setState({ phase: 'error' })
    }
  }, [])

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) void load() }}>
      {/* ⚠️ Icon and label INSIDE the rendered Button — Base UI's `render` REPLACES the trigger, so
          sibling children are dropped and the menu never opens (visa-cards records shipping that). */}
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="soft"
            size="none"
            aria-label={tr('Open one of your saved trips', 'Mở một chuyến đi đã lưu')}
            /* ⚠️ `relative` IS LOAD-BEARING — see the note above VisaAssistChips. `tap-44` grows an
               absolutely-positioned ::before sized to the nearest POSITIONED ancestor, and inside a
               thread `html.chat-locked` makes <body> position:relative, so without this the hit
               target covers the whole viewport and swallows every tap and swipe. */
            className="relative tap-44 shrink-0 gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-2xs font-bold text-foreground active:scale-100"
          >
            <FolderOpen className="size-3.5 shrink-0" aria-hidden />
            {tr('Saved trips', 'Chuyến đi đã lưu')}
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
          </Button>
        }
      />
      {/* Upward: the row sits directly above the composer. */}
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="max-w-[17rem]">
        {state.phase === 'loading' && (
          <DropdownMenuItem disabled>
            <Loader2 className="animate-spin" /> {tr('Loading…', 'Đang tải…')}
          </DropdownMenuItem>
        )}
        {state.phase === 'error' && (
          <DropdownMenuItem disabled>{tr("Couldn't load your trips.", 'Chưa tải được chuyến đi của bạn.')}</DropdownMenuItem>
        )}
        {state.phase === 'ready' && state.drafts.length === 0 && (
          <DropdownMenuItem disabled>{tr('No saved trips yet.', 'Chưa có chuyến đi nào được lưu.')}</DropdownMenuItem>
        )}
        {/* ⚠️ DropdownMenuLabel throws "MenuGroupContext is missing" outside a Group, and the throw
            happens on popup mount — the menu would simply never open. Keep the label in the group. */}
        {state.phase === 'ready' && state.drafts.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {tr('{used} of {limit} saved', 'Đã lưu {used}/{limit}')
                .replace('{used}', String(state.used))
                .replace('{limit}', String(state.limit))}
            </DropdownMenuLabel>
            {state.drafts.map((d) => (
              // `render` with a Link keeps client-side navigation; the whole row is the target.
              <DropdownMenuItem key={d.id} render={<Link href={`/dashboard/trips/${d.id}`} />}>
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The trip thread's help control — the twin of VisaAssistChips in messages/[id]/page.tsx, and
 * deliberately the same shape: ONE chip whose menu opens upward to arm Eno concierge or ask for a
 * person, rather than two chips eating a phone's vertical space (owner, 2026-07-24: "eno concierge
 * and request a person similar, tap once, choose ai or human").
 *
 * ⚠️ `relative` ON THE TRIGGER IS LOAD-BEARING — see the note on TripDraftsChip. `tap-44` grows an
 * absolutely-positioned ::before sized to the nearest POSITIONED ancestor, and inside a thread
 * `html.chat-locked` makes <body> position:relative, so without it the hit target covers the whole
 * viewport and swallows every tap and swipe in the message list.
 *
 * ⚠️ THE CHIP NEVER HIDES ITSELF. Not when a person has already been asked for, not when there is
 * no trip yet. `humanRequested` changes what it OFFERS (the concierge item goes away, because the
 * bot must not answer over a human) and never whether it exists — the rule the trip launcher had
 * to learn the hard way when it hid behind a live wizard card that was scrolled off screen.
 */
export function TripAssistChips({
  armed, thinking, busy, humanRequested, onToggleConcierge, onAskHuman,
}: {
  armed: boolean
  thinking: boolean
  busy: boolean
  /** A person has already been asked for on this thread — derived from the rendered timeline. */
  humanRequested: boolean
  onToggleConcierge: () => void
  /** Ask for a person, or switch the assistant back on — the caller passes the direction. */
  onAskHuman: (mode?: 'human' | 'ai') => void | Promise<void>
}) {
  const { tr } = useLanguage()
  return (
    <DropdownMenu>
      {/* ⚠️ Icon and label INSIDE the rendered Button — Base UI's `render` REPLACES the trigger, so
          sibling children are dropped and the menu never opens. */}
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="soft"
            size="none"
            aria-label={tr('Get help with this trip', 'Nhận trợ giúp cho chuyến đi này')}
            className={`relative tap-44 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-bold ${armed ? 'border-brand bg-primary/10 text-accent-foreground' : 'border-line-strong text-foreground'}`}
          >
            {thinking
              ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              : <Sparkles className="size-3.5 shrink-0" aria-hidden />}
            {armed ? tr('Eno concierge', 'Eno concierge') : tr('Get help', 'Trợ giúp')}
            <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
          </Button>
        }
      />
      {/* Upward: the row sits directly above the composer. */}
      {/* ⚠️ BOTH OPTIONS, ALWAYS, EACH WITH ITS OWN COLOUR (owner, 2026-07-30: "when click person ai
          response disappears … a dropdown toggle person one background color ai another background
          color with disclaimer"). The concierge item used to VANISH once a person was asked for, so
          the control silently changed shape and there was no way back — see the note on the route.
          Now it is a two-state toggle: the live side is tinted and ticked, the other stays tappable. */}
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="min-w-60">
        {/* "name is Eno concierge" (owner) — the same string in both languages, not translated. */}
        <DropdownMenuItem
          disabled={thinking}
          // In human mode this item's job is to SWITCH BACK (a server round trip), not to arm the
          // composer — arming a bot the server would refuse is the disappearing-chip bug wearing a
          // different hat.
          onClick={() => (humanRequested ? void onAskHuman('ai') : onToggleConcierge())}
          className={cn('rounded-lg', !humanRequested && 'bg-primary/10 text-accent-foreground')}
        >
          <Sparkles /> {tr('Eno concierge', 'Eno concierge')}
          {!humanRequested && <Check className="ml-auto size-4" aria-label={tr('on', 'đang bật')} />}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          onClick={() => void onAskHuman()}
          className={cn('rounded-lg', humanRequested && 'bg-warning/15 text-warning')}
        >
          <UserRound /> {tr('A person', 'Nhân viên')}
          {humanRequested && <Check className="ml-auto size-4" aria-label={tr('on', 'đang bật')} />}
        </DropdownMenuItem>
        {/* The disclaimer, and it changes with the state — a fixed line would be wrong in one of
            the two modes. Small and muted: it explains, it does not shout. */}
        <p className="mt-1 max-w-60 border-t border-border px-2 pb-1 pt-2 text-2xs leading-relaxed text-ink-4">
          {humanRequested
            ? tr('A person is answering. Eno concierge stays quiet so it never replies over them — tap it to switch back.',
                 'Nhân viên đang trả lời. Eno concierge tạm im để không trả lời chồng lên — chạm để chuyển lại.')
            : tr('Eno concierge is an AI and can be wrong. Ask for a person any time.',
                 'Eno concierge là AI và có thể sai. Bạn có thể yêu cầu nhân viên bất cứ lúc nào.')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TripWizardLauncher({
  conversationId, liveWizardMessageId, autoStart, onStarted, onReveal,
}: {
  conversationId: string
  /** The live wizard card's message id, derived by the page from the SAME list it renders. */
  liveWizardMessageId: string | null
  /** Arrived from a "Plan my trip" CTA: open the wizard without a second tap. One-shot. */
  autoStart?: boolean
  onStarted: () => void
  /** Bring a card into view. The page owns the scroll container, so it owns the scrolling. */
  onReveal: (messageId: string) => void
}) {
  const { tr } = useLanguage()
  /**
   * ONE FACT FROM THE SERVER: is this the trip desk's thread, and am I the traveller on it? That is
   * `threadHostsWizard`, which since T334 IS `threadKind(convo) === 'itinerary'`. Nothing else tells
   * the client a thread belongs to the trip desk, so this fetch cannot be dropped.
   *
   * ⚠️ WHETHER A WIZARD IS RUNNING IS NOT ASKED FOR ANY MORE, and that is the fix for the bug the
   * owner reported on 2026-07-28 ("when i click plan my trip it just sends message instead of giving
   * me the form"). This used to hold a second, independently-fetched `step`, and hid the chip
   * entirely while `step !== null`. Measured on production: the traveller's trip thread carried an
   * ACTIVE step-1 card from 09:01Z, so the chip was hidden — and because a wizard card is updated in
   * place it stayed pinned as the FIRST item in a thirteen-message thread, scrolled far above the
   * fold. The wizard was live and unreachable, and the only visible way to "plan a trip" was the
   * product page's CTA, which just posted another line of chat. Ten identical messages later, the
   * form had still never appeared.
   *
   * So the live card now comes from the page, which derives it from the very array it renders. The
   * chip and the card cannot disagree about whether a wizard exists, and the second fetch that could
   * go stale (it ran once on mount and was never refreshed) is gone.
   */
  const [isTripThread, setIsTripThread] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * WHICH thread was auto-started, not WHETHER one was.
   *
   * ⚠️ A BARE BOOLEAN LEAKS ACROSS THREADS IN BOTH DIRECTIONS, which is why this holds an id. The
   * messages route does not remount when the traveller walks from one conversation to another — the
   * same component just receives a new `conversationId` — so a `true` here would refuse to open the
   * planner on the SECOND thread arrived at with ?plan=1, and the equivalent slip on the page's side
   * would open one on a thread that never asked. Keying on the id makes both impossible.
   */
  const startedFor = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Reset first: eligibility belongs to a conversation, and holding the previous thread's answer
    // while this one is in flight would flash a trip chip onto somebody else's listing chat.
    setIsTripThread(false)
    void (async () => {
      try {
        const res = await fetch(`/api/trips/wizard?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { eligible: boolean }
        if (!cancelled) setIsTripThread(data.eligible)
      } catch {
        // A thread that cannot answer simply shows no chip.
      }
    })()
    return () => { cancelled = true }
  }, [conversationId])

  /**
   * Ensure a wizard exists, then show it.
   *
   * ⚠️ ONE HANDLER FOR BOTH CHIPS, because `start` is idempotent — it returns the RUNNING card
   * rather than inserting a second one. That is what makes this correct even when the page has
   * painted from its localStorage cache and does not yet know a card exists: the chip says "Plan a
   * trip", the server answers with the card already there, and we scroll to it. A client that
   * guessed wrong gets the right outcome instead of a duplicate.
   */
  const open = async () => {
    if (busy) return
    if (liveWizardMessageId) { onReveal(liveWizardMessageId); return }
    setBusy(true)
    try {
      const res = await fetch('/api/trips/wizard', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', conversationId }),
      })
      if (!res.ok) return
      const data = (await res.json().catch(() => null)) as { messageId?: string } | null
      onStarted()
      if (data?.messageId) onReveal(data.messageId)
    } finally {
      setBusy(false)
    }
  }

  /**
   * The "Plan my trip" CTA promised a form, so opening the thread must produce one — a traveller who
   * has just tapped it should not have to find and tap a chip as well.
   *
   * One-shot per mount, and it only fires once eligibility has come back, so it can never post a
   * desk card into a thread the wizard does not belong to. Re-entering the URL is harmless for the
   * same reason `open` is: `start` resumes rather than restarting.
   */
  useEffect(() => {
    if (!autoStart || !isTripThread || startedFor.current === conversationId) return
    startedFor.current = conversationId
    void open()
    // Deps are the three facts that decide WHETHER to fire; `startedFor` is what makes it once per
    // thread. `open` is deliberately absent — it is recreated every render, and depending on it
    // would re-run this whenever anything else in the thread re-renders.
  }, [autoStart, isTripThread, conversationId])

  // Not this thread's business at all → render nothing, so `empty:hidden` collapses the shared row.
  const chip = tripWizardChip({ eligible: isTripThread, liveWizardMessageId })
  if (chip === 'none') return null

  // ⚠️ A FRAGMENT, NOT A WRAPPER. The caller owns ONE flex row above the composer (owner: "put them
  // in 1 line"), so these must be direct items of it; a wrapping <div> would make the pair a single
  // item and reintroduce the stacked-rows layout that rule exists to prevent.
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void open()}
        /* `relative` for the same tap-44 reason as the drafts chip — see the note there. */
        className="relative"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        {/* The label is the honest one for each case: a half-answered wizard is not a new trip, and
            calling it "Plan a trip" is what made a returning traveller think nothing had happened. */}
        {chip === 'resume'
          ? tr('Continue planning', 'Tiếp tục lên kế hoạch')
          : tr('Plan a trip', 'Lên kế hoạch chuyến đi')}
      </Button>
      <TripDraftsChip />
    </>
  )
}
