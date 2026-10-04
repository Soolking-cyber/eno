'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Building2 } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, Radio, RadioDot } from '@/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'

const REASONS = [
  { k: 'reply', en: 'Reply to a review', vi: 'Phản hồi một đánh giá' },
  { k: 'correction', en: 'Correct something that is wrong', vi: 'Đính chính thông tin sai' },
  { k: 'removal_request', en: 'Ask us to review a post for removal', vi: 'Đề nghị xem xét gỡ một bài viết' },
  { k: 'directory_details', en: 'Update the school\'s details', vi: 'Cập nhật thông tin của trường' },
] as const

/**
 * "Is this your school?" — the school's right of reply (plan review 2026-10-04). Lands in the admin
 * Schools queue as a `school_complaint` with a 24 h due-by; a moderator answers at the email given and
 * can publish the school's response under the review.
 */
export function SchoolClaim({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const { tr } = useLanguage()
  const { user, openSignIn } = useAuth()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState<(typeof REASONS)[number]['k'] | ''>('')
  const [detail, setDetail] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const valid = !!reason && detail.trim().length >= 20 && /^\S+@\S+\.\S+$/.test(email.trim())
  // A different account on the same page starts with an empty form — never the previous sender's email.
  React.useEffect(() => { setReason(''); setDetail(''); setEmail('') }, [user?.id])

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}/complaint`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, detail: detail.trim(), contactEmail: email.trim() }),
      })
      if (res.ok) {
        toast.success(tr('Sent. A moderator will reply by email.', 'Đã gửi. Kiểm duyệt viên sẽ trả lời qua email.'))
        setOpen(false); setReason(''); setDetail(''); setEmail('')
      } else {
        const e = (await res.json().catch(() => ({}))).error
        toast.error(e === 'rate_limited' ? tr('Too many requests — try again later.', 'Quá nhiều yêu cầu — thử lại sau.') : tr('Not sent. Try again.', 'Chưa gửi được. Thử lại nhé.'))
      }
    } catch {
      toast.error(tr('Not sent. Try again.', 'Chưa gửi được. Thử lại nhé.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm"
        onClick={() => (user ? setOpen(true) : openSignIn({ note: tr('Sign in to contact the moderators.', 'Đăng nhập để liên hệ kiểm duyệt viên.') }))}>
        <Building2 aria-hidden /> {tr('Is this your school?', 'Đây là trường của bạn?')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr('Contact the moderators about {name}', 'Liên hệ kiểm duyệt viên về {name}').replace('{name}', schoolName)}</DialogTitle>
            <DialogDescription>
              {tr('Schools can reply to reviews and ask for corrections. Tell us which review you mean and what you would like changed.', 'Trường có thể phản hồi đánh giá và yêu cầu đính chính. Hãy cho chúng tôi biết bạn muốn nói đến đánh giá nào và cần thay đổi điều gì.')}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={(v) => setReason(v as typeof reason)} className="flex flex-col gap-1" aria-label={tr('What do you need?', 'Bạn cần gì?')}>
            {REASONS.map((r) => (
              <Radio key={r.k} value={r.k} className="min-h-10 justify-start rounded-xl px-2 text-sm text-foreground hover:bg-muted">
                <RadioDot /> {tr(r.en, r.vi)}
              </Radio>
            ))}
          </RadioGroup>
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, 3000))} rows={5}
            placeholder={tr('Your message — quote the review you mean and, for a reply, the text to publish', 'Nội dung — trích đánh giá bạn muốn nói đến và, nếu phản hồi, nội dung muốn đăng')}
            aria-label={tr('Message', 'Nội dung')} />
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 200))} className="min-h-11 rounded-xl"
            placeholder={tr('Work email for our reply', 'Email công việc để chúng tôi trả lời')} aria-label={tr('Email', 'Email')} autoComplete="email" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tr('Cancel', 'Huỷ')}</Button>
            <Button variant="cta" disabled={!valid || busy} onClick={submit}>{tr('Send', 'Gửi')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
