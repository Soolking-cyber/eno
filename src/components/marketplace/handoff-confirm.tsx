'use client'

import { useState } from 'react'
import { CheckCircle2, AlertCircle, Copy, Check } from '@/components/ui/icons'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

/** Status coin — ui/empty-state's chrome-coin recipe, exactly as §6 writes it:
 *  bg-brand-50 disc, h-8 glyph at the display stroke, line in the brand ink.
 *  Replaces bare size-9 icons floating on the canvas (36px is off the §4 ladder,
 *  and stroke 2 at that size renders ~3px — the rubber-stamp look §2 exists to kill).
 *  ⚠️ The first cut tinted the disc with status colours (bg-warning/10, bg-success/10)
 *  — a SECOND hue family inside an icon moment, which §0/§6's one-blue rule never
 *  grants, and the R2 critic cited the terracotta coin as drift precedent. These
 *  phases are calm, informational states (a question, an expired link, a confirmed
 *  cancellation — nothing is broken and nothing is lost), so they take the one
 *  sanctioned coin; status ink stays reserved for genuinely destructive moments. */
function StatusCoin({ icon: Icon }: { icon: typeof CheckCircle2 }) {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand">
      <Icon className="h-8 w-8" strokeWidth={STROKE_DISPLAY} aria-hidden />
    </span>
  )
}

/**
 * The REAL BROWSER, after Google. Two jobs: get a yes/no that this sign-in was actually started by
 * this person, and hand them the pairing code to carry back to the app.
 *
 * ⚠️ THE CODE IS SHOWN HERE AND NOWHERE ELSE, AND THAT IS THE ENTIRE SECURITY DESIGN. The first
 * version of this feature was an account takeover: an attacker opened a handoff, sent the victim
 * the link, and claimed the victim's authorization code. Moving the pairing code to THIS screen —
 * the victim's own — is what kills it, because the attacker's app never sees it.
 *
 * ⚠️ NO DEVICE OR CITY LINE IN THE QUESTION. It is tempting to add "from a Samsung in Hanoi?" for
 * confidence, but IP geolocation on Vietnamese mobile is routinely a different province, and an
 * honest visitor who sees a wrong city answers "no" and destroys their own sign-in.
 */
export function HandoffConfirm({ nonce, parked }: { nonce: string | null; parked: boolean }) {
  const { tr } = useLanguage()
  const [phase, setPhase] = useState<'ask' | 'pair' | 'voided' | 'gone'>(parked && nonce ? 'ask' : 'gone')
  const [pair, setPair] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const answer = async (agreed: boolean) => {
    if (!nonce || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/auth/handoff/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, agreed }),
      })
      const j = (await res.json()) as { ok?: boolean; pair?: string }
      if (!agreed) { setPhase('voided'); return }
      if (j.ok && j.pair) { setPair(j.pair); setPhase('pair') } else setPhase('gone')
    } catch {
      setPhase('gone')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(pair); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* no clipboard */ }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {phase === 'ask' && (
        <>
          <StatusCoin icon={CheckCircle2} />
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-foreground">
            {tr('Almost there', 'Sắp xong rồi')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {tr('Did you just tap “Continue with Google” in the eno app on this phone?', 'Bạn vừa chạm “Tiếp tục với Google” trong ứng dụng eno trên điện thoại này phải không?')}
          </p>
          <div className="mt-5 flex w-full flex-col gap-2">
            <Button variant="cta" size="none" type="button" disabled={busy} onClick={() => answer(true)} className="w-full py-3">
              {tr('Yes, that was me', 'Đúng, là tôi')}
            </Button>
            <Button variant="soft" size="none" type="button" disabled={busy} onClick={() => answer(false)} className="w-full py-2.5 font-bold">
              {tr('No — I did not', 'Không phải tôi')}
            </Button>
          </div>
        </>
      )}

      {phase === 'pair' && (
        <>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            {tr('Enter this code in the eno app', 'Nhập mã này trong ứng dụng eno')}
          </h1>
          <div className="mt-5 rounded-2xl border border-line-strong bg-card px-6 py-4">
            <span className="font-mono text-3xl font-extrabold tracking-[0.3em] text-foreground">{pair}</span>
          </div>
          {/* No margins on the svgs (icon-language §3) — ui/button's base gap-2 spaces them.
              bubble-in on the Check = the canon's state-flip entrance (§8). */}
          <Button variant="soft" size="none" type="button" onClick={copy} className="mt-3 px-4 py-2 font-bold">
            {copied ? <><Check className="size-4 bubble-in" />{tr('Copied', 'Đã sao chép')}</> : <><Copy className="size-4" />{tr('Copy', 'Sao chép')}</>}
          </Button>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {tr('Switch back to the eno app and type it in. The code lasts 5 minutes.', 'Quay lại ứng dụng eno và nhập mã. Mã có hiệu lực 5 phút.')}
          </p>
          {/* ⚠️ THE WAY OUT OF AN EXPIRED CODE, AND WITHOUT IT THIS SCREEN IS A DEAD END. The pair
              lasts 5 minutes and the app's own error text says "get a fresh one in your browser" —
              but the browser had no control that could produce one, so the visitor's only option was
              to start the entire sign-in again. Both external reviewers flagged the wedge.
              It re-runs the same consent call: consentAndMintPair() accepts an 'awaiting_pair' row
              whose pair has expired (and the exhaustion path resets the row to 'awaiting_consent'),
              so this mints a genuinely new code in both dead states. */}
          <Button variant="soft" size="none" type="button" disabled={busy} onClick={() => answer(true)} className="mt-3 px-4 py-2 text-sm font-bold text-accent-foreground">
            {busy
              ? tr('Getting a new code…', 'Đang lấy mã mới…')
              : tr('Code expired? Get a new one', 'Mã hết hạn? Lấy mã mới')}
          </Button>
          {/* ⚠️ The anti-phishing line. A code a human carries between screens can always be talked
              out of them; saying this plainly is the only mitigation that scales. */}
          <p className="mt-4 text-xs font-semibold text-ink-4">
            {tr('eno will never ask you for this code by phone, chat or email.', 'eno sẽ không bao giờ hỏi mã này qua điện thoại, tin nhắn hay email.')}
          </p>
        </>
      )}

      {phase === 'voided' && (
        <>
          <StatusCoin icon={AlertCircle} />
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-foreground">
            {tr('Cancelled — nothing was signed in', 'Đã huỷ — không có đăng nhập nào')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {tr('Thanks for telling us. That sign-in has been thrown away and nobody was given access.', 'Cảm ơn bạn đã cho biết. Lượt đăng nhập đó đã bị huỷ và không ai được cấp quyền truy cập.')}
          </p>
        </>
      )}

      {phase === 'gone' && (
        <>
          <StatusCoin icon={AlertCircle} />
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-foreground">
            {tr('This sign-in link has expired', 'Liên kết đăng nhập đã hết hạn')}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {tr('Go back to the eno app and tap Continue with Google again — or use email or phone, which work without leaving it.', 'Quay lại ứng dụng eno và chạm Tiếp tục với Google lần nữa — hoặc dùng email/SĐT, không cần rời ứng dụng.')}
          </p>
        </>
      )}
    </div>
  )
}
