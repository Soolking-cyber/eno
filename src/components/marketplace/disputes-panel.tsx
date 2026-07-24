'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Scale, ChevronRight } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

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

export function DisputesPanel({ compact = false }: { compact?: boolean }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
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

  return (
    <div>
      {!compact && (
        <div className="flex items-center gap-2.5">
          <Scale className="h-5 w-5 text-accent-foreground" />
          <h1 className="h-title text-foreground">{t('Disputes', 'Khiếu nại')}</h1>
        </div>
      )}
      <p className={cn('text-sm text-muted-foreground', !compact && 'mt-1')}>
        {t('Reports you filed and cases about you. Both sides can add evidence; the eno.vn team decides.', 'Báo cáo bạn đã gửi và hồ sơ liên quan đến bạn. Hai bên đều có thể nộp bằng chứng; đội ngũ eno.vn sẽ quyết định.')}
      </p>

      {loading ? (
        <div className="mt-6 space-y-1">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}
        </div>
      ) : !user ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">{t('Sign in to see your dispute cases.', 'Đăng nhập để xem hồ sơ khiếu nại của bạn.')}</p>
          <div className="mt-4"><SignInPrompt /></div>
        </div>
      ) : cases === null ? (
        <div className="mt-6 space-y-1">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}
        </div>
      ) : cases.length === 0 ? (
        <div className="mt-14 text-center">
          <Scale className="mx-auto h-10 w-10 text-ink-4" />
          <p className="mt-3 text-sm font-semibold text-foreground">{t('No disputes', 'Chưa có khiếu nại nào')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('If you report a listing, seller or conversation — or someone reports you — the case appears here.', 'Khi bạn báo cáo tin đăng, người bán hay cuộc trò chuyện — hoặc có người báo cáo bạn — hồ sơ sẽ hiển thị ở đây.')}
          </p>
        </div>
      ) : (
        /* One stacked column on EVERY breakpoint (user-picked 2026-07-14). The old
           lg:grid-cols-2 came from the full-page dashboard; inside the 440px account
           rail it squeezed each case into ~200px, truncating the title and stranding
           the chevron. Mobile's plain list is the right shape at this width — so it's
           now the only shape. */
        <ul className="mt-6">
          {cases.map((c) => {
            const [en, vi] = REASON_LABELS[c.reason] || REASON_LABELS.other
            return (
              <li key={c.id}>
                <Link
                  href={`/disputes/${c.id}`}
                  className="flex items-center gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-muted"
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
                      {new Date(c.createdAt).toLocaleDateString()} · {c.messageCount > 0 ? `${c.messageCount} ${t('messages', 'tin nhắn')}` : t('no messages yet', 'chưa có tin nhắn')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
