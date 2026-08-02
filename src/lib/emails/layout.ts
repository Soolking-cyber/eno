// Shared branded email shell — EVERY outgoing eno.vn email renders inside this
// (owner ask 2026-07-19: real logo + design matching the app). Email constraints
// rule the implementation: table layout, fully INLINED styles (clients strip
// <style>), absolute prod URLs, and the palette mirrors the app canon — single
// blue #0A66C2 on a white rounded-2xl card over the #f5f6f8 canvas.
//
// The logo is the raster wordmark public/logo.png (1600×400 → 112×28 here):
// email clients can't render SVG, and Gmail proxies images, so it must be a
// plain absolute https URL on the prod origin.
//
// ⚠️ THE ALT TEXT IS PER-EDITION (SITE_NAME), NOT A LITERAL. Gmail and Outlook show alt text
// whenever images are blocked — which is the DEFAULT for a first email from an unknown sender — so
// a hardcoded "eno.vn" meant every eno.forum email opened with the licensed marketplace's name in
// the sender's own header block. Same leak class as the 58 page titles SITE_NAME was introduced for.

import { SITE_NAME } from '@/lib/edition'

export const EMAIL = {
  BLUE: '#0A66C2',
  BLUE_DARK: '#004182',
  INK: '#171717',
  MUTED: '#6b7280',
  BORDER: '#e5e7eb',
  CANVAS: '#f5f6f8',
  RED: '#dc2626',
  FONT: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
} as const

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The one brand CTA — the email twin of `<Button variant="cta">`. */
export function emailCta(label: string, url: string): string {
  return `<a href="${esc(url)}" style="display:inline-block;background:${EMAIL.BLUE};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 28px;border-radius:12px;">${esc(label)}</a>`
}

export function renderBrandEmail(opts: {
  /** Hidden inbox-preview line (shows next to the subject in list views). */
  preheader: string
  /** The card's content rows — caller-built, caller-escaped HTML. */
  bodyHtml: string
  /** Absolute site origin for links + the logo (https://eno.vn in prod). */
  origin: string
  /** Optional centred brand CTA under the body. */
  cta?: { label: string; url: string }
  /** "You're receiving this because…" — pair with unsubscribeUrl for broadcasts. */
  audienceNote?: string
  unsubscribeUrl?: string
}): string {
  const { preheader, bodyHtml, origin, cta, audienceNote, unsubscribeUrl } = opts
  const E = EMAIL
  const audience = audienceNote
    ? `<p style="margin:0;font-size:12px;color:${E.MUTED};line-height:1.6;">${esc(audienceNote)}${
        unsubscribeUrl ? ` <a href="${esc(unsubscribeUrl)}" style="color:${E.BLUE};text-decoration:underline;">Unsubscribe from these emails</a>.` : ''
      }</p>`
    : ''
  return `<!-- preheader --><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${E.CANVAS};margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;font-family:${E.FONT};">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;border:1px solid ${E.BORDER};overflow:hidden;">
      <!-- header: the real wordmark, linked home -->
      <tr><td style="padding:22px 24px 6px;">
        <a href="${esc(origin)}" style="text-decoration:none;">
          <img src="${esc(origin)}/logo.png" width="112" height="28" alt="${esc(SITE_NAME)}" style="display:block;width:112px;height:28px;border:0;" />
        </a>
      </td></tr>
      <!-- body -->
      ${bodyHtml}
      ${cta ? `<tr><td align="center" style="padding:24px 24px 8px;">${emailCta(cta.label, cta.url)}</td></tr>` : ''}
      <!-- footer -->
      <tr><td style="padding:20px 24px 24px;border-top:1px solid ${E.BORDER};">
        ${audience}
        <p style="margin:${audience ? '10px' : '0'} 0 0;font-size:11px;color:${E.MUTED};line-height:1.6;">
          Công ty TNHH ENO · TP. Hồ Chí Minh, Việt Nam · support@eno.vn<br/>
          eno.vn — Vietnam's trusted marketplace for the international community.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>`.trim()
}
