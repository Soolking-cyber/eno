import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AMENDED } from '@/lib/compliance/legal-amendment'
import { TOS_EFFECTIVE_AT, TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

/**
 * The machine-readable /terms summary: the version it names is the one IN FORCE at the request (the
 * one onboarding stamps), and the one clause it quotes is quoted, not paraphrased.
 */

async function markdownAt(at: number): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  const { GET } = await import('./route')
  return GET().text()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('/terms as markdown', () => {
  it('names the PREVIOUS version as in force during the notice window, and when the new one takes effect', async () => {
    const md = await markdownAt(TOS_EFFECTIVE_AT - 1)
    expect(md).toContain(`Version in force: ${TOS_PREVIOUS_VERSION}.`)
    expect(md).toContain(`Version ${TOS_VERSION} — the text now published at https://eno.vn/terms — was published on ${AMENDED.publishedEn} and takes effect on ${AMENDED.inForceEn}`)
    // The text in force is published, not "write to us for a copy" (src/lib/compliance/legal-archive.ts).
    expect(md).toContain(`its text is published at https://eno.vn/terms/v${TOS_PREVIOUS_VERSION}.`)
  })

  it('names the new version alone from the in-force instant', async () => {
    const md = await markdownAt(TOS_EFFECTIVE_AT)
    expect(md).toContain(`Version in force: ${TOS_VERSION}\n`)
    expect(md).not.toContain('takes effect on')
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
