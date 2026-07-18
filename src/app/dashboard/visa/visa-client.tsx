'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, CloudOff, FileCheck2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { SectionHeader } from '@/components/marketplace/section-header'
import { FORUM_URL, goToForum } from '@/lib/forum-nav'
import type { ForumVisaResult } from '@/lib/forum-visa'

// Status → badge tone. Keys are the statuses the forum route actually writes
// (draft/ready_to_submit/ready_for_review/processing/submitted/approved/rejected/
// cancelled); anything unrecognized falls back to a neutral chip showing the raw
// word, so a NEW forum status degrades to ugly-but-honest instead of crashing.
// Exported: the /dashboard home's "Visa applications" card reuses the exact same
// mapping so a status never reads differently on the home vs. this section.
export const STATUS: Record<string, { en: string; vi: string; variant: 'neutral' | 'brand' | 'success' | 'warning' | 'destructive' }> = {
  draft: { en: 'Draft', vi: 'Bản nháp', variant: 'neutral' },
  ready_to_submit: { en: 'Ready to submit', vi: 'Sẵn sàng nộp', variant: 'brand' },
  ready_for_review: { en: 'In review', vi: 'Đang kiểm tra hồ sơ', variant: 'warning' },
  processing: { en: 'Processing', vi: 'Đang xử lý', variant: 'warning' },
  submitted: { en: 'Submitted', vi: 'Đã nộp', variant: 'brand' },
  approved: { en: 'Approved', vi: 'Đã duyệt', variant: 'success' },
  rejected: { en: 'Rejected', vi: 'Bị từ chối', variant: 'destructive' },
  cancelled: { en: 'Cancelled', vi: 'Đã hủy', variant: 'neutral' },
}

/** /dashboard/visa — the user's Vietnam e-Visa applications, rendered in <main> like every
 *  other dashboard section. Data arrives pre-fetched from the server page (forum proxy);
 *  this component only gates auth and renders. Editing/continuing an application happens
 *  on eno.forum, so every row and CTA crosses sites via the goToForum SSO handoff. */
export function VisaClient({ initial }: { initial: ForumVisaResult }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // Server-rendered (or previously fetched) data belongs to the account that loaded it.
  // A cross-tab sign-in can swap the session to ANOTHER user while this page sits open
  // (Supabase broadcasts auth changes across tabs). Refresh inside a transition and
  // HIDE the stale payload for its duration — account A's data must never render
  // under account B, not even while the refresh is in flight.
  const [switching, startSwitch] = useTransition()
  const lastUid = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (user?.id && lastUid.current && user.id !== lastUid.current) startSwitch(() => router.refresh())
    if (user?.id) lastUid.current = user.id
  }, [user?.id, router])


  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/visa')
  }, [loading, user, router])

  if (loading || switching || !user) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  // Real anchor (a11y / middle- and cmd-click keep the plain URL); left-click rides
  // the native SSO bridge — the account-panel cross-site idiom.
  const openAssistant = (
    <Button variant="cta" asChild>
      <a
        href={`${FORUM_URL}/visa`}
        onClick={(e) => {
          if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          goToForum('/visa')
        }}
      >
        {tr('Open e-Visa assistant', 'Mở trợ lý e-Visa')}
      </a>
    </Button>
  )

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('Vietnam e-Visa', 'E-Visa Việt Nam')} />
      {/* h1 stays for the outline; the SectionHeader carries the visible mobile title. */}
      <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('Vietnam e-Visa', 'E-Visa Việt Nam')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {tr('Your e-Visa applications from the eno.forum assistant.', 'Hồ sơ e-Visa của bạn từ trợ lý trên eno.forum.')}
      </p>
      <div className="mt-6">
        {initial.state !== 'ok' ? (
          // Covers 'unavailable' AND the server-saw-no-session edge (client authed while the
          // server cookie was stale): both are honest "can't show your applications right now".
          <EmptyState
            icon={CloudOff}
            title={tr("Can't reach the e-Visa assistant right now", 'Hiện chưa kết nối được trợ lý e-Visa')}
            subtitle={tr(
              'Your applications are safe on eno.forum — open the assistant to view them.',
              'Hồ sơ của bạn vẫn an toàn trên eno.forum — mở trợ lý để xem.',
            )}
            action={openAssistant}
          />
        ) : initial.applications.length === 0 ? (
          <EmptyState
            icon={FileCheck2}
            title={tr('No visa applications yet', 'Chưa có hồ sơ visa nào')}
            subtitle={tr(
              'The step-by-step assistant on eno.forum prepares your Vietnam e-Visa application and checks your documents.',
              'Trợ lý từng bước trên eno.forum giúp bạn chuẩn bị hồ sơ e-Visa Việt Nam và kiểm tra giấy tờ.',
            )}
            action={
              <Button variant="cta" asChild>
                <a
                  href={`${FORUM_URL}/visa`}
                  onClick={(e) => {
                    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                    e.preventDefault()
                    goToForum('/visa')
                  }}
                >
                  {tr('Start an application', 'Bắt đầu hồ sơ')}
                </a>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="space-y-2.5">
              {initial.applications.map((a) => {
                const s = STATUS[a.status]
                return (
                  <li key={a.id}>
                    {/* Real href for a11y / middle-click / cmd-click; a plain left-click routes
                        through goToForum so natives get the SSO handoff (account-panel idiom). */}
                    <a
                      href={`${FORUM_URL}/visa`}
                      onClick={(e) => {
                        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                        e.preventDefault()
                        void goToForum('/visa')
                      }}
                      // press = the native-row tactile treatment (its base transition keeps
                      // hover:bg-muted animating); the row is already one full-row anchor.
                      className="press flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted"
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-tint">
                        <FileCheck2 className="h-5 w-5 text-ink-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={s?.variant ?? 'neutral'}>{s ? tr(s.en, s.vi) : a.status}</Badge>
                          {a.submittedAt && (
                            <span className="text-xs text-ink-4">
                              {tr('Submitted', 'Đã nộp')} {new Date(a.submittedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold text-foreground">
                          {tr('Vietnam e-Visa application', 'Hồ sơ e-Visa Việt Nam')}
                        </p>
                        <p className="text-xs text-ink-4">
                          {a.updatedAt ? `${tr('Updated', 'Cập nhật')} ${new Date(a.updatedAt).toLocaleDateString()} · ` : ''}{a.documentCount}{' '}
                          {tr('documents', 'tài liệu')}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
                    </a>
                  </li>
                )
              })}
            </ul>
            <div className="mt-6 flex justify-center">{openAssistant}</div>
          </>
        )}
      </div>
    </>
  )
}
