import { renderBrandEmail, esc, EMAIL } from './layout'

/**
 * "Jobs that match your teacher profile" (owner, 2026-09-30: "email sent to the teacher to apply").
 * One email per teacher per run, at most five jobs, each with its apply link: a linked posting applies
 * at the source; a school's own post is answered by messaging the school on the site.
 * ⚠️ `siteName` comes from the caller (SITE_NAME) — the route is compiled into both editions.
 * ⛔ No visa wording, ever: the cron drops any job whose title/pay names one and filters the reasons.
 */
export type TeacherMatchJob = { title: string; city: string | null; pay: string | null; url: string; reasons: string[]; applyAtSource: boolean }

export function renderTeacherMatches(opts: {
  jobs: TeacherMatchJob[]
  origin: string
  unsubscribeUrl: string
  recipientName?: string | null
  siteName: string
}): { subject: string; html: string; text: string } {
  const { jobs, origin, unsubscribeUrl, recipientName, siteName } = opts
  const n = jobs.length
  const subject = n === 1 ? `A teaching job that matches your profile — ${jobs[0].title}` : `${n} teaching jobs that match your profile`
  const hi = recipientName ? `Hi ${esc(recipientName.split(' ')[0])},` : 'Hi,'
  const rows = jobs.map((j) => `
      <tr><td style="padding:12px 24px;border-top:1px solid ${EMAIL.BORDER};">
        <a href="${esc(j.url)}" style="font-size:15px;font-weight:600;color:${EMAIL.BLUE};text-decoration:none;">${esc(j.title)}</a>
        <p style="margin:4px 0 0;font-size:13px;color:${EMAIL.MUTED};">${esc([j.city, j.pay].filter(Boolean).join(' · '))}</p>
        ${j.reasons.length ? `<p style="margin:6px 0 0;font-size:13px;color:${EMAIL.INK};line-height:1.5;">Why it fits: ${esc(j.reasons.join('; '))}</p>` : ''}
        <p style="margin:6px 0 0;font-size:13px;"><a href="${esc(j.url)}" style="color:${EMAIL.BLUE};">${j.applyAtSource ? 'See the job and apply →' : 'Message the school →'}</a></p>
      </td></tr>`).join('')
  const bodyHtml = `
      <tr><td style="padding:4px 24px 8px;">
        <p style="margin:12px 0 0;font-size:15px;color:${EMAIL.INK};">${hi}</p>
        <p style="margin:6px 0 0;font-size:14px;color:${EMAIL.MUTED};line-height:1.5;">We compared your teacher profile on ${esc(siteName)} with new teaching jobs. ${n === 1 ? 'This one looks' : 'These look'} like a good fit — apply directly; applying is always free.</p>
      </td></tr>${rows}`
  const html = renderBrandEmail({
    preheader: n === 1 ? `${jobs[0].title} — a good fit for your profile.` : `${n} teaching jobs picked for your profile.`,
    bodyHtml,
    origin,
    cta: { label: 'Update my teacher profile', url: `${origin}/teachers/edit` },
    audienceNote: `You're receiving this because you asked for job matches on your ${siteName} teacher profile.`,
    unsubscribeUrl,
  })
  const text = [
    hi.replace(/<[^>]+>/g, ''), '',
    `Teaching jobs that match your ${siteName} teacher profile — applying is always free:`, '',
    ...jobs.flatMap((j) => [`• ${j.title}${j.city ? ` (${j.city})` : ''}${j.pay ? ` — ${j.pay}` : ''}`, `  ${j.url}`, '']),
    `Update your profile: ${origin}/teachers/edit`,
    `Stop these emails: ${unsubscribeUrl}`,
  ].join('\n')
  return { subject, html, text }
}
