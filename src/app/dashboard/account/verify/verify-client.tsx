'use client'

// ── Identity verification — the declaration gate ─────────────────────────────────────────────────
//
// This route already had a caller before it had a page: `publishBlockedBody()` sends every blocked
// seller to /dashboard/account/verify, and until now that was a 404. A gate that refuses someone
// and then points them at a dead link is worse than no gate — it reads as the site being broken,
// on the one screen where we are asking for trust and identity documents.
//
// docs/compliance-2026.md §1. Declaration text + hashing: src/lib/compliance/declaration.ts.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Fingerprint, IdCard } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DECLARATIONS, CURRENT_DECLARATION } from '@/lib/compliance/declaration'
import { LEGAL_BASIS } from '@/lib/compliance/legal-basis'

export function VerifyClient() {
  const { tr, lang } = useLanguage()
  const { user, loading } = useAuth()
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [tier, setTier] = useState<'A' | 'B' | null>(null)

  // Same client gate every sibling section uses — a SERVER redirect here would race the session
  // restore and reproduce the signin↔dashboard bounce /dashboard/page.tsx warns about.
  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/account/verify')
  }, [loading, user, router])

  if (loading || !user) {
    return <div role="status" aria-label={tr('Loading…', 'Đang tải…')} className="h-64 animate-pulse rounded-2xl bg-muted/40" />
  }

  const decl = DECLARATIONS[CURRENT_DECLARATION]
  // ⚠️ Render the language the user is reading, but the HASH covers both (see declaration.ts).
  // What is on screen is a courtesy; what is recorded is the whole declaration.
  const body = lang === 'vi' ? decl.vi : decl.en

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="h-display flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-6 w-6 text-accent-foreground" strokeWidth={2.25} />
          {tr('Verify your identity', 'Xác minh danh tính')}
        </h1>
        <p className="text-body">
          {tr(
            'Vietnamese law requires sellers to verify their identity before publishing. Your documents are checked and then deleted — we keep only the result.',
            'Theo quy định của pháp luật Việt Nam, người bán phải xác minh danh tính trước khi đăng tin. Giấy tờ của bạn được kiểm tra rồi xoá — chúng tôi chỉ lưu kết quả.',
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {lang === 'vi' ? LEGAL_BASIS.identityDecree.vi : LEGAL_BASIS.identityDecree.en}
          {' · '}
          {lang === 'vi' ? LEGAL_BASIS.ecommerceLaw.vi : LEGAL_BASIS.ecommerceLaw.en}
        </p>
      </header>

      {/* ⚠️ THE DECLARATION COMES BEFORE THE UPLOAD BUTTONS, NOT AFTER.
          Putting it after — as a confirm step on submit — means the person has already spent five
          minutes photographing a passport, and the checkbox becomes something to click past to
          avoid losing that work. Read first, then act: it is the difference between a declaration
          and a toll. */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="h-section text-foreground">{tr('Your declaration', 'Cam đoan của bạn')}</h2>
        {/* whitespace-pre-line: the text is authored as numbered lines and must render that way. */}
        <p className="whitespace-pre-line text-sm leading-relaxed text-body">{body}</p>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-muted/40 p-3">
          {/* ⚠️ NEVER PRE-CHECKED. buildDeclaration() refuses a record without explicit acceptance,
              and a pre-ticked box would make that server-side guard a formality over a UI that had
              already decided for the user. */}
          <Checkbox checked={accepted} onChange={setAccepted} className="mt-0.5 shrink-0" />
          <span className="text-sm font-medium text-foreground">
            {tr(
              'I have read the above and I confirm it is true. I accept legal responsibility for this declaration.',
              'Tôi đã đọc nội dung trên và xác nhận là đúng sự thật. Tôi chịu trách nhiệm trước pháp luật về nội dung cam đoan này.',
            )}
          </span>
        </label>
      </section>

      {/* ⚠️ NO aria-disabled HERE. A <section> has an implicit role=region, which does not support
          it — so it announces nothing while looking like an accessibility affordance. The real
          signal is on the buttons, which carry a genuine `disabled`. */}
      <section className="space-y-3">
        <h2 className="h-section text-foreground">{tr('Choose how to verify', 'Chọn cách xác minh')}</h2>

        {/* ⚠️ DISABLED, NOT HIDDEN. Hiding the options until the box is ticked leaves the page
            looking broken — a declaration with no visible consequence. Showing them greyed makes
            the causal link obvious: read, agree, then these become available. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant={tier === 'A' ? 'cta' : 'outline'}
            disabled={!accepted}
            onClick={() => setTier('A')}
            className="h-auto flex-col items-start gap-1 rounded-2xl p-4 text-left"
          >
            <span className="flex items-center gap-2 font-bold"><Fingerprint className="h-5 w-5" strokeWidth={2.25} />{tr('Vietnamese citizen', 'Công dân Việt Nam')}</span>
            <span className="text-xs font-normal opacity-80">{tr('VNeID or CCCD — about two minutes', 'VNeID hoặc CCCD — khoảng hai phút')}</span>
          </Button>
          <Button
            type="button"
            variant={tier === 'B' ? 'cta' : 'outline'}
            disabled={!accepted}
            onClick={() => setTier('B')}
            className="h-auto flex-col items-start gap-1 rounded-2xl p-4 text-left"
          >
            <span className="flex items-center gap-2 font-bold"><IdCard className="h-5 w-5" strokeWidth={2.25} />{tr('Foreign resident', 'Người nước ngoài')}</span>
            <span className="text-xs font-normal opacity-80">{tr('Passport — read on your device, not uploaded', 'Hộ chiếu — đọc trên thiết bị của bạn, không tải lên')}</span>
          </Button>
        </div>

        {/* ⚠️ SAY IT IS NOT READY YET RATHER THAN SHIP A DEAD BUTTON. The eKYC provider integration
            is still blocked on VNPT (token endpoint + write scope), so a "Continue" here would fail
            after the user had committed. Naming the state is honest and costs one paragraph; a
            button that silently does nothing costs the trust this page is asking for. */}
        {tier && (
          <Alert>
            <AlertDescription>
              {tr(
                'Verification is not switched on yet — we are completing the connection to the national eKYC provider. Your declaration is recorded and you will be emailed the moment you can finish.',
                'Tính năng xác minh chưa được bật — chúng tôi đang hoàn tất kết nối với đơn vị eKYC quốc gia. Cam đoan của bạn đã được ghi nhận và chúng tôi sẽ gửi email ngay khi bạn có thể hoàn tất.',
              )}
            </AlertDescription>
          </Alert>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        {tr(
          'Your document images are deleted once the check completes. We keep the result, the document expiry date, and a one-way fingerprint that lets us detect duplicate accounts — never the document number itself.',
          'Ảnh giấy tờ của bạn sẽ được xoá sau khi kiểm tra xong. Chúng tôi chỉ lưu kết quả, ngày hết hạn giấy tờ và một dấu vân tay một chiều để phát hiện tài khoản trùng lặp — không bao giờ lưu số giấy tờ.',
        )}
      </p>
    </div>
  )
}
