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
    expect(VIEW).toMatch(/<div data-pdp-action-block="">\s*<TeacherContactJump listingId=\{listing\.id\} className="mt-3 w-full sm:w-auto lg:hidden" \/>\s*<\/div>/)
    expect(VIEW).toContain('block="[data-pdp-action-block]"')
    expect(VIEW).toContain(`control='[data-pdp-primary="teacher"]'`)
    expect(CONTACT).toContain('data-pdp-primary="teacher"')
    // One bar on the profile.
    expect(VIEW.split('<PdpActionBar').length - 1).toBe(1)
  })
})
