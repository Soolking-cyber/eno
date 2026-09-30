import { storefrontBaseHost } from '@/lib/storefront-host'
import { TEACHER_SUBDOMAIN } from '@/lib/teachers/constants'

/**
 * teacher.<base> — the teacher sign-up host (owner, 2026-09-30: "teacher.eno.vn is a form like page").
 * Import-light: the proxy (edge) and the pages both use it. `base` follows storefrontBaseHost, so
 * `www.` is stripped exactly as for storefronts (www.eno.forum → teacher.eno.forum, never
 * teacher.www.eno.forum).
 */
export function teacherHost(appUrl: string | null | undefined): string {
  const base = storefrontBaseHost(appUrl)
  return base ? `${TEACHER_SUBDOMAIN}.${base}` : ''
}

/** Is this Host header the teacher host? Port and case are ignored; loopback never is. */
export function isTeacherHost(hostHeader: string | null | undefined, appUrl: string | null | undefined): boolean {
  const want = teacherHost(appUrl)
  if (!want || !hostHeader) return false
  return hostHeader.toLowerCase().replace(/:\d+$/, '') === want
}

/** https://teacher.<base> — the canonical URL of the sign-up form. */
export function teacherOrigin(appUrl: string | null | undefined): string {
  const host = teacherHost(appUrl)
  if (!host || !appUrl) return ''
  try { return `${new URL(appUrl).protocol}//${host}` } catch { return '' }
}

/** The canonical app origin (apex, no www) — where the second half of the form lives. */
export function apexOrigin(appUrl: string | null | undefined): string {
  if (!appUrl) return ''
  try { const u = new URL(appUrl); return `${u.protocol}//${storefrontBaseHost(appUrl)}` } catch { return '' }
}
