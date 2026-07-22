import { renderBrandEmail, emailCta, esc, EMAIL } from './layout'

// The magic-link email — the ONE auth email eno.vn now sends itself.
//
// WHY THIS EXISTS. Until 2026-07-22 the sign-in link was composed and delivered by
// Supabase Auth over SMTP. That path had two standing problems and one outage:
//   · it was the single email that did NOT render through renderBrandEmail(), so the
//     first thing a new user ever received was the one piece of unbranded mail we send;
//   · Supabase's SMTP credentials are config we cannot read, test, or repair from the
//     repo — when they went stale the only symptom was silence;
//   · on 2026-07-19 a Resend key rotation invalidated them, and every sign-in and signup
//     failed with `535 "Authentication credentials invalid"` for three days.
// `admin.generateLink()` mints the same token WITHOUT touching SMTP, so delivery is now
// ours: same Resend path, same brand shell, same logs as every other email.
//
// ⚠️ SIGN-IN AND SIGN-UP ARE DIFFERENT EMAILS. Requesting a link for an address with no
// account CREATES one — that has always been true (Supabase's `shouldCreateUser` defaults
// to true and the old signInWithOtp call never overrode it), but nothing anywhere said so,
// so a one-character typo silently minted a ghost profile. The owner hit exactly this on
// 2026-07-22: `support@eno.forum` instead of `support@eno.vn`, and got a blank new account
// with no indication it was new.
//
// The fix has to respect enumeration: the HTTP response must stay identical either way, or
// an attacker can test which addresses have accounts. But the EMAIL only ever reaches the
// inbox owner — the one party entitled to know — so it can say plainly which of the two
// happened, and name the address it was sent to. `generateLink` reports this as
// `properties.verification_type` ('signup' for a new or unconfirmed account, 'magiclink'
// for an existing one), so the caller passes it straight through as `mode`.
//
// Copy is bilingual because the caller knows the visitor's language (the sign-in form
// passes it) — unlike the digest cron, which has no locale to work from.

const { INK, MUTED } = EMAIL

type Lang = 'en' | 'vi'
export type SignInMode = 'signin' | 'signup'

const COPY = {
  signin: {
    en: {
      subject: 'Your sign-in link for eno.vn',
      preheader: 'Tap the button to sign in. The link expires in one hour.',
      heading: 'Sign in to eno.vn',
      body: 'Tap the button below and you’ll be signed in — no password needed.',
      cta: 'Sign in',
      ignore: 'If you didn’t request it, you can safely ignore this email — nobody can sign in without the link.',
    },
    vi: {
      subject: 'Liên kết đăng nhập eno.vn của bạn',
      preheader: 'Nhấn vào nút để đăng nhập. Liên kết hết hạn sau một giờ.',
      heading: 'Đăng nhập vào eno.vn',
      body: 'Nhấn vào nút bên dưới để đăng nhập — không cần mật khẩu.',
      cta: 'Đăng nhập',
      ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này — không ai đăng nhập được nếu không có liên kết.',
    },
  },
  signup: {
    en: {
      subject: 'Confirm your email to create your eno.vn account',
      preheader: 'This address has no eno.vn account yet — confirm to create one.',
      heading: 'Create your eno.vn account',
      // States the two facts a mistyped address needs: this is NEW, and here is the
      // address it would belong to.
      body: 'This address doesn’t have an eno.vn account yet. Tap below to confirm it and finish creating one.',
      cta: 'Create my account',
      ignore: 'If you didn’t request this, ignore this email — the account stays unconfirmed and cannot be used by anyone.',
    },
    vi: {
      subject: 'Xác nhận email để tạo tài khoản eno.vn',
      preheader: 'Địa chỉ này chưa có tài khoản eno.vn — xác nhận để tạo mới.',
      heading: 'Tạo tài khoản eno.vn',
      body: 'Địa chỉ này chưa có tài khoản eno.vn. Nhấn vào nút bên dưới để xác nhận và hoàn tất việc tạo tài khoản.',
      cta: 'Tạo tài khoản',
      ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này — tài khoản sẽ không được xác nhận và không ai dùng được.',
    },
  },
} as const

const SHARED = {
  en: {
    forAddress: 'This was sent to',
    fallback: 'If the button doesn’t work, copy this link into your browser:',
    expiry: 'This link works once and expires in one hour.',
  },
  vi: {
    forAddress: 'Email này được gửi tới',
    fallback: 'Nếu nút không hoạt động, hãy sao chép liên kết này vào trình duyệt:',
    expiry: 'Liên kết chỉ dùng được một lần và hết hạn sau một giờ.',
  },
} as const

export function renderSignInEmail(opts: {
  url: string
  origin: string
  /** The recipient, echoed in the body so a mistyped address is visible before it costs anything. */
  email: string
  lang?: Lang
  /** 'signup' when this address had no account — from generateLink's verification_type. */
  mode?: SignInMode
}): { subject: string; html: string; text: string } {
  const lang: Lang = opts.lang === 'vi' ? 'vi' : 'en'
  const mode: SignInMode = opts.mode === 'signup' ? 'signup' : 'signin'
  const c = COPY[mode][lang]
  const s = SHARED[lang]
  const { url, origin, email } = opts

  // The CTA is composed INLINE rather than via renderBrandEmail's `cta` option: the
  // fallback URL has to sit *after* the button, and the shell renders its `cta` last,
  // immediately before the footer. Same `emailCta()` helper either way, so this is still
  // the one brand CTA — only its position is chosen here.
  //
  // The raw URL is repeated as text because some clients (and every plain-text reader)
  // strip the button, and a sign-in email that can't be acted on is a dead end.
  const bodyHtml = `
      <tr><td style="padding:8px 24px 0;">
        <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(c.heading)}</h1>
        <p style="margin:0;font-size:15px;color:${INK};line-height:1.6;">${esc(c.body)}</p>
        <p style="margin:10px 0 0;font-size:13px;color:${MUTED};line-height:1.6;">${esc(s.forAddress)} <strong style="color:${INK};">${esc(email)}</strong></p>
      </td></tr>
      <tr><td align="center" style="padding:24px 24px 8px;">${emailCta(c.cta, url)}</td></tr>
      <tr><td style="padding:6px 24px 4px;">
        <p style="margin:0 0 6px;font-size:12px;color:${MUTED};line-height:1.6;">${esc(s.fallback)}</p>
        <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
          <a href="${esc(url)}" style="color:${EMAIL.BLUE};text-decoration:underline;">${esc(url)}</a>
        </p>
        <p style="margin:14px 0 0;font-size:12px;color:${MUTED};line-height:1.6;">${esc(s.expiry)} ${esc(c.ignore)}</p>
      </td></tr>`

  const html = renderBrandEmail({ preheader: c.preheader, bodyHtml, origin })
  const text = [c.heading, '', c.body, '', `${s.forAddress} ${email}`, '', url, '', s.expiry, c.ignore].join('\n')

  return { subject: c.subject, html, text }
}
