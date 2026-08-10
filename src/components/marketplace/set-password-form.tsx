'use client'

import { useState } from 'react'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'

// Set-a-password, under account Settings.
//
// ⚠️ THIS IS THE ONLY PLACE A PASSWORD CAN BE CREATED, AND THAT IS THE SECURITY DESIGN, NOT
// A UI CHOICE (owner decision 2026-08-10). A password can only be set from inside an
// already-authenticated session, i.e. after the visitor proved control of the identity via
// a magic link, an emailed code, a phone OTP or Google. There is deliberately NO
// "sign up with a password" form anywhere in this app.
//
// The class that buys off is account pre-hijacking: an attacker registers victim@example.com
// with a password BEFORE the real owner ever arrives, the real owner later signs in with a
// magic link — which confirms the address — and the attacker's password is now live on a
// confirmed account. Requiring an existing session to set a password means the attacker
// would already have had to be the user.
//
// ⚠️ WHAT THIS FILE CANNOT DO ALONE. Supabase's own /auth/v1/signup endpoint is reachable
// with the public anon key regardless of what this app renders, so omitting the UI does not
// by itself close that hole — measured 2026-08-10: disable_signup=false, external.email=true
// on this project, with Turnstile enforced in front. Closing it fully is a dashboard change,
// not a code one. Do not read this component as proof the class is shut.
//
// NO PASSWORD IS EVER SENT TO OUR OWN SERVER HERE. updateUser() goes straight to Supabase
// over TLS from the browser; the sign-IN path is the opposite (see api/auth/password) because
// that one needs our rate limits and a uniform error, neither of which applies to a caller
// who is already authenticated.

/** Supabase enforces its own policy server-side; this is the floor we can state up front. */
const MIN_LENGTH = 8
/**
 * ⚠️ MUST MATCH MAX_PASSWORD IN api/auth/password/route.ts. A reviewer found the asymmetry:
 * this form had only a minimum, so a 250-character passphrase saved happily to Supabase — and
 * then the sign-in route, which caps the body at 200 to keep a megabyte from reaching bcrypt,
 * rejected it with `invalid_request` forever. A password you can set but can never use is the
 * worst of both, and the user has no way to discover why.
 */
const MAX_LENGTH = 200

export function SetPasswordForm({ signInEnabled = false }: {
  /** True only for official-partner accounts — the ones api/auth/password will actually admit.
   *  It changes the COPY, never whether this form renders: see the note at the call site for why
   *  hiding it from everyone else was a security mistake rather than a tidy-up. */
  signInEnabled?: boolean
}) {
  const { tr } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // Same split as ChangeEmailForm: `fieldErr` is about the VALUE in a box and is bound to the
  // control so it announces as invalid; `err` is what Supabase said about the ATTEMPT and is
  // announced with role="alert" instead of describing an input.
  const [err, setErr] = useState('')
  const [fieldErr, setFieldErr] = useState('')

  const submit = async () => {
    setErr(''); setFieldErr('')
    if (password.length < MIN_LENGTH) {
      // ⚠️ STATIC STRINGS. gen-ui-strings.mjs harvests tr() call sites by STATIC analysis, so
      // a template literal is invisible to it and the Vietnamese half never reaches the
      // dictionary. I warned about exactly this in sign-in-form.tsx and then did it here in
      // the same change; a reviewer proved it by noting these strings were absent from the
      // regenerated ui-strings.ts in the diff. The number is interpolated OUTSIDE tr().
      setFieldErr(`${tr('Use at least', 'Dùng ít nhất')} ${MIN_LENGTH} ${tr('characters.', 'ký tự.')}`)
      return
    }
    if (password.length > MAX_LENGTH) {
      setFieldErr(`${tr('Use at most', 'Dùng tối đa')} ${MAX_LENGTH} ${tr('characters.', 'ký tự.')}`)
      return
    }
    if (password !== confirm) {
      setFieldErr(tr('The two passwords do not match.', 'Hai mật khẩu không khớp.'))
      return
    }
    setBusy(true)
    try {
      // Loaded on demand — supabase-js is ~248 KB and this is a rarely-used corner of
      // Settings, so it must not sit in the route's first-load bundle.
      const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
      const supabase = createSupabaseBrowser()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        // ⚠️ NEVER RENDER error.message — IT IS ENGLISH, ALWAYS. A reviewer caught the first
        // version passing Supabase's string straight through, which puts raw English in front
        // of Vietnamese users on the one screen where they most need to understand what to
        // change. GoTrue is not localised and never will be by us, so its text is only ever
        // a SIGNAL for choosing one of our own translated strings.
        //
        // This project enforces a password-complexity policy (recorded in api/auth/email-link,
        // where a generateLink({type:'signup'}) call supplying a random password came back
        // `weak_password`). The exact rules live in the Supabase dashboard where this component
        // cannot read them, so the message states the floor we do know and points at the rest.
        //
        // ⚠️ Match on error.code FIRST and only fall back to the message. The earlier
        // /password/i test on the message was far too loose — a reviewer noted it swallows any
        // unrelated failure whose text merely contains the word "password", showing "too weak"
        // for something the user cannot fix by choosing a better one.
        const weak = error.code === 'weak_password' || /weak|at least|too short|characters/i.test(error.message || '')
        const stale = error.code === 'reauthentication_needed' || /reauth|recent login|session/i.test(error.message || '')
        if (weak) {
          setFieldErr(tr('That password is too easy to guess. Try a longer one, or add a few unrelated words.', 'Mật khẩu quá dễ đoán. Hãy dùng mật khẩu dài hơn, hoặc thêm vài từ không liên quan.'))
        } else {
          // A session too old for a credential change is the other realistic failure, and it
          // has a specific fix the user can act on: sign in again, then retry.
          setErr(stale
            ? tr('For your security, sign in again and then set your password.', 'Vì lý do bảo mật, hãy đăng nhập lại rồi đặt mật khẩu.')
            : tr('Could not save the password. Try again.', 'Không thể lưu mật khẩu. Thử lại.'))
        }
      } else {
        setDone(true)
        setPassword(''); setConfirm('')
      }
    } catch {
      setErr(tr('Could not save the password. Try again.', 'Không thể lưu mật khẩu. Thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* ⚠️ NEUTRAL COPY, ON PURPOSE. Supabase exposes no reliable "does this account have a
          password?" signal to the client — a magic-link account and a password account both
          carry an `email` identity — so this must read correctly whether the visitor is
          setting their first password or replacing one. "Set a password" would be wrong for
          half of them and "Change password" wrong for the other half. */}
      <p className="text-sm font-semibold text-foreground">{tr('Password sign-in', 'Đăng nhập bằng mật khẩu')}</p>

      {done ? (
        <>
          <p className="text-xs font-semibold text-success">
            {signInEnabled
            ? tr('Password saved. You can now sign in with it — codes and links keep working too.', 'Đã lưu mật khẩu. Bạn có thể đăng nhập bằng mật khẩu — mã và liên kết vẫn dùng được.')
            : tr('Password saved. Sign in still uses a code or link.', 'Đã lưu mật khẩu. Đăng nhập vẫn dùng mã hoặc liên kết.')}
          </p>
          {/* ⚠️ THE SUCCESS STATE NEEDS A WAY OUT. `done` was terminal: after one save this
              section rendered only the confirmation for the rest of the session, so a user who
              set a password and immediately wanted to change it — the exact thing someone does
              after a mistyped-but-confirmed password, or after sharing a device — had to
              reload the page to reach the form again. A reviewer caught it; `editing` was
              stranded true underneath, too. */}
          <Button
            variant="link"
            size="none"
            onClick={() => { setDone(false); setEditing(false); setPassword(''); setConfirm(''); setErr(''); setFieldErr('') }}
            className="text-xs font-bold text-accent-foreground"
          >
            {tr('Change it again', 'Đổi lại')}
          </Button>
        </>
      ) : !editing ? (
        <>
          <p className="text-xs text-body">
            {signInEnabled
              ? tr('Optional. Add a password to sign in without waiting for a code.', 'Tùy chọn. Thêm mật khẩu để đăng nhập mà không cần chờ mã.')
              // ⚠️ HONEST, AND IT DOES NOT ALARM. A non-partner is told plainly that a password
              // will not change how they sign in, so nobody sets one expecting a faster login.
              // It stops short of "someone may have set one for you" — true in principle, but a
              // sentence that would frighten every reader to describe a case almost none of them
              // are in. Setting one here replaces whatever is on the account either way.
              : tr('Password sign-in is for partner accounts. You can still set one here — it secures your account, but sign-in keeps using a code or link.', 'Đăng nhập bằng mật khẩu dành cho tài khoản đối tác. Bạn vẫn có thể đặt mật khẩu — để bảo mật tài khoản, nhưng đăng nhập vẫn dùng mã hoặc liên kết.')}
          </p>
          <Button
            variant="link"
            size="none"
            onClick={() => { setPassword(''); setConfirm(''); setErr(''); setFieldErr(''); setEditing(true) }}
            className="text-xs font-bold text-accent-foreground"
          >
            {tr('Set a password', 'Đặt mật khẩu')}
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="max-w-md space-y-3">
            <Field invalid={!!fieldErr} className="gap-1.5">
              <FieldLabel render={<Label />}>{tr('New password', 'Mật khẩu mới')}</FieldLabel>
              <div className="relative">
                <FieldControl id="set-password-input"
                  render={
                    <Input
                      id="set-password-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={reveal ? 'text' : 'password'}
                      autoComplete="new-password"
                      className="pr-11"
                      placeholder={tr('New password', 'Mật khẩu mới')}
                    />
                  }
                />
                {/* A reveal toggle is an accessibility feature, not a convenience: it is what
                    lets someone using a screen magnifier or a phone keyboard confirm a long
                    password without retyping it. tabIndex -1 keeps it out of the tab order
                    between the two fields; it is reachable and labelled for AT regardless. */}
                <Button
                  type="button"
                  variant="bare"
                  size="none"
                  tabIndex={-1}
                  aria-label={reveal ? tr('Hide password', 'Ẩn mật khẩu') : tr('Show password', 'Hiện mật khẩu')}
                  onClick={() => setReveal((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {reveal ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </Button>
              </div>
              <FieldDescription className="text-muted-foreground">
                {tr('At least', 'Ít nhất')} {MIN_LENGTH} {tr('characters. Longer is stronger than complicated.', 'ký tự. Dài quan trọng hơn phức tạp.')}
              </FieldDescription>
              {fieldErr && <FieldError className="font-semibold">{fieldErr}</FieldError>}
            </Field>

            <Field className="gap-1.5">
              <FieldLabel render={<Label />}>{tr('Confirm password', 'Xác nhận mật khẩu')}</FieldLabel>
              <FieldControl id="confirm-password-input"
                render={
                  <Input
                    id="confirm-password-input"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    type={reveal ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={tr('Confirm password', 'Xác nhận mật khẩu')}
                  />
                }
              />
            </Field>

            {err && <p role="alert" className="text-xs font-semibold text-destructive">{err}</p>}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="cta"
              size="none"
              onClick={submit}
              disabled={busy || !password || !confirm}
              className="gap-1.5 px-5 py-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {tr('Save password', 'Lưu mật khẩu')}
            </Button>
            <Button
              variant="ghost"
              size="none"
              onClick={() => { setEditing(false); setErr(''); setFieldErr(''); setPassword(''); setConfirm('') }}
              className="px-3 py-2 font-bold text-body hover:bg-transparent hover:text-foreground"
            >
              {tr('Cancel', 'Hủy')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
