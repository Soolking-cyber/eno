import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGAL_AMENDMENT, REGULATIONS_AMENDMENT } from './legal-amendment'
import { V1, V1_PATHS, V1_SUPERSEDED_BY, V2, V2_PATHS, V2_SUPERSEDED_BY, archivedPath } from './legal-archive'
import { REGULATIONS_PREVIOUS_VERSION, REGULATIONS_VERSION, TOS_PREVIOUS_VERSION, TOS_VERSION } from '@/lib/site-legal'

/**
 * The archived Terms / Quy chế versions (src/lib/compliance/legal-archive.ts). Quy chế Article 15 promises the
 * version in force is always published under /regulations with its number, and everyone stamped
 * Profile.tosVersion = '1' must be able to read what they accepted — so the version a notice-window line
 * calls "still in force" has to exist as a page, and an archive must never start quoting the next
 * amendment's dates as its own.
 */
const ROOT = join(__dirname, '..', '..', '..')
const pageFile = (doc: 'terms' | 'regulations', v: string) => join(ROOT, 'src/app/[lang]', doc, `v${v}`, 'page.tsx')
const SRC = () => readFileSync(join(ROOT, 'src/lib/compliance/legal-archive.ts'), 'utf8')
/** The source of one `export const <name> = {` … `} as const` block. */
const block = (name: string) => SRC().match(new RegExp(`export const ${name} = \\{[\\s\\S]*?\\n\\} as const`))?.[0] ?? ''

describe('legal archive', () => {
  it('publishes each document for the version a notice window says is still in force', () => {
    expect(existsSync(pageFile('terms', TOS_PREVIOUS_VERSION))).toBe(true)
    expect(existsSync(pageFile('regulations', TOS_PREVIOUS_VERSION))).toBe(true)
    expect(archivedPath('terms', TOS_PREVIOUS_VERSION)).toBe(`/terms/v${TOS_PREVIOUS_VERSION}`)
    // The Quy chế counts its own versions since its version 3 (2026-10-05): its previous one is published too.
    expect(existsSync(pageFile('regulations', REGULATIONS_PREVIOUS_VERSION))).toBe(true)
  })

  it('keeps version 1 published, permanently — acceptance records name it', () => {
    expect(V1).toBe('1')
    expect(V1_PATHS).toEqual({ terms: '/terms/v1', regulations: '/regulations/v1' })
    expect(existsSync(pageFile('terms', V1))).toBe(true)
    expect(existsSync(pageFile('regulations', V1))).toBe(true)
  })

  it('keeps the Quy chế’s version 2 published, permanently — the Terms accepted from 01/10/2026 incorporate it', () => {
    expect(V2).toBe('2')
    expect(V2_PATHS).toEqual({ regulations: '/regulations/v2' })
    expect(existsSync(pageFile('regulations', V2))).toBe(true)
    // The Terms' version 2 is the CURRENT Terms — there is nothing to archive.
    expect(TOS_VERSION).toBe('2')
    expect(existsSync(pageFile('terms', V2))).toBe(false)
  })

  it('borrows LEGAL_AMENDMENT for version 1’s successor ONLY while LEGAL_AMENDMENT still describes it', () => {
    expect(block('V1_SUPERSEDED_BY'), 'the anchor below must find the block').toContain("version: '2'")
    if (TOS_VERSION === V1_SUPERSEDED_BY.version) {
      expect(V1_SUPERSEDED_BY.published).toBe(LEGAL_AMENDMENT.published)
      expect(V1_SUPERSEDED_BY.inForce).toBe(LEGAL_AMENDMENT.inForce)
    } else {
      // A later amendment re-used LEGAL_AMENDMENT: version 2's real dates must be literals by now, or the
      // version-1 archive prints the newer amendment's dates as version 2's.
      expect(block('V1_SUPERSEDED_BY'), 'type version 2’s real publication and in-force dates into V1_SUPERSEDED_BY').not.toMatch(/LEGAL_AMENDMENT\.(published|inForce)/)
    }
  })

  it('borrows REGULATIONS_AMENDMENT for the Quy chế’s version 3 ONLY while that record still describes it', () => {
    expect(block('V2_SUPERSEDED_BY'), 'the anchor below must find the block').toContain("version: '3'")
    if (REGULATIONS_VERSION === V2_SUPERSEDED_BY.version) {
      expect(V2_SUPERSEDED_BY.published).toBe(REGULATIONS_AMENDMENT.published)
      expect(V2_SUPERSEDED_BY.inForce).toBe(REGULATIONS_AMENDMENT.inForce)
    } else {
      // A version 4 re-used REGULATIONS_AMENDMENT: version 3's real dates must be literals by now, or the
      // version-2 archive (and version 3's Article 17 entry) print the newer amendment's dates.
      expect(block('V2_SUPERSEDED_BY'), 'type version 3’s real publication and in-force dates into V2_SUPERSEDED_BY').not.toMatch(/REGULATIONS_AMENDMENT\.(published|inForce)/)
    }
  })

  it('archives are noindex and canonical to themselves', () => {
    for (const [doc, v] of [['terms', V1], ['regulations', V1], ['regulations', V2]] as const) {
      const src = readFileSync(pageFile(doc, v), 'utf8')
      expect(src, `${doc}/v${v}`).toContain('robots: { index: false, follow: true }')
      expect(src, `${doc}/v${v}`).toContain(`canonical: '/${doc}/v${v}'`)
    }
  })
})
