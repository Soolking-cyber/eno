import { renderBrandEmail, esc, EMAIL } from './layout'

const COPY = {
  en: {
    subject: 'Your code to connect or disconnect Facebook',
    preheader: 'Enter this code only if you asked for it. It expires in 10 minutes.',
    heading: 'Your code to connect or disconnect Facebook',
    body: 'Enter this code in Settings › Privacy to connect or disconnect a Facebook account on your account. It expires in 10 minutes.',
    warn: 'If you didn’t ask for this, ignore this email and don’t share the code: with it, someone could add their Facebook as a way into your account.',
  },
  vi: {
    subject: 'Mã kết nối hoặc ngắt kết nối Facebook của bạn',
    preheader: 'Chỉ nhập mã này nếu bạn đã yêu cầu. Mã hết hạn sau 10 phút.',
    heading: 'Mã kết nối hoặc ngắt kết nối Facebook của bạn',
    body: 'Nhập mã này trong Cài đặt › Quyền riêng tư để kết nối hoặc ngắt kết nối một tài khoản Facebook với tài khoản của bạn. Mã hết hạn sau 10 phút.',
    warn: 'Nếu bạn không yêu cầu, hãy bỏ qua email này và đừng chia sẻ mã: với mã này, người khác có thể thêm Facebook của họ làm cách vào tài khoản của bạn.',
  },
} as const

/** Says what the code does, unlike a sign-in code: this is the one message a person might be talked into forwarding. */
export function renderFacebookConnectCodeEmail(opts: { code: string; origin: string; lang: 'en' | 'vi' }): { subject: string; html: string; text: string } {
  const c = COPY[opts.lang]
  const html = renderBrandEmail({
    preheader: c.preheader,
    origin: opts.origin,
    lang: opts.lang,
    bodyHtml: `<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${EMAIL.INK};line-height:1.3;">${esc(c.heading)}</h1>
<p style="margin:0 0 16px;font-size:15px;color:${EMAIL.INK};line-height:1.6;">${esc(c.body)}</p>
<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:4px;color:${EMAIL.INK};">${esc(opts.code)}</p>
<p style="margin:0;font-size:13px;color:${EMAIL.MUTED};line-height:1.6;">${esc(c.warn)}</p>`,
  })
  return { subject: c.subject, html, text: `${c.heading}\n\n${c.body}\n\n${opts.code}\n\n${c.warn}` }
}
