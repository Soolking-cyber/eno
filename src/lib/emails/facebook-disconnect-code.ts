import { emailCopyCodeRow, renderBrandEmail, esc, EMAIL } from './layout'

const COPY = {
  en: {
    subject: 'Your code to disconnect Facebook',
    preheader: 'Enter this code only if you asked for it. It expires in 10 minutes.',
    heading: 'Your code to disconnect Facebook',
    body: 'Enter this code in Settings › Privacy to disconnect Facebook from your account. Your other signed-in devices will be signed out. It expires in 10 minutes.',
    warn: 'If you didn’t ask for this, ignore this email and don’t share the code.',
  },
  vi: {
    subject: 'Mã ngắt kết nối Facebook của bạn',
    preheader: 'Chỉ nhập mã này nếu bạn đã yêu cầu. Mã hết hạn sau 10 phút.',
    heading: 'Mã ngắt kết nối Facebook của bạn',
    body: 'Nhập mã này trong Cài đặt › Quyền riêng tư để ngắt kết nối Facebook khỏi tài khoản của bạn. Các thiết bị khác đang đăng nhập sẽ bị đăng xuất. Mã hết hạn sau 10 phút.',
    warn: 'Nếu bạn không yêu cầu, hãy bỏ qua email này và đừng chia sẻ mã.',
  },
} as const

/** Says what the code does, unlike a sign-in code: this is a message a person might be talked into forwarding. */
export function renderFacebookDisconnectCodeEmail(opts: { code: string; origin: string; lang: 'en' | 'vi' }): { subject: string; html: string; text: string } {
  const c = COPY[opts.lang]
  const html = renderBrandEmail({
    preheader: c.preheader,
    origin: opts.origin,
    lang: opts.lang,
    bodyHtml: `
      <tr><td style="padding:8px 24px 0;">
        <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:${EMAIL.INK};letter-spacing:-0.01em;">${esc(c.heading)}</h1>
        <p style="margin:0;font-size:15px;color:${EMAIL.INK};line-height:1.6;">${esc(c.body)}</p>
      </td></tr>
      <tr><td align="center" style="padding:22px 24px 8px;">
        <div style="display:inline-block;background:#f5f6f8;border:1px solid ${EMAIL.BORDER};border-radius:14px;padding:16px 26px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:6px;color:${EMAIL.INK};-webkit-user-select:all;user-select:all;">${esc(opts.code)}</div>
      </td></tr>
      ${emailCopyCodeRow(opts.code, opts.origin, opts.lang)}
      <tr><td style="padding:14px 24px 20px;">
        <p style="margin:0;font-size:12px;color:${EMAIL.MUTED};line-height:1.6;">${esc(c.warn)}</p>
      </td></tr>`,
  })
  return { subject: c.subject, html, text: `${c.heading}\n\n${c.body}\n\n${opts.code}\n\n${c.warn}` }
}
