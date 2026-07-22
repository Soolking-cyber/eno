import { renderBrandEmail, esc, EMAIL } from './layout'
import type { SignInMode } from './sign-in-link'

// The sign-in CODE email — what the native apps get instead of a magic link.
//
// WHY A CODE EXISTS AT ALL. A link opens in the system browser. Inside the Capacitor
// WebView or the SwiftUI app's embedded tabs that means the session cookie is written to
// Safari's jar and the user returns to the app still logged out. Universal Links cannot
// rescue it either: /auth/* is deliberately excluded from the AASA path allowlist, because
// an auth flow has to finish in the browser that began it. A code doesn't care which app
// you are in — you read it and type it, exactly like the phone OTP that already works.
//
// ⚠️ ONE TOKEN PER EMAIL — NEVER BOTH. The link and the code are two representations of
// the SAME GoTrue token, measured 2026-07-22: after consuming `hashed_token`, the
// `email_otp` from that same mint immediately returned `otp_expired`. So an email carrying
// both is a self-inflicted denial of service — a corporate mail scanner that pre-fetches
// the link burns the code before the user has finished typing it. That is why this is a
// separate renderer with NO url parameter and no link anywhere in its output, rather than
// an extra block bolted onto sign-in-link.ts. A vitest asserts neither email leaks the
// other's token.
//
// ⚠️ The code is an 8-digit STRING with meaningful leading zeros (observed: 00730251).
// Never round-trip it through Number().

const { INK, MUTED } = EMAIL

type Lang = 'en' | 'vi'

const COPY = {
  signin: {
    en: {
      subject: 'Your eno.vn sign-in code',
      preheader: 'Enter this code in the app. It expires in one hour.',
      heading: 'Your sign-in code',
      body: 'Enter this code in the eno.vn app to finish signing in.',
      ignore: 'If you didn’t request it, you can safely ignore this email — nobody can sign in without the code.',
    },
    vi: {
      subject: 'Mã đăng nhập eno.vn của bạn',
      preheader: 'Nhập mã này trong ứng dụng. Mã hết hạn sau một giờ.',
      heading: 'Mã đăng nhập của bạn',
      body: 'Nhập mã này trong ứng dụng eno.vn để hoàn tất đăng nhập.',
      ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này — không ai đăng nhập được nếu không có mã.',
    },
  },
  signup: {
    en: {
      subject: 'Confirm your email to create your eno.vn account',
      preheader: 'This address has no eno.vn account yet — enter the code to create one.',
      heading: 'Create your eno.vn account',
      body: 'This address doesn’t have an eno.vn account yet. Enter this code in the app to confirm it and finish creating one.',
      ignore: 'If you didn’t request this, ignore this email — the account stays unconfirmed and cannot be used by anyone.',
    },
    vi: {
      subject: 'Xác nhận email để tạo tài khoản eno.vn',
      preheader: 'Địa chỉ này chưa có tài khoản eno.vn — nhập mã để tạo mới.',
      heading: 'Tạo tài khoản eno.vn',
      body: 'Địa chỉ này chưa có tài khoản eno.vn. Nhập mã này trong ứng dụng để xác nhận và hoàn tất việc tạo tài khoản.',
      ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này — tài khoản sẽ không được xác nhận và không ai dùng được.',
    },
  },
} as const

const SHARED = {
  en: {
    forAddress: 'This was sent to',
    expiry: 'This code works once and expires in one hour.',
    // A code can be read aloud to an attacker on the phone; a link cannot. Every bank and
    // exchange carries this line for exactly that reason.
    phishing: 'eno.vn will never ask you for this code. Never share it with anyone.',
  },
  vi: {
    forAddress: 'Email này được gửi tới',
    expiry: 'Mã chỉ dùng được một lần và hết hạn sau một giờ.',
    phishing: 'eno.vn sẽ không bao giờ hỏi bạn mã này. Đừng chia sẻ mã với bất kỳ ai.',
  },
} as const

export function renderSignInCodeEmail(opts: {
  code: string
  origin: string
  /** Echoed in the body so a mistyped address is visible before it costs anything. */
  email: string
  lang?: Lang
  mode?: SignInMode
}): { subject: string; html: string; text: string } {
  const lang: Lang = opts.lang === 'vi' ? 'vi' : 'en'
  const mode: SignInMode = opts.mode === 'signup' ? 'signup' : 'signin'
  const c = COPY[mode][lang]
  const s = SHARED[lang]
  const { code, origin, email } = opts

  const bodyHtml = `
      <tr><td style="padding:8px 24px 0;">
        <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(c.heading)}</h1>
        <p style="margin:0;font-size:15px;color:${INK};line-height:1.6;">${esc(c.body)}</p>
        <p style="margin:10px 0 0;font-size:13px;color:${MUTED};line-height:1.6;">${esc(s.forAddress)} <strong style="color:${INK};">${esc(email)}</strong></p>
      </td></tr>
      <tr><td align="center" style="padding:22px 24px 8px;">
        <div style="display:inline-block;background:#f5f6f8;border:1px solid ${EMAIL.BORDER};border-radius:14px;padding:16px 26px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;font-weight:700;line-height:1.2;letter-spacing:0.22em;color:${INK};">${esc(code)}</div>
      </td></tr>
      <tr><td style="padding:6px 24px 4px;">
        <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">${esc(s.expiry)} ${esc(c.ignore)}</p>
        <p style="margin:12px 0 0;font-size:12px;font-weight:600;color:${INK};line-height:1.6;">${esc(s.phishing)}</p>
      </td></tr>`

  const html = renderBrandEmail({ preheader: c.preheader, bodyHtml, origin })
  const text = [c.heading, '', c.body, '', code, '', `${s.forAddress} ${email}`, '', s.expiry, c.ignore, s.phishing].join('\n')

  return { subject: c.subject, html, text }
}
