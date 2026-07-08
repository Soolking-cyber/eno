import { formatMoneyFull } from '@/lib/vnd'
import type { DigestItem } from '@/lib/digest'

// Static, server-rendered HTML email — no React context (tr()/useLanguage are client
// only), so copy is English (the app's server-default locale) with fully INLINED styles
// (email clients strip <style>/external CSS). Brand: single blue #0A66C2, slate ink.

const BLUE = '#0A66C2'
const BLUE_DARK = '#004182'
const INK = '#1a202c'
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'
const CANVAS = '#f5f6f8'
const RED = '#dc2626'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function card(item: DigestItem, origin: string): string {
  const url = `${origin}/listings/${item.id}`
  const price = formatMoneyFull(item.price, item.currency, 'en')
  const badge = item.drop
    ? `<span style="display:inline-block;background:${RED};color:#ffffff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:9999px;vertical-align:middle;">${esc(item.drop)}</span>`
    : item.urgent
      ? `<span style="display:inline-block;background:${INK};color:#ffffff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:9999px;vertical-align:middle;">Urgent</span>`
      : ''
  const img = item.image
    ? `<img src="${esc(item.image)}" width="260" alt="" style="display:block;width:100%;max-width:260px;height:auto;border-radius:12px;border:1px solid ${BORDER};" />`
    : `<div style="width:100%;height:150px;border-radius:12px;background:#eef2f6;border:1px solid ${BORDER};"></div>`
  return `
      <td width="50%" valign="top" style="padding:8px;">
        <a href="${url}" style="text-decoration:none;color:${INK};display:block;">
          ${img}
          <div style="margin-top:8px;font-size:14px;font-weight:600;color:${INK};line-height:1.35;">${esc(item.title)}</div>
          <div style="margin-top:4px;font-size:16px;font-weight:700;color:${BLUE};">${esc(price)}${badge ? ' ' + badge : ''}</div>
          ${item.district ? `<div style="margin-top:2px;font-size:12px;color:${MUTED};">${esc(item.district)}</div>` : ''}
        </a>
      </td>`
}

function grid(items: DigestItem[], origin: string): string {
  let rows = ''
  for (let i = 0; i < items.length; i += 2) {
    const a = card(items[i], origin)
    const b = items[i + 1] ? card(items[i + 1], origin) : '<td width="50%" style="padding:8px;"></td>'
    rows += `<tr>${a}${b}</tr>`
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`
}

function sectionHeading(text: string): string {
  return `<h2 style="margin:28px 0 4px;font-size:18px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(text)}</h2>`
}

function textVersion(top: DigestItem[], sales: DigestItem[], origin: string, unsubscribeUrl: string): string {
  const line = (i: DigestItem) => `• ${i.title} — ${formatMoneyFull(i.price, i.currency, 'en')}${i.drop ? ` (${i.drop})` : i.urgent ? ' (Urgent)' : ''}\n  ${origin}/listings/${i.id}`
  const parts = ['This week on eno.vn', '', 'TOP PICKS', ...top.map(line)]
  if (sales.length) parts.push('', 'MOVING SALES', ...sales.map(line))
  parts.push('', `Browse: ${origin}`, '', `Unsubscribe: ${unsubscribeUrl}`)
  return parts.join('\n')
}

export function renderWeeklyDigest(opts: {
  top: DigestItem[]
  sales: DigestItem[]
  origin: string
  unsubscribeUrl: string
  recipientName?: string | null
}): { subject: string; html: string; text: string } {
  const { top, sales, origin, unsubscribeUrl, recipientName } = opts

  const subject = sales.length
    ? `This week on eno.vn — top picks & ${sales.length} moving sale${sales.length > 1 ? 's' : ''}`
    : `This week on eno.vn — top picks for you`

  const preheader = sales.length
    ? `${top.length} top picks and ${sales.length} price drops from Vietnam's trusted marketplace.`
    : `${top.length} top picks from Vietnam's trusted marketplace.`

  const hi = recipientName ? `Hi ${esc(recipientName.split(' ')[0])},` : 'Hi there,'

  const html = `<!-- preheader --><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;border:1px solid ${BORDER};overflow:hidden;">
      <!-- header -->
      <tr><td style="padding:22px 24px 6px;">
        <a href="${origin}" style="text-decoration:none;">
          <span style="display:inline-block;background:${BLUE};color:#ffffff;font-weight:800;font-size:16px;width:30px;height:30px;line-height:30px;text-align:center;border-radius:8px;vertical-align:middle;">e</span>
          <span style="font-size:18px;font-weight:800;color:${INK};vertical-align:middle;margin-left:8px;">eno.vn</span>
        </a>
      </td></tr>
      <tr><td style="padding:4px 24px 0;">
        <p style="margin:12px 0 0;font-size:15px;color:${INK};">${hi}</p>
        <p style="margin:6px 0 0;font-size:14px;color:${MUTED};line-height:1.5;">Here's what's moving on eno.vn this week — handpicked top listings and the latest price drops. Everything's on the app; message the seller to arrange.</p>
      </td></tr>

      <!-- top picks -->
      <tr><td style="padding:0 16px;">
        ${sectionHeading('Top picks this week')}
        ${grid(top, origin)}
      </td></tr>

      ${sales.length ? `<!-- moving sales -->
      <tr><td style="padding:0 16px;">
        ${sectionHeading('Moving sales — going fast')}
        ${grid(sales, origin)}
      </td></tr>` : ''}

      <!-- cta -->
      <tr><td align="center" style="padding:24px 24px 8px;">
        <a href="${origin}" style="display:inline-block;background:${BLUE};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:12px;">Browse eno.vn →</a>
      </td></tr>

      <!-- footer -->
      <tr><td style="padding:20px 24px 24px;border-top:1px solid ${BORDER};margin-top:16px;">
        <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
          You're receiving this because you have an eno.vn account.
          <a href="${unsubscribeUrl}" style="color:${BLUE};text-decoration:underline;">Unsubscribe from these emails</a>.
        </p>
        <p style="margin:10px 0 0;font-size:11px;color:${MUTED};line-height:1.6;">
          Công ty TNHH ENO · TP. Hồ Chí Minh, Việt Nam · support@eno.vn<br/>
          eno.vn — Vietnam's trusted marketplace for the international community.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`.trim()

  return { subject, html, text: textVersion(top, sales, origin, unsubscribeUrl) }
}
