import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AMENDED } from '@/lib/compliance/legal-amendment'
import { TOS_EFFECTIVE_AT, TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

/**
 * The machine-readable /terms summary: the version it names is the one IN FORCE at the request (the
 * one onboarding stamps), and the one clause it quotes is quoted, not paraphrased.
 */

/** A notice-window amendment (the dates 110295be shipped) — the default for the next one. */
const WINDOW = { published: '2026-10-01', inForce: '2026-10-07' } as const

async function markdownAt(at: number, amendment?: typeof WINDOW): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  if (amendment) {
    vi.doMock('@/lib/compliance/legal-amendment', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/compliance/legal-amendment')>()
      return { ...real, LEGAL_AMENDMENT: amendment, AMENDED: real.amendedDates(amendment) }
    })
  }
  const { GET } = await import('./route')
  return GET().text()
}

afterEach(() => {
  vi.doUnmock('@/lib/compliance/legal-amendment')
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('/terms as markdown', () => {
  // ⛔ Version 2 is an immediate amendment (owner, 2026-10-01): in force from 01/10/2026, its publication day.
  it('names version 2 as in force since 1 October 2026 and links the version it replaced', async () => {
    const md = await markdownAt(Date.parse('2026-10-01T18:00:00+07:00'))
    expect(md).toContain(`Version in force: ${TOS_VERSION}, since 1 October 2026. The previous version, ${TOS_PREVIOUS_VERSION}, is published at https://eno.vn/terms/v${TOS_PREVIOUS_VERSION}.\n`)
    expect(md).not.toMatch(/takes effect on|remains in force|7 October/)
  })

  it('names the new version from the in-force instant', async () => {
    const md = await markdownAt(TOS_EFFECTIVE_AT)
    expect(md).toContain(`Version in force: ${TOS_VERSION}, since ${AMENDED.inForceEn}.`)
    expect(md).not.toContain('takes effect on')
  })

  it('with a notice window, names the PREVIOUS version as in force and when the new one takes effect', async () => {
    const md = await markdownAt(Date.parse('2026-10-06T23:59:59+07:00'), WINDOW)
    expect(md).toContain(`Version in force: ${TOS_PREVIOUS_VERSION}.`)
    expect(md).toContain(`Version ${TOS_VERSION} — the text now published at https://eno.vn/terms — was published on 1 October 2026 and takes effect on 7 October 2026`)
    // The text in force is published, not "write to us for a copy" (src/lib/compliance/legal-archive.ts).
    expect(md).toContain(`its text is published at https://eno.vn/terms/v${TOS_PREVIOUS_VERSION}.`)
    // …and from its in-force instant, the new version alone.
    expect(await markdownAt(Date.parse('2026-10-07T00:00:00+07:00'), WINDOW)).toContain(`Version in force: ${TOS_VERSION}, since 7 October 2026.`)
  })

  it('quotes the linked-listings definition word for word and points at the binding clause', async () => {
    const md = await markdownAt(TOS_EFFECTIVE_AT)
    expect(md).toContain('"Many listings on eno.vn are linked listings: copies, for reference, of listings published on another website')
    expect(md).toContain('https://eno.vn/terms#linked')
    // No restated obligations: the clause's later sentences are pointed at, never summarised.
    expect(md).not.toMatch(/labelled as ads|has not vetted|takes no payment/)

    // Source-level identity with /terms: the quoted template must open the `linked` section's English.
    const route = readFileSync('src/app/md/terms/route.ts', 'utf8')
    const quoted = /const LINKED_DEFINITION = `([^`]+)`/.exec(route)?.[1]
    expect(quoted).toBeTruthy()
    expect(readFileSync('src/app/[lang]/terms/page.tsx', 'utf8')).toContain(`en: \`${quoted} We import them`)
  })
})
