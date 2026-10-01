import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE SITES eno IMPORTS FROM ARE "SOURCE SITES", NEVER "PARTNER" PORTALS OR SITES (2026-10-01).
 *
 * No code or contract records a partnership with Chợ Tốt/Nhatot, Muaban, Batdongsan, VietnamWorks or any
 * other site whose listings eno links, and "partner" now means only the signed-agreement badge
 * (/partners). about-page.test.tsx and category-copy.d1.test.ts pin the same rule for /about and the
 * category ledes; this pins the guides and the weekly digest, which a first pass missed. Source-level,
 * with comments stripped: the history notes in these files quote the old wording on purpose.
 */
const FILES = [
  'src/app/[lang]/housing-vietnam-expats/page.tsx',
  'src/app/[lang]/renting-an-apartment-vietnam-foreigner/page.tsx',
  'src/app/[lang]/moving-to-vietnam/page.forum.svc.tsx',
  'src/app/[lang]/first-month-in-vietnam/page.forum.svc.tsx',
  'src/app/[lang]/vietnam-evisa/official-process/page.forum.svc.tsx',
  'src/lib/emails/weekly-digest.ts',
]

/** Block comments (incl. JSX `{/* … *\/}`) and whole-line `//` comments. A `//` inside a URL survives. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('import sources are source sites', () => {
  for (const file of FILES) {
    it(`${file} never calls them partner portals or partner sites`, () => {
      const code = stripComments(readFileSync(file, 'utf8'))
      expect(code).not.toMatch(/partner (property )?(portal|site)s?\b/i)
    })
  }
})
