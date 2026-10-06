import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGAL_AMENDMENT, REGULATIONS_AMENDMENT } from './legal-amendment'
import { TERMS_V2_SUPERSEDED_BY, V1, V1_PATHS, V1_SUPERSEDED_BY, V2, V2_PATHS, V2_SUPERSEDED_BY, archivedPath } from './legal-archive'
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
    expect(V2_PATHS.regulations).toBe('/regulations/v2')
    expect(existsSync(pageFile('regulations', V2))).toBe(true)
  })

  // The Terms' version 3 (2026-10-07) replaced the Terms' version 2 — the text everyone accepted from 01/10/2026
  // until version 3's in-force instant, and the text in force during its notice window.
  it('keeps the Terms’ version 2 published, permanently — acceptance records name it', () => {
    expect(TOS_VERSION).toBe('3')
    expect(V2_PATHS).toEqual({ terms: '/terms/v2', regulations: '/regulations/v2' })
    expect(existsSync(pageFile('terms', V2))).toBe(true)
  })

  it('borrows LEGAL_AMENDMENT for version 1’s successor ONLY while LEGAL_AMENDMENT still describes it', () => {
    expect(block('V1_SUPERSEDED_BY'), 'the anchor below must find the block').toContain("version: '2'")
    // Widened: the two are literal types, and TypeScript refuses a comparison it can already decide.
    if ((TOS_VERSION as string) === V1_SUPERSEDED_BY.version) {
      expect(V1_SUPERSEDED_BY.published).toBe(LEGAL_AMENDMENT.published)
      expect(V1_SUPERSEDED_BY.inForce).toBe(LEGAL_AMENDMENT.inForce)
    } else {
      // A later amendment re-used LEGAL_AMENDMENT: version 2's real dates must be literals by now, or the
      // version-1 archive prints the newer amendment's dates as version 2's.
      expect(block('V1_SUPERSEDED_BY'), 'type version 2’s real publication and in-force dates into V1_SUPERSEDED_BY').not.toMatch(/LEGAL_AMENDMENT\.(published|inForce)/)
    }
  })

  // ⛔ Since the Terms' version 3 re-used the record: the October 2026 amendment's real dates, typed once.
  it('types version 2’s real dates — published and in force 01/10/2026 — now that LEGAL_AMENDMENT moved on', () => {
    expect(V1_SUPERSEDED_BY).toEqual({ version: '2', published: '2026-10-01', inForce: '2026-10-01' })
    expect(LEGAL_AMENDMENT.published).not.toBe(V1_SUPERSEDED_BY.published)
  })

  it('borrows LEGAL_AMENDMENT for the Terms’ version 3 ONLY while that record still describes it', () => {
    expect(block('TERMS_V2_SUPERSEDED_BY'), 'the anchor below must find the block').toContain("version: '3'")
    if (TOS_VERSION === TERMS_V2_SUPERSEDED_BY.version) {
      expect(TERMS_V2_SUPERSEDED_BY.published).toBe(LEGAL_AMENDMENT.published)
      expect(TERMS_V2_SUPERSEDED_BY.inForce).toBe(LEGAL_AMENDMENT.inForce)
    } else {
      // A version 4 re-used LEGAL_AMENDMENT: version 3's real dates must be literals by now, or the version-2
      // archive prints the newer amendment's dates as version 3's.
      expect(block('TERMS_V2_SUPERSEDED_BY'), 'type version 3’s real publication and in-force dates into TERMS_V2_SUPERSEDED_BY').not.toMatch(/LEGAL_AMENDMENT\.(published|inForce)/)
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
    for (const [doc, v] of [['terms', V1], ['terms', V2], ['regulations', V1], ['regulations', V2]] as const) {
      const src = readFileSync(pageFile(doc, v), 'utf8')
      expect(src, `${doc}/v${v}`).toContain('robots: { index: false, follow: true }')
      expect(src, `${doc}/v${v}`).toContain(`canonical: '/${doc}/v${v}'`)
    }
  })
})
