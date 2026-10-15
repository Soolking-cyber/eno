import { formatMoneyFull } from '@/lib/vnd'
import type { DigestContent, DigestApartment, DigestTeacher } from '@/lib/digest'
import { renderBrandEmail, emailCta, esc, EMAIL } from './layout'

// Static, server-rendered HTML email — no React context (tr()/useLanguage are client only), so copy
// is English (the app's server-default locale; the digest does not read Profile.locale, so every
// recipient gets the same mail). The branded shell (real logo, card, legal footer, unsubscribe) comes
// from ./layout — this file renders only the digest's own content rows.
//
// ⛔ DELIBERATELY SHORT (owner, 2026-10-15): the 2 newest apartments + the 2 newest teachers + a
// "sell your second-hand items" prompt, nothing else. It replaced a longer digest (homes grid +
// cross-category picks + moving sales); see src/lib/digest.ts for what went and why.
// ⚠️ EN-pin every number — formatMoneyFull(..., 'en'); run all user-supplied text through esc().

const { BLUE, INK, MUTED, BORDER } = EMAIL
const TINT = '#e8f1fb'

/** Tag an eno link so a click from this email is attributable. Only for links whose host is `origin`. */
export function track(url: string, content: string): string {
  const u = new URL(url)
  u.searchParams.set('utm_source', 'eno')
  u.searchParams.set('utm_medium', 'email')
  u.searchParams.set('utm_campaign', 'weekly-digest')
  u.searchParams.set('utm_content', content)
  return u.toString()
}

/**
 * A 4:3 JPEG thumbnail of a listing photo, cropped server-side by Supabase Storage's image renderer.
 *
 * ⛔ WHY NOT THE ORIGINAL: photos are stored as WebP at their portal's own aspect ratio. The original
 * mixes portrait and landscape (one card twice the height of its neighbour), Outlook on Windows does
 * not display WebP, and each original is ~190 KB against ~50 KB for this.
 * ⚠️ 300×225, NOT LARGER: the renderer never enlarges, so a wider ask returns the source width and a
 * wrong aspect. 300 px still covers the 260-px card. A non-Storage URL is returned unchanged.
 */
export function emailThumb(url: string): string {
  const m = url.match(/^(https:\/\/[^/]+)\/storage\/v1\/object\/public\/([^?#]+)$/)
  return m ? `${m[1]}/storage/v1/render/image/public/${m[2]}?width=300&height=225&resize=cover&quality=80` : url
}

/** Trim a long headline to one line. By code point, so a cut never splits an emoji into "�". */
const shortText = (t: string) => { const c = Array.from(t); return c.length > 70 ? `${c.slice(0, 67).join('').trimEnd()}…` : t }

/** First word of a display name, or null when it does not look like a name we should greet. */
function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  if (!first || first.length > 24 || /[@\d]/.test(first)) return null
  return first
}

function apartmentCard(a: DigestApartment, i: number, origin: string): string {
  const url = track(`${origin}/listings/${a.id}`, `apartment-${i + 1}`)
  const price = `${formatMoneyFull(a.price, a.currency, 'en')} / month`
  return `
      <td width="50%" valign="top" style="padding:8px;">
        <a href="${esc(url)}" style="text-decoration:none;color:${INK};display:block;">
          <img src="${esc(emailThumb(a.image))}" width="260" height="195" alt="${esc(a.heading)}" style="display:block;width:100%;max-width:260px;height:auto;border-radius:12px;border:1px solid ${BORDER};" />
          <div style="margin-top:8px;font-size:16px;font-weight:700;color:${BLUE};">${esc(price)}</div>
          <div style="margin-top:2px;font-size:14px;font-weight:600;color:${INK};line-height:1.35;">${esc(a.heading)}</div>
          ${a.area ? `<div style="margin-top:2px;font-size:12px;color:${MUTED};">${esc(a.area)}</div>` : ''}
          <div style="margin-top:6px;font-size:13px;font-weight:700;color:${BLUE};">View apartment →</div>
        </a>
      </td>`
}

function teacherCard(t: DigestTeacher, i: number, origin: string): string {
  const url = track(`${origin}/listings/${t.id}`, `teacher-${i + 1}`)
  return `
      <td width="50%" valign="top" style="padding:8px;">
        <a href="${esc(url)}" style="text-decoration:none;color:${INK};display:block;">
          <img src="${esc(emailThumb(t.image))}" width="260" height="195" alt="${esc(t.name)}" style="display:block;width:100%;max-width:260px;height:auto;border-radius:12px;border:1px solid ${BORDER};" />
          <div style="margin-top:8px;font-size:15px;font-weight:700;color:${INK};line-height:1.35;">${esc(t.name)}</div>
          ${t.headline ? `<div style="margin-top:2px;font-size:13px;color:${MUTED};line-height:1.4;">${esc(shortText(t.headline))}</div>` : ''}
          <div style="margin-top:6px;font-size:13px;font-weight:700;color:${BLUE};">View profile →</div>
        </a>
      </td>`
}

/** Pair cells into a 2-up table (one trailing empty cell when odd). */
function grid(cells: string[]): string {
  let rows = ''
  for (let i = 0; i < cells.length; i += 2) {
    rows += `<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%" style="padding:8px;"></td>'}</tr>`
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`
}

/** A titled section: a small eyebrow heading + a 2-up card grid. Empty string when no cards. */
function section(title: string, cells: string[]): string {
  if (!cells.length) return ''
  return `
      <tr><td style="padding:4px 16px 0;">
        <h2 style="margin:24px 8px 0;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(title)}</h2>
        ${grid(cells)}
      </td></tr>`
}

function sellPanel(origin: string, siteName: string): string {
  return `
      <tr><td style="padding:24px 16px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TINT};border-radius:14px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-size:16px;font-weight:800;color:${INK};">Have second-hand items to sell?</div>
            <p style="margin:6px 0 14px;font-size:14px;color:${INK};line-height:1.5;">Furniture, appliances, a bike you're leaving behind — list them on ${esc(siteName)} in a few minutes. Posting is free.</p>
            ${emailCta('Post an item for sale', track(`${origin}/post`, 'sell'))}
          </td></tr>
        </table>
      </td></tr>`
}

function textVersion(c: DigestContent, origin: string, unsubscribeUrl: string, site: string, hi: string): string {
  const parts: string[] = [hi, '']
  if (c.apartments.length) {
    parts.push('NEW APARTMENTS THIS WEEK', '')
    c.apartments.forEach((a, i) => parts.push(
      `• ${formatMoneyFull(a.price, a.currency, 'en')} / month — ${a.heading}${a.area ? `, ${a.area}` : ''}`,
      `  ${track(`${origin}/listings/${a.id}`, `apartment-${i + 1}`)}`,
    ))
  }
  if (c.teachers.length) {
    parts.push('', 'NEW TEACHERS THIS WEEK', '')
    c.teachers.forEach((t, i) => parts.push(
      `• ${t.name}${t.headline ? ` — ${t.headline}` : ''}`,
      `  ${track(`${origin}/listings/${t.id}`, `teacher-${i + 1}`)}`,
    ))
  }
  parts.push('', `Have second-hand items to sell? List them free on ${site}: ${track(`${origin}/post`, 'sell')}`, '', `Unsubscribe: ${unsubscribeUrl}`)
  return parts.join('\n')
}

export function renderWeeklyDigest(opts: {
  content: DigestContent
  origin: string
  unsubscribeUrl: string
  recipientName?: string | null
  /**
   * This build's own name — pass SITE_NAME. The route compiles into BOTH editions, so a literal
   * "eno.vn" here would reach eno.forum accounts; the cron is gated to the marketplace edition, but
   * the name must still never be hard-coded.
   */
  siteName: string
}): { subject: string; html: string; text: string } {
  const { content: c, origin, unsubscribeUrl, recipientName, siteName } = opts
  const who = firstName(recipientName)
  const hi = who ? `Hi ${who},` : 'Hi there,'

  const apts = c.apartments.length
  const teachers = c.teachers.length
  const bits: string[] = []
  if (apts) bits.push(`${apts} new ${apts === 1 ? 'apartment' : 'apartments'}`)
  if (teachers) bits.push(`${teachers} new ${teachers === 1 ? 'teacher' : 'teachers'}`)
  const subject = bits.length ? `${bits.join(' & ')} on ${siteName} this week` : `What's new on ${siteName} this week`
  const preheader = bits.length
    ? `This week's newest ${apts && teachers ? 'homes and teachers' : apts ? 'homes' : 'teachers'} on ${siteName} — and a free way to sell what you're leaving behind.`
    : `The newest listings on ${siteName} this week.`

  // Name only what's actually below, so a teachers-only (or apartments-only) week doesn't claim both.
  const heroWhat = apts && teachers ? 'apartments and teachers' : apts ? 'apartments' : teachers ? 'teachers' : 'listings'
  const heroHtml = `
      <tr><td style="padding:12px 24px 0;">
        <p style="margin:0;font-size:15px;color:${INK};">${esc(hi)}</p>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;font-weight:800;color:${INK};letter-spacing:-0.02em;">What's new on ${esc(siteName)} this week</h1>
        <p style="margin:6px 0 0;font-size:14px;color:${MUTED};line-height:1.5;">The newest ${heroWhat} added to ${esc(siteName)} this week.</p>
      </td></tr>`

  const bodyHtml =
    heroHtml +
    section('New apartments this week', c.apartments.map((a, i) => apartmentCard(a, i, origin))) +
    section('New teachers this week', c.teachers.map((t, i) => teacherCard(t, i, origin))) +
    sellPanel(origin, siteName)

  const html = renderBrandEmail({
    preheader,
    bodyHtml,
    origin,
    audienceNote: `You're receiving this weekly email because you have an ${siteName} account.`,
    unsubscribeUrl,
  })

  return { subject, html, text: textVersion(c, origin, unsubscribeUrl, siteName, hi) }
}
