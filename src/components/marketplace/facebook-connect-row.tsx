'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { facebookAvailableHere } from '@/lib/facebook-signin'

type Status = { on: boolean; connected: boolean; canDisconnect: boolean }

/**
 * Settings › Privacy › Facebook (owner, 2026-11-04): an account made another way adds Facebook as a second way in, and
 * both keep working. The flow and why it is not GoTrue's: src/lib/auth/facebook-connect.ts.
 *
 * ⛔ A CODE FROM THE ACCOUNT'S OWN MAILBOX COMES FIRST: someone holding a stolen session must not be able to add a lasting way in.
 * /auth/facebook/connect/start refuses a session that hasn't confirmed this flow's own code (facebook-connect.ts FB_OK_COOKIE).
 *
 * Connect shows only where it can run: never in the eno apps (facebookAvailableHere: Meta's dialog does not run in a webview), and
 * not while the server has it off. Disconnect shows for anyone connected.
 */
export function FacebookConnectRow() {
  const { tr, lang } = useLanguage()
  const { user } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const [status, setStatus] = useState<Status | null>(null)
  const [canConnectHere, setCanConnectHere] = useState(false)
  const [open, setOpen] = useState(false)
  // What the code in the dialog will do once it's confirmed.
  const [action, setAction] = useState<'connect' | 'disconnect'>('connect')
  const [code, setCode] = useState('')
  const [codeLength, setCodeLength] = useState(6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastTried = useRef('')

  const outcome = params.get('fb')
  useEffect(() => {
    if (!outcome) return
    const said: Record<string, [string, string] | undefined> = {
      connected: [tr('Facebook connected. You can now sign in with it too.', 'Đã kết nối Facebook. Giờ bạn cũng có thể đăng nhập bằng Facebook.'), 'success'],
      no_email: [tr('Facebook didn’t share an email address, so it can’t be used to sign in here. Allow email when Facebook asks, or add one to your Facebook account.', 'Facebook không chia sẻ địa chỉ email nên không thể dùng để đăng nhập ở đây. Hãy cho phép email khi Facebook hỏi, hoặc thêm email vào tài khoản Facebook của bạn.'), 'error'],
      held: [tr('That Facebook account already belongs to another eno account.', 'Tài khoản Facebook này đã thuộc về một tài khoản eno khác.'), 'error'],
      other: [tr('This account already has a different Facebook connected. Disconnect it first.', 'Tài khoản này đã kết nối với một Facebook khác. Hãy ngắt kết nối trước.'), 'error'],
      refused: [tr('Facebook can’t be connected to this account.', 'Không thể kết nối Facebook với tài khoản này.'), 'error'],
      expired: [tr('Enter a new code to connect Facebook.', 'Hãy nhập mã mới để kết nối Facebook.'), 'error'],
      failed: [tr('Facebook didn’t connect. Please try again.', 'Chưa kết nối được Facebook. Vui lòng thử lại.'), 'error'],
    }
    const s = said[outcome]
    if (s?.[1] === 'success') toast.success(s[0])
    else if (s) toast.error(s[0])
    // One toast, then a clean address: a reload must not repeat it.
    const next = new URLSearchParams(params.toString())
    next.delete('fb')
    router.replace(`?${next.toString()}`, { scroll: false })
    // Once per outcome: tr and params change identity on every render.
  }, [outcome])

  const userId = user?.id
  useEffect(() => {
    // Another account's row must not outlive the account (commit gate, codex): nothing shows until this one's answer arrives.
    setStatus(null); setOpen(false); setCode(''); setError(null); lastTried.current = ''
    if (!userId) return
    setCanConnectHere(facebookAvailableHere())
    let off = false
    fetch('/api/auth/facebook/connect', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then((d) => { if (!off && d) setStatus(d) })
      .catch(() => {})
    return () => { off = true }
    // `outcome`: a just-connected return re-reads the row.
  }, [userId, outcome])

  // ⛔ DISCONNECT WORKS EVERYWHERE, CONNECT ONLY WHERE META'S DIALOG RUNS (commit gate, codex + opus): the notice mail sends someone
  // whose code was phished here to disconnect, and they may be reading it in the eno app.
  if (!status || !user?.email || (!status.connected && !(status.on && canConnectHere))) return null

  const sendCode = async (next: 'connect' | 'disconnect') => {
    setAction(next)
    setBusy(true); setError(null); setCode(''); lastTried.current = ''
    try {
      const r = await fetch('/api/auth/facebook/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) })
      if (!r.ok) throw new Error(String(r.status))
      const d = (await r.json()) as { codeLength?: number }
      if (typeof d.codeLength === 'number') setCodeLength(d.codeLength)
      setOpen(true)
    } catch {
      toast.error(tr('We couldn’t send the code. Please try again in a moment.', 'Không gửi được mã. Vui lòng thử lại sau ít phút.'))
    }
    setBusy(false)
  }

  const verify = async (c: string) => {
    if (busy || c === lastTried.current) return
    lastTried.current = c
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/auth/facebook/connect/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) })
      if (!r.ok) throw new Error(String(r.status))
      if (action === 'connect') {
        // A full navigation: the start route reads the confirmation cookie and leaves for Facebook.
        window.location.assign('/auth/facebook/connect/start')
        return
      }
    } catch {
      setError(tr('That code didn’t work. Check it, or ask for a new one.', 'Mã không đúng. Hãy kiểm tra lại hoặc yêu cầu mã mới.'))
      lastTried.current = ''
      setBusy(false)
      return
    }
    try {
      const r = await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
      if (!r.ok) throw new Error(String(r.status))
      const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
      await createSupabaseBrowser().auth.refreshSession().catch(() => {})
      setStatus({ on: status!.on, connected: false, canDisconnect: false })
      toast.success(tr('Facebook disconnected.', 'Đã ngắt kết nối Facebook.'))
    } catch {
      toast.error(tr('Facebook didn’t disconnect. Please try again.', 'Chưa ngắt kết nối được Facebook. Vui lòng thử lại.'))
    }
    setOpen(false)
    setBusy(false)
  }

  return (
    <section className="mt-6 border-t border-border pt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-4">Facebook</h2>
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="min-w-0 text-sm text-body">
          {status.connected
            ? tr('Connected. You can sign in with Facebook or the way you do now.', 'Đã kết nối. Bạn có thể đăng nhập bằng Facebook hoặc theo cách hiện tại.')
            : tr('Connect Facebook to sign in with it too. Your current way of signing in keeps working.', 'Kết nối Facebook để đăng nhập bằng cả Facebook. Cách đăng nhập hiện tại vẫn dùng được.')}
        </p>
        {!status.connected && (
          <Button variant="outline" size="sm" className="shrink-0" loading={busy} onClick={() => void sendCode('connect')}>
            {tr('Connect', 'Kết nối')}
          </Button>
        )}
        {status.canDisconnect && (
          <Button variant="outline" size="sm" className="shrink-0" loading={busy} onClick={() => void sendCode('disconnect')}>
            {tr('Disconnect', 'Ngắt kết nối')}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr('Confirm it’s you', 'Xác nhận đó là bạn')}</DialogTitle>
            <DialogDescription>
              {tr('Enter the code we sent to', 'Nhập mã chúng tôi đã gửi đến')} {user.email}
            </DialogDescription>
          </DialogHeader>
          <InputOTP maxLength={codeLength} value={code} onChange={setCode} onComplete={(v: string) => void verify(v)} autoFocus autoComplete="one-time-code" inputMode="numeric" disabled={busy}>
            <InputOTPGroup>
              {Array.from({ length: codeLength }, (_, i) => <InputOTPSlot key={i} index={i} className={`h-12 ${codeLength > 6 ? 'w-8' : 'w-10'} text-base font-semibold`} />)}
            </InputOTPGroup>
          </InputOTP>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button variant="ghost" size="sm" className="self-start" disabled={busy} onClick={() => void sendCode(action)}>
            {tr('Send a new code', 'Gửi mã mới')}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
