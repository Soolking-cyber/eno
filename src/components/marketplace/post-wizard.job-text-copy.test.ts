/**
 * ⛔ THE WIZARD'S JOB-TEXT SENTENCES ARE THE ROUTES' (teacher visibility plan §3a item 6, 2026-10-18). The post wizard words
 * each refusal itself (tr(), for the i18n harvest) — in the routes' sentences (job-listing.ts JOB_TEXT_REFUSAL), so the web,
 * the native apps (`message`) and /api/v1 say one thing. Read as source, the way taxonomy.post-picker.test.ts pins
 * TEACHER_PROFILE_REFUSAL. (Moved here from core/listings.job-text.test.ts, 2026-10-19: it reads the wizard, not the core.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'
import { JOB_TEXT_BLOCK_CODES } from '@/lib/publish-guard'

describe('the post wizard says each job-text refusal in JOB_TEXT_REFUSAL’s words, and jumps to the field', () => {
  const wizard = readFileSync(join(process.cwd(), 'src/components/marketplace/post-wizard.tsx'), 'utf8')

  // `t(${quoted(…)}` and never a quote right after `t(`: the string harvester scans test files, and would take a template's
  // placeholders for copy.
  const quoted = (x: string) => `'${x}'`
  it.each(JOB_TEXT_BLOCK_CODES)('%s', (code) => {
    const { en, vi } = JOB_TEXT_REFUSAL[code]
    expect(wizard).toContain([`: msg === ${quoted(code)}`, `          ? t(${quoted(vi)}, ${quoted(en)})`].join('\n'))
  })

  it('the jump follows the field the server names — title, description, or a place field’s picker; an attribute has none', () => {
    expect(wizard).toContain("return named === 'title' || named === 'description' ? named : named === 'location' || named === 'district' || named === 'city' ? 'location' : null")
  })
})
