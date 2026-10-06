import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { SCHOOL_KINDS, type SchoolKind } from '@/lib/schools/constants'
import { AwardsResults } from './awards-results'

// "How to take part" names no sign-in method: with `ios-hide-google` on (src/lib/app-review-gates.ts) the iOS
// app has no Google button, so "Sign in with Google or email" sent a teacher looking for one.
const qualified = Object.fromEntries(SCHOOL_KINDS.map((k) => [k, []])) as unknown as Record<SchoolKind, { slug: string; name: string }[]>

describe('AwardsResults, while the year is open', () => {
  it.each([
    ['en', 'Sign in; one vote per account.'],
    ['vi', 'Đăng nhập; mỗi tài khoản một phiếu.'],
  ] as const)('%s: how to take part says to sign in without naming a method', (lang, line) => {
    // The page is server-rendered in the visitor's language, so the first frame is what this checks.
    const html = renderToString(
      <LanguageProvider initialLang={lang} initialViDict={{}}>
        <AwardsResults page={{ state: 'open', year: 2026, qualified }} lang={lang} />
      </LanguageProvider>,
    )
    expect(html).toContain(line)
    expect(html).not.toContain('Google')
  })
})
