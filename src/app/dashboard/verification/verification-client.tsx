'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { SectionHeader } from '@/components/marketplace/section-header'
import { BusinessVerificationPanel } from '@/components/marketplace/business-verification-panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Check, ShieldCheck, IdCard } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

/**
 * BOTH VERIFICATIONS, IN ORDER, ON ONE SCREEN.
 *
 * Owner, 2026-08-31: "person verifies himself then can verify business so 2 verification process to
 * open fully compliant business storefront." Until now the two halves lived nowhere a seller could
 * find them: stage 1 was an unlinked page that did nothing, and stage 2 was a panel buried inside
 * Settings. Neither appeared in the dashboard nav.
 *
 * ⛔ MOBILE FIRST, AND THAT IS A LAYOUT DECISION NOT A BREAKPOINT DECISION. The base styles ARE the
 * phone: one column, full-width tap targets, the step rail stacked. `sm:`/`lg:` only ever ADD — a
 * second column and the desktop heading. Writing it the other way round (desktop base, then
 * `max-lg:` overrides) is how a phone ends up rendering a shrunken desktop; it also means the
 * smallest screen pays for CSS it then has to undo.
 *
 * ⚠️ THE STATUS IS READ, NEVER ASSUMED. Both cards render from the server's answer, so a seller
 * whose document expired sees step 1 reopen rather than a stale tick.
 */

type Status = 'unverified' | 'pending' | 'verified' | 'rejected' | 'expired' | 'revoked'

export function VerificationClient() {
  const { tr } = useLanguage()
  const [person, setPerson] = useState<Status | null>(null)
  const [gate, setGate] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/seller/identity/status', { cache: 'no-store' })
      if (r.ok) {
        const b = (await r.json()) as { status?: Status; gate?: boolean }
        setPerson(b.status ?? 'unverified')
        setGate(b.gate === true)
      }
    } catch {
      /**
       * ⚠️ SWALLOWED, AND THE PAGE STILL RENDERS. A failed status read must not blank the screen:
       * stage 2's panel does its own loading and is perfectly usable, and `person` stays null, which
       * renders as "not verified yet" — the safe direction. Claiming verified on a failed read is
       * the one answer that would be actively wrong.
       */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const personDone = person === 'verified'
  const personPending = person === 'pending'

  return (
    <>
      {/* Mobile-only pushed-screen title bar; the nav rail carries this on desktop. */}
      <SectionHeader title={tr('Verification', 'Xác minh')} />

      {/* ⚠️ THE DESKTOP HEADING IS `hidden lg:block`, NOT THE OTHER WAY AROUND — SectionHeader
          already renders the title on small screens, and showing both would put the same words on
          the page twice, which is also two <h1>s for a screen reader. */}
      <div className="mx-auto max-w-2xl">
        <div className="hidden lg:block">
          <h1 className="h-title text-foreground">{tr('Verification', 'Xác minh')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground lg:mt-1">
          {tr(
            'Two steps. You verify yourself, then your business — a named person has to stand behind a business storefront.',
            'Hai bước. Bạn xác minh bản thân, sau đó xác minh doanh nghiệp — một cá nhân có danh tính phải đứng sau gian hàng doanh nghiệp.',
          )}
        </p>

        {/* ── STEP 1 ──────────────────────────────────────────────────────────────────── */}
        <section className="mt-5">
          {!loaded ? (
            <div role="status" aria-label={tr('Loading…', 'Đang tải…')} className="rounded-2xl border border-border p-4">
              <Skeleton className="h-5 w-40 rounded-lg" />
              <Skeleton className="mt-2 h-4 w-full rounded-lg" />
              <Skeleton className="mt-1 h-4 w-2/3 rounded-lg" />
            </div>
          ) : (
            <div className={cn(
              'rounded-2xl border p-4',
              personDone ? 'border-success/40 bg-success/5' : 'border-border bg-card',
            )}>
              {/* ⚠️ `flex-col sm:flex-row` — ON A PHONE THE BADGE AND THE TEXT STACK. Side by side
                  in 360px the copy wraps to four words a line and the CTA is squeezed off. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <span className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full',
                  personDone ? 'bg-success text-success-foreground' : 'bg-tint text-foreground',
                )}>
                  {personDone ? <Check className="size-4" aria-hidden="true" /> : <IdCard className="size-4" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-foreground">
                    {tr('Step 1 — verify yourself', 'Bước 1 — xác minh bản thân')}
                  </h2>
                  <p className="mt-1 text-sm text-body">
                    {personDone
                      ? tr('Done. Your identity is verified.', 'Hoàn tất. Danh tính của bạn đã được xác minh.')
                      : personPending
                        ? tr('Sent. A person is reviewing it — usually within a working day.', 'Đã gửi. Nhân viên đang xét duyệt — thường trong một ngày làm việc.')
                        : person === 'rejected'
                          ? tr('That did not pass. You can try again with a clearer photograph.', 'Chưa đạt. Bạn có thể thử lại với ảnh rõ hơn.')
                          : person === 'expired'
                            ? tr('Your document has expired. Please verify again.', 'Giấy tờ của bạn đã hết hạn. Vui lòng xác minh lại.')
                            : tr(
                                'A photograph of your ID or passport, and a selfie holding a code we give you. Takes a few minutes, once.',
                                'Một ảnh giấy tờ tuỳ thân hoặc hộ chiếu, và một ảnh chân dung cầm mã do chúng tôi cấp. Mất vài phút, chỉ một lần.',
                              )}
                  </p>
                  {/* ⚠️ `w-full sm:w-auto` — a full-width primary action is the phone convention and
                      the reason the CTA is reachable with a thumb; it shrinks to its label on
                      wider screens where a full-width button reads as a banner. */}
                  {!personDone && !personPending && (
                    <Button variant="cta" asChild className="mt-3 w-full sm:w-auto">
                      <a href="/dashboard/account/verify">
                        {person === 'rejected' || person === 'expired'
                          ? tr('Try again', 'Thử lại')
                          : tr('Verify yourself', 'Xác minh bản thân')}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── STEP 2 ──────────────────────────────────────────────────────────────────── */}
        <section className="mt-4">
          <div className={cn(
            'rounded-2xl border border-border bg-card p-4',
            // ⚠️ DIMMED, NEVER REMOVED, WHEN STEP 1 IS OUTSTANDING. Hiding step 2 until step 1 is
            // done would leave a seller looking at a one-step page with no idea what comes next;
            // showing it greyed makes the sequence legible, which is the whole point of the screen.
            gate && !personDone && 'opacity-60',
          )}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint text-foreground">
                <ShieldCheck className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-foreground">
                  {tr('Step 2 — verify your business', 'Bước 2 — xác minh doanh nghiệp')}
                </h2>
                <p className="mt-1 text-sm text-body">
                  {gate && !personDone
                    ? tr('Available once step 1 is done.', 'Khả dụng sau khi hoàn tất bước 1.')
                    : tr(
                        'Your tax code, business licence and a bank document showing the account-holder name.',
                        'Mã số thuế, giấy phép kinh doanh và giấy tờ ngân hàng có tên chủ tài khoản.',
                      )}
                </p>
              </div>
            </div>

            {/**
              * ⚠️ THE SAME PANEL SETTINGS MOUNTS, NOT A COPY OF IT. It owns the uploads, the consent
              * box, the submit and every refusal message; re-implementing that here would be two
              * screens drifting apart on the one flow where a stale copy means a seller submits into
              * a rule that no longer exists.
              * ⚠️ AND IT IS RENDERED EVEN WHEN STEP 1 IS OUTSTANDING. The panel draws its own locked
              * step-1 notice from the server's `personGate`/`personVerified`, so hiding it here would
              * suppress the explanation rather than the action — and the real refusal lives in
              * `submitVerification`, not in whether this is on screen.
              */}
            {/* ⚠️ `showPersonSteps={false}` — THIS hub already renders the step 1/step 2 rail above;
                letting the panel draw its own too would double the sequence. */}
            <BusinessVerificationPanel showPersonSteps={false} />
          </div>
        </section>
      </div>
    </>
  )
}
