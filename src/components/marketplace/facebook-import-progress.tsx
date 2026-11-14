'use client'

import { useEffect, useState } from 'react'
import { Check } from '@/components/ui/icons'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useLanguage } from '@/context/language-context'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { TAXONOMY } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

export type ProgressItem = { id: string; status: string; photo: string | null; fbTitle: string; categorySlug: string | null }

/**
 * WHILE AN IMPORT RUNS (owner, 2026-11-06: "import takes a while have some best loading screen … minimal entertaining informative"). Built on what the
 * research on long waits agrees on: past ~10 seconds say what is happening and roughly how long it takes (Nielsen's response-time limits); real phase
 * labels with a determinate bar only where the count is known, never one that rushes and stalls; and showing the real work (the labour-illusion
 * studies, Buell & Norton) — here the seller's own listings arriving one by one and turning into sorted drafts. Nothing in it is invented: every count,
 * row and step comes from the job the server reports. One quiet line of tips is the only decoration; motion follows the global reduced-motion switch.
 */
export function FacebookImportProgress({ status, startedAt, items }: { status: string; startedAt: string; items: ProgressItem[] }) {
  const { tr } = useLanguage()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const tips = [
    tr('Nothing goes live until you press Publish.', 'Không có gì được đăng cho đến khi bạn nhấn Đăng.'),
    tr('We write each listing in Vietnamese and English for you to check, so more buyers can read it.', 'Chúng tôi viết mỗi tin bằng tiếng Việt và tiếng Anh để bạn kiểm tra, giúp nhiều người mua đọc được hơn.'),
    tr('A price like “65” on a big item usually means 65 million. You check every price before publishing.', 'Giá như “65” trên món đồ lớn thường là 65 triệu. Bạn kiểm tra từng giá trước khi đăng.'),
    tr('You can change the category, price and area of each one before publishing.', 'Bạn có thể đổi danh mục, giá và khu vực của từng tin trước khi đăng.'),
    tr('You can leave this page. Your drafts wait here for 7 days.', 'Bạn có thể rời trang này. Bản nháp được giữ ở đây 7 ngày.'),
  ]
  const [tip, setTip] = useState(0)
  useEffect(() => { const t = setInterval(() => setTip((i) => (i + 1) % tips.length), 6000); return () => clearInterval(t) }, [tips.length])

  const total = items.length
  const sorted = items.filter((i) => i.status !== 'raw').length
  // 0 find your profile, 1 read your listings, 2 sort and write. Listings arriving means the profile was found.
  const step = status === 'sorting' ? 2 : total > 0 ? 1 : 0
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const shelf = (slug: string | null) => {
    const c = slug ? TAXONOMY.find((t) => t.slug === slug) : null
    return c ? tr(c.name, c.nameVi) : tr('Sorted', 'Đã phân loại')
  }
  const steps = [
    status === 'queued' ? tr('Waiting for our reader', 'Đang chờ đến lượt') : tr('Finding your profile', 'Đang tìm trang của bạn'),
    total > 0 ? fillTemplate(tr('Reading your listings: {n}', 'Đang đọc tin của bạn: {n}'), 'Reading your listings: {n}', { n: String(total) }) : tr('Reading your listings', 'Đọc tin của bạn'),
    tr('Sorting, pricing and writing in Vietnamese and English', 'Phân loại, đọc giá và viết bằng tiếng Việt và tiếng Anh'),
  ]

  return (
    <section className="space-y-5 rounded-xl border border-border p-4" aria-labelledby="fbi-progress-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="fbi-progress-title" className="text-base font-semibold text-ink">{tr('Importing from Facebook', 'Đang nhập từ Facebook')}</h2>
        <span className="text-xs tabular-nums text-ink-4" aria-label={fillTemplate(tr('{t} so far', 'Đã {t}'), '{t} so far', { t: elapsed })}>{elapsed}</span>
      </div>

      <ol className="space-y-3">
        {steps.map((label, i) => (
          <li key={i} className="flex items-center gap-3 text-sm">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', i < step ? 'bg-primary text-primary-foreground' : i === step ? 'bg-tint' : 'border border-border')} aria-hidden>
              {i < step ? <Check className="size-3.5" /> : i === step ? <Spinner size="sm" /> : null}
            </span>
            <span className={cn(i === step ? 'font-semibold text-ink' : i < step ? 'text-body' : 'text-ink-4')}>{label}</span>
          </li>
        ))}
      </ol>
      {/* One announcement per phase for a screen reader, not one per second. */}
      <p role="status" className="sr-only">{steps[step]}</p>

      {step === 2 && total > 0 && (
        <Progress value={sorted} max={total} aria-label={tr('Listings sorted', 'Tin đã phân loại')} valueText={fillTemplate(tr('{k} of {n}', '{k} trên {n}'), '{k} of {n}', { k: String(sorted), n: String(total) })} />
      )}

      {total > 0 && (
        <ul className="space-y-2" aria-label={tr('Your listings so far', 'Các tin đã đọc')}>
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 motion-safe:animate-in motion-safe:fade-in">
              {i.photo
                // Facebook's own link, for this one seller to look at: <Image> would proxy it, and the optimizer only takes our hosts.
                ? <img src={i.photo} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-lg object-cover" loading="lazy" />
                : <span className="size-10 shrink-0 rounded-lg bg-tint" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{i.fbTitle}</span>
              <span className={cn('shrink-0 text-xs', i.status === 'raw' ? 'text-ink-4' : 'font-semibold text-brand')}>{i.status === 'raw' ? tr('Reading', 'Đang đọc') : shelf(i.categorySlug)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1 border-t border-border pt-3">
        {/* No promise for the queue: one seller is read at a time, so the wait there depends on who is ahead. */}
        <p className="text-xs text-body">{status === 'queued'
          ? tr('You’re in the queue: we read one seller at a time. You can leave this page.', 'Bạn đang trong hàng chờ: chúng tôi đọc lần lượt từng người bán. Bạn có thể rời trang này.')
          : tr('About a minute to find you, then a few seconds per listing. You can leave this page.', 'Khoảng một phút để tìm trang của bạn, rồi vài giây cho mỗi tin. Bạn có thể rời trang này.')}</p>
        <p key={tip} className="text-xs text-ink-4 motion-safe:animate-in motion-safe:fade-in">{tips[tip]}</p>
      </div>
    </section>
  )
}
