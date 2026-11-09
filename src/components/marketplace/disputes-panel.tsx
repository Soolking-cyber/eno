'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Scale, ChevronRight } from '@/components/ui/icons'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { deviceOrIntlLocale } from '@/lib/i18n/langs'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Mascot } from '@/components/marketplace/mascot'
import { Skeleton } from '@/components/ui/skeleton'
import { Rows, Row } from '@/components/ui/rows'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import { SITE_NAME } from '@/lib/edition'

// My dispute cases — both roles: cases I filed and cases about me/my storefront.
// A case room lives at /disputes/[id]. Shared by the standalone /disputes page and
// the dashboard "Disputes" tab (compact hides the big title the tab already provides).

export type DisputeCaseRow = {
  id: string
  role: 'reporter' | 'respondent'
  reason: string
  status: string
  stage: 'evidence' | 'review' | 'decided'
  withdrawn: boolean
  createdAt: string
  evidenceUntil: string | null
  lastActivityAt: string
  messageCount: number
  listing: { id: string; title: string; image: string | null } | null
}

const REASON_LABELS: Record<string, [string, string]> = {
  scam: ['Scam', 'Lừa đảo'],
  counterfeit: ['Counterfeit', 'Hàng giả / nhái'],
  sold: ['Already sold', 'Đã bán / hết hàng'],
  'wrong-info': ['Wrong info', 'Thông tin sai'],
  duplicate: ['Duplicate', 'Tin trùng lặp'],
  offensive: ['Offensive / harassment', 'Phản cảm / quấy rối'],
  other: ['Other', 'Khác'],
}

function timeLeft(iso: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

/** `underSectionHeader`: the dashboard's phone title bar already shows the title, so the h1 is sr-only below lg (DashboardTabs' rule). */
export function DisputesPanel({ compact = false, underSectionHeader = false }: { compact?: boolean; underSectionHeader?: boolean }) {
  const { user, loading } = useAuth()
  const { tr, lang } = useLanguage()
  const t = (en: string, vi: string) => tr(en, vi)

  const [cases, setCases] = useState<DisputeCaseRow[] | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true
    fetch('/api/disputes')
      .then((r) => r.json())
      .then((d) => { if (alive && Array.isArray(d.cases)) setCases(d.cases) })
      .catch(() => { if (alive) setCases([]) })
    return () => { alive = false }
  }, [user])

  const stageChip = (c: DisputeCaseRow) => {
    if (c.stage === 'evidence') {
      const left = timeLeft(c.evidenceUntil)
      return <Badge variant="neutral" className="text-accent-foreground">{t('Evidence', 'Bằng chứng')}{left ? ` · ${left}` : ''}</Badge>
    }
    if (c.stage === 'review') return <Badge variant="neutral" className="text-warning">{t('Under review', 'Đang xem xét')}</Badge>
    if (c.withdrawn) return <Badge variant="neutral" className="text-ink-4">{t('Withdrawn', 'Đã rút lại')}</Badge>
    if (c.status === 'confirmed') return <Badge variant="neutral" className="text-success">{t('Resolved — upheld', 'Đã xử lý — xác nhận')}</Badge>
    if (c.status === 'abusive') return <Badge variant="neutral" className="text-destructive">{t('Closed — inaccurate report', 'Đã đóng — báo cáo sai')}</Badge>
    return <Badge variant="neutral" className="text-ink-4">{t('Closed — no violation', 'Đã đóng — không vi phạm')}</Badge>
  }

  const disputesLede = t('Reports you filed and cases about you. Both sides can add evidence; the {site} team decides.', 'Báo cáo bạn đã gửi và hồ sơ liên quan đến bạn. Hai bên đều có thể nộp bằng chứng; đội ngũ {site} sẽ quyết định.').replace(/\{site\}/g, SITE_NAME)

  return (
    <div>
      {/* Plain h1, NO glyph (R3 critic; icon-language §6). The accent-blue Scale that sat
          beside this title was decorative brand chrome: §6's color taxonomy is exhaustive
          (brand line-only = links/affordances, solid = user-state, wash = artwork/active)
          and a static header icon fits no bucket — nor do the sibling dashboard sections
          (listings, help) or any mobile SectionHeader carry a title glyph. The concept
          keeps its Scale where it MEANS something: the rail row and a case's row. */}
      {/* The page title row is ui/page-header (the heading ramp + its meta line); `compact` (embedded
          in another screen that owns the title) keeps only the line. */}
      {compact ? (
        <p className="text-sm text-muted-foreground">{disputesLede}</p>
      ) : (
        <PageHeader title={t('Disputes', 'Khiếu nại')} meta={disputesLede} {...(underSectionHeader ? { titleClassName: 'max-lg:sr-only' } : {})} />
      )}

      {loading ? (
        <Rows className="mt-6">
          {Array.from({ length: 3 }).map((_, i) => <Row key={i}><Skeleton className="h-12 rounded-lg" /></Row>)}
        </Rows>
      ) : !user ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">{t('Sign in to see your dispute cases.', 'Đăng nhập để xem hồ sơ khiếu nại của bạn.')}</p>
          <div className="mt-4"><SignInPrompt /></div>
        </div>
      ) : cases === null ? (
        <Rows className="mt-6">
          {Array.from({ length: 3 }).map((_, i) => <Row key={i}><Skeleton className="h-12 rounded-lg" /></Row>)}
        </Rows>
      ) : cases.length === 0 ? (
        // THE shared empty-state primitive, not a hand-rolled stack (R3 critic — this was
        // the one §2 breach left on the dashboard: a bare ~40px Scale carrying the UI/nav
        // stroke, i.e. exactly the "rubber-stamped" look the display tier exists to
        // prevent, and a second empty-state language beside the listings page's coin).
        // Since 2026-11-09 it leads with the lifebuoy mascot, as /saved and /rentals/check lead with theirs (UI climb: a coin
        // here beside their mascots read as pages "assembled independently"; the mascots are the warm-empty voice, and
        // nothing here is a fault).
        <EmptyState
          className="mt-6"
          // The page-level tier, as /saved and the inbox draw theirs (2026-11-07 audit: the empty /saved led with an 18px heading
          // over 16px copy, its sibling tool pages with 16px over 14px).
          size="lg"
          media={<Mascot name="help" className="-mb-6 h-40 w-40 sm:-mb-8 sm:h-52 sm:w-52" />}
          title={t('No disputes', 'Chưa có khiếu nại nào')}
          // Where a case starts, once, and the guide to it (2026-11-07 audit, tools + dash judges: "Cases you open —
          // and any about you — appear here" repeated the lede, and nothing led on from "Report"). The guide is the help
          // center's seeded answer: help-center-seed.json `how-reporting-works`, id `help-how-reporting-works`.
          subtitle={t('To open a case, use Report on the listing, the seller’s page or the chat.', 'Để mở hồ sơ khiếu nại, hãy dùng nút Báo cáo trên tin đăng, trang người bán hoặc cuộc trò chuyện.')}
          // The guide on a line of its own, named after the article it opens (2026-11-07 audit: tacked onto the sentence as "How
          // reporting works", it read as part of it). 44px tall: the empty state's one way on.
          action={
            <Link href="/help/help-how-reporting-works" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline">
              {t('How to report and what happens next', 'Cách báo cáo và những gì xảy ra tiếp theo')}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />
      ) : (
        /* One stacked column on EVERY breakpoint (user-picked 2026-07-14). The old
           lg:grid-cols-2 came from the full-page dashboard; inside the 440px account
           rail it squeezed each case into ~200px, truncating the title and stranding
           the chevron. Mobile's plain list is the right shape at this width — so it's
           now the only shape. */
        <Rows className="mt-6">
          {cases.map((c) => {
            const [en, vi] = REASON_LABELS[c.reason] || REASON_LABELS.other
            return (
              <li key={c.id}>
                <Link
                  href={`/disputes/${c.id}`}
                  className="flex items-center gap-3 py-3 transition-colors hover:bg-muted active:bg-muted"
                >
                  {c.listing?.image ? (
                    <Image src={c.listing.image} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-tint"><Scale className="h-5 w-5 text-ink-4" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={c.role === 'reporter' ? 'brand' : 'neutral'}
                        className={cn('text-3xs', c.role === 'respondent' && 'text-body')}
                      >
                        {c.role === 'reporter' ? t('You reported', 'Bạn báo cáo') : t('About you', 'Về bạn')}
                      </Badge>
                      {stageChip(c)}
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">
                      {t(en, vi)}{c.listing ? ` · ${c.listing.title}` : ''}
                    </p>
                    <p className="text-xs text-ink-4">
                      {new Date(c.createdAt).toLocaleDateString(deviceOrIntlLocale(lang))} · {c.messageCount > 0 ? `${c.messageCount} ${t('messages', 'tin nhắn')}` : t('no messages yet', 'chưa có tin nhắn')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
                </Link>
              </li>
            )
          })}
        </Rows>
      )}
    </div>
  )
}
