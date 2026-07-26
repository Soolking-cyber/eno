'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarCheck, Check, Loader2, MapPinned, Sparkles, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Field, FieldControl, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import {
  ACCOMMODATION_LABELS, BUDGETS, CITIES, INTEREST_LABELS, PACE_LABELS,
} from '@/lib/itinerary-data'
import { LAST_TRIP_WIZARD_STEP } from '@/lib/trips/itinerary-wizard'
import { ChatCard, ChatCardSteps } from '@/components/marketplace/chat-card-shell'

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

const EMPTY_DRAFT: Draft = {
  cityIds: [], days: 7, startDate: '', travelers: 2,
  budgetId: 'comfort', pace: 'balanced', accommodation: 'hotel', interests: [],
  flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false },
  origin: '', notes: '',
}

export function TripWizardCard({ conversationId, meta }: { conversationId: string; meta: WizardStepMeta }) {
  const { tr, lang } = useLanguage()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [step, setStep] = useState(meta.step)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [itineraryId, setItineraryId] = useState<string | null>(meta.itineraryId ?? null)
  const done = meta.state === 'done' || Boolean(itineraryId)

  // The server owns the step. If the row moved (another tab, a resume), follow it rather than
  // keeping a local number that would let the traveller answer a question nobody asked.
  useEffect(() => { setStep(meta.step) }, [meta.step])

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))

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
      case 3: return { budgetId: draft.budgetId, pace: draft.pace }
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
      // Record the last step's answers first, so a generate failure does not lose them silently.
      await post({ action: 'advance', conversationId, step: LAST_TRIP_WIZARD_STEP, answers: answersFor(5) })
      // ⚠️ THE SAME ENDPOINT THE DASHBOARD BUILDER USES. One entrance, one set of cost guards.
      const res = await fetch('/api/itineraries/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...answersFor(1), ...answersFor(2), ...answersFor(3), ...answersFor(4), ...answersFor(5), locale: lang }),
      })
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
      <ChatCard eyebrow={TRIP} icon={MapPinned} title={tr('Your trip plan is ready', 'Lịch trình của bạn đã sẵn sàng')}>
        {/* ui/button is the documented asChild exception in this codebase — it bridges asChild to
            Base UI's render prop, so a link-button composes here and nowhere else. */}
        {itineraryId ? (
          <Button variant="cta" className="mt-3 w-full" asChild>
            <Link href={`/dashboard/trips/${itineraryId}`}>{tr('Open the plan', 'Mở lịch trình')}</Link>
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
      <ChatCardSteps current={step} total={LAST_TRIP_WIZARD_STEP} />

      <div className="mt-3 space-y-3">
        {step === 1 ? (
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
        ) : step === 2 ? (
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
        ) : step === 3 ? (
          <>
            <p className="text-sm text-ink-3">{tr('Budget', 'Ngân sách')}</p>
            <div className="flex flex-wrap gap-1.5">
              {BUDGETS.map((budget) => (
                <Button key={budget.id} size="sm" variant={draft.budgetId === budget.id ? 'default' : 'outline'} onClick={() => patch({ budgetId: budget.id })}>
                  {lang === 'vi' ? budget.labelVi : budget.label}
                </Button>
              ))}
            </div>
            <p className="text-sm text-ink-3">{tr('Pace', 'Nhịp độ')}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(PACE_LABELS).map(([id, option]) => (
                <Button key={id} size="sm" variant={draft.pace === id ? 'default' : 'outline'} onClick={() => patch({ pace: id })}>
                  {lang === 'vi' ? option.labelVi : option.label}
                </Button>
              ))}
            </div>
          </>
        ) : step === 4 ? (
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
              : error === 'not_saved'
                ? tr('We built your plan but could not save it. Open the trip planner to try again.', 'Chúng tôi đã tạo lịch trình nhưng chưa lưu được. Hãy mở trình lập kế hoạch để thử lại.')
                : tr('That did not go through. Please try again.', 'Chưa gửi được. Vui lòng thử lại.')}
        </p>
      ) : null}

      <Button variant="cta" className="mt-4 w-full" disabled={busy} onClick={() => void (step === LAST_TRIP_WIZARD_STEP ? build() : next())}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {step === LAST_TRIP_WIZARD_STEP ? tr('Build my plan', 'Tạo lịch trình') : tr('Next', 'Tiếp tục')}
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
export function TripWizardLauncher({ conversationId, onStarted }: { conversationId: string; onStarted: () => void }) {
  const { tr } = useLanguage()
  const [eligible, setEligible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/trips/wizard?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { eligible: boolean; step: number | null }
        // Offer the chip only when there is nothing to resume — a running wizard renders its own
        // card, and two entry points to one flow is how a traveller ends up restarting it.
        if (!cancelled) setEligible(data.eligible && data.step === null)
      } catch {
        // A thread that cannot answer simply shows no chip.
      }
    })()
    return () => { cancelled = true }
  }, [conversationId])

  if (!eligible) return null

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/trips/wizard', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', conversationId }),
      })
      if (res.ok) { setEligible(false); onStarted() }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void start()}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
      {tr('Plan a trip', 'Lên kế hoạch chuyến đi')}
    </Button>
  )
}
