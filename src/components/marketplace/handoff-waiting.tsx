'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/context/language-context'
import { safeNextPath } from '@/lib/url'
import { HANDOFF_NEXT_KEY, PAIR_LEN, normalizePairInput } from '@/lib/auth/handoff-client'

// The waiting room, in the context that escaped to the real browser.
//
// ⚠️ IT MUST RESUME FROM A COLD START. Mobile OSes routinely kill a backgrounded webview or PWA
// while the browser is in front, so this cannot assume it has been alive throughout. Everything it
// needs is durable: the nonce is an httpOnly cookie (handed in by the server component) and `next`
// is in localStorage, so a visitor returning to a relaunched app lands here and simply resumes.
//
// ⚠️ AND IT MUST NEVER BECOME AN INDEFINITE SPINNER. Every terminal state resolves to a screen with
// a way forward, because email and phone sign-in work perfectly well right here.

const DEADLINE_MS = 15 * 60_000
const POLL_MS = 2_500

type Phase = 'waiting' | 'pair' | 'exchanging' | 'expired' | 'failed'

export function HandoffWaiting({ nonce }: { nonce: string }) {
  const router = useRouter()
  const { tr } = useLanguage()
  const [phase, setPhase] = useState<Phase>('waiting')
  const [pair, setPair] = useState('')
  const [pairError, setPairError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const startedAt = useRef(Date.now())
  const settled = useRef(false)

  const finish = useCallback(async (code: string) => {
    if (settled.current) return
    settled.current = true
    setPhase('exchanging')
    try {
      const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
      // ⚠️ The line the whole design exists to make possible: the exchange happens HERE, in the jar
      // that holds the PKCE verifier, so the session lands where the visitor started.
      const { error } = await createSupabaseBrowser().auth.exchangeCodeForSession(code)
      if (error) { setPhase('pair'); setPairError(tr('Could not finish sign-in. Try the code again.', 'Chưa hoàn tất đăng nhập. Thử lại mã nhé.')); settled.current = false; return }
      let next = '/'
      try { next = safeNextPath(localStorage.getItem(HANDOFF_NEXT_KEY), window.location.origin) || '/' } catch { /* private mode */ }
      try { localStorage.removeItem(HANDOFF_NEXT_KEY) } catch { /* ignore */ }
      router.replace(next)
      router.refresh()
    } catch {
      setPhase('pair'); settled.current = false
    }
  }, [router, tr])

  // Poll for STATE only. This endpoint cannot return a code — see the note in its route.
  //
  // ⚠️ IT KEEPS POLLING WHILE THE PAIR INPUT IS UP, not just while waiting. It used to stop the
  // moment the input appeared, so if the visitor answered "No — that wasn't me" in the browser, or
  // the handoff was voided or expired, the app went on cheerfully accepting a code that could never
  // work. Flagged by both external reviewers. 'gone'/'void' now surface immediately.
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'pair') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const poll = async () => {
      if (stopped) return
      if (Date.now() - startedAt.current > DEADLINE_MS) { setPhase('expired'); return }
      try {
        const res = await fetch('/api/auth/handoff/claim', { method: 'POST', cache: 'no-store' })
        const j = (await res.json()) as { state?: string }
        // ⚠️ Only ADVANCE to the pair screen; never bounce back off it. handoffState reports a
        // synthetic 'awaiting_consent' once the pair has expired, and treating that as "go back"
        // would yank the input away from someone mid-type — they get the precise 'expired' message
        // from /redeem instead, which tells them what to do.
        if (j.state === 'awaiting_pair' && phase === 'waiting') { setPhase('pair'); return }
        if (j.state === 'gone' || j.state === 'void') { setPhase('expired'); return }
      } catch { /* offline mid-switch is normal */ }
      if (!stopped) timer = setTimeout(poll, POLL_MS)
    }

    // ⚠️ VISIBILITY IS THE PRIMARY TRIGGER — the moment that matters is the visitor switching back.
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    void poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [phase])

  const submitPair = async () => {
    if (busy) return
    setBusy(true); setPairError(null)
    try {
      const res = await fetch('/api/auth/handoff/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: normalizePairInput(pair) }),
      })
      const j = (await res.json()) as { ok?: boolean; code?: string; reason?: string }
      if (j.ok && j.code) { await finish(j.code); return }
      if (j.reason === 'exhausted') setPairError(tr('Too many tries. Get a fresh code in your browser.', 'Sai quá nhiều lần. Lấy mã mới trong trình duyệt nhé.'))
      else if (j.reason === 'expired') setPairError(tr('That code expired. Get a fresh one in your browser.', 'Mã đã hết hạn. Lấy mã mới trong trình duyệt nhé.'))
      else if (j.reason === 'gone') setPhase('expired')
      else setPairError(tr('That code is not right.', 'Mã không đúng.'))
    } catch {
      setPairError(tr('Connection problem — try again.', 'Sự cố kết nối — thử lại.'))
    } finally { setBusy(false) }
  }

  const useEmail = () => router.replace('/signin')

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {(phase === 'waiting' || phase === 'exchanging') && (
        <>
          {/* h-6 + accent ink = the app-wide page-wait spinner (onboard, disputes, appeals,
              reports all use it) — size-7 gray was this flow's private dialect. */}
          <Loader2 className="h-6 w-6 animate-spin text-accent-foreground" aria-hidden />
          <h1 className="mt-4 text-lg font-extrabold tracking-tight text-foreground">
            {phase === 'exchanging' ? tr('Signing you in…', 'Đang đăng nhập…') : tr('Finish in your browser', 'Hoàn tất trong trình duyệt')}
          </h1>
          {phase === 'waiting' && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {tr('Sign in with Google in the browser that just opened. It will show you a short code to type here.', 'Đăng nhập Google ở trình duyệt vừa mở. Trình duyệt sẽ hiện một mã ngắn để bạn nhập vào đây.')}
              </p>
              {/* The manual escape — the only route on iOS when window.open is swallowed. Opening
                  THIS url in Safari resumes the same flow rather than starting a second one. */}
              <p className="mt-5 text-xs leading-relaxed text-ink-4">
                {tr('Nothing opened? Tap ••• at the top and choose “Open in Safari”.', 'Không có gì mở ra? Chạm ••• ở trên rồi chọn “Mở trong Safari”.')}
              </p>
            </>
          )}
        </>
      )}

      {phase === 'pair' && (
        <>
          <h1 className="text-lg font-extrabold tracking-tight text-foreground">
            {tr('Enter the code from your browser', 'Nhập mã từ trình duyệt')}
          </h1>
          <Input
            value={pair}
            onChange={(e) => setPair(e.target.value.toUpperCase().slice(0, PAIR_LEN + 2))}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            inputMode="text" enterKeyHint="go"
            onKeyDown={(e) => { if (e.key === 'Enter') void submitPair() }}
            className="mt-4 text-center font-mono text-2xl font-extrabold tracking-[0.25em]"
            aria-label={tr('Code from your browser', 'Mã từ trình duyệt')}
          />
          {pairError && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{pairError}</p>}
          <Button variant="cta" size="none" type="button" disabled={busy || pair.length < PAIR_LEN} onClick={() => void submitPair()} className="mt-4 w-full py-3">
            {busy ? <Loader2 className="size-4 animate-spin" /> : tr('Sign in', 'Đăng nhập')}
          </Button>
        </>
      )}

      {phase === 'expired' && (
        <>
          <h1 className="text-lg font-extrabold tracking-tight text-foreground">{tr('That took too long', 'Quá thời gian chờ')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {tr('The sign-in expired before it was finished. Use email or phone — they work right here without leaving the app.', 'Lượt đăng nhập đã hết hạn. Dùng email hoặc SĐT — vẫn hoạt động ngay trong ứng dụng.')}
          </p>
          <Button variant="cta" size="none" type="button" onClick={useEmail} className="mt-5 w-full py-3">
            {tr('Use email or phone', 'Dùng email hoặc SĐT')}
          </Button>
        </>
      )}

      {/* ⚠️ Always one tap away, in every phase — email and phone genuinely work in this context. */}
      {phase !== 'expired' && (
        <Button variant="bare" size="none" type="button" onClick={useEmail} className="mt-6 text-xs font-semibold text-ink-4 hover:text-foreground">
          {tr('Cancel and use email or phone', 'Huỷ và dùng email hoặc SĐT')}
        </Button>
      )}
    </div>
  )
}
