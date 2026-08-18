import 'server-only'
import { caption, listingUrl, opener, type PostInput } from './caption'

/**
 * THE SOCIAL CHANNELS, ONE FUNCTION EACH.
 *
 * ⚠️ EVERY CHANNEL IS ENV-GATED AND RETURNS `null` WHEN UNCONFIGURED — not an error, not a throw.
 * That is what lets this whole file ship dormant: four of the five below cannot post until a
 * platform approves an app, and a missing credential must read as "not switched on yet", never as
 * a failure worth logging every day. A channel that IS configured and then fails does throw, and
 * the caller records it.
 *
 * ⛔ NONE OF THESE RETRY. A social post is not idempotent — there is no request key to deduplicate
 * on — so a retry after an ambiguous timeout is how a Page ends up with the same listing twice.
 * The daily job records what it posted instead; a missed day is cheap, a double post is not.
 */

export type ChannelResult = { channel: string; id: string | null; skipped?: string }

const ok = (channel: string, id: string | null): ChannelResult => ({ channel, id })
const off = (channel: string): ChannelResult => ({ channel, id: null, skipped: 'not_configured' })

async function jsonOrThrow(channel: string, res: Response): Promise<Record<string, unknown>> {
  const body = await res.text()
  if (!res.ok) throw new Error(`${channel} ${res.status}: ${body.slice(0, 300)}`)
  try { return JSON.parse(body) as Record<string, unknown> } catch { return {} }
}

/** Facebook Page — the only channel already live in production. */
export async function postFacebook(l: PostInput): Promise<ChannelResult> {
  const pageId = process.env.FB_PAGE_ID
  const token = process.env.FB_PAGE_TOKEN
  if (!pageId || !token) return off('facebook')
  const text = caption(l, 'facebook')
  const base = `https://graph.facebook.com/v21.0/${pageId}`
  const body = l.image
    ? new URLSearchParams({ url: l.image, caption: text, access_token: token })
    : new URLSearchParams({ message: text, link: listingUrl(l.id, 'facebook'), access_token: token })
  const data = await jsonOrThrow('facebook', await fetch(`${base}/${l.image ? 'photos' : 'feed'}`, { method: 'POST', body }))
  return ok('facebook', typeof data.id === 'string' ? data.id : null)
}

/**
 * LinkedIn — organic post on eno's own Page via the Posts API.
 *
 * ⚠️ THE TOKEN IS THE GATE, NOT THE CLIENT ID/SECRET. Posting needs a 3-legged token carrying
 * `w_organization_social`, which only exists once LinkedIn approves Community Management API. The
 * client credentials are stored already; this stays dormant until LINKEDIN_ACCESS_TOKEN lands.
 *
 * ⚠️ `LinkedIn-Version` AND `X-Restli-Protocol-Version` ARE BOTH REQUIRED. The versioned API
 * rejects a request missing either with a 426, which reads like an auth failure and is not one.
 */
export async function postLinkedIn(l: PostInput): Promise<ChannelResult> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN
  const org = process.env.LINKEDIN_ORG_URN
  if (!token || !org) return off('linkedin')
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202508',
    },
    body: JSON.stringify({
      author: org,
      commentary: caption(l, 'linkedin'),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  })
  if (!res.ok) throw new Error(`linkedin ${res.status}: ${(await res.text()).slice(0, 300)}`)
  // The post URN comes back in a header, not the body.
  return ok('linkedin', res.headers.get('x-restli-id'))
}

/**
 * Instagram — two-step: create a media container, then publish it.
 *
 * ⛔ AN IMAGE IS MANDATORY. Instagram has no text-only post, so a listing with no photo is skipped
 * rather than failed — that is a property of the listing, not a fault of the channel.
 */
export async function postInstagram(l: PostInput): Promise<ChannelResult> {
  const igId = process.env.IG_USER_ID
  const token = process.env.IG_ACCESS_TOKEN
  if (!igId || !token) return off('instagram')
  if (!l.image) return { channel: 'instagram', id: null, skipped: 'no_image' }
  const base = `https://graph.facebook.com/v21.0/${igId}`
  const created = await jsonOrThrow('instagram:create', await fetch(`${base}/media`, {
    method: 'POST',
    body: new URLSearchParams({ image_url: l.image, caption: caption(l, 'instagram'), access_token: token }),
  }))
  const creationId = typeof created.id === 'string' ? created.id : null
  if (!creationId) throw new Error('instagram: no creation id')
  const published = await jsonOrThrow('instagram:publish', await fetch(`${base}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }))
  return ok('instagram', typeof published.id === 'string' ? published.id : null)
}

/** Threads — same two-step shape as Instagram, different host and param names. */
export async function postThreads(l: PostInput): Promise<ChannelResult> {
  const userId = process.env.THREADS_USER_ID
  const token = process.env.THREADS_ACCESS_TOKEN
  if (!userId || !token) return off('threads')
  const base = `https://graph.threads.net/v1.0/${userId}`
  const params = new URLSearchParams({ text: caption(l, 'threads'), access_token: token })
  // IMAGE when we have one, TEXT otherwise — Threads, unlike Instagram, allows text-only.
  if (l.image) { params.set('media_type', 'IMAGE'); params.set('image_url', l.image) }
  else params.set('media_type', 'TEXT')
  const created = await jsonOrThrow('threads:create', await fetch(`${base}/threads`, { method: 'POST', body: params }))
  const creationId = typeof created.id === 'string' ? created.id : null
  if (!creationId) throw new Error('threads: no creation id')
  const published = await jsonOrThrow('threads:publish', await fetch(`${base}/threads_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  }))
  return ok('threads', typeof published.id === 'string' ? published.id : null)
}

/**
 * Reddit — link post to ONE named subreddit.
 *
 * ⛔ THE OWNER CHOSE THIS CHANNEL AFTER BEING TOLD THE RISK, AND THE RISK IS REAL: posting your own
 * listings on a schedule is against Reddit's sitewide self-promotion guidance and most subreddits'
 * rules, and the usual outcome is removal or a shadowban rather than traffic. Two deliberate
 * constraints follow, and neither is timidity:
 *   · REDDIT_SUBREDDIT has NO DEFAULT. There is no subreddit this may post to unless someone names
 *     one, so it can never guess its way into a community that did not invite it.
 *   · It posts at most once per run like every other channel, so the cadence is the daily job's,
 *     not a burst.
 * The right home for it is a subreddit eno moderates, or one whose mods have said yes in writing.
 */
export async function postReddit(l: PostInput): Promise<ChannelResult> {
  const token = process.env.REDDIT_ACCESS_TOKEN
  const sub = process.env.REDDIT_SUBREDDIT
  if (!token || !sub) return off('reddit')
  const res = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Reddit REQUIRES a descriptive, unique User-Agent and rate-limits generic ones hard.
      'User-Agent': process.env.REDDIT_USER_AGENT || 'web:vn.eno.syndication:v1.0 (by /u/eno)',
    },
    body: new URLSearchParams({
      sr: sub, kind: 'link', title: `${opener(l)} — ${l.title}`.slice(0, 300),
      url: listingUrl(l.id, 'reddit'), api_type: 'json', resubmit: 'false',
    }),
  })
  const data = await jsonOrThrow('reddit', res)
  // ⚠️ REDDIT RETURNS 200 WITH THE ERRORS INSIDE THE BODY. A rule violation, a rate limit and a
  // duplicate all arrive as HTTP 200 — trusting the status code would log every rejection as a
  // success, which is precisely how a shadowban stays invisible for weeks.
  const errors = (data as { json?: { errors?: unknown[] } }).json?.errors
  if (Array.isArray(errors) && errors.length) throw new Error(`reddit rejected: ${JSON.stringify(errors).slice(0, 300)}`)
  return ok('reddit', null)
}

export const CHANNELS: Record<string, (l: PostInput) => Promise<ChannelResult>> = {
  facebook: postFacebook,
  linkedin: postLinkedIn,
  instagram: postInstagram,
  threads: postThreads,
  reddit: postReddit,
}
