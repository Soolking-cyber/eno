import { formatMoneyFull } from '@/lib/vnd'
import type { DigestContent, DigestHome, DigestItem } from '@/lib/digest'
import { renderBrandEmail, emailCta, esc, EMAIL } from './layout'

// Static, server-rendered HTML email — no React context (tr()/useLanguage are client
// only), so copy is English (the app's server-default locale; 21 of the 24 subscribers
// on 2026-09-29 had locale 'en' and none had 'vi'). The branded shell (real logo, card,
// legal footer, unsubscribe) comes from ./layout — this file renders only the digest's
// own content rows.
//
// ⛔ LEAD JOB: GET A RENTER TO THE FREE AVAILABILITY CHECK. The home cards, the district chips and
// the one CTA lead there. Below it, "More on <site>" shows one listing from each of up to six other
// categories (owner, 2026-09-29: "make sure it shows variety of listings not only 1 category"), and
// the seller line closes.
// The previous version was a grid of "top picks" (six SIM plans the week it was fixed) with a
// "message the seller to arrange" line that is not how a rental on eno.vn works at all.
//
// ⚠️ EVERY CLAIM HERE IS CHECKED AGAINST WHAT THE SITE DOES — keep it that way when editing:
//   · "added to eno.vn this week" — counts rows by createdAt, which the importers set on FIRST
//     import only; it does not say "new to the market", which eno cannot know for a portal listing.
//   · "landlord or agent" — imported listings often have an agent behind them, not a landlord.
//   · "free — no fee, no markup" describes the CHECK (the owner's spec, 2026-09-25); it says nothing
//     about what an agent may charge, and must not be widened to.

const { BLUE, INK, MUTED, BORDER, RED } = EMAIL
const TINT = '#e8f1fb'

/** Tag an eno link so a click from this email is attributable. Only for links to `origin`. */
export function track(url: string, content: string): string {
  const u = new URL(url)
  u.searchParams.set('utm_source', 'eno')
  u.searchParams.set('utm_medium', 'email')
  u.searchParams.set('utm_campaign', 'weekly-digest')
  u.searchParams.set('utm_content', content)
  return u.toString()
}

const n = (x: number) => x.toLocaleString('en-US')
/** "1 apartment", "2,225 apartments". */
const count = (k: number, one: string) => `${n(k)} ${k === 1 ? one : `${one}s`}`
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
/** "six" for 6 — the intro names how many cards actually follow, never a hard-coded six. */
const word = (k: number) => WORDS[k] ?? n(k)
/**
 * A 4:3 JPEG thumbnail of a listing photo, cropped server-side by Supabase Storage's image renderer.
 *
 * ⛔ WHY NOT THE ORIGINAL: listing photos are stored as WebP at their portal's own aspect ratio. The
 * first render put a 768×1024 portrait photo beside a 1024×768 landscape one, so one card was twice
 * the height of its neighbour; Outlook on Windows does not display WebP at all; and each original
 * is ~190 KB against ~50 KB for this. `object-fit` would fix only the first, and Gmail ignores it.
 * ⚠️ 300×225, NOT LARGER: the renderer never enlarges, so a request wider than the source comes back
 * at the source's width and the wrong aspect (a 459-px-wide portal photo returned 459×390 for a
 * 520×390 ask; a 300×300 product photo stood taller than its neighbour at 400×300). The smallest
 * catalogue photos are 300 px wide, and 300 px still covers the 260-px card.
 * Any URL that is not a public Storage object is returned unchanged.
 */
export function emailThumb(url: string): string {
  const m = url.match(/^(https:\/\/[^/]+)\/storage\/v1\/object\/public\/([^?#]+)$/)
  return m ? `${m[1]}/storage/v1/render/image/public/${m[2]}?width=300&height=225&resize=cover&quality=80` : url
}

/** Imported product titles run to 150 characters; a card shows the first line or two. */
// By code point, not UTF-16 unit: a cut through an emoji would leave a lone surrogate ("�").
const shortTitle = (t: string) => { const c = Array.from(t); return c.length > 70 ? `${c.slice(0, 67).join('').trimEnd()}…` : t }

/** A free partner product (an eSIM at 0 đ) reads "Free", never "0 đ". */
const priceLabel = (price: number, currency: string) => (price > 0 ? formatMoneyFull(price, currency, 'en') : 'Free')

function homeCard(h: DigestHome, i: number, origin: string): string {
  const url = track(`${origin}/listings/${h.id}`, `home-${i + 1}`)
  const price = `${formatMoneyFull(h.price, h.currency, 'en')} / month`
  return `
      <td width="50%" valign="top" style="padding:8px;">
        <a href="${esc(url)}" style="text-decoration:none;color:${INK};display:block;">
          <img src="${esc(emailThumb(h.image))}" width="260" height="195" alt="${esc(h.heading)}" style="display:block;width:100%;max-width:260px;height:auto;border-radius:12px;border:1px solid ${BORDER};" />
          <div style="margin-top:8px;font-size:16px;font-weight:700;color:${BLUE};">${esc(price)}</div>
          <div style="margin-top:2px;font-size:14px;font-weight:600;color:${INK};line-height:1.35;">${esc(h.heading)}</div>
          ${h.area ? `<div style="margin-top:2px;font-size:12px;color:${MUTED};">${esc(h.area)}</div>` : ''}
          <div style="margin-top:6px;font-size:13px;font-weight:700;color:${BLUE};">Check availability →</div>
        </a>
      </td>`
}

function itemCard(item: DigestItem, i: number, origin: string, slot: string): string {
  const url = track(`${origin}/listings/${item.id}`, `${slot}-${i + 1}`)
  const price = priceLabel(item.price, item.currency)
  // Only a pick is labelled with its category — that label is what makes the variety visible.
  const label = slot === 'pick' ? item.category : null
  const badge = item.drop
    ? `<span style="display:inline-block;background:${RED};color:#ffffff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:9999px;vertical-align:middle;">${esc(item.drop)}</span>`
    : item.urgent
      ? `<span style="display:inline-block;background:${INK};color:#ffffff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:9999px;vertical-align:middle;">Urgent</span>`
      : ''
  const img = item.image
    ? `<img src="${esc(emailThumb(item.image))}" width="260" height="195" alt="" style="display:block;width:100%;max-width:260px;height:auto;border-radius:12px;border:1px solid ${BORDER};" />`
    : `<div style="width:100%;height:150px;border-radius:12px;background:#eef2f6;border:1px solid ${BORDER};"></div>`
  return `
      <td width="50%" valign="top" style="padding:8px;">
        <a href="${esc(url)}" style="text-decoration:none;color:${INK};display:block;">
          ${img}
          ${label ? `<div style="margin-top:8px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(label)}</div>` : ''}
          <div style="margin-top:${label ? '2px' : '8px'};font-size:14px;font-weight:600;color:${INK};line-height:1.35;">${esc(shortTitle(item.title))}</div>
          <div style="margin-top:4px;font-size:16px;font-weight:700;color:${BLUE};">${esc(price)}${badge ? ' ' + badge : ''}</div>
          ${item.district && slot !== 'pick' ? `<div style="margin-top:2px;font-size:12px;color:${MUTED};">${esc(item.district)}</div>` : ''}
        </a>
      </td>`
}

function grid(cells: string[]): string {
  let rows = ''
  for (let i = 0; i < cells.length; i += 2) {
    rows += `<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%" style="padding:8px;"></td>'}</tr>`
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`
}

function sectionHeading(text: string): string {
  return `<h2 style="margin:28px 0 4px;font-size:18px;font-weight:800;color:${INK};letter-spacing:-0.01em;">${esc(text)}</h2>`
}

function chips(districts: DigestContent['districts'], origin: string): string {
  if (!districts.length) return ''
  const links = districts
    .map((d) => `<a href="${esc(track(`${origin}/c/rentals/${d.slug}`, `district-${d.slug}`))}" style="display:inline-block;margin:4px 4px 0 0;padding:5px 11px;border-radius:9999px;background:${TINT};color:${BLUE};font-size:13px;font-weight:600;text-decoration:none;">${esc(d.label)}</a>`)
    .join('')
  return `<p style="margin:14px 0 0;font-size:13px;color:${MUTED};">Browse this week's homes by district:</p><div>${links}</div>`
}

function howItWorks(origin: string, siteName: string): string {
  const step = (k: number, text: string) =>
    `<tr><td valign="top" style="padding:4px 10px 4px 0;font-size:14px;font-weight:800;color:${BLUE};">${k}</td><td style="padding:4px 0;font-size:14px;color:${INK};line-height:1.45;">${text}</td></tr>`
  return `
      <tr><td style="padding:12px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TINT};border-radius:14px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-size:16px;font-weight:800;color:${INK};">Found one you like? We'll check it for you — free</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;">
              ${step(1, 'Tap <b>Add to free availability check</b> on up to 5 homes.')}
              ${step(2, 'Send them in one go — we contact each landlord or agent for you.')}
              ${step(3, `The answers arrive in your ${esc(siteName)} Messages.`)}
            </table>
            <p style="margin:10px 0 16px;font-size:13px;color:${MUTED};">The check is free — no fee, no markup.</p>
            ${emailCta('Find a home and check availability', track(`${origin}/c/rentals`, 'cta-check'))}
          </td></tr>
        </table>
      </td></tr>`
}

function picksGrid(items: DigestItem[], origin: string, siteName: string): string {
  if (!items.length) return ''
  return `
      <tr><td style="padding:0 16px;">
        ${sectionHeading(`More on ${siteName}`)}
        <p style="margin:0 8px;font-size:14px;color:${MUTED};line-height:1.5;">One pick from each corner of the marketplace.</p>
        ${grid(items.map((it, i) => itemCard(it, i, origin, 'pick')))}
      </td></tr>`
}

function textVersion(c: DigestContent, origin: string, unsubscribeUrl: string, site: string, hi: string): string {
  const parts: string[] = [hi, '']
  if (c.homes.length) {
    parts.push(
      c.homeCounts.total > 0
        ? `${n(c.homeCounts.total)} ${c.homeCounts.total === 1 ? 'home for rent was' : 'homes for rent were'} added to ${site} this week (${count(c.homeCounts.apartments, 'apartment')}, ${count(c.homeCounts.houses, 'house')}, ${count(c.homeCounts.rooms, 'room')}).`
        : `Homes for rent worth a look, recently added to ${site}.`,
      '',
    )
    for (const [i, h] of c.homes.entries()) {
      parts.push(`• ${formatMoneyFull(h.price, h.currency, 'en')} / month — ${h.heading}${h.area ? `, ${h.area}` : ''}`, `  ${track(`${origin}/listings/${h.id}`, `home-${i + 1}`)}`)
    }
    parts.push(
      '',
      'FREE AVAILABILITY CHECK',
      '1. Tap "Add to free availability check" on up to 5 homes.',
      '2. Send them in one go — we contact each landlord or agent for you.',
      `3. The answers arrive in your ${site} Messages.`,
      'The check is free — no fee, no markup.',
      track(`${origin}/c/rentals`, 'cta-check'),
    )
  }
  const line = (i: DigestItem, k: number, slot: string) => `• ${shortTitle(i.title)} — ${priceLabel(i.price, i.currency)}${i.drop ? ` (${i.drop})` : i.urgent ? ' (Urgent)' : ''}\n  ${track(`${origin}/listings/${i.id}`, `${slot}-${k + 1}`)}`
  const pickLine = (i: DigestItem, k: number) => `• ${i.category ? `[${i.category}] ` : ''}${shortTitle(i.title)} — ${priceLabel(i.price, i.currency)}${i.drop ? ` (${i.drop})` : i.urgent ? ' (Urgent)' : ''}\n  ${track(`${origin}/listings/${i.id}`, `pick-${k + 1}`)}`
  if (c.picks.length) parts.push('', `MORE ON ${site.toUpperCase()}`, ...c.picks.map(pickLine))
  if (c.sales.length) parts.push('', 'MOVING SALES', ...c.sales.map((it, k) => line(it, k, 'sale')))
  parts.push('', `Moving out? Selling your things on ${site} is free: ${track(`${origin}/post`, 'sell')}`, '', `Unsubscribe: ${unsubscribeUrl}`)
  return parts.join('\n')
}

/** First word of a display name, or null when it does not look like a name we should greet. */
function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  if (!first || first.length > 24 || /[@\d]/.test(first)) return null
  return first
}

export function renderWeeklyDigest(opts: {
  content: DigestContent
  origin: string
  unsubscribeUrl: string
  recipientName?: string | null
  /**
   * This build's own name — pass SITE_NAME. The route is compiled into BOTH editions, so a literal
   * "eno.vn" here would reach eno.forum accounts the day its cron is pointed at the forum.
   */
  siteName: string
}): { subject: string; html: string; text: string } {
  const { content: c, origin, unsubscribeUrl, recipientName, siteName } = opts
  const who = firstName(recipientName)
  const hi = who ? `Hi ${who},` : 'Hi there,'

  const hasHomes = c.homes.length > 0
  // ⚠️ THE COUNT IS THE LAST 7 DAYS; THE CARDS MAY WIDEN TO 30 (digest.ts HOME_WINDOWS_MS). On a quiet
  // week there can be cards and a count of 0 — "0 homes for rent added this week" above six homes
  // is false, so a zero count switches to copy that makes no weekly claim at all.
  const counted = c.homeCounts.total > 0
  const subject = !hasHomes
    ? `This week on ${siteName} — what's new`
    : counted
      ? `${n(c.homeCounts.total)} ${c.homeCounts.total === 1 ? 'home' : 'homes'} for rent added to ${siteName} this week`
      : `Homes for rent worth a look on ${siteName}`
  const preheader = hasHomes
    ? `Pick up to 5 and we'll check they're still available — free, no fee, no markup.`
    : `The newest listings on ${siteName} this week.`

  const homesHtml = hasHomes
    ? `
      <tr><td style="padding:4px 24px 0;">
        <p style="margin:12px 0 0;font-size:15px;color:${INK};">${esc(hi)}</p>
        <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:800;color:${INK};letter-spacing:-0.02em;">${counted ? `${n(c.homeCounts.total)} ${c.homeCounts.total === 1 ? 'home for rent was' : 'homes for rent were'} added this week` : 'Homes for rent worth a look'}</h1>
        <p style="margin:8px 0 0;font-size:14px;color:${MUTED};line-height:1.5;">${counted ? `${count(c.homeCounts.apartments, 'apartment')} · ${count(c.homeCounts.houses, 'house')} · ${count(c.homeCounts.rooms, 'room')}, linked from partner property portals.` : `Recently added to ${esc(siteName)}, linked from partner property portals.`} Here ${c.homes.length === 1 ? 'is one' : `are ${word(c.homes.length)}`} worth a look.</p>
        ${chips(c.districts, origin)}
      </td></tr>
      <tr><td style="padding:8px 16px 0;">
        ${grid(c.homes.map((h, i) => homeCard(h, i, origin)))}
      </td></tr>
      ${howItWorks(origin, siteName)}`
    : `
      <tr><td style="padding:4px 24px 0;">
        <p style="margin:12px 0 0;font-size:15px;color:${INK};">${esc(hi)}</p>
        <p style="margin:6px 0 0;font-size:14px;color:${MUTED};line-height:1.5;">Here's what's new on ${esc(siteName)} this week.</p>
      </td></tr>`

  const salesHtml = c.sales.length
    ? `
      <tr><td style="padding:0 16px;">
        ${sectionHeading('Moving sales — going fast')}
        ${grid(c.sales.map((s, i) => itemCard(s, i, origin, 'sale')))}
      </td></tr>`
    : ''

  const sellHtml = `
      <tr><td style="padding:24px 24px 0;">
        <p style="margin:0;font-size:14px;color:${INK};line-height:1.5;"><b>Moving out?</b> Sell your furniture and appliances on ${esc(siteName)} — posting is free. <a href="${esc(track(`${origin}/post`, 'sell'))}" style="color:${BLUE};font-weight:700;text-decoration:none;">Post a listing →</a></p>
      </td></tr>`

  const bodyHtml = `${homesHtml}${picksGrid(c.picks, origin, siteName)}${salesHtml}${sellHtml}`

  const html = renderBrandEmail({
    preheader,
    bodyHtml,
    origin,
    // The rentals CTA lives inside the "how it works" panel; with no homes the shell's own button
    // is the only way onward.
    cta: hasHomes ? undefined : { label: `Browse ${siteName} →`, url: track(origin, 'cta-browse') },
    audienceNote: `You're receiving this weekly email because you have an ${siteName} account.`,
    unsubscribeUrl,
  })

  return { subject, html, text: textVersion(c, origin, unsubscribeUrl, siteName, hi) }
}
