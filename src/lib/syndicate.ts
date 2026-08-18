import 'server-only'
import { formatMoneyFull } from './vnd'
import { db } from './db'

/**
 * Auto cross-post a newly-published listing to the platform's own social channels.
 * Each channel is OPTIONAL and env-gated — a channel with no credentials is simply
 * skipped, so this is dormant until you configure it. Every channel is best-effort
 * and isolated: one failing never blocks another or the request (call via after()).
 *
 * Channels implemented (no paid API / no app review needed):
 *   - Telegram channel  → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   - Facebook Page     → FB_PAGE_ID + FB_PAGE_TOKEN
 * Instagram / X / Zalo need a developer app + approvals (Instagram) or paid tier (X)
 * or an Official Account (Zalo); add posters here once those credentials exist.
 */

export type SyndicationInput = {
  id: string
  title: string
  price: number
  currency: string
  location: string
  district: string | null
  image: string | null
  categoryName: string
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

function listingUrl(id: string) {
  return `${APP_URL}/listings/${id}`
}

function caption(l: SyndicationInput): string {
  const where = l.district || l.location
  return [
    l.title,
    // 'vi' money format: these channels broadcast to the Vietnamese-market
    // audience, where "12.000.000 đ" is the trusted native convention.
    `${formatMoneyFull(l.price, l.currency, 'vi')}${where ? ` · ${where}` : ''}`,
    listingUrl(l.id),
  ].join('\n')
}

async function postTelegram(l: SyndicationInput, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) return
  const api = `https://api.telegram.org/bot${token}`
  const res = l.image
    ? await fetch(`${api}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, photo: l.image, caption: text }),
      })
    : await fetch(`${api}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text }),
      })
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`)
}

async function postFacebookPage(l: SyndicationInput, text: string) {
  const pageId = process.env.FB_PAGE_ID
  const token = process.env.FB_PAGE_TOKEN
  if (!pageId || !token) return
  const base = `https://graph.facebook.com/v21.0/${pageId}`
  // A photo post with a caption gets the most reach; without an image, post a link.
  const body = l.image
    ? new URLSearchParams({ url: l.image, caption: text, access_token: token })
    : new URLSearchParams({ message: text, link: listingUrl(l.id), access_token: token })
  const res = await fetch(`${base}/${l.image ? 'photos' : 'feed'}`, { method: 'POST', body })
  if (!res.ok) throw new Error(`facebook ${res.status}: ${await res.text()}`)
}

/**
 * ⛔ RECORD THE PUBLISH-TIME POST IN `social_posts` TOO — REVIEWER-CAUGHT DUPLICATE, AND IT WOULD
 * HAVE HIT THE ONLY LIVE CHANNEL.
 *
 * This function and the daily job (src/lib/social/daily.ts) both post to the same Facebook Page,
 * and until now only the daily job wrote to `social_posts`. The daily selector orders NEWEST FIRST,
 * so the worst case was also the common one: a seller publishes at 20:00 and the listing goes out
 * once here, then the 02:00 run picks that very listing — newest, and unclaimed as far as the table
 * knows — and posts it to the same Page a second time. Two identical posts overnight is what a bot
 * looks like to both a reader and to Facebook.
 *
 * ⚠️ BEST-EFFORT AND NON-BLOCKING. A failure to record must never fail a publish: the listing is
 * already live and the post already went out. The cost of a missed record is one duplicate, which
 * is the situation this fixes rather than a new one it creates.
 */
async function claimForDaily(listingId: string, channel: string): Promise<void> {
  try {
    await db.$executeRaw`
      insert into social_posts (listing_id, channel, status)
      values (${listingId}, ${channel}, 'posted')
      on conflict (listing_id, channel) do nothing
    `
  } catch (e) {
    console.error('[syndicate:claim]', e)
  }
}

export async function syndicateListing(l: SyndicationInput): Promise<void> {
  const text = caption(l)
  const channels: [string, () => Promise<void>][] = [
    ['telegram', () => postTelegram(l, text)],
    ['facebook', () => postFacebookPage(l, text)],
  ]
  await Promise.all(
    channels.map(async ([name, fn]) => {
      try {
        await fn()
        // ⚠️ Only `facebook` is shared with the daily job — Telegram is not one of its channels, so
        // recording it would put rows in the table for a channel that never reads them.
        if (name === 'facebook') await claimForDaily(l.id, 'facebook')
      } catch (e) {
        console.error(`[syndicate:${name}]`, e)
      }
    }),
  )
}
