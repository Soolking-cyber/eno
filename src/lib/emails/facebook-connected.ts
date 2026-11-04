import { renderBrandEmail, esc, EMAIL } from './layout'

const COPY = {
  en: {
    subject: 'Facebook was connected to your account',
    heading: 'Facebook was connected to your account',
    body: 'You can now sign in with that Facebook account as well as the way you do now.',
    notYou: 'If this wasn’t you, go to Settings › Privacy and disconnect Facebook.',
  },
  vi: {
    subject: 'Facebook đã được kết nối với tài khoản của bạn',
    heading: 'Facebook đã được kết nối với tài khoản của bạn',
    body: 'Giờ bạn có thể đăng nhập bằng tài khoản Facebook đó, ngoài cách đăng nhập hiện tại.',
    notYou: 'Nếu không phải bạn, hãy vào Cài đặt › Quyền riêng tư và ngắt kết nối Facebook.',
  },
} as const

/**
 * Told once, to the account's own address, when Connect adds a way in (commit gate, opus, 2026-11-04): someone who phished a
 * sign-in code keeps a way in after the mailbox's owner recovers the account, unless the owner hears about it.
 */
export function renderFacebookConnectedEmail(opts: { origin: string; lang: 'en' | 'vi' }): { subject: string; html: string; text: string } {
  const c = COPY[opts.lang]
  const html = renderBrandEmail({
    preheader: c.body,
    origin: opts.origin,
    lang: opts.lang,
    bodyHtml: `
      <tr><td style="padding:8px 24px 20px;">
        <h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:${EMAIL.INK};letter-spacing:-0.01em;">${esc(c.heading)}</h1>
        <p style="margin:0;font-size:15px;color:${EMAIL.INK};line-height:1.6;">${esc(c.body)}</p>
        <p style="margin:14px 0 0;font-size:13px;color:${EMAIL.MUTED};line-height:1.6;">${esc(c.notYou)}</p>
      </td></tr>`,
  })
  return { subject: c.subject, html, text: `${c.heading}\n\n${c.body}\n\n${c.notYou}` }
}
