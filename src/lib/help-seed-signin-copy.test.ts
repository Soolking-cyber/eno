import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PHONE_OTP_ENABLED } from './auth-policy'

/**
 * THE HELP CENTRE MUST DESCRIBE SIGN-IN AS THE APPS SHOW IT (App Store audit 1.7, 2026-10-06).
 *
 * The seed (scripts/help-center-seed.json → ForumPost rows via scripts/sync-help-center.ts) once said
 * "There is no password on eno.vn … Phone code, the default … Google: one tap". In the iOS app Google is
 * hidden (review gate `ios-hide-google`), phone codes are off (PHONE_OTP_ENABLED) and the reviewer's demo
 * account signs in with "Use a password" — so every one of those claims was false where Apple reads them.
 * These two answers are reachable from the app's Account tab → Help centre; keep them true on every
 * platform, and free of an edition name (the same rows serve eno.vn and eno.forum).
 */
const seed = JSON.parse(readFileSync(fileURLToPath(new URL('../../scripts/help-center-seed.json', import.meta.url)), 'utf8'))
const items: Array<Record<string, string>> = Array.isArray(seed) ? seed : (seed.items ?? seed.posts ?? [])
const entry = (slug: string) => items.find((it) => it.slugHint === slug)

describe('help centre — the sign-in answers', () => {
  for (const slug of ['how-to-sign-in', 'browse-without-account']) {
    it(`${slug}: no edition name, no "no password", no Google one-tap`, () => {
      const it_ = entry(slug)
      expect(it_, `seed entry ${slug}`).toBeDefined()
      const text = [it_!.title, it_!.titleVi, it_!.body, it_!.bodyVi].join('\n')
      expect(text).not.toMatch(/eno\.(vn|forum)/i)
      expect(text).not.toMatch(/no password|không dùng mật khẩu/i)
      expect(text).not.toMatch(/one tap with your Google|một chạm/i)
    })
  }

  it('how-to-sign-in: offers the phone code only if phone sign-in is actually on', () => {
    const it_ = entry('how-to-sign-in')!
    if (!PHONE_OTP_ENABLED) expect(`${it_.body}\n${it_.bodyVi}`).not.toMatch(/phone code|mã (qua )?điện thoại|SMS/i)
  })
})

/**
 * SIGN IN WITH APPLE (2026-10-08): Google is back in the iOS app beside Apple, and Apple is on eno.vn's web and in the
 * Android app that renders it. ⚠️ THE SEED REACHES THE HELP CENTRE ONLY THROUGH scripts/sync-help-center.ts, A PROD WRITE THE OWNER
 * RUNS AFTER THE WEB FLIP (plan §4 step 8) — never before it: until then these answers would name buttons the iOS app
 * does not show (build 2 shows neither), which is exactly the claim-vs-app gap the block above exists to stop.
 */
describe('help centre — the sign-in answers after Sign in with Apple', () => {
  const form = readFileSync(fileURLToPath(new URL('../components/marketplace/sign-in-form.tsx', import.meta.url)), 'utf8')
  /** The Vietnamese half of the sign-in form's (English, Vietnamese) label pair — the button exactly as labelled.
   *  (The call is never written out here: scripts/gen-ui-strings.mjs scans test files too.) */
  const label = (en: string) => form.match(new RegExp(`t\\('${en}', '([^']+)'\\)`))?.[1]

  for (const en of ['Continue with Google', 'Continue with Apple']) {
    it(`names "${en}" exactly as the sign-in form labels it, in both languages and both answers`, () => {
      const vi = label(en)
      expect(vi, `no label pair for "${en}" in sign-in-form.tsx`).toBeTruthy()
      for (const slug of ['how-to-sign-in', 'browse-without-account']) {
        expect(entry(slug)!.body, slug).toContain(en)
        expect(entry(slug)!.bodyVi, slug).toContain(vi)
      }
    })
  }

  /** The sentence holding the first mention of `phrase` — from the last sentence end (or line, or bullet) before it to the next. */
  const sentenceWith = (text: string, phrase: string) => {
    const at = text.indexOf(phrase)
    if (at < 0) return ''
    const start = Math.max(text.lastIndexOf('. ', at), text.lastIndexOf('\n', at), text.lastIndexOf('•', at)) + 1
    const ends = ['. ', '.\n', '\n'].map((t) => text.indexOf(t, at)).filter((i) => i >= 0)
    return text.slice(start, ends.length ? Math.min(...ends) : undefined)
  }

  // ⛔ eno.forum shows no Apple at launch (D2 = a: its NEXT_PUBLIC_APPLE_SIGNIN stays empty), and the same rows serve
  // both editions — the Android app on Play's v4 renders the forum. So Apple's first mention in each answer carries
  // its condition, and no answer counts the ways as if Apple were always one of them.
  it('names Apple only where it shows — "where you see that button", in both languages and both answers', () => {
    const vi = label('Continue with Apple')!
    for (const slug of ['how-to-sign-in', 'browse-without-account']) {
      const { body, bodyVi } = entry(slug)!
      expect(sentenceWith(body, 'Continue with Apple'), slug).toContain('where you see that button')
      expect(sentenceWith(bodyVi, vi), slug).toContain('nếu bạn thấy nút này')
      expect(`${body}\n${bodyVi}`, slug).not.toMatch(/three ways|ba cách/i)
    }
  })

  it('how-to-sign-in: a Hide My Email account is a separate one (D8), in both languages', () => {
    const it_ = entry('how-to-sign-in')!
    expect(it_.body).toMatch(/Hide My Email[\s\S]*separate account/)
    expect(it_.bodyVi).toMatch(/Hide My Email[\s\S]*tài khoản riêng/)
  })

  it('how-to-sign-in: no Apple inside another app’s built-in browser (D7), and Google’s link is named as the form names it', () => {
    const it_ = entry('how-to-sign-in')!
    expect(it_.body).toMatch(/built-in browser[^.]*Apple is not offered/)
    expect(it_.bodyVi).toMatch(/không có Apple/)
    expect(it_.body).toContain('Use Google instead')
    expect(it_.bodyVi).toContain(label('Use Google instead')!)
  })
})
