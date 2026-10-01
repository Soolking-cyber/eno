import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGAL_AMENDMENT } from './legal-amendment'
import { V1, V1_PATHS, V1_SUPERSEDED_BY, archivedPath } from './legal-archive'
import { TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

/**
 * The archived Terms / Quy chế versions (src/lib/compliance/legal-archive.ts). Quy chế Article 15 promises the
 * version in force is always published under /regulations with its number, and everyone stamped
 * Profile.tosVersion = '1' must be able to read what they accepted — so the version a notice-window line
 * calls "still in force" has to exist as a page, and an archive must never start quoting the next
 * amendment's dates as its own.
 */
const ROOT = join(__dirname, '..', '..', '..')
const pageFile = (doc: 'terms' | 'regulations', v: string) => join(ROOT, 'src/app/[lang]', doc, `v${v}`, 'page.tsx')

describe('legal archive', () => {
  it('publishes both documents for the version a notice window says is still in force', () => {
    expect(existsSync(pageFile('terms', TOS_PREVIOUS_VERSION))).toBe(true)
    expect(existsSync(pageFile('regulations', TOS_PREVIOUS_VERSION))).toBe(true)
    expect(archivedPath('terms', TOS_PREVIOUS_VERSION)).toBe(`/terms/v${TOS_PREVIOUS_VERSION}`)
  })

  it('keeps version 1 published, permanently — acceptance records name it', () => {
    expect(V1).toBe('1')
    expect(V1_PATHS).toEqual({ terms: '/terms/v1', regulations: '/regulations/v1' })
    expect(existsSync(pageFile('terms', V1))).toBe(true)
    expect(existsSync(pageFile('regulations', V1))).toBe(true)
  })

  it('borrows LEGAL_AMENDMENT for version 1’s successor ONLY while LEGAL_AMENDMENT still describes it', () => {
    const src = readFileSync(join(ROOT, 'src/lib/compliance/legal-archive.ts'), 'utf8')
    if (TOS_VERSION === V1_SUPERSEDED_BY.version) {
      expect(V1_SUPERSEDED_BY.published).toBe(LEGAL_AMENDMENT.published)
      expect(V1_SUPERSEDED_BY.inForce).toBe(LEGAL_AMENDMENT.inForce)
    } else {
      // A later amendment re-used LEGAL_AMENDMENT: version 2's real dates must be literals by now, or the
      // version-1 archive prints the newer amendment's dates as version 2's.
      expect(src, 'type version 2’s real publication and in-force dates into V1_SUPERSEDED_BY').not.toMatch(/LEGAL_AMENDMENT\.(published|inForce)/)
    }
  })

  it('archives are noindex and canonical to themselves', () => {
    for (const doc of ['terms', 'regulations'] as const) {
      const src = readFileSync(pageFile(doc, V1), 'utf8')
      expect(src, doc).toContain('robots: { index: false, follow: true }')
      expect(src, doc).toContain(`canonical: '/${doc}/v1'`)
    }
  })
})
