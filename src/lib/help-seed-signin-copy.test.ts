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
