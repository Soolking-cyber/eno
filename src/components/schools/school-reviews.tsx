'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowBigUp, BadgeCheck, Flag, MessageSquareText, PencilLine } from '@/components/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'
import { RadioGroup, Radio, RadioDot } from '@/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { ELIGIBLE_ACCOUNT_AGE_DAYS, EMPLOYMENT_LABEL, REVIEWS_NEED_PROOF, REPORT_REASONS, REPORT_REASON_LABEL, TAG_LABEL, VERIFY_IDENTITY_PATH, type ReportReason } from '@/lib/schools/constants'
import { stintParts, wilsonLower } from '@/lib/schools/logic'
import type { PublicReview } from '@/lib/schools/queries'
import { useSchoolLive } from './school-live'

/** Month + year in Saigon time. en-GB for every non-Vietnamese language, so server and client agree. */
function monthYear(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })
}

export function SchoolReviews({ reviews, slug, schoolName }: { reviews: PublicReview[]; slug: string; schoolName: string }) {
  const { tr } = useLanguage()
  const [sort, setSort] = React.useState<'helpful' | 'new'>('helpful')
  const shown = React.useMemo(() => {
    const out = [...reviews]
    if (sort === 'helpful') out.sort((a, b) => wilsonLower(b.up, b.down) - wilsonLower(a.up, a.down) || b.createdAt.localeCompare(a.createdAt))
    else out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return out
  }, [reviews, sort])

  if (!reviews.length) {
    return (
      <EmptyState
        tone="dashed"
        icon={MessageSquareText}
        title={tr('No reviews yet', 'Chưa có đánh giá')}
        subtitle={tr('Worked or taught here? Your review helps the next teacher decide.', 'Bạn từng dạy ở đây? Đánh giá của bạn giúp giáo viên đến sau quyết định.')}
        action={
          <Button variant="cta" asChild>
            <Link href={`/schools/${slug}/review`}><PencilLine aria-hidden /> {tr('Write a review', 'Viết đánh giá')}</Link>
          </Button>
        }
      />
    )
  }
  return (
    <div>
      <Segmented
        className="max-w-xs"
        aria-label={tr('Sort reviews', 'Sắp xếp đánh giá')}
        value={sort}
        onValueChange={setSort}
        options={[
          { value: 'helpful', label: tr('Most helpful', 'Hữu ích nhất') },
          { value: 'new', label: tr('Newest', 'Mới nhất') },
        ]}
      />
      <ul className="mt-4 flex flex-col gap-3">
        {shown.map((r) => <ReviewCard key={r.id} review={r} schoolName={schoolName} />)}
      </ul>
    </div>
  )
}

function ReviewCard({ review: r, schoolName }: { review: PublicReview; schoolName: string }) {
  const { tr, lang } = useLanguage()
  const parts = stintParts(r)
  return (
    <li className="rounded-2xl bg-card p-4 ring-1 ring-border sm:p-5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {/* Every public review has a moderator-checked proof of employment (queries.ts reviewAuthorSql), so the
            badge is true of each one — and says nothing about who. ⚠️ "CHECKED", NOT "VERIFIED EMPLOYEE" (diff
            review): a LinkedIn history is written by its owner, so the claim is what a moderator did, no more. */}
        {/* Only while proofs are required (constants.ts REVIEWS_NEED_PROOF, off since 2026-10-06): the badge must stay true. */}
        {REVIEWS_NEED_PROOF && <>
          <span className="inline-flex items-center gap-1 font-semibold text-success"><BadgeCheck aria-hidden className="size-4" />{tr('Employment checked', 'Đã kiểm tra nơi làm việc')}</span>
          <span aria-hidden>·</span>
        </>}
        <span className="font-semibold text-foreground">{parts.map((p) => tr(p.en, p.vi)).join(' · ')}</span>
        <span aria-hidden>·</span>
        <span>{tr(EMPLOYMENT_LABEL[r.employment].en, EMPLOYMENT_LABEL[r.employment].vi)}</span>
        {r.district && <><span aria-hidden>·</span><span>{r.district}</span></>}
        <span aria-hidden>·</span>
        <time dateTime={r.createdAt}>{monthYear(r.createdAt, lang)}</time>
      </p>

      {(r.goodTags.length > 0 || r.badTags.length > 0) && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {r.goodTags.map((t) => <Badge key={t} variant="success">{tr(TAG_LABEL[t].en, TAG_LABEL[t].vi)}</Badge>)}
          {r.badTags.map((t) => <Badge key={t} variant="warning">{tr(TAG_LABEL[t].en, TAG_LABEL[t].vi)}</Badge>)}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-success">{tr("What's good", 'Điểm tốt')}</h4>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{r.pros}</p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-destructive">{tr("What's not so good", 'Điểm chưa tốt')}</h4>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{r.cons}</p>
        </div>
      </div>
      {r.advice && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold text-foreground">{tr('Advice for teachers thinking of joining', 'Lời khuyên cho giáo viên định về đây')}</h4>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{r.advice}</p>
        </div>
      )}

      {r.replyText && (
        <div className="mt-4 rounded-xl bg-tint p-3">
          <p className="text-xs font-semibold text-foreground">
            {tr('Response from {name}', 'Phản hồi từ {name}').replace('{name}', schoolName)}
            {r.replyAt && <span className="font-normal text-muted-foreground"> · {monthYear(r.replyAt, lang)}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{r.replyText}</p>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <HelpfulVote review={r} />
        <ReportReview reviewId={r.id} />
      </div>
    </li>
  )
}

function HelpfulVote({ review }: { review: PublicReview }) {
  const { tr, lang } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const live = useSchoolLive()
  const mine = live.myReviews[review.id] ?? 0
  const [busy, setBusy] = React.useState(false)
  // LIVE eligible counts from the server, exactly like school scores; the cached page's numbers only until
  // they arrive. (A local delta on top of cached counts drifted — diff review.)
  const c = live.reviewCounts[review.id] ?? { up: review.up, down: review.down }
  // Until the visitor's own votes have loaded, a press would be judged against the wrong starting point —
  // but a FAILED load still lets a signed-out visitor reach the sign-in prompt.
  const ready = !loading && (live.ready || live.failed || !user)

  async function press(dir: 1 | -1) {
    if (busy || loading) return
    if (!user) { openSignIn({ note: tr('Sign in to rate reviews.', 'Đăng nhập để đánh giá mức hữu ích.') }); return }
    if (!live.ready) { toast.error(tr('Your votes did not load. Refresh the page to vote.', 'Chưa tải được bình chọn của bạn. Hãy tải lại trang để bình chọn.')); return }
    const at = live.epoch
    const prev = mine
    const next = mine === dir ? 0 : dir
    setBusy(true)
    // A retraction does not move the public number optimistically (the vote may never have counted).
    if (next === 0) live.setMyReviewOnly(review.id, 0, at)
    else live.setMyReview(review.id, next, prev, at)
    const revert = () => { if (next === 0) live.setMyReviewOnly(review.id, prev, at); else live.setMyReview(review.id, prev, next, at) }
    try {
      const res = await fetch(`/api/schools/reviews/${review.id}/vote`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        revert()
        toast.error(
          body?.error === 'forbidden' ? tr("You can't rate your own review.", 'Bạn không thể tự đánh giá bài của mình.')
          : body?.error === 'business_account' ? tr('Business accounts cannot rate reviews.', 'Tài khoản doanh nghiệp không thể đánh giá bài viết.')
          : tr('Not saved. Try again.', 'Chưa lưu được. Thử lại nhé.'),
        )
        return
      }
      // Stored, but a new account's vote does not count yet: the public number must not show it.
      if (next !== 0 && body?.countsNow === false) {
        live.undoReviewCount(review.id, next, prev, at)
        // One verified person, one vote — and the teacher is told so, as on a school vote (diff review: a helpful
        // vote that silently did not count read as broken).
        if (body?.needsIdentity) {
          const young = typeof body.countsFrom === 'string' && new Date(body.countsFrom) > new Date()
          toast(young
            ? tr('Saved. It counts once you verify your identity and your account is {n} days old: one person, one vote.', 'Đã lưu. Phiếu sẽ được tính khi bạn xác minh danh tính và tài khoản được {n} ngày tuổi: mỗi người một phiếu.').replace('{n}', String(ELIGIBLE_ACCOUNT_AGE_DAYS))
            : tr('Saved. It counts once you verify your identity: one person, one vote.', 'Đã lưu. Phiếu sẽ được tính khi bạn xác minh danh tính: mỗi người một phiếu.'), {
            action: { label: tr('Verify', 'Xác minh'), onClick: () => { window.location.href = VERIFY_IDENTITY_PATH } },
          })
        } else {
          // Verified, but the account is new: say when it counts, as a school vote does (diff review).
          toast(tr('Saved. It counts once your account is {n} days old.', 'Đã lưu. Phiếu sẽ được tính khi tài khoản của bạn được {n} ngày tuổi.').replace('{n}', String(ELIGIBLE_ACCOUNT_AGE_DAYS)))
        }
      }
      live.refresh({ reviews: [review.id] })
    } catch {
      revert()
      toast.error(tr('Not saved. Try again.', 'Chưa lưu được. Thử lại nhé.'))
    } finally {
      setBusy(false)
    }
  }

  const loc = moneyLocale(lang)
  const btn = 'rounded-full font-normal text-muted-foreground'
  return (
    <div className="flex items-center gap-1" role="group" aria-label={tr('Was this review helpful?', 'Đánh giá này có hữu ích không?')}>
      <span className="mr-1 text-sm text-muted-foreground">{tr('Helpful?', 'Hữu ích?')}</span>
      <Button variant="ghost" size="sm" className={cn(btn, mine === 1 && 'bg-brand-50 text-brand dark:bg-brand/20')} aria-pressed={mine === 1} onClick={() => press(1)} disabled={busy || !ready}
        aria-label={tr('Helpful ({n})', 'Hữu ích ({n})').replace('{n}', String(c.up))}>
        <ArrowBigUp aria-hidden className="size-5" /> <span className="tabular-nums">{formatInteger(c.up, loc)}</span>
      </Button>
      <Button variant="ghost" size="sm" className={cn(btn, mine === -1 && 'bg-destructive/10 text-destructive')} aria-pressed={mine === -1} onClick={() => press(-1)} disabled={busy || !ready}
        aria-label={tr('Not helpful ({n})', 'Không hữu ích ({n})').replace('{n}', String(c.down))}>
        <ArrowBigUp aria-hidden className="size-5 rotate-180" /> <span className="tabular-nums">{formatInteger(c.down, loc)}</span>
      </Button>
    </div>
  )
}

function ReportReview({ reviewId }: { reviewId: string }) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState<ReportReason | ''>('')
  const [detail, setDetail] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // Another account on the same page never sees this one's unfinished report.
  React.useEffect(() => { setOpen(false); setReason(''); setDetail('') }, [user?.id])

  async function submit() {
    if (!reason || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/schools/reviews/${reviewId}/report`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, detail: detail.trim() || undefined }),
      })
      const e = res.ok ? null : (await res.json().catch(() => ({}))).error
      if (res.ok) {
        toast.success(tr('Thanks — a moderator will look at it.', 'Cảm ơn bạn — kiểm duyệt viên sẽ xem xét.'))
        setOpen(false); setReason(''); setDetail('')
      } else {
        toast.error(e === 'cannot_report_self' ? tr("You can't report your own review.", 'Bạn không thể báo cáo bài của mình.')
          : e === 'rate_limited' ? tr('Too many reports — try again later.', 'Bạn đã báo cáo quá nhiều — thử lại sau.')
          : tr('Not sent. Try again.', 'Chưa gửi được. Thử lại nhé.'))
      }
    } catch {
      toast.error(tr('Not sent. Try again.', 'Chưa gửi được. Thử lại nhé.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground"
        disabled={loading} onClick={() => (user ? setOpen(true) : openSignIn({ note: tr('Sign in to report a review.', 'Đăng nhập để báo cáo đánh giá.') }))}>
        <Flag aria-hidden /> {tr('Report', 'Báo cáo')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr('Report this review', 'Báo cáo đánh giá này')}</DialogTitle>
            <DialogDescription>{tr('A moderator reads every report. Reports never remove a review on their own.', 'Kiểm duyệt viên đọc mọi báo cáo. Báo cáo không tự động gỡ đánh giá.')}</DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={(v) => setReason(v as ReportReason)} className="flex flex-col gap-1" aria-label={tr('Reason', 'Lý do')}>
            {REPORT_REASONS.map((k) => (
              <Radio key={k} value={k} className="min-h-10 justify-start rounded-xl px-2 text-sm text-foreground hover:bg-muted">
                <RadioDot /> {tr(REPORT_REASON_LABEL[k].en, REPORT_REASON_LABEL[k].vi)}
              </Radio>
            ))}
          </RadioGroup>
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, 1000))} rows={3}
            placeholder={tr('Anything the moderator should know (optional)', 'Điều kiểm duyệt viên nên biết (không bắt buộc)')}
            aria-label={tr('Details', 'Chi tiết')} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tr('Cancel', 'Huỷ')}</Button>
            <Button variant="cta" disabled={!reason || busy} onClick={submit}>{tr('Send report', 'Gửi báo cáo')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
