'use client'

import { Suspense, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { Mail, Check, ArrowLeft } from '@/components/ui/icons'

// Public, token-scoped email-preference page (no login). The visible footer link in the
// digest lands here; a click POSTs to /api/unsubscribe so a link scanner's GET never
// unsubscribes anyone. The weekly digest also offers a one-tap re-subscribe.
//
// ⛔ THE TEACHER JOB-MATCH EMAILS (`list=teacher-matches`) ARE THEIR OWN LIST, WITH THEIR OWN WORDS (plan review E3,
// 2026-10-08). They used to land on the digest's copy — a teacher who stopped match emails was told they had left "the
// weekly eno.vn digest" — and the Re-subscribe button silently switched matchEmailOptIn back on with no consent record.
// Now: the copy names the match emails, and there is NO re-subscribe here. Turning them back on is a consent to AI
// matching (Anthropic, outside Vietnam) that is given where that notice is shown — the teacher profile — so the page
// links to /teachers/edit instead (the API refuses `optIn: true` for this list too).
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-page" />}>
      <UnsubscribeInner />
    </Suspense>
  )
}

function UnsubscribeInner() {
  const { tr } = useLanguage()
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const teacherMatches = params.get('list') === 'teacher-matches'
  const list = teacherMatches ? '&list=teacher-matches' : ''
  const [state, setState] = useState<'idle' | 'saving' | 'unsubscribed' | 'resubscribed' | 'retry' | 'error'>('idle')
  // The action a 'retry' repeats: the unsubscribe, or the digest's re-subscribe.
  const [lastOptIn, setLastOptIn] = useState(false)

  const set = async (optIn: boolean) => {
    if (!token) { setState('error'); return }
    setState('saving')
    setLastOptIn(optIn)
    try {
      const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}${list}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      })
      // ⚠️ "Invalid or expired" only for a link the server REFUSED (400/404). A 409 'retry' (the row moved under three
      // compare-and-set attempts), a 5xx or no answer at all is ours, and the link still works (commit gate, 2026-10-09).
      setState(res.ok ? (optIn ? 'resubscribed' : 'unsubscribed') : res.status === 409 || res.status >= 500 ? 'retry' : 'error')
    } catch {
      setState('retry')
    }
  }

  const unsubscribeButton = (
    <Button
      variant="cta"
      size="none"
      onClick={() => set(false)}
      disabled={state === 'saving' || !token}
      className="mt-6 w-full py-2.5 cursor-pointer"
    >
      {state === 'saving' ? tr('Saving…', 'Đang lưu…') : tr('Unsubscribe', 'Hủy đăng ký')}
    </Button>
  )
  // The way back for the match emails: the teacher profile, where the AI notice is shown.
  const profileLink = (label: string) => (
    <Link href="/teachers/edit" className="mt-6 inline-flex font-bold text-accent-foreground underline underline-offset-2">
      {label}
    </Link>
  )

  // One heading, one line and one action per state — the match emails' own words, or the weekly digest's.
  const view: { title: string; body: string; action: ReactNode } =
    state === 'unsubscribed' && teacherMatches
      ? {
          title: tr("You're unsubscribed", 'Bạn đã hủy đăng ký'),
          body: tr('You won’t get teaching-job match emails anymore.', 'Bạn sẽ không nhận email gợi ý việc làm giảng dạy nữa.'),
          action: profileLink(tr('Turn them back on in your teacher profile', 'Bật lại trong hồ sơ giáo viên của bạn')),
        }
      : state === 'unsubscribed'
        ? {
            title: tr("You're unsubscribed", 'Bạn đã hủy đăng ký'),
            body: tr("You won't get the weekly eno.vn digest anymore. Changed your mind?", 'Bạn sẽ không nhận bản tin hằng tuần của eno.vn nữa. Đổi ý?'),
            action: (
              <Button
                variant="outline"
                size="none"
                onClick={() => set(true)}
                className="mt-6 border-border px-5 py-2.5 font-bold text-accent-foreground hover:bg-tint hover:text-accent-foreground cursor-pointer"
              >
                {tr('Re-subscribe', 'Đăng ký lại')}
              </Button>
            ),
          }
        : state === 'resubscribed'
          ? {
              title: tr("You're back in", 'Bạn đã đăng ký lại'),
              body: tr("You'll receive the weekly eno.vn digest again.", 'Bạn sẽ tiếp tục nhận bản tin hằng tuần của eno.vn.'),
              action: null,
            }
          : state === 'retry'
            ? {
                title: tr("That didn't go through", 'Chưa thực hiện được'),
                body: tr('Something went wrong on our side. Your link still works — please try again.', 'Đã có lỗi từ phía chúng tôi. Liên kết của bạn vẫn dùng được — vui lòng thử lại.'),
                action: (
                  <Button variant="cta" size="none" onClick={() => set(lastOptIn)} className="mt-6 w-full py-2.5 cursor-pointer">
                    {tr('Try again', 'Thử lại')}
                  </Button>
                ),
              }
          : state === 'error' && teacherMatches
            ? {
                title: tr("That link didn't work", 'Liên kết không hợp lệ'),
                body: tr('The unsubscribe link is invalid or expired. You can turn teaching-job match emails off in your teacher profile.', 'Liên kết hủy đăng ký không hợp lệ hoặc đã hết hạn. Bạn có thể tắt email gợi ý việc làm giảng dạy trong hồ sơ giáo viên của mình.'),
                action: profileLink(tr('Open my teacher profile', 'Mở hồ sơ giáo viên của tôi')),
              }
            : state === 'error'
              ? {
                  title: tr("That link didn't work", 'Liên kết không hợp lệ'),
                  body: tr('The unsubscribe link is invalid or expired. You can manage email preferences from your account settings.', 'Liên kết hủy đăng ký không hợp lệ hoặc đã hết hạn. Bạn có thể quản lý email trong cài đặt tài khoản.'),
                  action: null,
                }
              : teacherMatches
                ? {
                    title: tr('Stop teaching-job match emails?', 'Ngừng nhận email gợi ý việc làm giảng dạy?'),
                    body: tr('You will stop getting emails that suggest teaching jobs for your teacher profile. Nothing else in your profile changes.', 'Bạn sẽ không còn nhận email gợi ý việc làm giảng dạy cho hồ sơ giáo viên của mình. Những phần khác trong hồ sơ không thay đổi.'),
                    action: unsubscribeButton,
                  }
                : {
                    title: tr('Unsubscribe from the weekly digest?', 'Hủy đăng ký bản tin hằng tuần?'),
                    body: tr('Stop receiving the weekly "top products & moving sales" email from eno.vn.', 'Ngừng nhận email hằng tuần "sản phẩm nổi bật & moving sale" từ eno.vn.'),
                    action: unsubscribeButton,
                  }

  return (
    // Flat canon: one canvas, no floating card — the composition centers itself and the
    // tint circle anchors the state; separation below comes from a hairline, not a box.
    <div className="flex min-h-page items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tint">
          {state === 'unsubscribed' ? <Check className="h-6 w-6 text-accent-foreground" /> : <Mail className="h-6 w-6 text-accent-foreground" />}
        </div>

        {/* ONE heading for every state, on the type ramp (.h-title — docs/design-language.md §1). */}
        <h1 className="h-title mt-4 text-foreground">{view.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{view.body}</p>
        {view.action}

        {/* Same quiet exit as /signin: hairline seam + arrow icon + the shared string. */}
        <div className="mt-8 border-t border-border/60 pt-4">
          <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-accent-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {tr('Back to eno.vn', 'Về trang chủ')}
          </Link>
        </div>
      </div>
    </div>
  )
}
