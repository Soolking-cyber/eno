import { renderBrandEmail, esc, EMAIL } from './layout'

/**
 * "PLEASE UPLOAD YOUR VIDEO AGAIN" (owner, 2026-10-17: "reupload those 4 with sound … you send them automatically that
 * leads to the load page so they can reupload" — "also email"). Until db7eac156 every clip the browser compressed (over
 * 50 MB) went up with a SILENT sound track; the original never reached us, so only the uploader can put it right. Sent
 * once per listing and video by /api/cron/video-reupload-ask, in the app and by email, in the uploader's language.
 * A SERVICE NOTICE about their own listing: no unsubscribe link, nothing promotional — it owns the fault and asks.
 */
export const VIDEO_REUPLOAD_ASK = {
  title: {
    en: 'Please upload your video again',
    vi: 'Vui lòng tải lại video của bạn',
  },
  why: {
    en: 'Sorry — the video you uploaded lost its sound because of a problem on our side, which is now fixed.',
    vi: 'Xin lỗi — video bạn tải lên bị mất tiếng do lỗi từ phía chúng tôi, nay đã được khắc phục.',
  },
  ask: {
    en: 'Please upload it again so people can hear you. Everything else stays as it is.',
    vi: 'Vui lòng tải lại video để mọi người nghe được bạn. Mọi thứ khác vẫn giữ nguyên.',
  },
  cta: {
    en: 'Upload my video again',
    vi: 'Tải lại video',
  },
} as const

/** Where the video is replaced: a teacher's edit form, last step (where the photo ask sends too); else the listing's editor. */
export function videoReuploadPath(listingId: string, teacher: boolean): string {
  return teacher ? '/teachers/edit?step=finish' : `/listings/${listingId}/edit`
}

export function videoReuploadBody(l: 'en' | 'vi'): string {
  return `${VIDEO_REUPLOAD_ASK.why[l]} ${VIDEO_REUPLOAD_ASK.ask[l]}`
}

export function renderVideoReuploadAsk(opts: { origin: string; siteName: string; recipientName?: string | null; locale?: 'en' | 'vi'; path: string }): { subject: string; html: string; text: string } {
  const { origin, siteName, recipientName, path } = opts
  const l = opts.locale === 'vi' ? 'vi' : 'en'
  const subject = l === 'vi' ? `Vui lòng tải lại video của bạn trên ${siteName}` : `Please upload your video again on ${siteName}`
  const hello = recipientName ? (l === 'vi' ? `Chào ${recipientName},` : `Hi ${recipientName},`) : (l === 'vi' ? 'Chào bạn,' : 'Hi,')
  const lines = [VIDEO_REUPLOAD_ASK.why[l], VIDEO_REUPLOAD_ASK.ask[l]]
  const E = EMAIL
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${E.INK};">${esc(s)}</p>`
  const url = `${origin}${path}`
  // ⚠️ bodyHtml is the card's CONTENT ROWS (layout.ts): one row, as teacher-photo-ask.ts does.
  const html = renderBrandEmail({
    preheader: lines[0],
    bodyHtml: `<tr><td style="padding:4px 24px 8px;">${p(hello)}${lines.map(p).join('')}</td></tr>`,
    origin,
    cta: { label: VIDEO_REUPLOAD_ASK.cta[l], url },
    audienceNote: l === 'vi' ? `Bạn nhận được email này vì bạn đã tải video lên ${siteName}.` : `You’re receiving this because you uploaded a video to ${siteName}.`,
    sender: 'full',
  })
  const text = [hello, '', ...lines, '', url].join('\n')
  return { subject, html, text }
}
