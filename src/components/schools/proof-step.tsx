'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { BadgeCheck, ShieldCheck } from '@/components/ui/icons'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useLanguage } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { EXPIRED_PROOF_REASON, ORPHAN_REVIEW_DAYS, PENDING_MAX_DAYS, PROOFS_PENDING_MAX, PURGE_AFTER_DAYS } from '@/lib/schools/constants'

export type ProofView = {
  method: 'linkedin'; status: 'pending' | 'verified' | 'rejected' | 'withdrawn'
  linkedinUrl: string | null; challenge: string | null; rejectReason: string | null
}

/** A proof that lets the teacher write (waiting for a moderator) or publish (verified). */
export const proofLetsWrite = (p: ProofView | null) => !!p && (p.status === 'verified' || p.status === 'pending')

const label = 'text-sm font-semibold text-foreground'

/**
 * Step 1 of a review: private proof that the teacher worked at the school (owner, 2026-10-05: "attach linkedin
 * profile so we can check"). The review stays anonymous — the public sees "Employment checked" only; a moderator
 * checks the LinkedIn profile (src/lib/schools/employment.ts says why there is no work-email route).
 * Server: /api/schools/[id]/proof.
 */
export function ProofStep({ schoolId, schoolName, onChange }: { schoolId: string; schoolName: string; onChange: (p: ProofView | null) => void }) {
  const { tr } = useLanguage()
  const [loaded, setLoaded] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [proof, setProofState] = React.useState<ProofView | null>(null)
  const [open, setOpen] = React.useState(true)
  const [url, setUrl] = React.useState('')
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const setProof = React.useCallback((p: ProofView | null) => { setProofState(p); onChange(p) }, [onChange])

  React.useEffect(() => {
    let gone = false
    fetch(`/api/schools/${schoolId}/proof`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d) => {
        if (gone) return
        setProof(d?.proof ?? null)
        setOpen(d?.open !== false)
        setLoaded(true)
      })
      // A failed load still tells the form it is settled (as "no proof"): the teacher's own review must stay
      // deletable whatever this panel could load (diff review).
      .catch(() => { if (!gone) { setFailed(true); onChange(null) } })
    return () => { gone = true }
  }, [schoolId, setProof, onChange])

  const message = (code: string | undefined) =>
    code === 'linkedin_url_invalid' ? tr('Use your public profile link: it looks like linkedin.com/in/your-name. On LinkedIn: open your profile, then “Edit public profile & URL”.', 'Hãy dùng liên kết hồ sơ công khai: có dạng linkedin.com/in/ten-ban. Trên LinkedIn: mở hồ sơ của bạn, rồi chọn “Chỉnh sửa hồ sơ công khai & URL”.')
    : code === 'rate_limited' ? tr('Too many tries. Wait a while and try again.', 'Bạn thử quá nhiều lần. Hãy đợi một lúc rồi thử lại.')
    : code === 'too_many_pending_proofs' ? tr('You have {n} proofs waiting for a moderator. Please wait until they are checked.', 'Bạn đang có {n} bằng chứng chờ kiểm duyệt. Vui lòng đợi đến khi được kiểm tra.').replace('{n}', String(PROOFS_PENDING_MAX))
    : code === 'not_configured' ? tr('Proof of employment is not open yet. Please try again later.', 'Chức năng chứng minh việc làm chưa mở. Vui lòng thử lại sau.')
    : code === 'proof_already_verified' ? tr('You are already verified for this school.', 'Bạn đã được xác minh cho trường này.')
    : code === 'review_changed_reload' ? tr('Your proof changed in the meantime. Refresh the page.', 'Bằng chứng của bạn vừa thay đổi. Hãy tải lại trang.')
    : code === 'phone_required' ? tr('Add a phone number to your account first.', 'Hãy thêm số điện thoại vào tài khoản trước.')
    : code === 'business_account' ? tr('Business accounts cannot review schools.', 'Tài khoản doanh nghiệp không thể đánh giá trường.')
    : code === 'account_restricted' || code === 'forbidden' ? tr('Your account cannot do this right now.', 'Tài khoản của bạn hiện không thể làm việc này.')
    : tr('Not saved. Try again.', 'Chưa lưu được. Thử lại nhé.')

  async function send(body: Record<string, unknown>, ok?: string): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}/proof`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(message(d?.error)); return false }
      setProof(d.proof ?? null)
      if (ok) toast.success(ok)
      return true
    } catch {
      toast.error(message(undefined))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (failed) return <p className="rounded-2xl bg-card p-4 text-sm text-body ring-1 ring-border">{tr('We could not load your proof of employment. Refresh the page to try again.', 'Không tải được bằng chứng làm việc của bạn. Hãy tải lại trang.')}</p>
  if (!loaded) return <Skeleton className="h-40 w-full rounded-2xl" />

  const withdraw = () => send({ action: 'withdraw' }, tr('Proof removed', 'Đã gỡ bằng chứng'))
  const consentLine = tr(
    'I agree that {site} uses my LinkedIn profile only to check that I worked here. It is never shown with my review, and the link is deleted {n} days after the check (or after {m} days if no one has checked it); only a one-way fingerprint of it is kept, so the same profile cannot vouch for another account.',
    'Tôi đồng ý để {site} chỉ dùng hồ sơ LinkedIn của tôi để kiểm tra rằng tôi từng làm ở đây. Hồ sơ không bao giờ hiển thị cùng đánh giá, và liên kết bị xoá {n} ngày sau khi kiểm tra (hoặc sau {m} ngày nếu chưa ai kiểm tra); chỉ một dấu vân tay một chiều được giữ lại, để cùng một hồ sơ không thể bảo chứng cho tài khoản khác.',
  ).replace('{n}', String(PURGE_AFTER_DAYS)).replace('{m}', String(PENDING_MAX_DAYS)).replace('{site}', SITE_NAME) // the site the teacher is on (diff review)

  return (
    <section aria-labelledby="proof-h" className="flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-border sm:p-6">
      <div>
        <h2 id="proof-h" className="text-base font-bold text-foreground">{tr('1. Show that you worked here (private)', '1. Chứng minh bạn từng làm ở đây (riêng tư)')}</h2>
        <p className="mt-1 flex items-start gap-2 text-sm text-body">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>{tr('Your review stays anonymous: it shows only "Employment checked". Only our moderators know which LinkedIn profile is yours — never the school, never other users.', 'Đánh giá của bạn vẫn ẩn danh: chỉ hiển thị "Đã kiểm tra nơi làm việc". Chỉ kiểm duyệt viên của chúng tôi biết hồ sơ LinkedIn nào là của bạn — không bao giờ là trường hay người dùng khác.')}</span>
        </p>
        {/* ⚠️ THE CODE SITS ON A PUBLIC PROFILE (diff review): a current employer who watches its staff's profiles could
            notice it, then a review — so the teacher is told, not reassured. */}
        <p className="mt-2 text-sm text-body">
          {tr('Still working there? Your school can see your LinkedIn profile. Add the code only when you are ready, and remove it as soon as you are verified — or write your review after you have left.', 'Vẫn đang làm ở đó? Trường có thể xem hồ sơ LinkedIn của bạn. Chỉ thêm mã khi bạn sẵn sàng và gỡ ngay khi được xác minh — hoặc viết đánh giá sau khi bạn đã nghỉ.')}
        </p>
      </div>

      {proof?.status === 'verified' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <BadgeCheck aria-hidden className="size-5" /> {tr('Verified through LinkedIn', 'Đã xác minh qua LinkedIn')}
          </p>
          <WithdrawButton busy={busy} onConfirm={withdraw} />
        </div>
      )}

      {proof?.status === 'pending' && (
        <div className="flex flex-col gap-2 text-sm text-body">
          <p className="font-semibold text-foreground">{tr('Waiting for a moderator to check your LinkedIn profile', 'Đang chờ kiểm duyệt viên kiểm tra hồ sơ LinkedIn của bạn')}</p>
          <p>
            {tr('Until then, put this code anywhere on your LinkedIn profile (headline or About), and make sure {name} is in your Experience. Remove the code once you are verified.', 'Trong lúc chờ, hãy đặt mã này ở bất kỳ đâu trên hồ sơ LinkedIn (tiêu đề hoặc phần Giới thiệu), và đảm bảo {name} có trong mục Kinh nghiệm. Gỡ mã sau khi được xác minh.').replace('{name}', schoolName)}
          </p>
          <p><code className="rounded-lg bg-muted px-2 py-1 font-mono text-base font-semibold text-foreground">{proof.challenge}</code></p>
          <p className="text-muted-foreground">{tr('You can write your review now; it appears once the proof is checked.', 'Bạn có thể viết đánh giá ngay; đánh giá sẽ hiển thị sau khi bằng chứng được kiểm tra.')}</p>
          <WithdrawButton busy={busy} onConfirm={withdraw} />
        </div>
      )}

      {proof?.status === 'rejected' && (
        <p className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-foreground">
          {tr('Your last proof was not accepted.', 'Bằng chứng trước của bạn chưa được chấp nhận.')}
          {/* The retention sweep's own reason is ours to translate; a moderator's is shown as they wrote it. */}
          {proof.rejectReason === EXPIRED_PROOF_REASON ? ` ${tr('Not checked in time — please submit it again.', 'Chưa được kiểm tra kịp thời — vui lòng gửi lại.')}` : proof.rejectReason ? ` ${proof.rejectReason}` : ''} {tr('You can try again below. A saved review is kept for {n} days without a proof, then deleted.', 'Bạn có thể thử lại bên dưới. Đánh giá đã lưu được giữ {n} ngày khi không có bằng chứng, sau đó bị xoá.').replace('{n}', String(ORPHAN_REVIEW_DAYS))}
        </p>
      )}

      {!open && (!proof || proof.status === 'rejected' || proof.status === 'withdrawn') && (
        <p className="rounded-xl bg-tint px-3 py-2 text-sm text-foreground">{tr('Proof of employment opens soon, and new reviews with it. Please come back in a few days.', 'Chức năng chứng minh việc làm sắp mở, cùng với đánh giá mới. Vui lòng quay lại sau vài ngày.')}</p>
      )}

      {open && (!proof || proof.status === 'rejected' || proof.status === 'withdrawn') && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="proof-linkedin" className={label}>{tr('Your LinkedIn profile', 'Hồ sơ LinkedIn của bạn')}</label>
            <Input id="proof-linkedin" type="url" inputMode="url" placeholder="linkedin.com/in/your-name" value={url} onChange={(e) => setUrl(e.target.value.slice(0, 300))} className="min-h-11 rounded-xl" />
            <p className="text-xs text-muted-foreground">{tr('A moderator checks that {name} is in your Experience. We never post anything to LinkedIn.', 'Kiểm duyệt viên kiểm tra rằng {name} có trong mục Kinh nghiệm của bạn. Chúng tôi không đăng gì lên LinkedIn.').replace('{name}', schoolName)}</p>
          </div>
          <label className="flex items-start gap-3 text-sm text-foreground">
            {/* ui/checkbox: onChange receives the new boolean (Base UI's onCheckedChange underneath). */}
            <Checkbox checked={consent} onChange={setConsent} className="mt-0.5" />
            <span>{consentLine}</span>
          </label>
          <Button type="button" className="self-start" disabled={busy || !consent || url.trim().length < 10}
            onClick={() => void send({ action: 'linkedin', url, consent: true }, tr('Sent to a moderator', 'Đã gửi tới kiểm duyệt viên'))}>
            {tr('Send for checking', 'Gửi để kiểm tra')}
          </Button>
        </div>
      )}
    </section>
  )
}

function WithdrawButton({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const { tr } = useLanguage()
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button type="button" variant="ghost" size="sm" className="self-start text-destructive" disabled={busy} />}>
        {tr('Remove my proof', 'Gỡ bằng chứng của tôi')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr('Remove your proof of employment?', 'Gỡ bằng chứng làm việc?')}</AlertDialogTitle>
          <AlertDialogDescription>{tr('Your review stops showing until you prove it again. It stays saved for {n} days, with any pay you reported, then it is deleted; you can delete it now on this page.', 'Đánh giá của bạn sẽ ngừng hiển thị cho đến khi bạn chứng minh lại. Đánh giá được lưu {n} ngày, cùng mức lương bạn đã báo, sau đó bị xoá; bạn có thể xoá ngay trên trang này.').replace('{n}', String(ORPHAN_REVIEW_DAYS))}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tr('Keep it', 'Giữ lại')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>{tr('Remove', 'Gỡ')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
