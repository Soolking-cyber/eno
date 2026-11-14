/**
 * THE TEACHER PROFILE'S PINNED ACTION (2026-11-10, item 1 of the decision scorecard): three strings in two files that must
 * agree, read as source. The profile is a server component, so it cannot import the contact block's id from its client
 * module; if the two drifted the bar would silently sit on top of the full contact block (commit review).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const VIEW = readFileSync(join(process.cwd(), 'src/components/teachers/teacher-profile-view.tsx'), 'utf8')
const CONTACT = readFileSync(join(process.cwd(), 'src/components/teachers/teacher-contact.tsx'), 'utf8')

describe('the teacher profile\'s pinned action', () => {
  it('stays away while the full contact block is on screen: `hideWhile` names that block\'s real id', () => {
    const id = /export const TEACHER_CONTACT_ID = '([^']+)'/.exec(CONTACT)?.[1]
    expect(id).toBe('teacher-contact')
    expect(VIEW).toContain(`hideWhile="#${id}"`)
    expect(CONTACT).toContain('<div id={TEACHER_CONTACT_ID}')
  })

  it('measures a block the page keeps, with the jump button inside it, and mirrors that button', () => {
    // Since 2026-11-14 (owner-approved, cook r04 teachers) the block shares one row with the rate: it takes the rest of the row
    // (`grow`), and the row — not the button — is `lg:hidden`, so at lg the bar finds no rendered control to mirror.
    expect(VIEW).toMatch(/<div className="mt-4 flex flex-wrap items-center gap-3 lg:hidden">[\s\S]*?<div data-pdp-action-block="" className="grow sm:grow-0">\s*<TeacherContactJump listingId=\{listing\.id\} className="w-full sm:w-auto" \/>\s*<\/div>\s*<\/div>/)
    expect(VIEW).toContain('block="[data-pdp-action-block]"')
    expect(VIEW).toContain(`control='[data-pdp-primary="teacher"]'`)
    expect(CONTACT).toContain('data-pdp-primary="teacher"')
    // One bar on the profile.
    expect(VIEW.split('<PdpActionBar').length - 1).toBe(1)
  })
})
